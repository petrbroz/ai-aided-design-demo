import { ASSIGNEES, ISSUE_TYPES, SEVERITIES } from "../shared/issues.js";
import type { Issue } from "../shared/issues.js";
import * as issues from "./issues.js";
import { round } from "./utils.js";

export interface ModelListing {
  name: string;
  urn: string;
}

export interface PanelHooks {
  models: ModelListing[];
  selected: number;
  onSwitchModel: (model: ModelListing) => void;
  onFocusIssue: (issue: Issue) => void;
  onUseSelection: () => void;
  onCaptureViewpoint: () => void;
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusEl = el<HTMLSpanElement>("status");
const designsEl = el<HTMLSelectElement>("designs");
const panelEl = el<HTMLElement>("panel");

const listEl = el<HTMLUListElement>("issue-list");
const countEl = el<HTMLSpanElement>("issue-count");
const emptyEl = el<HTMLParagraphElement>("issue-empty");

const titleEl = el<HTMLInputElement>("f-title");
const descriptionEl = el<HTMLTextAreaElement>("f-description");
const typeEl = el<HTMLSelectElement>("f-type");
const severityEl = el<HTMLSelectElement>("f-severity");
const assigneeEl = el<HTMLSelectElement>("f-assignee");
const dueEl = el<HTMLInputElement>("f-due");

const elementChip = el<HTMLSpanElement>("chip-element");
const cameraChip = el<HTMLSpanElement>("chip-camera");
const shotEl = el<HTMLImageElement>("draft-shot");
const msgEl = el<HTMLParagraphElement>("draft-msg");
const submitEl = el<HTMLButtonElement>("btn-submit");

/* ------------------------------------------------------------------------- header */

export function setStatus(text: string, kind: "info" | "warn" | "error" = "info"): void {
  statusEl.textContent = text;
  statusEl.className = kind === "info" ? "" : kind;
}

/** Inert while a design loads. */
export function setBusy(busy: boolean): void {
  panelEl.setAttribute("aria-busy", String(busy));
}

/* ------------------------------------------------------------------- the issue list */

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function issueRow(issue: Issue, onFocusIssue: (issue: Issue) => void): HTMLLIElement {
  const row = document.createElement("li");
  row.tabIndex = 0;
  row.title = issue.description || issue.title;

  const dot = document.createElement("span");
  dot.className = `dot ${issue.severity}`;

  const body = document.createElement("span");
  body.className = "body";

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = issue.title;

  const meta = document.createElement("span");
  meta.className = "meta";
  const who = issue.assignedTo === "Unassigned" ? "unassigned" : issue.assignedTo.split(" — ")[0];
  meta.textContent = [
    issue.id,
    issue.type,
    who,
    relativeTime(issue.createdAt),
    issue.element ? issue.element.name : null,
  ]
    .filter(Boolean)
    .join(" · ");

  body.append(title, meta);
  row.append(dot, body);

  const focus = () => onFocusIssue(issue);
  row.addEventListener("click", focus);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focus();
    }
  });
  return row;
}

function renderIssues(onFocusIssue: (issue: Issue) => void): void {
  const all = issues.getIssues();
  countEl.textContent = String(all.length);
  emptyEl.hidden = all.length > 0;
  listEl.replaceChildren(...all.map((issue) => issueRow(issue, onFocusIssue)));
}

/* ------------------------------------------------------------------------ the draft */

function fillSelect(select: HTMLSelectElement, values: readonly string[]): void {
  select.replaceChildren(
    ...values.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      return option;
    })
  );
}

/** Assign only on a real change, or every keystroke sends the caret to the end. */
function setValue(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  if (field.value !== value) field.value = value;
}

function setChip(chip: HTMLSpanElement, text: string | null): void {
  chip.textContent = text ?? "Nothing captured";
  chip.classList.toggle("empty", text === null);
}

function renderDraft(): void {
  const draft = issues.getDraft();

  setValue(titleEl, draft.title);
  setValue(descriptionEl, draft.description);
  setValue(typeEl, draft.type);
  setValue(severityEl, draft.severity);
  setValue(assigneeEl, draft.assignedTo);
  setValue(dueEl, draft.dueDate);

  setChip(elementChip, draft.element ? `#${draft.element.dbId} — ${draft.element.name}` : null);
  setChip(
    cameraChip,
    draft.camera ? `eye ${draft.camera.position.map((n) => round(n, 1)).join(", ")}` : null
  );

  shotEl.hidden = draft.screenshotUrl === "";
  if (draft.screenshotUrl !== "") shotEl.src = draft.screenshotUrl;

  // Only worth naming once someone has started; on a pristine form they read as errors.
  const gaps = issues.draftGaps();
  const started = draft.title !== "" || draft.description !== "" || draft.element !== null || draft.camera !== null;
  msgEl.hidden = gaps.length === 0 || !started;
  msgEl.textContent = `Still needed: ${gaps.join(", ")}.`;
  submitEl.disabled = gaps.length > 0;
}

/* -------------------------------------------------------------------------- wiring */

export function initPanel(hooks: PanelHooks): void {
  fillSelect(typeEl, ISSUE_TYPES);
  fillSelect(severityEl, SEVERITIES);
  fillSelect(assigneeEl, ASSIGNEES);

  designsEl.replaceChildren(
    ...hooks.models.map((model, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = model.name;
      return option;
    })
  );
  designsEl.value = String(hooks.selected);
  designsEl.addEventListener("change", () => {
    hooks.onSwitchModel(hooks.models[Number(designsEl.value)]!);
  });

  // Straight through to the draft: no "unsaved form" state for a tool call to disagree with.
  titleEl.addEventListener("input", () => issues.patchDraft({ title: titleEl.value }));
  descriptionEl.addEventListener("input", () => issues.patchDraft({ description: descriptionEl.value }));
  typeEl.addEventListener("change", () => issues.patchDraft({ type: typeEl.value }));
  severityEl.addEventListener("change", () => issues.patchDraft({ severity: severityEl.value }));
  assigneeEl.addEventListener("change", () => issues.patchDraft({ assignedTo: assigneeEl.value }));
  dueEl.addEventListener("change", () => issues.patchDraft({ dueDate: dueEl.value }));

  el<HTMLButtonElement>("btn-use-selection").addEventListener("click", hooks.onUseSelection);
  el<HTMLButtonElement>("btn-capture-view").addEventListener("click", hooks.onCaptureViewpoint);
  el<HTMLButtonElement>("btn-clear").addEventListener("click", () => issues.resetDraft());

  submitEl.addEventListener("click", () => {
    void (async () => {
      submitEl.disabled = true;
      try {
        const issue = await issues.submitDraft();
        setStatus(`Raised ${issue.id}.`);
      } catch (err) {
        setStatus((err as Error).message, "error");
      } finally {
        renderDraft();
      }
    })();
  });

  issues.onChange(() => {
    renderDraft();
    renderIssues(hooks.onFocusIssue);
  });

  renderDraft();
  renderIssues(hooks.onFocusIssue);
}
