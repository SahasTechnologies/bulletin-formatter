/**
 * Persistence for recently-opened documents.
 *
 * Documents are stored as a flat JSON array under a single key. Heavy binary
 * data (images, PDFs) are moved into IndexedDB (`mediaStore`) with lightweight
 * `asset:<id>` references, ensuring localStorage never hits the ~5MB quota.
 */

import { saveMediaDataUrl, newAssetId } from './mediaStore';

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

/**
 * Scan boxes JSON and offload any embedded data URLs (images/PDFs) to IndexedDB,
 * storing lightweight asset references instead to prevent quota overflow.
 */
export function sanitizeBoxesForStorage(boxesJson?: string): string | undefined {
  if (!boxesJson || !boxesJson.includes('data:')) return boxesJson;
  try {
    const list = JSON.parse(boxesJson);
    if (!Array.isArray(list)) return boxesJson;
    let modified = false;
    for (const b of list) {
      if (typeof b?.src === 'string' && b.src.startsWith('data:')) {
        const id = newAssetId(b.kind === 'pdf' ? 'pdf' : 'img');
        void saveMediaDataUrl(id, b.src);
        b.src = id;
        modified = true;
      }
    }
    return modified ? JSON.stringify(list) : boxesJson;
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
        boxes: sanitizeBoxesForStorage(d.boxes),
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

function loadVersions(): Record<string, DocVersion[]> {
  try {
    const raw = localStorage.getItem(VERSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, DocVersion[]>) : {};
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
