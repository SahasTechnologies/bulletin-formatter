/**
 * Frame text standards - the type a text box falls back to.
 *
 * The problem this file solves: a text box is a contentEditable holding styled
 * blocks, and Ctrl+A inside it selects the *contents*. Typing over that
 * selection replaces every block with one new block, and the browser gives the
 * new text the first block's inline type - so retyping the contents list, whose
 * entries are 18pt Franklin Gothic Heavy, comes out 18pt and bold all the way
 * down, stops fitting the frame, and turns the frame's chrome red (the overflow
 * state). The design was never the problem: the *entry* style was being handed
 * the whole page.
 *
 * The fix has two halves:
 *
 *  1. A frame declares its **standard** type - the type plain text in that
 *     frame should use. Templates declare it with `data-text` (and, for a
 *     template sheet, the manifest's `text`), e.g. a contents list whose entries
 *     are 18pt might declare `font-size:13pt;line-height:1.45` so a retyped list
 *     comes back as house body type. With no declaration the standard is derived
 *     from the frame's own blocks when they agree (see `deriveFrameStandard`).
 *  2. When the whole frame is replaced in one go, the borrowed block type is
 *     stripped, so the new text takes the standard while the design's *spacing*
 *     (margins, padding) and its runs (bold numbers, italic credits) survive.
 *
 * Anything here is only ever applied to the frame's own content node, never to
 * the document as a whole: the standard is a per-frame fallback, not a style
 * sheet.
 */

/** Text properties a frame standard may declare. Everything else is rejected -
    the value also round-trips through a saved document, so it is untrusted. */
const ALLOWED_PROPS = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'color',
]);

/** Values that carry a resource or an expression are never a type declaration. */
const UNSAFE_VALUE = /url\s*\(|expression\s*\(|javascript:|[<>]/i;
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\)|[a-z]+)$/i;
const ALIGN_VALUE = /^(left|right|center|justify|start|end)$/i;

/** Parse a declaration list (``font-size:13pt;line-height:1.45``) into the
    properties that may be trusted. Unknown or unsafe declarations are dropped. */
export function parseFrameText(raw: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of String(raw).split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const prop = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    if (!prop || !value || !ALLOWED_PROPS.has(prop) || UNSAFE_VALUE.test(value)) continue;
    if (prop === 'color' && !COLOR_VALUE.test(value)) continue;
    if (prop === 'text-align' && !ALIGN_VALUE.test(value)) continue;
    out[prop] = value;
  }
  return out;
}

/** A declaration list reduced to the declarations that may be kept, or
    `undefined` when nothing survives (so the box stores no standard at all). */
export function sanitizeFrameText(raw: string | null | undefined): string | undefined {
  const kept = Object.entries(parseFrameText(raw)).map(([prop, value]) => `${prop}:${value}`);
  return kept.length ? kept.join(';') : undefined;
}

/**
 * Put a frame's declared standard on its content node.
 *
 * `align` is the frame's own alignment (a template's `data-align`); a standard
 * that declares `text-align` wins, because the declaration is more specific
 * than the frame's general alignment.
 */
export function applyFrameStandard(
  el: HTMLElement,
  css?: string | null,
  align?: string | null,
): void {
  const props = parseFrameText(css);
  for (const [prop, value] of Object.entries(props)) el.style.setProperty(prop, value);
  if (align && ALIGN_VALUE.test(align) && !props['text-align']) {
    el.style.setProperty('text-align', align);
  }
}

/** A piece of a block's type, as the browser resolved it for that block. */
interface BlockType {
  'font-family': string;
  'font-size': string;
  'font-weight': string;
  'font-style': string;
  'line-height': string;
  color: string;
  'text-align': string;
}

const TYPE_PROPS: (keyof BlockType)[] = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'color',
  'text-align',
];

/** Type properties a wholesale replacement hands back to the frame standard.
    Everything deliberately structural - margins, padding, break rules - is left
    alone, because that is the design's spacing and the frame's own layout. */
const BORROWED_PROPS: (keyof BlockType)[] = [...TYPE_PROPS];

function blockType(el: HTMLElement): BlockType {
  const cs = window.getComputedStyle(el);
  return {
    'font-family': el.style.fontFamily || cs.fontFamily,
    'font-size': el.style.fontSize || cs.fontSize,
    'font-weight': el.style.fontWeight || cs.fontWeight,
    'font-style': el.style.fontStyle || cs.fontStyle,
    'line-height': el.style.lineHeight || cs.lineHeight,
    color: el.style.color || cs.color,
    'text-align': el.style.textAlign || cs.textAlign,
  };
}

/**
 * The elements that are the frame's *text blocks*.
 *
 * A template frame is stored as the frame element's own `outerHTML`, so a frame
 * wrapped in a `<div>` keeps its blocks one level in (and a frame that walks
 * through more than one wrapper is followed all the way). A wrapper holds no
 * text of its own - it is layout, not a block - so standards and the strip both
 * work on the blocks inside it rather than on the wrapper.
 */
