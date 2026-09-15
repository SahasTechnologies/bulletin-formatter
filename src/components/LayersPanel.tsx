import React from 'react';
import {
  Layers,
  Type,
  Image as ImageIcon,
  Square,
  Minus,
  Bookmark,
  FileText,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  Trash2,
  X,
} from 'lucide-react';
import { type TextBox } from '../lib/textbox';

interface LayersPanelProps {
  pageIndex: number;
  boxes: TextBox[];
  selectedId: string | null;
  isOpen: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSelectBox: (id: string) => void;
  onBringToFront: (id: string) => void;
  onBringForward: (id: string) => void;
  onSendBackward: (id: string) => void;
  onSendToBack: (id: string) => void;
  onDeleteBox: (id: string) => void;
}

function getLayerInfo(box: TextBox): { label: string; icon: React.ReactNode; colorBadge?: string } {
  if (box.kind === 'shape') {
    return {
      label: box.fill === '#ffe0cc' || box.fill === '#fe9c53' ? 'Orange card' : 'Shape',
      icon: <Square size={13} className="text-orange-500" />,
      colorBadge: box.fill,
    };
  }
  if (box.kind === 'line') {
    return {
      label: 'Rule / Line',
      icon: <Minus size={13} className="text-stone-500" />,
    };
  }
  if (box.kind === 'image') {
    return {
      label: box.ph || 'Picture frame',
      icon: <ImageIcon size={13} className="text-blue-500" />,
    };
  }
  if (box.kind === 'tombstone') {
    return {
      label: 'Tombstone (marker)',
      icon: <Bookmark size={13} className="text-stone-900 fill-stone-900" />,
    };
  }
  if (box.kind === 'pdf') {
    return {
      label: `PDF Page ${box.pdfPage ?? 1}`,
      icon: <FileText size={13} className="text-red-500" />,
    };
  }

  // Text box: preview text snippet
  const div = document.createElement('div');
  div.innerHTML = box.html || '';
  const text = (div.textContent || '').trim().replace(/\s+/g, ' ');
  return {
    label: text.slice(0, 24) || 'Empty text frame',
    icon: <Type size={13} className="text-amber-700" />,
  };
}

export default function LayersPanel({
  pageIndex,
  boxes,
  selectedId,
  isOpen,
  readOnly,
  onClose,
  onSelectBox,
  onBringToFront,
  onBringForward,
  onSendBackward,
  onSendToBack,
  onDeleteBox,
}: LayersPanelProps) {
  if (!isOpen) return null;

  // Filter boxes for active page
  const pageBoxes = boxes.filter((b) => b.pageIndex === pageIndex && b.kind !== 'sheet');
  // Visual order: top-most layer is drawn last in DOM array, so reverse for top-to-bottom list
  const layers = [...pageBoxes].reverse();

  return (
    <aside
      aria-label="Layers panel"
      className="absolute right-4 top-16 z-40 flex max-h-[420px] w-64 flex-col rounded-lg border border-gdoc-border bg-white shadow-xl transition-all"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gdoc-border px-3 py-2 bg-[#faf8f5] rounded-t-lg">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#3b322a]">
          <Layers size={14} className="text-bb-600" />
          <span>Layers · Page {pageIndex + 1}</span>
          <span className="text-[10px] text-stone-400 font-normal">({layers.length})</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
          title="Close layers panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Layer List */}
      <div className="flex-1 overflow-y-auto p-1 text-xs">
        {layers.length === 0 ? (
          <div className="p-4 text-center text-xs text-stone-400 italic">No frames on this page</div>
        ) : (
          layers.map((box, index) => {
            const isSelected = selectedId === box.id;
            const info = getLayerInfo(box);
            const isTop = index === 0;
            const isBottom = index === layers.length - 1;

            return (
              <div
                key={box.id}
                onClick={() => onSelectBox(box.id)}
                className={`group flex items-center justify-between rounded px-2 py-1.5 cursor-pointer transition-colors ${
                  isSelected ? 'bg-bb-100 text-bb-900 font-medium' : 'hover:bg-stone-100 text-stone-700'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                  <div className="flex-shrink-0">{info.icon}</div>
                  {info.colorBadge && (
                    <span
                      className="h-2.5 w-2.5 rounded-full border border-black/10 flex-shrink-0"
                      style={{ backgroundColor: info.colorBadge }}
                    />
                  )}
                  <span className="truncate text-[11px] leading-snug">{info.label}</span>
                </div>

                {/* Layer reordering tools */}
                {!readOnly && (
                  <div
                    className={`flex items-center gap-0.5 flex-shrink-0 ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      disabled={isTop}
                      onClick={() => onBringForward(box.id)}
                      title="Bring forward (up one layer)"
                      className="rounded p-0.5 text-stone-500 hover:bg-stone-200 disabled:opacity-30"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      disabled={isBottom}
                      onClick={() => onSendBackward(box.id)}
                      title="Send backward (down one layer)"
                      className="rounded p-0.5 text-stone-500 hover:bg-stone-200 disabled:opacity-30"
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      disabled={isTop}
                      onClick={() => onBringToFront(box.id)}
                      title="Bring to front (top layer)"
                      className="rounded p-0.5 text-stone-500 hover:bg-stone-200 disabled:opacity-30"
                    >
                      <ChevronsUp size={13} />
                    </button>
                    <button
                      disabled={isBottom}
                      onClick={() => onSendToBack(box.id)}
                      title="Send to back (bottom layer)"
                      className="rounded p-0.5 text-stone-500 hover:bg-stone-200 disabled:opacity-30"
                    >
                      <ChevronsDown size={13} />
                    </button>
                    <button
                      onClick={() => onDeleteBox(box.id)}
                      title="Delete frame"
                      className="rounded p-0.5 text-red-500 hover:bg-red-50 ml-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer tips */}
      <div className="border-t border-gdoc-border px-3 py-1.5 bg-[#fbf9f6] text-[10px] text-stone-400 flex items-center justify-between rounded-b-lg">
        <span>Top of list = front-most layer</span>
        <span className="text-stone-300">Ctrl+[ / Ctrl+]</span>
      </div>
    </aside>
  );
}
