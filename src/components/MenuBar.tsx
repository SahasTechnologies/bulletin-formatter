import { useEffect, useState } from 'react';
import {
  Star,
  MessageSquareText,
  Lock,
  Share2,
  ChevronDown,
} from 'lucide-react';

const MENU_ITEMS = ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Extensions', 'Help'] as const;

interface MenuBarProps {
  title: string;
  starred: boolean;
  onTitleChange: (t: string) => void;
  onToggleStar: () => void;
}

export default function MenuBar({ title, starred, onTitleChange, onToggleStar }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Close any open menu when clicking outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-menu-root]')) setOpenMenu(null);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-gdoc-border bg-white px-3">
      <div className="flex items-center gap-2">
        {/* Document icon (Docs-style) */}
        <div
          className="grid h-8 w-8 place-items-center rounded text-white"
          style={{ background: 'linear-gradient(135deg, #4285f4 0%, #1a73e8 100%)' }}
          aria-hidden
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 7V3.5L19.5 9H14z" />
          </svg>
        </div>

        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1">
            <input
              className="w-[230px] bg-transparent text-[15px] font-medium text-[#202124] outline-none placeholder:text-gdoc-muted"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              spellCheck={false}
            />
            <button
              onClick={onToggleStar}
              className="rounded-full p-1 text-gdoc-muted hover:bg-gdoc-hover"
              title={starred ? 'Remove star' : 'Add star'}
            >
              <Star size={16} fill={starred ? '#fbbc04' : 'none'} stroke={starred ? '#fbbc04' : 'currentColor'} />
            </button>
          </div>
          <div
            data-menu-root
            className="flex items-center gap-1 text-[12.5px] text-gdoc-muted"
          >
            {MENU_ITEMS.map((m) => (
              <button
                key={m}
                onClick={() => setOpenMenu(openMenu === m ? null : m)}
                className={`rounded px-2 py-[2px] hover:bg-gdoc-hover ${
                  openMenu === m ? 'bg-gdoc-hover' : ''
                }`}
              >
                {m}
              </button>
            ))}
            {openMenu && <MenuFlyout name={openMenu} onClose={() => setOpenMenu(null)} />}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          className="grid h-8 w-8 place-items-center rounded-full text-gdoc-muted hover:bg-gdoc-hover"
          title="Comments"
        >
          <MessageSquareText size={18} />
        </button>
        <button
          className="grid h-8 w-8 place-items-center rounded-full bg-gdoc-active text-[#1a73e8] hover:bg-[#d2e3fc]"
          title="Open comment history"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
          </svg>
        </button>
        <button
          className="ml-2 flex h-9 items-center gap-2 rounded-full bg-[#1a73e8] px-3 text-sm font-medium text-white hover:bg-[#1765cc]"
          title="Share"
        >
          <Lock size={14} />
          <span>Share</span>
        </button>
        <button
          className="grid h-8 w-8 place-items-center rounded-full text-gdoc-muted hover:bg-gdoc-hover"
          title="More"
        >
          <ChevronDown size={18} />
        </button>
        <div
          className="ml-1 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 text-xs font-medium text-white"
          title="Account"
        >
          <Share2 size={14} className="hidden" />
          S
        </div>
      </div>
    </div>
  );
}

function MenuFlyout({ name, onClose }: { name: string; onClose: () => void }) {
  // Simple stub flyout to demonstrate the menu wiring.
  const items: Record<string, string[]> = {
    File: ['New', 'Open', 'Open recent', '—', 'Make a copy', 'Download', '—', 'Version history', '—', 'Page setup', 'Print', '—', 'Rename', 'Move', '—', 'Move to trash'],
    Edit: ['Undo', 'Redo', '—', 'Cut', 'Copy', 'Paste', '—', 'Find and replace', '—', 'Select all'],
    View: ['Print layout', 'Mode', 'Show rulers', 'Show outline', '—', 'Zoom', '—', 'Full screen'],
    Insert: ['Image', 'Text box', 'Table', 'Horizontal line', '—', 'Special characters', '—', 'Header & footer', 'Page numbers', '—', 'Chart', 'Diagram', '—', 'Date', 'Footnote'],
    Format: ['Text', 'Paragraph styles', '—', 'Bold', 'Italic', 'Underline', 'Strikethrough', '—', 'Align', 'Line spacing', '—', 'Bullets & numbering', '—', 'Columns', '—', 'Clear formatting'],
    Tools: ['Spelling and grammar', 'Word count', '—', 'Voice typing', '—', 'Translate document', '—', 'Accessibility settings'],
    Extensions: ['Add-ons', 'Apps Script'],
    Help: ['Docs Help', 'Keyboard shortcuts', 'What\u2019s new', '—', 'Send feedback', '—', 'Terms of Service', 'Privacy Policy'],
  };
  return (
    <div
      className="dropdown fixed left-3 top-[60px] z-50 w-56 rounded-md border border-gdoc-border bg-white py-1 text-[13px] text-[#202124] shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {(items[name] ?? []).map((it, i) =>
        it === '—' ? (
          <div key={i} className="my-1 border-t border-gdoc-border" />
        ) : (
          <button
            key={i}
            className="block w-full px-4 py-1.5 text-left hover:bg-gdoc-hover"
            onClick={onClose}
          >
            {it}
          </button>
        ),
      )}
    </div>
  );
}
