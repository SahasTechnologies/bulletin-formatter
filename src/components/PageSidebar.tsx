import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Move,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

/** Publisher labels its master sheets with letters: A, B, C… */
function masterLabel(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

/** Remember the two-page spread so the pane opens the way it was left. */
const SPREAD_KEY = 'bulletin.pagesSpread';

interface PageSidebarProps {
  pageCount: number;
  pageW: number;
  pageH: number;
  activePage: number;
  readOnly?: boolean;
  /** Names the user has given the pages (index = page number - 1). */
  pageNames?: string[];
  onSelectPage: (i: number) => void;
  /** Insert a blank page at `index`, shifting the later pages down. */
  onAddPageAt: (index: number) => void;
  /** Import a PDF at `index`; its pages become pages of the document. */
  onImportPdf: (index: number) => void;
  onDeletePage: (i: number) => void;
  /** Duplicate page `i`, content and all, right after it. */
  onDuplicatePage: (i: number) => void;
  /** Duplicate page `i`'s layout with the text boxes emptied. */
  onDuplicatePageBlank: (i: number) => void;
  /** Move page `from` so that it sits at index `to`. */
  onMovePage: (from: number, to: number) => void;
  onRenamePage: (i: number, name: string) => void;
  /** The master pages this publication carries, for the context menu. */
  masters?: { id: string; description: string }[];
  /** The master a page is dressed by (null when the page carries none). */
  masterOf?: (i: number) => string | null;
  /** Dress one page in a different master. */
  onAssignMaster?: (i: number, id: string) => void;
  /**
   * Renders page `i`'s content at full page size. The sidebar wraps it in a
   * scaled, clipped box, so thumbnails are true renderings rather than a
   * wireframe approximation.
   */
  renderPage: (i: number) => React.ReactNode;
  thumbWidth?: number;
  /** View > Master page: show the master pages instead of the document's
      pages, and drop the page controls. */
  masterMode?: boolean;
  /** Publisher lists its master pages by Page ID and description; one tile per
      master, with the one being edited selected. */
  masterTiles?: { id: string; description: string }[];
  /** Open a different master for editing (master view only). */
  onSelectMaster?: (id: string) => void;
}

/** Where a drag would drop: the slot above page `at`. */
type DropSlot = number;

export default function PageSidebar({
  pageCount,
  pageW,
  pageH,
  activePage,
  readOnly = false,
  pageNames,
  onSelectPage,
  onAddPageAt,
  onImportPdf,
  onDeletePage,
  onDuplicatePage,
  onDuplicatePageBlank,
  onMovePage,
  onRenamePage,
  masters,
  masterOf,
  onAssignMaster,
  renderPage,
  thumbWidth = 132,
  masterMode = false,
  masterTiles,
  onSelectMaster,
}: PageSidebarProps) {
  const tile = (i: number) => masterTiles?.[i];
  const activeRef = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  /** The page the context menu / a dialog was opened on. */
  const [menu, setMenu] = useState<{ x: number; y: number; page: number } | null>(null);
  const [masterSub, setMasterSub] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: 'move' | 'rename' | 'master'; page: number } | null
  >(null);
  /** Two-page spread: page 1 alone, then 2–3, 4–5… as facing pairs. */
  const [spread, setSpread] = useState(() => {
    try {
      return localStorage.getItem(SPREAD_KEY) === '1';
    } catch {
      return false;
    }
  });
  /** The page being dragged and the slot it is hovering. */
  const [drag, setDrag] = useState<{ from: number; over: DropSlot | null } | null>(null);

  const canEdit = !readOnly && !masterMode;

  useEffect(() => {
    try {
      localStorage.setItem(SPREAD_KEY, spread ? '1' : '0');
    } catch {
      /* private mode - the choice just does not stick */
    }
  }, [spread]);

  // Keep the current page in view when navigation happens elsewhere (e.g. a
  // frame was linked onto a newly created page).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activePage]);

  // Escape closes whatever is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenu(null);
      setMasterSub(false);
      setDialog(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setMasterSub(false);
  }, []);

  const nameOf = (i: number) => (pageNames?.[i] ?? '').trim();

  /** Page 1 / Page 4 · Sports results */
  const labelOf = (i: number) => {
    const n = nameOf(i);
    return n ? `Page ${i + 1} · ${n}` : `Page ${i + 1}`;
  };

  const openMenu = (e: React.MouseEvent, i: number) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const W = 232;
    const H = 300;
    setMasterSub(false);
    setMenu({
      x: Math.max(6, Math.min(e.clientX, window.innerWidth - W - 6)),
      y: Math.max(6, Math.min(e.clientY, window.innerHeight - H)),
      page: i,
    });
  };

  const scale = thumbWidth / pageW;
  const thumbHeight = Math.round(pageH * scale);

  /* Two-page spread sizing. The pair must fit the (wider) pane exactly: a row
     that is wider than its container centre-aligns and then overflows on both
     sides, and the left half can never be scrolled back into view. */
  const paneWidth = spread && !masterMode ? 312 : 176;
  const PANE_PAD = 12; // px-3
  const SCROLLBAR = 12; // reserved gutter
  const PAIR_GAP = 12;
  /** One sheet of a facing pair: pane − padding − gutter, halved. */
  const pairTileW = Math.floor(
    (paneWidth - PANE_PAD * 2 - SCROLLBAR - PAIR_GAP) / 2,
  ) - 4;

  /* ----- two-page spread: page 1, then facing pairs 2–3, 4–5… ----- */
  const rows = useMemo(() => {
    if (!spread || masterMode) {
      return Array.from({ length: pageCount }, (_, i) => [i]);
    }
    // Page 1 stands alone (it is the cover), then 2–3, 4–5 … face each other.
    const out: number[][] = [];
    for (let i = 0; i < pageCount; i++) {
      if (i === 0) out.push([0]);
      else if (i % 2 === 1) out.push([i, i + 1].filter((p) => p < pageCount));
    }
    return out;
  }, [pageCount, spread, masterMode]);

  /**
   * The strip that lives in the space between two sheets. Hovering it opens a
   * little more room - the pages below slide down - and offers the two ways to
   * make a page: a blank one (`+`), or a PDF whose pages drop in one after
   * another. `after` is the page the new ones follow, so the strip below the
   * last sheet appends at the end.
   */
  const gapStrip = (after: number) => (
    <div
      className="group/gap relative z-10 flex h-[22px] items-center justify-center transition-[height] duration-150 ease-out hover:h-[54px]"
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        setDrag((d) => (d ? { ...d, over: after } : d));
      }}
      onDrop={(e) => {
        if (!drag) return;
        e.preventDefault();
        dropAt(after);
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 -top-2 -bottom-2" />
      <div className="flex items-center gap-2 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/gap:opacity-100">
        <button
          onClick={() => onAddPageAt(after)}
          title={
            after >= pageCount ? 'Insert a page at the end' : `Insert a page after page ${after}`
          }
          aria-label="Insert a page here"
          className="grid h-7 w-7 place-items-center rounded-full border border-bb-400/70 bg-white text-bb-700 shadow-sm transition-colors hover:bg-bb-500 hover:text-white"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={() => onImportPdf(after)}
          title="Insert a PDF here - its pages become pages of the document"
          aria-label="Insert a PDF here"
          className="grid h-7 w-7 place-items-center rounded-full border border-bb-400/70 bg-white text-bb-700 shadow-sm transition-colors hover:bg-bb-500 hover:text-white"
        >
          <FileText size={13} />
        </button>
      </div>
    </div>
  );

  /**
   * Drop the page being dragged into slot `slot` (the gap above page `slot`).
   * The slot is in the *original* numbering, so it becomes `slot - 1` once the
   * dragged page has been lifted out of the list.
   */
  const dropAt = (slot: DropSlot) => {
    if (!drag) return;
    const from = drag.from;
    const to = from < slot ? slot - 1 : slot;
    setDrag(null);
    if (to !== from) onMovePage(from, Math.max(0, Math.min(to, pageCount - 1)));
  };

  /** One page tile: thumbnail, name, and everything the pane can do to it. */
  const pageTile = (i: number, tileW: number) => {
    const active = i === activePage;
    const s = tileW / pageW;
    const h = Math.round(pageH * s);
    const dragging = drag?.from === i;
    return (
      // A fixed width (the thumbnail plus the selected ring's padding) keeps
      // the sheet centred in the pane and stops a facing pair from widening
      // past the pane's edge.
      <div className="group relative mx-auto" style={{ width: tileW + 4 }}>
        {drag && drag.over === i && <div className="page-drop-line" aria-hidden="true" />}
        <div
          className={`page-tile ${dragging ? 'is-dragging' : ''}`}
          draggable={canEdit}
          onDragStart={(e) => {
            if (!canEdit) return;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
            setDrag({ from: i, over: null });
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => {
            if (!canEdit || !drag) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const above = e.clientY < r.top + r.height / 2;
            setDrag((d) => (d ? { ...d, over: above ? i : i + 1 } : d));
          }}
          onDrop={(e) => {
            if (!canEdit || !drag) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            dropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
          }}
        >
          {/* `mx-auto` keeps the sheet centred in the pane: the thumbnail is
              narrower than the pane, and without it the whole difference
              landed on the right. */}
          <button
            ref={active ? activeRef : undefined}
            onClick={() =>
              masterMode && tile(i) && onSelectMaster
                ? onSelectMaster(tile(i)!.id)
                : onSelectPage(i)
            }
            onContextMenu={(e) => openMenu(e, i)}
            className={`mx-auto block rounded-sm p-0.5 transition-colors ${
              active
                ? 'bg-bb-500/15 ring-2 ring-bb-500'
                : 'ring-1 ring-gdoc-border hover:bg-bb-200/40'
            }`}
            title={
              masterMode
                ? `Edit ${
                    tile(i)
                      ? `${tile(i)!.id} - ${tile(i)!.description}`
                      : `master sheet ${masterLabel(i)}`
                  }`
                : canEdit
                  ? `${labelOf(i)} - click to go there, right-click for page options, drag to reorder`
                  : `Go to page ${i + 1}`
            }
          >
            <div
              className={`relative overflow-hidden rounded-[2px] ${
                masterMode ? 'bg-[#fef4e9] ring-1 ring-bb-400/60' : 'bg-white'
              }`}
              style={{ width: tileW, height: h }}
            >
              <div
                style={{
                  width: pageW,
                  height: pageH,
                  transform: `scale(${s})`,
                  transformOrigin: 'top left',
                  pointerEvents: 'none',
                }}
              >
                {renderPage(i)}
              </div>
            </div>
          </button>

          <div className="mt-1 flex items-center justify-center px-0.5">
            <span
              className={`truncate text-[11px] ${active ? 'font-semibold text-bb-700' : 'text-gdoc-muted'}`}
              title={masterMode && tile(i) ? tile(i)!.description : labelOf(i)}
            >
              {masterMode
                ? tile(i)
                  ? `Master ${tile(i)!.id}`
                  : `Page ${masterLabel(i)}`
                : labelOf(i)}
            </span>
          </div>
        </div>
        {drag && drag.over === i + 1 && i === pageCount - 1 && (
          <div className="page-drop-line" aria-hidden="true" />
        )}
      </div>
    );
  };

  return (
    <div
      className="no-print flex flex-none flex-col border-r border-gdoc-border bg-[#faf7f4] transition-[width] duration-150"
      style={{ width: paneWidth }}
    >
      {/* No header bar: the pane is the page list, and everything it can do
          lives on the pages themselves (right-click, drag, the gap buttons). */}
      <div
        ref={paneRef}
        className="page-pane-scroll flex-1 overflow-y-auto px-3 pb-4 pt-6"
      >
        <div className="flex flex-col">
          {masterMode
            ? Array.from({ length: pageCount }, (_, i) => (
                <Fragment key={i}>{pageTile(i, thumbWidth)}</Fragment>
              ))
            : rows.map((row) => (
                <Fragment key={`row-${row[0]}`}>
                  {row.length === 1 ? (
                    pageTile(row[0], thumbWidth)
                  ) : (
                    <div
                      className="flex items-start justify-center"
                      style={{ gap: PAIR_GAP }}
                    >
                      {row.map((p) => (
                        <Fragment key={p}>{pageTile(p, pairTileW)}</Fragment>
                      ))}
                    </div>
                  )}
                  {canEdit && row[row.length - 1] < pageCount - 1 && gapStrip(row[row.length - 1] + 1)}
                </Fragment>
              ))}
          {canEdit && pageCount > 0 && gapStrip(pageCount)}
        </div>
      </div>

      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeMenu();
            }}
          />
          <div
            className="fixed z-50 w-[232px] rounded-md border border-gdoc-border bg-white py-1 text-[12px] text-[#2b2622] shadow-xl"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
          >
            <MenuRow
              icon={<Plus size={13} />}
              label={`Insert page below`}
              hint={`Page ${menu.page + 2}`}
              onClick={() => {
                closeMenu();
                onAddPageAt(menu.page + 1);
              }}
            />
            <MenuRow
              icon={<FileText size={13} />}
              label="Insert PDF below"
              onClick={() => {
                closeMenu();
                onImportPdf(menu.page + 1);
              }}
            />
            <MenuRow
              icon={<ImageIcon size={13} />}
              label="Insert duplicate page"
              hint="text cleared"
              onClick={() => {
                closeMenu();
                onDuplicatePageBlank(menu.page + 1);
              }}
            />
            <MenuRow
              icon={<Copy size={13} />}
              label="Duplicate page"
              hint="with content"
              onClick={() => {
                closeMenu();
                onDuplicatePage(menu.page);
              }}
            />
            <div className="divider-bar my-1" />
            <MenuRow
              icon={<Move size={13} />}
              label="Move page…"
              onClick={() => {
                closeMenu();
                setDialog({ kind: 'move', page: menu.page });
              }}
            />
            <MenuRow
              icon={<Pencil size={13} />}
              label="Rename page…"
              onClick={() => {
                closeMenu();
                setDialog({ kind: 'rename', page: menu.page });
              }}
            />
            <div className="divider-bar my-1" />
            {masters && masters.length > 0 && (
              <>
                <MenuRow
                  icon={<LayoutTemplate size={13} />}
                  label="Master page"
                  hint={
                    (masterOf?.(menu.page) &&
                      masters.find((m) => m.id === masterOf(menu.page))?.id) ||
                    'none'
                  }
                  chevron
                  onClick={() => setMasterSub((v) => !v)}
                />
                {masterSub && (
                  <div className="mb-1 ml-3 border-l border-gdoc-border pl-1">
                    {masters.map((m) => {
                      const on = masterOf?.(menu.page) === m.id;
                      return (
                        <MenuRow
                          key={m.id}
                          indent
                          label={`Master ${m.id} - ${m.description}`}
                          hint={on ? 'wearing' : undefined}
                          onClick={() => {
                            closeMenu();
                            onAssignMaster?.(menu.page, m.id);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
            <MenuRow
              icon={<LayoutTemplate size={13} />}
              label="View two-page spread"
              hint={spread ? 'on' : 'off'}
              onClick={() => {
                closeMenu();
                setSpread((v) => !v);
              }}
            />
            <div className="divider-bar my-1" />
            <MenuRow
              icon={<Trash2 size={13} />}
              label="Delete page"
              danger
              disabled={pageCount <= 1}
              onClick={() => {
                closeMenu();
                onDeletePage(menu.page);
              }}
            />
          </div>
        </>
      )}

      {dialog?.kind === 'move' && (
        <MovePageDialog
          page={dialog.page}
          pageCount={pageCount}
          labelOf={(i) => (nameOf(i) ? `Page ${i + 1}. ${nameOf(i)}` : `Page ${i + 1}. Page Title`)}
          onCancel={() => setDialog(null)}
          onOk={(where, target) => {
            setDialog(null);
            const from = dialog.page;
            // The page lands before or after the target, in the list as it
            // stands now; `onMovePage` takes the final index.
            let to = where === 'before' ? target : target + 1;
            if (from < to) to -= 1;
            onMovePage(from, Math.max(0, Math.min(to, pageCount - 1)));
          }}
        />
      )}

      {dialog?.kind === 'rename' && (
        <RenamePageDialog
          page={dialog.page}
          initial={nameOf(dialog.page)}
          onCancel={() => setDialog(null)}
          onOk={(name) => {
            setDialog(null);
            onRenamePage(dialog.page, name);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- menu rows -- */

function MenuRow({
  icon,
  label,
  hint,
  chevron,
  indent,
  danger,
  disabled,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  chevron?: boolean;
  indent?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-[5px] text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed text-gdoc-muted/50'
          : danger
            ? 'hover:bg-red-50 hover:text-red-700'
            : 'hover:bg-bb-200/50'
      } ${indent ? 'pl-2 text-[11px]' : ''}`}
    >
      {icon && <span className="flex-none text-gdoc-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="flex-none text-[10px] text-gdoc-muted">{hint}</span>}
      {chevron && <span className="flex-none text-[10px] text-gdoc-muted">▸</span>}
    </button>
  );
}

/* --------------------------------------------------------------- dialogs -- */

/** Publisher's Move Page: before/after this page, picked from the list. */
function MovePageDialog({
  page,
  pageCount,
  labelOf,
  onOk,
  onCancel,
}: {
  page: number;
  pageCount: number;
  labelOf: (i: number) => string;
  onOk: (where: 'before' | 'after', target: number) => void;
  onCancel: () => void;
}) {
  const [where, setWhere] = useState<'before' | 'after'>('after');
  const [target, setTarget] = useState(Math.min(page + 1, pageCount - 1));
  useEffect(() => {
    setTarget(Math.min(where === 'before' ? Math.max(0, page - 1) : page + 1, pageCount - 1));
  }, [where, page, pageCount]);

  return (
    <Modal title="Move Page" onClose={onCancel}>
      <p className="mb-2 text-[12px]">Move selected pages:</p>
      <div className="mb-3 flex flex-col gap-1.5 text-[12px]">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="move-where"
            checked={where === 'before'}
            onChange={() => setWhere('before')}
          />
          Before
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="move-where"
            checked={where === 'after'}
            onChange={() => setWhere('after')}
          />
          After
        </label>
      </div>
      <p className="mb-1 text-[12px]">This page:</p>
      <div className="mb-3 max-h-[190px] overflow-y-auto border border-gdoc-border bg-white">
        {Array.from({ length: pageCount }, (_, i) => (
          <button
            key={i}
            type="button"
            disabled={i === page}
            onClick={() => setTarget(i)}
            className={`block w-full truncate px-2 py-[3px] text-left text-[12px] ${
              i === page
                ? 'cursor-not-allowed text-gdoc-muted/60'
                : i === target
                  ? 'bg-[#cfe2ff] text-[#0b3d91]'
                  : 'hover:bg-bb-200/50'
            }`}
          >
            {labelOf(i)}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => onOk(where, target)}
          className="rounded border border-gdoc-border px-4 py-1 text-[12px] hover:bg-bb-200/50"
        >
          OK
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-gdoc-border px-4 py-1 text-[12px] hover:bg-bb-200/50"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Give a page a name of its own ("Page 3" becomes "Sports results"). */
function RenamePageDialog({
  page,
  initial,
  onOk,
  onCancel,
}: {
  page: number;
  initial: string;
  onOk: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal title={`Rename Page ${page + 1}`} onClose={onCancel}>
      <p className="mb-1 text-[12px]">Page name:</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOk(name.trim());
        }}
        placeholder={`Page ${page + 1}`}
        className="mb-3 w-full rounded border border-gdoc-border px-2 py-1 text-[12px] outline-none focus:border-bb-500"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => onOk(name.trim())}
          className="rounded border border-gdoc-border px-4 py-1 text-[12px] hover:bg-bb-200/50"
        >
          OK
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-gdoc-border px-4 py-1 text-[12px] hover:bg-bb-200/50"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** A small centred dialog in the app's own chrome. */
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/25 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[340px] rounded-lg border border-gdoc-border bg-[#f8f9fa] p-3 shadow-2xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-medium">{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-6 w-6 place-items-center rounded text-gdoc-muted hover:bg-gdoc-hover"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
