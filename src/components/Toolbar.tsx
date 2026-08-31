import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Search,
  Undo2,
  Redo2,
  Printer,
  SpellCheck,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  Bold,
  Italic,
  Underline,
  Type,
  Highlighter,
  Link2,
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  MoreHorizontal,
  Check,
  ChevronUp,
  Strikethrough,
  Subscript,
  Superscript,
  Eraser,
  Minus,
  Plus,
  Rows3,
  Percent,
} from 'lucide-react';
import { GOOGLE_FONTS } from '../data/googleFonts';
import { useGoogleFont } from './GoogleFontProvider';
import * as ed from '../lib/editor';

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96];

const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#cc4125', '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7',
];

const HIGHLIGHT_COLORS = [
  'transparent', '#ffe599', '#b6d7a8', '#a4c2f4', '#f4cccc', '#f9cb9c', '#d9d2e9', '#ead1dc',
];

/** Paragraph styles, each carrying the typography used for its dropdown preview. */
const PARAGRAPH_STYLES: { label: string; tag: string; preview: React.CSSProperties }[] = [
  { label: 'Normal text', tag: 'p', preview: { fontSize: '13px', fontWeight: 400 } },
  { label: 'Title', tag: 'h1', preview: { fontSize: '20px', fontWeight: 500, letterSpacing: '-0.2px' } },
  { label: 'Subtitle', tag: 'h2', preview: { fontSize: '15px', fontWeight: 400, color: '#6b6257' } },
  { label: 'Heading 1', tag: 'h1', preview: { fontSize: '19px', fontWeight: 600 } },
  { label: 'Heading 2', tag: 'h2', preview: { fontSize: '16px', fontWeight: 600 } },
  { label: 'Heading 3', tag: 'h3', preview: { fontSize: '14px', fontWeight: 600 } },
  { label: 'Heading 4', tag: 'h4', preview: { fontSize: '13px', fontWeight: 600 } },
  { label: 'Heading 5', tag: 'h5', preview: { fontSize: '12px', fontWeight: 600 } },
  { label: 'Heading 6', tag: 'h6', preview: { fontSize: '11px', fontWeight: 600, color: '#6b6257' } },
];

const LINE_SPACINGS = [
  { label: 'Single', value: 1 },
  { label: '1.15', value: 1.15 },
  { label: '1.5', value: 1.5 },
  { label: 'Double', value: 2 },
  { label: '2.5', value: 2.5 },
  { label: 'Triple', value: 3 },
];

const FONT_PAGE = 150; // fonts rendered per "page" of the dropdown list

export interface ToolbarState {
  font: string;
  size: number;
  style: string;
  zoom: number;
  spellCheck: boolean;
  searchOpen: boolean;
}

interface ToolbarProps extends ToolbarState {
  setFont: (v: string) => void;
  setSize: (v: number) => void;
  setStyle: (v: string) => void;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  setSpellCheck: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  onToggleToolbar: () => void;
}

type MenuKey =
  | null
  | 'style'
  | 'font'
  | 'size'
  | 'textColor'
  | 'highlight'
  | 'lineSpacing'
  | 'more'
  | 'link';

/** Prevents the editor from losing focus, which would drop the text selection. */
function keepSelection(e: React.MouseEvent) {
  e.preventDefault();
}

