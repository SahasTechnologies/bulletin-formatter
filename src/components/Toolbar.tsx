import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Pilcrow,
  CaseSensitive,
  ALargeSmall,
  Newspaper,
} from 'lucide-react';
import { GOOGLE_FONTS } from '../data/googleFonts';
import { LOCAL_FONTS } from '../data/localFonts';
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
const GAP = 6; // px between controls (gap-1.5)

// Order of controls in the pill. The essentials are always shown; the rest
// slide into the horizontal ⋮ strip when the window is too narrow.
const ALL_KEYS = [
  'find', 'undo', 'redo', 'print', 'spell', 'zoom', 'style', 'font', 'size',
  'bold', 'italic', 'underline', 'textColor', 'highlight',
  'link', 'image', 'alignL', 'alignC', 'alignR', 'alignJ', 'bullet', 'number',
  'indentDec', 'indentInc', 'lineSpacing', 'master',
] as const;
type ItemKey = (typeof ALL_KEYS)[number];

/**
 * Which controls form one visual group. A hairline divider is drawn on the
 * leading edge of every group, so the eye reads "these belong together" —
 * in particular the font cluster (font name → size → B/I/U/colour) is fenced
 * off from the paragraph tools. Keys that share a number are separated by a
 * gap only.
 */
const GROUPS: Record<ItemKey, number> = {
  find: 1, undo: 1, redo: 1, print: 1, spell: 1, // document & view
  zoom: 2,
  style: 3,
  font: 4,
  size: 5, // − [pt] + — one unit
  bold: 6, italic: 6, underline: 6, textColor: 6, highlight: 6, // character
  link: 7, image: 7, // insert
  alignL: 8, alignC: 8, alignR: 8, alignJ: 8, // paragraph
  bullet: 9, number: 9,
  indentDec: 10, indentInc: 10,
  lineSpacing: 11,
  master: 12, // page furniture
};

const ESSENTIALS = new Set<ItemKey>([
  'find', 'undo', 'redo', 'print', 'spell', 'zoom', 'style', 'font', 'size',
  'bold', 'italic', 'underline', 'textColor', 'highlight',
]);

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
  /** Insert a picture as its own image box on the page (Insert > Image). */
  onInsertImage?: () => void;
  /** Toggle the master-page (header & footer) panel. */
  onToggleMaster?: () => void;
  /** The master-page panel is currently open (button highlight). */
  masterOpen?: boolean;
  /** Increment to programmatically open the link dropdown (Ctrl+K / Insert > Link). */
  requestLink?: number;
}

function keepSelection(e: React.MouseEvent) {
  ed.captureSelection();
  e.preventDefault();
}

