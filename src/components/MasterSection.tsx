import { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Clock,
  Columns,
  Copy,
  Eye,
  EyeOff,
  Hash,
  Pencil,
  PlusSquare,
  Trash2,
  X,
} from 'lucide-react';
import {
  defaultDescription,
  newMaster,
  nextMasterId,
  sanitizeId,
  type MasterDef,
  type MasterSet,
} from '../lib/master';
import { useFeedback } from './Feedback';

/**
 * The **Master Page** contextual tab - Publisher shows it above the sheet while
 * View > Master Page is on. Its groups mirror the Microsoft Publisher tab:
 * *Master Page* (which masters exist and who they are applied to),
 * *Header & Footer* (the furniture itself) and *Close*.
 *
 * Every control performs a real edit on the master set; the pages pick it up
 * through `onChange`.
 */
export default function MasterSection({
  set,
  onChange,
  onInsertToken,
  onClose,
  onToggleHeaderFooter,
  pageCount,
}: {
  set: MasterSet;
  onChange: (patch: (set: MasterSet) => MasterSet) => void;
  /** Drop a field token into the band the user is editing. */
  onInsertToken: (token: string) => void;
  onClose: () => void;
  onToggleHeaderFooter: () => void;
  /** Sheets in the publication - lets Apply To offer the whole range. */
  pageCount: number;
}) {
  const { toast, confirm } = useFeedback();
  const [applyOpen, setApplyOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  /** Publisher's "Apply Master Page…" page-range prompt. */
  const [rangeOpen, setRangeOpen] = useState(false);
  const applyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!applyOpen) return;
    const close = (e: MouseEvent) => {
      if (!applyRef.current?.contains(e.target as Node)) setApplyOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [applyOpen]);

  const active = set.masters.find((m) => m.id === set.activeId) ?? set.masters[0];

  /** Publisher's Two Page Master: warn before the left sheet is dropped. */
  const toggleTwoPage = async () => {
    if (!active) return;
    if (active.twoPage) {
      const ok = await confirm({
        title: `Make master ${active.id} a one-page master?`,
        body: `The furniture on its left (even) sheet will be removed and replaced by the right sheet's.`,
        confirmLabel: 'Make one-page',
        danger: true,
      });
      if (!ok) return;
    }
    onChange((s) => ({
      ...s,
      masters: s.masters.map((m) => (m.id === active.id ? { ...m, twoPage: !m.twoPage } : m)),
    }));
  };

  const duplicate = () => {
    if (!active) return;
    const id = nextMasterId(set);
    onChange((s) => {
      const src = s.masters.find((m) => m.id === active.id);
      if (!src) return s;
      const copy: MasterDef = {
        ...src,
        id,
        description: defaultDescription(id),
        right: { header: { ...src.right.header }, footer: { ...src.right.footer } },
        left: { header: { ...src.left.header }, footer: { ...src.left.footer } },
      };
      return { ...s, masters: [...s.masters, copy], activeId: id };
    });
  };

  const remove = async () => {
    if (!active) return;
    if (set.masters.length <= 1) {
      toast('A publication needs at least one master page.', {
        kind: 'error',
        detail: 'Rename or repurpose this one instead of deleting it.',
      });
      return;
    }
    const fallback = set.masters.find((m) => m.id !== active.id);
    const ok = await confirm({
      title: `Delete master page ${active.id}?`,
      body: `Any page using it will be given master page ${fallback?.id ?? 'A'} instead.`,
      confirmLabel: 'Delete master',
      danger: true,
    });
    if (!ok) return;
    onChange((s) => {
      const assignment: Record<string, string> = {};
      for (const [page, id] of Object.entries(s.assignment)) {
        assignment[page] = id === active.id ? fallback?.id ?? 'A' : id;
      }
      const masters = s.masters.filter((m) => m.id !== active.id);
      return { ...s, masters, assignment, activeId: masters[0]?.id ?? 'A' };
    });
  };

  return (
    /* Publisher's contextual tab is one strip: the button groups on the left,
       a hairline between each pair, and Close Master Page pinned to the right
       of the same row. */
    <div className="no-print flex flex-none items-stretch gap-2 border-b border-gdoc-border bg-[#faf7f4] px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-1 gap-y-2">
        {/* ---- Master Page ---- */}
        <RibbonGroup label="Master Page">
          <RibbonBtn
            icon={<PlusSquare size={16} />}
            label="Add Master Page"
            title="Create another master page, with its own Page ID and description"
            onClick={() => setAddOpen(true)}
          />
          <RibbonBtn
            icon={<Columns size={16} />}
            label="Two-Page Master"
            active={active?.twoPage === true}
            title="Make this master a facing spread: a left and a right sheet, each with its own furniture"
            onClick={toggleTwoPage}
          />

          <div ref={applyRef} className="relative flex">
            <RibbonBtn
              icon={<Copy size={16} />}
              label="Apply To"
              title="Apply this master to pages"
              onClick={() => setApplyOpen((o) => !o)}
            />
            {applyOpen && (
              <div className="dropdown absolute left-0 top-full z-40 mt-1 w-60 rounded-md border border-gdoc-border bg-white py-1 text-[13px] shadow-lg">
                <ApplyRow
                  label="Apply to all pages"
                  hint="Every page, including any added later"
                  onClick={() => {
                    setApplyOpen(false);
                    onChange((s) => ({ ...s, assignment: { '*': s.activeId } }));
                  }}
                />
                <ApplyRow
                  label="Apply to current page"
                  hint="Only the page you were last on"
                  onClick={() => {
                    setApplyOpen(false);
                    onChange((s) => ({
                      ...s,
                      assignment: { ...s.assignment, '0': s.activeId },
                    }));
                  }}
                />
                <ApplyRow
                  label="Apply to pages…"
                  hint={`A range, 1–${Math.max(1, pageCount)}`}
                  onClick={() => {
                    setApplyOpen(false);
                    setRangeOpen(true);
                  }}
                />
                <ApplyRow
                  label="Apply no master"
                  hint="Leave the pages bare"
                  onClick={() => {
                    setApplyOpen(false);
                    onChange((s) => ({ ...s, assignment: { '*': 'none' } }));
                  }}
                />
              </div>
            )}
          </div>

          <RibbonBtn
            icon={<Pencil size={16} />}
            label="Rename"
            title="Change this master's Page ID and description"
            onClick={() => setRenameOpen(true)}
          />
          <RibbonBtn
            icon={<Copy size={16} />}
            label="Duplicate"
            title="Copy this master page under a new Page ID"
            onClick={duplicate}
          />
          <RibbonBtn
            icon={<Trash2 size={16} />}
            label="Delete"
            danger
            title="Delete this master page"
            onClick={remove}
          />
        </RibbonGroup>

        <GroupDivider />

        {/* ---- Header & Footer ---- */}
        <RibbonGroup label="Header & Footer">
          <RibbonBtn
            icon={active?.headerFooterVisible === false ? <EyeOff size={16} /> : <Eye size={16} />}
            label="Show Header/Footer"
            active={active?.headerFooterVisible !== false}
            title="Show or hide this master's furniture on every page it dresses"
            onClick={onToggleHeaderFooter}
          />
          <RibbonBtn
            icon={<Hash size={16} />}
            label="Insert Page Number"
            title="Insert the page-number field into the focused band"
            onClick={() => onInsertToken('@page')}
          />
          <RibbonBtn
            icon={<Calendar size={16} />}
            label="Insert Date"
            title="Insert today's date into the focused band"
            onClick={() => onInsertToken('@date')}
          />
          <RibbonBtn
            icon={<Clock size={16} />}
            label="Insert Time"
            title="Insert the current time into the focused band"
            onClick={() => onInsertToken('@time')}
          />
        </RibbonGroup>
      </div>

      <button
        onClick={onClose}
        className="flex flex-none items-center gap-1.5 self-start rounded px-2 py-1 text-[12px] font-medium text-gdoc-muted hover:bg-gdoc-hover hover:text-[#2b2622]"
        title="Close master page"
      >
        <X size={14} />
        Close Master Page
      </button>

      {addOpen && (
        <MasterDialog
          title="New master page"
          subtitle="Publisher gives every master a one-character Page ID."
          submitLabel="Create"
          initialId={nextMasterId(set)}
          initialDescription={defaultDescription(nextMasterId(set))}
          twoPageChoice
          onCancel={() => setAddOpen(false)}
          /* Publisher refuses a Page ID that is already taken - the dialog says
             so in place, instead of raising a second window on top of itself. */
          validate={(clean) =>
            set.masters.some((m) => m.id === clean)
              ? `Master page ${clean} already exists - pick another Page ID.`
              : null
          }
          onSubmit={(id, description, twoPage) => {
            const clean = sanitizeId(id);
            if (!clean) return;
            setAddOpen(false);
            onChange((s) => ({
              ...s,
              masters: [...s.masters, newMaster(clean, description, twoPage)],
              activeId: clean,
            }));
          }}
        />
      )}

      {rangeOpen && (
        <PageRangeDialog
          masterId={set.activeId}
          pageCount={pageCount}
          onCancel={() => setRangeOpen(false)}
          onApply={(pages) => {
            onChange((s) => {
              const assignment = { ...s.assignment };
              for (const p of pages) assignment[String(p)] = s.activeId;
              return { ...s, assignment };
            });
            setRangeOpen(false);
          }}
        />
      )}

      {renameOpen && active && (
        <MasterDialog
          title={`Rename master page ${active.id}`}
          subtitle="The Page ID is the letter Publisher shows on the sheet's corner tab."
          submitLabel="Rename"
          initialId={active.id}
          initialDescription={active.description}
          onCancel={() => setRenameOpen(false)}
          validate={(clean) =>
            clean !== set.activeId && set.masters.some((m) => m.id === clean)
              ? `Master page ${clean} already exists - pick another Page ID.`
              : null
          }
          onSubmit={(id, description) => {
            const clean = sanitizeId(id);
            if (!clean) return;
            setRenameOpen(false);
            onChange((s) => {
              const assignment: Record<string, string> = {};
              for (const [page, assigned] of Object.entries(s.assignment)) {
                assignment[page] = assigned === s.activeId ? clean : assigned;
              }
              return {
                ...s,
                masters: s.masters.map((m) =>
                  m.id === s.activeId
                    ? { ...m, id: clean, description: description.trim() || defaultDescription(clean) }
                    : m,
                ),
                assignment,
                activeId: clean,
              };
            });
          }}
        />
      )}
    </div>
  );
}

