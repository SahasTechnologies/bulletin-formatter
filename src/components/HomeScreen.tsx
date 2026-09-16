import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  Search,
  MoreVertical,
  Plus,
  Trash2,
  Upload,
  X,
  BookOpen,
  FileStack,
  Pencil,
  ImagePlus,
} from 'lucide-react';
import { TEMPLATES, type Template } from '../data/templates';
import type { StoredDocument } from '../lib/storage';
import { fuzzyMatchFields, type FieldedMatch } from '../lib/fuzzy';
import { MIN_H, MIN_W } from '../lib/frames';
import {
  columnRuleOffsets,
  COLUMN_RULE_COLOR,
  COLUMN_RULE_WIDTH,
  FRAME_COL_GAP,
  FRAME_PAD,
} from '../lib/textbox';

interface HomeScreenProps {
  recentDocs: StoredDocument[];
  onOpenTemplate: (tpl: Template) => void;
  onOpenRecent: (doc: StoredDocument) => void;
  onDeleteRecent: (id: string) => void;
  /** Delete every saved document at once, from the Recent documents header. */
  onDeleteAllRecents: () => void;
  /** Rename a saved document from its card (Enter or blur commits). */
  onRenameRecent: (id: string, title: string) => void;
  onImportFile: (file: File) => void;
  /** Merge several .bulletin files into one issue. */
  onMergeFiles: (files: File[]) => void;
  /** Open the Design Bible picker at /guide. */
  onOpenGuide: () => void;
}

/** One row of the search dropdown. */
type SearchHit =
  | { kind: 'doc'; doc: StoredDocument; score: number; titlePos: number[] }
  | { kind: 'template'; tpl: Template; score: number; titlePos: number[] };

