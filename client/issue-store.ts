import { CURRENT_USER, normalizeViewpoint } from "./issue-schema.js";
import type { Issue, IssueDraft } from "./issue-schema.js";

const DB_NAME = "bim-design-review";
const DB_VERSION = 1;
const STORE = "issues";
const BY_URN = "by-urn";

/**
 * The same bound the server store had, and it matters more here: this data outlives the
 * process. Without a cap, a browser that has demoed twenty times keeps every issue from
 * all twenty, each carrying uncapped dbId arrays. Oldest go first, across all designs.
 */
const MAX_ISSUES = 200;

let dbPromise: Promise<IDBDatabase> | null = null;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("An IndexedDB request failed."));
  });
}

/**
 * Opened once, lazily. The messages say "the issue database" rather than "IndexedDB"
 * because they surface through the design-loading path: a private window or blocked site
 * data are the realistic causes, and either one means this review cannot record anything.
 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("This browser has no IndexedDB, so issues cannot be stored."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // No keyPath: the key sits beside the record rather than inside it, so `Issue`
        // stays exactly what the form and the tools deal in, with no storage field
        // leaking into the shape the agent reads back.
        db.createObjectStore(STORE).createIndex(BY_URN, "urn");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(`The issue database could not be opened: ${request.error?.message ?? "unknown error"}.`));
    request.onblocked = () =>
      reject(new Error("The issue database is blocked by another tab of this app. Close it and reload."));
  });

  // A failed open must not be cached as a permanent verdict: the next attempt may come
  // after the user has allowed site data for the origin.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

/**
 * Both operations below chain IndexedDB requests within a single transaction and await
 * nothing else, which is the rule that makes them safe: a transaction survives `await`
 * only while the next request is issued from the same task, so one unrelated await
 * between two requests kills it with `TransactionInactiveError`.
 */
async function objectStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * Newest first, the order the panel and `list-issues` both present. Viewpoints are
 * normalized here because this is the boundary where records written by an older version
 * of the app come back: past this point there is one viewpoint format.
 */
export async function listIssues(urn: string): Promise<Issue[]> {
  const store = await objectStore("readonly");
  const issues = await promisify(store.index(BY_URN).getAll(urn) as IDBRequest<Issue[]>);
  return issues.reverse().map((issue) => ({ ...issue, viewpoint: normalizeViewpoint(issue.viewpoint) }));
}

/** Deletes the oldest records until `MAX_ISSUES` remain. Runs inside the caller's transaction. */
function trim(store: IDBObjectStore, excess: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let remaining = excess;
    const request = store.openCursor(null, "next");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || remaining <= 0) {
        resolve();
        return;
      }
      cursor.delete();
      remaining--;
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Trimming stored issues failed."));
  });
}

/**
 * Assigns the id, status and authorship the server used to, then stores and returns the
 * issue. Sequence numbers come from the largest existing key rather than from a counter
 * or from the record count, so ids stay unique across reloads *and* across trimming —
 * a counter resets when the tab does, and a count reuses the number of a deleted issue.
 */
export async function createIssue(urn: string, draft: IssueDraft): Promise<Issue> {
  const store = await objectStore("readwrite");

  const last = await promisify(store.openKeyCursor(null, "prev"));
  const seq = last ? Number(last.key) + 1 : 1;

  const issue: Issue = {
    ...draft,
    id: `ISS-${seq}`,
    urn,
    status: "open",
    createdAt: new Date().toISOString(),
    createdBy: CURRENT_USER,
  };

  await promisify(store.add(issue, seq));

  const count = await promisify(store.count());
  if (count > MAX_ISSUES) await trim(store, count - MAX_ISSUES);

  return issue;
}