export default function Toolbar(props: ToolbarProps) {
  const {
    font, size, style, zoom, spellCheck, searchOpen,
    setFont, setSize, setStyle, setZoom, setSpellCheck, setSearchOpen, onToggleToolbar,
  } = props;

  const [open, setOpen] = useState<MenuKey>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { loadFont, isGoogleFont } = useGoogleFont();
  const [fontQuery, setFontQuery] = useState('');
  const [fontLimit, setFontLimit] = useState(FONT_PAGE);
  const [linkUrl, setLinkUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-render on selection changes so B/I/U and alignment reflect the caret.
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    document.addEventListener('selectionchange', force);
    return () => document.removeEventListener('selectionchange', force);
  }, []);

  // Close menus when clicking outside the toolbar.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  const fontGroups = useMemo(() => {
    const q = fontQuery.trim().toLowerCase();
    const filtered = q ? GOOGLE_FONTS.filter((f) => f.family.toLowerCase().includes(q)) : GOOGLE_FONTS;
    return {
      'sans-serif': filtered.filter((f) => f.category === 'sans-serif'),
      serif: filtered.filter((f) => f.category === 'serif'),
      display: filtered.filter((f) => f.category === 'display'),
      handwriting: filtered.filter((f) => f.category === 'handwriting'),
      monospace: filtered.filter((f) => f.category === 'monospace'),
    };
  }, [fontQuery]);

  /** Flat, order-preserving list limited to `fontLimit` for smooth scrolling. */
  const allMatches = useMemo(() => Object.values(fontGroups).flat(), [fontGroups]);
  const visibleFonts = useMemo(() => allMatches.slice(0, fontLimit), [allMatches, fontLimit]);

  const applyFont = (family: string) => {
    if (isGoogleFont(family)) loadFont(family);
    // Apply via a CSS span with a fallback stack. `execCommand('fontName')`
    // would emit a bare `font-family: X` with no fallback, so while the
    // webfont is still downloading Chrome renders the default serif —
    // the "every font looks like Times" bug.
    ed.applyInlineStyle('font-family', `"${family}", "Red Hat Text", sans-serif`);
    setFont(family);
    setOpen(null);
  };

  const applySize = (pt: number) => {
    ed.applyInlineStyle('font-size', `${pt}pt`);
    setSize(pt);
    setOpen(null);
  };

  const applyStyle = (s: (typeof PARAGRAPH_STYLES)[number]) => {
    ed.formatBlock(s.tag);
    setStyle(s.label);
    setOpen(null);
  };

  const activeStyle = PARAGRAPH_STYLES.find((s) => s.label === style) ?? PARAGRAPH_STYLES[0];

  return (
    <div
      ref={rootRef}
      className="no-print relative z-20 flex flex-wrap items-center gap-0.5 border-b border-gdoc-border bg-white px-2 py-1 font-ui"
    >
      <ToolBtn
        title="Find in document (Ctrl + F)"
        active={searchOpen}
        onClick={() => setSearchOpen(!searchOpen)}
      >
        <Search size={18} />
      </ToolBtn>
      <ToolBtn title="Undo (Ctrl + Z)" onClick={() => ed.exec('undo')}>
        <Undo2 size={18} />
      </ToolBtn>
      <ToolBtn title="Redo (Ctrl + Y)" onClick={() => ed.exec('redo')}>
        <Redo2 size={18} />
      </ToolBtn>
      <ToolBtn title="Print (Ctrl + P)" onClick={() => window.print()}>
        <Printer size={18} />
      </ToolBtn>
      <ToolBtn
        title="Toggle spellcheck"
        active={spellCheck}
        onClick={() => setSpellCheck(!spellCheck)}
      >
        <SpellCheck size={18} />
      </ToolBtn>

      <Sep />

      <ZoomControl zoom={zoom} setZoom={setZoom} />

      <Sep />

      {/* Paragraph style — each row is previewed in its own typography */}
      <Dropdown
        open={open === 'style'}
        onOpenChange={(v) => setOpen(v ? 'style' : null)}
        label={<span className="text-[13px]">{activeStyle.label}</span>}
        width={210}
      >
        {PARAGRAPH_STYLES.map((s) => (
          <button
            key={s.label}
            onMouseDown={keepSelection}
            onClick={() => applyStyle(s)}
            className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-gdoc-hover"
          >
            <span style={s.preview} className="truncate text-[#2b2622]">
              {s.label}
            </span>
            {style === s.label && <Check size={14} className="flex-none text-bb-600" />}
          </button>
        ))}
      </Dropdown>

      <Sep />

      {/* Font family — all 1,946 Google Fonts */}
      <Dropdown
        open={open === 'font'}
        onOpenChange={(v) => setOpen(v ? 'font' : null)}
        label={<span className="max-w-[130px] truncate text-[13px]">{font}</span>}
        width={290}
      >
        <div className="sticky top-0 border-b border-gdoc-border bg-white px-2 py-1.5">
          <input
            autoFocus
            type="text"
            value={fontQuery}
            onChange={(e) => {
              setFontQuery(e.target.value);
              setFontLimit(FONT_PAGE);
            }}
            placeholder={`Search ${GOOGLE_FONTS.length.toLocaleString()} fonts…`}
            className="w-full rounded-md border border-gdoc-border px-2 py-1.5 text-[13px] outline-none focus:border-bb-400"
          />
        </div>
        <div
          className="max-h-[340px] overflow-y-auto py-1"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
              setFontLimit((n) => n + FONT_PAGE);
            }
          }}
        >
          {visibleFonts.map((f) => (
            <button
              key={`${f.category}-${f.family}`}
              onMouseEnter={() => loadFont(f.family)}
              onMouseDown={keepSelection}
              onClick={() => applyFont(f.family)}
              className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-gdoc-hover"
            >
              <span style={{ fontFamily: `"${f.family}", system-ui` }} className="truncate text-[15px]">
                {f.family}
              </span>
              {font === f.family && <Check size={14} className="flex-none text-bb-600" />}
            </button>
          ))}
          {visibleFonts.length === 0 && (
            <div className="px-3 py-4 text-center text-[12px] text-gdoc-muted">
              No fonts match “{fontQuery}”
            </div>
          )}
          {visibleFonts.length > 0 && visibleFonts.length < allMatches.length && (
            <div className="px-3 py-2 text-center text-[11px] text-gdoc-muted">Scroll for more…</div>
          )}
        </div>
      </Dropdown>

      <Sep />

      {/* Font size */}
      <Dropdown
        open={open === 'size'}
        onOpenChange={(v) => setOpen(v ? 'size' : null)}
        label={<span className="text-[13px]">{size}</span>}
        width={92}
      >
        <div className="max-h-[280px] overflow-y-auto py-1">
          {FONT_SIZES.map((s) => (
            <button
              key={s}
              onMouseDown={keepSelection}
              onClick={() => applySize(s)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
            >
              <span>{s}</span>
              {size === s && <Check size={14} className="text-bb-600" />}
            </button>
          ))}
        </div>
      </Dropdown>

      <Sep />

      <ToolBtn title="Decrease font size" onClick={() => applySize(Math.max(6, size - 1))}>
        <Minus size={15} />
      </ToolBtn>
      <ToolBtn title="Increase font size" onClick={() => applySize(Math.min(400, size + 1))}>
        <Plus size={15} />
      </ToolBtn>

      <Sep />

      <ToolBtn title="Bold (Ctrl + B)" active={ed.queryState('bold')} onClick={() => ed.exec('bold')}>
        <Bold size={18} />
      </ToolBtn>
      <ToolBtn title="Italic (Ctrl + I)" active={ed.queryState('italic')} onClick={() => ed.exec('italic')}>
        <Italic size={18} />
      </ToolBtn>
      <ToolBtn title="Underline (Ctrl + U)" active={ed.queryState('underline')} onClick={() => ed.exec('underline')}>
        <Underline size={18} />
      </ToolBtn>

      <Sep />

      <Dropdown
        open={open === 'textColor'}
        onOpenChange={(v) => setOpen(v ? 'textColor' : null)}
        label={
          <span className="flex flex-col items-center leading-none">
            <Type size={16} />
            <span className="mt-0.5 h-[3px] w-4 rounded-sm" style={{ background: '#000000' }} />
          </span>
        }
        width={240}
      >
        <div className="grid grid-cols-10 gap-1 p-3">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              title={c}
              onMouseDown={keepSelection}
              onClick={() => {
                ed.exec('foreColor', c);
                setOpen(null);
              }}
              className="h-5 w-5 rounded-sm border border-gdoc-border transition-transform hover:scale-110"
              style={{ background: c }}
            />
          ))}
        </div>
      </Dropdown>

      <Dropdown
        open={open === 'highlight'}
        onOpenChange={(v) => setOpen(v ? 'highlight' : null)}
        label={
          <span className="flex flex-col items-center leading-none">
            <Highlighter size={16} />
            <span className="mt-0.5 h-[3px] w-4 rounded-sm bg-bb-300" />
          </span>
        }
        width={240}
      >
        <div className="grid grid-cols-8 gap-1 p-3">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              title={c === 'transparent' ? 'No highlight' : c}
              onMouseDown={keepSelection}
              onClick={() => {
                if (c === 'transparent') ed.exec('removeFormat');
                else ed.exec('hiliteColor', c);
                setOpen(null);
              }}
              className="h-5 w-5 rounded-sm border border-gdoc-border transition-transform hover:scale-110"
              style={{ background: c === 'transparent' ? '#fff' : c }}
            />
          ))}
        </div>
      </Dropdown>

      <Sep />

      {/* Link */}
      <Dropdown
        open={open === 'link'}
        onOpenChange={(v) => setOpen(v ? 'link' : null)}
        label={<Link2 size={18} />}
        title="Insert link (Ctrl + K)"
        width={280}
      >
        <div className="p-3">
          <label className="mb-1 block text-[12px] text-gdoc-muted">Link URL</label>
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                ed.insertLink(linkUrl);
                setLinkUrl('');
                setOpen(null);
              }
            }}
            placeholder="https://baulkobulletin.com"
            className="w-full rounded-md border border-gdoc-border px-2 py-1.5 text-[13px] outline-none focus:border-bb-400"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onMouseDown={keepSelection}
              onClick={() => setOpen(null)}
              className="rounded px-3 py-1 text-[13px] text-gdoc-muted hover:bg-gdoc-hover"
            >
              Cancel
            </button>
            <button
              onMouseDown={keepSelection}
              onClick={() => {
                ed.insertLink(linkUrl);
                setLinkUrl('');
                setOpen(null);
              }}
              className="rounded bg-bb-500 px-3 py-1 text-[13px] font-medium text-white hover:bg-bb-600"
            >
              Apply
            </button>
          </div>
        </div>
      </Dropdown>

      <ToolBtn title="Insert image" onClick={() => fileRef.current?.click()}>
        <ImageIcon size={18} />
      </ToolBtn>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) ed.insertImageFromFile(f);
          e.target.value = '';
        }}
      />

      <Sep />

      <ToolBtn title="Align left" active={ed.queryState('justifyLeft')} onClick={() => ed.exec('justifyLeft')}>
        <AlignLeft size={18} />
      </ToolBtn>
      <ToolBtn title="Align centre" active={ed.queryState('justifyCenter')} onClick={() => ed.exec('justifyCenter')}>
        <AlignCenter size={18} />
      </ToolBtn>
      <ToolBtn title="Align right" active={ed.queryState('justifyRight')} onClick={() => ed.exec('justifyRight')}>
        <AlignRight size={18} />
      </ToolBtn>
      <ToolBtn title="Justify" active={ed.queryState('justifyFull')} onClick={() => ed.exec('justifyFull')}>
        <AlignJustify size={18} />
      </ToolBtn>

      <Sep />

      <ToolBtn title="Bulleted list" onClick={() => ed.exec('insertUnorderedList')}>
        <List size={18} />
      </ToolBtn>
      <ToolBtn title="Numbered list" onClick={() => ed.exec('insertOrderedList')}>
        <ListOrdered size={18} />
      </ToolBtn>
      <ToolBtn title="Decrease indent" onClick={() => ed.exec('outdent')}>
        <IndentDecrease size={18} />
      </ToolBtn>
      <ToolBtn title="Increase indent" onClick={() => ed.exec('indent')}>
        <IndentIncrease size={18} />
      </ToolBtn>

      <Sep />

      <Dropdown
        open={open === 'lineSpacing'}
        onOpenChange={(v) => setOpen(v ? 'lineSpacing' : null)}
        label={<Rows3 size={18} />}
        title="Line spacing"
        width={170}
      >
        {LINE_SPACINGS.map((l) => (
          <button
            key={l.value}
            onMouseDown={keepSelection}
            onClick={() => {
              ed.setLineHeight(l.value);
              setOpen(null);
            }}
            className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
          >
            <Rows3 size={15} className="flex-none text-bb-600" />
            <span className="flex-1">{l.label}</span>
          </button>
        ))}
      </Dropdown>

      <Sep />

      <Dropdown
        open={open === 'more'}
        onOpenChange={(v) => setOpen(v ? 'more' : null)}
        label={<MoreHorizontal size={18} />}
        title="More formatting"
        width={230}
      >
        <MoreItem icon={<Strikethrough size={15} />} label="Strikethrough" onClick={() => ed.exec('strikeThrough')} />
        <MoreItem icon={<Subscript size={15} />} label="Subscript" onClick={() => ed.exec('subscript')} />
        <MoreItem icon={<Superscript size={15} />} label="Superscript" onClick={() => ed.exec('superscript')} />
        <div className="my-1 border-t border-gdoc-border" />
        <MoreItem icon={<Eraser size={15} />} label="Clear formatting" onClick={() => ed.clearFormatting()} />
      </Dropdown>

      <div className="ml-auto flex items-center pr-1">
        <ToolBtn title="Hide the toolbar (Ctrl + Shift + F)" onClick={onToggleToolbar}>
          <ChevronUp size={18} />
        </ToolBtn>
      </div>
    </div>
  );
}