/** Turn "2-5, 9" into zero-based page indexes, clamped to the publication. */
function parsePageRange(raw: string, pageCount: number): number[] {
  const out = new Set<number>();
  const max = Math.max(1, pageCount);
  for (const part of raw.split(',')) {
    const bit = part.trim();
    if (!bit) continue;
    const range = /^(\d+)\s*(?:-|–|to)\s*(\d+)$/i.exec(bit);
    if (range) {
      const from = Math.max(1, Math.min(Number(range[1]), max));
      const to = Math.max(1, Math.min(Number(range[2]), max));
      for (let p = Math.min(from, to); p <= Math.max(from, to); p++) out.add(p - 1);
      continue;
    }
    const single = Number(bit);
    if (Number.isFinite(single) && single >= 1) out.add(Math.min(Math.round(single), max) - 1);
  }
  return [...out].sort((a, b) => a - b);
}

/** One row of the Apply To menu. */
function ApplyRow({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-gdoc-hover">
      <span className="block text-[13px] text-[#2b2622]">{label}</span>
      <span className="block text-[11px] text-gdoc-muted">{hint}</span>
    </button>
  );
}

/**
 * Which pages does this master dress? (Apply To > Apply to pages...)
 *
 * This replaces the native window.prompt the ribbon used to raise: a modal
 * prompt blocks the whole tab, cannot be styled, and hides the invalid-range
 * error behind a second dialog, so a typo cost two round trips.
 */
