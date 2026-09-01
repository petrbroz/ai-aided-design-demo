import type { ToolSpec } from "../webmcp.js";
import { numberArray } from "../webmcp.js";
import type { LegendEntry } from "../viewer.js";
import {
  allLeafDbIds,
  applyTheming,
  bulkProperties,
  clearTheming,
  matchProperty,
} from "../viewer.js";
import { isBlank } from "../utils.js";

/** Max distinct buckets when colouring by property; the rest roll into "other". */
const MAX_COLOR_BUCKETS = 12;

const PALETTE = [
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948",
  "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC", "#86BCB6", "#D37295",
];

interface ColorGroup {
  dbIds: number[];
  color: string;
  label?: string;
}

interface ColorElementsInput {
  groups?: ColorGroup[];
  byProperty?: string;
  clear?: boolean;
}

const totalColored = (legend: LegendEntry[]) => legend.reduce((sum, e) => sum + e.count, 0);

function paint(groups: Array<{ label: string; color: string; dbIds: number[] }>) {
  const legend = applyTheming(groups);
  console.log(`color-elements: ${legend.length} groups`);
  return legend;
}

async function colorElements(input: ColorElementsInput) {
  if (input.clear) {
    clearTheming();
    console.log("color-elements: cleared");
    return { cleared: true, legend: [], colored: 0, uncolored: 0 };
  }

  if (input.groups && input.groups.length > 0) {
    const legend = paint(
      input.groups.map((group, i) => ({
        label: group.label ?? `Group ${i + 1}`,
        color: group.color,
        dbIds: group.dbIds,
      }))
    );
    return { mode: "explicit", legend, colored: totalColored(legend), uncolored: 0 };
  }

  const property = input.byProperty;
  if (!property) {
    return { error: "Provide either `groups`, `byProperty`, or `clear: true`." };
  }

  const dbIds = allLeafDbIds(); // the description promises every object, so ignore selection
  const results = await bulkProperties(dbIds, [property]);

  const buckets = new Map<string, number[]>();
  let uncolored = dbIds.length - results.length;
  for (const r of results) {
    const prop = matchProperty(r.properties, property);
    if (!prop || isBlank(prop.displayValue)) {
      uncolored++;
      continue;
    }
    const key = String(prop.displayValue);
    const list = buckets.get(key);
    if (list) list.push(r.dbId);
    else buckets.set(key, [r.dbId]);
  }

  if (buckets.size === 0) {
    return { error: `No objects carry property "${property}".` };
  }

  const sorted = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
  const head = sorted.slice(0, MAX_COLOR_BUCKETS - 1);
  const tail = sorted.slice(MAX_COLOR_BUCKETS - 1);
  const groups = head.map(([label, ids]) => ({ label, dbIds: ids }));
  if (tail.length > 0) {
    groups.push({
      label: `other (${tail.length} values)`,
      dbIds: tail.flatMap(([, ids]) => ids),
    });
  }

  const legend = paint(
    groups.map((group, i) => ({ ...group, color: PALETTE[i % PALETTE.length] }))
  );

  return {
    mode: "byProperty",
    property,
    distinctValues: sorted.length,
    buckets: legend.length,
    legend,
    colored: totalColored(legend),
    uncolored,
  };
}

export const colorElementsTool: ToolSpec = {
  name: "color-elements",
  description:
    "Colour-code the model in the viewport and return a matching legend. " +
    "Either pass explicit `groups` of dbIds with #RRGGBB colours, or `byProperty` to " +
    `bucket every object by a property's distinct values (max ${MAX_COLOR_BUCKETS} buckets, the rest ` +
    "roll into 'other'). `clear: true` removes all theming. Returns the legend with " +
    "per-bucket counts so the colours on screen can be described in words.",
  inputSchema: {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dbIds: numberArray("Objects in this group."),
            color: { type: "string", description: "#RRGGBB" },
            label: { type: "string", description: "Legend label." },
          },
          required: ["dbIds", "color"],
          additionalProperties: false,
        },
      },
      byProperty: {
        type: "string",
        description: "Property to bucket by, e.g. 'Category' or 'Level'.",
      },
      clear: { type: "boolean", description: "Remove all theming colours." },
    },
    additionalProperties: false,
  },
  run: (args) => colorElements(args),
};
