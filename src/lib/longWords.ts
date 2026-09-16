/**
 * Breaking a word that is wider than its column - with a hyphen, and without a
 * dictionary.
 *
 * The browser can hyphenate by a language's own rules (`hyphens: auto`), but
 * that needs the engine to ship a hyphenation dictionary, and every engine is
 * allowed to ship none. This app's own preview shell is one of them: it reports
 * `CSS.supports('hyphens', 'auto')` as true while a 28-character word in a 60px
 * column stays on one line. A formatter cannot be told "your browser has no
 * dictionary" and left there, because the setting means something narrower and
 * simpler in a bulletin than linguistic hyphenation: a word too long for the
 * measure is cut, a hyphen is printed, and the rest continues on the next line.
 *
 * So the break is made here instead. A soft hyphen (U+00AD) is a *manual* break
 * opportunity, and every engine honours one with no dictionary at all - the
 * browser prints the hyphen exactly when it breaks there, and shows nothing at
 * all when it does not. A word only ever breaks at the last opportunity that
 * fits, so putting one soft hyphen at the furthest position that still fits the
 * measure is exactly the behaviour asked for. Paragraphs that want this carry
 * `overflow-wrap: break-word` (the pill's "break long words" button writes it),
 * which doubles as the safety net: if a measurement is ever a hair optimistic,
 * the word still breaks rather than running out of its frame.
 *
 * Positions are found by measuring the real thing - a Range over the text node,
 * which reports one client rect per line box - so hyphenation stays honest about
 * letter-spacing, kerning and whichever face is actually loaded.
 */

/** The soft hyphen: a break opportunity the browser prints a hyphen for. */
export const SOFT_HYPHEN = '\u00ad';

/** What one piece of a word may be: text between the spaces and the hyphens. */
const SEGMENT = /[^\s\u00ad]+/g;

interface Edit {
  node: Text;
  /** Where the node's own soft hyphens were, in the text it arrived with. */
  shyAt: number[];
  /** Where new soft hyphens go, as offsets into the stripped text. */
  putAt: Set<number>;
  /** The stripped text - what the measurements were taken against. */
  clean: string;
}

/**
 * Break the too-long words inside `root`, which is a frame's content element.
 *
 * `availW` is the width of one *column*: the measure a line of this frame has to
 * live in. Only elements asking for it (see the module comment) are touched, and
 * every pass strips the soft hyphens a previous pass left before deciding again
 * - so widening a frame or taking the setting off heals the text back, and a
 * word that fits again loses its break rather than keeping a stale one.
 *
 * Returns how many text nodes it actually rewrote: 0 means the frame was
 * already right, which is the answer on almost every layout pass.
 */
export function breakLongWords(root: HTMLElement, availW: number): number {
  if (!(availW > 40)) return 0;

  const selection = selectionIn(root);
  const edits: Edit[] = [];

  /* ---- take the soft hyphens out, so the pass decides from clean text ---- */
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  const originals = nodes.map((node) => node.data);

  for (const node of nodes) {
    const text = node.data;
    if (!text) continue;
    const shyAt: number[] = [];
    let clean = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === SOFT_HYPHEN) shyAt.push(i);
      else clean += text[i];
    }
    if (shyAt.length) node.data = clean;
    if (clean.trim() && clean.length > 1) edits.push({ node, shyAt, putAt: new Set(), clean });
  }

  /* ---- put a break at the furthest position that still fits ---- */
  for (const edit of edits) {
    const { node, clean } = edit;
    const host = node.parentElement;
    if (!host || !asksForBreaks(root, host)) continue;
    const hyphen = hyphenWidth(host);

    // Measure with wrapping switched off for this paragraph.
    //
    // `overflow-wrap: break-word` has already wrapped the too-long word into
    // lines of its own choosing, so a range over the tail of it straddles one of
    // those breaks and reports two rects - which reads as "this does not fit"
    // and parks a soft hyphen right after it. Held on one line the same text
    // measures as what it is: one advance width per prefix, so the break lands
    // at the furthest character that fits and nowhere else. The style is put
    // back before anything can be painted, so the sheet never flickers.
    const priorWrap = host.style.getPropertyValue('white-space');
    host.style.setProperty('white-space', 'nowrap');
    try {
      SEGMENT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SEGMENT.exec(clean))) {
        const segEnd = m.index + m[0].length;
        // A hyphen already in the word is a break opportunity of its own, so
        // each piece between hyphens is measured on its own - but the hyphen
        // stays in the piece, because it prints when the line ends there.
        let start = m.index;
        for (let i = start; i < segEnd; i++) {
          if (clean[i] === '-') {
            fitSegments(edit, start, i + 1, availW, hyphen);
            start = i + 1;
          }
        }
        fitSegments(edit, start, segEnd, availW, hyphen);
      }
    } finally {
      if (priorWrap) host.style.setProperty('white-space', priorWrap);
      else host.style.removeProperty('white-space');
    }

    if (edit.putAt.size) {
      let out = '';
      for (let i = 0; i < clean.length; i++) {
        if (edit.putAt.has(i)) out += SOFT_HYPHEN;
        out += clean[i];
      }
      node.data = out;
    }
  }

  // A pass that takes a soft hyphen out only to put the same one back has left
  // the text exactly as it found it - that is the steady state on every layout
  // pass, and reporting it as a change would keep the document saving itself
  // for nothing.
  const settled = nodes.every((node, i) => node.data === originals[i]);
  if (!settled) restoreSelection(selection, edits);
  let rewritten = 0;
  for (let i = 0; i < nodes.length; i++) if (nodes[i].data !== originals[i]) rewritten++;
  return rewritten;
}

