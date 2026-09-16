/**
 * Persistence for recently-opened documents.
 *
 * Documents are stored as a flat JSON array under a single key. Heavy binary
 * data (images, PDFs) are moved into IndexedDB (`mediaStore`) with lightweight
 * `asset:<id>` references, ensuring localStorage never hits the ~5MB quota.
 */

import { saveMediaDataUrl, newAssetId, deleteMedia, isAssetRef } from './mediaStore';

export interface StoredDocument {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
  template?: string;
  createdAt?: number;
  page?: 'A4' | 'Letter';
  /**
   * Text boxes (frames) on the page, serialized as JSON. Absent for legacy
   * documents whose whole page is one flat HTML blob (migrated on open).
   */
  boxes?: string;
  /** Show the end-of-document tombstone (small black square, last page).
      @deprecated the marker is a frame on the last sheet now; kept so saved
      documents from older builds still open. */
  tombstone?: boolean;
  /** Per-page names, serialized as a JSON array (index = page number - 1). */
  pageNames?: string;
  /** The master page (header/footer furniture), serialized as JSON. */
  master?: string;
  /** @deprecated pre-master-page header text (tokens: @page @month @year).
      Read once and migrated into `master`; kept so old files still open. */
  masterHeader?: string;
  /** @deprecated pre-master-page footer text (tokens: @page @month @year). */
  masterFooter?: string;
}

const KEY = 'bulletin.recentDocs';
const MAX = 16;

const isDoc = (value: unknown): value is StoredDocument => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredDocument>;
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.content === 'string' &&
    typeof v.updatedAt === 'number'
  );
};

/** Asset ids whose blob is confirmed to be in IndexedDB. */
const confirmedAssets = new Set<string>();
/** Data URL -> asset id for a write that is still in flight, so two saves of
    the same picture reuse one blob instead of storing it twice. */
const inFlight = new Map<string, string>();

/**
 * Move embedded data URLs (images, PDF pages) out of a document and into
 * IndexedDB, replacing each `src` with a lightweight asset reference.
 *
 * The `src` is only swapped once the blob is *actually* in IndexedDB.
 * Swapping it while the write was still in flight was a way to lose pictures:
 * saving a document and reloading inside that window left it pointing at an
 * asset that did not exist yet, with no copy of the payload anywhere. So when
 * `awaitWrites` is false the data URL is left in place for this save and
 * swapped on a later one; the autosave path awaits the writes and swaps
 * immediately.
 */
async function offloadBoxes(
  boxesJson: string | undefined,
  awaitWrites: boolean,
): Promise<string | undefined> {
  if (!boxesJson || !boxesJson.includes('data:')) return boxesJson;
  try {
    const list = JSON.parse(boxesJson);
    if (!Array.isArray(list)) return boxesJson;
    let modified = false;
    for (const b of list) {
      const src = b?.src;
      if (typeof src !== 'string' || !src.startsWith('data:')) continue;
      let id = inFlight.get(src);
      if (!id) {
        id = newAssetId(b.kind === 'pdf' ? 'pdf' : 'img');
        inFlight.set(src, id);
      }
      if (!confirmedAssets.has(id)) {
        const write = saveMediaDataUrl(id, src)
          .then(() => {
            confirmedAssets.add(id!);
            inFlight.delete(src);
          })
          .catch(() => {
            inFlight.delete(src);
          });
        if (!awaitWrites) continue;
        await write;
      }
      if (confirmedAssets.has(id)) {
        b.src = id;
        modified = true;
      }
    }
    return modified ? JSON.stringify(list) : boxesJson;
  } catch {
    return boxesJson;
  }
}

/**
 * Offload embedded media, waiting for the writes to land first. The autosave
 * path uses this so the saved document never references an asset that is not
 * in IndexedDB yet.
 */
export async function offloadMediaForSave(boxesJson?: string): Promise<string | undefined> {
  return offloadBoxes(boxesJson, true);
}

/**
 * Best-effort, synchronous-looking offload for callers that cannot await.
 * Starts the writes and returns the document unchanged for now - the next save
 * picks the asset references up (see `offloadBoxes`).
 */