export default function Toolbar(props: ToolbarProps) {
  const {
    font, size, style, zoom, spellCheck, searchOpen,
    setFont, setSize, setStyle, setZoom, setSpellCheck, setSearchOpen, onToggleToolbar,
    onInsertImage,
    onToggleMaster,
    masterOpen = false,
    requestLink = 0,
  } = props;

  const [open, setOpen] = useState<ItemKey | null>(null);
  const [touch, setTouch] = useState<Set<ItemKey>>(new Set()); // captured / hidden controls
  const [moreOpen, setMoreOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const measurerRef = useRef<HTMLDivElement>(null);

  const { loadFont, isGoogleFont } = useGoogleFont();
  const [fontQuery, setFontQuery] = useState('');
  const [fontLimit, setFontLimit] = useState(FONT_PAGE);
  const [linkUrl, setLinkUrl] = useState('');
  const fontSearchRef = useRef<HTMLInputElement>(null);

  const isApplyingStyleRef = useRef(false);

  // Programmatic link insertion from the menu bar / Ctrl+K.
  const lastLinkReq = useRef(0);
  useEffect(() => {
    if (requestLink !== lastLinkReq.current) {
      lastLinkReq.current = requestLink;
      // If the link control has been pushed into the ⋮ strip, expand it so
      // the dropdown has a mounted parent to render inside.
      setMoreOpen(true);
      setOpen('link');
    }
  }, [requestLink]);

  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const updateCurrentStyle = () => {
      if (isApplyingStyleRef.current) return;
      if (open !== null) return;
      force();
      const fontFamily = ed.currentStyle('font-family');
      if (fontFamily) {
        const match = fontFamily.match(/^["']?([^"',]+)["']?/);
        if (match) {
          const extractedFont = match[1].trim();
          if (isGoogleFont(extractedFont)) setFont(extractedFont);
        }
      }
      const fontSize = ed.currentStyle('font-size');
      if (fontSize) {
        const parsed = parseFloat(fontSize);
        if (!isNaN(parsed)) {
          // currentStyle returns the inline declaration verbatim (e.g.
          // "14pt") or, when no inline style exists, the computed px value.
          // Convert px→pt for display; pt (what the editor writes) is kept as-is.
          const unit = (fontSize.match(/[a-z%]+$/i) ?? ['px'])[0].toLowerCase();
          setSize(unit === 'pt' ? Math.round(parsed) : Math.round(parsed * 0.75));
        }
      }
    };
    document.addEventListener('selectionchange', updateCurrentStyle);
    return () => document.removeEventListener('selectionchange', updateCurrentStyle);
  }, [isGoogleFont, open]);

  // Close menus when clicking outside the toolbar.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      // Clicks inside a portaled dropdown panel belong to the toolbar too.
      if (t instanceof Element && t.closest('[data-dropdown-panel]')) return;
      setOpen(null);
      setMoreOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  // Measure which controls fit in the pill; the rest go into the ⋮ strip.
  useEffect(() => {
    const measure = () => {
      const outer = outerRef.current;
      const pinned = pinnedRef.current;
      const measurer = measurerRef.current;
      if (!outer || !pinned || !measurer) return;
      const children = Array.from(measurer.querySelectorAll<HTMLElement>('[data-item]'));
      if (!children.length) return;
      const widths = children.map((c) => c.offsetWidth);
      const items = children.map((c) => c.dataset.item as ItemKey);
      const essential = children.map((c) => c.dataset.essential === 'true');

      // Available width for the inline row: subtract the outer padding (px-2
      // → 16), the pill padding (pl-4 + pr-3 → 28), the spacer (8) and the
      // pinned ⋮ button (offsetWidth includes its own padding).
      const available = outer.clientWidth - 16 - 28 - 8 - pinned.offsetWidth;

      let fit = 0;
      let acc = 0;
      for (let i = 0; i < widths.length; i++) {
        const extra = i > 0 ? GAP : 0;
        if (acc + widths[i] + extra <= available) {
          acc += widths[i] + extra;
          fit = i + 1;
        } else {
          break;
        }
      }
      // Essentials are the leading controls in ALL_KEYS, so the loop above
      // already keeps as many as fit. We must NOT force-keep every essential
      // past the available width: doing so makes the pill's content spill out
      // past its rounded edge (truncating e.g. the font name) at narrow sizes.
      setTouch(new Set(items.slice(fit)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outerRef.current) ro.observe(outerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const fontGroups = useMemo(() => {
    const q = fontQuery.trim().toLowerCase();
    const all = [...LOCAL_FONTS, ...GOOGLE_FONTS];
    const filtered = q ? all.filter((f) => f.family.toLowerCase().includes(q)) : all;
    return {
      'sans-serif': filtered.filter((f) => f.category === 'sans-serif'),
      serif: filtered.filter((f) => f.category === 'serif'),
      display: filtered.filter((f) => f.category === 'display'),
      handwriting: filtered.filter((f) => f.category === 'handwriting'),
      monospace: filtered.filter((f) => f.category === 'monospace'),
    };
  }, [fontQuery]);

  const allMatches = useMemo(() => Object.values(fontGroups).flat(), [fontGroups]);
  const visibleFonts = useMemo(() => allMatches.slice(0, fontLimit), [allMatches, fontLimit]);

  const applyFont = (family: string) => {
    isApplyingStyleRef.current = true;
    if (isGoogleFont(family)) loadFont(family);
    ed.applyInlineStyle('font-family', `"${family}", "Red Hat Text", sans-serif`);
    const editor = ed.getEditor();
    if (editor) editor.focus();
    setTimeout(() => {
      isApplyingStyleRef.current = false;
    }, 50);
    setFont(family);
    setOpen(null);
  };

  const applySize = (pt: number) => {
    isApplyingStyleRef.current = true;
    ed.applyInlineStyle('font-size', `${pt}pt`);
    setSize(pt);
    setOpen(null);
    const editor = ed.getEditor();
    if (editor) editor.focus();
    setTimeout(() => {
      isApplyingStyleRef.current = false;
    }, 100);
  };

  /**
   * The −/+ steppers walk the FONT_SIZES ladder rather than nudging by 1pt, so
   * every step lands on a value the size dropdown can tick. Sizes that are not
   * on the ladder (a template may set 13pt) move by 1pt so the first press is
   * never a surprise jump. At either end of the ladder the button does nothing,
   * matching the zoom control's clamp behaviour.
   */
  const stepSize = (dir: -1 | 1) => {
    if (!FONT_SIZES.includes(size)) {
      applySize(Math.min(400, Math.max(6, size + dir)));
      return;
    }
    const next =
      dir === 1
        ? FONT_SIZES.find((s) => s > size)
        : [...FONT_SIZES].reverse().find((s) => s < size);
    if (next !== undefined) applySize(next);
  };

  const applyStyle = (s: (typeof PARAGRAPH_STYLES)[number]) => {
    ed.formatBlock(s.tag);
    setStyle(s.label);
    setOpen(null);
  };

  const activeStyle = PARAGRAPH_STYLES.find((s) => s.label === style) ?? PARAGRAPH_STYLES[0];

  /* -------- shared dropdown panel bodies -------- */
  const renderStylePanel = () => (
    <>
      {PARAGRAPH_STYLES.map((s) => (
        <button key={s.label} onMouseDown={keepSelection} onClick={() => applyStyle(s)}
          className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-gdoc-hover">
          <span style={s.preview} className="truncate">{s.label}</span>
          {style === s.label && <Check size={14} className="flex-none text-bb-600" />}
        </button>
      ))}
    </>
  );

  const renderFontPanel = () => (
    <>
      <div className="sticky top-0 border-b border-gdoc-border bg-white px-2 py-1.5">
        <input
          ref={fontSearchRef}
          type="text"
          value={fontQuery}
          onChange={(e) => { setFontQuery(e.target.value); setFontLimit(FONT_PAGE); }}
          placeholder={`Search ${(LOCAL_FONTS.length + GOOGLE_FONTS.length).toLocaleString()} fonts…`}
          className="w-full rounded-md border border-gdoc-border px-2 py-1.5 text-[13px] outline-none focus:border-bb-400"
        />
      </div>
      <div className="max-h-[340px] overflow-y-auto py-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) setFontLimit((n) => n + FONT_PAGE);
        }}>
        {visibleFonts.map((f) => (
          <button key={`${f.category}-${f.family}`} onMouseEnter={() => loadFont(f.family)}
            onMouseDown={keepSelection} onClick={() => applyFont(f.family)}
            className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-gdoc-hover">
            <span style={{ fontFamily: `"${f.family}", system-ui` }} className="truncate text-[15px]">{f.family}</span>
            {font === f.family && <Check size={14} className="flex-none text-bb-600" />}
          </button>
        ))}
        {visibleFonts.length === 0 && (
          <div className="px-3 py-4 text-center text-[12px] text-gdoc-muted">No fonts match “{fontQuery}”</div>
        )}
        {visibleFonts.length > 0 && visibleFonts.length < allMatches.length && (
          <div className="px-3 py-2 text-center text-[11px] text-gdoc-muted">Scroll for more…</div>
        )}
      </div>
    </>
  );

  const renderSizePanel = () => (
    <div className="max-h-[280px] overflow-y-auto py-1">
      {FONT_SIZES.map((s) => (
        <button key={s} onMouseDown={keepSelection} onClick={() => applySize(s)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover">
          <span>{s}</span>
          {size === s && <Check size={14} className="text-bb-600" />}
        </button>
      ))}
    </div>
  );

  const renderColorPanel = () => (
    <div className="grid grid-cols-10 gap-1 p-3">
      {TEXT_COLORS.map((c) => (
        <button key={c} title={c} onMouseDown={keepSelection} onClick={() => { ed.applyCommandStyle('foreColor', c); setOpen(null); }}
          className="h-5 w-5 rounded-sm border border-gdoc-border transition-transform hover:scale-110" style={{ background: c }} />
      ))}
    </div>
  );

  const renderHighlightPanel = () => (
    <div className="grid grid-cols-8 gap-1 p-3">
      {HIGHLIGHT_COLORS.map((c) => (
        <button key={c} title={c === 'transparent' ? 'No highlight' : c} onMouseDown={keepSelection}
          onClick={() => { if (c === 'transparent') ed.applyInlineStyle('background-color', 'transparent'); else ed.applyCommandStyle('hiliteColor', c); setOpen(null); }}
          className="h-5 w-5 rounded-sm border border-gdoc-border transition-transform hover:scale-110" style={{ background: c === 'transparent' ? '#fff' : c }} />
      ))}
    </div>
  );

  const renderLinkPanel = () => (
    <div className="p-3">
      <label className="mb-1 block text-[12px] text-gdoc-muted">Link URL</label>
      <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter') { ed.insertLink(linkUrl); setLinkUrl(''); setOpen(null); } }}
        placeholder="https://baulkobulletin.com"
        className="w-full rounded-md border border-gdoc-border px-2 py-1.5 text-[13px] outline-none focus:border-bb-400" />
      <div className="mt-2 flex justify-end gap-2">
        <button onMouseDown={keepSelection} onClick={() => setOpen(null)} className="rounded px-3 py-1 text-[13px] text-gdoc-muted hover:bg-gdoc-hover">Cancel</button>
        <button onMouseDown={keepSelection} onClick={() => { ed.insertLink(linkUrl); setLinkUrl(''); setOpen(null); }}
          className="rounded bg-bb-500 px-3 py-1 text-[13px] font-medium text-white hover:bg-bb-600">Apply</button>
      </div>
    </div>
  );

  const renderLineSpacingPanel = () => (
    <>
      {LINE_SPACINGS.map((l) => (
        <button key={l.value} onMouseDown={keepSelection} onClick={() => { ed.setLineHeight(l.value); setOpen(null); }}
          className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover">
          <Rows3 size={15} className="flex-none text-bb-600" />
          <span className="flex-1">{l.label}</span>
        </button>
      ))}
    </>
  );

  /** `measuring` is used by the hidden pass to render controls closed, so the
   *  shared font-search ref never gets stolen by a duplicate hidden panel. */
  const trigger = (key: ItemKey, measuring = false, iconOnly = false): React.ReactNode => {
    const o = (k: ItemKey) => (measuring ? false : open === k);
    switch (key) {
      case 'find':
        return <ToolBtn title="Find in document (Ctrl + F)" active={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={18} /></ToolBtn>;
      case 'undo':
        return <ToolBtn title="Undo (Ctrl + Z)" onClick={() => ed.exec('undo')}><Undo2 size={18} /></ToolBtn>;
      case 'redo':
        return <ToolBtn title="Redo (Ctrl + Y)" onClick={() => ed.exec('redo')}><Redo2 size={18} /></ToolBtn>;
      case 'print':
        return <ToolBtn title="Print (Ctrl + P)" onClick={() => window.print()}><Printer size={18} /></ToolBtn>;
      case 'spell':
        return <ToolBtn title="Toggle spellcheck" active={spellCheck} onClick={() => setSpellCheck(!spellCheck)}><SpellCheck size={18} /></ToolBtn>;
      case 'zoom':
        return <ZoomControl zoom={zoom} setZoom={setZoom} open={o('zoom')} onOpenChange={(v) => setOpen(v ? 'zoom' : null)} />;
      case 'style':
        return <Dropdown open={o('style')} softOpen onOpenChange={(v) => setOpen(v ? 'style' : null)} title="Paragraph styles" label={iconOnly ? <Pilcrow size={18} /> : <span className="text-[13px]">{activeStyle.label}</span>} width={210}>{renderStylePanel()}</Dropdown>;
      case 'font':
        return (
          <Dropdown
            open={o('font')}
            onOpenChange={(v) => {
              setOpen(v ? 'font' : null);
              if (v && !ed.hasSelection()) {
                // Double rAF: the portaled panel mounts a tick after the state
                // flip, so wait for it before focusing the search box.
                requestAnimationFrame(() => requestAnimationFrame(() => fontSearchRef.current?.focus()));
              }
            }}
            title="Font"
            softOpen
            label={iconOnly ? <CaseSensitive size={18} /> : <span className="max-w-[130px] truncate text-[13px]">{font}</span>}
            width={290}
          >
            {renderFontPanel()}
          </Dropdown>
        );
      case 'size':
        /* − [11 ▾] + reads as one control: the two steppers walk the size
           ladder, the boxed number opens the full list. */
        return (
          <div className="flex h-8 flex-none items-center gap-0.5">
            <button
              type="button"
              title="Decrease font size"
              onMouseDown={keepSelection}
              onClick={() => stepSize(-1)}
              className="grid h-7 w-6 flex-none place-items-center rounded-md text-bb-900 transition-colors hover:bg-bb-200/60"
            >
              <Minus size={15} />
            </button>
            <Dropdown
              open={o('size')}
              softOpen
              boxed
              onOpenChange={(v) => setOpen(v ? 'size' : null)}
              title="Font size"
              label={iconOnly ? <ALargeSmall size={17} /> : <span className="text-[13px] tabular-nums">{size}</span>}
              width={92}
            >
              {renderSizePanel()}
            </Dropdown>
            <button
              type="button"
              title="Increase font size"
              onMouseDown={keepSelection}
              onClick={() => stepSize(1)}
              className="grid h-7 w-6 flex-none place-items-center rounded-md text-bb-900 transition-colors hover:bg-bb-200/60"
            >
              <Plus size={15} />
            </button>
          </div>
        );
      case 'bold':
        return <ToolBtn title="Bold (Ctrl + B)" active={ed.queryState('bold')} onClick={() => ed.exec('bold')}><Bold size={18} /></ToolBtn>;
      case 'italic':
        return <ToolBtn title="Italic (Ctrl + I)" active={ed.queryState('italic')} onClick={() => ed.exec('italic')}><Italic size={18} /></ToolBtn>;
      case 'underline':
        return <ToolBtn title="Underline (Ctrl + U)" active={ed.queryState('underline')} onClick={() => ed.exec('underline')}><Underline size={18} /></ToolBtn>;
      case 'textColor':
        return (
          <Dropdown open={o('textColor')} onOpenChange={(v) => setOpen(v ? 'textColor' : null)} title="Text colour" width={240}
            label={<span className="flex flex-col items-center leading-none"><Type size={16} /><span className="mt-0.5 h-[3px] w-4 rounded-sm" style={{ background: '#000000' }} /></span>}>
            {renderColorPanel()}
          </Dropdown>
        );
      case 'highlight':
        return (
          <Dropdown open={o('highlight')} onOpenChange={(v) => setOpen(v ? 'highlight' : null)} title="Highlight colour" width={240}
            label={<span className="flex flex-col items-center leading-none"><Highlighter size={16} /><span className="mt-0.5 h-[3px] w-4 rounded-sm bg-bb-400" /></span>}>
            {renderHighlightPanel()}
          </Dropdown>
        );
      case 'link':
        return <Dropdown open={o('link')} onOpenChange={(v) => setOpen(v ? 'link' : null)} label={<Link2 size={18} />} title="Insert link (Ctrl + K)" width={280}>{renderLinkPanel()}</Dropdown>;
      case 'image':
        return <ToolBtn title="Insert image" onClick={() => onInsertImage?.()}><ImageIcon size={18} /></ToolBtn>;
      case 'alignL':
        return <ToolBtn title="Align left" active={ed.queryState('justifyLeft')} onClick={() => ed.exec('justifyLeft')}><AlignLeft size={18} /></ToolBtn>;
      case 'alignC':
        return <ToolBtn title="Align centre" active={ed.queryState('justifyCenter')} onClick={() => ed.exec('justifyCenter')}><AlignCenter size={18} /></ToolBtn>;
      case 'alignR':
        return <ToolBtn title="Align right" active={ed.queryState('justifyRight')} onClick={() => ed.exec('justifyRight')}><AlignRight size={18} /></ToolBtn>;
      case 'alignJ':
        return <ToolBtn title="Justify" active={ed.queryState('justifyFull')} onClick={() => ed.exec('justifyFull')}><AlignJustify size={18} /></ToolBtn>;
      case 'bullet':
        return <ToolBtn title="Bulleted list" onClick={() => ed.exec('insertUnorderedList')}><List size={18} /></ToolBtn>;
      case 'number':
        return <ToolBtn title="Numbered list" onClick={() => ed.exec('insertOrderedList')}><ListOrdered size={18} /></ToolBtn>;
      case 'indentDec':
        return <ToolBtn title="Decrease indent" onClick={() => ed.exec('outdent')}><IndentDecrease size={18} /></ToolBtn>;
      case 'indentInc':
        return <ToolBtn title="Increase indent" onClick={() => ed.exec('indent')}><IndentIncrease size={18} /></ToolBtn>;
      case 'lineSpacing':
        return <Dropdown open={o('lineSpacing')} onOpenChange={(v) => setOpen(v ? 'lineSpacing' : null)} label={<Rows3 size={18} />} title="Line spacing" width={170}>{renderLineSpacingPanel()}</Dropdown>;
      case 'master':
        return <ToolBtn title="Master page — edit the header & footer shown on every page" active={masterOpen} onClick={() => onToggleMaster?.()}><Newspaper size={18} /></ToolBtn>;
      default:
        return null;
    }
  };

  /**
   * `divider` draws the hairline that fences off a group.
   *
   * It is a left border on the wrapper rather than a separate separator element
   * for two reasons: the measuring pass then counts the line in `offsetWidth`
   * (a standalone `<div>` would add width the fit calculation never sees, and
   * the pill would spill past its rounded edge), and it costs 1px instead of
   * ~9px. That matters — at 1440px the row is within ~20px of full, so padded
   * dividers push the last controls into the ⋮ strip. The row's own `gap-1.5`
   * supplies the space either side of the line.
   */
  const wrapped = (key: ItemKey, node: React.ReactNode, divider = false) => (
    <div
      key={key}
      data-item={key}
      data-essential={ESSENTIALS.has(key) ? 'true' : undefined}
      className={`flex-none ${divider ? 'border-l border-bb-300' : ''}`}
    >
      {node}
    </div>
  );

  /** The controls that fit in the pill, and which of them open a new group. */
  const inlineKeys = ALL_KEYS.filter((k) => !touch.has(k));
  const collapsedKeys = ALL_KEYS.filter((k) => touch.has(k));
  const startsGroup = (keys: readonly ItemKey[], i: number) =>
    i > 0 && GROUPS[keys[i]] !== GROUPS[keys[i - 1]];

  /* -------- overflow strip: scroll affordances --------
     The strip hides its scrollbar (rounded pill look), so fade the leading
     edge while more tools sit off-screen and let a vertical wheel scroll it
     horizontally. */
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripEdge, setStripEdge] = useState({ left: false, right: false });

  useEffect(() => {
    const el = stripRef.current;
    if (!el) {
      setStripEdge({ left: false, right: false });
      return;
    }
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setStripEdge({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
    };
    update();
    el.addEventListener('scroll', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, [moreOpen]);

  const stripMask = (() => {
    const stops: string[] = [];
    if (stripEdge.left) stops.push('transparent 0, #000 18px');
    else stops.push('#000 0');
    if (stripEdge.right) stops.push('#000 calc(100% - 18px), transparent 100%');
    else stops.push('#000 100%');
    return `linear-gradient(to right, ${stops.join(', ')})`;
  })();

  return (
    <div ref={outerRef} className="no-print z-30 flex flex-col items-center bg-white px-2 py-2 font-ui">
      <div
        ref={rootRef}
        className="relative flex w-full max-w-full flex-nowrap items-center rounded-full border border-bb-100 bg-bb-50 py-1 pl-4 pr-3 text-bb-900 shadow-sm"
      >
        {/* Inline pill row — one icon high, never wraps. */}
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-visible">
          {inlineKeys.map((k, i) => wrapped(k, trigger(k), startsGroup(inlineKeys, i)))}
        </div>

        <div className="flex-none pl-2" />

        {/* Pinned ⋮ — toggles the horizontal overflow strip. */}
        <div ref={pinnedRef} className="relative flex flex-none items-center pl-1">
          <ToolBtn
            title="More tools"
            active={moreOpen}
            onClick={() => setMoreOpen((m) => !m)}
          >
            <MoreHorizontal size={18} />
          </ToolBtn>
        </div>
      </div>

      {/* Horizontal overflow strip — icons only, spans the full width. */}
      {moreOpen && (
        <div className="mt-1.5 flex w-full justify-center">
          <div
            ref={stripRef}
            className="no-scrollbar flex h-10 w-full max-w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-full border border-bb-100 bg-bb-50 px-3 text-bb-900 shadow-sm"
            style={{ maskImage: stripMask, WebkitMaskImage: stripMask }}
          >
            {collapsedKeys.length > 0 && collapsedKeys.map((k) => wrapped(k, trigger(k, false, true)))}
            {collapsedKeys.length > 0 && <Sep />}
            <ToolBtn title="Strikethrough" onClick={() => ed.exec('strikeThrough')}><Strikethrough size={18} /></ToolBtn>
            <ToolBtn title="Subscript" onClick={() => ed.exec('subscript')}><Subscript size={18} /></ToolBtn>
            <ToolBtn title="Superscript" onClick={() => ed.exec('superscript')}><Superscript size={18} /></ToolBtn>
            <ToolBtn title="Clear formatting" onClick={() => ed.clearFormatting()}><Eraser size={18} /></ToolBtn>
            <Sep />
            <ToolBtn title="Hide the toolbar" onClick={onToggleToolbar}><ChevronUp size={18} /></ToolBtn>
          </div>
        </div>
      )}

      {/* Hidden measuring pass — every control rendered closed for width. */}
      <div
        ref={measurerRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 flex w-max flex-nowrap items-center gap-1.5 opacity-0"
      >
        {ALL_KEYS.map((k, i) => wrapped(k, trigger(k, true), startsGroup(ALL_KEYS, i)))}
      </div>

    </div>
  );
}

/* ---------- shared bits ---------- */

function Sep() {
  return <div className="mx-1 h-5 w-px bg-bb-300" />;
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
      className={`grid h-8 w-8 flex-none place-items-center rounded-md transition-colors ${
        active ? 'bg-bb-500 text-white' : 'text-bb-900 hover:bg-bb-200/60'
      }`}
    >
      {children}
    </button>
  );
}

function ZoomControl({
  zoom,
  setZoom,
  open,
  onOpenChange,
}: {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Close when clicking outside both the trigger and the portaled panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, onOpenChange]);

  // Panel position, portaled so the scrollable strip can't clip it.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - 160 - 8)), top: r.bottom + 6 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-none">
      <div className="flex h-8 items-center rounded-md text-bb-900 hover:bg-bb-200/60">
        <button onMouseDown={keepSelection} onClick={() => setZoom((z) => Math.max(50, z - 10))} className="grid h-8 w-7 place-items-center" title="Zoom out"><ZoomOut size={16} /></button>
        <button ref={btnRef} onMouseDown={keepSelection} onClick={() => onOpenChange(!open)} className="px-1 text-[13px]" title="Zoom level">{zoom}%</button>
        <button onMouseDown={keepSelection} onClick={() => setZoom((z) => Math.min(200, z + 10))} className="grid h-8 w-7 place-items-center" title="Zoom in"><ZoomIn size={16} /></button>
      </div>
      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            data-dropdown-panel
            className="dropdown fixed z-[60] w-40 rounded-md border border-gdoc-border bg-white py-1 text-[#2b2622] shadow-lg"
            style={{ left: pos.left, top: pos.top }}
          >
            {[50, 75, 90, 100, 125, 150, 200].map((p) => (
              <button key={p} onMouseDown={keepSelection} onClick={() => { setZoom(p); onOpenChange(false); }}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover">
                <span className="flex-1">{p}%</span>
                {zoom === p && <Check size={14} className="flex-none text-bb-600" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * A dropdown whose panel is portaled to <body> and pinned under the trigger.
 *
 * Portaling matters for two reasons:
 *  - controls inside the horizontally-scrollable ⋮ strip would otherwise have
 *    their panels clipped by the strip's overflow, and
 *  - a fixed-position panel at a high z-index can never slide underneath the
 *    pill, the menu bar, or the page canvas.
 */
function Dropdown({
  open,
  onOpenChange,
  label,
  children,
  width = 200,
  title,
  softOpen,
  boxed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  label: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  title?: string;
  /** When true, the open trigger shows a soft tint instead of the solid orange
   *  fill. Use for menu-toppers (font, paragraph style, size) that just open a
   *  panel rather than acting as a toggled state. */
  softOpen?: boolean;
  /** Draw the trigger as a bordered field instead of a bare button. Used by the
   *  font-size stepper, where the number sits in its own box between − and +. */
  boxed?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Keep the panel pinned below its trigger, clamped to the viewport.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
      setPos({ left, top: r.bottom + 6 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, width]);

  // Close when clicking outside both the trigger and the portaled panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, onOpenChange]);

  return (
    <div className="relative flex-none">
      <button
        ref={btnRef}
        title={title}
        onMouseDown={keepSelection}
        onClick={() => onOpenChange(!open)}
        className={
          boxed
            ? `flex h-7 min-w-[46px] items-center justify-center gap-1 rounded-md border bg-white px-1.5 text-bb-900 transition-colors ${
                open ? 'border-bb-400' : 'border-bb-200'
              } hover:border-bb-300`
            : `flex h-8 items-center justify-center gap-1 rounded-md px-2 transition-colors hover:bg-bb-200/60 ${
                open ? (softOpen ? 'bg-bb-200/60' : 'bg-bb-500 text-white') : ''
              }`
        }
      >
        {label}
        <ChevronDown size={boxed ? 12 : 14} className="flex-none" />
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            data-dropdown-panel
            className="dropdown fixed z-[60] overflow-hidden rounded-md border border-gdoc-border bg-white text-[#2b2622] shadow-lg"
            style={{ left: pos.left, top: pos.top, width }}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
