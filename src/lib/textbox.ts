/**
 * Text-box ("frame") model and the story-flow engine.
 *
 * Publisher semantics: text never lives on the page itself - it lives in
 * frames. A chain of linked frames shares one *story*; each frame shows the
 * slice of that story that fits its geometry. When the last frame in a chain
 * still cannot show everything, it is in overflow: it tints red and offers a
 * link handle so the user can point at a new frame and let the remainder flow
 * into it.
 *
 * The story is the source of truth, never the frames. Frames store geometry
 * only; their contents are recomputed by `flowStory` after every edit. That is
 * what makes threading work: adding or resizing a frame anywhere in the chain
 * simply redistributes the same story.
 */

/** Inner padding of a frame, px. Text is inset by this much on every side. */
export const FRAME_PAD = 4;
/** Gutter between columns inside a frame, px. */
export const FRAME_COL_GAP = 28;

export interface TextBox {
  id: string;
  storyId: string;
  /** Zero-based page the frame sits on. */
  pageIndex: number;
  /** Position/size in page coordinates (CSS px, unscaled). */
  x: number;
  y: number;
  w: number;
  h: number;
  columns: number;
  /** Next frame in the linked chain, or null when this frame ends it. */
  nextId: string | null;
}

export interface Story {
  id: string;
  html: string;
}

export interface DocModel {
  version: 2;
  pageCount: number;
  stories: Story[];
  boxes: TextBox[];
}

export interface FontOpts {
  fontFamily?: string;
  fontSize?: string;
  lineHeight?: string;
}

/* ------------------------------------------------------------------ ids -- */

let idSeq = 0;
export function newId(prefix = 'f'): string {
  idSeq += 1;
  return `${prefix}${Date.now().toString(36)}${idSeq.toString(36)}`;
}

/* --------------------------------------------------------------- chains -- */

/** Every frame in `boxId`'s chain, in flow order (head first). */
export function chainOf(boxes: TextBox[], boxId: string): TextBox[] {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  if (!byId.has(boxId)) return [];

  // Walk back to the head of the chain, guarding against a corrupt cycle.
  const parentOf = new Map<string, string>();
  for (const b of boxes) if (b.nextId) parentOf.set(b.nextId, b.id);

  let head = boxId;
  const visited = new Set<string>();
  while (parentOf.has(head) && !visited.has(head)) {
    visited.add(head);
    head = parentOf.get(head)!;
  }

  const out: TextBox[] = [];
  let cur: string | null = head;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const box = byId.get(cur);
    if (!box) break;
    out.push(box);
    cur = box.nextId;
  }
  return out;
}

/** The first frame of every chain in the document. */
export function chainHeads(boxes: TextBox[]): string[] {
  const targets = new Set(boxes.map((b) => b.nextId).filter(Boolean) as string[]);
  return boxes.filter((b) => !targets.has(b.id)).map((b) => b.id);
}

/* ------------------------------------------------------------ measuring -- */

let measurer: HTMLDivElement | null = null;

/**
 * One hidden, laid-out div reused for every "does this fit?" question.
 * It lives off-screen (not `display:none`, which would skip layout) and is
 * resized to each frame's column width before measuring.
 *
 * Pieces are measured inside an `overflow:hidden` inner wrapper: it creates a
 * block formatting context, so the last block's bottom margin is INCLUDED in
 * the measured height - exactly how a real frame's scrollHeight accounts for
 * it. Without this, the measurer and the live DOM disagree by one margin and
 * a frame at its boundary flips between "fits" and "overflowing".
 */
let measurerOuter: HTMLDivElement | null = null;
let measurerInner: HTMLDivElement | null = null;

function getMeasurer(): HTMLDivElement {
  if (measurerInner && measurerOuter && document.body.contains(measurerOuter)) {
    return measurerInner;
  }
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
    'padding:0',
  ].join(';');
  const inner = document.createElement('div');
  inner.style.cssText = 'overflow:hidden;';
  m.appendChild(inner);
  document.body.appendChild(m);
  measurerOuter = m;
  measurerInner = inner;
  return inner;
}

/* --------------------------------------------------------------- blocks -- */

/**
 * Split a story into top-level block elements. Bare inline runs and stray text
 * nodes are wrapped in a `<p>` so every piece is independently measurable.
 */
export function splitTopLevelBlocks(html: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = html || '';

  const out: string[] = [];
  let inlineBuf: string[] = [];

  const flushInline = () => {
    if (!inlineBuf.length) return;
    const p = document.createElement('p');
    p.textContent = inlineBuf.join('');
    inlineBuf = [];
    if ((p.textContent ?? '').trim()) out.push(p.outerHTML);
  };

  for (const node of Array.from(host.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      inlineBuf.push(node.textContent ?? '');
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      flushInline();
      out.push((node as Element).outerHTML);
    }
  }
  flushInline();
  return out;
}

