import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Columns2, Columns3, ImagePlus, PaintBucket, Trash2, Unlink } from 'lucide-react';
import PageSidebar from './PageSidebar';import { registerEditor,
  registerHistory,
  initEditorCommands,
  startSelectionTracking,
} from '../lib/editor';
import {
  flowStory,
  recomposeStory,
  caretOffsetIn,
  setCaretOffset,
} from '../lib/textbox';
import {
  mirrorFrameStyle,
  sanitizeFrameText,
  selectionCoversContents,
  stripBorrowedType,
} from '../lib/frameStyle';
import { tombstoneCorner, tombstoneOffCorner } from '../lib/marker';
import { useGoogleFont } from './GoogleFontProvider';
import { GOOGLE_FONT_FAMILIES } from '../data/googleFonts';
import {
  bytesToDataUrl,
  newPdfId,
  pdfPageCount,
  pdfSrc,
  registerPdf,
  resolvePdfSrc,
} from '../lib/pdfStore';
import {
  activeMaster,
  bandForPage,
  bandKey,
  bandSegments,
  fillMasterTokens,
  hasTabStops,
  joinBandSegments,
  masterById,
  masterForPage,
  BAND_LABELS,
  type BandKey,
  type BandSlot,
  type MasterAlign,
  type MasterBand,
  type MasterDef,
  type MasterSide,
  type MasterSet,
} from '../lib/master';

const RULER_SIZE = 28; // px thickness shared by the top and left rulers
/** CSS pixels per millimetre at 96 dpi - the unit the rulers are graduated in. */
const PX_PER_MM = 96 / 25.4;
/** Ruler graduation: a short tick every 5 mm, a numbered tick every 20 mm. */
const RULER_MINOR_MM = 5;
const RULER_MAJOR_MM = 20;
const PAGE_GAP = 32; // flex gap (gap-8) between page sheets
const MIN_W = 60;
const MIN_H = 40;
/** Height of the header/footer band drawn in a page's top/bottom margin. */
const MASTER_BAND_H = 28;
/**
 * How far the master page's frame sits from each page edge, in page pixels.
 *
 * Publisher draws the master's frame as one evenly-inset rectangle - the same
 * distance from all four sides - so it reads as a symmetrical border rather
 * than a text column. One value, used for left/right/top/bottom alike.
 *
 * The number is Publisher's own: its frame measures ~54 px from each edge at
 * the ~1.15× zoom the reference screenshot was taken at, i.e. 48 px on an A4
 * sheet - half an inch.
 *
 * A master page is an *independent* page: this is a fixed design constant,
 * deliberately **not** derived from the publication's margins, so nothing the
 * user drags on the rulers can move the master's frame or its furniture.
 */
const MASTER_INSET = 48;
/** Clear space between a band and the master frame it sits outside of. */
const MASTER_BAND_GAP = 4;
/** 1×1 transparent GIF - the invisible backing picture of a placeholder box
    (its dashed 'click to add' cover is drawn by CSS, see .page-box-ph). */
export const TRANSPARENT_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Vertical gap between stacked element boxes in a migrated document. */
const SPLIT_GAP = 24;
/** Gutter (px) between columns inside a multi-column text box. */
const COLUMN_GAP = 28;
/** Gray of the rule drawn between columns (matches the frame borders). */
const COLUMN_RULE_COLOR = '#d8d2ca';
/** Pixels of movement before a click on a selected box turns into a drag. */
const DRAG_THRESHOLD = 3;
/** How many document states the undo stack keeps. */
const MAX_HISTORY = 60;
/** Quiet time after the last edit before a history step is recorded. */
const HISTORY_DEBOUNCE = 420;

/**
 * The content-area geometry the *old*, margin-based migration produced.
 *
 * Only used to recognise a legacy "one coarse full-page box" document so it can
 * be re-split per element. Nothing lays out new content from these values - the
 * app has no margins, and a frame may sit anywhere on the sheet.
 */
const LEGACY_MARGIN = { left: 96, right: 96, top: 80, bottom: 80 };

/**
 * The master page's frame on a sheet - the rectangle the master owns.
 *
 * One even inset from every side of the page (see `MASTER_INSET`), so the
 * border is symmetrical and identical on all four edges.
 */
function masterFrameBox(page: { width: number; height: number }) {
  return {
    left: MASTER_INSET,
    top: MASTER_INSET,
    width: Math.max(60, page.width - MASTER_INSET * 2),
    height: Math.max(60, page.height - MASTER_INSET * 2),
  };
}

/**
 * Where a header/footer band sits on the sheet.
 *
 * The furniture lives **outside** the master frame: the running head sits just
 * above it, the folio just below, and both span the frame's full width. Moving
 * a margin arrow moves neither - a master page is irrespective of margin.
 */
function masterBandBox(slot: BandSlot, page: { width: number; height: number }) {
  const frame = masterFrameBox(page);
  const top =
    slot === 'header'
      ? frame.top - MASTER_BAND_GAP - MASTER_BAND_H
      : frame.top + frame.height + MASTER_BAND_GAP;
  return { left: frame.left, top, width: frame.width, height: MASTER_BAND_H };
}

/**
 * Publisher-style ruler graduation along one axis of a ruler strip.
 *
 * Marks are laid out in page pixels (0 = the page's own top/left edge) and then
 * multiplied by `scale`, so they track the sheet at any zoom while the numbers
 * keep a constant size. Three tick lengths give the eye a readable cadence:
 * 5 mm short, 10 mm medium, 20 mm long with the millimetre value beside it.
 */
function RulerTicks({
  pagePx,
  scale,
  axis,
}: {
  /** Page length in page pixels (unscaled). */
  pagePx: number;
  /** Zoom factor the ticks are drawn at. */
  scale: number;
  axis: 'x' | 'y';
}) {
  const marks: React.ReactNode[] = [];
  const totalMm = Math.floor(pagePx / PX_PER_MM);
  for (let mm = 0; mm <= totalMm; mm += RULER_MINOR_MM) {
    const major = mm % RULER_MAJOR_MM === 0;
    const medium = !major && mm % (RULER_MINOR_MM * 2) === 0;
    const len = major ? 10 : medium ? 7 : 4;
    const pos = mm * PX_PER_MM * scale;
    marks.push(
      <div
        key={`t${mm}`}
        className="absolute bg-gdoc-muted/45"
        style={
          axis === 'x'
            ? { left: `${pos}px`, bottom: 0, width: '1px', height: `${len}px` }
            : { top: `${pos}px`, right: 0, height: '1px', width: `${len}px` }
        }
      />,
    );
    if (major && mm > 0) {
      marks.push(
        <span
          key={`n${mm}`}
          className="absolute text-[9px] leading-none tabular-nums text-gdoc-muted"
          style={
            axis === 'x'
              ? { left: `${pos}px`, top: '1px', transform: 'translateX(-50%)' }
              : { top: `${pos}px`, left: '2px', transform: 'translateY(-50%)' }
          }
        >
          {mm}
        </span>,
      );
    }
  }
  return <>{marks}</>;
}

/**
 * A text box on the page. `html` is only the *seed* - after mount the box's
 * content is an uncontrolled contentEditable and the live DOM is the truth.
 */
interface TextBox {
  id: string;
  /** Zero-based page the box sits on. */
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  html: string;
  /** Newspaper-style column count for a text box (1 = single column).
      Multi-column boxes fill column 1 top-to-bottom, then column 2, and
      draw a gray rule down the gutter between columns. */
  columns?: number;
  /** Next box in a linked chain, or null when this box ends the chain. */
  nextId: string | null;
  /** Image boxes hold a picture only. `shape` is a filled rectangle, `line` a
      free-standing rule - both are objects on the page, never text. `pdf` is a
      whole page imported from a PDF: the browser's own viewer renders it, so
      its text stays selectable, but it is not editable. A `sheet` entry is an
      empty-page marker: it reserves a page slot so blank (e.g. trailing) pages
      survive saves. A `tombstone` is the end-of-piece marker: placed by the
      template or the menu, never dragged, and painted above the content. */
  kind?: 'image' | 'sheet' | 'shape' | 'line' | 'pdf' | 'tombstone';
  /** 1-based page of the imported PDF a `pdf` frame shows. */
  pdfPage?: number;
  /** Image source (data URL or path) when `kind === 'image'`. */
  src?: string;
  /** Corner rounding (px) applied to an image box's picture or a shape. */
  radius?: number;
  /** Soft-edge fade (px): how far the picture's edges dissolve out. */
  fade?: number;
  /** How a picture fills its frame: `cover` (the default) crops it to the
      frame, `contain` shows the whole picture inside the frame. Templates may
      pin either with `data-fit`. */
  fit?: 'cover' | 'contain';
  /** Fill colour of a `shape` box (e.g. the bulletin's orange cards). */
  fill?: string;
  /** Stroke colour of a `line` box. */
  stroke?: string;
  /** Stroke weight (px) of a `line` box. */
  thickness?: number;
  /** Placeholder hint for an empty image box (e.g. from a bulletin template):
      while set, the frame draws a dashed 'click to add …' cover and a click
      opens the image picker instead of selecting. Cleared when a real image
      is dropped in. */
  ph?: string;
  /** Alignment of text inside the frame. A template declares it with
      `data-align`; it governs text with no alignment of its own, so a frame
      that has been retyped wholesale stays centred rather than jumping left. */
  align?: 'left' | 'center' | 'right' | 'justify';
  /** The frame's **standard** text type, as a CSS declaration list (a
      template's `data-text`, e.g. `font-size:13pt;line-height:1.45`). It is
      what plain text inside the frame falls back to - and what a wholesale
      retype (Ctrl+A then type) adopts, instead of the first block's borrowed
      display type, which is what used to flood the frame with 18pt type and
      turn its chrome red. */
  css?: string;
}

interface DocumentCanvasProps {
  zoom: number;
  spellCheck: boolean;
  showRuler: boolean;
  page: { width: number; height: number };
  /** Viewing mode: boxes are read-only (View > Viewing). */
  readOnly?: boolean;
  /** The document's flat HTML (legacy page content or boxes concatenated). */
  content: string;
  /** Serialized text boxes (JSON), when the document has them. */
  boxes?: string;
  /** Bump to reload `content`/`boxes` (import, version restore…). */
  rev: number;
  /** Bump to insert a new text box (Insert > Text box). */
  textboxTick: number;
  /** Bump + src to insert an image box (Insert > Image). */
  imageTick: number;
  /** Data URL of the image to insert with `imageTick`. */
  imageSrc: string;
  /** Bump to insert a shape (Insert > Shape). */
  shapeTick?: number;
  /** Bump to add the end-of-piece marker to the current page (bump again to
      take it off). */
  tombstoneTick?: number;
  /** Names the user has given the pages (index = page number - 1). */
  pageNames?: string[];
  /** Report a change to the page names so the document can save them. */
  onPageNamesChange?: (names: string[]) => void;
  /** Dress one page in a different master (the Pages pane's context menu). */
  onAssignMaster?: (pageIndex: number, masterId: string) => void;
  /** Bump to insert a line (Insert > Line). */
  lineTick?: number;
  /** Bump to set the focused frame's column count (Format > Columns). */
  columnsTick?: number;
  /** The column count that goes with `columnsTick`. */
  columnsCount?: number;
  /** Bump to add a page (Insert > Break > Page break). */
  pageTick?: number;
  /** Called on every document change with the flat HTML + serialized boxes. */
  onDocChange: (html: string, boxesJson: string) => void;
  /** Show the end-of-document tombstone (small black square) on the last page. */
  tombstone?: boolean;
  /** The publication's master pages and who is assigned to which page. */
  master?: MasterSet;
  /** Master-page view: the furniture is editable in place, the page is not. */
  masterMode?: boolean;
  /** Fired when a master band receives focus, so the Master Pages ribbon
      knows where to drop Insert Page Number / Date / Time. */
  onMasterBandFocus?: (key: BandKey) => void;
  /** Bumped when the master's text was changed off-page, to re-seed the bands. */
  masterRev?: number;
  /** Document title, for the @title field token. */
  docTitle?: string;
  /** The user typed into one of the master's bands. */
  onMasterBandChange?: (masterId: string, key: BandKey, patch: { text: string }) => void;
  /** Insert > Header & Footer field: drop this token into the focused band, at
      the caret, without disturbing the rest of the line. */
  masterToken?: { token: string; tick: number };
  /** Open a different master page for editing (the pane's master tiles). */
  onSelectMaster?: (id: string) => void;
  /**
   * Open the master-page view. Publisher's shortcut: double-clicking the
   * paper *outside* the master's text column (i.e. in the margin, where the
   * running head and folio live) jumps straight into the master editor.
   */
  onOpenMaster?: () => void;
}

let boxSeq = 0;
function newBoxId(): string {
  boxSeq += 1;
  return `tb${Date.now().toString(36)}${boxSeq.toString(36)}`;
}

/**
 * Mirror a frame's standard type onto its contentEditable host.
 *
 * Ctrl+A inside a box selects the *contents*, and typing over that selection
 * replaces the styled blocks with a single new one - which loses a title's 48pt
 * Franklin Gothic Heavy and, in a frame whose entries are display type, hands
 * that display type to the whole page. Putting the frame's standard (its own
 * `data-text` declaration, or the type its blocks agree on) on the host as an
 * inline style means the replacement text inherits exactly the type the frame
 * was designed around - see `src/lib/frameStyle.ts` for the whys, and
 * `stripBorrowedType` for the other half of the fix.
 */
function mirrorBoxFont(el: HTMLElement, box?: { css?: string; align?: string }): void {
  mirrorFrameStyle(el, box?.css, box?.align);
}

/** True when the HTML holds anything worth editing (text, image, table…). */
function hasRealContent(html: string): boolean {
  if (!html || !html.trim()) return false;
  const d = document.createElement('div');
  d.innerHTML = html;
  return Boolean(
    d.textContent?.trim() || d.querySelector('img,table,svg,hr,video,iframe'),
  );
}

/** Compare HTML ignoring the transient data-flow markers the flow engine adds. */
const normHtml = (s: string) =>
  (s || '').replace(/\s*data-flow="[^"]*"/g, '').trim();

/* ----------------------------------------------------- legacy splitting -- */

let measureHost: HTMLDivElement | null = null;

/**
 * One hidden, laid-out div reused for every "how tall is this element?"
 * question during migration. Styled to match `.page-box-content` so the
 * measured height is the height the box will actually need.
 */
function getMeasureHost(): HTMLDivElement {
  if (measureHost && document.body.contains(measureHost)) return measureHost;
  const m = document.createElement('div');
  m.setAttribute('aria-hidden', 'true');
  m.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'box-sizing:border-box',
    'margin:0',
    'padding:4px',
    'font-size:11pt',
    'line-height:1.5',
    'overflow-wrap:break-word',
  ].join(';');
  document.body.appendChild(m);
  measureHost = m;
  return m;
}

/* Elements that are a single content unit (never unwrapped). */
const LEAF_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE',
  'TABLE', 'IMG', 'HR', 'VIDEO', 'IFRAME',
]);
/* Inline runs - a wrapper holding only these is itself a text unit. */
const INLINE_TAGS = new Set([
  'SPAN', 'A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SMALL', 'SUB',
  'SUP', 'MARK', 'BR', 'CODE', 'FONT', 'ABBR', 'CITE', 'Q', 'TIME', 'KBD',
  'BIG', 'WBR', 'PICTURE', 'SOURCE',
]);

/** A leaf is one content unit: a heading, paragraph, list, image, rule… */
function isLeafBlock(el: Element): boolean {
  if (LEAF_TAGS.has(el.tagName)) return true;
  const kids = Array.from(el.children);
  if (kids.length === 0) return true; // bare text run
  // A wrapper holding only inline elements (e.g. <div>hello <b>world</b></div>)
  // is a single text unit, not a layout container.
  return kids.every((k) => INLINE_TAGS.has(k.tagName));
}

/**
 * Flatten layout containers (flex header rows, section wrappers…) so every
 * leaf becomes its own frame. Order is preserved, so stacking follows the
 * document order after unwrapping.
 */
function collectLeaves(root: Element, out: HTMLElement[]): void {
  for (const child of Array.from(root.children) as HTMLElement[]) {
    if (isLeafBlock(child)) out.push(child);
    else collectLeaves(child, out);
  }
}

