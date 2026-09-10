import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Columns2, Columns3, ImagePlus, PaintBucket, Trash2, Unlink } from 'lucide-react';
import PageSidebar from './PageSidebar';
import {
  registerEditor,
  initEditorCommands,
  startSelectionTracking,
} from '../lib/editor';
import {
  flowStory,
  recomposeStory,
  caretOffsetIn,
  setCaretOffset,
} from '../lib/textbox';
import { useGoogleFont } from './GoogleFontProvider';
import { GOOGLE_FONT_FAMILIES } from '../data/googleFonts';
import {
  bandForPage,
  fillMasterTokens,
  slotForPage,
  BAND_LABELS,
  type BandKey,
  type BandSlot,
  type MasterBand,
  type MasterPage,
} from '../lib/master';

const RULER_SIZE = 28; // px thickness shared by the top and left rulers
const PAGE_GAP = 32; // flex gap (gap-8) between page sheets
const MIN_W = 60;
const MIN_H = 40;
/** Height of the header/footer band drawn in a page's top/bottom margin. */
const MASTER_BAND_H = 28;
/** 1×1 transparent GIF — the invisible backing picture of a placeholder box
    (its dashed 'click to add' cover is drawn by CSS, see .page-box-ph). */
const TRANSPARENT_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Vertical gap between stacked element boxes in a migrated document. */
const SPLIT_GAP = 24;
/** Gutter (px) between columns inside a multi-column text box. */
const COLUMN_GAP = 28;
/** Gray of the rule drawn between columns (matches the frame borders). */
const COLUMN_RULE_COLOR = '#d8d2ca';
/** Pixels of movement before a click on a selected box turns into a drag. */
const DRAG_THRESHOLD = 3;

const DEFAULT_MARGINS = { left: 96, right: 96, top: 80, bottom: 80 };

/**
 * Where a header/footer band sits on the sheet.
 *
 * Publisher puts the furniture *inside* the page margins, not on top of the
 * text: the header is centred in the top margin, the footer centred in the
 * bottom margin, and both span the full width of the text column. That way
 * dragging a margin arrow moves the running head with it.
 */
function masterBandBox(
  slot: BandSlot,
  page: { width: number; height: number },
  margins: typeof DEFAULT_MARGINS,
) {
  const h = MASTER_BAND_H;
  const top =
    slot === 'header'
      ? Math.max(6, Math.round((margins.top - h) / 2))
      : page.height - margins.bottom + Math.max(4, Math.round((margins.bottom - h) / 2));
  return {
    left: margins.left,
    top,
    width: Math.max(60, page.width - margins.left - margins.right),
    height: h,
  };
}

/**
 * A text box on the page. `html` is only the *seed* — after mount the box's
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
  /** Image boxes hold a picture only. A `sheet` entry is an empty-page marker:
      it reserves a page slot so blank (e.g. trailing) pages survive saves. */
  kind?: 'image' | 'sheet';
  /** Image source (data URL or path) when `kind === 'image'`. */
  src?: string;
  /** Corner rounding (px) applied to an image box's picture. */
  radius?: number;
  /** Soft-edge fade (px): how far the picture's edges dissolve out. */
  fade?: number;
  /** Placeholder hint for an empty image box (e.g. from a bulletin template):
      while set, the frame draws a dashed 'click to add …' cover and a click
      opens the image picker instead of selecting. Cleared when a real image
      is dropped in. */
  ph?: string;
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
  /** Called on every document change with the flat HTML + serialized boxes. */
  onDocChange: (html: string, boxesJson: string) => void;
  /** Show the end-of-document tombstone (small black square) on the last page. */
  tombstone?: boolean;
  /** The document's master page: header/footer furniture for every sheet. */
  master?: MasterPage;
  /** Master-page view: the furniture is editable in place, the page is not. */
  masterMode?: boolean;
  /** Fired when a master band receives focus, so the Master Pages ribbon
      knows where to drop Insert Page Number / Date / Time. */
  onMasterBandFocus?: (slot: BandKey) => void;
  /** Bumped when the master's text was changed off-page, to re-seed the bands. */
  masterRev?: number;
  /** Document title, for the @title field token. */
  docTitle?: string;
  /** The user typed into one of the master's bands. */
  onMasterBandChange?: (slot: BandKey, patch: { text: string }) => void;
}

