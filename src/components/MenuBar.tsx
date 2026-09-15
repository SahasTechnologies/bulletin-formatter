import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Star,
  BookOpen,
  FilePlus,
  FolderOpen,
  Copy,
  Download,
  Printer,
  Pencil,
  Undo2,
  Redo2,
  Scissors,
  ClipboardCopy,
  ClipboardPaste,
  Search,
  ZoomIn,
  ZoomOut,
  Ruler,
  Maximize,
  Image as ImageIcon,
  Minus,
  Table,
  Calendar,
  ScissorsLineDashed,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Eraser,
  Hash,
  SpellCheck,
  Keyboard,
  Info,
  ChevronDown,
  ChevronRight,
  Check,
  FileText,
  FileType,
  FileCode,
  History,
  Eye,
  Columns3,
  LayoutTemplate,
  MoveVertical,
  Link2,
  Sigma,
  Type as TypeIcon,
  Pilcrow,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  Rows3,
  CaseSensitive,
  Baseline,
  ALargeSmall,
  Subscript,
  Superscript,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  TextQuote,
  Menu as MenuIcon,
  Trash2,
  Info as InfoIcon,
  Square,
  Layers,
} from 'lucide-react';

export interface MenuSearchEntry {
  menu: string;
  label: string;
  path: string; // e.g. "Insert > Table"
  id: string;
}

type MenuItem =
  | {
      id: string;
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      check?: boolean;
      gridPicker?: boolean;
      /** Opens the character grid instead of firing `id` on click. */
      charPanel?: SymSection[];
    }
  | { label: string; icon?: LucideIcon; sub: MenuItem[] }
  | 'sep';

/** One titled block of the Insert ▸ Symbols & emoji grid. */
export interface SymSection {
  title: string;
  chars: { ch: string; name: string }[];
}

const sym = (pairs: [string, string][]): { ch: string; name: string }[] =>
  pairs.map(([ch, name]) => ({ ch, name }));

/**
 * The symbol/emoji palette. This is one flat, scrollable grid rather than
 * four nested submenus: a submenu rendered inside a scrolling submenu is
 * clipped by that parent's overflow box (which is exactly why the old
 * "Symbols & emoji" fly-out vanished the moment you moved onto it).
 */
const SYM_SECTIONS: SymSection[] = [
  {
    title: 'Emoji',
    chars: sym([
      ['😀', 'Grinning face'], ['😂', 'Face with tears of joy'], ['🙂', 'Slightly smiling face'],
      ['😉', 'Winking face'], ['😍', 'Smiling face with heart-eyes'], ['🤔', 'Thinking face'],
      ['😎', 'Smiling face with sunglasses'], ['🥳', 'Partying face'], ['😴', 'Sleeping face'],
      ['🤩', 'Star-struck'], ['👍', 'Thumbs up'], ['👎', 'Thumbs down'],
      ['👏', 'Clapping hands'], ['🙌', 'Raising hands'], ['🤝', 'Handshake'],
      ['✌️', 'Victory hand'], ['💪', 'Flexed biceps'], ['🫶', 'Heart hands'],
      ['🙏', 'Folded hands'], ['🤞', 'Crossed fingers'], ['❤️', 'Red heart'],
      ['🧡', 'Orange heart'], ['💛', 'Yellow heart'], ['💚', 'Green heart'],
      ['💙', 'Blue heart'], ['💜', 'Purple heart'], ['🔥', 'Fire'],
      ['✨', 'Sparkles'], ['⭐', 'Star'], ['💯', 'Hundred points'],
    ]),
  },
  {
    title: 'Maths',
    chars: sym([
      ['±', 'Plus-minus'], ['×', 'Multiplication sign'], ['÷', 'Division sign'],
      ['≠', 'Not equal to'], ['≈', 'Approximately equal'], ['≤', 'Less than or equal'],
      ['≥', 'Greater than or equal'], ['∞', 'Infinity'], ['∑', 'Summation'],
      ['∏', 'Product'], ['√', 'Square root'], ['∫', 'Integral'],
      ['∂', 'Partial differential'], ['π', 'Pi'], ['µ', 'Micro sign'],
      ['Ω', 'Omega'], ['°', 'Degree sign'], ['′', 'Prime'],
      ['″', 'Double prime'], ['∅', 'Empty set'],
    ]),
  },
  {
    title: 'Arrows',
    chars: sym([
      ['←', 'Left arrow'], ['→', 'Right arrow'], ['↑', 'Up arrow'],
      ['↓', 'Down arrow'], ['↔', 'Left-right arrow'], ['↕', 'Up-down arrow'],
      ['⇐', 'Double left arrow'], ['⇒', 'Double right arrow'], ['⇔', 'Double left-right arrow'],
      ['➔', 'Heavy right arrow'], ['➜', 'Round-tipped right arrow'], ['↺', 'Anticlockwise arrow'],
      ['↻', 'Clockwise arrow'], ['⤴', 'Arrow curving up'], ['⤵', 'Arrow curving down'],
    ]),
  },
  {
    title: 'Miscellaneous',
    chars: sym([
      ['©', 'Copyright'], ['®', 'Registered'], ['™', 'Trademark'],
      ['§', 'Section sign'], ['¶', 'Pilcrow'], ['†', 'Dagger'],
      ['‡', 'Double dagger'], ['•', 'Bullet'], ['‰', 'Per mille'],
      ['№', 'Numero sign'], ['☀', 'Sun'], ['☁', 'Cloud'],
      ['☂', 'Umbrella'], ['★', 'Filled star'], ['☆', 'Hollow star'],
      ['☐', 'Ballot box'], ['☑', 'Checked box'], ['✓', 'Check mark'],
      ['✗', 'Ballot cross'],
    ]),
  },
];

