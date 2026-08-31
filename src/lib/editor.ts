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
  if (!savedRange) return [];
  const blocks = topBlocks();
  const hit = blocks.filter((b) => {
    try {
      return savedRange!.intersectsNode(b);
    } catch {
      return false;
    }
  });
  return hit.length ? hit : blocks.slice(0, 0);
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

  if (blocks.length > 1) {
    for (const b of blocks) b.style.setProperty(prop, value);
    captureSelection();
    return;
  }

  // Single block (or plain text): wrap in a styled span.
  const span = document.createElement('span');
  span.style.setProperty(prop, value);
  try {
    span.appendChild(range.extractContents());
    range.insertNode(span);
    const next = document.createRange();
    next.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(next);
  } catch {
    // Fall back to styling the whole block.
    const block = getCurrentBlock();
    if (block) block.style.setProperty(prop, value);
  }
  captureSelection();
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
