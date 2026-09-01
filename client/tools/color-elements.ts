import type { ToolSpec } from "../webmcp.js";
import { numberArray } from "../webmcp.js";
import type { BulkResult, LegendEntry } from "../viewer.js";
import {
  allLeafDbIds,
  applyTheming,
  bulkProperties,
  clearTheming,
  matchProperty,
} from "../viewer.js";
import { groupBy, isBlank } from "../utils.js";

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

async function colorElements(input: ColorElementsInput) {
  if (input.clear) {
    clearTheming();
    return { cleared: true, legend: [], colored: 0, uncolored: 0 };
  }

  if (input.groups && input.groups.length > 0) {
    const legend = applyTheming(
      input.groups.map((group, i) => ({
        label: group.label ?? `Group ${i + 1}`,
        color: group.color,
        dbIds: group.dbIds,
      }))
    );
    return { mode: "explicit", legend, colored: totalColored(legend), uncolored: 0 };
  }

  const property = input.byProperty;
  if (!property) throw new Error("Provide either `groups`, `byProperty`, or `clear: true`.");

  const dbIds = allLeafDbIds(); // the description promises every object, so ignore selection
  const results = await bulkProperties(dbIds, [property]);

  const valueOf = (r: BulkResult) => {
    const prop = matchProperty(r.properties, property);
    return !prop || isBlank(prop.displayValue) ? null : String(prop.displayValue);
  };
  const withValue = results.filter((r) => valueOf(r) !== null);
  const uncolored = dbIds.length - withValue.length;

  const sorted = groupBy(withValue, (r) => valueOf(r)!);
  if (sorted.length === 0) throw new Error(`No objects carry property "${property}".`);

  // Only collapse into "other" when there is actually something to collapse — slicing
  // unconditionally would push a single value into "other" at exactly the limit.
  const buckets =
    sorted.length <= MAX_COLOR_BUCKETS
      ? sorted.map(([label, rows]) => ({ label, dbIds: rows.map((r) => r.dbId) }))
      : [
          ...sorted.slice(0, MAX_COLOR_BUCKETS - 1).map(([label, rows]) => ({
            label,
            dbIds: rows.map((r) => r.dbId),
          })),
          {
            label: `other (${sorted.length - MAX_COLOR_BUCKETS + 1} values)`,
            dbIds: sorted.slice(MAX_COLOR_BUCKETS - 1).flatMap(([, rows]) => rows.map((r) => r.dbId)),
          },
        ];

  const legend = applyTheming(
    buckets.map((bucket, i) => ({ ...bucket, color: PALETTE[i % PALETTE.length] }))
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
    "Colour-code the model in the viewport and return a matching legend. Pass either " +
    "explicit `groups` of dbIds with #RRGGBB colours, or `byProperty` to bucket every " +
    `object by a property's distinct values (max ${MAX_COLOR_BUCKETS}, the rest roll into 'other'). ` +
    "`clear: true` removes all theming. The legend's per-bucket counts are how the " +
    "colours on screen get described in words.",
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
