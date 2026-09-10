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
} from 'lucide-react';
import MenuBar, { menuSearchEntries } from './components/MenuBar';
import Toolbar from './components/Toolbar';
import DocumentCanvas from './components/DocumentCanvas';
import HomeScreen from './components/HomeScreen';
import { GoogleFontProvider, isGoogleFont, loadGoogleFont } from './components/GoogleFontProvider';
import MasterSection from './components/MasterSection';
import * as ed from './lib/editor';
import {
  BAND_LABELS,
  emptyMaster,
  loadMaster,
  serializeMaster,
  withBand,
  MASTER_TOKENS,
  type BandKey,
  type MasterAlign,
  type MasterBand,
  type MasterPage,
} from './lib/master';
import {
  loadRecentDocs,
  saveDoc,
  deleteDoc,
  newDocId,
  getVersions,
  recordVersion,
  type StoredDocument,
} from './lib/storage';
import { type Template } from './data/templates';
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
    the tail of `font-family` stacks — never useful to "load". */
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

/** A4 portrait with the app's default 96/80 margins — the canvas size every
    bulletin template is laid out for. */
const TEMPLATE_PAGE = { width: 794, height: 1123 };
const TEMPLATE_MARGIN_X = 96;
const TEMPLATE_MARGIN_Y = 80;

/** Wrap a template's HTML in a single full-content-area text box so the
    Columns toolbar reports the template's real column count and a
    `column-rule` is drawn between the columns. Stored as the document's
    `boxes` JSON; DocumentCanvas.buildModel honours it (multi-column frames
    bypass the "coarse single box → re-split" legacy path). */
