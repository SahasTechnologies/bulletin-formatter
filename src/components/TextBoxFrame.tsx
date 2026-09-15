import { useCallback, useRef } from 'react';
import { PaintBucket, Trash2, Columns2, Columns3, Unlink } from 'lucide-react';
import {
  FRAME_COL_GAP,
  FRAME_PAD,
  type TextBox,
} from '../lib/textbox';

const MIN_W = 60;
const MIN_H = 40;
/** Pixels of movement before a click on a selected frame turns into a drag. */
const DRAG_THRESHOLD = 3;

export interface FrameGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface TextBoxFrameProps {
  box: TextBox;
  /** Page zoom as a multiplier (1 = 100%). Mouse deltas are divided by it. */
  scale: number;
  selected: boolean;
  editing: boolean;
  /** The chain still has text left over after this frame. */
  overflow: boolean;
  readOnly: boolean;
  spellCheck: boolean;
  pageW: number;
  pageH: number;
  /** This frame is the armed source of a link operation. */
  linkArmed: boolean;
  /** A link operation is in progress and this frame is a valid drop target. */
  linking: boolean;
  onRegisterEl: (id: string, el: HTMLDivElement | null) => void;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onInput: (id: string) => void;
  onEndEdit: (id: string) => void;
  onGeomChange: (id: string, geom: FrameGeom) => void;
  onArmLink: (id: string) => void;
  onAcceptLink: (id: string) => void;
  onDelete: (id: string) => void;
  onSetColumns: (id: string, n: number) => void;
  onBreakLink: (id: string) => void;
}

export default function TextBoxFrame({
  box,
  scale,
  selected,
  editing,
  overflow,
  readOnly,
  spellCheck,
  pageW,
  pageH,
  linkArmed,
  linking,
  onRegisterEl,
  onSelect,
  onStartEdit,
  onInput,
  onEndEdit,
  onGeomChange,
  onArmLink,
  onAcceptLink,
  onDelete,
  onSetColumns,
  onBreakLink,
}: TextBoxFrameProps) {
  const dragRef = useRef<{
    mode: 'move' | Handle;
    startX: number;
    startY: number;
    orig: FrameGeom;
    moved: boolean;
  } | null>(null);

  const contentElRef = useRef<HTMLDivElement | null>(null);

  const setContentEl = useCallback(
    (el: HTMLDivElement | null) => {
      contentElRef.current = el;
      onRegisterEl(box.id, el);
    },
    [box.id, onRegisterEl],
  );

  const clampGeom = (g: FrameGeom): FrameGeom => {
    const w = Math.max(MIN_W, Math.min(g.w, pageW));
    const h = Math.max(MIN_H, Math.min(g.h, pageH));
    return {
      x: Math.max(0, Math.min(g.x, pageW - w)),
      y: Math.max(0, Math.min(g.y, pageH - h)),
      w,
      h,
    };
  };

  const beginDrag = (mode: 'move' | Handle, e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const orig: FrameGeom = { x: box.x, y: box.y, w: box.w, h: box.h };
    dragRef.current = { mode, startX, startY, orig, moved: false };
    const s = scale || 1;

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / s;
      const dy = (ev.clientY - d.startY) / s;
      if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD) {
        return;
      }
      d.moved = true;

      if (d.mode === 'move') {
        onGeomChange(box.id, clampGeom({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }));
        return;
      }

      // Resize: each handle pins the opposite edge/corner.
      let { x, y, w, h } = d.orig;
      if (d.mode.includes('e')) w = d.orig.w + dx;
      if (d.mode.includes('s')) h = d.orig.h + dy;
      if (d.mode.includes('w')) {
        w = d.orig.w - dx;
        x = d.orig.x + dx;
      }
      if (d.mode.includes('n')) {
        h = d.orig.h - dy;
        y = d.orig.y + dy;
      }
      onGeomChange(box.id, clampGeom({ x, y, w, h }));
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // A click that never became a drag means "start typing here".
      if (d && d.mode === 'move' && !d.moved) {
        onStartEdit(box.id);
        requestAnimationFrame(() => contentElRef.current?.focus());
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const frameMouseDown = (e: React.MouseEvent) => {
    if (readOnly) return;

    // While linking, a click on another frame means "flow into this one".
    if (linking && !linkArmed) {
      e.preventDefault();
      e.stopPropagation();
      onAcceptLink(box.id);
      return;
    }
    if (!selected) {
      e.preventDefault();
      onSelect(box.id);
      return;
    }
    if (editing) return; // let the browser place the caret / select text
    beginDrag('move', e);
  };

  const cols = Math.max(1, box.columns ?? 1);

  const handles: { h: Handle; style: React.CSSProperties; cursor: string }[] = [
    { h: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
    { h: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
    { h: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
    { h: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
    { h: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
    { h: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
    { h: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
    { h: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
  ];

  return (
    <div
      className={`tb-frame group ${selected ? 'is-selected' : ''} ${
        overflow ? 'is-overflow' : ''
      } ${linkArmed ? 'is-link-armed' : ''} ${linking && !linkArmed ? 'is-link-target' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onMouseDown={frameMouseDown}
      data-frame-id={box.id}
    >
      {/* The text itself. Only editable once the frame is selected, so a first
          click selects and a second click drops the caret in. */}
      <div
        ref={setContentEl}
        className="tb-frame-content"
        contentEditable={!readOnly && selected}
        suppressContentEditableWarning
        spellCheck={spellCheck}
        onInput={() => onInput(box.id)}
        onFocus={() => onStartEdit(box.id)}
        onBlur={() => onEndEdit(box.id)}
        style={{
          padding: FRAME_PAD,
          columnCount: cols,
          columnGap: cols > 1 ? FRAME_COL_GAP : undefined,
          columnRule: cols > 1 ? '1px solid #d8d2ca' : undefined,
          columnFill: 'balance',
        }}
      />

      {/* Selection outline + resize handles (never intercept text clicks). */}
      {selected && !readOnly && (
        <>
          <div className="tb-frame-outline" />
          {handles.map(({ h, style, cursor }) => (
            <div
              key={h}
              className="tb-handle"
              style={{ ...style, cursor }}
              onMouseDown={(e) => beginDrag(h, e)}
              data-handle={h}
            />
          ))}

          {/* Per-frame controls: columns, unlink, delete. */}
          <div className="tb-frame-tools" onMouseDown={(e) => e.stopPropagation()}>
            <button
              title="Single column"
              onClick={() => onSetColumns(box.id, 1)}
              className={cols === 1 ? 'is-active' : ''}
            >
              <span className="text-[10px] font-semibold leading-none">1</span>
            </button>
            <button
              title="Two columns (with rule)"
              onClick={() => onSetColumns(box.id, 2)}
              className={cols === 2 ? 'is-active' : ''}
            >
              <Columns2 size={13} />
            </button>
            <button
              title="Three columns (with rule)"
              onClick={() => onSetColumns(box.id, 3)}
              className={cols === 3 ? 'is-active' : ''}
            >
              <Columns3 size={13} />
            </button>
            {box.nextId && (
              <button title="Break link to next frame" onClick={() => onBreakLink(box.id)}>
                <Unlink size={13} />
              </button>
            )}
            <button title="Delete frame" onClick={() => onDelete(box.id)} className="hover:text-red-600">
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}

      {/* Overflow: tint the frame and offer the link handle on its edge. */}
      {overflow && (
        <button
          className="tb-link-handle"
          title="Text does not fit - click to link a new frame, then click where it should go"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onArmLink(box.id);
          }}
        >
          <PaintBucket size={13} />
        </button>
      )}
    </div>
  );
}