/** Run the fuzzy query over templates and recent documents. */
function searchAll(query: string, recentDocs: StoredDocument[]): SearchHit[] {
  const q = query.trim();
  if (!q) return [];

  const hits: SearchHit[] = [];

  for (const tpl of TEMPLATES) {
    const m = fuzzyMatchFields(q, [
      { text: tpl.name, weight: 1 },
      { text: tpl.blurb, weight: 0.2 },
    ]);
    if (m) hits.push({ kind: 'template', tpl, score: m.score, titlePos: m.positions[0] });
  }

  for (const doc of recentDocs) {
    const m = fuzzyMatchFields(q, [{ text: doc.title, weight: 1 }]);
    if (m) hits.push({ kind: 'doc', doc, score: m.score, titlePos: m.positions[0] });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}

/** Split a title into plain/strong runs using the match positions. */
function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  const set = new Set(positions);
  const runs: { strong: boolean; text: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const strong = set.has(i);
    if (runs.length && runs[runs.length - 1].strong === strong) runs[runs.length - 1].text += text[i];
    else runs.push({ strong, text: text[i] });
  }
  return (
    <>
      {runs.map((r, i) =>
        r.strong ? (
          <mark key={i} className="bg-transparent font-semibold text-bb-700">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The sheet the editor actually lays out: A4 at 96dpi.
 *
 * The thumbnails used to be drawn on a Letter-shaped box (816×1056), so every
 * preview was a little wider and shorter than the page it stood for - and a
 * "Page of contents" that fits one sheet on screen looked like it no longer
 * would on paper. Same size, same shape, same furniture as the real thing.
 */
const DOC_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const PAGE_RATIO = `${DOC_WIDTH}/${PAGE_HEIGHT}`;

/** The master frame's inset from the trim, as the editor draws it. */
const FURNITURE_INSET = 48;

/**
 * Where a template's own frames start: `data-frame="96,80,602,…"` in every
 * template file, i.e. a 602px content column with a 96px side margin and an
 * 80px top one. Previews used to pad 56/64, which drew the type wider and
 * higher up the sheet than the page it stands for.
 */
const PAGE_INSET = { top: 80, left: 96, right: 96, bottom: 80 } as const;
const PAGE_PADDING = {
  padding: `${PAGE_INSET.top}px ${PAGE_INSET.right}px`,
} as const;
/** The content column's width on a previewed sheet - the same 602px the
    templates ask for, and the width a two-column rule is measured against. */
const PAGE_CONTENT_W = DOC_WIDTH - PAGE_INSET.left - PAGE_INSET.right;

/** Master furniture styles, matching the sheet's own running head and folio. */
const FURNITURE_STYLE = {
  fontFamily: "Biome,'Red Hat Text','Segoe UI',Arial,sans-serif",
  fontSize: 22,
  color: '#9a938a',
} as const;

/** Resolve the master's @page / @month / @year tokens with sample values, so a
    thumbnail shows the furniture the page really opens with. */
function sampleFurniture(text: string, page = 1): string {
  const now = new Date();
  return text
    .replace(/@page/g, String(page))
    .replace(/@month/g, now.toLocaleString('en-GB', { month: 'long' }))
    .replace(/@year/g, String(now.getFullYear()));
}

/** Miniature page thumbnail used for doc hits in the dropdown. */
function MiniDoc({ content }: { content: string }) {
  return (
    <div
      className="relative w-[30px] flex-none overflow-hidden rounded-[3px] border border-gdoc-border bg-white"
      style={{ aspectRatio: PAGE_RATIO }}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: DOC_WIDTH, transform: `scale(${30 / DOC_WIDTH})` }}
      >
        <div style={PAGE_PADDING} className="opacity-80" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  );
}

export default function HomeScreen({
  recentDocs,
  onOpenTemplate,
  onOpenRecent,
  onDeleteRecent,
  onDeleteAllRecents,
  onRenameRecent,
  onImportFile,
  onMergeFiles,
  onOpenGuide,
}: HomeScreenProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const mergeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => searchAll(query, recentDocs), [query, recentDocs]);

  // Close the dropdown on outside clicks.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  // Keep the highlighted row in view while arrowing through results.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, hits]);

  const reset = () => {
    setQuery('');
    setOpen(false);
    setActive(0);
  };

  const choose = (hit: SearchHit) => {
    reset();
    if (hit.kind === 'template') onOpenTemplate(hit.tpl);
    else onOpenRecent(hit.doc);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hits.length) {
        setOpen(true);
        setActive((a) => (a + 1) % hits.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active] ?? hits[0];
      if (hit) choose(hit);
    } else if (e.key === 'Escape') {
      if (query) reset();
      else setOpen(false);
    }
  };

  // Plain substring filtering for the template strip below the header.
  const q = query.trim().toLowerCase();
  const filteredTemplates = q
    ? TEMPLATES.filter(
        (t) => t.name.toLowerCase().includes(q) || t.blurb.toLowerCase().includes(q),
      )
    : TEMPLATES;
  const filteredRecents = q ? recentDocs.filter((d) => d.title.toLowerCase().includes(q)) : recentDocs;

  // Card sizes are fixed here: zooming the template picker lives in the editor
  // now, so the home screen stays a plain launcher.
  const cardW = 140;
  const cardMin = 170;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#f8f9fa] font-ui text-[#2b2622]">
      {/* ---- Top bar (static; only the content area below scrolls) ---- */}
      <header className="relative z-30 flex h-16 flex-none items-center gap-3 border-b border-gdoc-border bg-white px-4">
        <img
          src="/logo.webp"
          alt="Baulko Bulletin"
          className="h-8 w-8 flex-none object-contain"
        />
        <span className="flex-none text-[20px] font-medium">Formatter</span>

        <div ref={searchRef} className="relative mx-auto flex h-11 max-w-[640px] flex-1 items-center">
          <div className="flex h-full w-full items-center gap-3 rounded-full border border-gdoc-border bg-[#f8f9fa] px-4 focus-within:border-bb-400 focus-within:bg-white">
            <Search size={18} className="flex-none text-gdoc-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActive(0);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onSearchKey}
              placeholder="Search documents and templates"
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-gdoc-muted"
              aria-label="Search documents and templates"
              aria-expanded={open && hits.length > 0}
              aria-controls="home-search-results"
              role="combobox"
            />
            {query && (
              <button
                onClick={() => {
                  reset();
                  inputRef.current?.focus();
                }}
                className="flex-none rounded-full p-1 text-gdoc-muted hover:bg-gdoc-hover"
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {open && query.trim() && (
            <div
              id="home-search-results"
              role="listbox"
              className="dropdown absolute inset-x-0 top-full z-40 mt-2 max-h-[420px] overflow-y-auto rounded-lg border border-gdoc-border bg-white py-1 shadow-xl"
            >
              {hits.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-gdoc-muted">No results for “{query.trim()}”.</p>
              ) : (
                <div ref={listRef}>
                  {hits.map((hit, i) => {
                    const isActive = i === active;
                    const title = hit.kind === 'doc' ? hit.doc.title : hit.tpl.name;
                    return (
                      <button
                        key={hit.kind === 'doc' ? hit.doc.id : hit.tpl.id}
                        data-active={isActive || undefined}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(hit)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left ${isActive ? 'bg-gdoc-hover' : ''}`}
                        role="option"
                        aria-selected={isActive}
                      >
                        {hit.kind === 'doc' ? (
                          <MiniDoc content={hit.doc.content} />
                        ) : (
                          <FileText size={18} className="flex-none text-bb-600" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] text-[#2b2622]">
                            <Highlighted text={title} positions={hit.titlePos} />
                          </span>
                          <span className="block truncate text-[12px] text-gdoc-muted">
                            {hit.kind === 'doc'
                              ? `Opened ${new Date(hit.doc.updatedAt).toLocaleDateString([], {
                                  day: 'numeric',
                                  month: 'short',
                                })}`
                              : `Template - ${hit.tpl.blurb}`}
                          </span>
                        </span>
                        {hit.kind === 'template' && (
                          <span className="flex-none rounded border border-gdoc-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gdoc-muted">
                            New
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          className="flex flex-none items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-gdoc-muted hover:bg-gdoc-hover"
          onClick={onOpenGuide}
          title="Open the Design Bible picker"
        >
          <BookOpen size={18} />
          <span>Guide</span>
        </button>

        <button
          className="flex flex-none items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-gdoc-muted hover:bg-gdoc-hover"
          onClick={() => mergeRef.current?.click()}
          title="Merge several .bulletin files into one issue"
        >
          <FileStack size={18} />
          <span>Merge</span>
        </button>
        <input
          ref={mergeRef}
          type="file"
          accept=".bulletin,.json,application/json"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length) onMergeFiles(picked);
            e.target.value = '';
          }}
        />

        <button
          className="flex flex-none items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-gdoc-muted hover:bg-gdoc-hover"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={18} />
          <span>Import</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".bulletin,.json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = '';
          }}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1150px] px-6 pb-16">
        {/* ---- Start a new document ---- */}
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-medium text-[#3c4043]">Start a new document</h2>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-2">
            {filteredTemplates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => onOpenTemplate(tpl)}
                title={tpl.blurb}
                style={{ width: cardW }}
                className="group flex-none text-left"
              >
                <div className="relative w-full overflow-hidden rounded border border-gdoc-border bg-white shadow-sm transition-shadow hover:shadow-md">
                  {tpl.cover ? (
                    <CoverThumb label={tpl.cover.ph} />
                  ) : (
                    <ScaledDoc
                      content={tpl.content}
                      columns={tpl.frame?.columns}
                      master={tpl.master}
                      faint
                    />
                  )}
                  {/* The blank page wears a big plus, the way a document
                      picker should: "start from nothing". */}
                  {tpl.plus && (
                    <span className="pointer-events-none absolute inset-0 grid place-items-center">
                      <Plus
                        size={48}
                        strokeWidth={2}
                        className="text-bb-500 transition-transform group-hover:scale-110"
                      />
                    </span>
                  )}
                </div>
                <span className="mt-2 block w-full truncate text-[13px] font-medium text-[#3c4043]">
                  {tpl.name}
                </span>
              </button>
            ))}
            {filteredTemplates.length === 0 && (
              <p className="text-[13px] text-gdoc-muted">No templates match “{query}”.</p>
            )}
          </div>
        </section>

        {/* ---- Recent documents ---- */}
        <section className="mt-10">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-[18px] font-medium text-[#3c4043]">Recent documents</h2>
            {/* Only offered when there is something to delete - a "Delete
                all" over an empty list is a button that does nothing. */}
            {recentDocs.length > 0 && (
              <button
                onClick={onDeleteAllRecents}
                title="Delete every document saved in this browser"
                className="flex flex-none items-center gap-1.5 rounded px-2 py-1 text-[13px] text-gdoc-muted transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={14} />
                Delete all
              </button>
            )}
          </div>
          <p className="mb-4 text-[13px] text-gdoc-muted">
            {recentDocs.length === 0
              ? 'Documents you open will appear here. Pick a template above to get started.'
              : 'Your documents are saved in this browser.'}
          </p>

          {filteredRecents.length === 0 ? (
            <p className="text-[13px] text-gdoc-muted">
              {recentDocs.length === 0 ? '' : `No documents match “${query}”.`}
            </p>
          ) : (
            <div
              className="grid gap-x-4 gap-y-6"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cardMin}px, 1fr))` }}
            >
              {filteredRecents.map((doc) => (
                <RecentCard
                  key={doc.id}
                  doc={doc}
                  onOpen={() => onOpenRecent(doc)}
                  onDelete={() => onDeleteRecent(doc.id)}
                  onRename={(title) => onRenameRecent(doc.id, title)}
                />
              ))}
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}

function RecentCard({
  doc,
  onOpen,
  onDelete,
  onRename,
}: {
  doc: StoredDocument;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(doc.title);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => setDraft(doc.title), [doc.title]);

  const commit = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== doc.title) onRename(next);
    else setDraft(doc.title);
  };

  return (
    <div className="group">
      <button
        onClick={onOpen}
        className="block w-full overflow-hidden rounded border border-gdoc-border bg-white text-left shadow-sm transition-shadow hover:shadow-md"
      >
        <div className="relative">
          <ScaledDoc content={doc.content} />
          {/* Hover name overlay */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/25 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </button>

      <div ref={boxRef} className="relative mt-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {renaming ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setDraft(doc.title);
                    setRenaming(false);
                  }
                }}
                onBlur={commit}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded border border-bb-400 px-1 text-[14px] font-medium text-[#3c4043] outline-none"
                aria-label="Document name"
              />
            ) : (
              <button
                onClick={onOpen}
                className="block w-full truncate text-left text-[14px] font-medium text-[#3c4043] hover:text-bb-700"
                title={doc.title}
              >
                {doc.title}
              </button>
            )}
            <p className="truncate text-[12px] text-gdoc-muted">Opened {formatOpened(doc.updatedAt)}</p>
          </div>

          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded p-1 text-gdoc-muted opacity-0 transition-opacity hover:bg-gdoc-hover focus:opacity-100 group-hover:opacity-100"
            title="More actions"
            aria-label="More actions"
          >
            <MoreVertical size={16} />
          </button>
        </div>

        {menuOpen && (
          <div className="dropdown absolute right-0 top-full z-30 mt-1 w-40 rounded-md border border-gdoc-border bg-white py-1 text-[#2b2622] shadow-lg">
            <button
              onClick={() => {
                setMenuOpen(false);
                onOpen();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
            >
              <FileText size={14} className="text-gdoc-muted" />
              Open
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setDraft(doc.title);
                setRenaming(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-gdoc-hover"
            >
              <Pencil size={14} className="text-gdoc-muted" />
              Rename
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-gdoc-hover"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Format a timestamp as "1:34 PM" style. */
function formatOpened(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** The title page opens as a full-page picture, so its card previews as an
    empty image frame rather than a blank sheet. */
function CoverThumb({ label }: { label: string }) {
  return (
    <div
      className="relative w-full"
      style={{ aspectRatio: PAGE_RATIO, background: '#fff' }}
    >
      <div className="absolute inset-2 grid place-items-center rounded-[3px] border border-dashed border-gdoc-border bg-[#faf8f5]">
        <span className="flex flex-col items-center gap-1 text-gdoc-muted">
          <ImagePlus size={22} />
          <span className="px-2 text-center text-[10px] leading-tight">Add {label}</span>
        </span>
      </div>
    </div>
  );
}

/** One object of a laid-out template: where it sits, and what to draw there. */
interface ThumbBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** `line`, `shape` or `tombstone` when the object is not text. */
  kind?: string;
  stroke?: string;
  thickness?: number;
  columns: number;
  html: string;
}

/**
 * Read a template's own objects, the way the canvas does.
 *
 * A template laid out with `data-frame="x,y,w,h"` is one object per element -
 * what the formatter opens is four or five movable frames, not a stack of
 * blocks. Returns null for the templates that have no such layout, which are
 * previewed as flowing content instead.
 */
function thumbBoxes(content: string): ThumbBox[] | null {
  if (!content.includes('data-frame=')) return null;
  const host = document.createElement('div');
  host.innerHTML = content;
  const out: ThumbBox[] = [];
  Array.from(host.children).forEach((node, i) => {
    const spec = node.getAttribute('data-frame');
    if (!spec) return;
    const nums = spec.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (nums.length < 4) return;
    const [x, y, w, h] = nums;
    const el = node as HTMLElement;
    out.push({
      key: `t${i}-${x}-${y}`,
      x,
      y,
      w,
      h,
      kind: el.getAttribute('data-kind') ?? undefined,
      stroke: el.getAttribute('data-stroke') ?? undefined,
      thickness: Math.round(Number(el.getAttribute('data-thickness'))) || undefined,
      columns: Math.max(1, Math.round(Number(el.getAttribute('data-columns'))) || 1),
      html: el.outerHTML,
    });
  });
  return out.length ? out : null;
}

/**
 * The objects of a laid-out template, drawn where the template puts them.
 *
 * A preview used to pour every template into one padded column, so a page whose
 * parts are separate objects - the article's headline, byline, rule and body, or
 * the poem's five - was shown as a stack that the formatter never opens, with
 * the body flowing out of the headline instead of starting under the rule.
 * Drawing the objects at their own coordinates costs nothing and makes the card
 * the page.
 */
function LayoutThumb({ boxes }: { boxes: ThumbBox[] }) {
  return (
    <>
      {boxes.map((b) => {
        if (b.kind === 'line') {
          const thickness = b.thickness ?? COLUMN_RULE_WIDTH;
          // Draw the bar where the editor will: a line frame is clamped to a
          // 60px minimum (MIN_W / MIN_H) and the bar runs through its middle,
          // so a template that declared a shorter box still opens with its bar
          // at the same centre. The bar itself stays the declared thickness.
          const cx = b.x + Math.max(b.w, MIN_W) / 2;
          const cy = b.y + Math.max(b.h, MIN_H) / 2;
          return (
            <span
              key={b.key}
              className="pointer-events-none absolute block rounded-full"
              style={{
                left: cx - b.w / 2,
                top: cy - thickness / 2,
                width: b.w,
                height: thickness,
                background: b.stroke ?? COLUMN_RULE_COLOR,
              }}
            />
          );
        }
        if (b.kind === 'tombstone') {
          return (
            <span
              key={b.key}
              className="pointer-events-none absolute block rounded-[4px] bg-[#1f1f1f]"
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
            />
          );
        }
        const cols = b.columns > 1 ? b.columns : undefined;
        // The editor clamps a frame's size to its 60px-wide / 40px-high
        // minimums; mirror that here so the thumbnail never promises a size
        // the sheet does not open with (the editorial's 56px icon used to
        // render at 56 in the preview and 60 on the page).
        const w = Math.max(b.w, MIN_W);
        const h = Math.max(b.h, MIN_H);
        return (
          <div
            key={b.key}
            className="pointer-events-none absolute overflow-hidden"
            style={{
              left: b.x,
              top: b.y,
              width: w,
              height: h,
              padding: FRAME_PAD,
              columnCount: cols,
              columnGap: cols ? FRAME_COL_GAP : undefined,
              columnFill: 'auto',
            }}
            dangerouslySetInnerHTML={{ __html: b.html }}
          />
        );
      })}
    </>
  );
}

/** Render document HTML scaled down to fit its container, like a page icon.
    `columns` mirrors a template's text-frame columns so a two-column page
    previews with its gray rule, not as one wide column, and `master` draws the
    running head and folio that every page opens with but the content HTML does
    not contain. */
function ScaledDoc({
  content,
  faint,
  columns,
  master,
}: {
  content: string;
  faint?: boolean;
  columns?: number;
  master?: { header: string; footer: string };
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  // A template that laid itself out is drawn object by object; anything else
  // (a single text frame, a per-element split) flows in one column as before.
  const objects = useMemo(() => thumbBoxes(content), [content]);
  const cols = Math.max(1, Math.round(columns ?? 1));

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / DOC_WIDTH || 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={boxRef}
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: PAGE_RATIO, background: '#fff' }}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: DOC_WIDTH, transform: scale ? `scale(${scale})` : undefined }}
      >
        {master && (
          <>
            <div className="absolute text-right" style={{ ...FURNITURE_STYLE, top: 28, right: FURNITURE_INSET }}>
              {sampleFurniture(master.header)}
            </div>
            <div className="absolute" style={{ ...FURNITURE_STYLE, bottom: 24, left: FURNITURE_INSET }}>
              {sampleFurniture(master.footer)}
            </div>
          </>
        )}
        <div
          className={`relative ${faint ? 'opacity-70' : ''}`}
          style={objects ? { width: DOC_WIDTH, height: PAGE_HEIGHT } : PAGE_PADDING}
        >
          {objects ? (
            <LayoutThumb boxes={objects} />
          ) : (
          <div
            style={{
              columnCount: cols,
              columnGap: cols > 1 ? FRAME_COL_GAP : undefined,
              // The sheet's fill order: column 1 to the bottom, then column 2.
              columnFill: 'auto',
            }}
            dangerouslySetInnerHTML={{ __html: content }}
          />
          )}
          {/* The rule between columns is drawn rather than left to CSS: a
              `column-rule` has square ends, and every other line in the app is
              a rounded bar (see `columnRuleOffsets`). A laid-out template draws
              its own rules, and its body has its own measure. */}
          {cols > 1 && !objects && (
            <div
              className="pointer-events-none absolute"
              style={{
                top: PAGE_INSET.top,
                bottom: PAGE_INSET.bottom,
                left: PAGE_INSET.left,
                right: PAGE_INSET.right,
              }}
              aria-hidden="true"
            >
              {columnRuleOffsets(cols, PAGE_CONTENT_W, FRAME_COL_GAP, COLUMN_RULE_WIDTH).map(
                (left, i) => (
                  <span
                    key={i}
                    className="absolute top-0 bottom-0 block rounded-full"
                    style={{ left, width: COLUMN_RULE_WIDTH, background: COLUMN_RULE_COLOR }}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