/**
 * Split flat (Word-style) page HTML into one box per content element, so
 * each heading, paragraph, list, image and horizontal line becomes its own
 * independently movable/resizable frame - Publisher-style. Layout wrappers
 * (flex rows, section divs…) are unwrapped, elements are stacked down the
 * margin column, and they flow onto extra pages when they no longer fit.
 * Pure spacing elements (empty paragraphs) are dropped.
 */
export function splitIntoBoxes(
  content: string,
  page: { width: number; height: number },
  inset?: { x: number; width: number },
): TextBox[] {
  // No margins: a frame may sit anywhere on the sheet, so stacked content uses
  // the whole page as its column. An `inset` narrows that column (and shifts it
  // right) so a split sheet's frames land inside the master page's frame.
  const colW = Math.max(MIN_W, inset?.width ?? page.width);
  const colX = Math.max(0, inset?.x ?? 0);
  const contentW = colW;
  const contentH = Math.max(MIN_H, page.height);

  const host = document.createElement('div');
  host.innerHTML = content || '';
  const leaves: HTMLElement[] = [];
  collectLeaves(host, leaves);
  if (leaves.length === 0) {
    // Bare inline runs / text nodes have no elements to split; keep them as a
    // single full-page box so nothing is lost.
    if (!hasRealContent(content)) return [];
    return [
      {
        id: newBoxId(),
        pageIndex: 0,
        x: 0,
        y: 0,
        w: contentW,
        h: contentH,
        html: content,
        nextId: null,
      },
    ];
  }

  const meas = getMeasureHost();
  meas.style.width = `${contentW}px`;

  const out: TextBox[] = [];
  let pageIndex = 0;
  let y = 0;

  const place = (entry: {
    html?: string;
    kind?: 'image';
    src?: string;
    x?: number;
    w: number;
    h: number;
    radius?: number;
    fade?: number;
    fit?: 'cover' | 'contain';
    ph?: string;
  }) => {
    out.push({
      id: newBoxId(),
      pageIndex,
      x: colX + (entry.x ?? 0),
      y,
      w: entry.w,
      h: entry.h,
      html: entry.html ?? '',
      kind: entry.kind,
      src: entry.src,
      radius: entry.radius,
      fade: entry.fade,
      fit: entry.fit,
      ph: entry.ph,
      nextId: null,
    });
    y += entry.h + SPLIT_GAP;
    if (y > page.height) {
      pageIndex += 1;
      y = 0;
    }
  };

  for (const el of leaves) {
    // A top-level image becomes its own image box - a picture is an object
    // on the page, never content inside a text frame.
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') || '';
      if (!src) continue;
      const img = el as HTMLImageElement;
      // An explicit inline size wins (templates set logo dimensions);
      // otherwise use the natural size, or a sane placeholder until load.
      const styleW = parseFloat(img.style.width);
      const styleH = parseFloat(img.style.height);
      let w = styleW || img.naturalWidth || img.offsetWidth || 320;
      let h = styleH || Math.round(w * ((img.naturalHeight || 3) / (img.naturalWidth || 4)));
      if (w > contentW) {
        h = Math.round(h * (contentW / w));
        w = contentW;
      }
      w = Math.max(MIN_W, Math.min(Math.round(w), contentW));
      h = Math.max(MIN_H, Math.min(Math.round(h), contentH));
      // Templates may carry data-radius/data-fade so sample artwork opens
      // pre-styled (rounded corners / soft faded edges).
      const radius = Math.max(0, Math.min(2000, parseFloat(img.getAttribute('data-radius') || '') || 0));
      const fade = Math.max(0, Math.min(2000, parseFloat(img.getAttribute('data-fade') || '') || 0));
      // data-fit pins how the picture fills its frame: the graphic page asks
      // for `contain` so artwork is never cropped.
      const fitAttr = img.getAttribute('data-fit');
      const fit = fitAttr === 'contain' ? 'contain' as const : fitAttr === 'cover' ? 'cover' as const : undefined;
      // data-ph marks an empty image frame: the box opens as a click-to-add
      // placeholder (dashed 'add image' cover) instead of showing artwork.
      const ph = img.getAttribute('data-ph') || undefined;
      place({
        kind: 'image',
        src: ph ? TRANSPARENT_GIF : src,
        x: Math.round((contentW - w) / 2),
        w,
        h,
        radius,
        fade,
        fit,
        ph,
      });
      continue;
    }
    const isHr = el.tagName === 'HR';
    const hasMedia = !!el.querySelector('img,table,svg,video,iframe');
    const text = (el.textContent ?? '').trim();
    if (!text && !hasMedia && !isHr) continue; // spacing-only element

    let h: number;
    if (isHr) {
      h = 24; // a rule renders as one thin line
    } else {
      meas.innerHTML = '';
      meas.appendChild(el.cloneNode(true));
      h = Math.ceil(meas.offsetHeight);
    }
    if (hasMedia) h = Math.max(h, 80); // unloaded images measure short
    place({ html: el.outerHTML, w: contentW, h: Math.max(isHr ? 20 : MIN_H, Math.min(h, contentH)) });
  }
  return out;
}

/**
 * Turn a document into the box model.
 * - `boxes` present → load them verbatim (each keeps its own html + page),
 *   except a single full-page box, which is the old coarse migration and is
 *   re-split per element so headings, images and lines each get a frame.
 * - otherwise legacy page HTML → one box per content element, stacked and
 *   flowed across pages.
 * Fresh ids are minted on every build so a rebuild remounts the DOM cleanly;
 * stored `nextId` links are remapped to the new ids.
 */
function buildModel(
  content: string,
  boxesJson: string | undefined,
  page: { width: number; height: number },
  /** The document was saved before the marker became an object on the sheet:
      add one to the last page so an old piece still ends properly. */
  legacyTombstone = false,
): TextBox[] {
  const boxes = withLegacyTombstone(buildBoxes(content, boxesJson, page), page, legacyTombstone);
  // The marker is pinned furniture, not a placed object: a document saved when
  // a template put one in the middle of the type (the poem used to centre it
  // under the stanzas) is snapped into the standard corner as it opens.
  return boxes.map((b) =>
    b.kind === 'tombstone' && tombstoneOffCorner(b, page) ? { ...b, ...tombstoneCorner(page) } : b,
  );
}

/** The end-of-piece marker, pinned outside the master frame in the last page's
    bottom-right corner (see `src/lib/marker.ts`). */
function tombstoneBox(pageIndex: number, page: { width: number; height: number }): TextBox {
  return {
    id: newBoxId(),
    pageIndex,
    ...tombstoneCorner(page),
    html: '',
    nextId: null,
    kind: 'tombstone',
  };
}

/**
 * Migrate a document that carried the old document-level tombstone flag: the
 * marker is a frame now, so an open piece gets a real one. Idempotent - a
 * document that already holds one is left alone. Never throws.
 */
function withLegacyTombstone(
  boxes: TextBox[],
  page: { width: number; height: number },
  legacy: boolean,
): TextBox[] {
  if (!legacy || boxes.some((b) => b.kind === 'tombstone')) return boxes;
  const lastPage = boxes.reduce((m, b) => Math.max(m, b.pageIndex), 0);
  return [...boxes, tombstoneBox(lastPage, page)];
}