function wordPositions(root: Node): { node: Text; offset: number }[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: { node: Text; offset: number }[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    const data = t.data;
    let i = 0;
    while (i < data.length) {
      while (i < data.length && /\s/.test(data[i])) i++;
      if (i >= data.length) break;
      out.push({ node: t, offset: i });
      while (i < data.length && !/\s/.test(data[i])) i++;
    }
  }
  return out;
}

function countWords(html: string): number {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/** Whitespace-separated word count of a block of HTML. */
export function countHtmlWords(html: string): number {
  return countWords(html);
}

/**
 * Split arbitrary box HTML after `index` words: whole top-level blocks move
 * wholesale, and the boundary block is cut at a word boundary keeping its
 * tag and inline formatting. Returns null when no cut is possible at or
 * before `index` (e.g. it would land inside an unsplittable image/table),
 * so callers can binary-search their way to the nearest feasible cut.
 */
export function splitHtmlAtWordIndex(
  html: string,
  index: number,
): { head: string; tail: string } | null {
  const host = document.createElement('div');
  host.innerHTML = html || '';

  // Wrap stray top-level text so every unit is an element we can cut around.
  for (const node of Array.from(host.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? '').trim()) {
        const p = document.createElement('p');
        host.replaceChild(p, node);
        p.appendChild(node);
      } else {
        (node as ChildNode).remove();
      }
    }
  }

  const blocks = Array.from(host.children) as HTMLElement[];
  const total = blocks.reduce((n, b) => n + countWords(b.outerHTML), 0);

  if (index <= 0) return { head: '', tail: host.innerHTML };
  if (index >= total) return { head: host.innerHTML, tail: '' };

  let acc = 0;
  for (let i = 0; i < blocks.length; i++) {
    const wc = countWords(blocks[i].outerHTML);
    if (acc + wc > index) {
      const k = index - acc; // words kept from this block (0..wc-1)
      if (k === 0) {
        // Clean cut between two blocks.
        return {
          head: blocks
            .slice(0, i)
            .map((b) => b.outerHTML)
            .join(''),
          tail: blocks
            .slice(i)
            .map((b) => b.outerHTML)
            .join(''),
        };
      }
      const sp = splitBlockAtWords(blocks[i].outerHTML, k);
      if (!sp) return null;
      return {
        head:
          blocks
            .slice(0, i)
            .map((b) => b.outerHTML)
            .join('') + sp.prefix,
        tail: sp.suffix + blocks.slice(i + 1).map((b) => b.outerHTML).join(''),
      };
    }
    acc += wc;
  }
  return { head: host.innerHTML, tail: '' };
}

export function htmlTextLength(html: string): number {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent ?? '').length;
}

/**
 * Cut one block element after `words` words, keeping inline formatting on both
 * halves. The halves are tagged `data-flow="head"|"tail"` so `recomposeStory`
 * can stitch them back into the single block they came from.
 */
function splitBlockAtWords(
  html: string,
  words: number,
): { prefix: string; suffix: string } | null {
  const probe = document.createElement('div');
  probe.innerHTML = html;
  const el = probe.firstElementChild as HTMLElement | null;
  if (!el) return null;

  // A block holding an image or table is structurally unsplittable.
  if (el.querySelector('img,table,svg,video,iframe')) return null;

  const positions = wordPositions(el);
  if (positions.length < 2) return null;

  const k = Math.max(1, Math.min(words, positions.length - 1));
  const cut = positions[k];

  const tail = document.createRange();
  tail.setStart(cut.node, cut.offset);
  tail.setEnd(el, el.childNodes.length);
  const suffixFrag = tail.extractContents();

  const head = document.createRange();
  head.selectNodeContents(el);
  const prefixFrag = head.extractContents();

  const shell = el.cloneNode(false) as HTMLElement;
  shell.removeAttribute('data-flow');

  const headEl = shell.cloneNode(false) as HTMLElement;
  headEl.appendChild(prefixFrag);
  headEl.setAttribute('data-flow', 'head');

  const tailEl = shell.cloneNode(false) as HTMLElement;
  tailEl.appendChild(suffixFrag);
  tailEl.setAttribute('data-flow', 'tail');

  if (!headEl.textContent?.trim() || !tailEl.textContent?.trim()) return null;

  return { prefix: headEl.outerHTML, suffix: tailEl.outerHTML };
}

