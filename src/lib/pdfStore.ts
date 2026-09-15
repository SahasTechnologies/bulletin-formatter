/**
 * Imported PDFs rasterization and storage.
 *
 * Imported PDFs are rasterized to high-resolution images at import time
 * using pdfjs-dist. This guarantees that:
 *  1. Printing (@media print / window.print()) prints the imported pages
 *     faithfully without the blank sheets or clipping common to browser iframes.
 *  2. Sidebar thumbnails scale down crisply and accurately.
 *  3. The rendered page images are stored as binary Blobs in IndexedDB (mediaStore),
 *     leaving localStorage unburdened so saving never hits the 5MB quota.
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  saveMediaBlob,
  getMediaBlob,
  resolveMediaUrl,
  newAssetId,
  isAssetRef,
  dataUrlToBlob,
} from './mediaStore';

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

/** The `src` a PDF page frame carries. */
export function pdfSrc(id: string): string {
  return `pdf:${id}`;
}

/** The id inside a `pdf:` src, or null when this is an ordinary URL. */
export function pdfIdOf(src: string | undefined | null): string | null {
  if (!src || !src.startsWith('pdf:')) return null;
  return src.slice('pdf:'.length) || null;
}

export interface RasterizedPage {
  pageNumber: number;
  assetId: string;
  blob: Blob;
  objectUrl: string;
  width: number;
  height: number;
}

/**
 * Rasterize each page of a PDF document to sharp PNG blobs and persist them to IndexedDB.
 * Uses scale: 2 for print-ready 192/200 DPI clarity.
 */
export async function rasterizePdfPages(
  data: ArrayBuffer,
  pdfId = newPdfId(),
): Promise<{
  pdfId: string;
  pageCount: number;
  pages: RasterizedPage[];
}> {
  const bytes = new Uint8Array(data);
  // Store raw PDF in mediaStore as backup
  await saveMediaBlob(
    pdfSrc(pdfId),
    new Blob([bytes], { type: 'application/pdf' }),
  );

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdfDoc = await loadingTask.promise;
  const pageCount = pdfDoc.numPages;
  const pages: RasterizedPage[] = [];

  try {
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i);
      // 2x scale gives ~192–200 DPI for crisp print quality
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b || new Blob([])), 'image/png');
      });

      const pageAssetId = newAssetId(`pdf_page_${pdfId}_p${i}`);
      const objectUrl = await saveMediaBlob(pageAssetId, blob);

      pages.push({
        pageNumber: i,
        assetId: pageAssetId,
        blob,
        objectUrl,
        width: viewport.width / 2,
        height: viewport.height / 2,
      });

      // Release the page's canvas and its bitmap as soon as it is stored: a
      // 200-page import otherwise holds every rendered page in memory until it
      // finishes, which is what made large PDFs stall the tab.
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    // Hand the worker's memory back whether the import succeeded or threw.
    await pdfDoc.destroy().catch(() => undefined);
  }

  return { pdfId, pageCount, pages };
}

/**
 * Legacy count fallback or quick counting.
 */
export async function pdfPageCount(data: ArrayBuffer): Promise<number> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
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

/**
 * Resolve an image or PDF asset URL for rendering.
 */
export async function resolvePdfSrc(src: string | undefined | null): Promise<string | null> {
  if (!src) return null;
  if (isAssetRef(src)) {
    return resolveMediaUrl(src);
  }
  return src;
}