function PageRangeDialog({
  masterId,
  pageCount,
  onCancel,
  onApply,
}: {
  masterId: string;
  pageCount: number;
  onCancel: () => void;
  onApply: (pages: number[]) => void;
}) {
  const [value, setValue] = useState('1-' + Math.max(1, pageCount));
  const [error, setError] = useState('');
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const apply = () => {
    const pages = parsePageRange(value, pageCount);
    if (!pages.length) {
      setError('Not a page range - try something like 2-5, or 3.');
      return;
    }
    onApply(pages);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter') apply();
        }}
      >
        <h2 className="mb-1 text-[15px] font-semibold text-[#2b2622]">
          Apply master page {masterId}
        </h2>
        <p className="mb-3 text-[12px] text-gdoc-muted">
          Which pages should it dress? A range like 2-5, a single page like 3,
          or 1,4,7. Pages run 1 to {Math.max(1, pageCount)}.
        </p>

        <input
          ref={field}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          className="w-full rounded-md border border-gdoc-border px-2 py-1.5 text-[13px] outline-none focus:border-bb-400"
        />
        {error && <p className="mt-1 text-[11.5px] text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-gdoc-border px-3 py-1.5 text-[13px] text-[#2b2622] hover:bg-gdoc-hover"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            className="rounded bg-bb-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-bb-600"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/** Publisher's New / Duplicate / Rename Master Page dialog. */
function MasterDialog({
  title,
  subtitle,
  submitLabel,
  initialId,
  initialDescription,
  twoPageChoice = false,
  validate,
  onCancel,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  initialId: string;
  initialDescription: string;
  twoPageChoice?: boolean;
  /** Reject a Page ID the publication already uses; the message is shown in
      place, so a single typo costs one round trip, not two. */
  validate?: (id: string) => string | null;
  onCancel: () => void;
  onSubmit: (id: string, description: string, twoPage: boolean) => void;
}) {
  const [id, setId] = useState(initialId);
  const [description, setDescription] = useState(initialDescription);
  const [twoPage, setTwoPage] = useState(false);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, []);

  const submit = () => {
    const clean = sanitizeId(id);
    if (!clean) return;
    const problem = validate?.(clean);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    onSubmit(id, description, twoPage);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter') submit();
        }}
      >
        <h2 className="mb-1 text-[15px] font-semibold text-[#2b2622]">{title}</h2>
        <p className="mb-3 text-[12px] text-gdoc-muted">{subtitle}</p>

        <label className="mb-1 block text-[12px] text-gdoc-muted">Page ID (1 character)</label>
        <input
          ref={first}
          value={id}
          maxLength={2}
          onChange={(e) => {
            setId(sanitizeId(e.target.value) || e.target.value.slice(0, 1));
            setError('');
          }}
          aria-invalid={Boolean(error)}
          className={`mb-1 w-16 rounded-md border px-2 py-1.5 text-center text-[14px] uppercase outline-none focus:border-bb-400 ${
            error ? 'border-red-400' : 'border-gdoc-border'
          }`}
        />
        {error ? (
          <p className="mb-3 text-[11.5px] text-red-600">{error}</p>
        ) : (
          <div className="mb-3" />
        )}

        <label className="mb-1 block text-[12px] text-gdoc-muted">Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mb-3 w-full rounded-md border border-gdoc-border px-2 py-1.5 text-[13px] outline-none focus:border-bb-400"
        />

        {twoPageChoice && (
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-[12.5px] text-[#2b2622]">
            <input
              type="checkbox"
              checked={twoPage}
              onChange={(e) => setTwoPage(e.target.checked)}
              className="h-3.5 w-3.5 accent-bb-500"
            />
            Two-page master
          </label>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-gdoc-border px-3 py-1.5 text-[13px] text-[#2b2622] hover:bg-gdoc-hover"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!id.trim()}
            className="rounded bg-bb-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-bb-600 disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The hairline Publisher draws between two button groups on a ribbon. */
function GroupDivider() {
  return <span className="mx-1.5 w-px self-stretch bg-gdoc-border" aria-hidden="true" />;
}

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-1.5">
      <div className="flex items-center gap-1.5">{children}</div>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gdoc-muted">
        {label}
      </span>
    </div>
  );
}

function RibbonBtn({
  icon,
  label,
  title,
  onClick,
  active = false,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex flex-col items-center gap-0.5 rounded px-2 py-1 text-[11px] leading-tight transition-colors ${
        active
          ? 'bg-bb-500/15 text-bb-700 ring-1 ring-bb-500'
          : danger
            ? 'text-gdoc-muted hover:bg-red-50 hover:text-red-600'
            : 'text-[#2b2622] hover:bg-gdoc-hover'
      }`}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
