/**
 * Selection-preserving helpers for the contentEditable document surface.
 *
 * The bug this module solves: clicking a toolbar button moves focus out of the
 * editable area, which destroys the user's text selection, so "change the font
 * of the selected text" silently did nothing. We solve it two ways at once:
 *
 *   1. Toolbar controls call `preventDefault()` on mousedown so focus never
 *      leaves the editor in the first place.
 *   2. We continuously track the last selection inside the editor and restore
 *      it immediately before running any command, as a safety net.
 */

let editorEl: HTMLElement | null = null;
let savedRange: Range | null = null;

export function registerEditor(el: HTMLElement | null) {
  editorEl = el;
}

/* ------------------------------------------------------------ undo / redo --
 *
 * Document history belongs to the canvas (it owns the boxes), but undo can be
 * asked for from three places: the menu bar, the toolbar buttons and the
 * keyboard. Rather than thread a callback through every one of them, the
 * canvas registers its history handler here and everyone else calls into it.
 */
type HistoryHandler = (kind: 'undo' | 'redo') => void;
let historyHandler: HistoryHandler | null = null;

export function registerHistory(handler: HistoryHandler | null) {
  historyHandler = handler;
}

/** Step the document history. A no-op when no canvas is mounted. */
export function history(kind: 'undo' | 'redo') {
  historyHandler?.(kind);
}

export function getEditor(): HTMLElement | null {
  return editorEl;
}

/** Prefer CSS spans (`<span style="color:...">`) over legacy `<font>` tags. */
export function initEditorCommands() {
  try {
    document.execCommand('styleWithCSS', false, 'true');
  } catch {
    /* not supported everywhere; harmless */
  }
  try {
    // Ensure default execCommand uses CSS
    document.execCommand('defaultParagraphSeparator', false, 'p');
  } catch {
    /* not supported everywhere; harmless */
  }
}

function isInsideEditor(node: Node | null): boolean {
  return !!node && !!editorEl && editorEl.contains(node);
}

/** Remember the current selection if it lives inside the editor. */
export function captureSelection(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const r = sel.getRangeAt(0);
  if (!isInsideEditor(r.commonAncestorContainer)) return false;
  savedRange = r.cloneRange();
  return true;
}

export function hasSavedSelection(): boolean {
  return !!savedRange;
}

/** True when the saved range covers actual text, not just a blinking caret. */
export function hasSelection(): boolean {
  return !!savedRange && !savedRange.collapsed;
}

/** Put the caret / selection back inside the editor. */
export function restoreSelection(): boolean {
  if (!savedRange || !editorEl) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  try {
    editorEl.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return true;
  } catch {
    return false;
  }
}

/** Call once on mount: keep `savedRange` fresh as the user selects text. */
export function startSelectionTracking(): () => void {
  const onSelChange = () => {
    captureSelection();
  };
  document.addEventListener('selectionchange', onSelChange);
  return () => document.removeEventListener('selectionchange', onSelChange);
}

/**
 * Park the caret inside the editor (start of contents) when there is no live
 * selection - e.g. a menu-driven command before the user has ever clicked into
 * the page. `exec()` and `applyInlineStyle()` both use this so font/size
 * choices with a bare caret still have somewhere to act.
 */
function ensureSelection(): void {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && isInsideEditor(sel.getRangeAt(0).commonAncestorContainer)) {
    return;
  }
  if (!restoreSelection() && editorEl) {
    editorEl.focus({ preventScroll: true });
    const fresh = window.getSelection();
    if (fresh && fresh.rangeCount === 0) {
      const r = document.createRange();
      r.setStart(editorEl, 0);
      r.collapse(true);
      fresh.addRange(r);
    }
    captureSelection();
  }
}

/** The editor fires `input` events only for user typing; the direct DOM
 *  surgery we do for inline styles bypasses beforeinput/input entirely. Fire
 *  a synthetic `input` afterwards so debounced auto-save (and anything else
 *  listening, e.g. the word count) notices formatting changes. */
