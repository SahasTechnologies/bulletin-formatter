import { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  Clock,
  Columns,
  Copy,
  Eye,
  EyeOff,
  Hash,
  PlusSquare,
  Trash2,
  X,
} from 'lucide-react';
import type { MasterPage } from '../lib/master';

/**
 * The **Master Pages** contextual ribbon — Publisher shows it above the sheet
 * while View > Master Page is on. Two groups mirror the Microsoft Publisher
 * tab: *Master Page* (which variants exist) and *Header & Footer* (the
 * furniture itself).
 *
 * Every control here performs a real edit on the master; the page picks it up
 * through `onChange`.
 */
export default function MasterSection({
  master,
  onChange,
  onInsertToken,
  onClose,
  headerFooterVisible,
  onToggleHeaderFooter,
}: {
  master: MasterPage;
  onChange: (patch: (m: MasterPage) => MasterPage) => void;
  /** Drop a field token into the band the user is editing. */
  onInsertToken: (token: string) => void;
  onClose: () => void;
  headerFooterVisible: boolean;
  onToggleHeaderFooter: () => void;
}) {
  const [applyOpen, setApplyOpen] = useState(false);
  const applyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!applyOpen) return;
    const close = (e: MouseEvent) => {
      if (!applyRef.current?.contains(e.target as Node)) setApplyOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [applyOpen]);

  /** Copy the default bands into every variant so they start from the same
      running head rather than from nothing. */
  const duplicate = () =>
    onChange((m) => ({
      ...m,
      firstHeader: { ...m.header },
      firstFooter: { ...m.footer },
      evenHeader: { ...m.header },
      evenFooter: { ...m.footer },
    }));

  const clearAll = () => {
    if (!window.confirm('Delete the master-page furniture? Every running head and folio is cleared.')) return;
    onChange((m) => ({
      ...m,
      header: { ...m.header, text: '' },
      footer: { ...m.footer, text: '' },
      firstHeader: { ...m.firstHeader, text: '' },
      firstFooter: { ...m.firstFooter, text: '' },
      evenHeader: { ...m.evenHeader, text: '' },
      evenFooter: { ...m.evenFooter, text: '' },
    }));
  };

  return (
    <div className="no-print flex flex-none flex-wrap items-stretch gap-x-5 gap-y-2 border-b border-gdoc-border bg-[#faf7f4] px-3 py-2">
      {/* ---- Master Page ---- */}
      <RibbonGroup label="Master Page">
        <RibbonBtn
          icon={<PlusSquare size={16} />}
          label="Add Master Page"
          active={master.differentFirstPage}
          title="Give page 1 its own running head and folio"
          onClick={() => onChange((m) => ({ ...m, differentFirstPage: !m.differentFirstPage }))}
        />
        <RibbonBtn
          icon={<Columns size={16} />}
          label="Two-Page Master"
          active={master.differentOddEven}
          title="Give even pages their own running head and folio"
          onClick={() => onChange((m) => ({ ...m, differentOddEven: !m.differentOddEven }))}
        />

        <div ref={applyRef} className="relative flex">
          <RibbonBtn
            icon={<Copy size={16} />}
            label="Apply To"
            title="Apply this master to a set of pages"
            onClick={() => setApplyOpen((o) => !o)}
          />
          {applyOpen && (
            <div className="dropdown absolute left-0 top-full z-40 mt-1 w-56 rounded-md border border-gdoc-border bg-white py-1 text-[13px] shadow-lg">
              <button
                onClick={() => {
                  setApplyOpen(false);
                  onChange((m) => ({ ...m, differentFirstPage: false, differentOddEven: false }));
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-gdoc-hover"
              >
                All pages
              </button>
              <button
                onClick={() => {
                  setApplyOpen(false);
                  onChange((m) => ({ ...m, differentOddEven: true }));
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-gdoc-hover"
              >
                Odd &amp; even pages
              </button>
              <button
                onClick={() => {
                  setApplyOpen(false);
                  onChange((m) => ({ ...m, differentFirstPage: true }));
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-gdoc-hover"
              >
                First page only
              </button>
            </div>
          )}
        </div>

        <RibbonBtn
          icon={<Copy size={16} />}
          label="Duplicate"
          title="Copy the default running head and folio into every variant"
          onClick={duplicate}
        />
        <RibbonBtn
          icon={<Trash2 size={16} />}
          label="Delete"
          danger
          title="Clear every band on the master"
          onClick={clearAll}
        />
      </RibbonGroup>

      {/* ---- Header & Footer ---- */}
      <RibbonGroup label="Header & Footer">
        <RibbonBtn
          icon={headerFooterVisible ? <Eye size={16} /> : <EyeOff size={16} />}
          label="Show Header/Footer"
          active={headerFooterVisible}
          title="Show or hide the furniture on every page"
          onClick={onToggleHeaderFooter}
        />
        <RibbonBtn
          icon={<Hash size={16} />}
          label="Page Number"
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

      <button
        onClick={onClose}
        className="ml-auto flex items-center gap-1.5 self-end rounded px-2 py-1 text-[12px] font-medium text-gdoc-muted hover:bg-gdoc-hover hover:text-[#2b2622]"
        title="Close master page"
      >
        <X size={14} />
        Close Master Page
      </button>
    </div>
  );
}

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
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