/**
 * Break one piece of a word (text between spaces, or between existing hyphens)
 * into as many lines as it needs, recording a soft hyphen at each break.
 *
 * Every break is decided against the full measure, because the browser has
 * already moved the piece to a line of its own before it ever needs cutting.
 */
function fitSegments(
  edit: Edit,
  start: number,
  end: number,
  availW: number,
  hyphen: number,
): void {
  let at = start;
  while (at < end) {
    const cut = largestFittingPrefix(edit.node, at, end, availW - hyphen);
    // The whole remainder fits, so this piece needs no break at all. It is
    // measured rather than asked as "does [at, end) sit on one line", because
    // the browser has *already* wrapped the too-long word (that is what
    // `overflow-wrap: break-word` asked for): a range over the tail can straddle
    // one of its breaks and look like it does not fit when it does.
    if (cut >= end) return;
    // Nothing fits - even one character is wider than the column, or the text is
    // not on screen to be measured. Leave it: `overflow-wrap: break-word` still
    // keeps it inside the frame.
    if (cut <= at) return;
    edit.putAt.add(cut);
    at = cut;
  }
}

/** Width of `[a, b)` of `node` when it sits on one line, else null. */
function oneLineWidth(node: Text, a: number, b: number): number | null {
  const range = document.createRange();
  range.setStart(node, a);
  range.setEnd(node, b);
  const rects = range.getClientRects();
  if (rects.length !== 1) return null; // wrapped, or nothing to measure
  return rects[0].width;
}

/** The furthest offset `k` in `(a, b]` whose text still fits `limit`. */
function largestFittingPrefix(node: Text, a: number, b: number, limit: number): number {
  let lo = a + 1;
  let hi = b;
  let best = a;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const width = oneLineWidth(node, a, mid);
    if (width !== null && width <= limit) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Whether the paragraph this text belongs to asks for long words to be broken.
 *
 * Two places may say so, and the nearer one wins:
 *
 *  - the paragraph's own declaration - the pill's break-long-words button, which
 *    is also the only way to say no to a frame's house rule, because an explicit
 *    `normal` on the paragraph is read as an opt-out;
 *  - the frame's standard (`data-text` on the template, applied to the frame's
 *    content node), which is the house rule for body copy. That is the one that
 *    survives a wholesale paste: the replacement text arrives with no styles at
 *    all, so a rule living on the replaced blocks would go with them.
 *
 * The walk stops at `root` - the frame's own content node - because a text frame
 * does not nest inside another one.
 */
function asksForBreaks(root: HTMLElement, from: Element): boolean {
  for (let el: Element | null = from; el; el = el.parentElement) {
    const own = wrapOf(el);
    if (own) return own === 'break-word' || own === 'anywhere';
    if (el === root) break;
  }
  return false;
}

/** The element's own `overflow-wrap` declaration, or '' when it makes none. */
function wrapOf(el: Element): string {
  const style = (el as HTMLElement).style;
  if (!style) return '';
  const value = style.getPropertyValue('overflow-wrap') || style.getPropertyValue('word-wrap');
  return value.trim().toLowerCase();
}

/** One canvas for the whole session, for measuring a hyphen in a given face. */
let canvas: CanvasRenderingContext2D | null = null;

/** Advance width of a hyphen in `el`'s type, so the break point is honest. */
function hyphenWidth(el: Element): number {
  const cs = getComputedStyle(el);
  const size = parseFloat(cs.fontSize) || 13;
  const spacing = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0;
  try {
    if (!canvas) canvas = document.createElement('canvas').getContext('2d');
    if (canvas) {
      canvas.font = cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return canvas.measureText('-').width + spacing;
    }
  } catch {
    /* fall through to the estimate */
  }
  return size * 0.35;
}

/* ---------------------------------------------------------------- caret -- */

interface Caret {
  start: { node: Text; offset: number };
  end: { node: Text; offset: number };
}

/** The selection, if both ends of it live inside this frame's text. */
function selectionIn(root: HTMLElement): Caret | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const start = range.startContainer;
  const end = range.endContainer;
  if (!root.contains(start) || !root.contains(end)) return null;
  if (start.nodeType !== Node.TEXT_NODE || end.nodeType !== Node.TEXT_NODE) return null;
  return {
    start: { node: start as Text, offset: range.startOffset },
    end: { node: end as Text, offset: range.endOffset },
  };
}

/**
 * Put the caret back where it was, moved by however many characters the pass
 * added or removed before it.
 *
 * The text nodes keep their identity through the rewrite, so the caret can be
 * mapped exactly: drop the offset past every soft hyphen that was taken out,
 * then pick up an offset for every soft hyphen put in ahead of it. Without this
 * a pass running under a formatter's hands would silently jump the caret to the
 * end of the paragraph.
 */
function restoreSelection(caret: Caret | null, edits: Edit[]): void {
  if (!caret) return;
  const byNode = new Map(edits.map((e) => [e.node, e]));
  const move = (at: { node: Text; offset: number }): { node: Text; offset: number } => {
    const edit = byNode.get(at.node);
    if (!edit) return at;
    let removed = 0;
    for (const p of edit.shyAt) if (p < at.offset) removed++;
    const cleanOffset = at.offset - removed;
    let added = 0;
    for (const p of edit.putAt) if (p <= cleanOffset) added++;
    return { node: at.node, offset: cleanOffset + added };
  };
  const start = move(caret.start);
  const end = move(caret.end);
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  try {
    range.setStart(start.node, Math.min(start.offset, start.node.data.length));
    range.setEnd(end.node, Math.min(end.offset, end.node.data.length));
  } catch {
    return;
  }
  sel.removeAllRanges();
  sel.addRange(range);
}