export function notifyInput(): void {
  if (!editorEl) return;
  editorEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

/** Run a native editing command against the last known selection. */
export function exec(command: string, value?: string): void {
  ensureSelection();
  try {
    document.execCommand(command, false, value);
  } catch {
    /* ignore unsupported commands */
  }
  captureSelection();
  // Document owners persist from the live DOM on `input`, so any command that
  // rewrites the content (bold, link, table, undo...) must announce itself the
  // same way a keystroke does.
  notifyInput();
}

/** `true` when the command is active at the caret (bold, italic, align...). */
export function queryState(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

/** Current value of a command at the caret, e.g. `fontName`. */
export function queryValue(command: string): string {
  try {
    return document.queryCommandValue(command) || '';
  } catch {
    return '';
  }
}

/** Top-level block elements inside the editor. */
function topBlocks(): HTMLElement[] {
  if (!editorEl) return [];
  return Array.from(editorEl.children).filter(
    (n): n is HTMLElement => n.nodeType === Node.ELEMENT_NODE,
  );
}

/** Blocks touched by the current selection. */
function blocksInSelection(): HTMLElement[] {
  if (!savedRange || !editorEl) return [];
  const blocks = Array.from(editorEl.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li,blockquote,div'));
  const hit = blocks.filter((b) => {
    try {
      return savedRange!.intersectsNode(b) && (b.textContent?.length ?? 0) > 0;
    } catch {
      return false;
    }
  });
  return hit.length ? hit : [];
}

/** Walk up from the caret to the top-level block that contains it. */
export function getCurrentBlock(): HTMLElement | null {
  if (!editorEl || !savedRange) return null;
  let node: Node | null = savedRange.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  while (node && node.parentNode !== editorEl) node = node.parentNode;
  return node && node !== editorEl ? (node as HTMLElement) : null;
}

/**
 * Remove every declaration of `prop` from an element subtree.
 * Used before re-styling so the new value replaces the old one cleanly.
 */
function stripProperty(root: DocumentFragment | Element, prop: string): void {
  const elements: Element[] =
    root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
      ? Array.from((root as DocumentFragment).children)
      : [root as Element];

  for (const el of elements) {
    if (el instanceof HTMLElement) el.style.removeProperty(prop);
    for (const child of Array.from(el.children)) stripProperty(child, prop);
  }
}

/**
 * The part of `range` that falls inside `block`, or null when they don't meet.
 *
 * Boundary-point comparison is done in both directions because a range can
 * start before and/or end after the block: we need the overlap, not "does it
 * touch it".
 */
function rangeInside(range: Range, block: HTMLElement): Range | null {
  const doc = block.ownerDocument;
  const b = doc.createRange();
  b.selectNodeContents(block);
  // range.start at/after block end, or range.end at/before block start.
  if (range.compareBoundaryPoints(Range.START_TO_END, b) >= 0) return null;
  if (range.compareBoundaryPoints(Range.END_TO_START, b) <= 0) return null;
  const out = doc.createRange();
  if (range.compareBoundaryPoints(Range.START_TO_START, b) >= 0) {
    out.setStart(range.startContainer, range.startOffset);
  } else {
    out.setStart(b.startContainer, b.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, b) <= 0) {
    out.setEnd(range.endContainer, range.endOffset);
  } else {
    out.setEnd(b.endContainer, b.endOffset);
  }
  return out.collapsed ? null : out;
}

/** Wrap the contents of `range` in a span carrying `prop: value`. */
function wrapRange(part: Range, prop: string, value: string): HTMLElement | null {
  const span = document.createElement('span');
  span.style.setProperty(prop, value);
  const frag = part.extractContents();
  stripProperty(frag, prop);
  unwrapStylelessSpans(frag);
  span.appendChild(frag);
  part.insertNode(span);
  return span;
}

/**
 * Style a selection that spans several blocks.
 *
 * The old implementation handed the work to `execCommand`, which only knows
 * three properties (font name, colour, highlight) - so `font-size` across two
 * paragraphs was silently routed to `foreColor` and the size never changed.
 * Doing it ourselves also keeps the full font fallback stack instead of the
 * bare family `execCommand('fontName')` writes out.
 */
function applyAcrossBlocks(
  range: Range,
  rawBlocks: HTMLElement[],
  prop: string,
  value: string,
): void {
  // Nested matches (a <div> inside a selected <div>) would both be wrapped,
  // producing span-in-span. Keep only the outermost ones.
  const blocks = rawBlocks.filter((b) => !rawBlocks.some((o) => o !== b && o.contains(b)));

  // Snapshot every intersection BEFORE touching the DOM: extracting a range
  // rewrites the tree, which moves any boundary still pointing inside it.
  const parts: { block: HTMLElement; range: Range }[] = [];
  for (const b of blocks) {
    const part = rangeInside(range, b);
    if (part) parts.push({ block: b, range: part });
  }

  const created: HTMLElement[] = [];
  // Walk backwards: a wrap only rewrites the block being handled, so doing the
  // last block first leaves every earlier boundary point untouched.
  for (let i = parts.length - 1; i >= 0; i--) {
    const { block, range: part } = parts[i];
    if (!block.isConnected) continue;
    if (rangeCoversContent(part, block)) {
      // The whole block is selected - style the block itself and drop any
      // inline value buried inside it, otherwise the two fight each other.
      block.style.setProperty(prop, value);
      for (const child of Array.from(block.children)) stripProperty(child, prop);
      created.unshift(block);
      continue;
    }
    const span = wrapRange(part, prop, value);
    if (span) created.unshift(span);
  }

  // Re-select what we just styled so the toolbar keeps tracking the run.
  if (created.length) {
    try {
      const r = document.createRange();
      r.setStartBefore(created[0]);
      r.setEndAfter(created[created.length - 1]);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(r);
      }
      savedRange = r.cloneRange();
    } catch {
      /* a detached node means the caller will re-capture */
    }
  }
}

/**
 * After stripping a property, spans that no longer carry any style (or any
 * attribute at all) are dead wrappers left behind by a previous formatting
 * pass - unwrap them so the document doesn't accumulate markup litter.
 */
function unwrapStylelessSpans(root: DocumentFragment | Element): void {
  for (const el of Array.from(root.querySelectorAll('span'))) {
    const attrs = Array.from(el.attributes);
    const dead =
      attrs.length === 0 ||
      (attrs.length === 1 && attrs[0].name === 'style' && !attrs[0].value);
    if (dead) unwrapElement(el as HTMLElement);
  }
}

/**
 * True when `range` spans the entire contents of `el`.
 *
 * We compare boundary points rather than using `Selection.containsNode`,
 * because that helper only reports containment when the range boundaries sit
 * *outside* the node - a range that covers a span's whole text but starts and
 * ends inside it would otherwise be treated as a partial selection.
 */
function rangeCoversContent(range: Range, el: HTMLElement): boolean {
  const elRange = el.ownerDocument.createRange();
  elRange.selectNodeContents(el);
  const startsAtOrBefore = range.compareBoundaryPoints(Range.START_TO_START, elRange) <= 0;
  const endsAtOrAfter = range.compareBoundaryPoints(Range.END_TO_END, elRange) >= 0;
  if (startsAtOrBefore && endsAtOrAfter) return true;

  // A range that spans the element's entire text but starts and ends *inside*
  // it still compares as "not containing" it: (span, 0) is a different tree
  // position from (text, 0). Fall back to comparing the actual text.
  const elText = el.textContent ?? '';
  return elText.length > 0 && range.toString() === elText;
}

/** Replace an element with its own children, keeping the child nodes alive. */
function unwrapElement(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/**
 * Apply a CSS property to the selection.
 *
 * - Collapsed caret  -> sets it on the current block (applies to new typing).
 * - Within one block -> wraps the selection in a span.
 * - Across blocks    -> sets it on each touched block.
 */
export function applyInlineStyle(prop: string, value: string): void {
  ensureSelection();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);

  if (range.collapsed) {
    const block = getCurrentBlock();
    if (block) block.style.setProperty(prop, value);
    captureSelection();
    notifyInput();
    return;
  }

  const blocks = blocksInSelection();

  // A selection that crosses block boundaries must be styled per text run.
  // Applying a block style would make mixed selections lose their inline
  // formatting and, for font changes, only affect the block containing the
  // caret in some browsers. execCommand's CSS implementation handles each
  // selected run consistently and preserves existing properties.
  if (blocks.length > 1) {
    try {
      applyAcrossBlocks(range, blocks, prop, value);
    } catch {
      for (const b of blocks) b.style.setProperty(prop, value);
    }
    captureSelection();
    notifyInput();
    return;
  }

  // Single block (or plain text): wrap in a styled span.
  const span = document.createElement('span');
  span.style.setProperty(prop, value);
  const root = getEditor();

  try {
    // Ancestor spans that the selection covers *entirely*. We clear the old
    // value from these after inserting, otherwise every font / colour change
    // would wrap the text in yet another span and the DOM would grow forever.
    const covered: HTMLElement[] = [];
    let anc: HTMLElement | null =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : (range.commonAncestorContainer as HTMLElement);
    while (anc && anc !== root) {
      if (anc.tagName === 'SPAN' && rangeCoversContent(range, anc)) covered.push(anc);
      anc = anc.parentElement;
    }

    const contents = range.extractContents();

    // Drop any existing value for this property inside the extracted fragment,
    // so re-applying replaces the old value instead of nesting another span
    // every time the user picks a different font / colour.
    stripProperty(contents, prop);
    unwrapStylelessSpans(contents);

    span.appendChild(contents);

    // `extractContents` may leave empty span wrappers inside the fragment
    // when the selection boundary sits inside an existing styled run. Sweep
    // them out before we collapse the new span, otherwise they would still be
    // there after the cleanup at the end of this function.
    for (const child of Array.from(span.children)) {
      if (child.tagName === 'SPAN' && !child.firstChild) span.removeChild(child);
      else if (child instanceof HTMLElement && child.tagName === 'SPAN' && !child.getAttribute('style')) unwrapElement(child);
    }

    // If the fragment turned out to be a single span that no longer carries
    // any inline style, reuse it rather than wrapping span-in-span.
    let node: HTMLElement = span;
    if (span.childNodes.length === 1) {
      const only = span.firstElementChild as HTMLElement | null;
      if (only && only.tagName === 'SPAN' && !only.getAttribute('style')) {
        only.style.setProperty(prop, value);
        node = only;
      }
    }

    range.insertNode(node);

    // Select the newly inserted content so the toolbar keeps tracking it.
    const newRange = document.createRange();
    newRange.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(newRange);

    // Capture the new selection
    savedRange = newRange.cloneRange();

    // Now retire the fully-covered ancestors. Every *other* declaration they
    // carried (underline, highlight colour, weight, etc.) is moved onto `node`
    // so changing one property does not silently strip the rest - `text-
    // decoration` and `background-color` do not inherit, so leaving them on a
    // separate parent span would make them disappear from the new run.
    const carry: string[] = [];
    for (const el of covered) {
      if (!el.isConnected) continue;
      const decls = (el.getAttribute('style') ?? '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const d of decls) {
        const name = d.split(':')[0]?.trim();
        if (!name) continue;
        if (name.toLowerCase() === prop) {
          el.style.removeProperty(name);
        } else {
          carry.push(d);
        }
      }
      // An ancestor that has been reduced to nothing but a wrapper around
      // `node` is dead weight even if it still carries a style declaration -
      // the carried styles have already been moved onto `node`, and
      // `text-decoration` does not inherit anyway, so the wrapper has nothing
      // left to contribute.
      if (!el.firstChild || el.firstElementChild === node) unwrapElement(el);
    }

    // `extractContents` may have emptied *other* spans (those that were
    // partly covered by the selection but not fully contained). Those never
    // land in `covered`, but they now sit next to `node` with no content.
    // Sweep up any empty span siblings at every level up to the editor.
    {
      let p: HTMLElement | null = node.parentElement;
      while (p && p !== root) {
        const siblings = Array.from(p.children);
        for (const sib of siblings) {
          if (sib === node) continue;
          if (sib.tagName === 'SPAN' && !sib.firstChild) unwrapElement(sib as HTMLElement);
        }
        p = p.parentElement;
      }
    }
    for (const d of carry) {
      const idx = d.indexOf(':');
      if (idx <= 0) continue;
      const name = d.slice(0, idx).trim();
      const value = d.slice(idx + 1).trim();
      // `font-family` carries quoted commas; values like "1px solid red" still
      // split fine on the first colon.
      if (name && !name.toLowerCase().includes('unknown')) node.style.setProperty(name, value);
    }
    notifyInput();
  } catch {
    // Fall back to styling the whole block.
    const block = getCurrentBlock();
    if (block) block.style.setProperty(prop, value);
    captureSelection();
    notifyInput();
  }
}

/** Line-height is not a native execCommand, so set it on the touched blocks. */
export function setLineHeight(value: number | string): void {
  ensureSelection();
  const blocks = blocksInSelection();
  const target = blocks.length ? blocks : getCurrentBlock() ? [getCurrentBlock()!] : [];
  for (const b of target) b.style.lineHeight = String(value);
  if (!target.length) applyInlineStyle('line-height', String(value));
  captureSelection();
  notifyInput();
}

/** Paragraph style: 'p' | 'h1' ... 'h6'. */
export function formatBlock(tag: string): void {
  exec('formatBlock', `<${tag}>`);
}

export function clearFormatting(): void {
  exec('removeFormat');
}

/** Apply a toolbar property while preserving mixed formatting across blocks. */
export function applyCommandStyle(command: string, value?: string): void {
  ensureSelection();
  try {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
  } catch {
    /* ignore unsupported commands */
  }
  captureSelection();
  notifyInput();
}

/** Prompt-free link insertion using execCommand (keeps the selection intact).
 *  When the caret is collapsed - e.g. Ctrl+K with nothing selected - the URL
 *  itself is inserted as linked text instead of silently doing nothing. */
export function insertLink(url: string): void {
  if (!url) return;
  const safe = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (sel && !sel.isCollapsed) {
    exec('createLink', safe);
    return;
  }
  // Collapsed caret: createLink has nothing to wrap, so insert a fresh link.
  // Built through the DOM so href and text are each escaped exactly once -
  // hand-rolling the HTML double-escaped an `&` into a visible "&amp;".
  const a = document.createElement('a');
  a.href = safe;
  a.textContent = safe;
  exec('insertHTML', `${a.outerHTML}&nbsp;`);
}

/** Computed CSS value at the caret, e.g. `currentStyle('fontFamily')`. */
export function currentStyle(prop: string): string {
  if (!savedRange) return '';
  
  // First try to get the style from the immediate parent element
  let node: Node | null = savedRange.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  
  // Walk up to find an element with the specified style
  while (node && node !== editorEl) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      
      // Check inline style first (most specific)
      const inlineValue = el.style.getPropertyValue(prop);
      if (inlineValue) return inlineValue;
      
      // Check computed style
      const computedValue = window.getComputedStyle(el).getPropertyValue(prop);
      if (computedValue && computedValue !== 'inherit' && computedValue !== 'initial') {
        return computedValue;
      }
    }
    node = node.parentNode;
  }
  
  // Fall back to the current block
  const block = getCurrentBlock();
  if (!block) return '';
  return window.getComputedStyle(block).getPropertyValue(prop);
}

