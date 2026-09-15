/**
 * The proprietary `.bulletin` file format - a small JSON wrapper around the
 * document's HTML. Kept deliberately separate from storage so the on-disk file
 * and the localStorage copy stay in sync by construction.
 */

export type PageSize = 'A4' | 'Letter';

export interface BulletinDoc {
  format: 'bulletin';
  version: 1;
  title: string;
  content: string;
  page: PageSize;
  createdAt: number;
  updatedAt: number;
  template?: string;
  /** Text boxes (frames) serialized as JSON, when the document uses them. */
  boxes?: string;
  /** Show the end-of-document tombstone (small black square, last page).
      @deprecated the marker is a frame on the last sheet now; kept so files
      written by older builds still open. */
  tombstone?: boolean;
  /** Per-page names, serialized as a JSON array (index = page number - 1). */
  pageNames?: string;
  /** The master page (header/footer furniture), serialized as JSON. */
  master?: string;
  /** Legacy pre-master-page header text (tokens: @page @month @year). */
  masterHeader?: string;
  /** Legacy pre-master-page footer text (tokens: @page @month @year). */
  masterFooter?: string;
}

export const BULLETIN_EXT = 'bulletin';

/** Build the serialized `.bulletin` string for a document. */
export function serializeBulletin(doc: BulletinDoc): string {
  return JSON.stringify(doc, null, 2);
}

/** Parse a `.bulletin` string. Returns null if it is not a valid file. */
export function parseBulletin(raw: string): BulletinDoc | null {
  try {
    const data = JSON.parse(raw);
    if (!data || data.format !== 'bulletin') return null;
    if (typeof data.title !== 'string' || typeof data.content !== 'string') return null;
    return {
      format: 'bulletin',
      version: 1,
      title: data.title,
      content: data.content,
      page: data.page === 'Letter' ? 'Letter' : 'A4',
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
      template: typeof data.template === 'string' ? data.template : undefined,
      boxes: typeof data.boxes === 'string' ? data.boxes : undefined,
      tombstone: data.tombstone === true,
      pageNames: typeof data.pageNames === 'string' ? data.pageNames : undefined,
      master: typeof data.master === 'string' ? data.master : undefined,
      masterHeader: typeof data.masterHeader === 'string' ? data.masterHeader : undefined,
      masterFooter: typeof data.masterFooter === 'string' ? data.masterFooter : undefined,
    };
  } catch {
    return null;
  }
}

/** Trigger a browser download of a `.bulletin` file. */
export function downloadBulletin(doc: BulletinDoc): void {
  downloadBlob(serializeBulletin(doc), 'application/json', `${doc.title || 'untitled'}.${BULLETIN_EXT}`);
}

/**
 * Download a standalone HTML copy: the document's own HTML wrapped in a
 * minimal page so it opens and prints correctly in any browser.
 */
export function downloadHtml(title: string, content: string): void {
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<title>${escapeHtml(title)}</title>\n<style>\n  body { margin: 0; background: #fff; }\n  .page { max-width: 794px; margin: 0 auto; padding: 80px 96px; font-family: 'Roboto Condensed', 'Red Hat Text', system-ui, sans-serif; font-size: 11pt; line-height: 1.5; color: #2b2622; }\n  table { border-collapse: collapse; }\n  img { max-width: 100%; }\n  @media print { .page { padding: 0; } }\n</style>\n</head>\n<body>\n<div class="page">\n${content}\n</div>\n</body>\n</html>`;
  downloadBlob(html, 'text/html;charset=utf-8', `${title || 'untitled'}.html`);
}

/** Download a plain-text copy of the document. */
export function downloadText(title: string, content: string): void {
  const tmp = document.createElement('div');
  tmp.innerHTML = content;
  downloadBlob((tmp.innerText || tmp.textContent || '').replace(/\n{3,}/g, '\n\n'), 'text/plain;charset=utf-8', `${title || 'untitled'}.txt`);
}

function downloadBlob(data: string, type: string, filename: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
