import { useEffect, useMemo, useRef, useState } from 'react';
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
  MessageSquarePlus,
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
  PenLine,
  ChevronUp,
} from 'lucide-react';
import type { DocumentSettings } from '../App';
import { GOOGLE_FONTS, GOOGLE_FONT_FAMILIES } from '../data/googleFonts';
import { useGoogleFont } from './GoogleFontProvider';

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

const PARAGRAPH_STYLES = [
  'Normal text', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6',
];

interface ToolbarProps {
  settings: DocumentSettings;
  setSettings: React.Dispatch<React.SetStateAction<DocumentSettings>>;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  style: string;
  setStyle: React.Dispatch<React.SetStateAction<string>>;
}

type DropdownKey =
  | null
  | 'style'
  | 'font'
  | 'size'
  | 'textColor'
  | 'highlight'
  | 'align'
  | 'lineSpacing'
  | 'zoom';

export default function Toolbar({ settings, setSettings, zoom, setZoom, style, setStyle }: ToolbarProps) {
  const [open, setOpen] = useState<DropdownKey>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { loadFont, isGoogleFont } = useGoogleFont();
  const [fontSearch, setFontSearch] = useState('');

  // close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  // preload current font for the canvas
  useEffect(() => {
    if (isGoogleFont(settings.font)) loadFont(settings.font);
  }, [settings.font, isGoogleFont, loadFont]);

  const fontCategories = useMemo(() => {
    const search = fontSearch.trim().toLowerCase();
    const filtered = search
      ? GOOGLE_FONTS.filter((f) => f.family.toLowerCase().includes(search))
      : GOOGLE_FONTS;
    return {
      'sans-serif': filtered.filter((f) => f.category === 'sans-serif'),
      serif: filtered.filter((f) => f.category === 'serif'),
      display: filtered.filter((f) => f.category === 'display'),
      handwriting: filtered.filter((f) => f.category === 'handwriting'),
      monospace: filtered.filter((f) => f.category === 'monospace'),
    };
  }, [fontSearch]);

  const pickFont = (family: string) => {
    setSettings((s) => ({ ...s, font: family }));
    if (isGoogleFont(family)) loadFont(family);
    setOpen(null);
  };

  return (
    <div ref={rootRef} className="relative z-20 flex flex-wrap items-center gap-0.5 border-b border-gdoc-border bg-white px-2 py-1">
      <ToolBtn title="Search the menus (Alt + /)"><Search size={18} /></ToolBtn>
      <ToolBtn title="Undo (Ctrl + Z)"><Undo2 size={18} /></ToolBtn>
      <ToolBtn title="Redo (Ctrl + Y)"><Redo2 size={18} /></ToolBtn>
      <ToolBtn title="Print (Ctrl + P)"><Printer size={18} /></ToolBtn>
      <ToolBtn title="Spelling and grammar check"><SpellCheck size={18} /></ToolBtn>

      <Sep />

      <ZoomButton zoom={zoom} setZoom={setZoom} />

      <Sep />

      {/* Paragraph style */}
      <DropdownShell
        isOpen={open === 'style'}
        onOpenChange={(v) => setOpen(v ? 'style' : null)}
        label={
          <span className="text-[13px] text-[#202124]">{style}</span>
        }
        width={160}
        align="left"
      >
        {PARAGRAPH_STYLES.map((s) => (
          <button
            key={s}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
            onClick={() => {
              setStyle(s);
              setOpen(null);
            }}
          >
            <span>{s}</span>
            {style === s && <Check size={14} className="text-[#1a73e8]" />}
          </button>
        ))}
      </DropdownShell>

      <Sep />

      {/* Font family */}
      <DropdownShell
        isOpen={open === 'font'}
        onOpenChange={(v) => setOpen(v ? 'font' : null)}
        label={
          <span className="text-[13px] text-[#202124]">{settings.font}</span>
        }
        width={280}
        align="left"
      >
        <div className="sticky top-0 border-b border-gdoc-border bg-white px-2 py-1.5">
          <input
            autoFocus
            type="text"
            value={fontSearch}
            onChange={(e) => setFontSearch(e.target.value)}
            placeholder="Search fonts"
            className="w-full rounded-md border border-gdoc-border bg-white px-2 py-1.5 text-[13px] outline-none focus:border-[#1a73e8]"
          />
        </div>
        <div className="max-h-[360px] overflow-y-auto py-1">
          {Object.entries(fontCategories).map(([cat, list]) =>
            list.length === 0 ? null : (
              <div key={cat} className="px-1 pb-1">
                <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-gdoc-muted">{cat}</div>
                {list.map((f) => (
                  <button
                    key={f.family}
                    onMouseEnter={() => loadFont(f.family)}
                    onClick={() => pickFont(f.family)}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
                    style={{ fontFamily: `"${f.family}", system-ui` }}
                  >
                    <span>{f.family}</span>
                    {settings.font === f.family && <Check size={14} className="text-[#1a73e8]" />}
                  </button>
                ))}
              </div>
            ),
          )}
          {GOOGLE_FONT_FAMILIES.length === 0 && (
            <div className="px-3 py-3 text-center text-[12px] text-gdoc-muted">No fonts found</div>
          )}
        </div>
      </DropdownShell>

      <Sep />

      {/* Font size */}
      <DropdownShell
        isOpen={open === 'size'}
        onOpenChange={(v) => setOpen(v ? 'size' : null)}
        label={<span className="text-[13px] text-[#202124]">{settings.size}</span>}
        width={80}
        align="left"
      >
        <div className="max-h-[260px] overflow-y-auto py-1">
          {FONT_SIZES.map((s) => (
            <button
              key={s}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
              onClick={() => {
                setSettings((p) => ({ ...p, size: s }));
                setOpen(null);
              }}
            >
              <span>{s}</span>
              {settings.size === s && <Check size={14} className="text-[#1a73e8]" />}
            </button>
          ))}
        </div>
      </DropdownShell>

      <Sep />

      <ToolBtn
        title="Decrease font size (Ctrl + Shift + <)"
        onClick={() => setSettings((p) => ({ ...p, size: Math.max(6, p.size - 1) }))}
      >
        <span className="flex h-[18px] w-[18px] items-center justify-center text-[12px] font-semibold text-gdoc-muted">A-</span>
      </ToolBtn>
      <ToolBtn
        title="Increase font size (Ctrl + Shift + >)"
        onClick={() => setSettings((p) => ({ ...p, size: Math.min(400, p.size + 1) }))}
      >
        <span className="flex h-[18px] w-[18px] items-center justify-center text-[14px] font-semibold text-gdoc-muted">A+</span>
      </ToolBtn>

      <Sep />

      <ToolBtn
        active={settings.bold}
        title="Bold (Ctrl + B)"
        onClick={() => setSettings((p) => ({ ...p, bold: !p.bold }))}
      >
        <Bold size={18} />
      </ToolBtn>
      <ToolBtn
        active={settings.italic}
        title="Italic (Ctrl + I)"
        onClick={() => setSettings((p) => ({ ...p, italic: !p.italic }))}
      >
        <Italic size={18} />
      </ToolBtn>
      <ToolBtn
        active={settings.underline}
        title="Underline (Ctrl + U)"
        onClick={() => setSettings((p) => ({ ...p, underline: !p.underline }))}
      >
        <Underline size={18} />
      </ToolBtn>

      <Sep />

      {/* Text color */}
      <DropdownShell
        isOpen={open === 'textColor'}
        onOpenChange={(v) => setOpen(v ? 'textColor' : null)}
        label={
          <div className="flex flex-col items-center leading-none">
            <Type size={16} />
            <span className="mt-0.5 h-[3px] w-4" style={{ background: settings.textColor }} />
          </div>
        }
        width={230}
        align="left"
      >
        <div className="grid grid-cols-10 gap-1 p-3">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setSettings((p) => ({ ...p, textColor: c }));
                setOpen(null);
              }}
              className="h-5 w-5 rounded-sm border border-gdoc-border hover:scale-110"
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
        <div className="border-t border-gdoc-border px-3 py-2 text-[12px] text-gdoc-muted">Default</div>
      </DropdownShell>

      {/* Highlight color */}
      <DropdownShell
        isOpen={open === 'highlight'}
        onOpenChange={(v) => setOpen(v ? 'highlight' : null)}
        label={
          <div className="flex flex-col items-center leading-none">
            <Highlighter size={16} />
            <span
              className="mt-0.5 h-[3px] w-4"
              style={{ background: settings.highlight === 'transparent' ? 'transparent' : settings.highlight }}
            />
          </div>
        }
        width={230}
        align="left"
      >
        <div className="grid grid-cols-8 gap-1 p-3">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setSettings((p) => ({ ...p, highlight: c }));
                setOpen(null);
              }}
              className="h-5 w-5 rounded-sm border border-gdoc-border hover:scale-110"
              style={{ background: c === 'transparent' ? '#fff' : c }}
              title={c}
            >
              {c === 'transparent' && <span className="block h-full w-full rounded-sm border-b border-red-500" />}
            </button>
          ))}
        </div>
      </DropdownShell>

      <Sep />

      <ToolBtn title="Insert link (Ctrl + K)"><Link2 size={18} /></ToolBtn>
      <ToolBtn title="Insert comment (Ctrl + Alt + M)"><MessageSquarePlus size={18} /></ToolBtn>
      <ToolBtn title="Insert image"><ImageIcon size={18} /></ToolBtn>

      <Sep />

      <ToolBtn
        active={settings.align === 'left'}
        title="Align left (Ctrl + Shift + L)"
        onClick={() => setSettings((p) => ({ ...p, align: 'left' }))}
      >
        <AlignLeft size={18} />
      </ToolBtn>
      <ToolBtn
        active={settings.align === 'center'}
        title="Align center (Ctrl + Shift + E)"
        onClick={() => setSettings((p) => ({ ...p, align: 'center' }))}
      >
        <AlignCenter size={18} />
      </ToolBtn>
      <ToolBtn
        active={settings.align === 'right'}
        title="Align right (Ctrl + Shift + R)"
        onClick={() => setSettings((p) => ({ ...p, align: 'right' }))}
      >
        <AlignRight size={18} />
      </ToolBtn>
      <ToolBtn
        active={settings.align === 'justify'}
        title="Justify (Ctrl + Shift + J)"
        onClick={() => setSettings((p) => ({ ...p, align: 'justify' }))}
      >
        <AlignJustify size={18} />
      </ToolBtn>

      <Sep />

      <ToolBtn title="Bulleted list"><List size={18} /></ToolBtn>
      <ToolBtn title="Numbered list"><ListOrdered size={18} /></ToolBtn>
      <ToolBtn title="Decrease indent"><IndentDecrease size={18} /></ToolBtn>
      <ToolBtn title="Increase indent"><IndentIncrease size={18} /></ToolBtn>

      <Sep />

      {/* Line spacing stub dropdown */}
      <DropdownShell
        isOpen={open === 'lineSpacing'}
        onOpenChange={(v) => setOpen(v ? 'lineSpacing' : null)}
        label={
          <div className="flex flex-col items-end leading-tight">
            <span className="block h-px w-4 bg-[#5f6368]" />
            <span className="mt-0.5 block h-px w-3 bg-[#5f6368]" />
            <span className="mt-0.5 block h-px w-2 bg-[#5f6368]" />
          </div>
        }
        width={180}
        align="left"
      >
        {[1, 1.15, 1.5, 2, 2.5, 3].map((v) => (
          <button key={v} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover">
            {v === 1 ? 'Single' : v === 1.15 ? '1.15' : v}
          </button>
        ))}
      </DropdownShell>

      <Sep />

      <ToolBtn title="More toolbar options"><MoreHorizontal size={18} /></ToolBtn>

      <div className="ml-auto flex items-center gap-1 pl-2">
        <ToolBtn
          title="Edit document directly (suggesting)"
          active
        >
          <PenLine size={18} className="text-[#1a73e8]" />
        </ToolBtn>
        <ToolBtn title="Hide the toolbar (Ctrl + Shift + F)">
          <ChevronUp size={18} />
        </ToolBtn>
      </div>
    </div>
  );
}

