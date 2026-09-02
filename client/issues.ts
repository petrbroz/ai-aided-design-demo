import { emptyDraft, validateDraft } from "./issue-schema.js";
import type { Issue, IssueDraft } from "./issue-schema.js";
import * as store from "./issue-store.js";

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
  cached = await store.listIssues(urn);
  changed();
  return cached;
}

/**
 * The validation here is not a duplicate of the store's — the store has none. Nothing
 * downstream of this function will refuse a malformed issue, because there is no longer
 * anything downstream: this is the last check before the record is written.
 */
export async function submitDraft(): Promise<Issue> {
  if (!urn) throw new Error("No design is loaded, so there is nothing to raise an issue against.");

  const missing = validateDraft(draft);
  if (missing.length > 0) {
    throw new Error(`The draft is incomplete — still missing: ${missing.join(", ")}.`);
  }

  const issue = await store.createIssue(urn, draft);
  draft = emptyDraft();
  await refreshIssues();
  return issue;
}
