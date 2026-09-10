import { useEffect, useRef } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';

/** Publisher labels its master sheets with letters: A, B, C… */
function masterLabel(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

interface PageSidebarProps {
  pageCount: number;
  pageW: number;
  pageH: number;
  activePage: number;
  readOnly?: boolean;
  onSelectPage: (i: number) => void;
  onAddPage: () => void;
  onDeletePage: (i: number) => void;
  onDuplicatePage: (i: number) => void;
  /**
   * Renders page `i`'s content at full page size. The sidebar wraps it in a
   * scaled, clipped box, so thumbnails are true renderings rather than a
   * wireframe approximation.
   */
  renderPage: (i: number) => React.ReactNode;
  thumbWidth?: number;
  /** View > Master page: show the master sheets (letter-labelled) instead of
      the document's pages, and drop the add/duplicate/delete controls. */
  masterMode?: boolean;
}

export default function PageSidebar({
  pageCount,
  pageW,
  pageH,
  activePage,
  readOnly = false,
  onSelectPage,
  onAddPage,
  onDeletePage,
  onDuplicatePage,
  renderPage,
  thumbWidth = 132,
  masterMode = false,
}: PageSidebarProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the current page in view when navigation happens elsewhere (e.g. the
  // canvas scrolled, or a frame was linked onto a newly created page).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activePage]);

  const scale = thumbWidth / pageW;
  const thumbHeight = Math.round(pageH * scale);

  return (
    <div className="no-print flex w-[176px] flex-none flex-col border-r border-gdoc-border bg-[#faf7f4]">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gdoc-muted">
          {masterMode ? 'Master Pages' : 'Pages'}
        </span>
        {!readOnly && !masterMode && (
          <button
            onClick={onAddPage}
            title="Add page"
            className="grid h-6 w-6 place-items-center rounded text-gdoc-muted transition-colors hover:bg-bb-200/60 hover:text-bb-700"
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: pageCount }, (_, i) => {
            const active = i === activePage;
            return (
              <div key={i} className="group relative">
                <button
                  ref={active ? activeRef : undefined}
                  onClick={() => onSelectPage(i)}
                  className={`block w-full rounded-sm p-0.5 transition-colors ${
                    active
                      ? 'bg-bb-500/15 ring-2 ring-bb-500'
                      : 'hover:bg-bb-200/40 ring-1 ring-gdoc-border'
                  }`}
                  title={masterMode ? `Master sheet ${masterLabel(i)}` : `Go to page ${i + 1}`}
                >
                  <div
                    className={`relative overflow-hidden rounded-[2px] ${
                      masterMode ? 'bg-[#fef4e9] ring-1 ring-bb-400/60' : 'bg-white'
                    }`}
                    style={{ width: thumbWidth, height: thumbHeight }}
                  >
                    <div
                      style={{
                        width: pageW,
                        height: pageH,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                        pointerEvents: 'none',
                      }}
                    >
                      {renderPage(i)}
                    </div>
                  </div>
                </button>

                <div className="mt-1 flex items-center justify-between px-0.5">
                  <span
                      className={`text-[11px] ${active ? 'font-semibold text-bb-700' : 'text-gdoc-muted'}`}
                    >
                      {masterMode ? `Page ${masterLabel(i)}` : `Page ${i + 1}`}
                    </span>
                  {!readOnly && !masterMode && (
                    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => onDuplicatePage(i)}
                        title={`Duplicate page ${i + 1}`}
                        className="grid h-5 w-5 place-items-center rounded text-gdoc-muted hover:bg-bb-200/60 hover:text-bb-700"
                      >
                        <Copy size={12} />
                      </button>
                      {pageCount > 1 && (
                        <button
                          onClick={() => onDeletePage(i)}
                          title={`Delete page ${i + 1}`}
                          className="grid h-5 w-5 place-items-center rounded text-gdoc-muted hover:bg-bb-200/60 hover:text-red-600"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!readOnly && !masterMode && (
        <button
          onClick={onAddPage}
          className="flex items-center justify-center gap-1.5 border-t border-gdoc-border py-2 text-[12px] font-medium text-gdoc-muted transition-colors hover:bg-bb-200/40 hover:text-bb-700"
        >
          <Plus size={14} />
          Add page
        </button>
      )}
    </div>
  );
}