/**
 * Find `query` in the editor text and select the next match after the caret.
 * Returns the 1-based match index, or 0 when there is no match.
 */
/**
 * Replace every occurrence of `query` with `replacement` (case-insensitive).
 * Works across separate text nodes by doing one big innerHTML surgery pass:
 * cheap, and fine for bulletin-sized documents. Returns the match count.
 */
export function replaceAll(query: string, replacement: string): number {
  if (!editorEl || !query) return 0;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');

  // Only ever touch TEXT nodes. Rewriting `innerHTML` would happily rewrite
  // markup too - replacing the single letter "p" would shred every <p> tag and
  // every `p` inside an attribute, corrupting the document.
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);

  let count = 0;
  for (const node of nodes) {
    const hits = node.data.match(re);
    if (!hits) continue;
    count += hits.length;
    // Assigning to `data` is a literal replacement - no `$&` expansion to
    // escape, and no markup can be produced by the replacement text.
    node.data = node.data.replace(re, replacement);
  }

  if (count > 0) {
    captureSelection();
    // The surgery above bypasses the normal input pipeline, so the
    // canvas/autosave would never hear about the replacement (the old text
    // stayed on disk until the next keystroke). Announce it like a keystroke.
    notifyInput();
  }
  return count;
}

/** Character/word/sentence counts for the word-count dialog. */
export function docStats(): { words: number; characters: number; sentences: number } {
  const text = (editorEl?.innerText ?? editorEl?.textContent ?? '').replace(/\u00a0/g, ' ');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const characters = text.replace(/\n/g, '').length;
  const sentences = (text.match(/[.!?]+(?=\s|$)/g) ?? []).length;
  return { words, characters, sentences };
}