let boxSeq = 0;
function newBoxId(): string {
  boxSeq += 1;
  return `tb${Date.now().toString(36)}${boxSeq.toString(36)}`;
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
/* Inline runs — a wrapper holding only these is itself a text unit. */
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
 * independently movable/resizable frame — Publisher-style. Layout wrappers
 * (flex rows, section divs…) are unwrapped, elements are stacked down the
 * margin column, and they flow onto extra pages when they no longer fit.
 * Pure spacing elements (empty paragraphs) are dropped.
 */
function splitIntoBoxes(
  content: string,
  page: { width: number; height: number },
  margins: typeof DEFAULT_MARGINS,
): TextBox[] {
  const contentW = Math.max(MIN_W, page.width - margins.left - margins.right);
  const contentH = Math.max(MIN_H, page.height - margins.top - margins.bottom);

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
        x: margins.left,
        y: margins.top,
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
  let y = margins.top;

  const place = (entry: {
    html?: string;
    kind?: 'image';
    src?: string;
    x?: number;
    w: number;
    h: number;
    radius?: number;
    fade?: number;
    ph?: string;
  }) => {
    out.push({
      id: newBoxId(),
      pageIndex,
      x: entry.x ?? margins.left,
      y,
      w: entry.w,
      h: entry.h,
      html: entry.html ?? '',
      kind: entry.kind,
      src: entry.src,
      radius: entry.radius,
      fade: entry.fade,
      ph: entry.ph,
      nextId: null,
    });
    y += entry.h + SPLIT_GAP;
    if (y > page.height - margins.bottom) {
      pageIndex += 1;
      y = margins.top;
    }
  };

  for (const el of leaves) {
    // A top-level image becomes its own image box — a picture is an object
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
      // data-ph marks an empty image frame: the box opens as a click-to-add
      // placeholder (dashed 'add image' cover) instead of showing artwork.
      const ph = img.getAttribute('data-ph') || undefined;
      place({
        kind: 'image',
        src: ph ? TRANSPARENT_GIF : src,
        x: margins.left + Math.round((contentW - w) / 2),
        w,
        h,
        radius,
        fade,
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
  margins: typeof DEFAULT_MARGINS,
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
                  : undefined,
            src: typeof b.src === 'string' ? b.src : undefined,
            radius:
              typeof b.radius === 'number'
                ? Math.max(0, Math.min(2000, Math.round(b.radius)))
                : undefined,
            fade:
              typeof b.fade === 'number'
                ? Math.max(0, Math.min(2000, Math.round(b.fade)))
                : undefined,
            columns:
              typeof b.columns === 'number' && b.columns >= 1
                ? Math.min(4, Math.round(b.columns))
                : undefined,
            ph: typeof b.ph === 'string' ? b.ph : undefined,
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
          const coarse =
            list.length === 1 &&
            Math.abs(list[0].w - Math.max(MIN_W, page.width - margins.left - margins.right)) < 2 &&
            Math.abs(list[0].x - margins.left) < 2 &&
            list[0].h >= Math.max(MIN_H, page.height - margins.top - margins.bottom) - 2;
          if (!coarse) return promoted;
        }
      }
    } catch {
      /* fall through to the legacy migration */
    }
  }
  return splitIntoBoxes(content, page, margins);
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
  kind?: 'image' | 'sheet';
  src?: string;
  radius?: number;
  fade?: number;
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
  onDocChange,
  tombstone = false,
  master,
  masterMode = false,
  masterRev = 0,
  docTitle = '',
  onMasterBandChange,
  onMasterBandFocus,
}: DocumentCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // An absent master renders nothing rather than crashing the canvas.
  const masterPage: MasterPage | null = master ?? null;

  // Page margins (px) that the rulers edit by dragging the blue arrows. They
  // shape the printable-area shading on the rulers and the column migrated
  // content stacks into; individual boxes can be placed anywhere.
  const [margins, setMargins] = useState(DEFAULT_MARGINS);

  const [boxesState, setBoxesState] = useState<TextBox[]>(() =>
    buildModel(content, boxes, page, DEFAULT_MARGINS),
  );
  const boxesRef = useRef(boxesState);
  const [selId, setSelId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const editIdRef = useRef<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const lastImageTickRef = useRef(0);
  const lastTickRef = useRef(textboxTick);
  /** Page the user last clicked / worked on — where new boxes are added. */
  const activePageRef = useRef(0);
  /** Highlighted page (sidebar + insertion target). Kept in sync with the ref. */
  const [activePageUi, setActivePageUi] = useState(0);
  const activatePage = useCallback((p: number) => {
    activePageRef.current = Math.max(0, p);
    setActivePageUi(Math.max(0, p));
  }, []);

  // Master view always edits page 1's furniture (page 2 too for odd & even),
  // so jump there — otherwise the highlighted sidebar page and the sheet on
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

  /** Boxes whose chain still has hidden text — they render red chrome. */
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
  const pagesRef = useRef<HTMLDivElement>(null);
  const firstRev = useRef(true);
  const { loadFont, isGoogleFont } = useGoogleFont();

  /** Set the box list, keeping the ref mirror in step. */
  const applyBoxes = useCallback((next: TextBox[]) => {
    boxesRef.current = next;
    setBoxesState(next);
  }, []);

  /** Flat HTML of the whole document + per-box geometry/content snapshot. */
  const snapshot = useCallback(() => {
    for (const b of boxesRef.current) {
      if (b.kind) continue; // image/sheet boxes have no live text
      const el = boxEls.current.get(b.id);
      liveHtml.current.set(b.id, el ? el.innerHTML : b.html);
    }
    const entries: BoxEntry[] = boxesRef.current.map((b) => {
      const el = boxEls.current.get(b.id);
      if (b.kind === 'image') {
        return {
          id: b.id,
          pageIndex: b.pageIndex,
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: Math.round(b.w),
          h: Math.round(b.h),
          html: '',
          nextId: b.nextId,
          kind: 'image',
          src: b.src,
          radius: typeof b.radius === 'number' ? Math.round(b.radius) : undefined,
          fade: typeof b.fade === 'number' ? Math.round(b.fade) : undefined,
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
        columns: b.columns && b.columns > 1 ? b.columns : undefined,
        nextId: b.nextId,
      };
    });
    setThumbRev((r) => r + 1);
    onDocChange(
      entries.map((e) => e.html).join(''),
      JSON.stringify(entries),
    );
  }, [onDocChange]);

  /**
   * The overflow/flow engine.
   *
   * Linked chains (boxes chained via `nextId`) share one story: the chain's
   * live contents are pooled, then redistributed so each box shows exactly
   * what fits. The last box of a chain holds whatever is left; if even it
   * cannot show everything, the chain is in overflow and its chrome turns
   * red. Re-running this after every edit or resize makes links self-heal —
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
    // against the box's *state* height — the DOM still shows the previous
    // frame during the same-tick resize → reflow sequence.
    for (const b of list) {
      if (b.nextId || incoming.has(b.id) || b.kind === 'image' || b.kind === 'sheet') continue;
      const el = boxEls.current.get(b.id);
      if (el && el.scrollHeight > b.h + 1) overflow.add(b.id);
    }

    setOverflowIds((prev) => {
      if (prev.size === overflow.size && [...overflow].every((id) => prev.has(id))) {
        return prev;
      }
      return overflow;
    });
  }, []);

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
    const next = buildModel(content, boxes, page, margins);
    applyBoxes(next);
    setSelId(null);
    setEditId(null);
    editIdRef.current = null;
    activatePage(0);
    setOverflowIds(new Set());
    setPourSourceId(null);
    setPourTargets(new Set());
    registerEditor(null);
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
    const m = margins;
    const targetPage = Math.min(activePageRef.current, pageCount - 1);
    const contentW = Math.max(120, page.width - m.left - m.right);
    const onPage = boxesRef.current.filter((b) => b.pageIndex === targetPage);
    const n = onPage.length;
    const w = Math.min(360, Math.max(240, Math.round(contentW * 0.48)));
    const h = 150;
    // Sit below the lowest box already on the page, within the margins.
    const lowest = onPage.reduce((mx, b) => Math.max(mx, b.y + b.h), m.top);
    const x = Math.min(m.left + (n % 3) * 26, Math.max(m.left, page.width - m.right - w));
    const y = Math.min(Math.max(m.top, lowest + SPLIT_GAP), Math.max(m.top, page.height - m.bottom - h));
    const box: TextBox = { id: newBoxId(), pageIndex: targetPage, x, y, w, h, html: '', nextId: null, kind: undefined, src: undefined };
    applyBoxes([...boxesRef.current, box]);
    setSelId(box.id);
    // Inserting while a pour is armed: the fresh empty box is exactly what
    // the user is about to pour into — make it a target and leave it
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
     resizable frame that holds only the image — no text editing, no story
     flow. `imageTick` bumps when the user picks a file. */
  useEffect(() => {
    if (!imageTick || imageTick === lastImageTickRef.current) return;
    lastImageTickRef.current = imageTick;
    const m = margins;
    const targetPage = Math.min(activePageRef.current, pageCount - 1);
    const contentW = Math.max(120, page.width - m.left - m.right);
    const onPage = boxesRef.current.filter((b) => b.pageIndex === targetPage);
    const w = Math.min(360, Math.max(240, Math.round(contentW * 0.48)));
    const h = Math.round((w * 3) / 4);
    // Sit below the lowest box already on the page, within the margins.
    const lowest = onPage.reduce((mx, b) => Math.max(mx, b.y + b.h), m.top);
    const x = m.left + Math.round((contentW - w) / 2);
    const y = Math.min(
      Math.max(m.top, lowest + SPLIT_GAP),
      Math.max(m.top, page.height - m.bottom - h),
    );
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
    (id: string, html: string, el: HTMLDivElement | null) => {
      if (el) {
        boxEls.current.set(id, el);
        if (!el.dataset.seeded) {
          // Prefer the most recent snapshot so a frame that remounts (page
          // moved, box rebuilt) keeps the content the user typed.
          el.innerHTML = liveHtml.current.get(id) ?? html;
          el.dataset.seeded = '1';
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

  /* Images measure short until they load (height:auto, no dimensions yet), so
     migrated image boxes can start too small. When an image finishes loading
     inside a box, grow that box once to fit its content. Image boxes fit to
     their own <img> instead. */
  useEffect(() => {
    const fit = (id: string) => {
      const b = boxesRef.current.find((x) => x.id === id);
      if (!b) return;
      if (b.kind === 'image') {
        // Match the frame's aspect to the picture once it is known: the
        // height follows the CURRENT width (never stretch the frame).
        const img = imgEls.current.get(id);
        if (!img || !img.naturalWidth) return;
        const maxH = page.height - margins.bottom;
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
        const maxH = page.height - margins.bottom;
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
  }, [page.height, margins.bottom, updateBox]);

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
        if (b.id === id || b.nextId || (b.kind === 'image' || b.kind === 'sheet')) continue;
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
      if (!src || !target || target.nextId || target.kind === 'image') return;
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

  /** Keystrokes / formatting inside a box: redistribute any chains, then
      snapshot the result so autosave sees the redistributed content. */
  const handleInput = useCallback(() => {
    reflowAll();
    snapshot();
  }, [reflowAll, snapshot]);

  // Keep the ref in step for the delete/rev bookkeeping.
  useEffect(() => {
    editIdRef.current = editId;
  }, [editId]);

  const hint = useMemo(
    () => (
      <div className="page-empty-hint no-print">
        {readOnly
          ? 'This page is empty'
          : 'This page is empty — choose Insert › Text box to add one'}
      </div>
    ),
    [readOnly],
  );

  /* ------------------------ sidebar page management ------------------------ */

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

  const scrollToPage = useCallback((p: number) => {
    const root = containerRef.current;
    const sheet = root?.querySelector<HTMLElement>(`[data-sheet="${p}"]`);
    if (root && sheet) sheet.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const selectPage = useCallback(
    (p: number) => {
      const clamped = Math.max(0, Math.min(p, pageCount - 1));
      setSelId(null);
      setEditId(null);
      activatePage(clamped);
      scrollToPage(clamped);
    },
    [pageCount, activatePage, scrollToPage],
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
    scrollToPage(nextIndex);
    reflowAll();
    snapshot();
  }, [applyBoxes, makeSheet, activatePage, scrollToPage, reflowAll, snapshot]);

  /** Duplicate page `p` — every frame, its live content — right after it. */
  const duplicatePage = useCallback(
    (p: number) => {
      const list = boxesRef.current;
      const src = list.filter((b) => b.pageIndex === p);
      if (!src.length) return;
      const copies: TextBox[] = src.map((b) => {
        const html = b.kind ? '' : boxEls.current.get(b.id)?.innerHTML ?? b.html;
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
      scrollToPage(p + 1);
      reflowAll();
      snapshot();
    },
    [applyBoxes, activatePage, scrollToPage, reflowAll, snapshot],
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
          (b.kind === 'image' ||
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
    },
    [applyBoxes, activatePage, reflowAll, snapshot],
  );

  /** Live text of a box (for thumbnails): the mirror, else the seed. */
  const contentOf = useCallback((b: TextBox) => {
    if (b.kind) return '';
    return liveHtml.current.get(b.id) ?? b.html;
  }, []);

  /** Whether the document has any real content (vs. blank/empty pages). */
  const hasAnyContent = boxesState.some((b) => b.kind !== 'sheet');

  /**
   * Which sheets to draw. Master-page view shows just the master itself —
   * page 1, plus page 2 when odd & even furniture is on, so the even-page
   * bands have somewhere to be edited.
   */
  const sheets: number[] = masterMode
    ? // Page 2 is laid out beside page 1 when the furniture differs there, so
      // every variant has somewhere to be edited. It also has to be shown when
      // page 1 is bare — otherwise the default bands would have no home.
      masterPage && (masterPage.differentOddEven || !masterPage.showOnFirstPage)
      ? [0, 1]
      : [0]
    : Array.from({ length: pageCount }, (_, i) => i);

  /** Resolve a band for one sheet, or null when that page carries none. */
  const resolved = useCallback(
    (slot: BandSlot, pageIndex: number): MasterBand | null => {
      if (!masterPage) return null;
      const b = bandForPage(masterPage, slot, pageIndex);
      if (!b || !b.text.trim()) return null;
      return b;
    },
    [masterPage],
  );

  return (
    <div className="doc-wrap flex min-h-0 w-full">
      <PageSidebar
        pageCount={masterMode ? sheets.length : pageCount}
        pageW={page.width}
        pageH={page.height}
        activePage={Math.min(activePageUi, (masterMode ? sheets.length : pageCount) - 1)}
        readOnly={readOnly}
        masterMode={masterMode}
        onSelectPage={selectPage}
        onAddPage={addPage}
        onDeletePage={deletePage}
        onDuplicatePage={duplicatePage}
        renderPage={(i) => (
          <PageThumb
            boxes={boxesState}
            pageIndex={i}
            pageW={page.width}
            pageH={page.height}
            contentOf={contentOf}
            showTombstone={tombstone && i === pageCount - 1}
            master={masterPage}
            pageCount={pageCount}
            docTitle={docTitle}
            margins={margins}
          />
        )}
      />
      <div ref={containerRef} className="doc-main relative min-w-0 flex-1 overflow-auto bg-[#f1f0ee]">
      {/* Horizontal ruler (unchanged chrome; margins only shade the zones). */}
      {showRuler && (
        <div className="no-print sticky top-0 z-20 border-b border-gdoc-border bg-white">
          <div
            className="relative mx-auto select-none text-[10px] text-gdoc-muted"
            style={{ width: `${page.width * scale}px`, height: `${RULER_SIZE}px` }}
          >
            <div className="absolute inset-0" style={{ height: `${RULER_SIZE}px` }}>
              <div className="absolute bottom-0 top-0 bg-gdoc-muted/10" style={{ left: 0, width: `${margins.left * scale}px` }} />
              <div className="absolute bottom-0 top-0 bg-gdoc-muted/10" style={{ left: `${(page.width - margins.right) * scale}px`, right: 0 }} />
            </div>
            <div
              className="absolute bottom-0 flex"
              style={{
                left: `${margins.left * scale}px`,
                width: `${Math.max(0, page.width - margins.left - margins.right) * scale}px`,
              }}
            >
              {Array.from(
                { length: Math.max(1, Math.floor((page.width - margins.left - margins.right) / 96)) },
                (_, i) => (
                  <div key={i} className="relative flex-1">
                    <span className="absolute bottom-[7px] left-1 leading-none">{i + 1}</span>
                    <div className="absolute bottom-0 h-[5px] w-px bg-gdoc-muted/40" />
                    <div className="absolute bottom-0 left-1/2 h-[3px] w-px bg-gdoc-muted/25" />
                  </div>
                ),
              )}
            </div>
            {(['left', 'right'] as const).map((side) => {
              const isLeft = side === 'left';
              const pos = isLeft
                ? margins.left * scale
                : (page.width - margins.right) * scale;
              return (
                <div
                  key={side}
                  className="absolute -bottom-1 flex cursor-ew-resize flex-col items-center"
                  style={{ left: `${pos}px`, transform: 'translateX(-50%)' }}
                  title={isLeft ? 'Left margin' : 'Right margin'}
                  onMouseDown={(e) => beginMarginDrag(side, e)}
                >
                  <div
                    className="h-0 w-0 border-x-[6px] border-t-[7px]"
                    style={{
                      borderLeftColor: 'transparent',
                      borderRightColor: 'transparent',
                      borderTopColor: '#1a73e8',
                    }}
                  />
                  <div className="h-2 w-px bg-[#1a73e8]" />
                </div>
              );
            })}
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
          {sheets.map((pageIndex) => (
            <div
              key={pageIndex}
              data-sheet={pageIndex}
              className={`doc-paper relative ${masterMode ? 'is-master' : ''}`}
              style={{
                width: `${page.width}px`,
                height: `${page.height}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top center',
              }}
            >
              {/* Publisher tabs each master sheet in the corner: PAGE A / B. */}
              {masterMode && (
                <span className="master-sheet-label" aria-hidden="true">
                  Page {String.fromCharCode(65 + pageIndex)}
                </span>
              )}
              <div
                className={`page-box-layer relative h-full w-full ${pourSourceId ? 'is-pouring' : ''} ${
                  masterMode ? 'is-master-layer' : ''
                }`}
                onMouseDown={() => paperMouseDown(pageIndex)}
              >
                {pageIndex === 0 && !hasAnyContent && !masterMode && hint}

                {boxesState
                  .filter((b) => b.pageIndex === pageIndex && b.kind !== 'sheet')
                  .map((box) =>
                    box.kind === 'image' ? (
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
                    ) : (
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
                      onInput={handleInput}
                      onGeomChange={updateBox}
                      onArmPour={armPour}
                      onAcceptPour={acceptPour}
                      onUnlink={unlinkBox}
                      onDelete={removeBox}
                    />
                    )
                  )}
              </div>

              {tombstone && pageIndex === pageCount - 1 && (
                <svg
                  className="page-tombstone"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <rect x="0.5" y="0.5" width="11" height="11" rx="3.5" fill="#1f1f1f" />
                </svg>
              )}

              {/* Master-page furniture. In master view the bands become live
                  text you type straight into, wrapped in the dashed
                  non-printing guides Publisher draws on the master. */}
              {masterPage && (['header', 'footer'] as BandSlot[]).map((slot) => {
                // A page that prints no furniture offers nothing to edit.
                if (pageIndex === 0 && !masterPage.showOnFirstPage) return null;
                if (masterMode) {
                  const key = slotForPage(masterPage!, slot, pageIndex);
                  const source = masterPage![key];
                  return (
                    <MasterBandView
                      key={`${slot}-${pageIndex}-${key}-${rev}-${masterRev}`}
                      slot={slot}
                      label={BAND_LABELS[key]}
                      box={masterBandBox(slot, page, margins)}
                      bandHeight={MASTER_BAND_H}
                      text={source.text}
                      align={source.align}
                      placeholder={slot === 'header' ? 'Header' : 'Footer'}
                      editable={!readOnly}
                      onChange={(text) => onMasterBandChange?.(key, { text })}
                      onFocusBand={() => onMasterBandFocus?.(key)}
                    />
                  );
                }
                const band = resolved(slot, pageIndex);
                if (!band) return null;
                return (
                  <div
                    key={`${slot}-${pageIndex}`}
                    className={`master-band master-band-${slot}`}
                    style={{
                      ...masterBandBox(slot, page, margins),
                      textAlign: band.align,
                      // A single line box as tall as the band centres the
                      // furniture vertically inside its margin slot.
                      lineHeight: `${MASTER_BAND_H}px`,
                    }}
                  >
                    {fillMasterTokens(band.text, pageIndex + 1, pageCount, docTitle)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Vertical ruler (chrome; spans the whole page stack). */}
      {showRuler && (
        <div
          className="no-print absolute z-10 select-none border-r border-gdoc-border bg-white text-[10px] text-gdoc-muted"
          style={{
            top: `${RULER_SIZE}px`,
            left: 0,
            width: `${RULER_SIZE}px`,
            // Layout height, not painted height: the sheets are scaled with a
            // CSS transform, which does not change how tall the stack is, so
            // multiplying by `scale` made the ruler stop short when zoomed out
            // and overrun the page when zoomed in.
            height: `${pageCount * page.height + (pageCount - 1) * PAGE_GAP + 2 * PAGE_GAP}px`,
          }}
        >
          <div className="absolute inset-0">
            <div className="absolute inset-x-0 top-0 bg-gdoc-muted/10" style={{ height: `${PAGE_GAP + margins.top}px` }} />
            <div className="absolute inset-x-0 bottom-0 bg-gdoc-muted/10" style={{ height: `${PAGE_GAP + margins.bottom}px` }} />
          </div>
          <div
            className="absolute flex flex-col"
            style={{
              top: `${PAGE_GAP + margins.top}px`,
              bottom: `${PAGE_GAP + margins.bottom}px`,
              left: 0,
              right: 0,
            }}
          >
            {Array.from(
              { length: Math.max(1, Math.floor((page.height - margins.top - margins.bottom) / 96)) },
              (_, i) => (
                <div key={i} className="relative flex-1">
                  <span className="absolute left-1.5 top-0.5 leading-none">{i + 1}</span>
                  <div className="absolute right-0 top-0 h-px w-[5px] bg-gdoc-muted/40" />
                  <div className="absolute right-0 top-1/2 h-px w-[3px] bg-gdoc-muted/25" />
                </div>
              ),
            )}
          </div>
          {(['top', 'bottom'] as const).map((side) => {
            const isTop = side === 'top';
            const pos = PAGE_GAP + (isTop ? margins.top : page.height - margins.bottom);
            return (
              <div
                key={side}
                className="absolute right-0 flex cursor-ns-resize flex-row items-center"
                style={{ top: `${pos}px`, transform: 'translateY(-50%)' }}
                title={isTop ? 'Top margin' : 'Bottom margin'}
                onMouseDown={(e) => beginMarginDrag(side, e)}
              >
                <div
                  className="h-0 w-0 border-y-[6px] border-l-[7px]"
                  style={{
                    borderTopColor: 'transparent',
                    borderBottomColor: 'transparent',
                    borderLeftColor: '#1a73e8',
                  }}
                />
                <div className="h-px w-2 bg-[#1a73e8]" />
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );

  /* ---------- margin-arrow dragging (chrome kept from before) ---------- */

  function beginMarginDrag(axis: 'left' | 'right' | 'top' | 'bottom', e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const MIN = 12;
    const vertical = axis === 'top' || axis === 'bottom';
    const startPos = vertical ? e.clientY : e.clientX;
    const startValue = margins[axis];
    // The top ruler is drawn at zoom scale; the side ruler sits in the
    // unscaled scroll content, so its arrows move in layout pixels.
    const axisScale = vertical ? 1 : scale;

    const onMove = (ev: MouseEvent) => {
      const cur = vertical ? ev.clientY : ev.clientX;
      const delta = (cur - startPos) / (axisScale || 1);
      if (axis === 'left') {
        setMargins((m) => ({ ...m, left: clamp(startValue + delta, MIN, page.width / 2 - MIN) }));
      } else if (axis === 'right') {
        setMargins((m) => ({ ...m, right: clamp(startValue - delta, MIN, page.width / 2 - MIN) }));
      } else if (axis === 'top') {
        setMargins((m) => ({ ...m, top: clamp(startValue + delta, MIN, page.height / 2 - MIN) }));
      } else if (axis === 'bottom') {
        setMargins((m) => ({ ...m, bottom: clamp(startValue - delta, MIN, page.height / 2 - MIN) }));
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
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
  showTombstone,
  master,
  pageCount,
  docTitle = '',
  margins = DEFAULT_MARGINS,
}: {
  boxes: TextBox[];
  pageIndex: number;
  pageW: number;
  pageH: number;
  contentOf: (b: TextBox) => string;
  showTombstone: boolean;
  master?: MasterPage | null;
  pageCount: number;
  docTitle?: string;
  margins?: typeof DEFAULT_MARGINS;
}) {
  const page = { width: pageW, height: pageH };
  return (
    <div className="relative bg-white" style={{ width: pageW, height: pageH }}>
      {      boxes
        .filter((b) => b.pageIndex === pageIndex && b.kind !== 'sheet')
        .map((b) =>
          b.kind === 'image' ? (
            (() => {
              const minSide = Math.max(2, Math.min(b.w, b.h));
              const fade = Math.max(0, Math.min(Math.round(b.fade ?? 0), Math.floor(minSide / 2)));
              // Edge-only fade: two linear gradients (horizontal + vertical)
              // intersected, so just the borders dissolve and the middle of
              // the picture stays fully opaque — no ellipse vignette.
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
                    objectFit: 'cover',
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
              }}
              dangerouslySetInnerHTML={{ __html: contentOf(b) }}
            />
          ),
        )}
      {showTombstone && (
        <svg
          className="pointer-events-none"
          style={{ position: 'absolute', right: 28, bottom: 28 }}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <rect x="0.5" y="0.5" width="11" height="11" rx="3.5" fill="#1f1f1f" />
        </svg>
      )}
      {master &&
        (['header', 'footer'] as BandSlot[]).map((slot) => {
          const b = bandForPage(master, slot, pageIndex);
          if (!b || !b.text.trim()) return null;
          return (
            <div
              key={slot}
              className={`master-band master-band-${slot}`}
              style={{
                ...masterBandBox(slot, page, margins),
                textAlign: b.align,
                lineHeight: `${MASTER_BAND_H}px`,
              }}
            >
              {fillMasterTokens(b.text, pageIndex + 1, pageCount, docTitle)}
            </div>
          );
        })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Master-page furniture — the header/footer band, live in master view.    */
/* ---------------------------------------------------------------------- */

interface MasterBandViewProps {
  slot: BandSlot;
  /** Which variant this is ("Header", "Even page footer"…). */
  label: string;
  /** Position/size in page coordinates. */
  box: { left: number; top: number; width: number; height: number };
  /** Band height in px — doubles as the line-height that centres the text. */
  bandHeight: number;
  /** Raw band text — tokens stay visible here, the way Publisher shows fields. */
  text: string;
  align: MasterBand['align'];
  placeholder: string;
  editable: boolean;
  onChange: (text: string) => void;
  /** The band took focus — lets App target Insert Page Number/Date/Time. */
  onFocusBand?: () => void;
}

function MasterBandView({
  slot,
  label,
  box,
  bandHeight,
  text,
  align,
  placeholder,
  editable,
  onChange,
  onFocusBand,
}: MasterBandViewProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Seeded once, then left alone: like the text frames, the live DOM is the
  // truth while the user types (re-rendering it would kill the caret).
  const setEl = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      if (el && !el.dataset.seeded) {
        el.textContent = text;
        el.dataset.seeded = '1';
      }
    },
    [text],
  );

  return (
    <div
      className={`master-band master-band-${slot} is-editable`}
      style={{ ...box, textAlign: align, lineHeight: `${bandHeight}px` }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Publisher's non-printing guide: a dashed frame with a name tab. */}
      <span className="master-band-guide" aria-hidden="true">
        <span className="master-band-tag">{label}</span>
      </span>
      <div
        ref={setEl}
        className="master-band-text"
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck={false}
        data-ph={`Click to add a ${placeholder.toLowerCase()}`}
        onFocus={() => onFocusBand?.()}
        onInput={() => onChange(ref.current?.innerText ?? '')}
        onKeyDown={(e) => {
          // Enter would split the band into blocks; furniture is one line.
          if (e.key === 'Enter') e.preventDefault();
        }}
        onPaste={(e) => {
          // Never paste markup into a furniture band — it holds plain text.
          e.preventDefault();
          const plain = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ');
          document.execCommand('insertText', false, plain);
        }}
      />
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
  onRegisterEl: (id: string, html: string, el: HTMLDivElement | null) => void;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onInput: () => void;
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
      onRegisterEl(box.id, box.html, el);
    },
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
      // Let the browser place the caret / select text — but stop the event
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
      title={!editing ? 'Click to select — double-click to type' : undefined}
      data-box-id={box.id}
    >
      {/* The text. Only editable while this box is being edited, so a first
          click selects the box and a second click (or double-click) drops the
          caret in — Publisher-style frames rather than a Word-style page. */}
      <div
        ref={setContentEl}
        className="page-box-content"
        contentEditable={editing && !readOnly}
        suppressContentEditableWarning
        spellCheck={spellCheck}
        data-ph="Type here…"
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

      {/* Red outline whenever text is clipped — even unselected — so the
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
              ? 'Text does not fit — it flows into the linked box. Resize boxes to rebalance.'
              : 'Text does not fit — click, then click an empty text box to pour the overflow into it'
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
  // middle stays fully opaque — corners keep their colour, no ellipse.
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
        // the selection drags it — same two-step feel as text boxes.
        if (!selected) {
          onSelect(box.id);
          return;
        }
        beginDrag('move', e);
      }}
      title={
        box.ph
          ? 'Click to add ' + box.ph.toLowerCase()
          : 'Click to select — drag to move'
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
          objectFit: 'cover',
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
                title="Replace image — pick a picture from your computer"
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