/* ---------- shared bits ---------- */

function Sep() {
  return <div className="mx-1 h-5 w-px bg-gdoc-border" />;
}

function ToolBtn({
  children,
  title,
  active,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseDown={keepSelection}
      className={`grid h-8 w-8 place-items-center rounded transition-colors ${
        active ? 'bg-gdoc-active text-bb-700' : 'text-gdoc-muted hover:bg-gdoc-hover'
      }`}
    >
      {children}
    </button>
  );
}

function MoreItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onMouseDown={keepSelection}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
    >
      <span className="text-gdoc-muted">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function ZoomControl({
  zoom,
  setZoom,
}: {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="flex h-8 items-center rounded text-gdoc-muted hover:bg-gdoc-hover">
        <button
          onMouseDown={keepSelection}
          onClick={() => setZoom((z) => Math.max(50, z - 10))}
          className="grid h-8 w-7 place-items-center"
          title="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onMouseDown={keepSelection}
          onClick={() => setOpen((o) => !o)}
          className="px-1 text-[13px]"
          title="Zoom level"
        >
          {zoom}%
        </button>
        <button
          onMouseDown={keepSelection}
          onClick={() => setZoom((z) => Math.min(200, z + 10))}
          className="grid h-8 w-7 place-items-center"
          title="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
      </div>
      {open && (
        <div className="dropdown absolute left-0 top-full z-30 mt-1 w-40 rounded-md border border-gdoc-border bg-white py-1 shadow-lg">
          {[50, 75, 90, 100, 125, 150, 200].map((p) => (
            <button
              key={p}
              onMouseDown={keepSelection}
              onClick={() => {
                setZoom(p);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
            >
              <Percent size={15} className="flex-none text-bb-600" />
              <span className="flex-1">{p}%</span>
              {zoom === p && <Check size={14} className="flex-none text-bb-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Trigger + panel. The panel always opens *directly below* the trigger. */
function Dropdown({
  open,
  onOpenChange,
  label,
  children,
  width = 200,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  label: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  title?: string;
}) {
  return (
    <div className="relative">
      <button
        title={title}
        onMouseDown={keepSelection}
        onClick={() => onOpenChange(!open)}
        className={`flex h-8 min-w-8 items-center justify-center gap-1 rounded px-2 transition-colors hover:bg-gdoc-hover ${
          open ? 'bg-gdoc-active' : ''
        }`}
      >
        {label}
        <ChevronDown size={14} className="flex-none text-gdoc-muted" />
      </button>
      {open && (
        <div
          className="dropdown absolute left-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-gdoc-border bg-white shadow-lg"
          style={{ width }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
