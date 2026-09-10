/**
 * Merging several `.bulletin` files into one issue.
 *
 * The Design Bible fixes the running order of an issue — cover at the front,
 * end page/credits at the bottom — so Merge reorders whatever it is handed to
 * match, then writes a Page of Contents listing each part with the page it
 * starts on.
 */
import { DEFAULT_MARGINS, splitIntoBoxes } from '../components/DocumentCanvas';
import { parseBulletin, type BulletinDoc } from './format';

/** A4 portrait — the page every bulletin is laid out for. */
const PAGE = { width: 794, height: 1123 };
const MARGIN_X = DEFAULT_MARGINS.left;
const MARGIN_Y = DEFAULT_MARGINS.top;
const CONTENT_W = PAGE.width - MARGIN_X * 2;
const CONTENT_H = PAGE.height - MARGIN_Y * 2;

export type IssuePartKind =
  | 'cover'
  | 'contents'
  | 'article'
  | 'poem'
  | 'graphic'
  | 'puzzle'
  | 'end'
  | 'other';

/** One file queued for the merge. */
export interface MergeInput {
  fileName: string;
  title: string;
  doc: BulletinDoc;
  kind: IssuePartKind;
}

export interface MergeOptions {
  /** Build a Page of Contents listing every part. */
  makeContents: boolean;
  /** Keep the cover page at the front of the issue. */
  coverFirst: boolean;
  /** Keep the end page at the bottom of the issue. */
  endLast: boolean;
  title: string;
}

export interface MergeEntry {
  title: string;
  kind: IssuePartKind;
  /** Page the part starts on (1-based, as printed). */
  page: number;
}

export interface MergeResult {
  title: string;
  content: string;
  boxes: string;
  entries: MergeEntry[];
}

/** Map a saved document back onto the page type it was made from. */
function kindOf(doc: BulletinDoc): IssuePartKind {
  switch (doc.template) {
    case 'bulletin-cover':
      return 'cover';
    case 'bulletin-contents':
      return 'contents';
    case 'bulletin-poem':
      return 'poem';
    case 'bulletin-graphic':
      return 'graphic';
    case 'bulletin-puzzle':
      return 'puzzle';
    case 'bulletin-endpage':
      return 'end';
    case 'bulletin-article':
    case 'bulletin-continuation':
      return 'article';
    default:
      break;
  }
  const t = (doc.title || '').toLowerCase();
  if (t.includes('cover')) return 'cover';
  if (t.includes('content')) return 'contents';
  if (t.includes('poem')) return 'poem';
  if (t.includes('puzzle')) return 'puzzle';
  if (t.includes('end page') || t.includes('credit') || t.includes('thank')) return 'end';
  return 'article';
}

/** Read and parse the dropped/selected files, skipping anything invalid. */
export async function readMergeInputs(files: File[]): Promise<MergeInput[]> {
  const out: MergeInput[] = [];
  for (const file of files) {
    try {
      const doc = parseBulletin(await file.text());
      if (!doc) continue;
      out.push({
        fileName: file.name,
        title: doc.title || file.name.replace(/\.bulletin$/i, ''),
        doc,
        kind: kindOf(doc),
      });
    } catch {
      /* unreadable file — leave it out of the merge */
    }
  }
  return out;
}

/** The boxes a part contributes, with page indexes starting at 0. */
function partBoxes(doc: BulletinDoc): Array<Record<string, unknown>> {
  if (doc.boxes) {
    try {
      const parsed = JSON.parse(doc.boxes);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      /* fall through and re-split from the HTML */
    }
  }
  return splitIntoBoxes(doc.content, PAGE, DEFAULT_MARGINS) as unknown as Array<
    Record<string, unknown>
  >;
}

/** How many pages a part spans. */
function partSpan(doc: BulletinDoc): number {
  const boxes = partBoxes(doc);
  if (!boxes.length) return 1;
  return boxes.reduce((max, b) => Math.max(max, Number(b.pageIndex ?? 0)), 0) + 1;
}

const KIND_LABEL: Record<IssuePartKind, string> = {
  cover: 'Cover',
  contents: 'Contents',
  article: 'Article',
  poem: 'Poem',
  graphic: 'Graphic',
  puzzle: 'Puzzle',
  end: 'Credits',
  other: 'Page',
};