function buildBoxes(
  content: string,
  boxesJson: string | undefined,
  page: { width: number; height: number },
): TextBox[] {
  if (boxesJson) {
    try {
      const parsed = JSON.parse(boxesJson) as Array<Partial<TextBox>>;
      if (Array.isArray(parsed)) {
        const raw = parsed.filter(
          (b) => b && typeof b.x === 'number' && typeof b.y === 'number',
        );
        if (raw.length) {
          // Remap stored ids to fresh ids, translating stored links.
          const idMap = new Map<string, string>();
          for (const b of raw) {
            if (typeof b.id === 'string' && !idMap.has(b.id)) {
              idMap.set(b.id, newBoxId());
            }
          }
          const list = raw.map((b) => ({
            id: (typeof b.id === 'string' && idMap.get(b.id)) || newBoxId(),
            pageIndex: Math.max(0, b.pageIndex ?? 0),
            x: Math.max(0, Math.min(b.x ?? 0, page.width - MIN_W)),
            y: Math.max(0, Math.min(b.y ?? 0, page.height - MIN_H)),
            w: Math.max(MIN_W, Math.min(b.w ?? 200, page.width)),
            h: Math.max(MIN_H, Math.min(b.h ?? 120, page.height)),
            html: typeof b.html === 'string' ? b.html : '',
            kind:
              b.kind === 'image'
                ? ('image' as const)
                : b.kind === 'sheet'
                  ? ('sheet' as const)
                  : b.kind === 'shape'
                    ? ('shape' as const)
                    : b.kind === 'line'
                      ? ('line' as const)
                      : b.kind === 'pdf'
                        ? ('pdf' as const)
                        : b.kind === 'tombstone'
                          ? ('tombstone' as const)
                          : undefined,
            src: typeof b.src === 'string' ? b.src : undefined,
            pdfPage:
              typeof b.pdfPage === 'number' ? Math.max(1, Math.round(b.pdfPage)) : undefined,
            radius:
              typeof b.radius === 'number'
                ? Math.max(0, Math.min(2000, Math.round(b.radius)))
                : undefined,
            fade:
              typeof b.fade === 'number'
                ? Math.max(0, Math.min(2000, Math.round(b.fade)))
                : undefined,
            fit: b.fit === 'contain' ? ('contain' as const) : b.fit === 'cover' ? ('cover' as const) : undefined,
            fill: typeof b.fill === 'string' ? b.fill : undefined,
            stroke: typeof b.stroke === 'string' ? b.stroke : undefined,
            thickness:
              typeof b.thickness === 'number'
                ? Math.max(1, Math.min(200, Math.round(b.thickness)))
                : undefined,
            columns:
              typeof b.columns === 'number' && b.columns >= 1
                ? Math.min(4, Math.round(b.columns))
                : undefined,
            ph: typeof b.ph === 'string' ? b.ph : undefined,
            align:
              b.align === 'center' || b.align === 'right' || b.align === 'justify' || b.align === 'left'
                ? b.align
                : undefined,
            css: typeof b.css === 'string' ? sanitizeFrameText(b.css) : undefined,
            nextId:
              typeof b.nextId === 'string' ? idMap.get(b.nextId) ?? null : null,
          }));
          // An image saved inside a text box (old format) is promoted to a
          // proper image box so pictures are never text content.
          const promoted = list.map((b) => {
            if (b.kind !== 'image' && b.html) {
              const probe = document.createElement('div');
              probe.innerHTML = b.html;
              const first = probe.firstElementChild;
              const onlyImg =
                first &&
                first.tagName === 'IMG' &&
                !(probe.textContent ?? '').trim() &&
                probe.children.length === 1;
              if (onlyImg) {
                return {
                  ...b,
                  kind: 'image' as const,
                  src: (first as HTMLElement).getAttribute('src') ?? '',
                  html: '',
                };
              }
            }
            return b;
          });
          // A deliberate full-page frame - a template that asked for one text
          // box (any column count, including 1) - always carries a numeric
          // `columns`. Those are kept whole so the Columns toolbar reads the
          // right count and the gray column rule is drawn. Only an old
          // *coarse* box with no column setting is treated as the legacy
          // migration and re-split per element.
          const deliberateFrame = typeof list[0].columns === 'number';
          const coarse =
            !deliberateFrame &&
            list.length === 1 &&
            Math.abs(list[0].w - Math.max(MIN_W, page.width - LEGACY_MARGIN.left - LEGACY_MARGIN.right)) < 2 &&
            Math.abs(list[0].x - LEGACY_MARGIN.left) < 2 &&
            list[0].h >= Math.max(MIN_H, page.height - LEGACY_MARGIN.top - LEGACY_MARGIN.bottom) - 2;
          if (!coarse) return promoted;
        }
      }
    } catch {
      /* fall through to the legacy migration */
    }
  }
  return splitIntoBoxes(content, page);
}
/** Serialized form of one box for snapshots/storage. */
interface BoxEntry {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  html: string;
  nextId: string | null;
  kind?: 'image' | 'sheet' | 'shape' | 'line' | 'pdf' | 'tombstone';
  src?: string;
  pdfPage?: number;
  radius?: number;
  fade?: number;
  fit?: 'cover' | 'contain';
  fill?: string;
  stroke?: string;
  thickness?: number;
  ph?: string;
  columns?: number;
}
export default function DocumentCanvas({
  zoom,
  spellCheck,
  showRuler,
  page,
  readOnly = false,
  content,
  boxes,
  rev,
  textboxTick,
  imageTick,
  imageSrc,
  shapeTick = 0,
  lineTick = 0,
  tombstoneTick = 0,
  pageNames,
  onPageNamesChange,
  onAssignMaster,
  columnsTick = 0,
  columnsCount = 1,
  pageTick = 0,
  onDocChange,
  tombstone = false,
  master,
  masterMode = false,
  masterRev = 0,
  docTitle = '',
  onMasterBandChange,
  onMasterBandFocus,
  onOpenMaster,
  masterToken,
  onSelectMaster,
}: DocumentCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // An absent master renders nothing rather than crashing the canvas.
  const masterSet: MasterSet | null = master ?? null;
  /** The master-page tab key the user last clicked into, so the ribbon's Insert
      Page Number / Date / Time lands in the band they were editing. */
  const [focusedBandKey, setFocusedBandKey] = useState<BandKey | null>(null);

  // There are no margins: a frame may sit anywhere on the sheet, at any size,
  // so nothing here constrains placement to a text column.

  const [boxesState, setBoxesState] = useState<TextBox[]>(() =>
    buildModel(content, boxes, page, tombstone),
  );
  const boxesRef = useRef(boxesState);
  const [selId, setSelId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const editIdRef = useRef<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const lastImageTickRef = useRef(0);
  const lastShapeTickRef = useRef(0);
  const lastLineTickRef = useRef(0);
  const lastTombstoneTickRef = useRef(0);
  const lastTickRef = useRef(textboxTick);
  /** Page the user last clicked / worked on - where new boxes are added. */
  const activePageRef = useRef(0);
  /** Highlighted page (sidebar + insertion target). Kept in sync with the ref. */
  const [activePageUi, setActivePageUi] = useState(0);
  const activatePage = useCallback((p: number) => {
    activePageRef.current = Math.max(0, p);
    setActivePageUi(Math.max(0, p));
  }, []);

  // Master view always edits page 1's furniture (page 2 too for odd & even),
  // so jump there - otherwise the highlighted sidebar page and the sheet on
  // screen disagree.
  useEffect(() => {
    if (masterMode) activatePage(0);
  }, [masterMode, activatePage]);

  /** Last-snapshotted text of every box: used to seed frames that remount
      (page moves) and to paint the sidebar thumbnails without touching the
      live contentEditable DOM. */
  const liveHtml = useRef(new Map<string, string>());
  /** Bumped on every snapshot so thumbnails re-read `liveHtml`. */
  const [, setThumbRev] = useState(0);

  /** Boxes whose chain still has hidden text - they render red chrome. */
  const [overflowIds, setOverflowIds] = useState<Set<string>>(() => new Set());
  /** Paint-bucket pour: the armed source box and the valid empty targets. */
  const [pourSourceId, setPourSourceId] = useState<string | null>(null);
  const [pourTargets, setPourTargets] = useState<Set<string>>(() => new Set());
  /** Ref mirror of `pourSourceId` so plain handlers (insert, paper click) can
      read the armed state without re-wiring their identity. */
  const pourSourceIdRef = useRef<string | null>(null);
  useEffect(() => {
    pourSourceIdRef.current = pourSourceId;
  }, [pourSourceId]);

  const boxEls = useRef(new Map<string, HTMLDivElement>());
  const imgEls = useRef(new Map<string, HTMLImageElement>());
  /** Frame whose whole content is being replaced right now (see
      `handleBeforeInput`) - set between `beforeinput` and the `input` it
      causes, so the replacement can adopt the frame's standard type. */
  const wholesaleRef = useRef<string | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const firstRev = useRef(true);
  const { loadFont, isGoogleFont } = useGoogleFont();

  /** Set the box list, keeping the ref mirror in step. */
  const applyBoxes = useCallback((next: TextBox[]) => {
    boxesRef.current = next;
    setBoxesState(next);
  }, []);

  /* ------------------------------ undo / redo ------------------------------
   *
   * The text frames are uncontrolled contentEditables, so the browser's own
   * undo stack is not something we can rely on: re-seeding a frame (a page
   * move, a reflow) throws it away, and it can never undo a moved frame, a
   * column change or a deleted box. So the canvas keeps the document history
   * itself: a stack of serialized box states, one entry per "burst" of work.
   */
  const history = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const historyTimer = useRef<number | null>(null);
  /** True while a restore is writing the DOM, so it does not record itself. */
  const historySuspended = useRef(false);

  /** Serialize the document exactly as it stands on screen right now. */
  const captureState = useCallback((): string => {
    return JSON.stringify(
      boxesRef.current.map((b) => ({
        id: b.id,
        pageIndex: b.pageIndex,
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.w),
        h: Math.round(b.h),
        html: b.kind ? '' : boxEls.current.get(b.id)?.innerHTML ?? b.html,
        columns: b.columns,
        nextId: b.nextId,
        align: b.align,
        css: b.css,
        kind: b.kind,
        src: b.src,
        pdfPage: b.pdfPage,
        radius: b.radius,
        fade: b.fade,
        fit: b.fit,
        fill: b.fill,
        stroke: b.stroke,
        thickness: b.thickness,
        ph: b.ph,
      })),
    );
  }, []);

  /** Push the current state, dropping any redo trail ahead of it. */
  const commitHistory = useCallback(() => {
    if (historySuspended.current) return;
    const state = captureState();
    if (history.current.stack[history.current.index] === state) return;
    history.current.stack = history.current.stack.slice(0, history.current.index + 1);
    history.current.stack.push(state);
    if (history.current.stack.length > MAX_HISTORY) history.current.stack.shift();
    history.current.index = history.current.stack.length - 1;
  }, [captureState]);

  /** Record a step. Debounced by default so a typing burst or a drag is one
      undo step; `immediate` records the state as it stands right now. */
  const pushHistory = useCallback(
    (immediate = false) => {
      if (historySuspended.current) return;
      if (historyTimer.current !== null) window.clearTimeout(historyTimer.current);
      if (immediate) {
        historyTimer.current = null;
        commitHistory();
        return;
      }
      historyTimer.current = window.setTimeout(() => {
        historyTimer.current = null;
        commitHistory();
      }, HISTORY_DEBOUNCE);
    },
    [commitHistory],
  );

  /** Flat HTML of the whole document + per-box geometry/content snapshot.
      `pushHistory: false` is for callers that are *restoring* a state (undo,
      redo, version restore) rather than making a new one. */
  const snapshot = useCallback((recordHistory = true) => {
    for (const b of boxesRef.current) {
      if (b.kind) continue; // image/sheet boxes have no live text
      const el = boxEls.current.get(b.id);
      liveHtml.current.set(b.id, el ? el.innerHTML : b.html);
    }
    const entries: BoxEntry[] = boxesRef.current.map((b) => {
      const el = boxEls.current.get(b.id);
      if (b.kind) {
        // Image, shape, line and empty-page markers have no live text.
        return {
          id: b.id,
          pageIndex: b.pageIndex,
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: Math.round(b.w),
          h: Math.round(b.h),
          html: '',
          nextId: b.nextId,
          kind: b.kind,
          src: b.src,
          pdfPage: b.pdfPage,
          radius: typeof b.radius === 'number' ? Math.round(b.radius) : undefined,
          fade: typeof b.fade === 'number' ? Math.round(b.fade) : undefined,
          fit: b.fit,
          fill: b.fill,
          stroke: b.stroke,
          thickness: typeof b.thickness === 'number' ? Math.round(b.thickness) : undefined,
          ph: b.ph,
        };
      }
      return {
        id: b.id,
        pageIndex: b.pageIndex,
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.w),
        h: Math.round(b.h),
        html: el ? el.innerHTML : b.html,
        // Keep an explicit 1 so a deliberate single-column frame survives a
        // reload as one frame instead of being re-split per element.
        columns: b.columns ? Math.max(1, b.columns) : undefined,
        nextId: b.nextId,
        // The frame's standard outlives the session: a retype after a reload
        // must still adopt it rather than the first block's borrowed type.
        align: b.align,
        css: b.css,
      };
    });
    setThumbRev((r) => r + 1);
    onDocChange(
      entries.map((e) => e.html).join(''),
      JSON.stringify(entries),
    );
    if (recordHistory) pushHistory();
  }, [onDocChange, pushHistory]);

  /**
   * The overflow/flow engine.
   *
   * Linked chains (boxes chained via `nextId`) share one story: the chain's
   * live contents are pooled, then redistributed so each box shows exactly
   * what fits. The last box of a chain holds whatever is left; if even it
   * cannot show everything, the chain is in overflow and its chrome turns
   * red. Re-running this after every edit or resize makes links self-heal -
   * growing a box pulls text back from the next one, shrinking pushes more
   * text downstream.
   */
  const reflowAll = useCallback(() => {
    const list = boxesRef.current;
    if (!list.length) return;
    const byId = new Map(list.map((b) => [b.id, b]));
    const incoming = new Set<string>();
    for (const b of list) if (b.nextId) incoming.add(b.nextId);

    const overflow = new Set<string>();

    for (const head of list) {
      if (!head.nextId || incoming.has(head.id)) continue; // not a chain head
      // Walk the chain in flow order (guards against corrupt cycles).
      const chain: TextBox[] = [];
      const seen = new Set<string>();
      let cur: string | null = head.id;
      while (cur && !seen.has(cur) && byId.has(cur)) {
        seen.add(cur);
        const b: TextBox = byId.get(cur)!;
        chain.push(b);
        cur = b.nextId;
      }

      // The story is whatever the chain's boxes hold right now; recompose
      // merges the head/tail fragments a previous flow left behind so the
      // round-trip stays stable.
      const story = recomposeStory(
        chain.map((b) => boxEls.current.get(b.id)?.innerHTML ?? b.html),
      );
      const result = flowStory(
        story,
        chain.map((b: TextBox) => ({
          id: b.id,
          storyId: '',
          pageIndex: b.pageIndex,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          columns: Math.max(1, Math.round(b.columns ?? 1)),
          nextId: b.nextId,
        })),
      );

      chain.forEach((b, i) => {
        const el = boxEls.current.get(b.id);
        if (!el) return;
        const slice = result.slices[i]?.html ?? '';
        if (normHtml(el.innerHTML) !== normHtml(slice)) {
          // The box is being rewritten under the user; keep the caret where
          // it was (it may now sit in a different box's worth of text).
          const keepCaret = editIdRef.current === b.id;
          const off = keepCaret ? caretOffsetIn(el) : null;
          el.innerHTML = slice;
          if (keepCaret && off !== null) setCaretOffset(el, off);
        }
        if (i === chain.length - 1 && result.overflow) overflow.add(b.id);
      });
    }

    // Standalone boxes: red chrome when their own content clips. Compare
    // against the box's *state* height with a safety tolerance so normal typing
    // and subpixel font metrics don't falsely turn the chrome red.
    for (const b of list) {
      if (b.nextId || incoming.has(b.id) || b.kind) continue;
      const el = boxEls.current.get(b.id);
      if (!el) continue;
      const cols = Math.max(1, Math.min(3, Math.round(b.columns ?? 1)));
      if (cols > 1) {
        if (el.scrollWidth > el.clientWidth + 4) overflow.add(b.id);
      } else {
        if (el.scrollHeight > b.h + 6) overflow.add(b.id);
      }
    }

    setOverflowIds((prev) => {
      if (prev.size === overflow.size && [...overflow].every((id) => prev.has(id))) {
        return prev;
      }
      return overflow;
    });
  }, []);

  /**
   * Put a recorded state back on the sheet.
   *
   * Boxes that survive are rewritten in place (their live contentEditable DOM
   * is the source of truth, so React must not be allowed to re-seed it);
   * boxes that come back are re-mounted by React and seeded from `liveHtml`,
   * which is why every entry is copied there first.
   */
  const restoreState = useCallback(
    (state: string) => {
      let entries: Array<Record<string, unknown>>;
      try {
        const parsed = JSON.parse(state);
        if (!Array.isArray(parsed)) return;
        entries = parsed as Array<Record<string, unknown>>;
      } catch {
        return;
      }
      historySuspended.current = true;
      const next: TextBox[] = entries.map((e) => {
        const html = typeof e.html === 'string' ? e.html : '';
        const id = String(e.id);
        if (html) {
          liveHtml.current.set(id, html);
          const el = boxEls.current.get(id);
          if (el && e.kind !== 'image' && e.kind !== 'sheet') {
            el.innerHTML = html;
            el.dataset.seeded = '1';
          }
        }
        return {
          id,
          pageIndex: Number(e.pageIndex ?? 0),
          x: Number(e.x ?? 0),
          y: Number(e.y ?? 0),
          w: Number(e.w ?? MIN_W),
          h: Number(e.h ?? MIN_H),
          html,
          nextId: (e.nextId as string | null) ?? null,
          kind: e.kind as TextBox['kind'],
          src: typeof e.src === 'string' ? e.src : undefined,
          pdfPage: typeof e.pdfPage === 'number' ? e.pdfPage : undefined,
          radius: typeof e.radius === 'number' ? e.radius : undefined,
          fade: typeof e.fade === 'number' ? e.fade : undefined,
          fit: e.fit === 'contain' ? 'contain' : e.fit === 'cover' ? 'cover' : undefined,
          fill: typeof e.fill === 'string' ? e.fill : undefined,
          stroke: typeof e.stroke === 'string' ? e.stroke : undefined,
          thickness: typeof e.thickness === 'number' ? e.thickness : undefined,
          ph: typeof e.ph === 'string' ? e.ph : undefined,
          columns: typeof e.columns === 'number' ? e.columns : undefined,
        };
      });
      setSelId(null);
      setEditId(null);
      editIdRef.current = null;
      setOverflowIds(new Set());
      setPourSourceId(null);
      setPourTargets(new Set());
      applyBoxes(next);
      // Let React commit the new/removed frames before re-flowing and telling
      // the app what the document now holds.
      window.setTimeout(() => {
        historySuspended.current = false;
        reflowAll();
        snapshot(false);
      }, 0);
    },
    [applyBoxes, reflowAll, snapshot],
  );

  /** Undo the last recorded step. */
  const undoHistory = useCallback(() => {
    // Fold any pending (debounced) edit into the stack first: the step the
    // user wants back is the one they just made.
    if (historyTimer.current !== null) {
      window.clearTimeout(historyTimer.current);
      historyTimer.current = null;
      commitHistory();
    }
    if (history.current.index <= 0) return;
    history.current.index -= 1;
    restoreState(history.current.stack[history.current.index]);
  }, [commitHistory, restoreState]);

  /** Redo a step that was undone. */
  const redoHistory = useCallback(() => {
    if (historyTimer.current !== null) {
      window.clearTimeout(historyTimer.current);
      historyTimer.current = null;
      commitHistory();
    }
    if (history.current.index >= history.current.stack.length - 1) return;
    history.current.index += 1;
    restoreState(history.current.stack[history.current.index]);
  }, [commitHistory, restoreState]);

  /* Seed the history with the document as it first appears, and let the menu,
     the toolbar and the keyboard reach this canvas's undo / redo. */
  useEffect(() => {
    pushHistory(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    registerHistory((kind) => (kind === 'undo' ? undoHistory() : redoHistory()));
    return () => registerHistory(null);
  }, [undoHistory, redoHistory]);

  /** Number of pages the current boxes span. */
  const pageCount = useMemo(
    () => Math.max(1, ...boxesState.map((b) => b.pageIndex + 1)),
    [boxesState],
  );

  /* -------- (re)build the box model when the document changes -------- */
  useEffect(() => {
    if (firstRev.current) {
      firstRev.current = false;
      return;
    }
    const next = buildModel(content, boxes, page, tombstone);
    applyBoxes(next);
    setSelId(null);
    setEditId(null);
    editIdRef.current = null;
    activatePage(0);
    setOverflowIds(new Set());
    setPourSourceId(null);
    setPourTargets(new Set());
    registerEditor(null);
    // A whole new document was swapped in (import, version restore): the old
    // history describes states that no longer exist, so start again.
    history.current = { stack: [], index: -1 };
    if (historyTimer.current !== null) {
      window.clearTimeout(historyTimer.current);
      historyTimer.current = null;
    }
    window.setTimeout(() => pushHistory(true), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  // After seeding, run one overflow pass so documents that open in overflow
  // show their red chrome right away.
  useEffect(() => {
    const t = setTimeout(() => reflowAll(), 90);
    return () => clearTimeout(t);
  }, [boxesState, reflowAll]);

  useEffect(() => {
    initEditorCommands();
    const stopTracking = startSelectionTracking();
    return () => {
      stopTracking();
      registerEditor(null);
    };
  }, []);

  /* -------- Insert > Text box: add one and start typing in it -------- */
  useEffect(() => {
    if (lastTickRef.current === textboxTick) return;
    lastTickRef.current = textboxTick;
    const targetPage = Math.min(activePageRef.current, pageCount - 1);
    const onPage = boxesRef.current.filter((b) => b.pageIndex === targetPage);
    const n = onPage.length;
    const w = Math.min(360, Math.max(240, Math.round(page.width * 0.48)));
    const h = 150;
    // Drop it below whatever is already on the page, cascading right a little
    // each time so consecutive inserts do not stack exactly. No margins - the
    // box may sit anywhere on the sheet.
    const lowest = onPage.reduce((mx, b) => Math.max(mx, b.y + b.h), 0);
    const x = Math.min((n % 3) * 26, Math.max(0, page.width - w));
    const y = Math.min(Math.max(0, lowest + SPLIT_GAP), Math.max(0, page.height - h));
    const box: TextBox = { id: newBoxId(), pageIndex: targetPage, x, y, w, h, html: '', nextId: null, kind: undefined, src: undefined };
    applyBoxes([...boxesRef.current, box]);
    setSelId(box.id);
    // Inserting while a pour is armed: the fresh empty box is exactly what
    // the user is about to pour into - make it a target and leave it
    // unopened so the pour click lands on it instead of dropping a caret.
    if (pourSourceIdRef.current) {
      setPourTargets((prev) => new Set(prev).add(box.id));
    } else {
      setEditId(box.id);
      setPendingFocus(box.id);
    }
    snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textboxTick]);

  /* -------- Insert > Image: add a dedicated image box --------
     A picture is its own object on the page (Publisher-style): it gets a
     resizable frame that holds only the image - no text editing, no story
     flow. `imageTick` bumps when the user picks a file. */
  useEffect(() => {
    if (!imageTick || imageTick === lastImageTickRef.current) return;
    lastImageTickRef.current = imageTick;
    const targetPage = Math.min(activePageRef.current, pageCount - 1);
    const onPage = boxesRef.current.filter((b) => b.pageIndex === targetPage);
    const w = Math.min(360, Math.max(240, Math.round(page.width * 0.48)));
    const h = Math.round((w * 3) / 4);
    // Below whatever is already there, centred across the sheet. No margins.
    const lowest = onPage.reduce((mx, b) => Math.max(mx, b.y + b.h), 0);
    const x = Math.round((page.width - w) / 2);
    const y = Math.min(Math.max(0, lowest + SPLIT_GAP), Math.max(0, page.height - h));
    const box: TextBox = {
      id: newBoxId(),
      pageIndex: targetPage,
      x,
      y,
      w,
      h,
      html: '',
      nextId: null,
      kind: 'image',
      src: imageSrc,
    };
    applyBoxes([...boxesRef.current, box]);
    setSelId(box.id);
    setEditId(null);
    snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageTick]);

  /* -------- Insert > Shape: an orange rectangle as its own object --------
     A shape is a page object like a picture - never text - so the cards and
     banners in a template can be moved, resized and recoloured on their own. */
  useEffect(() => {
    if (!shapeTick || shapeTick === lastShapeTickRef.current) return;
    lastShapeTickRef.current = shapeTick;
    const targetPage = Math.min(activePageRef.current, pageCount - 1);
    const onPage = boxesRef.current.filter((b) => b.pageIndex === targetPage);
    const w = Math.round(page.width * 0.34);
    const h = 150;
    const lowest = onPage.reduce((mx, b) => Math.max(mx, b.y + b.h), 0);
    const x = Math.round((page.width - w) / 2) + (onPage.length % 3) * 18;
    const y = Math.min(Math.max(0, lowest + SPLIT_GAP), Math.max(0, page.height - h));
    const box: TextBox = {
      id: newBoxId(),
      pageIndex: targetPage,
      x: Math.min(Math.max(0, x), Math.max(0, page.width - w)),
      y,
      w,
      h,
      html: '',
      nextId: null,
      kind: 'shape',
      fill: '#fe9c53',
      radius: 8,
    };
    applyBoxes([...boxesRef.current, box]);
    setSelId(box.id);
    setEditId(null);
    snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeTick]);

  /* -------- Insert > Line: a free-standing, movable rule --------
     Unlike Insert > Break (which was never a real object), a line is a box on
     the sheet: drag it anywhere, resize it, recolour it. */
  useEffect(() => {
    if (!lineTick || lineTick === lastLineTickRef.current) return;
    lastLineTickRef.current = lineTick;
    const targetPage = Math.min(activePageRef.current, pageCount - 1);
    const onPage = boxesRef.current.filter((b) => b.pageIndex === targetPage);
    const w = Math.round(page.width * 0.5);
    const lowest = onPage.reduce((mx, b) => Math.max(mx, b.y + b.h), 0);
    const x = Math.round((page.width - w) / 2);
    const y = Math.min(Math.max(0, lowest + SPLIT_GAP), Math.max(0, page.height - 24));
    const box: TextBox = {
      id: newBoxId(),
      pageIndex: targetPage,
      x,
      y,
      w,
      h: 10,
      html: '',
      nextId: null,
      kind: 'line',
      stroke: '#3f3f3f',
      thickness: 2,
    };
    applyBoxes([...boxesRef.current, box]);
    setSelId(box.id);
    setEditId(null);
    snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineTick]);

  /* -------- Insert > Tombstone: the end-of-piece marker --------
     The square is an object on the sheet, so it can be switched on and off
     from Insert ▸ Tombstone / Format ▸ Tombstone. It is deliberately *not*
     movable or resizable: it is placed where the template (or the default
     bottom-right corner) puts it, and it always paints above the content.
     Bumping the same tick twice on one page takes it off again. */
  useEffect(() => {
    if (!tombstoneTick || tombstoneTick === lastTombstoneTickRef.current) return;
    lastTombstoneTickRef.current = tombstoneTick;
    const targetPage = Math.min(activePageRef.current, pageCount - 1);
    const list = boxesRef.current;
    const existing = list.filter(
      (b) => b.kind === 'tombstone' && b.pageIndex === targetPage,
    );
    if (existing.length) {
      applyBoxes(
        list.filter((b) => !(b.kind === 'tombstone' && b.pageIndex === targetPage)),
      );
      setSelId(null);
      snapshot();
      return;
    }
    const box: TextBox = tombstoneBox(targetPage, page);
    applyBoxes([...list, box]);
    setSelId(null);
    setEditId(null);
    snapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tombstoneTick]);

  /* Register the box being edited so the toolbar commands (bold, fonts,
     colours…) operate on its content. The box stays registered after editing
     ends so find/replace and menu actions keep a target until the user picks
     another box. */
  useEffect(() => {
    if (!editId) return;
    const el = boxEls.current.get(editId);
    if (el) {
      registerEditor(el);
      requestAnimationFrame(() => {
        el.focus({ preventScroll: true });
        // Keep the caret in view (e.g. freshly inserted box near the bottom).
        el.scrollIntoView({ block: 'nearest' });
      });
    }
  }, [editId]);

  // Inserting a box sets editing in the same tick as the element is added;
  // retry the focus once the new DOM is in place.
  useEffect(() => {
    if (pendingFocus) {
      const id = pendingFocus;
      const el = boxEls.current.get(id);
      if (el) {
        setPendingFocus(null);
        registerEditor(el);
        el.focus({ preventScroll: true });
      }
    }
  }, [pendingFocus, boxesState]);

  /* Register content elements and seed them once (uncontrolled afterwards). */
  const registerBoxEl = useCallback(
    (id: string, html: string, el: HTMLDivElement | null, box?: TextBox) => {
      if (el) {
        boxEls.current.set(id, el);
        if (!el.dataset.seeded) {
          // Prefer the most recent snapshot so a frame that remounts (page
          // moved, box rebuilt) keeps the content the user typed.
          el.innerHTML = liveHtml.current.get(id) ?? html;
          el.dataset.seeded = '1';
          mirrorBoxFont(el, box);
        }
      } else {
        boxEls.current.delete(id);
      }
    },
    [],
  );

  /** Register the <img> of each image box so load-fitting can find it. */
  const registerImgEl = useCallback((id: string, el: HTMLImageElement | null) => {
    if (el) imgEls.current.set(id, el);
    else imgEls.current.delete(id);
  }, []);

  /* Re-inject stylesheets for any Google Font the seeded content references. */
  useEffect(() => {
    const root = pagesRef.current;
    if (!root) return;
    const used = new Set<string>();
    const walk = (el: Element) => {
      const stack = (el as HTMLElement).style?.getPropertyValue('font-family') ?? '';
      for (const f of GOOGLE_FONT_FAMILIES) {
        if (stack.toLowerCase().includes(f.toLowerCase())) used.add(f);
      }
      for (const child of Array.from(el.children)) walk(child);
    };
    walk(root);
    for (const family of used) {
      if (isGoogleFont(family)) loadFont(family);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  /* Clicking the empty paper clears the selection (ends editing), cancels an
     armed pour, and makes that page the target for Insert > Text box. */
  const paperMouseDown = (pageIndex: number) => {
    activatePage(pageIndex);
    setSelId(null);
    setEditId(null);
    // A pour stays armed across blank-paper clicks: its targets are empty
    // boxes only, so the user may need to deselect first (or insert a fresh
    // box) before clicking the real target. Escape / the bucket cancels it.
    if (!pourSourceIdRef.current) {
      setPourTargets(new Set());
    }
  };

  /**
   * Publisher's shortcut into the master editor.
   *
   * Every sheet carries a faint orange guide around the master page's frame. A
   * double-click *outside* that frame lands where the master's furniture lives
   * - the running head above it, the folio below - and opens the master page. A
   * double-click *inside* the frame is left alone: that is body text, where a
   * double-click selects a word.
   */
  const paperDoubleClick = (
    e: React.MouseEvent<HTMLDivElement>,
    pageIndex: number,
  ) => {
    if (readOnly || masterMode || !onOpenMaster) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Sheets are laid out in page coordinates then scaled as a whole, so undo
    // the transform to compare the click against the master frame.
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    const frame = masterFrameBox(page);
    const insideFrame =
      x >= frame.left &&
      x <= frame.left + frame.width &&
      y >= frame.top &&
      y <= frame.top + frame.height;
    if (insideFrame) return;
    activatePage(pageIndex);
    onOpenMaster();
  };

  /* Selection keyboard shortcuts: Delete removes the selected box, Escape
     leaves edit mode / cancels a pour / deselects. */
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const focusEl = document.activeElement as HTMLElement | null;
      // Typing/backspacing inside a text field (document title, find/replace,
      // menu search…) must never delete the selected box.
      if (
        focusEl &&
        (focusEl.isContentEditable ||
          focusEl.tagName === 'INPUT' ||
          focusEl.tagName === 'TEXTAREA' ||
          focusEl.tagName === 'SELECT')
      )
        return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selId && !editId) {
          e.preventDefault();
          removeBox(selId);
        }
      } else if (e.key === 'Escape') {
        if (pourSourceId) {
          setPourSourceId(null);
          setPourTargets(new Set());
        } else if (editId) setEditId(null);
        else if (selId) setSelId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, editId, pourSourceId, readOnly]);

  const scale = zoom / 100 || 1;

  type BoxPatch = {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    radius?: number;
    fade?: number;
    src?: string;
    fit?: 'cover' | 'contain';
    fill?: string;
    stroke?: string;
    thickness?: number;
    ph?: string;
    columns?: number;
  };
  const updateBox = useCallback(
    (id: string, patch: BoxPatch) => {
      const next = boxesRef.current.map((b) => (b.id === id ? { ...b, ...patch } : b));
      applyBoxes(next);
      // Resizing changes a chain link's capacity: redistribute right away so
      // text pulls back / pushes down live during the drag.
      reflowAll();
      snapshot();
    },
    [applyBoxes, reflowAll, snapshot],
  );

  /* Format > Columns: set the column count on the frame the user is working in.

     The count belongs to the frame *model*, not to the live DOM: the sidebar
     thumbnail, the 1/2/3 chrome on the frame and the saved file all read
     `box.columns`, and React rewrites the frame's inline column styles from it
     on the next render. Styling the DOM directly (the old behaviour) was
     therefore invisible to the document and thrown away a beat later. Target
     priority: the frame being typed in, then the selected one, then the first
     frame on the page the user is on. */
  const columnsTickRef = useRef(columnsTick);
  useEffect(() => {
    if (columnsTick === columnsTickRef.current) return;
    columnsTickRef.current = columnsTick;
    const target =
      editIdRef.current ??
      selId ??
      boxesRef.current.find(
        (b) => b.pageIndex === activePageRef.current && !b.kind,
      )?.id ??
      null;
    if (!target) return;
    updateBox(target, { columns: Math.max(1, Math.min(3, Math.round(columnsCount))) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsTick]);

  /* Images measure short until they load (height:auto, no dimensions yet), so
     migrated image boxes can start too small. When an image finishes loading
     inside a box, grow that box once to fit its content. Image boxes fit to
     their own <img> instead. */
  useEffect(() => {
    const fit = (id: string) => {
      const b = boxesRef.current.find((x) => x.id === id);
      if (!b) return;
      if (b.kind === 'image') {
        // An empty placeholder frame backs onto a 1×1 transparent GIF, so its
        // "natural" aspect is square - fitting to it would squash the shape a
        // template asked for (e.g. a full-page puzzle). Placeholders keep
        // their geometry until a real picture is dropped in.
        if (b.ph) return;
        // A full-page frame (the title page and the puzzle) is a fixed A4
        // window: the picture is cropped to it, never shrunk to sit inside it.
        if (b.w >= page.width - 1 && b.h >= page.height - 1) return;
        // Match the frame's aspect to the picture once it is known: the
        // height follows the CURRENT width (never stretch the frame).
        const img = imgEls.current.get(id);
        if (!img || !img.naturalWidth) return;
        const maxH = page.height;
        let h = Math.round((b.w * img.naturalHeight) / img.naturalWidth);
        let w = b.w;
        if (h > maxH) {
          h = Math.round(maxH);
          w = Math.max(MIN_W, Math.round((h * img.naturalWidth) / img.naturalHeight));
        }
        h = Math.max(MIN_H, h);
        if (Math.abs(w - b.w) > 2 || Math.abs(h - b.h) > 2) {
          updateBox(id, { x: b.x, y: b.y, w, h });
        }
        return;
      }
      const el = boxEls.current.get(id);
      if (!el) return;
      const need = el.scrollHeight;
      if (need > b.h + 2) {
        const maxH = page.height;
        updateBox(id, { x: b.x, y: b.y, w: b.w, h: Math.round(Math.min(need, maxH)) });
      }
    };
    const onLoad = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!t || t.tagName !== 'IMG') return;
      const boxEl = t.closest('.page-box') as HTMLElement | null;
      const id = boxEl?.getAttribute('data-box-id');
      if (id) fit(id);
    };
    // Resource load events don't bubble, but they do hit capture listeners.
    document.addEventListener('load', onLoad, true);
    // One pass after seeding for images that were already complete.
    const t = setTimeout(() => {
      for (const b of boxesRef.current) {
        if (b.kind === 'image' || boxEls.current.get(b.id)?.querySelector('img')) fit(b.id);
      }
    }, 80);
    return () => {
      document.removeEventListener('load', onLoad, true);
      clearTimeout(t);
    };
  }, [page.height, updateBox]);

  /** Remove a box, splicing any link chain it was part of back together. */
  const removeBox = useCallback(
    (id: string) => {
      const list = boxesRef.current;
      const dead = list.find((b) => b.id === id);
      const prev = list.find((b) => b.nextId === id);
      applyBoxes(
        list
          .filter((b) => b.id !== id)
          .map((b) =>
            b.id === prev?.id ? { ...b, nextId: dead?.nextId ?? null } : b,
          ),
      );
      setSelId(null);
      setEditId(null);
      if (editIdRef.current === id) {
        editIdRef.current = null;
        registerEditor(null);
      }
      reflowAll();
      snapshot();
    },
    [applyBoxes, reflowAll, snapshot],
  );

  /** Replace the picture inside an image box: pick a file, then swap the
      source in place (geometry, corner radius and fade are kept). The load
      listener re-fits the frame to the new picture's aspect automatically. */
  const replaceBoxImage = useCallback(
    (id: string) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          updateBox(id, { src: String(reader.result), ph: undefined });
        };
        reader.readAsDataURL(f);
      };
      input.click();
    },
    [updateBox],
  );

  /** Break this box's link to the next one; the next box keeps its content
      and becomes an independent box. */
  const unlinkBox = useCallback(
    (id: string) => {
      applyBoxes(
        boxesRef.current.map((b) => (b.id === id ? { ...b, nextId: null } : b)),
      );
      reflowAll();
      snapshot();
    },
    [applyBoxes, reflowAll, snapshot],
  );

  /** Arm the paint bucket on a box: clicking an empty box will link it and
      pour this chain's overflow into it. Clicking the bucket again cancels. */
  const armPour = useCallback(
    (id: string) => {
      if (pourSourceId === id) {
        setPourSourceId(null);
        setPourTargets(new Set());
        return;
      }
      const list = boxesRef.current;
      const targets = new Set<string>();
      for (const b of list) {
        if (b.id === id || b.nextId || b.kind) continue;
        if (list.some((o) => o.nextId === b.id)) continue;
        const el = boxEls.current.get(b.id);
        if (el && hasRealContent(el.innerHTML)) continue;
        targets.add(b.id);
      }
      setPourTargets(targets);
      setEditId(null);
      setPourSourceId(id);
    },
    [pourSourceId],
  );

  /** Complete a pour: link the armed source to the clicked empty box and let
      the reflow engine redistribute the chain immediately. */
  const acceptPour = useCallback(
    (targetId: string) => {
      const srcId = pourSourceId;
      setPourSourceId(null);
      setPourTargets(new Set());
      if (!srcId || srcId === targetId) return;
      const list = boxesRef.current;
      const src = list.find((b) => b.id === srcId);
      const target = list.find((b) => b.id === targetId);
      if (!src || !target || target.nextId || target.kind) return;
      if (list.some((b) => b.nextId === targetId)) return;
      // Emptiness from state + live DOM: a just-inserted box has an empty
      // seed (passes), while a stale seed on a box the user typed into is
      // still caught by the DOM check (rejects).
      if (hasRealContent(target.html)) return;
      const targetEl = boxEls.current.get(targetId);
      if (targetEl && hasRealContent(targetEl.innerHTML)) return;
      applyBoxes(
        list.map((b) => (b.id === srcId ? { ...b, nextId: targetId } : b)),
      );
      setSelId(targetId);
      reflowAll();
      snapshot();
    },
    [pourSourceId, applyBoxes, reflowAll, snapshot],
  );

  const selectBox = useCallback((id: string) => {
    const b = boxesRef.current.find((x) => x.id === id);
    if (b) activatePage(b.pageIndex);
    setPourSourceId(null);
    setPourTargets(new Set());
    setSelId(id);
  }, []);

  /** Enter edit mode for a box (double click / click on the selection). */
  const startEdit = useCallback((id: string) => {
    const b = boxesRef.current.find((x) => x.id === id);
    if (b) activatePage(b.pageIndex);
    setSelId(id);
    setEditId(id);
  }, []);

  /**
   * A wholesale replacement is about to happen in this frame.
   *
   * Ctrl+A inside a frame selects its contents, and whatever is typed or pasted
   * over that selection arrives wearing the *first* block's type. For a frame
   * whose first block is display type - the contents list's 18pt entries - that
   * floods the frame, overflows it and turns its chrome red. Arm the frame here
   * (on the Ctrl+A keystroke and again on `beforeinput`) and `handleInput` can
   * hand the new text the frame's standard instead. Only frames that declare a
   * standard (`box.css`) take part. */
  const armFrameStandard = useCallback((id: string) => {
    const box = boxesRef.current.find((b) => b.id === id);
    const el = boxEls.current.get(id);
    wholesaleRef.current = box && box.css && el && selectionCoversContents(el) ? id : null;
  }, []);

  /** Keystrokes / formatting inside a box: redistribute any chains, then
      snapshot the result so autosave sees the redistributed content. */
  const handleInput = useCallback(
    (id?: string) => {
      if (id && wholesaleRef.current === id) {
        const box = boxesRef.current.find((b) => b.id === id);
        const el = boxEls.current.get(id);
        if (box && el) {
          // Drop the borrowed block type (the design's spacing and its runs
          // stay), then re-assert the frame's standard over what is left.
          stripBorrowedType(el, { align: !!box.align });
          mirrorBoxFont(el, box);
        }
      }
      wholesaleRef.current = null;
      reflowAll();
      snapshot();
    },
    [reflowAll, snapshot],
  );

  // Keep the ref in step for the delete/rev bookkeeping.
  useEffect(() => {
    editIdRef.current = editId;
  }, [editId]);

  const hint = useMemo(
    () => (
      <div className="page-empty-hint no-print">
        {readOnly
          ? 'This page is empty'
          : 'This page is empty - choose Insert › Text box to add one'}
      </div>
    ),
    [readOnly],
  );

  /* ------------------------ sidebar page management ------------------------ */

  /** The names the user gave the pages, mirrored for the page operations. */
  const namesRef = useRef<string[]>([]);
  useEffect(() => {
    namesRef.current = pageNames ?? [];
  }, [pageNames]);

  /**
   * Keep the page names lined up with the pages: drop `remove` names at `at`
   * and put `insert` in their place, so a page carries its name when the
   * pages around it are inserted, duplicated, moved or deleted.
   */
  const spliceNames = useCallback(
    (at: number, remove: number, insert: string[]) => {
      const names = [...namesRef.current];
      while (names.length < at) names.push('');
      names.splice(at, remove, ...insert);
      namesRef.current = names;
      onPageNamesChange?.(names);
    },
    [onPageNamesChange],
  );

  /** An empty-page marker reserves a page slot so blank pages survive saves. */
  const makeSheet = useCallback(
    (pageIndex: number): TextBox => ({
      id: newBoxId(),
      pageIndex,
      x: 0,
      y: 0,
      w: MIN_W,
      h: MIN_H,
      html: '',
      nextId: null,
      kind: 'sheet',
    }),
    [],
  );

  /** The desk shows one page at a time, so a page change starts at the top. */
  const resetScroll = useCallback(() => {
    containerRef.current?.scrollTo({ top: 0, left: 0 });
  }, []);

  const selectPage = useCallback(
    (p: number) => {
      const clamped = Math.max(0, Math.min(p, pageCount - 1));
      setSelId(null);
      setEditId(null);
      activatePage(clamped);
      resetScroll();
    },
    [pageCount, activatePage, resetScroll],
  );

  /** Append a blank page after the last page. */
  const addPage = useCallback(() => {
    const nextIndex = boxesRef.current.reduce(
      (mx, b) => Math.max(mx, b.pageIndex + 1),
      1,
    );
    const next = [...boxesRef.current];
    // An empty trailing page needs a marker to keep existing.
    if (!next.some((b) => b.pageIndex === nextIndex)) {
      next.push(makeSheet(nextIndex));
    }
    applyBoxes(next);
    setSelId(null);
    setEditId(null);
    activatePage(nextIndex);
    resetScroll();
    reflowAll();
    snapshot();
    spliceNames(nextIndex, 0, ['']);
  }, [applyBoxes, makeSheet, activatePage, resetScroll, reflowAll, snapshot, spliceNames]);

  /** Insert a blank page at `index`, shifting the later pages down one. */
  const insertPageAt = useCallback(
    (index: number) => {
      const list = boxesRef.current;
      const count = list.reduce((mx, b) => Math.max(mx, b.pageIndex + 1), 1);
      const at = Math.max(0, Math.min(Math.round(index), count));
      const shifted = list.map((b) =>
        b.pageIndex >= at ? { ...b, pageIndex: b.pageIndex + 1 } : b,
      );
      shifted.push(makeSheet(at));
      applyBoxes(shifted);
      setSelId(null);
      setEditId(null);
      activatePage(at);
      resetScroll();
      reflowAll();
      snapshot();
      spliceNames(at, 0, ['']);
    },
    [applyBoxes, makeSheet, activatePage, resetScroll, reflowAll, snapshot, spliceNames],
  );

  /**
   * Drop `pages` imported PDF pages in at `index`, one document page each.
   *
   * A PDF page is a fixed, full-sheet frame holding the browser's PDF viewer at
   * that page number: the text stays selectable (so it can be copied or
   * searched), but the page is not editable - there is no text box to type in.
   */
  const insertPdfAt = useCallback(
    (src: string, pages: number, index: number) => {
      const list = boxesRef.current;
      const count = list.reduce((mx, b) => Math.max(mx, b.pageIndex + 1), 1);
      const at = Math.max(0, Math.min(Math.round(index), count));
      const n = Math.max(1, Math.min(200, Math.round(pages)));
      const shifted = list.map((b) =>
        b.pageIndex >= at ? { ...b, pageIndex: b.pageIndex + n } : b,
      );
      const pdfBoxes: TextBox[] = Array.from({ length: n }, (_, k) => ({
        id: newBoxId(),
        pageIndex: at + k,
        x: 0,
        y: 0,
        w: page.width,
        h: page.height,
        html: '',
        nextId: null,
        kind: 'pdf',
        src,
        pdfPage: k + 1,
      }));
      applyBoxes([...shifted, ...pdfBoxes]);
      setSelId(null);
      setEditId(null);
      activatePage(at);
      resetScroll();
      reflowAll();
      snapshot();
      spliceNames(at, 0, Array.from({ length: n }, () => ''));
    },
    [
      applyBoxes,
      activatePage,
      resetScroll,
      reflowAll,
      snapshot,
      spliceNames,
      page.width,
      page.height,
    ],
  );

  /** Import > PDF: pick a file, count its pages, and lay them into the issue. */
  const importPdfAt = useCallback(
    (index: number) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf,.pdf';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const buf = reader.result as ArrayBuffer;
          const pages = await pdfPageCount(buf);
          const id = newPdfId();
          registerPdf(id, bytesToDataUrl(new Uint8Array(buf)));
          insertPdfAt(pdfSrc(id), pages, index);
        };
        reader.readAsArrayBuffer(f);
      };
      input.click();
    },
    [insertPdfAt],
  );

  /**
   * Duplicate page `p` right after it. `blank` copies the page's *layout* -
   * every frame in its place - but wipes the words out of the text frames, so
   * a finished page becomes a fresh template for the next one (another puzzle
   * grid, another article slot) instead of a second copy of the same story.
   */
  const duplicatePage = useCallback(
    (p: number, blank = false) => {
      const list = boxesRef.current;
      const src = list.filter((b) => b.pageIndex === p);
      if (!src.length) return;
      const copies: TextBox[] = src.map((b) => {
        const html =
          b.kind || blank ? '' : boxEls.current.get(b.id)?.innerHTML ?? b.html;
        return {
          id: newBoxId(),
          pageIndex: p + 1,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          html,
          nextId: null,
          kind: b.kind,
          src: b.src,
          pdfPage: b.pdfPage,
          radius: b.radius,
          fade: b.fade,
          fit: b.fit,
          fill: b.fill,
          stroke: b.stroke,
          thickness: b.thickness,
          ph: b.ph,
          columns: b.columns,
          align: b.align,
          css: b.css,
        };
      });
      // Chains whose boxes all sit on this page stay linked among the copies.
      const idOf = new Map(src.map((b, i) => [b.id, copies[i].id]));
      copies.forEach((c, i) => {
        const orig = src[i].nextId;
        if (orig && idOf.has(orig)) c.nextId = idOf.get(orig)!;
      });
      const before: TextBox[] = [];
      const after: TextBox[] = [];
      for (const b of list) {
        if (b.pageIndex <= p) before.push(b);
        else after.push({ ...b, pageIndex: b.pageIndex + 1 });
      }
      applyBoxes([...before, ...copies, ...after]);
      setSelId(null);
      setEditId(null);
      activatePage(p + 1);
      resetScroll();
      reflowAll();
      snapshot();
      spliceNames(p + 1, 0, [namesRef.current[p] ?? '']);
    },
    [applyBoxes, activatePage, resetScroll, reflowAll, snapshot, spliceNames],
  );

  /** Give a page a name of its own, saved with the document. */
  const renamePage = useCallback(
    (i: number, name: string) => {
      const names = [...namesRef.current];
      while (names.length <= i) names.push('');
      names[i] = name;
      namesRef.current = names;
      onPageNamesChange?.(names);
    },
    [onPageNamesChange],
  );

  /** Duplicate page `p` as an empty layout (the context menu's Insert Copy). */
  const duplicatePageBlank = useCallback(
    (p: number) => duplicatePage(p, true),
    [duplicatePage],
  );

  /**
   * Move page `from` so that it ends up at index `to` - the Pages pane's
   * drag-and-drop, and the Move Page dialog. Every frame on the page travels
   * with it and the pages in between close up behind it.
   */
  const movePage = useCallback(
    (from: number, to: number) => {
      const list = boxesRef.current;
      const count = list.reduce((mx, b) => Math.max(mx, b.pageIndex + 1), 1);
      const f = Math.max(0, Math.min(Math.round(from), count - 1));
      const t = Math.max(0, Math.min(Math.round(to), count - 1));
      if (f === t) return;
      const groups: TextBox[][] = Array.from({ length: count }, () => []);
      for (const b of list) groups[Math.max(0, Math.min(b.pageIndex, count - 1))].push(b);
      const [moved] = groups.splice(f, 1);
      groups.splice(t, 0, moved);
      const next: TextBox[] = [];
      groups.forEach((g, i) => {
        for (const b of g) next.push({ ...b, pageIndex: i });
      });
      applyBoxes(next);
      setSelId(null);
      setEditId(null);
      activatePage(t);
      resetScroll();
      reflowAll();
      snapshot();
      const names = [...namesRef.current];
      while (names.length < count) names.push('');
      const [movedName] = names.splice(f, 1);
      names.splice(t, 0, movedName ?? '');
      namesRef.current = names;
      onPageNamesChange?.(names);
    },
    [
      applyBoxes,
      activatePage,
      resetScroll,
      reflowAll,
      snapshot,
      onPageNamesChange,
    ],
  );

  /** Delete page `p` and everything on it; later pages shift down. */
  const deletePage = useCallback(
    (p: number) => {
      const list = boxesRef.current;
      const pageCountNow = list.reduce((mx, b) => Math.max(mx, b.pageIndex + 1), 1);
      if (pageCountNow <= 1 || p < 0 || p >= pageCountNow) return;
      const doomed = new Set(
        list.filter((b) => b.pageIndex === p).map((b) => b.id),
      );
      if (!doomed.size) return;
      const hasContent = list.some(
        (b) =>
          b.pageIndex === p &&
          ((b.kind && b.kind !== 'sheet') ||
            (!b.kind && hasRealContent(liveHtml.current.get(b.id) ?? b.html))),
      );
      if (hasContent && !window.confirm(`Delete page ${p + 1}? Everything on it will be removed.`)) {
        return;
      }
      const next: TextBox[] = [];
      for (const b of list) {
        if (b.pageIndex === p) continue;
        if (b.pageIndex > p) next.push({ ...b, pageIndex: b.pageIndex - 1 });
        else next.push(b);
      }
      for (const b of next) {
        if (b.nextId && doomed.has(b.nextId)) b.nextId = null;
      }
      applyBoxes(next);
      setOverflowIds((prev) => new Set([...prev].filter((id) => !doomed.has(id))));
      setPourTargets((prev) => new Set([...prev].filter((id) => !doomed.has(id))));
      setSelId((s) => (s && doomed.has(s) ? null : s));
      setEditId((e) => (e && doomed.has(e) ? null : e));
      if (editIdRef.current && doomed.has(editIdRef.current)) {
        editIdRef.current = null;
        registerEditor(null);
      }
      const newCount = next.reduce((mx, b) => Math.max(mx, b.pageIndex + 1), 1);
      activatePage(Math.min(activePageRef.current, newCount - 1));
      reflowAll();
      snapshot();
      spliceNames(p, 1, []);
    },
    [applyBoxes, activatePage, reflowAll, snapshot, spliceNames],
  );

  /* Insert > Break > Page break.

     A break cannot live *inside* a frame here: a page is an object on the
     sheet, not a run of pixels in one long column, and the flow engine moves
     text between frames by geometry alone. The old command inserted a
     `page-break-after` div (plus an empty paragraph) into the editable, which
     printed nothing and left junk behind. Asking the canvas for a fresh sheet
     is what the menu item actually promises. */
  const pageTickRef = useRef(pageTick);
  useEffect(() => {
    if (pageTick === pageTickRef.current) return;
    pageTickRef.current = pageTick;
    addPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTick]);

  /** Live text of a box (for thumbnails): the mirror, else the seed. */
  const contentOf = useCallback((b: TextBox) => {
    if (b.kind) return '';
    return liveHtml.current.get(b.id) ?? b.html;
  }, []);

  /** Whether the document has any real content (vs. blank/empty pages). */
  const hasAnyContent = boxesState.some((b) => b.kind !== 'sheet');

  /** One drawn sheet: which page's content it carries, and - in master view -
      which sheet of the master it dresses. */
  type Sheet = { pageIndex: number; side: MasterSide | null; key: string };

  /** The master the master-page view is editing. */
  const masterView: MasterDef | null = masterSet ? activeMaster(masterSet) : null;

  /**
   * The rows of sheets to draw. Ordinary editing shows one page per row.
   * Master view shows the master itself instead of the publication: its single
   * sheet, or - for a two-page (facing) master - the left and right sheets side
   * by side, the way Publisher draws a spread. In a facing master the right
   * sheet dresses the odd pages (page 1 first), the left sheet the even ones.
   */
  const sheetRows: Sheet[][] =
    masterMode && masterView
      ? masterView.twoPage
        ? [
            [
              { pageIndex: 1, side: 'left', key: 'left' },
              { pageIndex: 0, side: 'right', key: 'right' },
            ],
          ]
        : [[{ pageIndex: 0, side: 'right', key: 'right' }]]
      : Array.from({ length: pageCount }, (_, i) => [{ pageIndex: i, side: null, key: `p${i}` }]);
  const sheets: Sheet[] = sheetRows.flat();

  /**
   * The master page's frame, drawn as the faint orange guide so the master is
   * visible from the ordinary editing view - Publisher shows the equivalent as
   * a blue guide. The running head and folio sit **outside** it, which is why
   * the guide is the frame box itself and not the bands' bounding box.
   */
  const masterGuide = useMemo(() => masterFrameBox(page), [page]);

  /** Resolve a band for one page, or null when that page carries none. */
  const resolved = useCallback(
    (slot: BandSlot, pageIndex: number): MasterBand | null => {
      if (!masterSet) return null;
      const b = bandForPage(masterSet, slot, pageIndex);
      if (!b || !b.text.trim()) return null;
      return b;
    },
    [masterSet],
  );

  /**
   * One sheet of paper: its frames, the master furniture, and - in master view
   * - the master's own bands, boxed by dashed non-printing guides. `sheet.side`
   * names which sheet of a two-page master this is.
   */
  const renderSheet = (sheet: Sheet, offscreen = false) => {
    const pageIndex = sheet.pageIndex;
    const label = masterView
      ? `Page ${masterView.id}${masterView.twoPage ? (sheet.side === 'left' ? ' · left' : ' · right') : ''}`
      : '';
    return (
      // The zoom wrapper reserves the sheet's *visual* size (page × zoom) in
      // layout, so a zoomed sheet can be scrolled to in both directions. Only
      // the current page sits in the flow; the other pages are parked offscreen
      // - still mounted and laid out, so the flow engine and the sidebar
      // thumbnails keep working - but never reachable by scrolling.
      <div
        key={sheet.key}
        className="doc-scaler"
        aria-hidden={offscreen || undefined}
        style={{
          position: offscreen ? 'absolute' : 'relative',
          left: offscreen ? -100000 : undefined,
          top: offscreen ? 0 : undefined,
          width: `${page.width * scale}px`,
          height: `${page.height * scale}px`,
          visibility: offscreen ? 'hidden' : undefined,
          pointerEvents: offscreen ? 'none' : undefined,
        }}
      >
      <div
        data-sheet={pageIndex}
        className={`doc-paper relative ${masterMode ? 'is-master' : ''}`}
        style={{
          width: `${page.width}px`,
          height: `${page.height}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
        onDoubleClick={(e) => paperDoubleClick(e, pageIndex)}
      >
        {/* Publisher tabs each master sheet in the corner with its Page ID. */}
        {masterMode && (
          <span className="master-sheet-label" aria-hidden="true">
            {label}
          </span>
        )}

        {/* The master's frame, drawn the way Publisher draws it: a pale-blue
            hairline inset evenly from every page edge. Shown on every sheet,
            in master view as well as on the publication, so the master's reach
            is always visible; a double-click outside it opens the master page.
            Click-through: pointer-events are off, so it never blocks text. */}
        {!readOnly && (
          <span
            className="master-region-guide no-print"
            aria-hidden="true"
            style={{
              left: `${masterGuide.left}px`,
              top: `${masterGuide.top}px`,
              width: `${masterGuide.width}px`,
              height: `${masterGuide.height}px`,
            }}
          />
        )}

        <div
          className={`page-box-layer relative h-full w-full ${pourSourceId ? 'is-pouring' : ''} ${
            masterMode ? 'is-master-layer' : ''
          }`}
          onMouseDown={() => paperMouseDown(pageIndex)}
        >
          {pageIndex === activePageUi && !hasAnyContent && !masterMode && hint}

          {boxesState
            .filter(
              (b) =>
                b.pageIndex === pageIndex && b.kind !== 'sheet' && b.kind !== 'tombstone',
            )
            .map((box) => {
              if (box.kind === 'pdf') {
                return <PdfPageView key={box.id} box={box} />;
              }
              if (box.kind === 'image') {
                return (
                <ImageBoxView
                  key={box.id}
                  box={box}
                  scale={scale}
                  selected={selId === box.id}
                  readOnly={readOnly}
                  pageW={page.width}
                  pageH={page.height}
                  onRegisterImg={registerImgEl}
                  onSelect={selectBox}
                  onGeomChange={updateBox}
                  onDelete={removeBox}
                  onReplace={replaceBoxImage}
                />
                );
              }
              if (box.kind === 'shape' || box.kind === 'line') {
                return (
                  <ShapeBoxView
                    key={box.id}
                    box={box}
                    scale={scale}
                    selected={selId === box.id}
                    readOnly={readOnly}
                    pageW={page.width}
                    pageH={page.height}
                    onSelect={selectBox}
                    onGeomChange={updateBox}
                    onDelete={removeBox}
                  />
                );
              }
              return (
                <TextBoxView
                  key={box.id}
                  box={box}
                  scale={scale}
                  selected={selId === box.id}
                  editing={editId === box.id}
                  editingOther={!!editId && editId !== box.id}
                  overflow={overflowIds.has(box.id)}
                  pouring={!!pourSourceId}
                  isPourTarget={pourTargets.has(box.id)}
                  readOnly={readOnly}
                  spellCheck={spellCheck}
                  pageW={page.width}
                  pageH={page.height}
                  onRegisterEl={registerBoxEl}
                  onSelect={selectBox}
                  onStartEdit={startEdit}
                  onInput={() => handleInput(box.id)}
                  onArmReplace={() => armFrameStandard(box.id)}
                  onGeomChange={updateBox}
                  onArmPour={armPour}
                  onAcceptPour={acceptPour}
                  onUnlink={unlinkBox}
                  onDelete={removeBox}
                />
              );
            })}
        </div>

        {/* The end-of-piece marker is drawn *after* the frames, so the black
            square always sits above the page content rather than under it. It
            cannot be dragged or resized: click it to select (so Delete takes
            it off), or use Insert ▸ Tombstone / Format ▸ Tombstone. */}
        {!masterMode &&
          boxesState
            .filter((b) => b.pageIndex === pageIndex && b.kind === 'tombstone')
            .map((b) => (
              <button
                key={b.id}
                type="button"
                className="page-tombstone-box"
                title="End-of-piece marker - right-click or delete to remove it"
                aria-label="End-of-piece marker"
                style={{ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (!readOnly) selectBox(b.id);
                }}
                onContextMenu={(e) => {
                  if (readOnly) return;
                  e.preventDefault();
                  removeBox(b.id);
                }}
              >
                <svg width="100%" height="100%" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="0" y="0" width="24" height="24" rx="7" fill="#1f1f1f" />
                </svg>
              </button>
            ))}


        {/* Master-page furniture. In master view the bands become live text you
            type straight into, wrapped in the dashed non-printing guides
            Publisher draws on the master; on a publication page each sheet
            shows the furniture of the master assigned to it. */}
        {masterSet &&
          (['header', 'footer'] as BandSlot[]).map((slot) => {
            if (masterMode && masterView && sheet.side) {
              const key = bandKey(sheet.side, slot);
              return (
                <MasterBandView
                  key={`${sheet.key}-${key}-${rev}-${masterRev}`}
                  label={BAND_LABELS[key]}
                  box={masterBandBox(slot, page)}
                  bandHeight={MASTER_BAND_H}
                  band={masterView[sheet.side][slot]}
                  placeholder={slot === 'header' ? 'Header' : 'Footer'}
                  first={slot === 'header'}
                  editable={!readOnly}
                  tokenRequest={focusedBandKey === key ? masterToken : undefined}
                  onChange={(patch) => onMasterBandChange?.(masterView.id, key, patch)}
                  onFocusBand={() => {
                    setFocusedBandKey(key);
                    onMasterBandFocus?.(key);
                  }}
                />
              );
            }
            const band = resolved(slot, pageIndex);
            if (!band) return null;
            return (
              <div
                key={`${slot}-${sheet.key}`}
                className={`master-band master-band-${slot}`}
                style={{
                  ...masterBandBox(slot, page),
                  // A single line box as tall as the band centres the furniture
                  // vertically inside its margin slot.
                  lineHeight: `${MASTER_BAND_H}px`,
                  textAlign: hasTabStops(band.text) ? undefined : band.align,
                }}
              >
                <BandLine
                  band={band}
                  pageNumber={pageIndex + 1}
                  pageCount={pageCount}
                  title={docTitle}
                />
              </div>
            );
          })}
      </div>
      </div>
    );
  };

  return (
    <div className="doc-wrap flex min-h-0 w-full">
      <PageSidebar
        pageCount={masterMode ? masterSet?.masters.length ?? 1 : pageCount}
        pageW={page.width}
        pageH={page.height}
        activePage={Math.min(
          masterMode && masterSet
            ? Math.max(0, masterSet.masters.findIndex((m) => m.id === masterSet.activeId))
            : activePageUi,
          (masterMode ? masterSet?.masters.length ?? 1 : pageCount) - 1,
        )}
        readOnly={readOnly}
        masterMode={masterMode}
        /* Publisher lists the master pages in the navigation pane, by Page ID
           and description; clicking one opens that master for editing. */
        masterTiles={
          masterMode && masterSet
            ? masterSet.masters.map((m) => ({ id: m.id, description: m.description }))
            : undefined
        }
        onSelectMaster={onSelectMaster}
        onSelectPage={selectPage}
        pageNames={pageNames}
        onAddPageAt={insertPageAt}
        onImportPdf={importPdfAt}
        onDeletePage={deletePage}
        onDuplicatePage={duplicatePage}
        onDuplicatePageBlank={duplicatePageBlank}
        onMovePage={movePage}
        onRenamePage={renamePage}
        masters={
          masterSet ? masterSet.masters.map((m) => ({ id: m.id, description: m.description })) : undefined
        }
        masterOf={
          masterSet ? (i: number) => masterForPage(masterSet, i)?.id ?? null : undefined
        }
        onAssignMaster={onAssignMaster}
        renderPage={(i) => (
          <PageThumb
            boxes={boxesState}
            pageIndex={masterMode ? sheets[0]?.pageIndex ?? 0 : i}
            pageW={page.width}
            pageH={page.height}
            contentOf={contentOf}
            master={masterSet}
            masterId={masterMode ? masterSet?.masters[i]?.id : undefined}
            pageCount={pageCount}
            docTitle={docTitle}
          />
        )}
      />
      <div
        ref={containerRef}
        className="doc-main relative min-w-0 flex-1 overflow-auto bg-[#f1f0ee]"
        onDoubleClick={(e) => {
          // The pasteboard (the grey desk around the sheets) is also "outside
          // the master" - a double-click there opens the master page too.
          if (readOnly || masterMode || !onOpenMaster) return;
          const t = e.target as HTMLElement;
          if (t.closest('.doc-paper')) return; // sheets handle their own
          onOpenMaster();
        }}
      >
      {/* Horizontal ruler - graduated in millimetres from the sheet's left
          edge. Chrome only: it never prints. There are no margins, so there
          is nothing to shade and no arrows to drag. */}
      {showRuler && (
        <div
          className="no-print sticky top-0 z-20 border-b border-gdoc-border bg-white"
          // Box-sizing is border-box, so this is the ruler's *total* height -
          // the side ruler is offset by exactly RULER_SIZE and the two must
          // agree or every graduation on the left is out by the border width.
          style={{ height: `${RULER_SIZE}px` }}
        >
          {/* The same wrapper the sheets use (see `.doc-inner`), so the ruler's
              zero mark sits exactly on the sheet's left edge however narrow the
              window is. */}
          <div className="doc-inner mx-auto h-full max-w-[1100px] px-12">
            <div
              className="relative h-full select-none"
              style={{ width: `${page.width * scale}px` }}
            >
              {/* The paper itself reads lighter than the desk around it. */}
              <div className="absolute inset-0 bg-[#fbfaf9]" />
              <RulerTicks pagePx={page.width} scale={scale} axis="x" />
            </div>
          </div>
        </div>
      )}

      <div className="doc-inner mx-auto max-w-[1100px] px-12">
        {/* --print-page-w/h keep each sheet exactly one printed page (see the
            @media print rules in index.css). */}
        <div
          className="doc-stack flex flex-col items-center gap-8 py-8"
          style={
            {
              '--print-page-w': `${((page.width / 96) * 25.4).toFixed(2)}mm`,
              '--print-page-h': `${((page.height / 96) * 25.4).toFixed(2)}mm`,
            } as React.CSSProperties
          }
        >
          {sheetRows.map((row) => {
            // One page at a time: only the current page's row is laid out in
            // the flow; the rest are parked (still mounted) offscreen.
            const activeRow =
              masterMode || row.some((s) => s.pageIndex === activePageUi);
            const drawn = row.map((s) => renderSheet(s, !activeRow));
            // A two-page master is a facing spread: the left sheet is drawn
            // beside the right one, as Publisher shows it.
            return row.length === 1 ? (
              drawn[0]
            ) : (
              <div
                key={`spread-${row[0].key}`}
                className="flex flex-row items-start gap-8"
                data-sheet={`spread-${row[0].key}`}
              >
                {drawn}
              </div>
            );
          })}
        </div>
      </div>

      {/* Vertical ruler - graduated in millimetres from each sheet's top edge.
          The sheets are drawn with a CSS transform, which leaves their layout
          boxes unscaled, so every position here is computed in *visual* space
          (page.height × scale); otherwise the graduations drift away from the
          paper as soon as you zoom. There are no margins, so nothing is shaded
          and there are no arrows. */}
      {showRuler && (() => {
        // One page at a time, so the side ruler graduates a single sheet: the
        // desk's top padding, the paper, then the bottom padding.
        const pageVisualH = page.height * scale;
        return (
          <div
            className="no-print absolute z-10 select-none border-r border-gdoc-border bg-white text-[10px] text-gdoc-muted"
            style={{
              top: `${RULER_SIZE}px`,
              left: 0,
              width: `${RULER_SIZE}px`,
              height: `${pageVisualH + PAGE_GAP * 2}px`,
            }}
          >
            {/* The paper reads lighter than the desk around it. */}
            <div
              className="absolute left-0 right-0 bg-[#fbfaf9]"
              style={{ top: `${PAGE_GAP}px`, height: `${pageVisualH}px` }}
            />
            <div
              className="absolute left-0 right-0"
              style={{ top: `${PAGE_GAP}px`, height: `${pageVisualH}px` }}
            >
              <RulerTicks pagePx={page.height} scale={scale} axis="y" />
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );

}

/* ---------------------------------------------------------------------- */
/* Static page preview for the sidebar thumbnail.                         */
/* ---------------------------------------------------------------------- */

function PageThumb({
  boxes,
  pageIndex,
  pageW,
  pageH,
  contentOf,
  master,
  masterId,
  pageCount,
  docTitle = '',
}: {
  boxes: TextBox[];
  pageIndex: number;
  pageW: number;
  pageH: number;
  contentOf: (b: TextBox) => string;
  master?: MasterSet | null;
  /** Render one particular master's furniture (a master tile in the pane)
      rather than the furniture the page is assigned. */
  masterId?: string;
  pageCount: number;
  docTitle?: string;
}) {
  const page = { width: pageW, height: pageH };
  return (
    <div className="relative bg-white" style={{ width: pageW, height: pageH }}>
      {      boxes
        .filter((b) => b.pageIndex === pageIndex && b.kind !== 'sheet')
        .map((b) =>
          b.kind === 'pdf' ? (
            // An imported PDF page: a plain paper block in the thumbnail (a live
            // viewer per thumbnail would be far too heavy).
            <div
              key={b.id}
              className="pointer-events-none"
              style={{
                position: 'absolute',
                left: b.x,
                top: b.y,
                width: b.w,
                height: b.h,
                background: '#f4f1ec',
              }}
            />
          ) : b.kind === 'shape' || b.kind === 'line' ? (
            b.kind === 'line' ? (
              <div
                key={b.id}
                className="pointer-events-none"
                style={{
                  position: 'absolute',
                  left: b.x,
                  top: b.y + b.h / 2 - Math.max(1, Math.round(b.thickness ?? 2)) / 2,
                  width: b.w,
                  height: Math.max(1, Math.round(b.thickness ?? 2)),
                  background: b.stroke ?? '#3f3f3f',
                }}
              />
            ) : (
              <div
                key={b.id}
                className="pointer-events-none"
                style={{
                  position: 'absolute',
                  left: b.x,
                  top: b.y,
                  width: b.w,
                  height: b.h,
                  background: b.fill ?? '#fe9c53',
                  borderRadius: Math.max(0, Math.min(2000, Math.round(b.radius ?? 0))),
                }}
              />
            )
          ) : b.kind === 'image' ? (
            (() => {
              const minSide = Math.max(2, Math.min(b.w, b.h));
              const fade = Math.max(0, Math.min(Math.round(b.fade ?? 0), Math.floor(minSide / 2)));
              // Edge-only fade: two linear gradients (horizontal + vertical)
              // intersected, so just the borders dissolve and the middle of
              // the picture stays fully opaque - no ellipse vignette.
              const maskPct = fade > 0 ? (fade / minSide) * 100 : 0;
              const maskH = `linear-gradient(to right, transparent 0, #000 ${maskPct.toFixed(1)}%, #000 ${(100 - maskPct).toFixed(1)}%, transparent 100%)`;
              const maskV = `linear-gradient(to bottom, transparent 0, #000 ${maskPct.toFixed(1)}%, #000 ${(100 - maskPct).toFixed(1)}%, transparent 100%)`;
              const mask = fade > 0 ? `${maskH}, ${maskV}` : undefined;
              return (
                <img
                  key={b.id}
                  src={b.src}
                  alt=""
                  draggable={false}
                  className="pointer-events-none select-none"
                  style={{
                    position: 'absolute',
                    left: b.x,
                    top: b.y,
                    width: b.w,
                    height: b.h,
                    objectFit: b.fit ?? 'cover',
                    borderRadius: Math.max(0, Math.min(2000, Math.round(b.radius ?? 0))),
                    maskImage: mask,
                    WebkitMaskImage: mask,
                    maskComposite: 'intersect',
                  }}
                />
              );
            })()
          ) : (
            <div
              key={b.id}
              className="page-box-content pointer-events-none"
              style={{
                position: 'absolute',
                left: b.x,
                top: b.y,
                width: b.w,
                height: b.h,
                // Mirror the frame's columns so the sidebar thumbnail matches
                // the sheet, gray column rule included.
                columnCount: Math.max(1, Math.round(b.columns ?? 1)),
                columnGap: (b.columns ?? 1) > 1 ? COLUMN_GAP : undefined,
                columnRule:
                  (b.columns ?? 1) > 1 ? `1px solid ${COLUMN_RULE_COLOR}` : undefined,
                columnFill: 'balance',
              }}
              dangerouslySetInnerHTML={{ __html: contentOf(b) }}
            />
          ),
        )}
      {/* The end-of-piece marker, in the same page coordinates the sheet uses,
          so the thumbnail puts it exactly where the live page does. */}
      {boxes
        .filter((b) => b.pageIndex === pageIndex && b.kind === 'tombstone')
        .map((b) => (
          <svg
            key={b.id}
            className="pointer-events-none"
            style={{ position: 'absolute', left: b.x, top: b.y }}
            width={b.w}
            height={b.h}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect x="0" y="0" width="24" height="24" rx="7" fill="#1f1f1f" />
          </svg>
        ))}
      {master &&
        (['header', 'footer'] as BandSlot[]).map((slot) => {
          const tile = masterId ? masterById(master, masterId) : null;
          const b = tile ? tile.right[slot] : bandForPage(master, slot, pageIndex);
          if (!b || !b.text.trim()) return null;
          return (
            <div
              key={slot}
              className={`master-band master-band-${slot}`}
              style={{
                ...masterBandBox(slot, page),
                textAlign: hasTabStops(b.text) ? undefined : b.align,
                lineHeight: `${MASTER_BAND_H}px`,
              }}
            >
              <BandLine band={b} pageNumber={pageIndex + 1} pageCount={pageCount} title={docTitle} />
            </div>
          );
        })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Master-page furniture.                                                  */
/* ---------------------------------------------------------------------- */

const BAND_STOPS = ['band-stop-left', 'band-stop-centre', 'band-stop-right'] as const;

/**
 * A band as it prints: the field tokens resolved for this page, laid out at
 * Publisher's tab stops.
 *
 * A band with a tab character in it is split across the left, centre and right
 * stops of a three-column grid (a single band can therefore carry the running
 * head on the left and the folio on the right, exactly as Publisher's header
 * does). A band without one keeps its own alignment, as it always has.
 */
function BandLine({
  band,
  pageNumber,
  pageCount,
  title,
}: {
  band: MasterBand;
  pageNumber: number;
  pageCount: number;
  title: string;
}) {
  const text = fillMasterTokens(band.text, pageNumber, pageCount, title);
  if (!hasTabStops(text)) return <>{text}</>;
  const [left, centre, right] = bandSegments(text);
  return (
    <span className="band-stops">
      <span className={BAND_STOPS[0]}>{left}</span>
      <span className={BAND_STOPS[1]}>{centre}</span>
      <span className={BAND_STOPS[2]}>{right}</span>
    </span>
  );
}

interface MasterBandViewProps {
  /** Which band this is ("Header", "Left page footer"…). */
  label: string;
  /** Position/size in page coordinates. */
  box: { left: number; top: number; width: number; height: number };
  /** Band height in px - doubles as the line-height that centres the text. */
  bandHeight: number;
  /** The band itself. Tokens stay visible here, the way Publisher shows fields. */
  band: MasterBand;
  placeholder: string;
  /** The header sits above the frame, the footer below it. */
  first: boolean;
  editable: boolean;
  /** A field the ribbon asked to insert into the focused band. */
  tokenRequest?: { token: string; tick: number };
  onChange: (patch: { text: string; align?: MasterAlign }) => void;
  /** The band took focus - lets App target Insert Page Number/Date/Time. */
  onFocusBand?: () => void;
}

/**
 * The master's header/footer, live in master view.
 *
 * The band is one line with **three tab stops** - left, centre and right - the
 * way Publisher's header and footer work: click anywhere and type, or press Tab
 * to move to the next stop. The DOM is seeded once and then left alone (the
 * live text is the truth while the user types); the model is rebuilt from the
 * three stops on every keystroke.
 */
function MasterBandView({
  label,
  box,
  bandHeight,
  band,
  placeholder,
  first,
  editable,
  tokenRequest,
  onChange,
  onFocusBand,
}: MasterBandViewProps) {
  const stops = useRef<(HTMLSpanElement | null)[]>([null, null, null]);
  /** The range the user last had inside this band, so a ribbon button can put
      its field at the caret even though the click moved focus away. */
  const savedRange = useRef<Range | null>(null);
  const lastTokenTick = useRef(tokenRequest?.tick ?? 0);
  /** The stop the raw text belongs to when the band carries no tab yet. */
  const alignIndex = band.align === 'center' ? 1 : band.align === 'right' ? 2 : 0;

  // Seed each stop once. Re-rendering the text of a stop the user is typing in
  // would destroy the caret, so this only ever runs on mount (the key on the
  // parent remounts the band when the model changes off-page).
  const setStop = useCallback(
    (i: number, el: HTMLSpanElement | null) => {
      stops.current[i] = el;
      if (el && !el.dataset.seeded) {
        const [left, centre, right] = bandSegments(band.text);
        const seeded = hasTabStops(band.text)
          ? [left, centre, right][i]
          : (i === alignIndex ? band.text : '');
        el.textContent = seeded;
        el.dataset.seeded = '1';
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [band.text, alignIndex],
  );

  /** Rebuild the band from its three stops.
   *
   * Text typed at one stop only is *single-stop* text: a band with no tab in it
   * is aligned by `align`, so the alignment is moved to the stop the user
   * actually typed at. Otherwise a line typed at the left stop of a band that
   * happened to be right-aligned would jump to the right margin as soon as it
   * was rendered on a page. */
  const readBack = () => {
    const [left, centre, right] = [
      stops.current[0]?.textContent ?? '',
      stops.current[1]?.textContent ?? '',
      stops.current[2]?.textContent ?? '',
    ];
    const text = joinBandSegments([left, centre, right]);
    const align: MasterAlign = !text.trim()
      ? band.align
      : hasTabStops(text)
        ? band.align
        : left
          ? 'left'
          : centre
            ? 'center'
            : 'right';
    onChange({ text, align });
  };

  /** Remember where the caret is, so Insert Page Number/Date/Time lands there. */
  const rememberCaret = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (stops.current.some((el) => el && el.contains(r.startContainer))) {
      savedRange.current = r.cloneRange();
    }
  };

  /**
   * Put a field token at the caret.
   *
   * The insertion is done on the text itself rather than through
   * `execCommand('insertText')`: a stop the user has not typed in yet is an
   * empty element, and the browser quietly refuses to insert text into one, so
   * "Insert Page Number" did nothing until the band already had a character in
   * it. The caret offset is read from the remembered range (a ribbon button
   * cannot hold the selection itself) and put back after the field. A band is
   * plain text by design, so there is no inline markup to preserve here. */
  const insertAtCaret = (token: string) => {
    const host = stops.current.find((el) =>
      el && savedRange.current ? el.contains(savedRange.current.startContainer) : false,
    );
    const target = host ?? stops.current[alignIndex] ?? stops.current[0];
    if (!target) return;
    const full = target.textContent ?? '';
    let at = full.length;
    const r = savedRange.current;
    if (r && target.contains(r.startContainer)) {
      const pre = document.createRange();
      pre.selectNodeContents(target);
      try {
        pre.setEnd(r.startContainer, r.startOffset);
        at = Math.min(pre.toString().length, full.length);
      } catch {
        /* a stale range - fall back to the end of the stop */
      }
    }
    target.textContent = full.slice(0, at) + token + full.slice(at);
    const node = target.firstChild;
    const sel = window.getSelection();
    if (node && sel) {
      const after = document.createRange();
      after.setStart(node, Math.min(at + token.length, node.textContent?.length ?? 0));
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      savedRange.current = after.cloneRange();
    }
    target.focus({ preventScroll: true });
    readBack();
  };

  /* A ribbon button asked for a field: drop it into the band being edited. */
  useEffect(() => {
    if (!tokenRequest) return;
    if (tokenRequest.tick === lastTokenTick.current) return;
    lastTokenTick.current = tokenRequest.tick;
    insertAtCaret(tokenRequest.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenRequest?.tick]);

  return (
    <div
      className={`master-band master-band-${first ? 'header' : 'footer'} is-editable`}
      style={{ ...box, lineHeight: `${bandHeight}px` }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Publisher's non-printing guide: a dashed frame with a name tab. */}
      <span className="master-band-guide" aria-hidden="true">
        <span className="master-band-tag">{label}</span>
      </span>
      <div className="master-band-text band-stops">
        {BAND_STOPS.map((cls, i) => (
          <span
            key={cls}
            ref={(el) => setStop(i, el)}
            className={cls}
            contentEditable={editable}
            suppressContentEditableWarning
            spellCheck={false}
            data-ph={i === alignIndex ? `Click to add a ${placeholder.toLowerCase()}` : undefined}
            onFocus={() => onFocusBand?.()}
            onKeyUp={rememberCaret}
            onMouseUp={rememberCaret}
            onInput={() => {
              rememberCaret();
              readBack();
            }}
            onKeyDown={(e) => {
              // Enter would split the band into blocks; furniture is one line.
              if (e.key === 'Enter') e.preventDefault();
              // Tab walks Publisher's three stops, wrapping at the right one.
              if (e.key === 'Tab') {
                e.preventDefault();
                const next = stops.current[(i + (e.shiftKey ? 2 : 1)) % 3];
                next?.focus();
                const sel = window.getSelection();
                if (next && sel) {
                  const r = document.createRange();
                  r.selectNodeContents(next);
                  r.collapse(false);
                  sel.removeAllRanges();
                  sel.addRange(r);
                  savedRange.current = r.cloneRange();
                }
                readBack();
              }
            }}
            onPaste={(e) => {
              // Never paste markup into a furniture band - it holds plain text.
              e.preventDefault();
              const plain = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ');
              document.execCommand('insertText', false, plain);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* One text box on the page.                                              */
/* ---------------------------------------------------------------------- */

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface TextBoxViewProps {
  box: TextBox;
  scale: number;
  selected: boolean;
  editing: boolean;
  /** Another box on the page is being edited right now. */
  editingOther: boolean;
  /** This box's chain still has text that cannot be displayed. */
  overflow: boolean;
  /** A paint-bucket pour is armed somewhere on the canvas. */
  pouring: boolean;
  /** This box is a valid empty target for the armed pour. */
  isPourTarget: boolean;
  readOnly: boolean;
  spellCheck: boolean;
  pageW: number;
  pageH: number;
  onRegisterEl: (id: string, html: string, el: HTMLDivElement | null, box: TextBox) => void;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onInput: () => void;
  /** Fired when the frame's whole content is selected (the Ctrl+A keystroke and
      `beforeinput`), so a select-all retype can be recognised - see
      `armFrameStandard` in the canvas. */
  onArmReplace: () => void;
  onGeomChange: (
    id: string,
    patch: { x?: number; y?: number; w?: number; h?: number; radius?: number; fade?: number; columns?: number },
  ) => void;
  onArmPour: (id: string) => void;
  onAcceptPour: (id: string) => void;
  onUnlink: (id: string) => void;
  onDelete: (id: string) => void;
}

function TextBoxView({
  box,
  scale,
  selected,
  editing,
  editingOther,
  overflow,
  pouring,
  isPourTarget,
  readOnly,
  spellCheck,
  pageW,
  pageH,
  onRegisterEl,
  onSelect,
  onStartEdit,
  onInput,
  onArmReplace,
  onGeomChange,
  onArmPour,
  onAcceptPour,
  onUnlink,
  onDelete,
}: TextBoxViewProps) {
  const dragRef = useRef<{
    mode: 'move' | Handle;
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
    moved: boolean;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const setContentEl = useCallback(
    (el: HTMLDivElement | null) => {
      contentRef.current = el;
      onRegisterEl(box.id, box.html, el, box);
    },
    // `box` is intentionally not a dependency: the element is registered (and
    // seeded) once per mount, and re-registering on every state change would
    // re-seed the contentEditable under the user's caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [box.id, box.html, onRegisterEl],
  );

  const clampGeom = (g: { x: number; y: number; w: number; h: number }) => {
    const w = Math.max(MIN_W, Math.min(g.w, pageW));
    const h = Math.max(MIN_H, Math.min(g.h, pageH));
    return {
      x: Math.max(0, Math.min(g.x, pageW - w)),
      y: Math.max(0, Math.min(g.y, pageH - h)),
      w,
      h,
    };
  };

  const beginDrag = (mode: 'move' | Handle, e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: box.x, y: box.y, w: box.w, h: box.h };
    dragRef.current = { mode, startX, startY, orig, moved: false };
    const s = scale || 1;

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / s;
      const dy = (ev.clientY - d.startY) / s;
      if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD) {
        return;
      }
      d.moved = true;
      if (d.mode === 'move') {
        onGeomChange(box.id, clampGeom({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }));
        return;
      }
      let { x, y, w, h } = d.orig;
      if (d.mode.includes('e')) w = d.orig.w + dx;
      if (d.mode.includes('s')) h = d.orig.h + dy;
      if (d.mode.includes('w')) {
        w = d.orig.w - dx;
        x = d.orig.x + dx;
      }
      if (d.mode.includes('n')) {
        h = d.orig.h - dy;
        y = d.orig.y + dy;
      }
      onGeomChange(box.id, clampGeom({ x, y, w, h }));
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // A click that never became a drag means "start typing here".
      if (d && d.mode === 'move' && !d.moved) {
        onStartEdit(box.id);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const boxMouseDown = (e: React.MouseEvent) => {
    if (readOnly) return;
    // While a pour is armed, clicking a valid empty box accepts the link.
    if (pouring && isPourTarget) {
      e.preventDefault();
      e.stopPropagation();
      onAcceptPour(box.id);
      return;
    }
    if (editing) {
      // Let the browser place the caret / select text - but stop the event
      // before it bubbles to the page layer, whose handler would end this
      // box's edit mode on every click inside its own text.
      e.stopPropagation();
      return;
    }
    // Clicking another box while one is being edited hands editing straight
    // over to it (Word-style switching between boxes).
    if (editingOther) {
      e.preventDefault();
      e.stopPropagation();
      onStartEdit(box.id);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (selected) {
      // First click on a selected box starts a potential move; releasing
      // without moving means "start typing here".
      beginDrag('move', e);
      return;
    }
    onSelect(box.id);
  };

  const handles: { h: Handle; style: React.CSSProperties; cursor: string }[] = [
    { h: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
    { h: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
    { h: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
    { h: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
    { h: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
    { h: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
    { h: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
    { h: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
  ];

  /** Newspaper-style column count (1 = single). A multi-column box fills
      column 1 first, then column 2, with a gray rule in the gutter. */
  const cols = Math.max(1, Math.min(3, Math.round(box.columns ?? 1)));

  return (
    <div
      className={`page-box ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''} ${
        overflow ? 'is-overflow' : ''
      } ${pouring && isPourTarget ? 'is-pour-target' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onMouseDown={boxMouseDown}
      onDoubleClick={(e) => {
        if (readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        if (selected && !editing) onStartEdit(box.id);
      }}
      title={!editing ? 'Click to select - double-click to type' : undefined}
      data-box-id={box.id}
    >
      {/* The text. Only editable while this box is being edited, so a first
          click selects the box and a second click (or double-click) drops the
          caret in - Publisher-style frames rather than a Word-style page. */}
      <div
        ref={setContentEl}
        className="page-box-content"
        contentEditable={editing && !readOnly}
        suppressContentEditableWarning
        spellCheck={spellCheck}
        data-ph="Type here…"
        onBeforeInput={onArmReplace}
        onKeyDown={(e) => {
          // Every keystroke re-checks whether the frame's contents are selected:
          // the first character typed over a Ctrl+A selection still sees the
          // full selection and arms the frame, and any later character sees a
          // caret and disarms it again. Ctrl+A itself is checked a tick later,
          // because the browser's select-all runs after this handler.
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            window.setTimeout(onArmReplace, 0);
            return;
          }
          onArmReplace();
        }}
        onInput={onInput}
        style={{
          columnCount: cols,
          columnGap: cols > 1 ? COLUMN_GAP : undefined,
          // Newspaper rule: a gray hairline down the middle of a multi-column
          // box (accent-color of the existing borders).
          columnRule: cols > 1 ? `1px solid ${COLUMN_RULE_COLOR}` : undefined,
          columnFill: 'balance',
        }}
      />

      {/* Red outline whenever text is clipped - even unselected - so the
          overflow state is visible at a glance (Publisher-style). */}
      {(selected || overflow) && !readOnly && <div className="page-box-outline" />}

      {selected && !readOnly && (
        <>
          {handles.map(({ h, style, cursor }) => (
            <div
              key={h}
              className="page-box-handle"
              style={{ ...style, cursor }}
              onMouseDown={(e) => beginDrag(h, e)}
              data-handle={h}
            />
          ))}

          <div
            className="page-box-tools"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              title="Single column"
              onClick={() => onGeomChange(box.id, { columns: 1 })}
              className={cols === 1 ? 'is-active' : ''}
            >
              <span className="text-[10px] font-semibold leading-none">1</span>
            </button>
            <button
              title="Two columns with a gray rule between them"
              onClick={() => onGeomChange(box.id, { columns: 2 })}
              className={cols === 2 ? 'is-active' : ''}
            >
              <Columns2 size={13} />
            </button>
            <button
              title="Three columns with gray rules between them"
              onClick={() => onGeomChange(box.id, { columns: 3 })}
              className={cols === 3 ? 'is-active' : ''}
            >
              <Columns3 size={13} />
            </button>
            {box.nextId && (
              <button
                title="Break link to next box (its text stays put)"
                onClick={() => onUnlink(box.id)}
              >
                <Unlink size={13} />
              </button>
            )}
            <button
              title="Delete text box"
              onClick={() => onDelete(box.id)}
              className="hover:text-red-600"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}

      {/* Paint-bucket link handle: sits on the right edge between the
          right-middle and bottom-right resize handles. Shown whenever this
          box is clipping text, selected or not. */}
      {overflow && !readOnly && (
        <div
          className="page-box-link-handle"
          title={
            box.nextId
              ? 'Text does not fit - it flows into the linked box. Resize boxes to rebalance.'
              : 'Text does not fit - click, then click an empty text box to pour the overflow into it'
          }
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onArmPour(box.id);
          }}
        >
          <PaintBucket size={12} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* An image box: a frame that holds a picture and nothing else.           */
/* ---------------------------------------------------------------------- */

interface ImageBoxViewProps {
  box: TextBox;
  scale: number;
  selected: boolean;
  readOnly: boolean;
  pageW: number;
  pageH: number;
  onRegisterImg: (id: string, el: HTMLImageElement | null) => void;
  onSelect: (id: string) => void;
  onGeomChange: (
    id: string,
    patch: {
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      radius?: number;
      fade?: number;
      src?: string;
      ph?: string;
      columns?: number;
    },
  ) => void;
  onDelete: (id: string) => void;
  onReplace: (id: string) => void;
}

function ImageBoxView({
  box,
  scale,
  selected,
  readOnly,
  pageW,
  pageH,
  onRegisterImg,
  onSelect,
  onGeomChange,
  onDelete,
  onReplace,
}: ImageBoxViewProps) {
  const dragRef = useRef<{
    mode: 'move' | Handle;
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
    moved: boolean;
    aspect: number;
  } | null>(null);

  const clampGeom = (g: { x: number; y: number; w: number; h: number }) => {
    const w = Math.max(MIN_W, Math.min(g.w, pageW));
    const h = Math.max(MIN_H, Math.min(g.h, pageH));
    return {
      x: Math.max(0, Math.min(g.x, pageW - w)),
      y: Math.max(0, Math.min(g.y, pageH - h)),
      w,
      h,
    };
  };

  /** Corner handles keep the aspect ratio (Publisher picture behavior);
      edge handles resize freely. */
  const beginDrag = (mode: 'move' | Handle, e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: box.x, y: box.y, w: box.w, h: box.h };
    const aspect = orig.h / Math.max(1, orig.w);
    dragRef.current = { mode, startX, startY, orig, moved: false, aspect };
    const s = scale || 1;

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / s;
      const dy = (ev.clientY - d.startY) / s;
      if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD) {
        return;
      }
      d.moved = true;
      if (d.mode === 'move') {
        onGeomChange(box.id, clampGeom({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }));
        return;
      }
      let { x, y, w, h } = d.orig;
      const side = d.mode.includes('e') || d.mode.includes('w');
      const vert = d.mode.includes('n') || d.mode.includes('s');
      if (d.mode.includes('e')) w = d.orig.w + dx;
      if (d.mode.includes('s')) h = d.orig.h + dy;
      if (d.mode.includes('w')) {
        w = d.orig.w - dx;
        x = d.orig.x + dx;
      }
      if (d.mode.includes('n')) {
        h = d.orig.h - dy;
        y = d.orig.y + dy;
      }
      // Pictures keep their aspect ratio: whichever dimension the drag
      // changed, the other follows, so a frame never stretches its image.
      if (side && !vert) h = Math.round(w * d.aspect);
      else if (vert && !side) w = Math.round(h / d.aspect);
      else if (Math.abs(w - d.orig.w) >= Math.abs(h - d.orig.h)) h = Math.round(w * d.aspect);
      else w = Math.round(h / d.aspect);
      onGeomChange(box.id, clampGeom({ x, y, w, h }));
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handles: { h: Handle; style: React.CSSProperties; cursor: string }[] = [
    { h: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
    { h: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
    { h: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
    { h: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
    { h: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
    { h: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
    { h: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
    { h: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
  ];

  const radius = Math.max(0, Math.min(2000, Math.round(box.radius ?? 0)));
  const minSide = Math.max(2, Math.min(box.w, box.h));
  const fade = Math.max(0, Math.min(Math.round(box.fade ?? 0), Math.floor(minSide / 2)));
  // The picture's edges dissolve out over `fade` px: two linear gradients
  // (horizontal + vertical) intersected, so only the borders fade and the
  // middle stays fully opaque - corners keep their colour, no ellipse.
  const maskPct = fade > 0 ? (fade / minSide) * 100 : 0;
  const maskH = `linear-gradient(to right, transparent 0, #000 ${maskPct.toFixed(1)}%, #000 ${(100 - maskPct).toFixed(1)}%, transparent 100%)`;
  const maskV = `linear-gradient(to bottom, transparent 0, #000 ${maskPct.toFixed(1)}%, #000 ${(100 - maskPct).toFixed(1)}%, transparent 100%)`;
  const mask = fade > 0 ? `${maskH}, ${maskV}` : undefined;

  return (
    <div
      className={`page-box page-box-image ${selected ? 'is-selected' : ''} ${box.ph ? 'is-ph' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onMouseDown={(e) => {
        if (readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        // A placeholder frame is click-to-fill: pick a picture straight away
        // (and select it so its tools are visible if the picker is cancelled).
        if (box.ph) {
          if (!selected) onSelect(box.id);
          onReplace(box.id);
          return;
        }
        // First click selects the frame (handles appear); a later press on
        // the selection drags it - same two-step feel as text boxes.
        if (!selected) {
          onSelect(box.id);
          return;
        }
        beginDrag('move', e);
      }}
      title={
        box.ph
          ? 'Click to add ' + box.ph.toLowerCase()
          : 'Click to select - drag to move'
      }
      data-box-id={box.id}
    >
      <img
        ref={(el) => onRegisterImg(box.id, el)}
        src={box.src}
        alt={box.ph ?? ''}
        draggable={false}
        className="page-box-image-img"
        style={{
          borderRadius: radius,
          maskImage: mask,
          WebkitMaskImage: mask,
          maskComposite: 'intersect',
          // `contain` shows the whole picture (the graphic page); `cover` crops
          // it to the frame (a full-page title/puzzle, where the frame IS A4).
          objectFit: box.fit ?? 'cover',
        }}
      />

      {/* Placeholder cover: a dashed frame that fills the box and invites the
          click-to-add-picture action above. */}
      {box.ph && (
        <div className="page-box-ph" aria-hidden="true">
          <span>Add {box.ph}</span>
        </div>
      )}

      {selected && !readOnly && (
        <>
          {handles.map(({ h, style, cursor }) => (
            <div
              key={h}
              className="page-box-handle"
              style={{ ...style, cursor }}
              onMouseDown={(e) => beginDrag(h, e)}
              data-handle={h}
            />
          ))}
          <div className="page-box-tools page-box-tools-img" onMouseDown={(e) => e.stopPropagation()}>
            <label className="img-style-field" title="Corner radius (px)">
              <span>Radius</span>
              <input
                type="number"
                min={0}
                max={2000}
                step={1}
                value={radius}
                onChange={(e) =>
                  onGeomChange(box.id, {
                    radius: Math.max(0, Math.min(2000, Math.round(Number(e.target.value) || 0))),
                  })
                }
              />
            </label>
            <label className="img-style-field" title="Soft edge fade (px)">
              <span>Fade</span>
              <input
                type="number"
                min={0}
                max={Math.max(0, Math.floor(minSide / 2))}
                step={1}
                value={fade}
                onChange={(e) =>
                  onGeomChange(box.id, {
                    fade: Math.max(
                      0,
                      Math.min(Math.floor(minSide / 2), Math.round(Number(e.target.value) || 0)),
                    ),
                  })
                }
              />
            </label>
            {box.ph && (
              <button
                title="Replace image - pick a picture from your computer"
                onClick={() => onReplace(box.id)}
              >
                <ImagePlus size={13} />
              </button>
            )}
            <button
              title="Delete image"
              onClick={() => onDelete(box.id)}
              className="hover:text-red-600"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* A shape (filled rectangle) or a line: a page object, like a picture.    */
/* ---------------------------------------------------------------------- */

interface ShapeBoxViewProps {
  box: TextBox;
  scale: number;
  selected: boolean;
  readOnly: boolean;
  pageW: number;
  pageH: number;
  onSelect: (id: string) => void;
  onGeomChange: (
    id: string,
    patch: {
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      radius?: number;
      fill?: string;
      stroke?: string;
      thickness?: number;
    },
  ) => void;
  onDelete: (id: string) => void;
}

/**
 * A **shape** box - the orange rectangles the bulletin uses for its cards - or
 * a **line**, a free-standing rule. Both are ordinary page objects: click to
 * select, drag to move, pull a handle to resize, and edit their colour / radius
 * / weight in the little tools strip. Neither holds text, so neither takes part
 * in the text-flow engine.
 */
function ShapeBoxView({
  box,
  scale,
  selected,
  readOnly,
  pageW,
  pageH,
  onSelect,
  onGeomChange,
  onDelete,
}: ShapeBoxViewProps) {
  const dragRef = useRef<{
    mode: 'move' | Handle;
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
    moved: boolean;
  } | null>(null);

  const isLine = box.kind === 'line';

  const clampGeom = (g: { x: number; y: number; w: number; h: number }) => {
    const w = Math.max(MIN_W, Math.min(g.w, pageW));
    const h = Math.max(MIN_H, Math.min(g.h, pageH));
    return {
      x: Math.max(0, Math.min(g.x, pageW - w)),
      y: Math.max(0, Math.min(g.y, pageH - h)),
      w,
      h,
    };
  };

  const beginDrag = (mode: 'move' | Handle, e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: box.x, y: box.y, w: box.w, h: box.h };
    dragRef.current = { mode, startX, startY, orig, moved: false };
    const s = scale || 1;

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / s;
      const dy = (ev.clientY - d.startY) / s;
      if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD) {
        return;
      }
      d.moved = true;
      if (d.mode === 'move') {
        onGeomChange(box.id, clampGeom({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }));
        return;
      }
      let { x, y, w, h } = d.orig;
      if (d.mode.includes('e')) w = d.orig.w + dx;
      if (d.mode.includes('s')) h = d.orig.h + dy;
      if (d.mode.includes('w')) {
        w = d.orig.w - dx;
        x = d.orig.x + dx;
      }
      if (d.mode.includes('n')) {
        h = d.orig.h - dy;
        y = d.orig.y + dy;
      }
      onGeomChange(box.id, clampGeom({ x, y, w, h }));
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handles: { h: Handle; style: React.CSSProperties; cursor: string }[] = [
    { h: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
    { h: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
    { h: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
    { h: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
    { h: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
    { h: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
    { h: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
    { h: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
  ];

  const fill = box.fill ?? '#fe9c53';
  const stroke = box.stroke ?? '#3f3f3f';
  const thickness = Math.max(1, Math.min(200, Math.round(box.thickness ?? 2)));
  const radius = Math.max(0, Math.min(2000, Math.round(box.radius ?? 0)));

  return (
    <div
      className={`page-box page-box-shape ${selected ? 'is-selected' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onMouseDown={(e) => {
        if (readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        if (!selected) {
          onSelect(box.id);
          return;
        }
        beginDrag('move', e);
      }}
      title={isLine ? 'Click to select - drag to move the line' : 'Click to select - drag to move the shape'}
      data-box-id={box.id}
    >
      {isLine ? (
        <div className="page-box-line" style={{ height: thickness, background: stroke }} />
      ) : (
        <div className="page-box-fill" style={{ background: fill, borderRadius: radius }} />
      )}

      {selected && !readOnly && (
        <>
          {handles.map(({ h, style, cursor }) => (
            <div
              key={h}
              className="page-box-handle"
              style={{ ...style, cursor }}
              onMouseDown={(e) => beginDrag(h, e)}
              data-handle={h}
            />
          ))}
          <div className="page-box-tools page-box-tools-img" onMouseDown={(e) => e.stopPropagation()}>
            {isLine ? (
              <>
                <label className="img-style-field" title="Line colour">
                  <span>Colour</span>
                  <input
                    type="color"
                    value={stroke}
                    onChange={(e) => onGeomChange(box.id, { stroke: e.target.value })}
                  />
                </label>
                <label className="img-style-field" title="Line thickness (px)">
                  <span>Weight</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    value={thickness}
                    onChange={(e) =>
                      onGeomChange(box.id, {
                        thickness: Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))),
                      })
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <label className="img-style-field" title="Shape colour">
                  <span>Colour</span>
                  <input
                    type="color"
                    value={fill}
                    onChange={(e) => onGeomChange(box.id, { fill: e.target.value })}
                  />
                </label>
                <label className="img-style-field" title="Corner radius (px)">
                  <span>Radius</span>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    step={1}
                    value={radius}
                    onChange={(e) =>
                      onGeomChange(box.id, {
                        radius: Math.max(0, Math.min(2000, Math.round(Number(e.target.value) || 0))),
                      })
                    }
                  />
                </label>
              </>
            )}
            <button
              title={isLine ? 'Delete line' : 'Delete shape'}
              onClick={() => onDelete(box.id)}
              className="hover:text-red-600"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* An imported PDF page: a full-sheet, non-editable viewer frame.          */
/* ---------------------------------------------------------------------- */

/**
 * One page of an imported PDF.
 *
 * The page is shown with the browser's own PDF viewer at that page number, so
 * the text is selectable and searchable rather than being a flat picture. It is
 * deliberately not a text box: there is nothing to type into, and it is not
 * draggable (a drag would swallow the click that starts a text selection).
 */
function PdfPageView({ box }: { box: TextBox }) {
  const url = resolvePdfSrc(box.src);
  const page = Math.max(1, box.pdfPage ?? 1);
  return (
    <div
      className="pdf-page-frame"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      {url ? (
        <iframe
          // `#page=N` opens the viewer on this page; the chrome is switched off
          // so the sheet shows just the paper.
          src={`${url}#page=${page}&toolbar=0&navpanes=0&statusbar=0&view=FitH`}
          title={`PDF page ${page}`}
          className="pdf-page-embed"
        />
      ) : (
        <div className="pdf-page-missing">
          PDF page {page} - re-import this PDF to view it
        </div>
      )}
    </div>
  );
}
