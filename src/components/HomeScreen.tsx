import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Search, MoreVertical, Trash2, Upload, X } from 'lucide-react';
import { TEMPLATES, type Template } from '../data/templates';
import type { StoredDocument } from '../lib/storage';
import { fuzzyMatchFields, type FieldedMatch } from '../lib/fuzzy';

interface HomeScreenProps {
  recentDocs: StoredDocument[];
  onOpenTemplate: (tpl: Template) => void;
  onOpenRecent: (doc: StoredDocument) => void;
  onDeleteRecent: (id: string) => void;
  onImportFile: (file: File) => void;
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
      { text: tpl.subtitle, weight: 0.5 },
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

const DOC_WIDTH = 816; // matches A4 page width in px

/** Miniature page thumbnail used for doc hits in the dropdown. */
function MiniDoc({ content }: { content: string }) {
  return (
    <div
      className="relative w-[30px] flex-none overflow-hidden rounded-[3px] border border-gdoc-border bg-white"
      style={{ aspectRatio: '816/1056' }}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: DOC_WIDTH, transform: `scale(${30 / DOC_WIDTH})` }}
      >
        <div className="px-14 py-16 opacity-80" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  );
}

export default function HomeScreen({
  recentDocs,
  onOpenTemplate,
  onOpenRecent,
  onDeleteRecent,
  onImportFile,
}: HomeScreenProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
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
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.subtitle.toLowerCase().includes(q) ||
          t.blurb.toLowerCase().includes(q),
      )
    : TEMPLATES;
  const filteredRecents = q ? recentDocs.filter((d) => d.title.toLowerCase().includes(q)) : recentDocs;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#f8f9fa] font-ui text-[#2b2622]">
      {/* ---- Top bar (static; only the content area below scrolls) ---- */}
      <header className="relative z-30 flex h-16 flex-none items-center gap-3 border-b border-gdoc-border bg-white px-4">
        <img
          src="/logo.webp"
          alt="Baulko Bulletin"
          className="h-8 w-8 flex-none object-contain"
        />
        <span className="flex-none text-[20px] font-medium">Bulletin</span>

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
                    const title =
                      hit.kind === 'doc' ? hit.doc.title : hit.tpl.subtitle ? `${hit.tpl.name} · ${hit.tpl.subtitle}` : hit.tpl.name;
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
                              : `Template — ${hit.tpl.blurb}`}
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
                className="group w-[140px] flex-none text-left"
              >
                <div className="w-full overflow-hidden rounded border border-gdoc-border bg-white shadow-sm transition-shadow hover:shadow-md">
                  <ScaledDoc content={tpl.content} faint />
                </div>
                <span className="mt-2 block w-full truncate text-[13px] font-medium text-[#3c4043]">
                  {tpl.name}
                </span>
                {tpl.subtitle && (
                  <span className="block w-full truncate text-[12px] text-gdoc-muted">{tpl.subtitle}</span>
                )}
              </button>
            ))}
            {filteredTemplates.length === 0 && (
              <p className="text-[13px] text-gdoc-muted">No templates match “{query}”.</p>
            )}
          </div>
        </section>

        {/* ---- Recent documents ---- */}
        <section className="mt-10">
          <h2 className="mb-1 text-[18px] font-medium text-[#3c4043]">Recent documents</h2>
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {filteredRecents.map((doc) => (
                <RecentCard
                  key={doc.id}
                  doc={doc}
                  onOpen={() => onOpenRecent(doc)}
                  onDelete={() => onDeleteRecent(doc.id)}
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
}: {
  doc: StoredDocument;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

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
          <div className="min-w-0">
            <button
              onClick={onOpen}
              className="block w-full truncate text-left text-[14px] font-medium text-[#3c4043] hover:text-bb-700"
              title={doc.title}
            >
              {doc.title}
            </button>
            <p className="truncate text-[12px] text-gdoc-muted">
              <span className="mr-1 inline-block h-3 w-3 rounded-[3px] bg-bb-400 align-middle" />
              Opened {formatOpened(doc.updatedAt)}
            </p>
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

/** Render document HTML scaled down to fit its container, like a page icon. */
function ScaledDoc({ content, faint }: { content: string; faint?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

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
      style={{ aspectRatio: '816/1056', background: '#fff' }}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: DOC_WIDTH, transform: scale ? `scale(${scale})` : undefined }}
      >
        <div
          className={`px-14 py-16 ${faint ? 'opacity-70' : ''}`}
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    </div>
  );
}