export function templateFrameBoxes(html: string, columns: number): string {
  const box = {
    id: `tpl-${Date.now().toString(36)}`,
    pageIndex: 0,
    x: TEMPLATE_MARGIN_X,
    y: TEMPLATE_MARGIN_Y,
    w: TEMPLATE_PAGE.width - TEMPLATE_MARGIN_X * 2,
    h: TEMPLATE_PAGE.height - TEMPLATE_MARGIN_Y * 2,
    html,
    columns,
    nextId: null,
  };
  return JSON.stringify([box]);
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
    /* permission denied — let execCommand try */
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

type DialogKind = null | 'about' | 'shortcuts' | 'wordcount' | 'search' | 'details' | 'translate';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');

  const [title, setTitle] = useState('Untitled bulletin');
  const [starred, setStarred] = useState(false);

  const [font, setFont] = useState('Red Hat Text');
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
  /** View > Master page — the right-hand options panel *and* in-place editing
      of the header/footer bands on the sheet, the way Publisher does it. */
  const [masterOpen, setMasterOpen] = useState(false);
  /** The document's master page: running head + folio for every sheet. */
  const [master, setMaster] = useState<MasterPage>(() => emptyMaster());
  const masterRef = useRef<MasterPage>(master);
  /** Bumped only when the panel edits band text, to re-seed the on-page bands. */
  const [masterRev, setMasterRev] = useState(0);
  /** Band last focused on the sheet — target for the ribbon's Insert field. */
  const focusedBandRef = useRef<BandKey>('header');

  /** Version of the document content passed to the canvas (bump = reload). */
  const [canvasRev, setCanvasRev] = useState(0);
  /** Bumped by Insert > Text box to ask the canvas for a new text box. */
  const [textboxTick, setTextboxTick] = useState(0);
  const [imageTick, setImageTick] = useState(0);
  const [imageSrc, setImageSrc] = useState('');
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

  /** Read the live editor HTML and write it to saved docs. */
  const persistNow = useCallback(() => {
    if (!activeDocRef.current) return;
    const content = docHtmlRef.current ?? '';
    const doc: StoredDocument = {
      ...activeDocRef.current,
      content,
      updatedAt: Date.now(),
      // Written unconditionally: these used to be guarded by a truthiness
      // check, so switching the tombstone OFF — or clearing the running head —
      // left the old value on disk and it came straight back on reopen.
      tombstone: tombstoneRef.current,
      master: serializeMaster(masterRef.current),
    };
    if (boxesRef.current) doc.boxes = boxesRef.current;
    activeDocRef.current = doc;
    saveDoc(doc);
    // Automatic version snapshot (throttled by word-count drift in storage).
    const text = textOfHtml(content);
    recordVersion(
      doc.id,
      doc.content,
      text.trim() ? text.trim().split(/\s+/).length : 0,
      boxesRef.current ?? undefined,
    );
    setRecentDocs(loadRecentDocs());
  }, []);

  // Keep the tombstone + master refs in step so persistNow (stable, ref-based)
  // always writes the current values.
  useEffect(() => {
    tombstoneRef.current = tombstone;
  }, [tombstone]);
  useEffect(() => {
    masterRef.current = master;
  }, [master]);

  /** Edit the master page and save it on a short debounce.
   *  `reseed` forces the on-page bands to re-render from state — set it when
   *  the panel (not the page) changed the text. Never set it while the user is
   *  typing on the sheet: re-seeding mid-keystroke would throw away the caret. */
  const applyMaster = useCallback(
    (patch: (m: MasterPage) => MasterPage, reseed = false) => {
      setMaster(patch);
      if (reseed) setMasterRev((r) => r + 1);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(persistNow, 400);
    },
    [persistNow],
  );

  /** The user typed into a band on the sheet (master-page view). */
  const handleMasterBandChange = useCallback(
    (slot: BandKey, patch: { text: string }) => {
      applyMaster((m) => withBand(m, slot, patch));
    },
    [applyMaster],
  );

  /** Which band the user last clicked, so the Master Pages ribbon's Insert
      Page Number / Date / Time buttons know where to drop the token. */
  const handleMasterBandFocus = useCallback((slot: BandKey) => {
    focusedBandRef.current = slot;
  }, []);

  /** Append a field token to the focused band (or the header by default) and
      re-seed the band so the raw `@page` shows up on the sheet. */
  const handleInsertToken = useCallback(
    (token: string) => {
      const slot: BandKey = focusedBandRef.current ?? 'header';
      applyMaster((m) => withBand(m, slot, { text: `${m[slot].text}${token}` }), true);
    },
    [applyMaster],
  );

  const toggleHeaderFooter = useCallback(() => {
    applyMaster((m) => ({ ...m, bandsVisible: !(m.bandsVisible !== false) }), true);
  }, [applyMaster]);

  /** Toggle the end-of-document tombstone and save the flag immediately. */
  const toggleTombstone = useCallback(() => {
    const next = !tombstoneRef.current;
    tombstoneRef.current = next;
    setTombstone(next);
    persistNow();
  }, [persistNow]);

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
    // Multi-column templates open as one full-page frame carrying the real
    // column count, so the Columns toolbar and the column rule agree with the
    // thumbnail the user just clicked.
    const boxesJson = tpl.frame?.columns
      ? templateFrameBoxes(tpl.content, tpl.frame.columns)
      : null;
    // Warm the Google Fonts cache before the canvas mounts — otherwise script
    // faces pop in a beat late and the first paint falls back to a default.
    preloadTemplateFonts(tpl.content);
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
    // Templates are A4 portrait — without this the page-size chip in the
    // status bar kept whatever the previous document used.
    setPageName('A4');
    setLandscape(false);
    setRecentDocs(saveDoc(doc));
    setScreen('editor');
  }, []);

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
    tombstoneRef.current = doc.tombstone ?? false;
    setTombstone(doc.tombstone ?? false);
    const loaded = loadMaster(doc.master, {
      masterHeader: doc.masterHeader,
      masterFooter: doc.masterFooter,
    });
    masterRef.current = loaded;
    setMaster(loaded);
    setMasterOpen(false);
    setRecentDocs(saveDoc(refreshed));
    setScreen('editor');
  }, []);

  const deleteRecent = useCallback((id: string) => {
    setRecentDocs(deleteDoc(id));
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
    },
    [],
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
        window.alert("That doesn't look like a Bulletin file.");
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
      tombstoneRef.current = parsed.tombstone ?? false;
      setTombstone(parsed.tombstone ?? false);
      const loaded = loadMaster(parsed.master, {
        masterHeader: parsed.masterHeader,
        masterFooter: parsed.masterFooter,
      });
      masterRef.current = loaded;
      setMaster(loaded);
      setMasterOpen(false);
      setRecentDocs(saveDoc(doc));
      setScreen('editor');
    };
    reader.readAsText(file);
  }, []);

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

  /** Insert a picture as its own image box on the page — a picture is an
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
                window.alert("That doesn't look like a Bulletin file.");
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
        case 'file.share.copylink':
          navigator.clipboard
            ?.writeText(`${location.origin}${location.pathname}#doc=${activeDocRef.current?.id ?? ''}`)
            .then(() => setFindStatus('Link copied'))
            .catch(() => window.alert('Could not access the clipboard.'));
          setTimeout(() => setFindStatus(''), 2000);
          break;
        case 'file.share.mailto':
          window.open(
            `mailto:?subject=${encodeURIComponent(title || 'Untitled bulletin')}&body=${encodeURIComponent(
              'Opening a bulletin requires the .bulletin file — use File > Download to attach it.',
            )}`,
          );
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
        case 'file.trash': {
          const d = activeDocRef.current;
          if (d && window.confirm(`Move “${d.title}” to trash? This deletes it from this device.`)) {
            setRecentDocs(deleteDoc(d.id));
            activeDocRef.current = null;
            setActiveDoc(null);
            goHome();
          }
          break;
        }
        case 'file.versions':
          // Save first so the freshest snapshot is in the list, then open the
          // right-hand history panel.
          persistNow();
          setMasterOpen(false);
          setVersionsOpen(true);
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
        case 'file.home':
          goHome();
          break;

        case 'edit.undo': ed.exec('undo'); break;
        case 'edit.redo': ed.exec('redo'); break;
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
            .catch(() => window.alert('Clipboard access was blocked by the browser.'));
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
        case 'insert.pagebreak':
          ed.exec('insertHTML', '<div style="page-break-after:always"></div><p><br></p>');
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
          toggleTombstone();
          break;
        case 'tools.dictionary': setDialog('translate'); break;
        case 'tools.translate': setDialog('translate'); break;

        case 'help.search': setDialog('search'); setMenuTick((t) => t + 1); break;
        case 'help.shortcuts': setDialog('shortcuts'); break;
        case 'help.about': setDialog('about'); break;

        default: {
          // Dynamic ids: table grid, symbols, paragraph styles, language.
          const table = /^insert\.table\.(\d+)x(\d+)$/.exec(id);
          if (table) {
            const rows = Math.min(20, Number(table[1]));
            const cols = Math.min(20, Number(table[2]));
            ed.exec(
              'insertHTML',
              '<table style="border-collapse:collapse;width:100%"><tbody>' +
                Array.from({ length: rows })
                  .map(
                    () =>
                      '<tr>' +
                      Array.from({ length: cols })
                        .map(() => '<td style="border:1px solid #d6cfc4;padding:8px">&nbsp;</td>')
                        .join('') +
                      '</tr>',
                  )
                  .join('') +
                '</tbody></table><p><br></p>',
            );
            break;
          }
          if (id.startsWith('insert.char.')) {
            ed.exec('insertText', id.slice('insert.char.'.length));
            break;
          }
          const styleMatch = /^style\.(.+)$/.exec(id);
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
            ed.setColumnCount(Number(columns[1]));
            break;
          }
          break;
        }
      }
    },
    [exportBulletin, insertImageBox, pickImage, recalc, persistNow, replaceDocContent, title, goHome, openFind, size, toggleTombstone],
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
        setDialog('translate');
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
          .catch(() => window.alert('Clipboard access was blocked by the browser.'));
      } else if (EDITING_KEYS.has(k) && !isTypingTarget(e.target)) {
        // Bold / italic / underline / undo / redo / clipboard are advertised in
        // the shortcut list, but the browser only honours them natively while
        // the caret is inside the editable surface. Click a toolbar button — or
        // any other control — and they silently did nothing. Route them to the
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
  }, [exportBulletin, run, openFind, screen]);

  const page = useMemo(() => {
    const base = PAGE_SIZES[pageName];
    return landscape ? { width: base.height, height: base.width } : base;
  }, [pageName, landscape]);

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
      'tools.prefs.tombstone': tombstone,
      'view.master': masterOpen,
    }),
    [pageName, landscape, docLang, viewMode, showRuler, showToolbar, spellCheck, tombstone, masterOpen],
  );

  const stats = docStatsState;

  // Recompute the status-bar word count whenever a different document opens.
  useEffect(() => {
    recalc();
  }, [activeDoc, recalc]);

  return (
    <GoogleFontProvider>
      {screen === 'home' ? (
        <HomeScreen
          recentDocs={recentDocs}
          onOpenTemplate={openTemplate}
          onOpenRecent={openRecent}
          onDeleteRecent={deleteRecent}
          onImportFile={importFile}
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
              zoom={zoom}
              spellCheck={spellCheck}
              searchOpen={searchOpen}
              setFont={setFont}
              setSize={setSize}
              setStyle={setStyle}
              setZoom={setZoom}
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

          <div className="flex min-h-0 w-full flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Publisher's Master Pages ribbon — only while View > Master
                  Page is on, and it sits above the sheet it edits. */}
              {masterOpen && viewMode === 'editing' && (
                <MasterSection
                  master={master}
                  onChange={applyMaster}
                  onInsertToken={handleInsertToken}
                  onClose={() => {
                    setMasterOpen(false);
                    focusedBandRef.current = 'header';
                  }}
                  headerFooterVisible={master.bandsVisible !== false}
                  onToggleHeaderFooter={toggleHeaderFooter}
                />
              )}
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
                onDocChange={handleDocChange}
                readOnly={viewMode === 'viewing'}
                tombstone={tombstone}
                master={master}
                masterMode={masterOpen && viewMode === 'editing'}
                masterRev={masterRev}
                docTitle={title}
                onMasterBandChange={handleMasterBandChange}
                onMasterBandFocus={handleMasterBandFocus}
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
                master={master}
                onChange={applyMaster}
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
            <span>Zoom {zoom}%</span>
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
                    A page-based editor for laying out the Baulko Bulletin — a Microsoft
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
              {dialog === 'translate' && (
                <TranslateDialog
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
  // Newest snapshot first — the top row is the most recent save.
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
          shrinks by about 15 words — keep editing and check back here.
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {list.map((v, i) => {
              const active = i === sel;
              return (
                <button
                  key={v.at}
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

/** The band variants the panel shows, given the master's options. */
function activeSlots(m: MasterPage): BandKey[] {
  const slots: BandKey[] = ['header', 'footer'];
  if (m.differentFirstPage) slots.push('firstHeader', 'firstFooter');
  if (m.differentOddEven) slots.push('evenHeader', 'evenFooter');
  return slots;
}

function MasterPanel({
  master,
  onChange,
  onClose,
}: {
  master: MasterPage;
  /** `reseed` re-renders the on-page bands — needed when the panel (not the
   *  page) is what changed the text, so the live band picks the edit up. */
  onChange: (patch: (m: MasterPage) => MasterPage, reseed?: boolean) => void;
  onClose: () => void;
}) {
  const inputs = useRef<Partial<Record<BandKey, HTMLInputElement | null>>>({});

  /** Drop a field token into a band at its caret. */
  const insertToken = (slot: BandKey, token: string) => {
    const el = inputs.current[slot];
    const value = master[slot].text;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    const next = value.slice(0, at) + token + value.slice(end);
    onChange((m) => withBand(m, slot, { text: next }), true);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const setText = (slot: BandKey, text: string) =>
    onChange((m) => withBand(m, slot, { text }), true);
  const setAlign = (slot: BandKey, align: MasterAlign) =>
    onChange((m) => withBand(m, slot, { align }));

  const field =
    'w-full rounded-md border border-gdoc-border bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-bb-400';

  return (
    <aside className="no-print flex w-[350px] flex-none flex-col border-l border-gdoc-border bg-[#faf7f4]">
      <div className="flex flex-none items-center gap-2 border-b border-gdoc-border px-4 py-3">
        <LayoutTemplate size={15} className="flex-none text-bb-600" />
        <h2 className="flex-1 text-[13px] font-semibold text-[#2b2622]">Master page</h2>
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
          The <span className="font-medium text-[#2b2622]">master</span> holds the running head and
          folio that print on every page. Type straight into the dashed bands on the sheet, or edit
          them below. Leave a band empty and it disappears.
        </p>

        {/* ---- options (Publisher's Header & Footer design tab) ---- */}
        <div className="mb-4 rounded-md border border-gdoc-border bg-white px-3 py-2">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gdoc-muted">
            Options
          </h3>
          <Check
            label="Different first page"
            checked={master.differentFirstPage}
            onChange={(v) => onChange((m) => ({ ...m, differentFirstPage: v }))}
          />
          <Check
            label="Different odd & even pages"
            checked={master.differentOddEven}
            onChange={(v) => onChange((m) => ({ ...m, differentOddEven: v }))}
          />
          <Check
            label="Show on first page"
            checked={master.showOnFirstPage}
            onChange={(v) => onChange((m) => ({ ...m, showOnFirstPage: v }))}
          />
        </div>

        {/* ---- one editor per band variant ---- */}
        {activeSlots(master).map((slot) => {
          const b = master[slot] as MasterBand;
          return (
            <div key={slot} className="mb-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-gdoc-muted">
                  {BAND_LABELS[slot]}
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
                      title={title}
                      onClick={() => setAlign(slot, a)}
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
                  inputs.current[slot] = el;
                }}
                value={b.text}
                onChange={(e) => setText(slot, e.target.value)}
                spellCheck={false}
                placeholder={slot.startsWith('footer') || slot === 'footer' ? '@page |  @month @year' : 'Baulko Bulletin | n+●●'}
                className={field}
              />

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {MASTER_TOKENS.map((t) => (
                  <button
                    key={t.token}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertToken(slot, t.token)}
                    title={`Insert ${t.label.toLowerCase()} into the ${BAND_LABELS[slot].toLowerCase()}`}
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
          count. The bands sit inside the page margins, so dragging a margin moves them too.
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
    ['Created', doc?.createdAt ? new Date(doc.createdAt).toLocaleString() : '—'],
    ['Modified', doc ? new Date(doc.updatedAt).toLocaleString() : '—'],
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

/* ---------- Tools > Dictionary / Translate document ---------- */

function TranslateDialog({
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
        Look up a word online (select it in the document first, or type below), or set the
        document language used for spellcheck.
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
        Look up “{term.trim() || '…'}”
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
