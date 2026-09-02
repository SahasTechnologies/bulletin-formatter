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

/** Run a native editing command against the last known selection. */
export function exec(command: string, value?: string): void {
  restoreSelection();
  try {
    document.execCommand(command, false, value);
  } catch {
    /* ignore unsupported commands */
  }
  captureSelection();
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
 * True when `range` spans the entire contents of `el`.
 *
 * We compare boundary points rather than using `Selection.containsNode`,
 * because that helper only reports containment when the range boundaries sit
 * *outside* the node — a range that covers a span's whole text but starts and
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
  restoreSelection();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);

  if (range.collapsed) {
    const block = getCurrentBlock();
    if (block) block.style.setProperty(prop, value);
    captureSelection();
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
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand(prop === 'background-color' ? 'hiliteColor' : 'fontName', false, value);
      captureSelection();
      return;
    } catch {
      for (const b of blocks) b.style.setProperty(prop, value);
      captureSelection();
      return;
    }
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

    span.appendChild(contents);

    // `extractContents` may leave empty span wrappers inside the fragment
    // when the selection boundary sits inside an existing styled run. Sweep
    // them out before we collapse the new span, otherwise they would still be
    // there after the cleanup at the end of this function.
    for (const child of Array.from(span.children)) {
      if (child.tagName === 'SPAN' && !child.firstChild) span.removeChild(child);
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
    // so changing one property does not silently strip the rest — `text-
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
      // `node` is dead weight even if it still carries a style declaration —
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
  } catch {
    // Fall back to styling the whole block.
    const block = getCurrentBlock();
    if (block) block.style.setProperty(prop, value);
    captureSelection();
  }
}

/** Line-height is not a native execCommand, so set it on the touched blocks. */
export function setLineHeight(value: number | string): void {
  restoreSelection();
  const blocks = blocksInSelection();
  const target = blocks.length ? blocks : getCurrentBlock() ? [getCurrentBlock()!] : [];
  for (const b of target) b.style.lineHeight = String(value);
  if (!target.length) applyInlineStyle('line-height', String(value));
  captureSelection();
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
  restoreSelection();
  try {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
  } catch {
    /* ignore unsupported commands */
  }
  captureSelection();
}

/** Prompt-free link insertion using execCommand (keeps the selection intact). */
export function insertLink(url: string): void {
  if (!url) return;
  const safe = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
  exec('createLink', safe);
}

export function insertImageFromFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const src = String(reader.result);
    exec('insertHTML', `<img src="${src}" alt="" style="max-width:100%;height:auto;" />`);
  };
  reader.readAsDataURL(file);
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