export function sanitizeBoxesForStorage(boxesJson?: string): string | undefined {
  void offloadBoxes(boxesJson, false);
  return boxesJson;
}

/**
 * Emergency last resort: replace every embedded data URL with an asset
 * reference immediately, whether or not the write has landed. Only for the
 * quota-exceeded retry, where the choice is between losing the pictures and
 * failing to save the document at all.
 */
function stripEmbeddedMedia(boxesJson?: string): string | undefined {
  if (!boxesJson || !boxesJson.includes('data:')) return boxesJson;
  try {
    const list = JSON.parse(boxesJson);
    if (!Array.isArray(list)) return boxesJson;
    for (const b of list) {
      if (typeof b?.src === 'string' && b.src.startsWith('data:')) {
        const id = inFlight.get(b.src) ?? newAssetId(b.kind === 'pdf' ? 'pdf' : 'img');
        inFlight.set(b.src, id);
        void saveMediaDataUrl(id, b.src)
          .then(() => {
            confirmedAssets.add(id);
            inFlight.delete(b.src);
          })
          // Nobody is left to report to: this only runs when the document had
          // no room to store its own pictures, so a failed write just means
          // that picture is gone. Swallow it rather than raise an unhandled
          // rejection in the middle of someone's save.
          .catch(() => {
            inFlight.delete(b.src);
          });
        b.src = id;
      }
    }
    return JSON.stringify(list);
  } catch {
    return boxesJson;
  }
}

/** Read the whole recent list, newest first. Invalid entries are dropped. */
export function loadRecentDocs(): StoredDocument[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDoc);
  } catch {
    return [];
  }
}

/** Persist the list. */
function saveDocs(docs: StoredDocument[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(docs.slice(0, MAX)));
  } catch (err) {
    console.warn('Failed to save to localStorage, attempting aggressive sanitization:', err);
    try {
      const sanitized = docs.slice(0, MAX).map((d) => ({
        ...d,
        boxes: stripEmbeddedMedia(d.boxes),
      }));
      localStorage.setItem(KEY, JSON.stringify(sanitized));
    } catch {
      /* storage full or unavailable - non-fatal */
    }
  }
}

/**
 * Upsert a document (by id), moving it to the front and stamping the
 * timestamp. Offloads heavy images to IndexedDB.
 */
export function saveDoc(doc: StoredDocument): StoredDocument[] {
  const sanitizedDoc: StoredDocument = {
    ...doc,
    boxes: sanitizeBoxesForStorage(doc.boxes),
  };
  const docs = loadRecentDocs().filter((d) => d.id !== sanitizedDoc.id);
  docs.unshift(sanitizedDoc);
  saveDocs(docs);
  return docs.slice(0, MAX);
}

/** Delete a document by id; returns the new list. */
export function deleteDoc(id: string): StoredDocument[] {
  const docs = loadRecentDocs().filter((d) => d.id !== id);
  saveDocs(docs);
  return docs.slice(0, MAX);
}

