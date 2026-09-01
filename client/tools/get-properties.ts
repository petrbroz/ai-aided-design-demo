import type { ToolSpec } from "../webmcp.js";
import { numberArray } from "../webmcp.js";
import { bulkProperties, matchProperty, nodeName, resolveDbIds } from "../viewer.js";
import { cap, distinct, groupBy, isBlank, round, toNumber } from "../utils.js";

const DEFAULT_PROPERTY_NAMES = [
  "Name",
  "Category",
  "Family",
  "Type Name",
  "Level",
  "Material",
  "Area",
  "Volume",
  "Length",
  "Width",
  "Height",
];

type AggregateOp = "sum" | "avg" | "min" | "max" | "group-by";

interface GetPropertiesInput {
  dbIds?: number[];
  propertyNames?: string[];
  aggregate?: { property: string; op: AggregateOp };
}

async function getProperties(input: GetPropertiesInput) {
  const { dbIds, source } = resolveDbIds(input.dbIds);
  if (input.aggregate) return aggregateProperties(dbIds, source, input.aggregate);

  const requested = input.propertyNames ?? DEFAULT_PROPERTY_NAMES;
  const page = cap(dbIds);
  const results = await bulkProperties(page.items, requested);
  const byDbId = new Map(results.map((r) => [r.dbId, r]));

  // Built from the requested ids, not from the results, so an object the property
  // database returned nothing for still shows up (with no properties) instead of
  // silently shortening the list and reading as truncation.
  const items = page.items.map((dbId) => {
    const result = byDbId.get(dbId);
    return {
      dbId,
      name: result?.name ?? nodeName(dbId),
      properties: (result?.properties ?? []).map((p) => ({
        name: p.displayName ?? p.attributeName ?? "(unnamed)",
        displayValue: p.displayValue ?? null,
        units: p.units ?? null,
      })),
    };
  });

  // propFilter is matched case-sensitively by the property database, so a name that
  // is merely miscased comes back as silence. Say which names found nothing.
  const seen = new Set(items.flatMap((i) => i.properties.map((p) => p.name.toLowerCase())));
  const unmatchedProperties = requested.filter((name) => !seen.has(name.trim().toLowerCase()));

  return {
    dbIdSource: source,
    propertyFilter: requested,
    unmatchedProperties,
    objects: { ...page, items },
  };
}

async function aggregateProperties(
  dbIds: number[],
  source: string,
  { property, op }: { property: string; op: AggregateOp }
) {
  const results = await bulkProperties(dbIds, [property]);

  const entries: Array<{ raw: unknown; num: number | null }> = [];
  const unitStrings: string[] = [];
  for (const r of results) {
    const prop = matchProperty(r.properties, property);
    if (!prop || isBlank(prop.displayValue)) continue;
    entries.push({ raw: prop.displayValue, num: toNumber(prop.displayValue) });
    if (prop.units) unitStrings.push(String(prop.units));
  }

  const base = {
    property,
    op,
    dbIdSource: source,
    objectCount: dbIds.length,
    withProperty: entries.length,
    missingProperty: dbIds.length - entries.length,
    // Every distinct unit seen, not the most common one: a sum over mixed mm and ft
    // rows is meaningless, and labelling it with whichever unit won a vote hides that.
    units: distinct(unitStrings),
  };

  if (op === "group-by") {
    const groups = groupBy(entries, (e) => String(e.raw));
    return {
      ...base,
      distinctValues: groups.length,
      values: cap(groups, ([value, rows]) => ({ value, count: rows.length })),
    };
  }

  const numbers = entries.flatMap((e) => (e.num === null ? [] : [e.num]));
  if (numbers.length === 0) {
    throw new Error(
      `No numeric values found for property "${property}". Try op "group-by".`
    );
  }

  const sum = numbers.reduce((a, b) => a + b, 0);
  const value =
    op === "sum" ? sum
    : op === "avg" ? sum / numbers.length
    : op === "min" ? Math.min(...numbers)
    : Math.max(...numbers);

  return {
    ...base,
    numericValues: numbers.length,
    nonNumericValues: entries.length - numbers.length,
    value: round(value, 4),
  };
}

export const getPropertiesTool: ToolSpec = {
  name: "get-properties",
  description:
    "Read or aggregate BIM/CAD properties. Without `aggregate`, returns per-object " +
    "values. With `aggregate`, returns statistics only — never raw rows — so it " +
    "scales to the whole model: 'sum' | 'avg' | 'min' | 'max' | 'group-by'. " +
    "'group-by' plus the `missingProperty` count answers questions like 'how many " +
    "doors have no fire rating set'. Numbers are parsed from display values, and " +
    "values that are not plainly numeric are counted in `nonNumericValues` rather " +
    "than guessed at — check `units` before quoting a number, and treat more than " +
    "one entry there as mixed units. If dbIds is omitted, the current selection is " +
    "used, and if nothing is selected, the whole model.",
  inputSchema: {
    type: "object",
    properties: {
      dbIds: numberArray("Objects to inspect. Omit to use the current selection."),
      propertyNames: {
        type: "array",
        items: { type: "string" },
        description: "Property names to return. Omit for a curated default set.",
      },
      aggregate: {
        type: "object",
        properties: {
          property: { type: "string", description: "Property to aggregate." },
          op: { type: "string", enum: ["sum", "avg", "min", "max", "group-by"] },
        },
        required: ["property", "op"],
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  run: (args) => getProperties(args),
};