const MENUS: Record<string, MenuItem[]> = {
  File: [
    { id: 'file.new', label: 'New', icon: FilePlus, shortcut: 'Ctrl+N' },
    { id: 'file.open', label: 'Open…', icon: FolderOpen, shortcut: 'Ctrl+O' },
    'sep',
    { id: 'file.copy', label: 'Make a copy', icon: Copy },
    // A bulletin is a self-contained file on this device - there is nothing to
    // "share" and no server to hand a link to, so the File menu offers the one
    // honest verb: Download.
    { id: 'file.download', label: 'Download', icon: Download, sub: [
      { id: 'file.download.bulletin', label: 'Bulletin (.bulletin)', icon: Download },
      { id: 'file.download.html', label: 'Web page (.html)', icon: FileCode },
      { id: 'file.download.txt', label: 'Plain text (.txt)', icon: FileType },
    ] },
    'sep',
    { id: 'file.rename', label: 'Rename', icon: Pencil },
    { id: 'file.move', label: 'Move', icon: MoveVertical, sub: [
      { id: 'file.move.home', label: 'Back to home screen', icon: FileText },
    ] },
    'sep',
    { id: 'file.trash', label: 'Move to trash', icon: Trash2, shortcut: 'Ctrl+Shift+Backspace' },
    { id: 'file.versions', label: 'Version history', icon: History },
    { id: 'file.details', label: 'Details', icon: InfoIcon },
    'sep',
    { id: 'file.pagesetup', label: 'Page setup', icon: Pencil, sub: [
      { id: 'file.page.A4', label: 'Paper: A4 (210 × 297 mm)', icon: LayoutTemplate, check: true },
      { id: 'file.page.Letter', label: 'Paper: Letter (8.5 × 11 in)', icon: LayoutTemplate, check: true },
      'sep',
      { id: 'file.orientation.portrait', label: 'Orientation: Portrait', icon: FileText, check: true },
      { id: 'file.orientation.landscape', label: 'Orientation: Landscape', icon: FileText, check: true },
    ] },
    { id: 'file.print', label: 'Print', icon: Printer, shortcut: 'Ctrl+P' },
  ],
  Edit: [
    { id: 'edit.undo', label: 'Undo', icon: Undo2, shortcut: 'Ctrl+Z' },
    { id: 'edit.redo', label: 'Redo', icon: Redo2, shortcut: 'Ctrl+Y' },
    'sep',
    { id: 'edit.cut', label: 'Cut', icon: Scissors, shortcut: 'Ctrl+X' },
    { id: 'edit.copy', label: 'Copy', icon: ClipboardCopy, shortcut: 'Ctrl+C' },
    { id: 'edit.paste', label: 'Paste', icon: ClipboardPaste, shortcut: 'Ctrl+V' },
    { id: 'edit.pastetext', label: 'Paste without formatting', icon: ClipboardCopy, shortcut: 'Ctrl+Shift+V' },
    'sep',
    { id: 'edit.selectall', label: 'Select all', icon: ClipboardCopy, shortcut: 'Ctrl+A' },
    { id: 'edit.delete', label: 'Delete', icon: Minus, shortcut: 'Del' },
    { id: 'edit.find', label: 'Find and replace', icon: Search, shortcut: 'Ctrl+H' },
  ],
  View: [
    { id: 'view.mode.editing', label: 'Editing', icon: Pencil, check: true },
    { id: 'view.mode.viewing', label: 'Viewing', icon: Eye, check: true },
    'sep',
    { id: 'view.zoomin', label: 'Zoom in', icon: ZoomIn },
    { id: 'view.zoomout', label: 'Zoom out', icon: ZoomOut },
    { id: 'view.zoomreset', label: 'Reset zoom to 100%', icon: Search },
    'sep',
    { id: 'view.ruler', label: 'Show ruler', icon: Ruler, check: true },
    { id: 'view.toolbar', label: 'Show toolbar', icon: MenuIcon, check: true },
    'sep',
    { id: 'view.master', label: 'Master page…', icon: LayoutTemplate, check: true },
    { id: 'view.layers', label: 'Layers panel', icon: Layers, check: true },
    { id: 'view.fullscreen', label: 'Full screen', icon: Maximize },
  ],
  Insert: [
    { id: 'insert.textbox', label: 'Text box', icon: TypeIcon },
    { id: 'insert.image', label: 'Image…', icon: ImageIcon },
    { id: 'insert.table', label: 'Table', icon: Table, gridPicker: true },
    { id: 'insert.symbol', label: 'Symbols & emoji', icon: Sigma, charPanel: SYM_SECTIONS },
    { id: 'insert.link', label: 'Link', icon: Link2, shortcut: 'Ctrl+K' },
    'sep',
    // Shapes and lines are page *objects* (like a picture): they move, resize
    // and recolour on their own. Horizontal line, by contrast, drops a rule
    // into the text at the caret.
    { id: 'insert.shape', label: 'Shape', icon: Square },
    { id: 'insert.line', label: 'Line', icon: Minus },
    { id: 'insert.rule', label: 'Horizontal line in text', icon: Minus },
    // The end-of-piece marker is an object too: it is placed (never dragged)
    // and it always paints above the page content.
    { id: 'insert.tombstone', label: 'Tombstone', icon: Square },
    { id: 'insert.pagebreak', label: 'Break', icon: ScissorsLineDashed, sub: [
      { id: 'insert.pagebreak', label: 'Page break', icon: ScissorsLineDashed },
      { id: 'insert.columnbreak', label: 'Column break', icon: Columns3 },
    ] },
    'sep',
    { id: 'insert.date', label: 'Today’s date', icon: Calendar },
  ],
  Format: [
    { label: 'Text', icon: TypeIcon, sub: [
      { id: 'format.bold', label: 'Bold', icon: Bold, shortcut: 'Ctrl+B' },
      { id: 'format.italic', label: 'Italic', icon: Italic, shortcut: 'Ctrl+I' },
      { id: 'format.underline', label: 'Underline', icon: Underline, shortcut: 'Ctrl+U' },
      { id: 'format.strike', label: 'Strikethrough', icon: Strikethrough },
      { id: 'format.sub', label: 'Subscript', icon: Subscript },
      { id: 'format.sup', label: 'Superscript', icon: Superscript },
      'sep',
      { label: 'Size', icon: ALargeSmall, sub: [
        { id: 'format.size.inc', label: 'Increase font size', icon: ZoomIn },
        { id: 'format.size.dec', label: 'Decrease font size', icon: ZoomOut },
      ] },
      { label: 'Capitalisation', icon: CaseSensitive, sub: [
        { id: 'format.caps.lower', label: 'lowercase' },
        { id: 'format.caps.upper', label: 'UPPERCASE' },
        { id: 'format.caps.title', label: 'Title Case' },
      ] },
    ] },
    { label: 'Paragraph styles', icon: Pilcrow, sub: [
      { id: 'style.normal', label: 'Normal text' },
      { id: 'style.title', label: 'Title' },
      { id: 'style.subtitle', label: 'Subtitle' },
      { id: 'style.h1', label: 'Heading 1' },
      { id: 'style.h2', label: 'Heading 2' },
      { id: 'style.h3', label: 'Heading 3' },
      { id: 'style.h4', label: 'Heading 4' },
      { id: 'style.h5', label: 'Heading 5' },
      { id: 'style.h6', label: 'Heading 6' },
      'sep',
      { id: 'style.quote', label: 'Quote', icon: TextQuote },
    ] },
    { label: 'Align & indent', icon: AlignLeft, sub: [
      { id: 'format.left', label: 'Align left', icon: AlignLeft, shortcut: 'Ctrl+Shift+L' },
      { id: 'format.center', label: 'Align centre', icon: AlignCenter, shortcut: 'Ctrl+Shift+E' },
      { id: 'format.right', label: 'Align right', icon: AlignRight, shortcut: 'Ctrl+Shift+R' },
      { id: 'format.justify', label: 'Justify', icon: AlignJustify, shortcut: 'Ctrl+Shift+J' },
      'sep',
      { id: 'format.indentinc', label: 'Increase indent', icon: IndentIncrease },
      { id: 'format.indentdec', label: 'Decrease indent', icon: IndentDecrease },
    ] },
    { label: 'Line & paragraph spacing', icon: Rows3, sub: [
      { id: 'spacing.1', label: 'Single' },
      { id: 'spacing.1.15', label: '1.15' },
      { id: 'spacing.1.5', label: '1.5' },
      { id: 'spacing.2', label: 'Double' },
      { id: 'spacing.3', label: 'Triple' },
    ] },
    { id: 'format.columns', label: 'Columns', icon: Columns3, sub: [
      { id: 'columns.1', label: 'One column', icon: Columns3 },
      { id: 'columns.2', label: 'Two columns', icon: Columns3 },
      { id: 'columns.3', label: 'Three columns', icon: Columns3 },
    ] },
    { label: 'Bullets & numbering', icon: List, sub: [
      { id: 'format.bullet', label: 'Bulleted list', icon: List },
      { id: 'format.number', label: 'Numbered list', icon: ListOrdered },
      'sep',
      { id: 'format.indentdec', label: 'Decrease indent', icon: IndentDecrease },
      { id: 'format.indentinc', label: 'Increase indent', icon: IndentIncrease },
    ] },
    'sep',
    { id: 'format.h1', label: 'Heading 1', icon: Heading1 },
    { id: 'format.h2', label: 'Heading 2', icon: Heading2 },
    { id: 'format.h3', label: 'Heading 3', icon: Heading3 },
    { id: 'format.h4', label: 'Heading 4', icon: Heading4 },
    { id: 'format.quote', label: 'Quote', icon: TextQuote },
    'sep',
    { label: 'Order', icon: Layers, sub: [
      { id: 'order.front', label: 'Bring to front', shortcut: 'Ctrl+Shift+]' },
      { id: 'order.forward', label: 'Bring forward', shortcut: 'Ctrl+]' },
      { id: 'order.backward', label: 'Send backward', shortcut: 'Ctrl+[' },
      { id: 'order.back', label: 'Send to back', shortcut: 'Ctrl+Shift+[' },
    ] },
    'sep',
    { id: 'format.tombstone', label: 'Tombstone (end of a piece)', icon: Square },
    { id: 'format.clear', label: 'Clear formatting', icon: Eraser, shortcut: 'Ctrl+\\' },
  ],
  Tools: [
    { id: 'tools.spellcheck', label: 'Spelling and grammar', icon: SpellCheck, check: true },
    { id: 'tools.wordcount', label: 'Word count', icon: Hash, shortcut: 'Ctrl+Shift+C' },
    { id: 'tools.dictionary', label: 'Dictionary (online lookup)', icon: Baseline, shortcut: 'Ctrl+Shift+Y' },
    'sep',
    { id: 'tools.preferences', label: 'Preferences', icon: Pencil, sub: [
      { id: 'tools.prefs.autocheck', label: 'Automatic spellcheck', icon: SpellCheck, check: true },
      { id: 'tools.prefs.tombstone', label: 'End-of-piece marker (tombstone) on this page', icon: Square },
    ] },
  ],
  Help: [
    { id: 'help.search', label: 'Search the menus', icon: Search, shortcut: 'Alt+/' },
    { id: 'help.shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, shortcut: 'Ctrl+/' },
    'sep',
    // The guide is where a page gets finished, so it is reachable from inside
    // the document - not only from the home screen - and the finished page can
    // be saved and sent to the Formatter Master from its last step.
    { id: 'help.guide', label: 'Design guide', icon: BookOpen },
    { id: 'help.about', label: 'About Bulletin Formatter', icon: Info },
  ],
};

/** Flatten the menu tree for “Search the menus” (Alt+/). */
export function menuSearchEntries(): MenuSearchEntry[] {
  const out: MenuSearchEntry[] = [];
  const walk = (items: MenuItem[], menu: string, prefix: string) => {
    for (const item of items) {
      if (item === 'sep') continue;
      const path = prefix ? `${prefix} > ${item.label}` : `${menu} > ${item.label}`;
      if ('sub' in item) walk(item.sub, menu, path);
      else if ('id' in item)
        out.push({ menu, label: item.label, path, id: item.gridPicker ? 'insert.table.3x3' : item.id });
    }
  };
  for (const [name, items] of Object.entries(MENUS)) walk(items, name, '');
  return out;
}

const MENU_NAMES = Object.keys(MENUS);

interface MenuBarProps {
  title: string;
  starred: boolean;
  onTitleChange: (t: string) => void;
  onToggleStar: () => void;
  onRun: (id: string) => void;
  onHome: () => void;
  titleRef: React.RefObject<HTMLInputElement>;
  /** Currently-checked ids (toggles), e.g. view.ruler, file.page.A4. */
  checked: Record<string, boolean>;
  /** Ids that should render greyed out (e.g. when no document is open). */
  disabled?: Record<string, boolean>;
}

export default function MenuBar({
  title,
  starred,
  onTitleChange,
  onToggleStar,
  onRun,
  onHome,
  titleRef,
  checked,
  disabled,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string[]>([]); // submenu key path
  const [grid, setGrid] = useState(false); // table grid picker
  const [gridSize, setGridSize] = useState({ r: 0, c: 0 });
  const [symbols, setSymbols] = useState(false); // symbols & emoji palette
  const barRef = useRef<HTMLDivElement>(null);
  /**
   * Hover intent for fly-out submenus.
   *
   * Closing a submenu the instant the pointer leaves its row makes the menu
   * feel broken: crossing the 2px gap to the fly-out (or drifting a pixel
   * down onto the next row) made the whole submenu disappear. So leaving a
   * row only *schedules* the close; re-entering the row or its fly-out
   * cancels it.
   */
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = (key: string) => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpenPath((p) => p.filter((k) => !k.startsWith(key)));
    }, 260);
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) {
        setOpenMenu(null);
        setOpenPath([]);
        setGrid(false);
        setSymbols(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setOpenPath([]);
        setGrid(false);
        setSymbols(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, []);

  useEffect(() => cancelClose, []);

  const closeAll = () => {
    cancelClose();
    setOpenMenu(null);
    setOpenPath([]);
    setGrid(false);
    setSymbols(false);
  };

  const fire = (id: string) => {
    closeAll();
    onRun(id);
  };

  /** Recursive item renderer; `depth` keys submenu open-state. */
  const renderItems = (items: MenuItem[], menu: string, depth: number, keyPrefix: string) => (
    <>
      {items.map((item, i) => {
        if (item === 'sep') return <div key={`sep-${keyPrefix}-${i}`} className="my-1 border-t border-gdoc-border" />;

        if ('sub' in item && 'label' in item) {
          const key = `${keyPrefix}/${item.label}`;
          const open = openPath.includes(key);
          return (
            <div
              key={key}
              className="relative"
              onMouseEnter={cancelClose}
              onMouseLeave={() => scheduleClose(key)}
            >
              <button
                onClick={() => {
                  cancelClose();
                  setOpenPath(open ? openPath.filter((k) => k !== key) : [...openPath, key]);
                }}
                onMouseEnter={() => {
                  cancelClose();
                  if (!open) setOpenPath([...openPath.filter((k) => !k.startsWith(keyPrefix)), key]);
                }}
                className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] text-[#2b2622] hover:bg-gdoc-hover"
              >
                {item.icon ? <item.icon size={15} className="flex-none text-bb-600" /> : <span className="w-[15px] flex-none" />}
                <span className="flex-1 truncate">{item.label}</span>
                <ChevronRight size={13} className="flex-none text-gdoc-muted" />
              </button>
              {open && (
                // No max-height / overflow here: a scrolling fly-out would clip
                // its own nested fly-outs (see SYM_SECTIONS).
                <div
                  className="dropdown absolute left-full top-0 z-50 ml-0.5 w-[240px] rounded-md border border-gdoc-border bg-white py-1 shadow-xl"
                  onMouseEnter={cancelClose}
                >
                  {renderItems(item.sub, menu, depth + 1, key)}
                </div>
              )}
            </div>
          );
        }

        // Leaf action item.
        const isCheck = 'check' in item && item.check;
        const isDisabled = disabled?.[item.id];
        const opensGrid = 'gridPicker' in item && item.gridPicker;
        const opensSymbols = 'charPanel' in item && !!item.charPanel;
        return (
          <button
            key={item.id}
            disabled={isDisabled}
            onClick={() => (opensGrid ? setGrid(true) : opensSymbols ? setSymbols(true) : fire(item.id))}
            className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] ${
              isDisabled ? 'cursor-not-allowed text-gdoc-muted/50' : 'text-[#2b2622] hover:bg-gdoc-hover'
            }`}
          >
            {isCheck ? (
              <span className={`w-[15px] flex-none ${checked[item.id] ? 'text-bb-600' : 'text-transparent'}`}>
                <Check size={15} strokeWidth={3} />
              </span>
            ) : item.icon ? (
              <item.icon size={15} className="flex-none text-bb-600" />
            ) : (
              <span className="w-[15px] flex-none" />
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {'shortcut' in item && item.shortcut && (
              <span className="flex-none text-[11px] text-gdoc-muted">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </>
  );

  return (
    <div
      ref={barRef}
      className="no-print relative z-40 flex h-12 flex-shrink-0 items-center justify-between bg-white px-3 font-ui"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onHome}
          title="Back to home"
          className="flex-none rounded hover:bg-gdoc-hover"
        >
          <img
            src="/logo.webp"
            alt="Baulko Bulletin"
            className="block h-9 w-9 rounded-full object-contain"
          />
        </button>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              ref={titleRef}
              className="w-[210px] rounded bg-transparent px-1 text-[15px] font-medium text-[#2b2622] outline-none hover:bg-gdoc-hover focus:bg-gdoc-hover"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={(e) => {
                // Enter just sets the name and drops focus - no dialog, no
                // confirm step. Escape does the same (the value on screen is
                // already the name).
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              spellCheck={false}
              aria-label="Document title"
            />
            <button
              onClick={onToggleStar}
              className="rounded-full p-1 text-gdoc-muted hover:bg-gdoc-hover"
              title={starred ? 'Remove star' : 'Add star'}
            >
              <Star size={16} fill={starred ? '#fe9c53' : 'none'} stroke={starred ? '#fe9c53' : 'currentColor'} />
            </button>
          </div>

          <div className="flex items-center">
            {MENU_NAMES.map((name) => (
              <div key={name} className="relative">
                <button
                  onClick={() => {
                    setOpenMenu(openMenu === name ? null : name);
                    setOpenPath([]);
                    setGrid(false);
                    setSymbols(false);
                  }}
                  onMouseEnter={() => {
                    if (openMenu && openMenu !== name) {
                      setOpenMenu(name);
                      setOpenPath([]);
                      setSymbols(false);
                    }
                  }}
                  className={`flex items-center gap-0.5 rounded px-2 py-1 text-[13px] transition-colors hover:bg-gdoc-hover ${
                    openMenu === name ? 'bg-gdoc-active text-bb-700' : 'text-gdoc-muted'
                  }`}
                >
                  {name}
                  <ChevronDown size={12} className="opacity-60" />
                </button>

                {openMenu === name && (
                  <div className="dropdown absolute left-0 top-full z-40 mt-1 w-[280px] rounded-md border border-gdoc-border bg-white py-1 shadow-xl">
                    {name === 'Insert' && grid ? (
                      <TableGrid
                        onPick={(r, c) => {
                          setGrid(false);
                          closeAll();
                          onRun(`insert.table.${r}x${c}`);
                        }}
                        onCancel={() => setGrid(false)}
                        size={gridSize}
                        setSize={setGridSize}
                      />
                    ) : name === 'Insert' && symbols ? (
                      <SymbolPanel
                        sections={SYM_SECTIONS}
                        onPick={(ch) => fire(`insert.char.${ch}`)}
                        onCancel={() => setSymbols(false)}
                      />
                    ) : (
                      renderItems(MENUS[name], name, 0, name)
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- table grid picker (Insert > Table) ---------- */

function TableGrid({
  onPick,
  onCancel,
  size,
  setSize,
}: {
  onPick: (rows: number, cols: number) => void;
  onCancel: () => void;
  size: { r: number; c: number };
  setSize: (s: { r: number; c: number }) => void;
}) {
  const ROWS = 8;
  const COLS = 8;
  return (
    <div className="p-3" onMouseDown={(e) => e.stopPropagation()}>
      <button
        onClick={onCancel}
        className="mb-2 flex items-center gap-2 text-[13px] text-gdoc-muted hover:text-[#2b2622]"
      >
        <ChevronRight size={13} className="rotate-180" /> Table
      </button>
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${COLS}, 18px)` }}
        onMouseLeave={() => setSize({ r: 0, c: 0 })}
      >
        {Array.from({ length: ROWS * COLS }, (_, i) => {
          const r = Math.floor(i / COLS) + 1;
          const c = (i % COLS) + 1;
          const active = r <= size.r && c <= size.c;
          return (
            <button
              key={i}
              onMouseEnter={() => setSize({ r, c })}
              onClick={() => onPick(r, c)}
              className={`h-[18px] w-[18px] border ${active ? 'border-bb-500 bg-bb-100' : 'border-gdoc-border bg-white'}`}
            />
          );
        })}
      </div>
      <div className="mt-2 text-[12px] text-gdoc-muted">
        {size.r > 0 && size.c > 0 ? `${size.r} × ${size.c} table` : 'Hover to choose a size'}
      </div>
    </div>
  );
}

/* ---------- symbols & emoji palette (Insert > Symbols & emoji) ---------- */

/**
 * A flat, scrollable palette of glyphs - every entry shows its own character
 * as the "icon", so nothing in the menu is a blank slot. Kept to one level
 * deep (no fly-outs) so it can scroll without clipping anything.
 */
function SymbolPanel({
  sections,
  onPick,
  onCancel,
}: {
  sections: SymSection[];
  onPick: (ch: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-3" onMouseDown={(e) => e.stopPropagation()}>
      <button
        onClick={onCancel}
        className="mb-2 flex items-center gap-2 text-[13px] text-gdoc-muted hover:text-[#2b2622]"
      >
        <ChevronRight size={13} className="rotate-180" /> Symbols &amp; emoji
      </button>
      <div className="max-h-[380px] overflow-y-auto pr-1">
        {sections.map((section) => (
          <div key={section.title} className="mb-3 last:mb-0">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gdoc-muted">
              {section.title}
            </div>
            <div className="grid grid-cols-8 gap-[2px]">
              {section.chars.map(({ ch, name }) => (
                <button
                  key={ch}
                  title={name}
                  aria-label={name}
                  onClick={() => onPick(ch)}
                  className="grid h-[26px] w-[26px] place-items-center rounded text-[17px] leading-none text-[#2b2622] hover:bg-gdoc-hover"
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