/** Every asset reference a serialized boxes string holds. */
function assetRefsOf(boxesJson?: string): string[] {
  if (!boxesJson || !boxesJson.includes(':') || !boxesJson.includes('src')) return [];
  try {
    const list = JSON.parse(boxesJson);
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const b of list) {
      const src = b?.src;
      if (typeof src === 'string' && isAssetRef(src)) out.push(src);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Delete a document *and* everything it owns: its version snapshots, and any
 * image or PDF blob in IndexedDB that nothing else refers to.
 *
 * Deleting a document used to leave its snapshots in `bulletin.docVersions`
 * and every picture it embedded in IndexedDB, forever - nothing ever called
 * the media store's `deleteMedia`, so the media database only grew. Blobs that
 * are still referenced by another document (or by another document's
 * snapshots) are kept, because pictures are shared by reference.
 */
export async function purgeDoc(id: string): Promise<StoredDocument[]> {
  const docs = loadRecentDocs();
  const victim = docs.find((d) => d.id === id);
  const versions = loadVersions();
  const ownedVersions = versions[id] ?? [];

  const remaining = docs.filter((d) => d.id !== id);
  const remainingVersions = { ...versions };
  delete remainingVersions[id];

  saveVersions(remainingVersions);
  saveDocs(remaining);

  if (!victim) return remaining.slice(0, MAX);

  const stillUsed = new Set<string>();
  for (const d of remaining) {
    for (const ref of assetRefsOf(d.boxes)) stillUsed.add(ref);
    for (const v of remainingVersions[d.id] ?? []) {
      for (const ref of assetRefsOf(v.boxes)) stillUsed.add(ref);
    }
  }

  const owned = new Set<string>([
    ...assetRefsOf(victim.boxes),
    ...ownedVersions.flatMap((v) => assetRefsOf(v.boxes)),
  ]);
  for (const ref of owned) {
    if (!stillUsed.has(ref)) await deleteMedia(ref);
  }

  return remaining.slice(0, MAX);
}

/** Rename a saved document in place (title only; nothing else changes).
    Returns the new list, or the old one when the id is unknown. */
export function renameDoc(id: string, title: string): StoredDocument[] {
  const docs = loadRecentDocs();
  const hit = docs.find((d) => d.id === id);
  if (!hit) return docs;
  hit.title = title;
  saveDocs(docs);
  return docs.slice(0, MAX);
}

/** Look up a single document by id. */
export function getDoc(id: string): StoredDocument | undefined {
  return loadRecentDocs().find((d) => d.id === id);
}

/**
 * Version history - an automatic snapshot is appended every time a document
 * is saved if it has changed enough since the previous snapshot. Capped at
 * 10 snapshots per document, oldest first.
 */

export interface DocVersion {
  at: number;
  words: number;
  content: string;
  /** Frame layout at snapshot time, so a restore brings back the geometry. */
  boxes?: string;
}

const VERSIONS_KEY = 'bulletin.docVersions';
const VERSIONS_PER_DOC = 10;
/** Minimum word growth/shrinkage before a new snapshot is worth taking. */
const VERSION_MIN_DELTA = 15;

/**
 * Read the version history back.
 *
 * Entries are validated rather than trusted: a mangled or hand-edited
 * `bulletin.docVersions` used to come back as whatever JSON happened to be on
 * disk, and `recordVersion` then called `list.push` on it - a TypeError in the
 * middle of a save. Anything that is not a list of snapshots is dropped.
 */
function loadVersions(): Record<string, DocVersion[]> {
  try {
    const raw = localStorage.getItem(VERSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, DocVersion[]> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const list = value.filter(
        (v): v is DocVersion =>
          !!v &&
          typeof v === 'object' &&
          typeof (v as DocVersion).content === 'string' &&
          typeof (v as DocVersion).words === 'number' &&
          typeof (v as DocVersion).at === 'number',
      );
      if (list.length) out[id] = list;
    }
    return out;
  } catch {
    return {};
  }
}

function saveVersions(all: Record<string, DocVersion[]>) {
  try {
    localStorage.setItem(VERSIONS_KEY, JSON.stringify(all));
  } catch {
    /* storage full or unavailable - non-fatal */
  }
}

export function getVersions(id: string): DocVersion[] {
  return loadVersions()[id] ?? [];
}

/**
 * Called after each save: snapshots the new content when the word count has
 * drifted at least VERSION_MIN_DELTA words from the newest snapshot.
 */
export function recordVersion(
  id: string,
  content: string,
  words: number,
  boxes?: string,
): void {
  if (!id) return;
  const all = loadVersions();
  const list = all[id] ?? [];
  const last = list[list.length - 1];
  if (last && Math.abs(words - last.words) < VERSION_MIN_DELTA) return;
  const cleanBoxes = sanitizeBoxesForStorage(boxes);
  list.push({ at: Date.now(), words, content, boxes: cleanBoxes });
  all[id] = list.slice(-VERSIONS_PER_DOC);
  saveVersions(all);
}

export function newDocId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
