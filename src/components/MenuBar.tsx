import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Star,
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
} from 'lucide-react';

type MenuItem =
  | { id: string; label: string; icon: LucideIcon; shortcut?: string }
  | 'sep';

const MENUS: Record<string, MenuItem[]> = {
  File: [
    { id: 'file.new', label: 'New', icon: FilePlus, shortcut: 'Ctrl+N' },
    { id: 'file.open', label: 'Open…', icon: FolderOpen, shortcut: 'Ctrl+O' },
    'sep',
    { id: 'file.copy', label: 'Make a copy', icon: Copy },
    { id: 'file.download', label: 'Download as HTML', icon: Download },
    'sep',
    { id: 'file.pagesetup', label: 'Page setup: A4 / Letter', icon: Pencil },
    { id: 'file.print', label: 'Print', icon: Printer, shortcut: 'Ctrl+P' },
    'sep',
    { id: 'file.rename', label: 'Rename', icon: Pencil },
  ],
  Edit: [
    { id: 'edit.undo', label: 'Undo', icon: Undo2, shortcut: 'Ctrl+Z' },
    { id: 'edit.redo', label: 'Redo', icon: Redo2, shortcut: 'Ctrl+Y' },
    'sep',
    { id: 'edit.cut', label: 'Cut', icon: Scissors, shortcut: 'Ctrl+X' },
    { id: 'edit.copy', label: 'Copy', icon: ClipboardCopy, shortcut: 'Ctrl+C' },
    { id: 'edit.paste', label: 'Paste', icon: ClipboardPaste, shortcut: 'Ctrl+V' },
    'sep',
    { id: 'edit.find', label: 'Find and replace', icon: Search, shortcut: 'Ctrl+F' },
    { id: 'edit.selectall', label: 'Select all', icon: ClipboardCopy, shortcut: 'Ctrl+A' },
  ],
  View: [
    { id: 'view.zoomin', label: 'Zoom in', icon: ZoomIn },
    { id: 'view.zoomout', label: 'Zoom out', icon: ZoomOut },
    { id: 'view.zoomreset', label: 'Reset zoom to 100%', icon: Search },
    'sep',
    { id: 'view.ruler', label: 'Show ruler', icon: Ruler },
    { id: 'view.fullscreen', label: 'Full screen', icon: Maximize },
  ],
  Insert: [
    { id: 'insert.image', label: 'Image…', icon: ImageIcon },
    { id: 'insert.table', label: 'Table', icon: Table },
    { id: 'insert.rule', label: 'Horizontal line', icon: Minus },
    { id: 'insert.pagebreak', label: 'Page break', icon: ScissorsLineDashed },
    'sep',
    { id: 'insert.date', label: 'Today’s date', icon: Calendar },
  ],
  Format: [
    { id: 'format.bold', label: 'Bold', icon: Bold, shortcut: 'Ctrl+B' },
    { id: 'format.italic', label: 'Italic', icon: Italic, shortcut: 'Ctrl+I' },
    { id: 'format.underline', label: 'Underline', icon: Underline, shortcut: 'Ctrl+U' },
    { id: 'format.strike', label: 'Strikethrough', icon: Strikethrough },
    'sep',
    { id: 'format.left', label: 'Align left', icon: AlignLeft, shortcut: 'Ctrl+Shift+L' },
    { id: 'format.center', label: 'Align centre', icon: AlignCenter, shortcut: 'Ctrl+Shift+E' },
    { id: 'format.right', label: 'Align right', icon: AlignRight, shortcut: 'Ctrl+Shift+R' },
    { id: 'format.justify', label: 'Justify', icon: AlignJustify, shortcut: 'Ctrl+Shift+J' },
    'sep',
    { id: 'format.clear', label: 'Clear formatting', icon: Eraser, shortcut: 'Ctrl+\\' },
  ],
  Tools: [
    { id: 'tools.wordcount', label: 'Word count', icon: Hash, shortcut: 'Ctrl+Shift+C' },
    { id: 'tools.spellcheck', label: 'Toggle spellcheck', icon: SpellCheck },
  ],
  Help: [
    { id: 'help.shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, shortcut: 'Ctrl+/' },
    { id: 'help.about', label: 'About Bulletin Formatter', icon: Info },
  ],
};

const MENU_NAMES = Object.keys(MENUS);

interface MenuBarProps {
  title: string;
  starred: boolean;
  onTitleChange: (t: string) => void;
  onToggleStar: () => void;
  onRun: (id: string) => void;
  wordCount: number;
  titleRef: React.RefObject<HTMLInputElement>;
}

export default function MenuBar({
  title,
  starred,
  onTitleChange,
  onToggleStar,
  onRun,
  wordCount,
  titleRef,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, []);

  return (
    <div
      ref={barRef}
      className="no-print relative z-30 flex h-12 flex-shrink-0 items-center justify-between border-b border-gdoc-border bg-white px-3 font-ui"
    >
      <div className="flex items-center gap-3">
        <img
          src="/logo.webp"
          alt="Baulko Bulletin"
          className="h-9 w-9 flex-none rounded object-contain"
        />

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              ref={titleRef}
              className="w-[210px] rounded bg-transparent px-1 text-[15px] font-medium text-[#2b2622] outline-none hover:bg-gdoc-hover focus:bg-gdoc-hover"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
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

          {/* Each panel is positioned relative to its own trigger, so it always
              opens directly below the button that was clicked. */}
          <div className="flex items-center">
            {MENU_NAMES.map((name) => (
              <div key={name} className="relative">
                <button
                  onClick={() => setOpenMenu(openMenu === name ? null : name)}
                  onMouseEnter={() => {
                    // Once a menu is open, hovering another title switches to it.
                    if (openMenu && openMenu !== name) setOpenMenu(name);
                  }}
                  className={`flex items-center gap-0.5 rounded px-2 py-1 text-[13px] transition-colors hover:bg-gdoc-hover ${
                    openMenu === name ? 'bg-gdoc-active text-bb-700' : 'text-gdoc-muted'
                  }`}
                >
                  {name}
                  <ChevronDown size={12} className="opacity-60" />
                </button>

                {openMenu === name && (
                  <div className="dropdown absolute left-0 top-full z-40 mt-1 w-[270px] rounded-md border border-gdoc-border bg-white py-1 shadow-xl">
                    {MENUS[name].map((item, i) =>
                      item === 'sep' ? (
                        <div key={`sep-${i}`} className="my-1 border-t border-gdoc-border" />
                      ) : (
                        <button
                          key={item.id}
                          onClick={() => {
                            onRun(item.id);
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] text-[#2b2622] hover:bg-gdoc-hover"
                        >
                          <item.icon size={15} className="flex-none text-bb-600" />
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.shortcut && (
                            <span className="flex-none text-[11px] text-gdoc-muted">{item.shortcut}</span>
                          )}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Read-only status — not a button, so it can never be a dead control. */}
      <div className="flex items-center gap-3 text-[12px] text-gdoc-muted">
        <span>
          {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
        </span>
      </div>
    </div>
  );
}
