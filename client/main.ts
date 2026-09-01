/**
 * The entrypoint: fetch the design listing, bring up the viewer, and keep the WebMCP
 * tool surface in sync with whatever model is on screen.
 *
 * The page is the viewer and nothing else. The only DOM outside it is the design
 * picker in the top-left corner; any future UI belongs in the viewer's own
 * extension/toolbar surface. Nothing is ever reported on screen — failures go to
 * `console.error` only.
 */

import { initViewer, loadModel } from "./viewer.js";
import { isWebMcpAvailable, registerTools, unregisterTools } from "./webmcp.js";
import { TOOLS } from "./tools/index.js";
import { json } from "./utils.js";

interface ModelListing {
  name: string;
  urn: string;
}

const NO_WEBMCP = "WebMCP not available — the app still works manually.";

const viewerHost = document.getElementById("viewer") as HTMLDivElement;
const designsEl = document.getElementById("designs") as HTMLSelectElement;

/** The picker's only job: swap the loaded design, locked while the swap is in flight. */
async function switchDesign(listing: ModelListing): Promise<void> {
  designsEl.disabled = true;
  // The previous model's tool surface must die before the new one loads.
  unregisterTools();
  try {
    await loadModel(listing.urn, listing.name);
    console.log(`Loaded ${listing.name}`);
    const names = await registerTools(TOOLS);
    console.log(names.length > 0 ? `Registered ${names.length} WebMCP tools` : NO_WEBMCP);
  } catch (err) {
    console.error(`Could not load ${listing.name}: ${(err as Error).message}`);
  } finally {
    designsEl.disabled = false;
  }
}

/** `?model=<name substring>` picks which design the picker starts on. */
function pickModelIndex(models: ModelListing[]): number {
  const wanted = new URLSearchParams(location.search).get("model");
  if (!wanted) return 0;
  const needle = wanted.toLowerCase();
  const found = models.findIndex((m) => m.name.toLowerCase().includes(needle));
  return found === -1 ? 0 : found;
}

/** Index, not urn, is the option value — the listing order is the only identity we need. */
function buildDesignPicker(models: ModelListing[], selected: number): void {
  designsEl.replaceChildren(
    ...models.map((model, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = model.name;
      return option;
    })
  );
  designsEl.value = String(selected);
  designsEl.hidden = false;
  designsEl.addEventListener("change", () => {
    void switchDesign(models[Number(designsEl.value)]);
  });
}

async function main(): Promise<void> {
  if (!isWebMcpAvailable()) {
    console.log(`${NO_WEBMCP} Open in the ChatGPT in-app browser, or Chrome with the WebMCP flag enabled.`);
  }
  if (!window.isSecureContext) {
    console.log("Insecure context — WebMCP requires https:// or http://localhost.");
  }

  let models: ModelListing[];
  try {
    models = await json<ModelListing[]>("/api/models");
  } catch (err) {
    console.error(`Could not list models: ${(err as Error).message}`);
    return;
  }
  if (models.length === 0) {
    console.error("No objects in the configured APS bucket. Upload a model and reload.");
    return;
  }

  try {
    await initViewer(viewerHost);
  } catch (err) {
    console.error((err as Error).message);
    return;
  }

  // The picker only appears once there is a live viewer to switch designs in.
  const selected = pickModelIndex(models);
  buildDesignPicker(models, selected);
  await switchDesign(models[selected]);
}

void main();
