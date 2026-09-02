import type { ToolSpec } from "../webmcp.js";
import { numberArray } from "../webmcp.js";
import type { ThemingGroup } from "../issue-schema.js";
import { applyTheming, clearTheming, readViewState } from "../viewer.js";
import { clamp } from "../utils.js";

// One `setThemingColor` write per object, so this bounds the browser's work rather than
// the reply's size — which is why it is nowhere near MAX_ITEMS. An agent that wants more
// than this wants a node from browse-hierarchy instead: painting is recursive, so a
// category or type node stands in for every instance under it at a cost of one id.
const MAX_OBJECTS = 10_000;

// Solid. A lower blend keeps more of the original material, which reads as a tint.
const DEFAULT_INTENSITY = 1;

interface SetThemingColorInput {
  groups?: Array<{ color: string; dbIds: number[] }>;
  intensity?: number;
  keepExisting?: boolean;
  clear?: boolean;
}

function setThemingColor(input: SetThemingColorInput) {
  if (input.clear === true) {
    clearTheming();
    return { cleared: true, ...readViewState() };
  }

  const groups = input.groups ?? [];
  if (groups.length === 0) {
    throw new Error("Pass `groups` with at least one colour, or `clear: true` to remove the colour-coding.");
  }

  const requestedObjects = groups.reduce((n, group) => n + group.dbIds.length, 0);
  if (requestedObjects === 0) throw new Error("Every group was empty — there is nothing to colour.");
  if (requestedObjects > MAX_OBJECTS) {
    throw new Error(
      `${requestedObjects} objects is over the ${MAX_OBJECTS} limit. Colouring is recursive, so pass the ` +
        "category, family or type node from browse-hierarchy instead of enumerating its instances."
    );
  }

  const intensity = clamp(input.intensity ?? DEFAULT_INTENSITY, 0, 1);
  const themed: ThemingGroup[] = groups.map((group) => ({ ...group, intensity }));

  // Colours are validated inside applyTheming, all of them before any is painted.
  applyTheming(themed, input.keepExisting === true);

  // `theming.objects` in the view state below is what actually stuck. It falls short of
  // `requestedObjects` exactly when groups overlapped, and the agent needs to know that
  // before reading a legend out loud.
  return { cleared: false, requestedObjects, keepExisting: input.keepExisting === true, ...readViewState() };
}

export const setThemingColorTool: ToolSpec = {
  name: "set-theming-color",
  description:
    "Colour-code objects: paint each group of dbIds in a colour you choose, turning a " +
    "property into something visible across the whole model at once. 'Show me all the " +
    "rooms and colour-code them by type' is browse-hierarchy or get-properties to sort " +
    "the ids into buckets, then one call here with a colour per bucket. There is no " +
    "built-in palette on purpose — you pick the colours, so you must also tell the user " +
    "what each one means: the screen shows the colours and only you hold the legend. " +
    "Painting is recursive, so a category, family or type node colours every instance " +
    "beneath it and 5,000 doors can be one dbId. Later groups win where they overlap. " +
    "Replaces the current colour-coding unless `keepExisting`; `clear: true` removes it. " +
    "This tints materials and nothing else — it cannot reveal a hidden object, so if the " +
    "user says they see nothing, check `isolated` and `hidden` in the returned view " +
    "state. Returns that view state, whose `theming` field is the legend as it stands.",
  inputSchema: {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            color: {
              type: "string",
              description: 'Hex colour you choose, "#rrggbb" or "#rgb" — e.g. "#3b82f6".',
            },
            dbIds: numberArray(
              "Objects to paint. A category, family or type node paints everything under it."
            ),
          },
          required: ["color", "dbIds"],
          additionalProperties: false,
        },
        description: `One entry per colour, at most ${MAX_OBJECTS} objects across all of them.`,
      },
      intensity: {
        type: "number",
        description: "0..1 blend with the original material. Default 1 (solid); lower reads as a tint.",
      },
      keepExisting: {
        type: "boolean",
        description: "Add to the current colour-coding instead of replacing it.",
      },
      clear: { type: "boolean", description: "Remove all theming colours." },
    },
    additionalProperties: false,
  },
  run: (args) => setThemingColor(args),
};
