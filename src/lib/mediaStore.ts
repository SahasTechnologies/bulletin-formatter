/**
 * IndexedDB-backed media storage for pictures and imported PDF files.
 *
 * Moving heavy image data URLs and PDF base64 payloads out of localStorage
 * eliminates the ~5MB quota ceiling, allowing documents with high-res photos
 * and multi-page imported PDFs to save reliably without competing with content.
 */

const DB_NAME = 'bulletin_media_db';
const DB_VERSION = 1;
const STORE_NAME = 'media';

interface MediaRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

// In-memory cache: asset id -> live object URL
const urlCache = new Map<string, string>();
const loadingPromises = new Map<string, Promise<string | null>>();
const listeners = new Set<(id: string, url: string) => void>();

export function onMediaLoaded(listener: (id: string, url: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyLoaded(id: string, url: string) {
  listeners.forEach((fn) => {
    try {
      fn(id, url);
    } catch {
      // ignore listener error
    }
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (once) the media database.
 *
 * The *failure* is deliberately not cached. This used to keep the rejected
 * promise, so a single transient failure - IndexedDB momentarily blocked by
 * another tab's upgrade, or an open that raced the private-mode check - left
 * every later image and PDF load rejecting for the rest of the session, and
 * the pictures never came back even once the database was available again.
 * Now a failed open is forgotten so the next call retries.
 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  dbPromise = attempt.catch((err: unknown) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

export function newAssetId(prefix = 'asset'): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}:${stamp}_${rand}`;
}

export function isAssetRef(src: string | null | undefined): boolean {
  if (!src) return false;
  return src.startsWith('asset:') || src.startsWith('pdf:') || src.startsWith('img:');
}

/** Convert a data URL to a binary Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return new Blob([]);
  const header = dataUrl.slice(0, comma);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/** Convert a Blob to a data URL (useful if needed for legacy export). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Save a binary Blob into IndexedDB and return its live Object URL. */
export async function saveMediaBlob(id: string, blob: Blob): Promise<string> {
  const db = await getDB();
  const record: MediaRecord = {
    id,
    blob,
    mimeType: blob.type || 'image/png',
    createdAt: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  const existingUrl = urlCache.get(id);
  if (existingUrl) {
    try {
      URL.revokeObjectURL(existingUrl);
    } catch {
      // ignore
    }
  }

  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  notifyLoaded(id, url);
  return url;
}

/** Save a data URL into IndexedDB as a Blob and return its Object URL. */
export async function saveMediaDataUrl(id: string, dataUrl: string): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  return saveMediaBlob(id, blob);
}

/** Retrieve a Blob from IndexedDB by id. */
export async function getMediaBlob(id: string): Promise<Blob | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const rec = req.result as MediaRecord | undefined;
        resolve(rec ? rec.blob : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Asynchronously resolve an asset reference or standard URL to a loadable URL.
 */
export async function resolveMediaUrl(idOrSrc: string | null | undefined): Promise<string | null> {
  if (!idOrSrc) return null;
  if (!isAssetRef(idOrSrc)) {
    return idOrSrc;
  }

  const cached = urlCache.get(idOrSrc);
  if (cached) return cached;

  if (loadingPromises.has(idOrSrc)) {
    return loadingPromises.get(idOrSrc)!;
  }

  const loadPromise = (async () => {
    try {
      const blob = await getMediaBlob(idOrSrc);
      if (blob) {
        const url = URL.createObjectURL(blob);
        urlCache.set(idOrSrc, url);
        notifyLoaded(idOrSrc, url);
        return url;
      }
      return null;
    } finally {
      loadingPromises.delete(idOrSrc);
    }
  })();

  loadingPromises.set(idOrSrc, loadPromise);
  return loadPromise;
}

/**
 * Synchronously resolve a media URL.
 * Returns the cached Object URL immediately if available, or the URL itself if
 * it's not an asset reference. If an asset is pending in IndexedDB, kicks off an
 * async load and returns null until resolved.
 */
export function syncResolveMediaUrl(idOrSrc: string | null | undefined): string | null {
  if (!idOrSrc) return null;
  if (!isAssetRef(idOrSrc)) return idOrSrc;

  const cached = urlCache.get(idOrSrc);
  if (cached) return cached;

  // Kick off background load so it will be ready and notify subscribers
  void resolveMediaUrl(idOrSrc);
  return null;
}

/** Delete a media item from IndexedDB. */
export async function deleteMedia(id: string): Promise<void> {
  try {
    const cached = urlCache.get(id);
    if (cached) {
      URL.revokeObjectURL(cached);
      urlCache.delete(id);
    }
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // non-fatal
  }
}
