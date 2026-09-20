import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  ChevronUp,
  FileText,
  History,
  RotateCcw,
  AlignLeft,
  AlignCenter,
  AlignRight,
  LayoutTemplate,
  PanelRightClose,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import MenuBar, { menuSearchEntries } from './components/MenuBar';
import Toolbar from './components/Toolbar';
import DocumentCanvas from './components/DocumentCanvas';
import HomeScreen from './components/HomeScreen';
import { GoogleFontProvider, isGoogleFont, loadGoogleFont } from './components/GoogleFontProvider';
import MasterSection from './components/MasterSection';
import GuideScreen from './components/GuideScreen';
import MergeDialog from './components/MergeDialog';
import { FeedbackProvider, useFeedback } from './components/Feedback';
import { navigate, usePath } from './lib/router';
import { mergeIssue, type MergeResult } from './lib/merge';
import { splitIntoBoxes, CONTENT_INSET, TRANSPARENT_GIF } from './lib/frames';
import { sanitizeFrameText } from './lib/frameStyle';
import { tombstoneCorner } from './lib/marker';
import { GUIDE_PAGES, type GuidePage } from './data/designGuide';
import * as ed from './lib/editor';
import {
  activeMaster,
  applyMasterTo,
  assignmentSummary,
  BAND_LABELS,
  emptyMasterSet,
  loadMaster,
  masterForPage,
  serializeMaster,
  splitBandKey,
  withBand,
  MASTER_TOKENS,
  type BandKey,
  type MasterAlign,
  type MasterBand,
  type MasterDef,
  type MasterSet,
} from './lib/master';
import {
  loadRecentDocs,
  offloadMediaForSave,
  purgeAllDocs,
  purgeDoc,
  saveDoc,
  renameDoc,
  newDocId,
  getVersions,
  recordVersion,
  MAX_DOCS,
  type StoredDocument,
} from './lib/storage';
import { getTemplate, type Template } from './data/templates';
import {
  downloadBulletin,
  downloadHtml,
  downloadText,
  parseBulletin,
  type BulletinDoc,
} from './lib/format';

const PAGE_SIZES = {
  Letter: { width: 816, height: 1056 },
  A4: { width: 794, height: 1123 },
} as const;

type PageSizeName = keyof typeof PAGE_SIZES;

/** CSS generic font keywords (and the bare web-safe families) that appear at
    the tail of `font-family` stacks - never useful to "load". */
const GENERIC_FONT_KEYWORDS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji',
  'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer',
  'redhattext', // the app's chrome font, always locally available
]);

/** Walk an HTML string, pick out every `font-family:` stack, and preload the
    Google Fonts we find. The Home-screen thumbnail and the live template both
    need the typeface before the first paint, and the font provider is
    normally only poked on hover/select by the toolbar. */
function preloadTemplateFonts(html: string): void {
  const re = /font-family\s*:\s*([^;"]+)/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^['"]|['"]$/g, '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (GENERIC_FONT_KEYWORDS.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isGoogleFont(name)) loadGoogleFont(name);
    }
  }
}

/** A4 portrait and the inset the bulletin templates are laid out at. This is
    the templates' own design geometry, not a margin the editor enforces -
    there are no margins, and a frame may sit anywhere on the sheet. */
const TEMPLATE_PAGE = { width: 794, height: 1123 };
const TEMPLATE_PAD_X = CONTENT_INSET.x;
const TEMPLATE_PAD_Y = CONTENT_INSET.y;
/** Smallest sensible body frame once the title has taken the top of the page. */
const TEMPLATE_MIN_BODY_H = 140;

/** A hidden frame used to measure a template block's natural height. */
let templateMeasureHost: HTMLDivElement | null = null;
function measureTemplateBlock(html: string, width: number): number {
  if (!templateMeasureHost || !document.body.contains(templateMeasureHost)) {
    const m = document.createElement('div');
    m.setAttribute('aria-hidden', 'true');
    m.style.cssText = [
      'position:absolute', 'left:-99999px', 'top:0', 'visibility:hidden',
      'pointer-events:none', 'box-sizing:border-box', 'margin:0', 'padding:4px',
      'overflow-wrap:break-word',
    ].join(';');
    document.body.appendChild(m);
    templateMeasureHost = m;
  }
  templateMeasureHost.style.width = `${width}px`;
  templateMeasureHost.innerHTML = html;
  return Math.ceil(templateMeasureHost.offsetHeight);
}

/**
 * Split a template page's HTML into its display title and the body below it.
 *
 * Every bulletin template leads with a display title ("Editorial",
 * "[Article Headline]", "Page of Contents"…) followed by the body. Publisher
 * keeps those as two separate objects, so the title gets its own frame and the
 * body becomes the columned frame underneath.
 */
function splitTemplateTitle(html: string): { title: string; body: string } {
  const host = document.createElement('div');
  host.innerHTML = html;
  const first = host.firstElementChild as HTMLElement | null;
  if (!first || !(first.textContent ?? '').trim()) return { title: '', body: html };
  // Only a *display title* splits off into its own frame: a real heading, a
  // run set to span the columns, or display-size type (the templates set their
  // titles in pt). An ordinary 13pt opening paragraph - the first block of an
  // article continuation sheet - must NOT become a full-width frame on top of
  // the columns; it belongs inside the two-column body.
  const isHeading = /^H[1-6]$/.test(first.tagName);
  const spansColumns = /column-span\s*:\s*all/i.test(first.style.cssText);
  const pt = parseFloat(first.style.fontSize || '0');
  const isTitle = isHeading || spansColumns || pt >= 20;
  if (!isTitle) return { title: '', body: html };
  const title = first.outerHTML;
  first.remove();
  return { title, body: host.innerHTML };
}

/**
 * The frames a template sheet opens with.
 *
 * The title is its own single-column frame across the top of the content area;
 * the rest of the sheet becomes the columned frame below it. `columns` is
 * always a number - even 1 - so DocumentCanvas.buildModel treats the body as a
 * deliberate frame and never re-splits it per element.
 */
function templateFrames(
  html: string,
  columns: number,
  pageIndex: number,
  /** The frame's standard text type (a CSS declaration list), when the sheet
      declares one in the manifest. A sheet laid out as bare blocks has no frame
      element to carry `data-text`, so the manifest is where its standard lives
      - a list of contents whose entries are 18pt still wants house body type
      when someone selects the lot and retypes it. */
  text?: string,
): Array<Record<string, unknown>> {
  const x = TEMPLATE_PAD_X;
  const y = TEMPLATE_PAD_Y;
  const w = TEMPLATE_PAGE.width - TEMPLATE_PAD_X * 2;
  const h = TEMPLATE_PAGE.height - TEMPLATE_PAD_Y * 2;
  const css = sanitizeFrameText(text);
  const mkId = (suffix: string) =>
    `tpl-${Date.now().toString(36)}-${pageIndex}-${suffix}-${Math.random().toString(36).slice(2, 6)}`;

  const { title, body } = splitTemplateTitle(html);
  if (!title) {
    return [{ id: mkId('frame'), pageIndex, x, y, w, h, html, columns, css, nextId: null }];
  }

  // The title keeps its natural height (its own padding supplies the spacing),
  // capped so a runaway measurement can never eat the whole page.
  const titleH = Math.min(Math.round(h * 0.45), Math.max(60, measureTemplateBlock(title, w)));
  const frames: Array<Record<string, unknown>> = [
    { id: mkId('title'), pageIndex, x, y, w, h: titleH, html: title, columns: 1, nextId: null },
  ];
  if (body.trim()) {
    frames.push({
      id: mkId('body'),
      pageIndex,
      x,
      y: y + titleH,
      w,
      h: Math.max(TEMPLATE_MIN_BODY_H, h - titleH),
      html: body,
      columns,
      css,
      nextId: null,
    });
  }
  return frames;
}

/**
 * The frames a template opens with.
 *
 * - `cover` - the page is one full-bleed *image* frame (the title page's
 *   artwork), click-to-add placeholder included.
 * - `frame` - the template's title becomes its own frame and the body becomes
 *   the columned frame below it, so the Columns toolbar reports the right
 *   number and a gray `column-rule` is drawn between the columns.
 * - `sheets` - extra sheets after the first (a longer article: start page,
 *   continuation pages, then an extras page). A sheet with `columns` is
 *   another title + columned-body pair; a sheet with no column setting is split into
 *   separate frames so each block stays individually draggable.
 * - neither - null, and the canvas uses the legacy per-element split.
 */
/**
 * Build the frame model for a template that lays its page out with
 * `data-frame` attributes.
 *
 * A template marked `layout: true` puts one top-level element per box, each
 * carrying `data-frame="x,y,w,h"` (plus `data-columns`, `data-kind="shape"`
 * with `data-fill`/`data-radius`, or `data-kind="line"` with
 * `data-stroke`/`data-thickness`, or `data-ph`/`data-fit` for a picture). The
 * HTML file is therefore the single source of truth: the same markup paints
 * the Home-screen thumbnail and opens as the live, movable frames.
 */
function framesFromDataAttrs(html: string): Array<Record<string, unknown>> {
  const host = document.createElement('div');
  host.innerHTML = html;
  const out: Array<Record<string, unknown>> = [];
  const stamp = Date.now().toString(36);
  Array.from(host.children).forEach((node, i) => {
    const spec = node.getAttribute('data-frame');
    if (!spec) return;
    const nums = spec.split(/[\s,]+/).map((n) => Number(n)).filter((n) => Number.isFinite(n));
    if (nums.length < 4) return;
    const [x, y, w, h] = nums;
    const el = node as HTMLElement;
    const id = `tpl-${stamp}-f${i}-${Math.random().toString(36).slice(2, 6)}`;
    const base = { id, pageIndex: 0, x, y, w, h, html: '', nextId: null };
    const kind = el.getAttribute('data-kind');
    if (kind === 'shape') {
      const radius = parseFloat(el.getAttribute('data-radius') || '') || 0;
      out.push({
        ...base,
        kind: 'shape',
        fill: el.getAttribute('data-fill') || '#fe9c53',
        radius: radius > 0 ? Math.round(radius) : undefined,
      });
    } else if (kind === 'line') {
      out.push({
        ...base,
        kind: 'line',
        stroke: el.getAttribute('data-stroke') || '#3f3f3f',
        thickness: Math.max(1, Math.round(parseFloat(el.getAttribute('data-thickness') || '') || 2)),
      });
    } else if (kind === 'tombstone') {
      // The end-of-piece marker: a black square pinned where the template put
      // it. It is never dragged or resized - only inserted and removed.
      out.push({ ...base, kind: 'tombstone' });
    } else if (el.tagName === 'IMG') {
      const radius = parseFloat(el.getAttribute('data-radius') || '') || 0;
      const fade = parseFloat(el.getAttribute('data-fade') || '') || 0;
      const fit = el.getAttribute('data-fit');
      out.push({
        ...base,
        kind: 'image',
        src: el.getAttribute('src') || TRANSPARENT_GIF,
        ph: el.getAttribute('data-ph') || undefined,
        radius: radius > 0 ? Math.round(radius) : undefined,
        fade: fade > 0 ? Math.round(fade) : undefined,
        fit: fit === 'contain' ? 'contain' : fit === 'cover' ? 'cover' : undefined,
      });
    } else {
      const columns = Math.max(1, Math.round(parseFloat(el.getAttribute('data-columns') || '') || 1));
      // The frame's standard type, and what plain text in it should align to.
      // A frame whose first block is display type (the contents list's 18pt
      // entries) declares its real body standard here, so a Ctrl+A retype lands
      // on house body type instead of being flooded with the entry style.
      const css = sanitizeFrameText(el.getAttribute('data-text'));
      const alignAttr = (el.getAttribute('data-align') || '').toLowerCase();
      const align =
        alignAttr === 'left' || alignAttr === 'right' || alignAttr === 'center' || alignAttr === 'justify'
          ? (alignAttr as 'left' | 'right' | 'center' | 'justify')
          : undefined;
      // Strip the layout hints from the seeded markup: they are instructions to
      // this function, not document content, and would otherwise be saved into
      // the box's HTML and re-parsed on the next template append.
      const clone = el.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-frame');
      clone.removeAttribute('data-columns');
      clone.removeAttribute('data-text');
      clone.removeAttribute('data-align');
      out.push({ ...base, columns, css, align, html: clone.outerHTML });
    }
  });
  return out;
}