/** Build the two-column Page of Contents in the house style. */
export function contentsHtml(entries: MergeEntry[]): string {
  const rows = entries
    .map(
      (e) =>
        `<p style="margin:0;padding-top:20px;text-align:center;font-family:'Franklin Gothic Heavy','Libre Franklin',Arial,sans-serif;font-size:18pt;line-height:1.25;color:#3f3f3f;break-inside:avoid;"><b>${e.page} &mdash; ${KIND_LABEL[e.kind]}</b><br/><span style="font-family:'Franklin Gothic Medium','Libre Franklin',Arial,sans-serif;color:#262626;">${escapeHtml(e.title)}</span></p>`,
    )
    .join('\n');
  return `<p style="margin:0;padding:10px 0 6px;text-align:center;font-family:'Franklin Gothic Heavy','Libre Franklin',Arial,sans-serif;font-size:48pt;line-height:1.05;color:#3f3f3f;column-span:all;">Page of Contents</p>
<hr style="margin:0;border:0;border-top:1px solid #d9d3c9;column-span:all;" />
${rows}`;
}

/**
 * Merge the queued parts into one document.
 *
 * Order: cover(s) → contents (generated, unless one was imported) → every
 * other part in the order given → end page(s).
 */
export function mergeIssue(inputs: MergeInput[], opts: MergeOptions): MergeResult {
  const covers = inputs.filter((i) => i.kind === 'cover');
  const ends = inputs.filter((i) => i.kind === 'end');
  const middles = inputs.filter((i) => i.kind !== 'cover' && i.kind !== 'end');
  const importedContents = middles.filter((i) => i.kind === 'contents');

  const front = opts.coverFirst ? covers : [];
  const body = opts.coverFirst ? middles : [...covers, ...middles];
  const back = opts.endLast ? ends : [];
  const tail = opts.endLast ? [] : ends;

  const ordered: MergeInput[] = [...front, ...body, ...back, ...tail];
  const wantContents = opts.makeContents && importedContents.length === 0;

  // Page 1 is the cover; a generated contents page occupies one page after
  // the covers. Everything after that shifts down by one.
  const contentsAt = front.length;
  let page = 1;
  const spans = new Map<MergeInput, number>();
  const entries: MergeEntry[] = [];

  const take = (part: MergeInput | null, isContents: boolean) => {
    if (!part) {
      if (isContents) page += 1;
      return;
    }
    const span = partSpan(part.doc);
    spans.set(part, span);
    entries.push({ title: part.title, kind: part.kind, page });
    page += span;
  };

  ordered.forEach((part, i) => {
    if (wantContents && i === contentsAt) take(null, true);
    take(part, false);
  });
  if (wantContents && contentsAt >= ordered.length) take(null, true);

  // ---- lay the pages out ----
  const allBoxes: Array<Record<string, unknown>> = [];
  const htmlParts: string[] = [];
  let cursor = 0;

  const place = (html: string, boxes: Array<Record<string, unknown>>, columns?: number) => {
    htmlParts.push(html);
    if (boxes.length) {
      for (const b of boxes) {
        allBoxes.push({
          ...b,
          id: `m-${allBoxes.length}-${Date.now().toString(36)}`,
          pageIndex: cursor + Number(b.pageIndex ?? 0),
          nextId: null,
        });
      }
      cursor += boxes.reduce((max, b) => Math.max(max, Number(b.pageIndex ?? 0)), 0) + 1;
    } else {
      // Nothing to place (an empty document) — still give it a page.
      allBoxes.push({
        id: `m-empty-${allBoxes.length}`,
        pageIndex: cursor,
        x: MARGIN_X,
        y: MARGIN_Y,
        w: CONTENT_W,
        h: CONTENT_H,
        html,
        nextId: null,
      });
      cursor += 1;
    }
    if (columns && columns > 1) {
      // Column count lives on the frame, not the HTML.
      const last = allBoxes[allBoxes.length - 1];
      if (last) last.columns = columns;
    }
  };

  ordered.forEach((part, i) => {
    if (wantContents && i === contentsAt) {
      place(contentsHtml(entries), [
        {
          id: 'contents',
          pageIndex: 0,
          x: MARGIN_X,
          y: MARGIN_Y,
          w: CONTENT_W,
          h: CONTENT_H,
          html: contentsHtml(entries),
          columns: 2,
          nextId: null,
        },
      ]);
    }
    place(part.doc.content, partBoxes(part.doc));
  });
  if (wantContents && contentsAt >= ordered.length) {
    place(contentsHtml(entries), [
      {
        id: 'contents',
        pageIndex: 0,
        x: MARGIN_X,
        y: MARGIN_Y,
        w: CONTENT_W,
        h: CONTENT_H,
        html: contentsHtml(entries),
        columns: 2,
        nextId: null,
      },
    ]);
  }

  return {
    title: opts.title || 'Merged issue',
    content: htmlParts.join('<div style="page-break-after:always"></div>'),
    boxes: JSON.stringify(allBoxes),
    entries,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
