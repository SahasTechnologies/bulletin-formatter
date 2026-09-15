/**
 * Merging several `.bulletin` files into one issue.
 *
 * The Design Bible fixes the running order of an issue - cover at the front,
 * end page/credits at the bottom - so Merge reorders whatever it is handed to
 * match, then writes a Page of Contents listing each part with the page it
 * starts on.
 */
import { splitIntoBoxes } from '../components/DocumentCanvas';
import { parseBulletin, type BulletinDoc } from './format';

/** A4 portrait - the page every bulletin is laid out for. */
const PAGE = { width: 794, height: 1123 };
/* The area Merge lays its frames out in. The editor has no margins - a frame
   may sit anywhere - so this is simply the geometry the merged issue uses,
   matching the bulletin templates. */
const CONTENT_X = 96;
const CONTENT_Y = 80;
const CONTENT_W = PAGE.width - CONTENT_X * 2;
const CONTENT_H = PAGE.height - CONTENT_Y * 2;

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
  /** Sheets the merged issue spans. A part can cover several pages, so this is
      not `entries.length` - the dialog reports it verbatim. */
  pageCount: number;
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
      /* unreadable file - leave it out of the merge */
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
  return splitIntoBoxes(doc.content, PAGE) as unknown as Array<
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

/* ---- Page of Contents geometry -------------------------------------------
   The A4 print area is `CONTENT_W` × `CONTENT_H`; the text frame pads 4px, so a
   sheet has ~955px of room. The 48pt title and its rule eat ~88px, and one
   entry is two 18pt lines (~60px) plus whatever spacing we give it. The spacing
   is solved per sheet: it opens up until a full sheet of entries reaches the
   bottom margin (the 62px the printable template uses), and tightens again when
   an issue has so many parts that the list needs a second sheet. */
const CONTENTS_HEIGHT = CONTENT_H - 8;
const CONTENTS_TOP = 88;
const CONTENTS_ENTRY_TEXT = 60;
const CONTENTS_ENTRIES_PER_COLUMN = 7;
const CONTENTS_ENTRIES_PER_SHEET = CONTENTS_ENTRIES_PER_COLUMN * 2;

/** The 48pt heading every contents sheet opens with. */
const CONTENTS_HEADING = `<p style="margin:0;padding:10px 0 6px;text-align:center;font-family:'Franklin Gothic Heavy','Libre Franklin',Arial,sans-serif;font-size:48pt;line-height:1.05;color:#3f3f3f;column-span:all;">Page of Contents</p>`;

/** How many contents sheets a list of this length needs (at least one). */
export function contentsSheetCount(entryCount: number): number {
  return Math.max(1, Math.ceil(entryCount / CONTENTS_ENTRIES_PER_SHEET));
}

/** One contents sheet: heading, rule and its entries, spaced to reach the
    bottom margin. Sheets after the first say so under the heading. */
function contentsSheetHtml(entries: MergeEntry[], continued: boolean): string {
  const perColumn = Math.max(1, Math.ceil(entries.length / 2));
  const room = CONTENTS_HEIGHT - CONTENTS_TOP - (continued ? 30 : 0);
  const pad = Math.max(6, Math.min(62, Math.round(room / perColumn) - CONTENTS_ENTRY_TEXT));
  const rows = entries
    .map(
      (e) =>
        `<p style="margin:0;padding-top:${pad}px;text-align:center;font-family:'Franklin Gothic Heavy','Libre Franklin',Arial,sans-serif;font-size:18pt;line-height:1.25;color:#3f3f3f;break-inside:avoid;"><b>${e.page} - ${KIND_LABEL[e.kind]}</b><br/><span style="font-family:'Franklin Gothic Medium','Libre Franklin',Arial,sans-serif;color:#262626;">${escapeHtml(e.title)}</span></p>`,
    )
    .join('\n');
  const sub = continued
    ? `\n<p style="margin:0;padding:0;text-align:center;font-family:'Franklin Gothic Medium','Libre Franklin',Arial,sans-serif;font-size:18pt;line-height:1.25;color:#808080;column-span:all;">continued</p>`
    : '';
  return `${CONTENTS_HEADING}${sub}\n<hr style="margin:${continued ? '6px' : '0'} 0 0;border:0;border-top:1px solid #d9d3c9;column-span:all;" />\n${rows}`;
}