/**
 * The frame model a template opens with, or null when it has none to build.
 *
 * Not exported: it is App's own helper, and a module that exports something
 * other than a component cannot be hot-reloaded (Vite bails out and reloads
 * the whole page instead), so a stray `export` here costs every future edit a
 * full reload.
 */
function templateBoxes(tpl: Template): string | null {
  const sheets = tpl.sheets ?? [];
  if (!tpl.frame && !tpl.cover && !tpl.layout && !sheets.length) return null;
  const boxes: Array<Record<string, unknown>> = [];
  if (tpl.layout) {
    boxes.push(...framesFromDataAttrs(tpl.content));
  } else if (tpl.cover) {
    boxes.push({
      id: `tpl-${Date.now().toString(36)}-cover-${Math.random().toString(36).slice(2, 6)}`,
      pageIndex: 0,
      // Full bleed: cover artwork runs to the trim, not the text margin.
      x: 0,
      y: 0,
      w: TEMPLATE_PAGE.width,
      h: TEMPLATE_PAGE.height,
      html: '',
      nextId: null,
      kind: 'image',
      src: TRANSPARENT_GIF,
      ph: tpl.cover.ph,
      radius: tpl.cover.radius,
      fade: tpl.cover.fade,
    });
  } else if (tpl.frame) {
    boxes.push(
      ...templateFrames(tpl.content, Math.max(1, tpl.frame.columns), 0, tpl.frame.text),
    );
  } else {
    for (const b of splitIntoBoxes(tpl.content, TEMPLATE_PAGE)) {
      boxes.push({ ...b, pageIndex: Number(b.pageIndex ?? 0) });
    }
  }
  const firstSheet = tpl.frame || tpl.cover || tpl.layout ? 1 : 0;
  sheets.forEach((sheet, i) => {
    const pageIndex = firstSheet + i;
    if (sheet.columns && sheet.columns > 0) {
      boxes.push(...templateFrames(sheet.html, sheet.columns, pageIndex, sheet.text));
    } else {
      // A plain sheet splits per element - but inside the master frame, so its
      // frames sit within the orange line like the rest of the page.
      const split = splitIntoBoxes(sheet.html, TEMPLATE_PAGE, {
        x: TEMPLATE_PAD_X,
        width: TEMPLATE_PAGE.width - TEMPLATE_PAD_X * 2,
      });
      for (const b of split) {
        boxes.push({ ...b, pageIndex: pageIndex + Number(b.pageIndex ?? 0) });
      }
    }
  });
  // A template that holds a whole piece ships its end-of-piece marker: the
  // black square, sitting in the last page's corner. It is an object on the
  // sheet like any other, so it can be switched off from Format ▸ Tombstone.
  if (tpl.tombstone) {
    const lastPage = boxes.reduce((m, b) => Math.max(m, Number(b.pageIndex ?? 0)), 0);
    boxes.push({
      id: `tpl-${Date.now().toString(36)}-tomb-${Math.random().toString(36).slice(2, 6)}`,
      pageIndex: lastPage,
      // The pinned bottom-right corner, outside the master frame - the same
      // place every other marker on every other page comes from.
      ...tombstoneCorner(TEMPLATE_PAGE),
      html: '',
      nextId: null,
      kind: 'tombstone',
    });
  }
  return JSON.stringify(boxes);
}

/** Read a document's saved page names back, dropping anything malformed. */
function readPageNames(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.map((n) => (typeof n === 'string' ? n : ''))
      : [];
  } catch {
    return [];
  }
}

/**
 * True when a stored document still carries the *old* document-level tombstone
 * flag and no marker frame yet. The marker is a frame on the sheet now, so an
 * old piece has one added when it opens; once that is saved the flag is gone
 * and this is never true again.
 */
function legacyTombstone(doc: { tombstone?: boolean; boxes?: string }): boolean {
  if (doc.tombstone !== true) return false;
  try {
    const boxes = JSON.parse(doc.boxes ?? '[]') as Array<{ kind?: string }>;
    return !boxes.some((b) => b.kind === 'tombstone');
  } catch {
    return true;
  }
}

/** Plain text of a snippet of HTML (used for word counts and exports). */
function textOfHtml(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent ?? '';
}

/** Editing keys the app must route to the editor when focus has left the page. */
const EDITING_KEYS = new Set(['b', 'i', 'u', 'z', 'y', 'a', 'x', 'c', 'v']);

/** True when the event came from somewhere that already handles those keys. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** Real text fields, where the browser's own undo must win. A text frame is a
    contentEditable, and there the app's own document history takes over. */
function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** Copy the editor selection, or fall back to the browser's own copy. */
async function copySelection(): Promise<void> {
  const text = ed.selectedText();
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* fall through to execCommand */
    }
  }
  ed.exec('copy');
}

/** Paste plain text, falling back to the native paste. */
async function pasteClipboard(): Promise<void> {
  try {
    const t = await navigator.clipboard.readText();
    if (t) {
      ed.exec('insertText', t);
      return;
    }
  } catch {
    /* permission denied - let execCommand try */
  }
  ed.exec('paste');
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl + N', 'New document'],
  ['Ctrl + O', 'Open a Bulletin file'],
  ['Ctrl + S', 'Download (.bulletin)'],
  ['Ctrl + P', 'Print'],
  ['Ctrl + K', 'Insert link'],
  ['Ctrl + F / Ctrl + H', 'Find / find and replace'],
  ['Ctrl + Z / Ctrl + Y', 'Undo / redo'],
  ['Ctrl + B', 'Bold'],
  ['Ctrl + I', 'Italic'],
  ['Ctrl + U', 'Underline'],
  ['Ctrl + Shift + V', 'Paste without formatting'],
  ['Ctrl + Shift + L / E / R / J', 'Align left / centre / right / justify'],
  ['Ctrl + Shift + C', 'Word count'],
  ['Ctrl + Shift + Y', 'Dictionary (lookup selection)'],
  ['Alt + /', 'Search the menus'],
  ['Ctrl + /', 'This shortcut list'],
];

type DialogKind = null | 'about' | 'shortcuts' | 'wordcount' | 'search' | 'details' | 'dictionary';

/**
 * The app itself is a thin provider: everything below it needs toasts and
 * confirmation dialogs, and `useFeedback` is only legal inside the provider.
 */
export default function App() {
  return (
    <FeedbackProvider>
      <AppShell />
    </FeedbackProvider>
  );
}

