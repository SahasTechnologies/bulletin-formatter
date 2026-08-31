import { useState } from 'react';
import { ArrowLeft, Plus, MoreVertical, FileText, ChevronRight } from 'lucide-react';

interface LeftSidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function LeftSidebar({ open, onClose }: LeftSidebarProps) {
  const [activeTab, setActiveTab] = useState(1);

  if (!open) return null;

  return (
    <aside className="flex w-[280px] flex-shrink-0 flex-col border-r border-gdoc-border bg-white">
      <div className="flex h-12 items-center justify-between px-3">
        <button
          onClick={onClose}
          className="rounded-full p-1.5 text-gdoc-muted hover:bg-gdoc-hover"
          title="Hide document tabs"
        >
          <ArrowLeft size={18} />
        </button>
        <button className="rounded-full p-1.5 text-gdoc-muted hover:bg-gdoc-hover" title="Add tab">
          <Plus size={18} />
        </button>
      </div>

      <div className="px-4 pb-2">
        <h3 className="text-[13px] font-medium text-[#202124]">Document tabs</h3>
      </div>

      <div className="px-2">
        {[1].map((t) => (
          <div
            key={t}
            onClick={() => setActiveTab(t)}
            className={`group flex cursor-pointer items-center justify-between rounded-md px-3 py-2 ${
              activeTab === t ? 'bg-gdoc-active' : 'hover:bg-gdoc-hover'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText
                size={16}
                className={activeTab === t ? 'text-[#1a73e8]' : 'text-gdoc-muted'}
              />
              <span className={activeTab === t ? 'text-[13px] font-medium text-[#1a73e8]' : 'text-[13px] text-[#202124]'}>
                Tab {t}
              </span>
            </div>
            <MoreVertical size={14} className="text-gdoc-muted opacity-0 group-hover:opacity-100" />
          </div>
        ))}
        <button className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-gdoc-muted hover:bg-gdoc-hover">
          <Plus size={14} /> Add tab
        </button>
      </div>

      <div className="mx-4 mt-3 border-t border-gdoc-border pt-3 text-[11.5px] italic leading-snug text-gdoc-muted">
        Headings you add to the document will appear here.
      </div>

      <div className="mt-auto px-4 py-3 text-[11px] text-gdoc-muted">
        <button className="flex items-center gap-1 hover:text-[#1a73e8]">
          <ChevronRight size={12} /> Show document outline
        </button>
      </div>
    </aside>
  );
}