/** The two-column Page of Contents in the house style - one sheet, or two when
    the issue is long enough to need them. */
export function contentsSheets(entries: MergeEntry[]): string[] {
  const pages = contentsSheetCount(entries.length);
  const perPage = Math.ceil(entries.length / pages);
  return Array.from({ length: pages }, (_, i) =>
    contentsSheetHtml(entries.slice(i * perPage, (i + 1) * perPage), i > 0),
  );
}

/** The (first) contents page as a single HTML string. */
export function contentsHtml(entries: MergeEntry[]): string {
  return contentsSheets(entries)[0] ?? '';
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
  // The generated list starts on the page after the covers and is counted
  // before the numbering pass: every part plus the contents page itself is one
  // entry, and a long issue spills onto a second contents sheet.
  const contentsPages = wantContents ? contentsSheetCount(ordered.length + 1) : 0;

  // Page 1 is the cover; the generated contents occupies `contentsPages`
  // pages after the covers. Everything after that shifts down by that much.
  const contentsAt = front.length;
  let page = 1;
  const spans = new Map<MergeInput, number>();
  const entries: MergeEntry[] = [];

  const take = (part: MergeInput | null, isContents: boolean) => {
    if (!part) {
      if (isContents) page += contentsPages;
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
      // Renumber the part's frames, then re-point their links at the new ids.
      // Dropping the links instead (as this used to) turned a threaded piece -
      // an article's start page flowing into its continuation sheets - into
      // independent frames whose stories no longer flowed into each other.
      const stamp = Date.now().toString(36);
      const fresh = boxes.map((_, i) => `m-${allBoxes.length + i}-${stamp}`);
      const idOf = new Map<string, string>();
      boxes.forEach((b, i) => {
        if (typeof b.id === 'string' && !idOf.has(b.id)) idOf.set(b.id, fresh[i]);
      });
      boxes.forEach((b, i) => {
        allBoxes.push({
          ...b,
          id: fresh[i],
          pageIndex: cursor + Number(b.pageIndex ?? 0),
          nextId:
            typeof b.nextId === 'string' ? (idOf.get(b.nextId) ?? null) : null,
        });
      });
      cursor += boxes.reduce((max, b) => Math.max(max, Number(b.pageIndex ?? 0)), 0) + 1;
    } else {
      // Nothing to place (an empty document) - still give it a page.
      allBoxes.push({
        id: `m-empty-${allBoxes.length}`,
        pageIndex: cursor,
        x: CONTENT_X,
        y: CONTENT_Y,
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

  /** Lay down every contents sheet, one full-page two-column frame each. */
  const placeContents = () => {
    for (const sheet of contentsSheets(entries)) {
      place(sheet, [
        {
          id: `contents-${allBoxes.length}`,
          pageIndex: 0,
          x: CONTENT_X,
          y: CONTENT_Y,
          w: CONTENT_W,
          h: CONTENT_H,
          html: sheet,
          columns: 2,
          nextId: null,
        },
      ]);
    }
  };

  ordered.forEach((part, i) => {
    if (wantContents && i === contentsAt) placeContents();
    place(part.doc.content, partBoxes(part.doc));
  });
  if (wantContents && contentsAt >= ordered.length) placeContents();

  return {
    title: opts.title || 'Merged issue',
    content: htmlParts.join('<div style="page-break-after:always"></div>'),
    boxes: JSON.stringify(allBoxes),
    entries,
    pageCount: Math.max(1, cursor),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