function AppShell() {
  const { toast, confirm } = useFeedback();
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  /** Files queued for the Merge dialog (null = dialog closed). */
  const [mergeFiles, setMergeFiles] = useState<File[] | null>(null);
  /** Current URL path - the only route is `/guide`. */
  const path = usePath();

  const [title, setTitle] = useState('Untitled bulletin');
  const [starred, setStarred] = useState(false);

  // The bulletin's body face. New documents start in Roboto Condensed, the
  // Design Bible's body type, so typing right away already matches the issue.
  const [font, setFont] = useState('Roboto Condensed');
  const [size, setSize] = useState(11);
  const [style, setStyle] = useState('Normal text');
  const [zoom, setZoom] = useState(100);
  const [spellCheck, setSpellCheck] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showRuler, setShowRuler] = useState(true);
  const [showToolbar, setShowToolbar] = useState(true);
  const [pageName, setPageName] = useState<PageSizeName>('A4');
  const [landscape, setLandscape] = useState(false);
  const [viewMode, setViewMode] = useState<'editing' | 'viewing'>('editing');
  const [docLang, setDocLang] = useState(ed.getDocLang());

  const [findQuery, setFindQuery] = useState('');
  const [findStatus, setFindStatus] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [docStatsState, setDocStatsState] = useState({ characters: 0, sentences: 0 });
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [linkRequest, setLinkRequest] = useState(0);
  const [menuTick, setMenuTick] = useState(0); // bumps to re-run the menu search
  /** End-of-document tombstone (small black square on the last page). */
  const [tombstone, setTombstone] = useState(false);
  const tombstoneRef = useRef(false);
  /** Right-hand panel with saved versions (File > Version history). */
  const [versionsOpen, setVersionsOpen] = useState(false);
  /** View > Master page - the right-hand options panel *and* in-place editing
      of the header/footer bands on the sheet, the way Publisher does it. */
  const [masterOpen, setMasterOpen] = useState(false);
  /** The publication's master pages: running head + folio for every sheet. */
  const [master, setMaster] = useState<MasterSet>(() => emptyMasterSet());
  const masterRef = useRef<MasterSet>(master);
  /** Bumped only when the panel edits band text, to re-seed the on-page bands. */
  const [masterRev, setMasterRev] = useState(0);
  /** Band last focused on the sheet - target for the ribbon's Insert field. */
  const focusedBandRef = useRef<BandKey>('rightHeader');
  /** A field the ribbon asked to insert into the focused band (at the caret). */
  const [masterToken, setMasterToken] = useState({ token: '', tick: 0 });
  /** View > Layers panel - the frame list for the page on screen. */
  const [layersOpen, setLayersOpen] = useState(false);
  /** Format > Order (and Ctrl+[ / Ctrl+]): restack the selected frame. A tick
      rather than a boolean, so asking twice for the same direction works. */
  const [arrange, setArrange] = useState<{
    mode: 'front' | 'forward' | 'backward' | 'back';
    tick: number;
  }>({ mode: 'forward', tick: 0 });
  const arrangeBy = useCallback(
    (mode: 'front' | 'forward' | 'backward' | 'back') =>
      setArrange((a) => ({ mode, tick: a.tick + 1 })),
    [],
  );

  /** Version of the document content passed to the canvas (bump = reload). */
  const [canvasRev, setCanvasRev] = useState(0);
  /** Bumped by Insert > Text box to ask the canvas for a new text box. */
  const [textboxTick, setTextboxTick] = useState(0);
  const [imageTick, setImageTick] = useState(0);
  const [imageSrc, setImageSrc] = useState('');
  /** Bumped by Format > Columns to ask the canvas to re-column the frame the
      user is working in. The canvas owns the frames, so it applies the change
      to the model (and therefore to the saved file). */
  const [columnsRequest, setColumnsRequest] = useState({ count: 1, tick: 0 });
  /** Bumped by Insert > Break > Page break to ask the canvas for a new sheet. */
  const [pageTick, setPageTick] = useState(0);
  /** Bumped by Insert > Shape / Insert > Line to ask the canvas for a new
      free-floating shape or rule on the page. */
  const [shapeTick, setShapeTick] = useState(0);
  const [lineTick, setLineTick] = useState(0);
  /** Bumped by Insert ▸ Tombstone / Format ▸ Tombstone to ask the canvas to
      add the end-of-piece marker to the current page (or take it off). */
  const [tombstoneTick, setTombstoneTick] = useState(0);
  /** Names the user has given the pages ("Page 3" becomes "Sports results").
      Index = page number - 1; a hole means the page keeps its default name. */
  const [pageNames, setPageNames] = useState<string[]>([]);
  const pageNamesRef = useRef<string[]>([]);
  // Live document content, fed by the canvas on every change. The canvas DOM is
  // the source of truth; these refs let persistence/export/stats read it
  // without re-rendering the whole app on each keystroke.
  const docHtmlRef = useRef('');
  const boxesRef = useRef<string | null>(null);

  // The document currently open in the editor (id + title drive persistence).
  const [activeDoc, setActiveDoc] = useState<StoredDocument | null>(null);
  const activeDocRef = useRef<StoredDocument | null>(null);
  const [recentDocs, setRecentDocs] = useState<StoredDocument[]>([]);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentDocs(loadRecentDocs());
  }, []);

  const recalc = useCallback(() => {
    const text = textOfHtml(docHtmlRef.current).replace(/\u00a0/g, ' ');
    setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0);
    setDocStatsState({
      characters: text.replace(/\n/g, '').length,
      sentences: (text.match(/[.!?]+(?=\s|$)/g) ?? []).length,
    });
  }, []);

  /**
   * Say so when the document cap pushes the oldest document off the list.
   *
   * The cap used to be entirely silent - the document simply vanished from the
   * home screen, while its version snapshots and its pictures stayed in storage
   * forever. Anything that costs the user a document now names it. The notice
   * does not time out, because "a bulletin was just removed" is not something to
   * read for five seconds and lose.
   */
  const reportEviction = useCallback(
    (evicted: StoredDocument[]) => {
      const [first] = evicted;
      if (!first) return;
      const extra = evicted.length > 1 ? ` and ${evicted.length - 1} more` : '';
      toast(`“${first.title}” was removed to stay within ${MAX_DOCS} documents${extra}.`, {
        kind: 'error',
        detail:
          'Documents live only in this browser. Save anything you still need as a .bulletin file before continuing.',
        timeout: 0,
      });
    },
    [toast],
  );

  /**
   * The complete saved record for the document that is open right now.
   *
   * Everything a document owns lives in a ref rather than in React state, so
   * persistence can read it without re-rendering on every keystroke - and that
   * is exactly how a document used to get saved *incomplete*. Opening a
   * template persisted a record built from a hand-written object literal naming
   * only id/title/content/page/template, so its master page - the running head
   * and the folio - was simply absent; the equivalent literal in `importFile`
   * also dropped `boxes` and `pageNames`. Nothing ever corrected it, because the
   * only code that wrote `master` at all was the debounced `persistNow`, and a
   * document that is merely *opened* schedules no save: reload before the first
   * edit and the furniture was gone for good.
   *
   * So the record is assembled here and nowhere else, from the refs, and every
   * path that creates or swaps in a document saves *this*. There is no longer a
   * second, shorter shape of record for a call site to get wrong.
   */
  const composeActiveDoc = useCallback((): StoredDocument | null => {
    const base = activeDocRef.current;
    if (!base) return null;
    const doc: StoredDocument = {
      ...base,
      content: docHtmlRef.current ?? '',
      updatedAt: Date.now(),
      // Written unconditionally: these used to be guarded by a truthiness
      // check, so switching the tombstone OFF - or clearing the running head -
      // left the old value on disk and it came straight back on reopen.
      tombstone: tombstoneRef.current,
      master: serializeMaster(masterRef.current),
    };
    if (boxesRef.current) doc.boxes = boxesRef.current;
    else delete doc.boxes;
    const names = pageNamesRef.current.filter((n) => n && n.trim());
    if (names.length) doc.pageNames = JSON.stringify(pageNamesRef.current);
    else delete doc.pageNames;
    return doc;
  }, []);

  /**
   * Save a document that has just been created or swapped in - *complete*.
   *
   * Call it after the refs hold the new document's content, frames, page names
   * and master; it reads them to build the record. This is what makes opening a
   * template, importing a `.bulletin`, finishing a merge or appending a sheet
   * durable in one step instead of waiting on a debounce that only an edit
   * would ever trigger.
   */
  const saveNewDoc = useCallback((): StoredDocument | null => {
    const doc = composeActiveDoc();
    if (!doc) return null;
    activeDocRef.current = doc;
    setActiveDoc(doc);
    const { docs, evicted } = saveDoc(doc);
    setRecentDocs(docs);
    if (evicted.length) reportEviction(evicted);
    return doc;
  }, [composeActiveDoc, reportEviction]);

  /**
   * Read the live editor HTML and write it to saved docs.
   *
   * Asynchronous only because of embedded media: pictures and imported PDF
   * pages are moved into IndexedDB, and the document must not be saved
   * referring to an asset that has not landed there yet - that is how a
   * quick save-then-reload lost its pictures. Documents with nothing embedded
   * resolve on the next microtask, so the debounce is unaffected.
   */
  const persistNow = useCallback(async () => {
    if (!activeDocRef.current) return;
    const offloaded = await offloadMediaForSave(boxesRef.current ?? undefined);
    if (offloaded) boxesRef.current = offloaded;
    const doc = composeActiveDoc();
    if (!doc) return;
    activeDocRef.current = doc;
    const { docs, evicted } = saveDoc(doc);
    if (evicted.length) reportEviction(evicted);
    // Automatic version snapshot (throttled by word-count drift in storage).
    const text = textOfHtml(doc.content);
    recordVersion(
      doc.id,
      doc.content,
      text.trim() ? text.trim().split(/\s+/).length : 0,
      boxesRef.current ?? undefined,
    );
    setRecentDocs(docs);
  }, [composeActiveDoc, reportEviction]);

  // Keep the tombstone + master refs in step so persistNow (stable, ref-based)
  // always writes the current values.
  useEffect(() => {
    tombstoneRef.current = tombstone;
  }, [tombstone]);
  useEffect(() => {
    pageNamesRef.current = pageNames;
  }, [pageNames]);
  /** Remember the page names the user gave, and save them with the document. */
  const handlePageNames = useCallback(
    (next: string[]) => {
      pageNamesRef.current = next;
      setPageNames(next);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(persistNow, 400);
    },
    [persistNow],
  );
  useEffect(() => {
    masterRef.current = master;
  }, [master]);

  /**
   * Flush a pending save before the page goes away.
   *
   * Persistence is debounced (400-600ms), and documents live *only* in this
   * browser's localStorage - there is no server copy to fall back on. Closing
   * the tab or reloading inside that window used to drop the last few
   * keystrokes silently. `pagehide` covers reloads, tab closes and bfcache
   * navigations; `visibilitychange` covers the mobile/desktop case where a
   * hidden tab is killed without either firing.
   */
  useEffect(() => {
    const flush = () => {
      if (!persistTimer.current) return;
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
      persistNow();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [persistNow]);

  /** Edit the master pages and save on a short debounce.
   *  `reseed` forces the on-page bands to re-render from state - set it when
   *  the panel (not the page) changed the text. Never set it while the user is
   *  typing on the sheet: re-seeding mid-keystroke would throw away the caret. */
  const applyMaster = useCallback(
    (patch: (m: MasterSet) => MasterSet, reseed = false) => {
      setMaster(patch);
      if (reseed) setMasterRev((r) => r + 1);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(persistNow, 400);
    },
    [persistNow],
  );

  /** The user typed into a band on the sheet (master-page view). */
  const handleMasterBandChange = useCallback(
    (masterId: string, key: BandKey, patch: { text: string }) => {
      const { side, slot } = splitBandKey(key);
      applyMaster((m) => withBand(m, masterId, side, slot, patch));
    },
    [applyMaster],
  );

  /** Which band the user last clicked, so the ribbon's Insert Page Number /
      Date / Time buttons know where to drop the token. */
  const handleMasterBandFocus = useCallback((key: BandKey) => {
    focusedBandRef.current = key;
  }, []);

  /** Ask the canvas to drop a field into the focused band, at the caret. */
  const handleInsertToken = useCallback((token: string) => {
    setMasterToken((r) => ({ token, tick: r.tick + 1 }));
  }, []);

  /** Publisher's Show Header/Footer, for the master being edited. */
  const toggleHeaderFooter = useCallback(() => {
    applyMaster(
      (m) => ({
        ...m,
        masters: m.masters.map((d) =>
          d.id === m.activeId ? { ...d, headerFooterVisible: d.headerFooterVisible === false } : d,
        ),
      }),
      true,
    );
  }, [applyMaster]);

  /** Open another master page for editing (the pane's master tiles). */
  const handleSelectMaster = useCallback(
    (id: string) => {
      applyMaster((m) => ({ ...m, activeId: id }), true);
    },
    [applyMaster],
  );

  /** Dress one page in a different master (the Pages pane's context menu). */
  const handleAssignMaster = useCallback(
    (pageIndex: number, id: string) => {
      applyMaster((m) => applyMasterTo(m, id, [pageIndex]), true);
    },
    [applyMaster],
  );

  /** Put the end-of-piece marker on the current page, or take it off. */
  const toggleTombstone = useCallback(() => {
    setTombstoneTick((t) => t + 1);
  }, []);

  /**
   * The canvas calls this on every change (typing, formatting, dragging,
   * adding/deleting a text box) with the flat HTML and the serialized boxes.
   */
  const handleDocChange = useCallback(
    (html: string, boxesJson: string) => {
      docHtmlRef.current = html;
      boxesRef.current = boxesJson;
      recalc();
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(persistNow, 600);
    },
    [recalc, persistNow],
  );

  const handleTitleChange = useCallback((t: string) => {
    setTitle(t);
    if (activeDocRef.current) activeDocRef.current = { ...activeDocRef.current, title: t };
  }, []);

  /** Open a template as a brand-new document. */
  const openTemplate = useCallback((tpl: Template) => {
    const now = Date.now();
    // Templates that ask for a text frame open as full-page frames carrying
    // the real column count, so the Columns toolbar and the gray column rule
    // agree with the thumbnail the user just clicked. Multi-sheet templates
    // (a full article) open every sheet at once.
    const boxesJson = templateBoxes(tpl);
    // Warm the Google Fonts cache before the canvas mounts - otherwise script
    // faces pop in a beat late and the first paint falls back to a default.
    preloadTemplateFonts(tpl.content);
    for (const sheet of tpl.sheets ?? []) preloadTemplateFonts(sheet.html);
    const doc: StoredDocument = {
      id: newDocId(),
      title: tpl.name,
      content: tpl.content,
      updatedAt: now,
      createdAt: now,
      page: 'A4',
      template: tpl.id,
      boxes: boxesJson ?? undefined,
    };
    activeDocRef.current = doc;
    setActiveDoc(doc);
    setTitle(doc.title);
    docHtmlRef.current = tpl.content;
    boxesRef.current = boxesJson;
    pageNamesRef.current = [];
    setPageNames([]);
    // A piece's end marker is a frame on the sheet now (see `templateBoxes`),
    // so the old document-level flag starts off for a fresh template.
    tombstoneRef.current = false;
    setTombstone(false);
    // A template's running head / folio seed the master page (the old
    // pre-master header/footer pair maps onto the default bands).
    const seeded = loadMaster(undefined, {
      masterHeader: tpl.master?.header,
      masterFooter: tpl.master?.footer,
    });
    masterRef.current = seeded;
    setMaster(seeded);
    setMasterOpen(false);
    // Templates are A4 portrait - without this the page-size chip in the
    // status bar kept whatever the previous document used.
    setPageName('A4');
    setLandscape(false);
    // Save the complete record, master page and all - not a stub that only
    // the next edit would fill in.
    saveNewDoc();
    setScreen('editor');
  }, [saveNewDoc]);

  /** Reopen a previously-saved document. */
  const openRecent = useCallback((doc: StoredDocument) => {
    const refreshed: StoredDocument = {
      ...doc,
      updatedAt: Date.now(),
      createdAt: doc.createdAt ?? Date.now(),
      page: doc.page ?? 'A4',
    };
    activeDocRef.current = refreshed;
    setActiveDoc(refreshed);
    setTitle(doc.title);
    setPageName(doc.page === 'Letter' ? 'Letter' : 'A4');
    docHtmlRef.current = doc.content ?? '';
    boxesRef.current = doc.boxes ?? null;
    const names = readPageNames(doc.pageNames);
    pageNamesRef.current = names;
    setPageNames(names);
    const legacyMarker = legacyTombstone(doc);
    tombstoneRef.current = legacyMarker;
    setTombstone(legacyMarker);
    const loaded = loadMaster(doc.master, {
      masterHeader: doc.masterHeader,
      masterFooter: doc.masterFooter,
    });
    masterRef.current = loaded;
    setMaster(loaded);
    setMasterOpen(false);
    saveNewDoc();
    setScreen('editor');
  }, [saveNewDoc]);

  const deleteRecent = useCallback(
    (id: string) => {
      const doc = recentDocs.find((d) => d.id === id);
      void confirm({
        title: doc ? `Delete “${doc.title}”?` : 'Delete this bulletin?',
        body: 'It is removed from this device along with its version history and any pictures or PDFs nothing else uses. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        // Deleting the document that is still open in memory has to drop the
        // in-memory copy too: it is the one `persistNow` (and the flush on
        // pagehide/visibilitychange) writes back, so a later save resurrected
        // the document that had just been deleted - it reappeared at the top
        // of the home screen with a fresh timestamp.
        if (activeDocRef.current?.id === id) {
          activeDocRef.current = null;
          setActiveDoc(null);
        }
        // `purgeDoc` also drops the document's snapshots and reclaims the media
        // nothing else uses; `deleteDoc` only removed the entry itself.
        void purgeDoc(id).then((list) => setRecentDocs(list));
      });
    },
    [confirm, recentDocs],
  );

  /**
   * Delete every saved document, from the home screen's "Delete all".
   *
   * The in-memory document is dropped first: it may still be holding an open
   * bulletin from earlier in the session, and its next save (or the unload
   * flush) would write that document straight back into the list that was just
   * emptied - which is exactly how a "deleted" probe document came back once.
   */
  const deleteAllRecents = useCallback(() => {
    if (!recentDocs.length) return;
    void confirm({
      title: `Delete all ${recentDocs.length} documents?`,
      body: 'Every bulletin saved in this browser is removed, together with its version history and any pictures or PDFs nothing else uses. This cannot be undone.',
      confirmLabel: 'Delete all',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      activeDocRef.current = null;
      setActiveDoc(null);
      void purgeAllDocs().then((list) => {
        setRecentDocs(list);
        toast('All documents deleted.', { kind: 'success' });
      });
    });
  }, [confirm, recentDocs.length, toast]);

  /** Rename a document straight from its card on the home screen. */
  const renameRecent = useCallback((id: string, next: string) => {
    setRecentDocs(renameDoc(id, next));
    if (activeDocRef.current?.id === id) {
      activeDocRef.current = { ...activeDocRef.current, title: next };
      setActiveDoc(activeDocRef.current);
      setTitle(next);
    }
  }, []);

  /**
   * Swap the current document's content (import, version restore…). The bump
   * tells the canvas to rebuild its text boxes from the new HTML.
   */
  const replaceDocContent = useCallback(
    (content: string, boxesJson: string | undefined) => {
      const base = activeDocRef.current;
      if (!base) return;
      docHtmlRef.current = content;
      boxesRef.current = boxesJson ?? null;
      const doc: StoredDocument = { ...base, content, updatedAt: Date.now() };
      if (boxesJson) doc.boxes = boxesJson;
      activeDocRef.current = doc;
      setActiveDoc(doc);
      setCanvasRev((r) => r + 1);
      // Save straight away. Swapping the content in (appending a template page,
      // restoring a version) used to rely on the canvas reporting the change
      // back through its debounced save - but the canvas only *renders* a swap,
      // and a layout pass that rewrites nothing never calls back, so the swap
      // could sit in memory until some later edit happened to flush it.
      void persistNow();
    },
    [persistNow],
  );

  /** Save and return to the home screen. */
  const goHome = useCallback(() => {
    persistNow();
    setRecentDocs(loadRecentDocs());
    setShowToolbar(true);
    setSearchOpen(false);
    setDialog(null);
    setMasterOpen(false);
    setVersionsOpen(false);
    setScreen('home');
  }, [persistNow]);

  /**
   * Add a page to the issue that is already open. Existing frames are kept -
   * the new page lands on a fresh sheet after the last one.
   */
  const appendTemplatePage = useCallback(
    (tpl: Template) => {
      const base = activeDocRef.current;
      if (!base) return;
      let list: Array<Record<string, unknown>> = [];
      if (boxesRef.current) {
        try {
          const parsed = JSON.parse(boxesRef.current);
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          list = [];
        }
      }
      // A document saved before the box model has none - split its HTML so
      // the pages already there survive alongside the new one.
      if (!list.length) {
        list = splitIntoBoxes(
          docHtmlRef.current,
          TEMPLATE_PAGE,
        ) as unknown as Array<Record<string, unknown>>;
      }
      const lastPage = list.reduce((max, b) => Math.max(max, Number(b.pageIndex ?? 0)), 0);
      const firstNewPage = lastPage + 1;
      const sheets = [tpl.content, ...(tpl.sheets ?? []).map((s) => s.html)];
      const extra = templateBoxes(tpl);
      if (extra) {
        const parsed = JSON.parse(extra) as Array<Record<string, unknown>>;
        parsed.forEach((b, i) => {
          list.push({
            ...b,
            id: `tpl-${Date.now().toString(36)}-${firstNewPage}-${i}`,
            pageIndex: firstNewPage + Number(b.pageIndex ?? 0),
          });
        });
      } else {
        // No frame model (puzzle, graphic, blank…) - split the page into the
        // same boxes the template opens with, so pictures stay image boxes.
        const split = splitIntoBoxes(tpl.content, TEMPLATE_PAGE);
        for (const b of split) {
          list.push({
            ...b,
            id: `tpl-${Date.now().toString(36)}-${firstNewPage}-${list.length}`,
            pageIndex: firstNewPage + Number(b.pageIndex ?? 0),
          });
        }
      }
      for (const html of sheets) preloadTemplateFonts(html);
      replaceDocContent(
        `${docHtmlRef.current}${sheets
          .map((h) => `<div style="page-break-after:always"></div>${h}`)
          .join('')}`,
        JSON.stringify(list),
      );
      recalc();
    },
    [replaceDocContent, recalc],
  );

  /**
   * `/guide`: pick a part of the issue and start editing it. With a document
   * already open the page is appended to that issue; otherwise it opens as a
   * new document.
   */
  const applyGuidePage = useCallback(
    (page: GuidePage) => {
      const tpl = page.templateId ? getTemplate(page.templateId) : undefined;
      if (!tpl) return;
      // An issue that is still loaded counts as "open" even when the user is
      // standing on the home screen (File ▸ Back to home screen keeps the
      // document loaded): the page belongs in that issue, and "Add to this
      // issue" is what the button says it will do.
      if (activeDocRef.current) appendTemplatePage(tpl);
      else openTemplate(tpl);
      navigate('/');
    },
    [appendTemplatePage, openTemplate],
  );

  /** Open the merged issue as a new document. */
  const handleMergeDone = useCallback((result: MergeResult) => {
    const now = Date.now();
    const doc: StoredDocument = {
      id: newDocId(),
      title: result.title,
      content: result.content,
      boxes: result.boxes,
      updatedAt: now,
      createdAt: now,
      page: 'A4',
      template: 'bulletin-contents',
    };
    activeDocRef.current = doc;
    setActiveDoc(doc);
    setTitle(doc.title);
    docHtmlRef.current = result.content;
    boxesRef.current = result.boxes;
    // A finished issue carries the end-of-document tombstone.
    tombstoneRef.current = true;
    setTombstone(true);
    const seeded = loadMaster(undefined, {
      masterHeader: 'Baulko Bulletin | n+●●',
      masterFooter: '@page |  @month @year',
    });
    masterRef.current = seeded;
    setMaster(seeded);
    setPageName('A4');
    setLandscape(false);
    saveNewDoc();
    setMergeFiles(null);
    setScreen('editor');
    navigate('/');
  }, [saveNewDoc]);

  /** Export the document in the proprietary `.bulletin` format. */
  const exportBulletin = useCallback(
    (nameOverride?: string) => {
      const name = (nameOverride ?? title) || 'Untitled bulletin';
      const doc: BulletinDoc = {
        format: 'bulletin',
        version: 1,
        title: name,
        content: docHtmlRef.current || '',
        page: pageName,
        createdAt: activeDocRef.current?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        template: activeDocRef.current?.template,
        boxes: boxesRef.current ?? undefined,
        tombstone: tombstoneRef.current || undefined,
        pageNames: pageNamesRef.current.filter((n) => n && n.trim()).length
          ? JSON.stringify(pageNamesRef.current)
          : undefined,
        master: serializeMaster(masterRef.current),
      };
      downloadBulletin(doc);
    },
    [title, pageName],
  );

  /** Import a `.bulletin` file and open it in the editor. */
  const importFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseBulletin(String(reader.result));
      if (!parsed) {
        toast("That doesn't look like a Bulletin file.", {
          kind: 'error',
          detail: 'Open a .bulletin or .json file saved from this app.',
        });
        return;
      }
      const doc: StoredDocument = {
        id: newDocId(),
        title: parsed.title,
        content: parsed.content,
        updatedAt: Date.now(),
        createdAt: parsed.createdAt,
        page: parsed.page,
        template: parsed.template,
      };
      activeDocRef.current = doc;
      setActiveDoc(doc);
      setTitle(doc.title);
      setPageName(doc.page === 'Letter' ? 'Letter' : 'A4');
      docHtmlRef.current = parsed.content ?? '';
      boxesRef.current = parsed.boxes ?? null;
      const names = readPageNames(parsed.pageNames);
      pageNamesRef.current = names;
      setPageNames(names);
      const legacyMarker = legacyTombstone(parsed);
      tombstoneRef.current = legacyMarker;
      setTombstone(legacyMarker);
      const loaded = loadMaster(parsed.master, {
        masterHeader: parsed.masterHeader,
        masterFooter: parsed.masterFooter,
      });
      masterRef.current = loaded;
      setMaster(loaded);
      setMasterOpen(false);
      // The imported file's frames, page names and master page all have to be
      // in the saved record - this is the one path where the literal used to
      // omit `boxes` too, so a reload lost the layout as well as the furniture.
      saveNewDoc();
      setScreen('editor');
    };
    reader.readAsText(file);
  }, [toast, saveNewDoc]);

  const pickImage = useCallback((onPick: (f: File) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) onPick(f);
    };
    input.click();
  }, []);

  /** Insert a picture as its own image box on the page - a picture is an
      object, never content inside a text frame. */
  const insertImageBox = useCallback(() => {
    pickImage((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(String(reader.result));
        setImageTick((t) => t + 1);
      };
      reader.readAsDataURL(f);
    });
  }, [pickImage]);

  const openFind = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => findRef.current?.focus(), 0);
  }, []);

  const runFind = useCallback((q: string) => {
    if (!q) {
      setFindStatus('');
      return;
    }
    const n = ed.findAndSelect(q);
    setFindStatus(n ? 'Match found' : 'No matches');
  }, []);

  /** Replace the current match, or all matches when `all` is set. */
  const runReplace = useCallback(
    (all: boolean) => {
      if (!findQuery) return;
      if (all) {
        const n = ed.replaceAll(findQuery, replaceWith);
        setFindStatus(n ? `Replaced ${n} occurrence${n === 1 ? '' : 's'}` : 'No matches');
        recalc();
        persistNow();
      } else {
        const el = ed.getEditor();
        if (el && ed.selectedText().toLowerCase() === findQuery.toLowerCase()) {
          ed.exec('insertText', replaceWith);
          recalc();
          persistNow();
        }
        runFind(findQuery);
      }
    },
    [findQuery, replaceWith, runFind, recalc, persistNow],
  );

  /* ---------------- menu actions ---------------- */

  const run = useCallback(
    (id: string) => {
      switch (id) {
        case 'file.new':
          goHome();
          break;
        case 'file.open': {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.bulletin,.json,application/json';
          input.onchange = () => {
            const f = input.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
              const parsed = parseBulletin(String(reader.result));
              if (!parsed) {
                toast("That doesn't look like a Bulletin file.", {
                  kind: 'error',
                  detail: 'Open a .bulletin or .json file saved from this app.',
                });
                return;
              }
              setTitle(parsed.title);
              setPageName(parsed.page === 'Letter' ? 'Letter' : 'A4');
              replaceDocContent(parsed.content, parsed.boxes);
              const imported = loadMaster(parsed.master, {
                masterHeader: parsed.masterHeader,
                masterFooter: parsed.masterFooter,
              });
              masterRef.current = imported;
              setMaster(imported);
              recalc();
              persistNow();
            };
            reader.readAsText(f);
          };
          input.click();
          break;
        }
        case 'file.copy':
          exportBulletin(`${title || 'Untitled bulletin'} (copy)`);
          break;
        case 'file.download.bulletin':
          exportBulletin();
          break;
        case 'file.download.html':
          if (docHtmlRef.current) downloadHtml(title || 'untitled', docHtmlRef.current);
          break;
        case 'file.download.txt':
          if (docHtmlRef.current) downloadText(title || 'untitled', docHtmlRef.current);
          break;
        case 'file.download.pdf':
          // There is no PDF library in the bundle and none is needed: the print
          // stylesheet already lays one sheet onto one printed page, so the
          // browser's own "Save as PDF" destination produces the file - with
          // the type still as type, because imported PDFs stay vector.
          toast('Choose “Save as PDF” as the destination to export a PDF.', { kind: 'info' });
          window.print();
          break;
        case 'file.trash': {
          const d = activeDocRef.current;
          if (!d) break;
          void confirm({
            title: `Move “${d.title}” to trash?`,
            body: 'This deletes the bulletin from this device, together with its version history and any pictures or PDFs nothing else uses. This cannot be undone.',
            confirmLabel: 'Move to trash',
            danger: true,
          }).then((ok) => {
            if (!ok) return;
            const gone = d.id;
            activeDocRef.current = null;
            setActiveDoc(null);
            goHome();
            // Delete the document, its version snapshots and any picture or
            // PDF blob nothing else still refers to.
            void purgeDoc(gone).then((list) => setRecentDocs(list));
          });
          break;
        }
        case 'file.versions':
          // Save first so the freshest snapshot is in the list, then open the
          // right-hand history panel - the panel reads the snapshots as it
          // mounts, so it has to wait for the save to finish.
          void persistNow().then(() => {
            setMasterOpen(false);
            setVersionsOpen(true);
          });
          break;
        case 'file.details':
          setDialog('details');
          break;
        case 'file.rename':
          titleRef.current?.focus();
          titleRef.current?.select();
          break;

        case 'file.page.A4':
          setPageName('A4');
          break;
        case 'file.page.Letter':
          setPageName('Letter');
          break;
        case 'file.orientation.portrait':
          setLandscape(false);
          break;
        case 'file.orientation.landscape':
          setLandscape(true);
          break;
        case 'file.print':
          window.print();
          break;
        case 'view.layers':
          setLayersOpen((o) => !o);
          setMenuTick((t) => t + 1);
          break;

        case 'order.front':
          arrangeBy('front');
          break;
        case 'order.forward':
          arrangeBy('forward');
          break;
        case 'order.backward':
          arrangeBy('backward');
          break;
        case 'order.back':
          arrangeBy('back');
          break;

        case 'file.home':
        case 'file.move.home':
          // File ▸ Move ▸ Back to home screen and the shortcut both land here:
          // the menu declaration and this handler used to disagree on the id,
          // so the menu item did nothing at all.
          goHome();
          break;

        case 'edit.undo': ed.history('undo'); break;
        case 'edit.redo': ed.history('redo'); break;
        case 'edit.cut': ed.exec('cut'); break;
        case 'edit.copy': ed.exec('copy'); break;
        case 'edit.paste':
          navigator.clipboard
            ?.readText()
            .then((t) => ed.exec('insertText', t))
            .catch(() => ed.exec('paste'));
          break;
        case 'edit.pastetext':
          navigator.clipboard
            ?.readText()
            .then((t) => ed.exec('insertText', t))
            .catch(() =>
              toast('Clipboard access was blocked by the browser.', {
                kind: 'error',
                detail: 'Paste with Ctrl+V instead, or allow clipboard access for this page.',
              }),
            );
          break;
        case 'edit.selectall': ed.exec('selectAll'); break;
        case 'edit.delete': ed.exec('delete'); break;
        case 'edit.find':
          openFind();
          break;

        case 'view.mode.editing': setViewMode('editing'); break;
        case 'view.mode.viewing': setViewMode('viewing'); break;
        case 'view.zoomin': setZoom((z) => Math.min(200, z + 10)); break;
        case 'view.zoomout': setZoom((z) => Math.max(50, z - 10)); break;
        case 'view.zoomreset': setZoom(100); break;
        case 'view.ruler': setShowRuler((r) => !r); break;
        case 'view.toolbar': setShowToolbar((t) => !t); break;
        case 'view.master':
          setVersionsOpen(false);
          setMasterOpen((o) => !o);
          break;
        case 'view.fullscreen':
          if (document.fullscreenElement) document.exitFullscreen();
          else document.documentElement.requestFullscreen?.();
          break;

        case 'insert.textbox': setTextboxTick((t) => t + 1); break;
        case 'insert.image':
          insertImageBox();
          break;
        case 'insert.link':
          setLinkRequest((n) => n + 1);
          break;
        case 'insert.rule': ed.exec('insertHorizontalRule'); break;
        case 'insert.shape':
          // A shape is an object on the page, not text: the canvas owns it.
          setShapeTick((t) => t + 1);
          break;
        case 'insert.line':
          setLineTick((t) => t + 1);
          break;
        case 'insert.pagebreak':
          // A page break belongs to the sheet model, not the text: the canvas
          // owns the pages, so it adds one (see DocumentCanvas).
          setPageTick((t) => t + 1);
          break;
        case 'insert.columnbreak':
          ed.exec('insertHTML', '<div style="break-after:column"></div><p><br></p>');
          break;
        case 'insert.date':
          ed.exec(
            'insertText',
            new Date().toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          );
          break;

        case 'format.bold': ed.exec('bold'); break;
        case 'format.italic': ed.exec('italic'); break;
        case 'format.underline': ed.exec('underline'); break;
        case 'format.strike': ed.exec('strikeThrough'); break;
        case 'format.sub': ed.exec('subscript'); break;
        case 'format.sup': ed.exec('superscript'); break;
        case 'format.size.inc': setSize((s) => Math.min(400, s + 1)); ed.applyInlineStyle('font-size', `${Math.min(400, size + 1)}pt`); break;
        case 'format.size.dec': setSize((s) => Math.max(6, s - 1)); ed.applyInlineStyle('font-size', `${Math.max(6, size - 1)}pt`); break;
        case 'format.caps.lower': ed.transformSelectionCase('lower'); break;
        case 'format.caps.upper': ed.transformSelectionCase('upper'); break;
        case 'format.caps.title': ed.transformSelectionCase('title'); break;
        case 'format.left': ed.exec('justifyLeft'); break;
        case 'format.center': ed.exec('justifyCenter'); break;
        case 'format.right': ed.exec('justifyRight'); break;
        case 'format.justify': ed.exec('justifyFull'); break;
        case 'format.indentinc': ed.exec('indent'); break;
        case 'format.indentdec': ed.exec('outdent'); break;
        case 'format.bullet': ed.exec('insertUnorderedList'); break;
        case 'format.number': ed.exec('insertOrderedList'); break;
        case 'format.quote': ed.formatBlock('blockquote'); break;
        case 'format.clear': ed.clearFormatting(); break;

        case 'tools.wordcount': setDialog('wordcount'); break;
        case 'tools.spellcheck': setSpellCheck((s) => !s); break;
        case 'tools.prefs.autocheck': setSpellCheck((s) => !s); break;
        case 'tools.prefs.tombstone':
        case 'format.tombstone':
        case 'insert.tombstone':
          // Insert ▸ Tombstone and Format ▸ Tombstone both toggle the marker on
          // the page the user is working on: add it, or take it off again.
          setTombstoneTick((t) => t + 1);
          break;
        case 'tools.dictionary': setDialog('dictionary'); break;

        case 'help.search': setDialog('search'); setMenuTick((t) => t + 1); break;
        case 'help.shortcuts': setDialog('shortcuts'); break;
        case 'help.guide': navigate('/guide'); break;
        case 'help.about': setDialog('about'); break;

        default: {
          // Dynamic ids: table grid, symbols, paragraph styles, language.
          const table = /^insert\.table\.(\d+)x(\d+)$/.exec(id);
          if (table) {
            // `insertTable` also steps the caret into the first cell: leaving it
            // in the paragraph *after* the table meant you inserted a grid,
            // typed, and watched the words land underneath it.
            ed.insertTable(Number(table[1]), Number(table[2]));
            break;
          }
          if (id.startsWith('insert.char.')) {
            ed.exec('insertText', id.slice('insert.char.'.length));
            break;
          }
          // Two routes onto the same block styles: the Text ▸ Styles submenu
          // sends `style.h1`…, and the Format menu lists Heading 1-4 as items
          // of their own (`format.h1`…). The Format ones matched nothing at
          // all - no case, no prefix - so those four menu items were dead.
          const styleMatch = /^(?:style|format)\.(.+)$/.exec(id);
          if (styleMatch) {
            const map: Record<string, { tag: string; label: string }> = {
              normal: { tag: 'p', label: 'Normal text' },
              title: { tag: 'h1', label: 'Title' },
              subtitle: { tag: 'h2', label: 'Subtitle' },
              h1: { tag: 'h1', label: 'Heading 1' },
              h2: { tag: 'h2', label: 'Heading 2' },
              h3: { tag: 'h3', label: 'Heading 3' },
              h4: { tag: 'h4', label: 'Heading 4' },
              h5: { tag: 'h5', label: 'Heading 5' },
              h6: { tag: 'h6', label: 'Heading 6' },
              quote: { tag: 'blockquote', label: 'Quote' },
            };
            const s = map[styleMatch[1]];
            if (s) {
              ed.formatBlock(s.tag);
              setStyle(s.label);
            }
            break;
          }
          const spacing = /^spacing\.([\d.]+)$/.exec(id);
          if (spacing) {
            ed.setLineHeight(Number(spacing[1]));
            break;
          }
          const columns = /^columns\.(\d)$/.exec(id);
          if (columns) {
            const count = Math.max(1, Math.min(3, Number(columns[1])));
            setColumnsRequest((r) => ({ count, tick: r.tick + 1 }));
            break;
          }
          break;
        }
      }
    },
    [exportBulletin, insertImageBox, pickImage, recalc, persistNow, replaceDocContent, title, goHome, openFind, size, toggleTombstone, navigate],
  );

  /* ---------------- keyboard shortcuts ---------------- */

  useEffect(() => {
    if (screen !== 'editor') return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (e.altKey && (k === '/' || e.code === 'Slash')) {
        e.preventDefault();
        setDialog('search');
        setMenuTick((t) => t + 1);
        return;
      }
      if (!mod) return;

      if (k === 's') {
        e.preventDefault();
        exportBulletin();
      } else if (k === 'p') {
        e.preventDefault();
        window.print();
      } else if (k === 'f' || (k === 'h' && !e.shiftKey)) {
        e.preventDefault();
        openFind();
      } else if (k === 'k') {
        e.preventDefault();
        setLinkRequest((n) => n + 1);
      } else if (k === '/') {
        e.preventDefault();
        setDialog('shortcuts');
      } else if (k === 'n') {
        e.preventDefault();
        run('file.new');
      } else if (k === 'o') {
        e.preventDefault();
        run('file.open');
      } else if (k === 'c' && e.shiftKey) {
        e.preventDefault();
        setDialog('wordcount');
      } else if (k === 'y' && e.shiftKey) {
        e.preventDefault();
        setDialog('dictionary');
      } else if ((k === 'z' || k === 'y') && !isTextField(e.target)) {
        // Undo / redo. The canvas keeps its own document history: a text frame
        // is an uncontrolled contentEditable, so the browser's native undo
        // stack is lost whenever a frame is re-seeded (and it cannot undo a
        // move, a column change or a deleted box at all). Shift+Z and Ctrl+Y
        // are the two conventions for redo.
        e.preventDefault();
        ed.history(k === 'y' || (k === 'z' && e.shiftKey) ? 'redo' : 'undo');
      } else if (k === ']' || k === '[') {
        // Format > Order: Ctrl+] / Ctrl+[ restack one layer at a time, and
        // Shift jumps the frame all the way to the front or the back. The
        // menu advertises these, so they have to reach the canvas.
        e.preventDefault();
        arrangeBy(k === ']' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward');
      } else if (k === 'l' && e.shiftKey) {
        // Advertised in the Format menu and shortcut list.
        e.preventDefault();
        ed.exec('justifyLeft');
      } else if (k === 'e' && e.shiftKey) {
        e.preventDefault();
        ed.exec('justifyCenter');
      } else if (k === 'r' && e.shiftKey) {
        e.preventDefault();
        ed.exec('justifyRight');
      } else if (k === 'j' && e.shiftKey) {
        e.preventDefault();
        ed.exec('justifyFull');
      } else if (k === 'v' && e.shiftKey) {
        e.preventDefault();
        navigator.clipboard
          ?.readText()
          .then((t) => ed.exec('insertText', t))
          .catch(() =>
            toast('Clipboard access was blocked by the browser.', {
              kind: 'error',
              detail: 'Paste with Ctrl+V instead, or allow clipboard access for this page.',
            }),
          );
      } else if (EDITING_KEYS.has(k) && !isTypingTarget(e.target)) {
        // Bold / italic / underline / undo / redo / clipboard are advertised in
        // the shortcut list, but the browser only honours them natively while
        // the caret is inside the editable surface. Click a toolbar button - or
        // any other control - and they silently did nothing. Route them to the
        // editor ourselves; let the native handling win inside an editable.
        e.preventDefault();
        switch (k) {
          case 'b': ed.exec('bold'); break;
          case 'i': ed.exec('italic'); break;
          case 'u': ed.exec('underline'); break;
          case 'z': ed.exec(e.shiftKey ? 'redo' : 'undo'); break;
          case 'y': ed.exec('redo'); break;
          case 'a': ed.exec('selectAll'); break;
          case 'x': ed.exec('cut'); break;
          case 'c': void copySelection(); break;
          case 'v': void pasteClipboard(); break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exportBulletin, run, openFind, screen, toast, confirm]);

  const page = useMemo(() => {
    const base = PAGE_SIZES[pageName];
    return landscape ? { width: base.height, height: base.width } : base;
  }, [pageName, landscape]);

  /**
   * How many sheets the open document spans.
   *
   * The canvas owns the frames, so this reads the last snapshot it handed back
   * (`boxesRef`), falling back to the saved copy. It is only used while the
   * master page is open - Apply To's page range, and the panel's summary of
   * which master dresses which pages - so a snapshot's lag is irrelevant.
   */
  const masterPageCount = useMemo(() => {
    const raw = boxesRef.current ?? activeDoc?.boxes ?? '';
    try {
      const parsed = JSON.parse(raw) as Array<{ pageIndex?: number }>;
      if (!Array.isArray(parsed) || !parsed.length) return 1;
      return Math.max(1, ...parsed.map((b) => (b.pageIndex ?? 0) + 1));
    } catch {
      return 1;
    }
    // recentDocs bumps on every save, which is when the snapshot is freshest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc, recentDocs]);

  const menuChecked = useMemo(
    () => ({
      'file.page.A4': pageName === 'A4',
      'file.page.Letter': pageName === 'Letter',
      'file.orientation.portrait': !landscape,
      'file.orientation.landscape': landscape,
      'view.mode.editing': viewMode === 'editing',
      'view.mode.viewing': viewMode === 'viewing',
      'view.ruler': showRuler,
      'view.toolbar': showToolbar,
      'tools.spellcheck': spellCheck,
      'tools.prefs.autocheck': spellCheck,
      'view.master': masterOpen,
      'view.layers': layersOpen,
    }),
    [pageName, landscape, docLang, viewMode, showRuler, showToolbar, spellCheck, masterOpen, layersOpen],
  );

  const stats = docStatsState;

  // Recompute the status-bar word count whenever a different document opens.
  useEffect(() => {
    recalc();
  }, [activeDoc, recalc]);

  return (
    <GoogleFontProvider>
      {path === '/guide' ? (
        <GuideScreen
          pages={GUIDE_PAGES}
          hasOpenDoc={!!activeDoc}
          onEdit={applyGuidePage}
          onBack={() => navigate('/')}
        />
      ) : screen === 'home' ? (
        <HomeScreen
          recentDocs={recentDocs}
          onOpenTemplate={openTemplate}
          onOpenRecent={openRecent}
          onDeleteRecent={deleteRecent}
          onDeleteAllRecents={deleteAllRecents}
          onRenameRecent={renameRecent}
          onImportFile={importFile}
          onMergeFiles={(files) => setMergeFiles(files)}
          onOpenGuide={() => navigate('/guide')}
        />
      ) : (
        <div className="flex h-full w-full flex-col bg-gdoc-bg font-ui text-[#2b2622]">
          {/* Match the printed paper to the selected page size + orientation:
              zero margins so the page sheets are full-bleed. */}
          <style>{`@page { size: ${((page.width / 96) * 25.4).toFixed(2)}mm ${(
            (page.height / 96) * 25.4
          ).toFixed(2)}mm; margin: 0; }`}</style>

          <MenuBar
            title={title}
            starred={starred}
            onTitleChange={handleTitleChange}
            onToggleStar={() => setStarred((s) => !s)}
            onRun={run}
            onHome={goHome}
            titleRef={titleRef}
            checked={menuChecked}
          />

          {showToolbar ? (
            <Toolbar
              font={font}
              size={size}
              style={style}
              spellCheck={spellCheck}
              searchOpen={searchOpen}
              setFont={setFont}
              setSize={setSize}
              setStyle={setStyle}
              setSpellCheck={setSpellCheck}
              setSearchOpen={setSearchOpen}
              onToggleToolbar={() => setShowToolbar(false)}
              onInsertImage={insertImageBox}
              onToggleMaster={() => setMasterOpen((o) => !o)}
              masterOpen={masterOpen}
              requestLink={linkRequest}
            />
          ) : (
            <button
              onClick={() => setShowToolbar(true)}
              className="no-print flex h-8 flex-none items-center justify-center gap-1 border-b border-gdoc-border bg-white text-[12px] text-gdoc-muted hover:bg-gdoc-hover"
            >
              <ChevronUp size={14} className="rotate-180" /> Show toolbar
            </button>
          )}

          {searchOpen && (
            <div className="no-print flex flex-none flex-wrap items-center gap-2 border-b border-gdoc-border bg-white px-3 py-1.5">
              <input
                ref={findRef}
                autoFocus
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runFind(findQuery);
                  if (e.key === 'Escape') setSearchOpen(false);
                }}
                placeholder="Find in document…"
                className="w-56 rounded border border-gdoc-border px-2 py-1 text-[13px] outline-none focus:border-bb-400"
              />
              <input
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runReplace(false);
                  if (e.key === 'Escape') setSearchOpen(false);
                }}
                placeholder="Replace with…"
                className="w-56 rounded border border-gdoc-border px-2 py-1 text-[13px] outline-none focus:border-bb-400"
              />
              <button
                onClick={() => runFind(findQuery)}
                className="rounded bg-bb-500 px-3 py-1 text-[12px] font-medium text-white hover:bg-bb-600"
              >
                Find
              </button>
              <button
                onClick={() => runReplace(false)}
                className="rounded border border-gdoc-border px-3 py-1 text-[12px] font-medium text-[#2b2622] hover:bg-gdoc-hover"
              >
                Replace
              </button>
              <button
                onClick={() => runReplace(true)}
                className="rounded border border-gdoc-border px-3 py-1 text-[12px] font-medium text-[#2b2622] hover:bg-gdoc-hover"
              >
                Replace all
              </button>
              <span className="text-[12px] text-gdoc-muted">{findStatus}</span>
              <button
                onClick={() => setSearchOpen(false)}
                className="ml-auto rounded p-1 text-gdoc-muted hover:bg-gdoc-hover"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Publisher's Master Pages ribbon - only while View > Master Page
              is on. Like Publisher's contextual tab it spans the whole window
              and sits above the panes, so the master list panel on the right
              can never squeeze it into the Close button. */}
          {masterOpen && viewMode === 'editing' && (
            <MasterSection
              set={master}
              onChange={applyMaster}
              onInsertToken={handleInsertToken}
              onClose={() => {
                setMasterOpen(false);
                focusedBandRef.current = 'rightHeader';
              }}
              onToggleHeaderFooter={toggleHeaderFooter}
              pageCount={masterPageCount}
            />
          )}

          <div className="flex min-h-0 w-full flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 min-w-0 flex-1">
              <DocumentCanvas
                key={activeDoc?.id ?? 'new'}
                zoom={zoom}
                spellCheck={spellCheck}
                showRuler={showRuler}
                page={page}
                content={activeDoc?.content ?? ''}
                boxes={activeDoc?.boxes}
                rev={canvasRev}
                textboxTick={textboxTick}
                imageTick={imageTick}
                imageSrc={imageSrc}
                shapeTick={shapeTick}
                lineTick={lineTick}
                tombstoneTick={tombstoneTick}
                pageNames={pageNames}
                onPageNamesChange={handlePageNames}
                onAssignMaster={handleAssignMaster}
                columnsTick={columnsRequest.tick}
                columnsCount={columnsRequest.count}
                pageTick={pageTick}
                onDocChange={handleDocChange}
                readOnly={viewMode === 'viewing'}
                tombstone={tombstone}
                master={master}
                masterMode={masterOpen && viewMode === 'editing'}
                masterRev={masterRev}
                docTitle={title}
                onMasterBandChange={handleMasterBandChange}
                onMasterBandFocus={handleMasterBandFocus}
                masterToken={masterToken}
                onSelectMaster={handleSelectMaster}
                onOpenMaster={() => setMasterOpen(true)}
                layersOpen={layersOpen}
                onCloseLayers={() => setLayersOpen(false)}
                arrange={arrange}
              />
              </div>
            </div>

            {versionsOpen && (
              <VersionPanel
                docId={activeDocRef.current?.id ?? ''}
                onClose={() => setVersionsOpen(false)}
                onRestore={(content, boxesJson) => {
                  replaceDocContent(content, boxesJson);
                  recalc();
                  persistNow();
                  setVersionsOpen(false);
                }}
              />
            )}

            {masterOpen && (
              <MasterPanel
                set={master}
                onChange={applyMaster}
                pageCount={masterPageCount}
                onSelectMaster={handleSelectMaster}
                onClose={() => setMasterOpen(false)}
              />
            )}
          </div>

          <div className="no-print flex flex-none items-center gap-3 border-t border-gdoc-border bg-white px-3 py-1.5 text-[11px] text-gdoc-muted">
            <FileText size={12} />
            <span>
              {pageName}
              {landscape ? ' · landscape' : ''}
            </span>
            <span>
              {page.width} × {page.height} px
            </span>
            {/* Zoom slider - the same control the home screen carries, so the
                sheet can be sized without leaving the document. */}
            <span className="flex items-center gap-1.5">
              <button
                onClick={() => setZoom((z) => Math.max(25, z - 10))}
                className="rounded p-0.5 hover:bg-gdoc-hover"
                title="Zoom out"
                aria-label="Zoom out"
              >
                <ZoomOut size={13} />
              </button>
              <input
                type="range"
                min={25}
                max={200}
                step={5}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="h-1 w-36 cursor-pointer accent-bb-500"
                aria-label="Zoom"
                title={`Zoom ${zoom}%`}
              />
              <button
                onClick={() => setZoom((z) => Math.min(200, z + 10))}
                className="rounded p-0.5 hover:bg-gdoc-hover"
                title="Zoom in"
                aria-label="Zoom in"
              >
                <ZoomIn size={13} />
              </button>
              <button
                onClick={() => setZoom(100)}
                className="w-10 tabular-nums hover:text-[#2b2622]"
                title="Reset zoom to 100%"
              >
                {zoom}%
              </button>
            </span>
            <span className="ml-auto">
              {wordCount.toLocaleString()} words · {style} · {font} {size}pt
            </span>
          </div>

          {dialog && (
            <Dialog onClose={() => setDialog(null)}>
              {dialog === 'about' && (
                <>
                  <h2 className="mb-2 text-[16px] font-semibold">About Bulletin Formatter</h2>
                  <p className="mb-3 text-[13px] leading-relaxed text-gdoc-muted">
                    A page-based editor for laying out the Baulko Bulletin - a Microsoft
                    Publisher replacement in the browser. Built with React, TypeScript,
                    Tailwind and Lucide icons. All 1,946 Google Fonts are available from
                    the font dropdown.
                  </p>
                  <p className="text-[12px] text-gdoc-muted">
                    Brand orange <span className="font-medium text-bb-600">#fe9c53</span>,
                    sampled from the bulletin logo.
                  </p>
                </>
              )}
              {dialog === 'shortcuts' && (
                <>
                  <h2 className="mb-3 text-[16px] font-semibold">Keyboard shortcuts</h2>
                  <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
                    {SHORTCUTS.map(([k, v]) => (
                      <div key={k} className="contents">
                        <code className="whitespace-nowrap rounded bg-gdoc-hover px-1.5 py-0.5 text-[11px] text-[#2b2622]">
                          {k}
                        </code>
                        <span className="text-gdoc-muted">{v}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {dialog === 'wordcount' && (
                <>
                  <h2 className="mb-3 text-[16px] font-semibold">Word count</h2>
                  <p className="text-[13px] text-gdoc-muted">
                    This document contains{' '}
                    <span className="font-semibold text-[#2b2622]">{wordCount.toLocaleString()}</span>{' '}
                    {wordCount === 1 ? 'word' : 'words'},{' '}
                    <span className="font-semibold text-[#2b2622]">{stats.characters.toLocaleString()}</span>{' '}
                    characters and about{' '}
                    <span className="font-semibold text-[#2b2622]">{stats.sentences.toLocaleString()}</span>{' '}
                    sentences.
                  </p>
                </>
              )}
              {dialog === 'search' && <MenuSearch onRun={run} tick={menuTick} />}
              {dialog === 'details' && (
                <Details
                  title={title}
                  doc={activeDoc}
                  pageName={pageName}
                  landscape={landscape}
                  docLang={docLang}
                  wordCount={wordCount}
                />
              )}
              {dialog === 'dictionary' && (
                <DictionaryDialog
                  selection={ed.selectedText()}
                  docLang={docLang}
                  onDocLang={(l) => {
                    ed.setDocLang(l);
                    setDocLang(l);
                  }}
                />
              )}
            </Dialog>
          )}
        </div>
      )}
      {mergeFiles && (
        <MergeDialog
          files={mergeFiles}
          onCancel={() => setMergeFiles(null)}
          onMerge={handleMergeDone}
        />
      )}
    </GoogleFontProvider>
  );
}

/* ---------- Help > Search the menus (Alt+/) ---------- */

function MenuSearch({ onRun, tick }: { onRun: (id: string) => void; tick: number }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [tick]);

  const entries = useMemo(() => menuSearchEntries(), []);
  const query = q.trim().toLowerCase();
  const matches = query
    ? entries.filter(
        (e) =>
          e.label.toLowerCase().includes(query) ||
          e.path.toLowerCase().includes(query) ||
          e.menu.toLowerCase().includes(query),
      )
    : entries.slice(0, 12);

  return (
    <>
      <h2 className="mb-3 text-[16px] font-semibold">Search the menus</h2>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((s) => Math.min(matches.length - 1, s + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === 'Enter' && matches[sel]) {
            onRun(matches[sel].id);
          }
        }}
        placeholder="Type a command… (e.g. “word count”)"
        className="mb-2 w-full rounded-md border border-gdoc-border px-3 py-2 text-[14px] outline-none focus:border-bb-400"
      />
      <div className="max-h-64 overflow-y-auto">
        {matches.slice(0, 30).map((m, i) => (
          <button
            key={m.id + m.path}
            onClick={() => onRun(m.id)}
            onMouseEnter={() => setSel(i)}
            className={`flex w-full items-center justify-between gap-3 rounded px-3 py-1.5 text-left text-[13px] ${
              i === sel ? 'bg-gdoc-hover' : ''
            }`}
          >
            <span className="truncate">{m.label}</span>
            <span className="flex-none text-[11px] text-gdoc-muted">{m.path}</span>
          </button>
        ))}
        {matches.length === 0 && (
          <div className="px-3 py-4 text-center text-[13px] text-gdoc-muted">No matching commands</div>
        )}
      </div>
    </>
  );
}

/* ---------- File > Version history (right-hand panel) ---------- */

function VersionPanel({
  docId,
  onClose,
  onRestore,
}: {
  docId: string;
  onClose: () => void;
  onRestore: (content: string, boxesJson: string | undefined) => void;
}) {
  const versions = useMemo(() => (docId ? getVersions(docId) : []), [docId]);
  // Newest snapshot first - the top row is the most recent save.
  const list = useMemo(() => [...versions].reverse(), [versions]);
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [docId]);
  const chosen = list[sel];

  const excerpt = useMemo(() => {
    if (!chosen) return '';
    const text = textOfHtml(chosen.content).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > 320 ? `${text.slice(0, 320)}…` : text;
  }, [chosen]);

  return (
    <aside className="no-print flex w-[350px] flex-none flex-col border-l border-gdoc-border bg-[#faf7f4]">
      <div className="flex flex-none items-center gap-2 border-b border-gdoc-border px-4 py-3">
        <History size={15} className="flex-none text-bb-600" />
        <h2 className="flex-1 text-[13px] font-semibold text-[#2b2622]">Version history</h2>
        <button
          onClick={onClose}
          title="Close version history"
          className="rounded p-1 text-gdoc-muted hover:bg-gdoc-hover"
        >
          <X size={16} />
        </button>
      </div>

      {list.length === 0 ? (
        <div className="flex-1 overflow-y-auto px-4 py-6 text-[13px] leading-relaxed text-gdoc-muted">
          No saved versions yet. Snapshots are taken automatically as this document grows or
          shrinks by about 15 words - keep editing and check back here.
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {list.map((v, i) => {
              const active = i === sel;
              return (
                <button
                  // `at` alone can repeat when two snapshots land in the same
                  // millisecond; the row index keeps the keys unique.
                  key={`${v.at}-${i}`}
                  onClick={() => setSel(i)}
                  className={`mb-1 flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-bb-500 bg-bb-500/10'
                      : 'border-gdoc-border bg-white hover:bg-gdoc-hover'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-[#2b2622]">
                      {new Date(v.at).toLocaleString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="block text-[11px] text-gdoc-muted">
                      {new Date(v.at).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {v.words ? `${v.words.toLocaleString()} words` : 'restored snapshot'}
                      {i === 0 ? ' · Latest' : ''}
                    </span>
                  </span>
                  <span
                    className={`h-2 w-2 flex-none rounded-full ${
                      active ? 'bg-bb-500' : 'border border-gdoc-border'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <div className="flex-none border-t border-gdoc-border px-4 py-3">
            {chosen && (
              <>
                <p
                  className={`mb-2 overflow-hidden text-[12px] leading-relaxed text-gdoc-muted ${
                    excerpt ? '' : 'italic'
                  }`}
                  style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}
                >
                  {excerpt || 'This version has no text on its pages.'}
                </p>
                <button
                  onClick={() => onRestore(chosen.content, chosen.boxes)}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-bb-500 px-3 py-2 text-[13px] font-medium text-white hover:bg-bb-600"
                >
                  <RotateCcw size={14} />
                  Restore this version
                </button>
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/* ---------- View > Master page (header & footer) ---------- */

/** The band variants the panel shows, given the master's shape. */
function activeKeys(m: MasterDef): BandKey[] {
  const keys: BandKey[] = ['rightHeader', 'rightFooter'];
  if (m.twoPage) keys.push('leftHeader', 'leftFooter');
  return keys;
}

function MasterPanel({
  set,
  onChange,
  pageCount,
  onSelectMaster,
  onClose,
}: {
  set: MasterSet;
  /** `reseed` re-renders the on-page bands - needed when the panel (not the
   *  page) is what changed the text, so the live band picks the edit up. */
  onChange: (patch: (m: MasterSet) => MasterSet, reseed?: boolean) => void;
  pageCount: number;
  onSelectMaster: (id: string) => void;
  onClose: () => void;
}) {
  const inputs = useRef<Partial<Record<BandKey, HTMLInputElement | null>>>({});
  const master = activeMaster(set);

  /** Drop a field token into a band at its caret. */
  const insertToken = (key: BandKey, token: string) => {
    const el = inputs.current[key];
    const { side, slot } = splitBandKey(key);
    const value = master[side][slot].text;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    const next = value.slice(0, at) + token + value.slice(end);
    onChange((m) => withBand(m, master.id, side, slot, { text: next }), true);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const setText = (key: BandKey, text: string) => {
    const { side, slot } = splitBandKey(key);
    onChange((m) => withBand(m, master.id, side, slot, { text }), true);
  };
  const setAlign = (key: BandKey, align: MasterAlign) => {
    const { side, slot } = splitBandKey(key);
    onChange((m) => withBand(m, master.id, side, slot, { align }));
  };

  /** Publisher's Show Header/Footer, for this master. */
  const setHeaderFooterVisible = (visible: boolean) =>
    onChange((m) => ({
      ...m,
      masters: m.masters.map((d) =>
        d.id === master.id ? { ...d, headerFooterVisible: visible } : d,
      ),
    }), true);

  const field =
    'w-full rounded-md border border-gdoc-border bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-bb-400';

  return (
    <aside className="no-print flex w-[350px] flex-none flex-col border-l border-gdoc-border bg-[#faf7f4]">
      <div className="flex flex-none items-center gap-2 border-b border-gdoc-border px-4 py-3">
        <LayoutTemplate size={15} className="flex-none text-bb-600" />
        <h2 className="flex-1 truncate text-[13px] font-semibold text-[#2b2622]">
          Master page {master.id} - {master.description}
        </h2>
        <button
          onClick={onClose}
          title="Close master page"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-gdoc-muted hover:bg-gdoc-hover"
        >
          <PanelRightClose size={14} />
          Close
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-3 text-[12px] leading-relaxed text-gdoc-muted">
          A <span className="font-medium text-[#2b2622]">master page</span> holds the running head
          and folio that print on the pages it dresses. Type straight into the dashed bands on the
          sheet - <span className="font-medium text-[#2b2622]">Tab</span> moves between the left,
          centre and right stops - or edit them below. Leave a band empty and it disappears.
        </p>

        {/* ---- which masters exist, and who each page uses ---- */}
        <div className="mb-4 rounded-md border border-gdoc-border bg-white px-3 py-2">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gdoc-muted">
            Master pages
          </h3>
          <div className="mb-2 flex flex-wrap gap-1">
            {set.masters.map((m) => (
              <button
                key={m.id}
                onClick={() => onSelectMaster(m.id)}
                title={m.description}
                className={`rounded border px-2 py-0.5 text-[11.5px] ${
                  m.id === master.id
                    ? 'border-bb-500 bg-bb-500/15 font-semibold text-bb-700'
                    : 'border-gdoc-border text-[#2b2622] hover:bg-gdoc-hover'
                }`}
              >
                {m.id} - {m.description}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-gdoc-muted">
            Applied: {assignmentSummary(set, pageCount)} · {pageCount} page{pageCount === 1 ? '' : 's'}
          </p>
          <Check
            label="Two-page master (facing spread)"
            checked={master.twoPage}
            onChange={(v) =>
              onChange((m) => ({
                ...m,
                masters: m.masters.map((d) =>
                  d.id === master.id ? { ...d, twoPage: v } : d,
                ),
              }))
            }
          />
          <Check
            label="Show Header/Footer"
            checked={master.headerFooterVisible !== false}
            onChange={setHeaderFooterVisible}
          />
        </div>

        {/* ---- one editor per band ---- */}
        {activeKeys(master).map((key) => {
          const { side, slot } = splitBandKey(key);
          const b: MasterBand = master[side][slot];
          return (
            <div key={key} className="mb-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gdoc-muted">
                  {BAND_LABELS[key]}
                </label>
                <div className="flex items-center gap-0.5">
                  {(
                    [
                      { a: 'left' as MasterAlign, Icon: AlignLeft, title: 'Align left' },
                      { a: 'center' as MasterAlign, Icon: AlignCenter, title: 'Align centre' },
                      { a: 'right' as MasterAlign, Icon: AlignRight, title: 'Align right' },
                    ]
                  ).map(({ a, Icon, title }) => (
                    <button
                      key={a}
                      title={`${title} (a band with a Tab stop is laid out on the stops instead)`}
                      onClick={() => setAlign(key, a)}
                      className={`grid h-6 w-6 place-items-center rounded ${
                        b.align === a
                          ? 'bg-bb-500 text-white'
                          : 'text-gdoc-muted hover:bg-gdoc-hover'
                      }`}
                    >
                      <Icon size={13} />
                    </button>
                  ))}
                </div>
              </div>

              <input
                ref={(el) => {
                  inputs.current[key] = el;
                }}
                value={b.text}
                onChange={(e) => setText(key, e.target.value)}
                spellCheck={false}
                placeholder={
                  slot === 'footer'
                    ? '@page |  @month @year'
                    : 'Baulko Bulletin | n+●●'
                }
                className={field}
              />

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {MASTER_TOKENS.map((t) => (
                  <button
                    key={t.token}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertToken(key, t.token)}
                    title={`Insert ${t.label.toLowerCase()} into the ${BAND_LABELS[key].toLowerCase()}`}
                    className="rounded-full border border-gdoc-border bg-white px-2 py-0.5 text-[10.5px] font-medium text-[#2b2622] hover:border-bb-400 hover:bg-bb-500/10"
                  >
                    {t.label} <span className="text-bb-600">{t.token}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <div className="rounded-md border border-gdoc-border bg-white px-3 py-2.5 text-[12px] leading-relaxed text-gdoc-muted">
          <span className="font-semibold text-[#2b2622]">Fields</span> resolve per page:{' '}
          <code className="rounded bg-gdoc-hover px-1 text-[11px]">@page</code> becomes each sheet’s
          number, <code className="rounded bg-gdoc-hover px-1 text-[11px]">@pages</code> the page
          count, <code className="rounded bg-gdoc-hover px-1 text-[11px]">@title</code> the document
          name. A <span className="font-semibold text-[#2b2622]">\\t</span> in a band (the Tab key on
          the sheet) starts a new stop: left, centre, right. A master is an independent page - the
          bands sit outside its frame and do not move when you drag a margin.
        </div>
      </div>
    </aside>
  );
}

/** Small labelled checkbox used by the master options block. */
function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-[12.5px] text-[#2b2622]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-bb-500"
      />
      {label}
    </label>
  );
}

/* ---------- File > Details ---------- */

function Details({
  title,
  doc,
  pageName,
  landscape,
  docLang,
  wordCount,
}: {
  title: string;
  doc: StoredDocument | null;
  pageName: string;
  landscape: boolean;
  docLang: string;
  wordCount: number;
}) {
  const rows: [string, string][] = [
    ['Name', title || 'Untitled bulletin'],
    ['Size', `${(new Blob([doc?.content ?? '']).size / 1024).toFixed(1)} KB`],
    ['Words', wordCount.toLocaleString()],
    ['Page', `${pageName}${landscape ? ' (landscape)' : ''}`],
    ['Language', docLang],
    ['Created', doc?.createdAt ? new Date(doc.createdAt).toLocaleString() : '-'],
    ['Modified', doc ? new Date(doc.updatedAt).toLocaleString() : '-'],
  ];
  return (
    <>
      <h2 className="mb-3 text-[16px] font-semibold">Document details</h2>
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="text-gdoc-muted">{k}</span>
            <span className="truncate font-medium text-[#2b2622]">{v}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- Tools > Dictionary ---------- */

/**
 * The dictionary is a plain link to Google's own dictionary search - no API
 * key, no account, nothing to host. Everything else in the app works offline
 * from the file on disk; this one button is honest about leaving the browser.
 */
function DictionaryDialog({
  selection,
  docLang,
  onDocLang,
}: {
  selection: string;
  docLang: string;
  onDocLang: (lang: string) => void;
}) {
  const [term, setTerm] = useState(selection);
  useEffect(() => setTerm(selection), [selection]);

  return (
    <>
      <h2 className="mb-3 text-[16px] font-semibold">Dictionary</h2>
      <p className="mb-2 text-[12px] text-gdoc-muted">
        Look a word up in Google's dictionary (select it in the document first, or type below).
        This opens a new browser tab - there is no dictionary service bundled with the app, and
        no account is needed. The rest of the app never leaves the page.
      </p>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Word to look up…"
        className="mb-2 w-full rounded-md border border-gdoc-border px-3 py-2 text-[14px] outline-none focus:border-bb-400"
      />
      <button
        onClick={() => {
          if (term.trim()) {
            window.open(
              `https://www.google.com/search?q=define+${encodeURIComponent(term.trim())}`,
              '_blank',
              'noopener',
            );
          }
        }}
        className="mb-3 w-full rounded bg-bb-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-bb-600"
      >
        Look up “{term.trim() || '…'}” on Google
      </button>
      <label className="mb-1 block text-[12px] text-gdoc-muted">Document language</label>
      <select
        value={docLang}
        onChange={(e) => onDocLang(e.target.value)}
        className="w-full rounded-md border border-gdoc-border px-2 py-1.5 text-[13px] outline-none focus:border-bb-400"
      >
        {[
          ['en-AU', 'English (Australia)'],
          ['en-US', 'English (United States)'],
          ['en-GB', 'English (United Kingdom)'],
          ['fr', 'Français'],
          ['de', 'Deutsch'],
          ['es', 'Español'],
          ['it', 'Italiano'],
          ['pt', 'Português'],
          ['nl', 'Nederlands'],
          ['ja', '日本語'],
          ['zh', '中文（简体）'],
          ['ko', '한국어'],
        ].map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </>
  );
}

function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div
      className="no-print fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        // Marked as a modal both for assistive technology and because the
        // canvas checks for it: without this, one Escape closed the dialog *and*
        // cleared the frame selection, and Backspace deleted a frame behind it.
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-bb-500 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-bb-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
