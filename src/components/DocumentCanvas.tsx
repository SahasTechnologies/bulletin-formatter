import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PaintBucket, Trash2, Unlink } from 'lucide-react';
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

const RULER_SIZE = 28; // px thickness shared by the top and left rulers
const PAGE_GAP = 32; // flex gap (gap-8) between page sheets
const MIN_W = 60;
const MIN_H = 40;
/** Vertical gap between stacked element boxes in a migrated document. */
const SPLIT_GAP = 24;
/** Pixels of movement before a click on a selected box turns into a drag. */
const DRAG_THRESHOLD = 3;

const DEFAULT_MARGINS = { left: 96, right: 96, top: 80, bottom: 80 };

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
  /** Next box in a linked chain, or null when this box ends the chain. */
  nextId: string | null;
  /** Image boxes hold a picture only — no text, no editing, no flow. */
  kind?: 'image';
  /** Image source (data URL or path) when `kind === 'image'`. */
  src?: string;
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
      place({ kind: 'image', src, x: margins.left + Math.round((contentW - w) / 2), w, h });
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
            kind: b.kind === 'image' ? ('image' as const) : undefined,
            src: typeof b.src === 'string' ? b.src : undefined,
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
  kind?: 'image';
  src?: string;
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
}: DocumentCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
        nextId: b.nextId,
      };
    });
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
          columns: 1,
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
      if (b.nextId || incoming.has(b.id) || b.kind === 'image') continue;
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
    activePageRef.current = 0;
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
          el.innerHTML = html;
          el.dataset.seeded = '1';
        }      } else {
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
    activePageRef.current = pageIndex;
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

  const updateBox = useCallback(
    (id: string, geom: { x: number; y: number; w: number; h: number }) => {
      const next = boxesRef.current.map((b) => (b.id === id ? { ...b, ...geom } : b));
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
        if (b.id === id || b.nextId || b.kind === 'image') continue;
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
    if (b) activePageRef.current = b.pageIndex;
    setPourSourceId(null);
    setPourTargets(new Set());
    setSelId(id);
  }, []);

  /** Enter edit mode for a box (double click / click on the selection). */
  const startEdit = useCallback((id: string) => {
    const b = boxesRef.current.find((x) => x.id === id);
    if (b) activePageRef.current = b.pageIndex;
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

  return (
    <div ref={containerRef} className="relative flex-1 overflow-auto bg-[#f1f0ee]">
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

      <div className="mx-auto max-w-[1100px] px-12">
        <div className="flex flex-col items-center gap-8 py-8">
          {Array.from({ length: pageCount }, (_, pageIndex) => (
            <div
              key={pageIndex}
              className="doc-paper relative"
              style={{
                width: `${page.width}px`,
                height: `${page.height}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top center',
              }}
            >
              <div
                className={`page-box-layer relative h-full w-full ${pourSourceId ? 'is-pouring' : ''}`}
                onMouseDown={() => paperMouseDown(pageIndex)}
              >
                {pageIndex === 0 && boxesState.length === 0 && hint}

                {boxesState
                  .filter((b) => b.pageIndex === pageIndex)
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
            height: `${
              pageCount * page.height * scale + (pageCount - 1) * PAGE_GAP + 2 * PAGE_GAP
            }px`,
          }}
        >
          <div className="absolute inset-0">
            <div className="absolute inset-x-0 top-0 bg-gdoc-muted/10" style={{ height: `${PAGE_GAP + margins.top * scale}px` }} />
            <div className="absolute inset-x-0 bottom-0 bg-gdoc-muted/10" style={{ height: `${PAGE_GAP + margins.bottom * scale}px` }} />
          </div>
          <div
            className="absolute flex flex-col"
            style={{
              top: `${PAGE_GAP + margins.top * scale}px`,
              bottom: `${PAGE_GAP + margins.bottom * scale}px`,
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
            const pos = PAGE_GAP + (isTop ? margins.top : page.height - margins.bottom) * scale;
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
  );

  /* ---------- margin-arrow dragging (chrome kept from before) ---------- */

  function beginMarginDrag(axis: 'left' | 'right' | 'top' | 'bottom', e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const MIN = 12;
    const startPos = axis === 'top' || axis === 'bottom' ? e.clientY : e.clientX;
    const startValue = margins[axis];

    const onMove = (ev: MouseEvent) => {
      const cur = axis === 'top' || axis === 'bottom' ? ev.clientY : ev.clientX;
      const delta = (cur - startPos) / scale;
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
  onGeomChange: (id: string, geom: { x: number; y: number; w: number; h: number }) => void;
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
  onGeomChange: (id: string, geom: { x: number; y: number; w: number; h: number }) => void;
  onDelete: (id: string) => void;
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
      const corner = d.mode.length === 2;
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
      if (corner) {
        // Lock to the original aspect ratio from the dominant axis.
        if (Math.abs(w - d.orig.w) >= Math.abs(h - d.orig.h)) h = Math.round(w * d.aspect);
        else w = Math.round(h / d.aspect);
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

  return (
    <div
      className={`page-box page-box-image ${selected ? 'is-selected' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onMouseDown={(e) => {
        if (readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        // First click selects the frame (handles appear); a later press on
        // the selection drags it — same two-step feel as text boxes.
        if (!selected) {
          onSelect(box.id);
          return;
        }
        beginDrag('move', e);
      }}
      title="Click to select — drag to move"
      data-box-id={box.id}
    >
      <img
        ref={(el) => onRegisterImg(box.id, el)}
        src={box.src}
        alt=""
        draggable={false}
        className="page-box-image-img"
      />

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
          <div className="page-box-tools" onMouseDown={(e) => e.stopPropagation()}>
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
