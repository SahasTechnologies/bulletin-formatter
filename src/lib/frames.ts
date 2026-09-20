/**
 * The frame model: how a document's content becomes frames.
 *
 * Every placed object on a sheet is a frame (a `TextBox`), and two very
 * different inputs have to end up in that shape:
 *
 *  - a document saved with `boxes` - a list of frames with their own geometry,
 *    loaded nearly verbatim (see `buildBoxes`);
 *  - a legacy document that only has page HTML - one frame per content element,
 *    stacked down the sheet and flowed onto extra pages (see `splitIntoBoxes`).
 *
 * This lives in `lib` rather than beside the canvas because it is domain logic,
 * not rendering: the canvas, the app shell and the Merge tool all build frames
 * from stored documents, and `lib` must never import from `components`.
 */
import { sanitizeFrameText } from './frameStyle';
import { tombstoneCorner, tombstoneOffCorner } from './marker';
import { COLUMN_RULE_MAX_WIDTH } from './textbox';
import type { TextBox } from './textbox';

/**
 * A stored column-rule colour, checked rather than trusted.
 *
 * The value ends up in an inline style, so a hand-edited `boxes` string must
 * not be able to put anything it likes there. `none` is not a colour but the
 * meaningful case of no rule at all, and is kept.
 */
const RULE_COLOUR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\)|[a-z]+)$/i;
function sanitizeRuleColour(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'none') return 'none';
  return RULE_COLOUR_VALUE.test(value) ? value : undefined;
}

/** Smallest frame the user can be left holding, in page pixels. */
export const MIN_W = 60;
export const MIN_H = 40;
/**
 * The house content column: where the bulletin's own type starts on a sheet.
 *
 * There are no margins here - a frame may sit anywhere - but nothing is ever
 * placed on the trim edge by design: every template and every merged issue
 * starts its type this far in, so a frame the user adds by hand starts here too
 * instead of half off the paper.
 */
export const CONTENT_INSET = { x: 96, y: 80 };
/** Vertical gap between stacked element boxes in a migrated document. */
export const SPLIT_GAP = 24;
/** 1x1 transparent GIF - the invisible backing picture of a placeholder box
    (its dashed 'click to add' cover is drawn by CSS, see .page-box-ph). */
export const TRANSPARENT_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * The content-area geometry the *old*, margin-based migration produced.
 *
 * Only used to recognise a legacy "one coarse full-page box" document so it can
 * be re-split per element. Nothing lays out new content from these values - the
 * app has no margins, and a frame may sit anywhere on the sheet.
 */
const LEGACY_MARGIN = { left: 96, right: 96, top: 80, bottom: 80 };

let boxSeq = 0;
export function newBoxId(): string {
  boxSeq += 1;
  return `tb${Date.now().toString(36)}${boxSeq.toString(36)}`;
}

/** True when the HTML holds anything worth editing (text, image, table…). */
export function hasRealContent(html: string): boolean {
  if (!html || !html.trim()) return false;
  const d = document.createElement('div');
  d.innerHTML = html;
  return Boolean(
    d.textContent?.trim() || d.querySelector('img,table,svg,hr,video,iframe'),
  );
}

/** Compare HTML ignoring the transient data-flow markers the flow engine adds. */
export const normHtml = (s: string) =>
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
    // Start a new sheet when this piece would not fit on the current one, so a
    // frame never hangs off the bottom of the page. The test used to run *after*
    // the cursor advanced, which only moved on once the position was already
    // past the trim edge - leaving the last piece on each sheet overflowing by
    // its own height. (Every caller clamps `h` to the page, so a piece always
    // fits on a sheet of its own when it needs one.)
    if (y > 0 && y + entry.h > page.height) {
      pageIndex += 1;
      y = 0;
    }
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
export function buildModel(
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
export function tombstoneBox(pageIndex: number, page: { width: number; height: number }): TextBox {
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
            // The column rule is part of the frame's look, so it has to survive
            // a reload: the colour, or `none` for a frame whose columns are not
            // fenced off, and the weight in px.
            rule: sanitizeRuleColour(b.rule),
            ruleWidth:
              typeof b.ruleWidth === 'number'
                ? Math.max(1, Math.min(COLUMN_RULE_MAX_WIDTH, Math.round(b.ruleWidth)))
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