/** Plain text of the current selection, for the dictionary lookup. */
export function selectedText(): string {
  return savedRange ? savedRange.toString().trim() : '';
}

/* -------- document language (`File > Language`) -------- */

const DOC_LANG_KEY = 'bulletin.docLanguage';

export function getDocLang(): string {
  try {
    return localStorage.getItem(DOC_LANG_KEY) || 'en-AU';
  } catch {
    return 'en-AU';
  }
}

export function setDocLang(lang: string): void {
  try {
    localStorage.setItem(DOC_LANG_KEY, lang);
  } catch {
    /* non-fatal */
  }
  if (editorEl) editorEl.lang = lang;
}

/** Change the case of the selected text (Format > Text > Capitalisation). */
export function transformSelectionCase(mode: 'lower' | 'upper' | 'title'): void {
  const text = selectedText();
  if (!text) return;
  const t =
    mode === 'lower'
      ? text.toLowerCase()
      : mode === 'upper'
        ? text.toUpperCase()
        : text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  exec('insertText', t);
}

export function findAndSelect(query: string): number {
  if (!editorEl || !query) return 0;

  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  const haystack = textNodes.map((t) => t.data).join('').toLowerCase();
  const needle = query.toLowerCase();

  // Start searching after the current caret position.
  let startOffset = 0;
  if (savedRange) {
    const before = document.createRange();
    before.setStart(editorEl, 0);
    before.setEnd(savedRange.endContainer, savedRange.endOffset);
    startOffset = before.toString().length;
  }

  let idx = haystack.indexOf(needle, startOffset);
  if (idx === -1) idx = haystack.indexOf(needle); // wrap around
  if (idx === -1) return 0;

  // Map the flat character offset back onto (textNode, offset).
  let remaining = idx;
  let startNode: Text | null = null;
  let nodeOffset = 0;
  for (const t of textNodes) {
    if (remaining <= t.data.length) {
      startNode = t;
      nodeOffset = remaining;
      break;
    }
    remaining -= t.data.length;
  }
  if (!startNode) return 0;

  const range = document.createRange();
  try {
    range.setStart(startNode, nodeOffset);
    range.setEnd(startNode, Math.min(nodeOffset + query.length, startNode.data.length));
  } catch {
    return 0;
  }

  const sel = window.getSelection();
  if (!sel) return 0;
  editorEl.focus({ preventScroll: true });
  sel.removeAllRanges();
  sel.addRange(range);
  savedRange = range.cloneRange();

  // Bring it into view.
  const rect = range.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    (startNode.parentElement ?? editorEl).scrollIntoView({ block: 'center' });
  }

  // 1-based index of the match we landed on.
  return haystack.split(needle).slice(0, haystack.slice(0, idx).split(needle).length).length;
}