/**
 * Rebuild story HTML from the slices currently held by a chain's frames.
 *
 * Blocks that were split across frames are marked head/tail; merging those
 * adjacent pairs back together keeps the round-trip stable, so repeatedly
 * editing a threaded story does not progressively turn one paragraph into two.
 */
export function recomposeStory(slices: string[]): string {
  const host = document.createElement('div');
  host.innerHTML = slices.filter(Boolean).join('');

  for (let guard = 0; guard < 1000; guard++) {
    const kids = Array.from(host.children) as HTMLElement[];
    let merged = false;
    for (let i = 0; i < kids.length - 1; i++) {
      const a = kids[i];
      const b = kids[i + 1];
      if (
        a.getAttribute('data-flow') === 'head' &&
        b.getAttribute('data-flow') === 'tail' &&
        a.tagName === b.tagName
      ) {
        a.insertAdjacentHTML('beforeend', b.innerHTML);
        a.removeAttribute('data-flow');
        b.remove();
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }

  host.querySelectorAll('[data-flow]').forEach((el) => el.removeAttribute('data-flow'));
  return host.innerHTML;
}

/* ----------------------------------------------------------------- flow -- */

export interface FlowSlice {
  html: string;
  /** True when the story continues past this frame. */
  hasMore: boolean;
  /** Character offset where this slice begins within the story's text. */
  textStart: number;
}

export interface FlowResult {
  /** One entry per frame, parallel to the `boxes` argument. */
  slices: FlowSlice[];
  /** True when content is still left over after the final frame. */
  overflow: boolean;
}

/** Largest number of leading words of `piece` that still fit, if any split fits. */
function splitToFit(
  piece: string,
  meas: HTMLDivElement,
  capacity: number,
): { prefix: string; suffix: string } | null {
  const words = countWords(piece);
  if (words < 2) return null;

  let lo = 1;
  let hi = words - 1;
  let best: { prefix: string; suffix: string } | null = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const split = splitBlockAtWords(piece, mid);
    if (!split) {
      hi = mid - 1;
      continue;
    }
    const snapshot = meas.innerHTML;
    meas.insertAdjacentHTML('beforeend', split.prefix);
    const h = meas.offsetHeight;
    meas.innerHTML = snapshot;
    if (h <= capacity) {
      best = split;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Distribute `storyHtml` across `boxes` in chain order.
 *
 * Capacity model: a frame with N columns holds N times its own height of
 * single-column text, and we measure at the width of one column. That matches
 * how the frames actually render (`column-fill: auto` fills column 1 to the
 * frame height, then column 2), and it avoids fighting the browser's divergent
 * overflow semantics for multi-column boxes.
 */
export function flowStory(
  storyHtml: string,
  boxes: TextBox[],
  font?: FontOpts,
): FlowResult {
  const meas = getMeasurer();
  if (font?.fontFamily) meas.style.fontFamily = font.fontFamily;
  meas.style.fontSize = font?.fontSize ?? '11pt';
  meas.style.lineHeight = font?.lineHeight ?? '1.5';

  const blocks = splitTopLevelBlocks(storyHtml);
  const slices: FlowSlice[] = [];
  let bi = 0;
  let carry: string | null = null;

  for (const box of boxes) {
    const cols = Math.max(1, box.columns);
    // Only the frame's TOP padding offsets the text (the bottom pad is
    // scroll allowance), so subtract that plus a 2px safety line - this
    // mirrors the live red-chrome test (scrollHeight vs clientHeight).
    const innerW = Math.max(40, box.w - FRAME_PAD * 2);
    const capacity = Math.max(20, box.h - FRAME_PAD - 2) * cols;
    const colWidth = (innerW - (cols - 1) * FRAME_COL_GAP) / cols;

    meas.style.width = `${Math.max(20, colWidth)}px`;
    meas.style.columnCount = '1';
    meas.style.columnGap = '0px';
    meas.innerHTML = '';

    const taken: string[] = [];
    let used = 0;

    while (carry !== null || bi < blocks.length) {
      let piece: string;
      if (carry !== null) {
        piece = carry;
        carry = null;
      } else {
        piece = blocks[bi];
        bi++;
      }
      if (!piece || !piece.trim()) continue;

      const snapshot = meas.innerHTML;
      meas.insertAdjacentHTML('beforeend', piece);
      const hAfter = meas.offsetHeight;

      // A leading margin on the block is cancelled by the frame's padding in
      // the real frame (margins collapse into it), so tolerate one margin of
      // slack - otherwise a half-empty frame “cannot fit” even one line.
      if (hAfter <= capacity) {
        used = hAfter;
        taken.push(piece);
        continue;
      }

      // Whole piece is too tall: roll back and break it at a word boundary.
      meas.innerHTML = snapshot;
      void used;
      const split = splitToFit(piece, meas, capacity);
      if (split) {
        taken.push(split.prefix);
        carry = split.suffix;
      } else {
        carry = piece;
      }
      break;
    }

    slices.push({ html: taken.join(''), hasMore: false, textStart: 0 });
  }

  let acc = 0;
  for (const s of slices) {
    s.textStart = acc;
    acc += htmlTextLength(s.html);
  }

  const overflow = carry !== null || bi < blocks.length;
  if (slices.length) slices[slices.length - 1].hasMore = overflow;

  // Never destroy text: whatever no frame could take stays appended to the
  // last slice. It renders clipped there (and flags the frame red), so the
  // story survives - a later resize simply redistributes it again.
  if (overflow && slices.length) {
    let leftover = carry ?? '';
    while (bi < blocks.length) leftover += blocks[bi++];
    if (leftover) slices[slices.length - 1].html += leftover;
  }

  return { slices, overflow };
}

/* ---------------------------------------------------------------- caret -- */

/**
 * Character offset of the caret within `root`'s text, so a reflow can put the
 * caret back - possibly in a different frame when text has moved downstream.
 */
export function caretOffsetIn(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  try {
    pre.setEnd(r.startContainer, r.startOffset);
  } catch {
    return null;
  }
  return pre.toString().length;
}

/** Place the caret at a character offset within `root`'s text. */
export function setCaretOffset(root: HTMLElement, offset: number): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let target: Text | null = null;
  let n: Node | null;

  while ((n = walker.nextNode())) {
    const t = n as Text;
    if (remaining <= t.data.length) {
      target = t;
      break;
    }
    remaining -= t.data.length;
  }

  const sel = window.getSelection();
  if (!sel) return false;
  const r = document.createRange();
  if (target) {
    r.setStart(target, Math.max(0, Math.min(remaining, target.data.length)));
  } else {
    r.selectNodeContents(root);
    r.collapse(false);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}

/* ------------------------------------------------------------ doc model -- */

export interface PageGeom {
  pageW: number;
  pageH: number;
  marginX?: number;
  marginY?: number;
}

/** A fresh document: a title frame plus a body frame, both on page 1. */
export function emptyDoc({ pageW, pageH, marginX = 96, marginY = 80 }: PageGeom): DocModel {
  const contentW = Math.max(120, pageW - marginX * 2);
  const titleH = 92;
  const gap = 22;
  const bodyY = marginY + titleH + gap;
  const bodyH = Math.max(120, pageH - marginY - bodyY);

  const titleStory: Story = {
    id: newId('s'),
    html:
      '<h1 style="margin:0;font-size:32pt;line-height:1.1;letter-spacing:-0.5px;">Baulko Bulletin</h1>',
  };
  const bodyStory: Story = {
    id: newId('s'),
    html:
      '<p style="margin:0 0 12px;">Start writing here. When a frame can no longer fit your text it turns red - click the link handle on its edge, then click anywhere on a page to flow the remainder into a new frame.</p>',
  };

  return {
    version: 2,
    pageCount: 1,
    stories: [titleStory, bodyStory],
    boxes: [
      {
        id: newId(),
        storyId: titleStory.id,
        pageIndex: 0,
        x: marginX,
        y: marginY,
        w: contentW,
        h: titleH,
        columns: 1,
        nextId: null,
      },
      {
        id: newId(),
        storyId: bodyStory.id,
        pageIndex: 0,
        x: marginX,
        y: bodyY,
        w: contentW,
        h: bodyH,
        columns: 1,
        nextId: null,
      },
    ],
  };
}

/** Wrap pre-frame (v1) page HTML in a single body frame so old files still open. */
export function docFromLegacyHtml(
  html: string,
  { pageW, pageH, marginX = 96, marginY = 80 }: PageGeom,
): DocModel {
  const contentW = Math.max(120, pageW - marginX * 2);
  const contentH = Math.max(120, pageH - marginY * 2);
  const story: Story = {
    id: newId('s'),
    html: html && html.trim() ? html : '<p></p>',
  };
  return {
    version: 2,
    pageCount: 1,
    stories: [story],
    boxes: [
      {
        id: newId(),
        storyId: story.id,
        pageIndex: 0,
        x: marginX,
        y: marginY,
        w: contentW,
        h: contentH,
        columns: 1,
        nextId: null,
      },
    ],
  };
}

export function cloneDoc(m: DocModel): DocModel {
  return {
    version: 2,
    pageCount: m.pageCount,
    stories: m.stories.map((s) => ({ ...s })),
    boxes: m.boxes.map((b) => ({ ...b })),
  };
}