export function textBlocks(root: HTMLElement): HTMLElement[] {
  let layer = Array.from(root.children) as HTMLElement[];
  while (layer.length === 1) {
    const only = layer[0];
    if (only.tagName === 'SPAN' || only.tagName === 'FONT') break;
    const inner = Array.from(only.children) as HTMLElement[];
    if (!inner.length) break;
    const wrapped = inner.map((k) => k.textContent ?? '').join('');
    if (bare(only.textContent ?? '') !== bare(wrapped)) break;
    layer = inner;
  }
  return layer;
}

/** Text with every whitespace character dropped - the shape two views of the
    same content agree on, whatever the markup between the words. */
function bare(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * The standard a frame's own blocks imply, without a declaration.
 *
 * A *single-block* frame is a title or a label: its block's type is the whole
 * frame's type. A *multi-block* frame is a body: its standard is the type a
 * strict majority of its blocks share, and only when they genuinely agree -
 * a frame with one display block among body blocks implies nothing, so nothing
 * is applied and the text keeps the browser's own inheritance.
 */
export function deriveFrameStandard(el: HTMLElement): Record<string, string> {
  const blocks = textBlocks(el);
  if (!blocks.length) return {};
  if (blocks.length === 1) return { ...blockType(blocks[0]) };
  const counts = new Map<string, { type: BlockType; n: number }>();
  for (const block of blocks) {
    const t = blockType(block);
    const key = TYPE_PROPS.map((p) => t[p]).join(' | ');
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { type: t, n: 1 });
  }
  let best: { type: BlockType; n: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  if (!best || best.n * 2 <= blocks.length) return {};
  return { ...best.type };
}

/**
 * Stamp a frame's standard onto its content node: the declaration when the
 * frame has one, otherwise the type its own blocks imply. Called whenever a
 * frame is seeded, so a reload or an undo lands on the same standard.
 */
export function mirrorFrameStyle(
  el: HTMLElement,
  css?: string | null,
  align?: string | null,
): void {
  if (Object.keys(parseFrameText(css)).length) {
    applyFrameStandard(el, css, align);
    return;
  }
  const derived = deriveFrameStandard(el);
  for (const [prop, value] of Object.entries(derived)) {
    if (value) el.style.setProperty(prop, value);
  }
  // A declared alignment still wins over the derived one: the frame's own
  // alignment (data-align) is the template author's intent for the frame.
  if (align && ALIGN_VALUE.test(align)) el.style.setProperty('text-align', align);
}

/**
 * Drop the *borrowed* type from the blocks a wholesale replacement produced.
 *
 * Only type is dropped: margins, padding and `break-inside` are the design's
 * spacing and the frame's own layout, so they stay, and so do the runs inside a
 * block (a bold entry number, an italic credit). A run that merely wraps a
 * whole block is not a deliberate style either - the browser makes one when it
 * types over a selection - so those are cleaned too.
 */
export function stripBorrowedType(root: HTMLElement, opts: { align?: boolean } = {}): void {
  const props = [...BORROWED_PROPS];
  // A declared alignment governs the frame, so the borrowed one goes too; with
  // no declared alignment the block's own alignment is the design's (a justified
  // body stays justified) and is kept.
  if (!opts.align) props.splice(props.indexOf('text-align'), 1);
  for (const block of textBlocks(root)) {
    for (const prop of props) block.style.removeProperty(prop);
    const kids = Array.from(block.children) as HTMLElement[];
    if (kids.length !== 1) continue;
    const only = kids[0];
    // A single child that holds the block's whole text is a wrapper, not a run:
    // the browser makes one when it types over a whole-element selection, and
    // the type it carries is borrowed exactly like the block's.
    if ((only.textContent ?? '') !== (block.textContent ?? '')) continue;
    if (only.tagName !== 'SPAN' && only.tagName !== 'FONT') continue;
    for (const prop of props) only.style.removeProperty(prop);
    only.removeAttribute('color');
    only.removeAttribute('face');
    only.removeAttribute('size');
  }
}

/**
 * True when the current selection covers everything inside `root`.
 *
 * Ctrl+A inside a text frame selects the frame's contents; that is the gesture
 * whose replacement must adopt the frame's standard rather than the first
 * block's borrowed type.
 */
export function selectionCoversContents(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
  // Compare the *text* rather than node offsets: the browser's select-all has
  // no single shape (a range over the editable root, a range over its first and
  // last text nodes, or - for wrapped frames - one that starts at a block deep
  // inside), but in every one of them the selected text is the frame's whole
  // text. Whitespace is dropped entirely rather than normalised, because a
  // selection counts a `<br>` as a line break where `textContent` sees nothing.
  const whole = bare(root.textContent ?? '');
  const picked = bare(range.toString());
  return whole.length > 0 && picked === whole;
}
