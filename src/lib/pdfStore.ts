/**
 * Imported-PDF storage.
 *
 * A PDF placed into an issue keeps its original bytes and is shown through the
 * browser's own PDF viewer (an `<iframe>` over a blob URL, opened at the right
 * sheet with `#page=N`). That is deliberate: the pages stay *vector*, so text
 * and graphics inside an imported PDF remain selectable on screen and come out
 * as real text when the issue is printed.
 *
 * The alternative - rasterising each page to an image with pdfjs-dist at import
 * time - makes printing foolproof but throws away selectability and stores a
 * large PNG per page. It was rejected for that reason; the code for it lived
 * here until it was removed as unused. Only the *raw* PDF is stored, once, as a
 * blob in IndexedDB (mediaStore), so localStorage never carries the file and a
 * twelve-page import costs one blob rather than twelve images.
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { saveMediaBlob, dataUrlToBlob } from './mediaStore';

// Point pdfjs to the bundled worker
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
} catch {
  // worker configuration fallback
}

const KEY_PREFIX = 'bulletin.pdf.';

let seq = 0;
export function newPdfId(): string {
  seq += 1;
  return `pdf${Date.now().toString(36)}${seq.toString(36)}`;
}

/**
 * The `src` a PDF page frame carries.
 *
 * This doubles as the IndexedDB key the file's blob is stored under, which is
 * what makes an imported PDF survive a reload: the media store resolves the
 * `pdf:` reference straight back to the stored file.
 */
export function pdfSrc(id: string): string {
  return `pdf:${id}`;
}

/**
 * Count the pages in a PDF.
 *
 * NOTE: pdf.js takes *ownership* of the bytes you hand it - it transfers the
 * underlying ArrayBuffer to its worker, which leaves the caller's buffer
 * detached. Any later read of that buffer (`new Uint8Array(buf)`, a second
 * `getDocument` call) throws "Cannot perform Construct on a detached
 * ArrayBuffer". Counting must therefore never consume the caller's copy, so
 * this works on a clone.
 */
export async function pdfPageCount(data: ArrayBuffer): Promise<number> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data.slice(0)) });
  try {
    const pdfDoc = await loadingTask.promise;
    const count = pdfDoc.numPages;
    await pdfDoc.destroy().catch(() => undefined);
    return count;
  } catch {
    await loadingTask.destroy().catch(() => undefined);
    return 1;
  }
}

/** Base64-encode bytes (chunked). */
export function bytesToDataUrl(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:application/pdf;base64,${btoa(bin)}`;
}

/**
 * Register a PDF in IndexedDB (the localStorage key is cleaned up here too).
 *
 * Returns nothing on purpose: this used to hand back a fresh object URL, which
 * no caller used and nothing ever revoked, so every import leaked one. The
 * frame resolves its `pdf:` source through the media store anyway, which
 * already caches the single object URL for the blob.
 */
export function registerPdf(id: string, dataUrl: string): void {
  const blob = dataUrlToBlob(dataUrl);
  void saveMediaBlob(pdfSrc(id), blob);
  try {
    localStorage.removeItem(KEY_PREFIX + id);
  } catch {
    // ignore
  }
}
