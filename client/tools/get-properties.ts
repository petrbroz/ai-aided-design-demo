import type { ToolSpec } from "../webmcp.js";
import { numberArray } from "../webmcp.js";
import { bulkProperties, matchProperty, nodeName, resolveDbIds } from "../viewer.js";
import { cap, isBlank, MAX_ITEMS, mostCommon, round, toNumber } from "../utils.js";

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
  if (dbIds.length === 0) return { error: "No objects to inspect." };

  if (input.aggregate) {
    return aggregateProperties(dbIds, source, input.aggregate);
  }

  const propFilter = input.propertyNames ?? DEFAULT_PROPERTY_NAMES;
  const subject = dbIds.slice(0, MAX_ITEMS);
  const results = await bulkProperties(subject, propFilter);

  const items = results.map((r) => ({
    dbId: r.dbId,
    name: r.name ?? nodeName(r.dbId),
    properties: r.properties.map((p) => ({
      name: p.displayName ?? p.attributeName ?? "(unnamed)",
      displayValue: p.displayValue ?? null,
      units: p.units ?? null,
    })),
  }));

  return {
    mode: dbIds.length <= 20 ? "detail" : "detail-capped",
    dbIdSource: source,
    propertyFilter: propFilter,
    total: dbIds.length,
    returned: items.length,
    truncated: dbIds.length > items.length,
    items,
  };
}

async function aggregateProperties(
  dbIds: number[],
  source: string,
  aggregate: { property: string; op: AggregateOp }
) {
  const { property, op } = aggregate;
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
    objects: dbIds.length,
    withProperty: entries.length,
    missingProperty: dbIds.length - entries.length,
    units: mostCommon(unitStrings),
  };

  if (op === "group-by") {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const key = String(e.raw);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return {
      ...base,
      distinctValues: sorted.length,
      ...cap(sorted, ([value, count]) => ({ value, count })),
    };
  }

  const numbers = entries.map((e) => e.num).filter((n): n is number => n !== null);
  if (numbers.length === 0) {
    return {
      ...base,
      error: `No numeric values found for property "${property}". Try op "group-by".`,
    };
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
    "Inspect or aggregate BIM/CAD properties. Detail mode returns per-object property " +
    "maps (with units where the property database provides them). Aggregate mode " +
    "returns summary statistics only — never raw rows — so it scales to the whole " +
    "model: op 'sum' | 'avg' | 'min' | 'max' | 'group-by'. Every aggregate response " +
    "also reports `withProperty` and `missingProperty` counts. 'group-by' returns " +
    "value counts, which is how to answer questions like 'how many doors have no " +
    "fire rating set' (missingProperty). If dbIds is omitted, the current selection " +
    "is used, and if nothing is selected, the whole model. Numeric aggregations parse " +
    "the property's display value, so check the reported `units` before quoting a number.",
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
