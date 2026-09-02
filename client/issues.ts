import { emptyDraft, validateDraft } from "../shared/issues.js";
import type { Issue, IssueDraft } from "../shared/issues.js";
import { json } from "./utils.js";

let urn: string | null = null;
let draft: IssueDraft = emptyDraft();
let cached: Issue[] = [];
const listeners = new Set<() => void>();

export function onChange(cb: () => void): void {
  listeners.add(cb);
}

function changed(): void {
  for (const cb of listeners) cb();
}

/* ------------------------------------------------------------------------ the draft */

export function getDraft(): IssueDraft {
  return draft;
}

/** Fields absent from `patch` keep their current value. */
export function patchDraft(patch: Partial<IssueDraft>): IssueDraft {
  draft = { ...draft, ...patch };
  changed();
  return draft;
}

export function resetDraft(): IssueDraft {
  draft = emptyDraft();
  changed();
  return draft;
}

export function draftGaps(): string[] {
  return validateDraft(draft);
}

/* ------------------------------------------------------------------------- the list */

export function getIssues(): Issue[] {
  return cached;
}

export function findIssue(id: string): Issue | undefined {
  const needle = id.trim().toLowerCase();
  return cached.find((issue) => issue.id.toLowerCase() === needle);
}

export function getUrn(): string | null {
  return urn;
}

/** Clears the draft too: its dbId and camera belong to the model that just went away. */
export function setUrn(next: string): void {
  if (next === urn) return;
  urn = next;
  cached = [];
  draft = emptyDraft();
  changed();
}

export async function refreshIssues(): Promise<Issue[]> {
  if (!urn) return [];
  cached = await json<Issue[]>(`/api/issues?urn=${encodeURIComponent(urn)}`);
  changed();
  return cached;
}

export async function submitDraft(): Promise<Issue> {
  if (!urn) throw new Error("No design is loaded, so there is nothing to raise an issue against.");

  const missing = validateDraft(draft);
  if (missing.length > 0) {
    throw new Error(`The draft is incomplete — still missing: ${missing.join(", ")}.`);
  }

  const res = await fetch("/api/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urn, draft }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Submitting the issue failed (${res.status}).`);
  }

  const issue = (await res.json()) as Issue;
  draft = emptyDraft();
  await refreshIssues();
  return issue;
}
