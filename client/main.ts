import { getSelection, initViewer, loadModel, nodeName, readCamera, selectAndFocus } from "./viewer.js";
import { isWebMcpAvailable, registerTools, unregisterTools } from "./webmcp.js";
import { TOOLS } from "./tools/index.js";
import { initPanel, setBusy, setStatus } from "./panel.js";
import type { ModelListing } from "./panel.js";
import * as issues from "./issues.js";
import { json } from "./utils.js";

const NO_WEBMCP = "WebMCP not available — the app still works manually.";

const viewerHost = document.getElementById("viewer") as HTMLDivElement;

/** Swap the loaded design, locked while the swap is in flight. */
async function switchDesign(listing: ModelListing): Promise<void> {
  setBusy(true);
  setStatus(`Loading ${listing.name}…`);
  // The previous model's tool surface must die before the new one loads.
  unregisterTools();
  try {
    await loadModel(listing.urn, listing.name);
    issues.setUrn(listing.urn);
    await issues.refreshIssues();

    const names = await registerTools(TOOLS);
    console.log(names.length > 0 ? `Registered ${names.length} WebMCP tools` : NO_WEBMCP);
    setStatus(names.length > 0 ? `${names.length} agent tools ready` : NO_WEBMCP, names.length > 0 ? "info" : "warn");
  } catch (err) {
    const message = (err as Error).message;
    console.error(`Could not load ${listing.name}: ${message}`);
    setStatus(`Could not load ${listing.name}: ${message}`, "error");
  } finally {
    setBusy(false);
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

/** The manual equivalents of what draft-issue captures automatically. */
function useSelection(): void {
  const [dbId] = getSelection();
  if (dbId === undefined) {
    setStatus("Select an element in the model first.", "warn");
    return;
  }
  issues.patchDraft({ element: { dbId, name: nodeName(dbId) } });
  setStatus("");
}

function captureViewpoint(): void {
  issues.patchDraft({ camera: readCamera() });
  setStatus("");
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
    const message = (err as Error).message;
    console.error(`Could not list models: ${message}`);
    setStatus(`Could not list models: ${message}`, "error");
    return;
  }
  if (models.length === 0) {
    const message = "No models in the configured APS bucket. Upload a Revit model and reload.";
    console.error(message);
    setStatus(message, "error");
    return;
  }

  try {
    await initViewer(viewerHost);
  } catch (err) {
    const message = (err as Error).message;
    console.error(message);
    setStatus(message, "error");
    return;
  }

  const selected = pickModelIndex(models);
  initPanel({
    models,
    selected,
    onSwitchModel: (model) => void switchDesign(model),
    onFocusIssue: (issue) => {
      if (!issue.camera) return;
      selectAndFocus(issue.camera, issue.element ? [issue.element.dbId] : []);
    },
    onUseSelection: useSelection,
    onCaptureViewpoint: captureViewpoint,
  });

  await switchDesign(models[selected]!);
}

void main();