/* -------- Sub-components -------- */

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
      className={`grid h-8 w-8 place-items-center rounded text-[#5f6368] hover:bg-gdoc-hover ${
        active ? 'bg-gdoc-active text-[#1a73e8]' : ''
      }`}
    >
      {children}
    </button>
  );
}

function ZoomButton({ zoom, setZoom }: { zoom: number; setZoom: React.Dispatch<React.SetStateAction<number>> }) {
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
      <div className="flex h-8 items-center rounded text-[#5f6368] hover:bg-gdoc-hover">
        <button
          onClick={() => setZoom((z) => Math.max(50, z - 10))}
          className="grid h-8 w-7 place-items-center"
          title="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          className="px-1 text-[13px]"
          title="Zoom level"
        >
          {zoom}%
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(200, z + 10))}
          className="grid h-8 w-7 place-items-center"
          title="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
      </div>
      {open && (
        <div className="dropdown absolute left-0 top-9 z-30 w-40 rounded-md border border-gdoc-border bg-white py-1 shadow-lg">
          {[50, 75, 90, 100, 125, 150, 200].map((p) => (
            <button
              key={p}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
              onClick={() => {
                setZoom(p);
                setOpen(false);
              }}
            >
              <span>{p}%</span>
              {zoom === p && <Check size={14} className="text-[#1a73e8]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DropdownShell({
  isOpen,
  onOpenChange,
  label,
  children,
  width = 200,
  align = 'left',
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  label: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  align?: 'left' | 'right';
}) {
  return (
    <div className="relative">
      <button
        onClick={() => onOpenChange(!isOpen)}
        className={`flex h-8 items-center gap-1 rounded px-2 hover:bg-gdoc-hover ${
          isOpen ? 'bg-gdoc-hover' : ''
        }`}
      >
        {label}
        <ChevronDown size={14} className="text-gdoc-muted" />
      </button>
      {isOpen && (
        <div
          className={`dropdown absolute top-9 z-30 rounded-md border border-gdoc-border bg-white shadow-lg`}
          style={{
            width,
            [align]: 0,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
