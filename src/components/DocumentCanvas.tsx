import { useEffect, useRef, useState } from 'react';
import {
  registerEditor,
  initEditorCommands,
  startSelectionTracking,
} from '../lib/editor';
import ImageEditor from './ImageEditor';

const INITIAL_HTML = `
  <div style="display:flex;align-items:center;gap:16px;border-bottom:3px solid #fe9c53;padding-bottom:12px;margin-bottom:20px;">
    <img src="/logo.webp" alt="Baulko Bulletin logo" style="width:88px;height:88px;flex:none;" />
    <div>
      <h1 style="margin:0;font-size:34pt;line-height:1.1;letter-spacing:-0.5px;">Baulko Bulletin</h1>
      <p style="margin:4px 0 0;font-size:11pt;color:#6b6257;letter-spacing:1.5px;text-transform:uppercase;">Issue 24 &middot; Term 3</p>
    </div>
  </div>

  <h2 style="font-size:20pt;margin:0 0 8px;">Welcome to the new formatter</h2>
  <p style="margin:0 0 12px;">
    Select any words in this page and use the toolbar to change their
    <b>font</b>, <i>style</i>, size or colour. Every one of the
    <b>1,946 Google Fonts</b> is available from the font dropdown, and fonts load
    the moment you hover them.
  </p>

  <p style="margin:0 0 12px;">
    This editor is heading towards a Microsoft Publisher replacement: a fixed
    page you compose on, rather than an endlessly scrolling web document.
  </p>

  <img src="/banner.png" alt="Baulko Bulletin banner" style="max-width:100%;height:auto;border-radius:8px;margin:16px 0;" />

  <h2 style="font-size:16pt;margin:16px 0 8px;">What works today</h2>
  <ul style="margin:0 0 12px 22px;">
    <li>Bold, italic, underline, strikethrough, subscript and superscript</li>
    <li>Font family, size, text colour and highlight</li>
    <li>Paragraph styles and the four alignments</li>
    <li>Bulleted and numbered lists with indent controls</li>
    <li>Links, images, find, undo/redo and print</li>
  </ul>

  <p style="margin:0;color:#6b6257;font-size:10pt;">
    Tip: select text first, then pick a font &mdash; the selection stays put.
  </p>
`;

const RULER_SIZE = 28; // px thickness shared by the top and left rulers
const PAGE_GAP = 32; // flex gap (gap-8) between page sheets

interface DocumentCanvasProps {
  zoom: number;
  spellCheck: boolean;
  showRuler: boolean;
  page: { width: number; height: number };
  onInput: () => void;
}

export default function DocumentCanvas({
  zoom,
  spellCheck,
  showRuler,
  page,
  onInput,
}: DocumentCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Seed once. The surface is intentionally *uncontrolled* — if React
    // re-rendered its children it would blow away the caret and selection.
    el.innerHTML = INITIAL_HTML;
    registerEditor(el);
    initEditorCommands();
    const stopTracking = startSelectionTracking();

    return () => {
      stopTracking();
      registerEditor(null);
    };
  }, []);

  // Handle image selection
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG' && ref.current?.contains(target)) {
        setSelectedImage(target as HTMLImageElement);
      } else if (!target.closest('.absolute')) {
        setSelectedImage(null);
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Calculate number of pages based on content height
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const contentHeight = el.scrollHeight;
    const pageHeight = page.height - 160; // Subtract padding
    const neededPages = Math.max(1, Math.ceil(contentHeight / pageHeight));
    setPages(neededPages);
  }, [page.height, onInput]);

  const pageHeight = page.height;

  return (
    <div ref={containerRef} className="relative flex-1 overflow-auto bg-[#f1f0ee]">
      {/* Ruler: a full-width white bar across the top of the canvas. The tick
          box is centred so it lines up with the page, and a downward triangle
          marks the page's right edge. */}
      {showRuler && (
        <div className="no-print sticky top-0 z-20 border-b border-gdoc-border bg-white">
          <div
            className="relative mx-auto select-none text-[10px] text-gdoc-muted"
            style={{ width: `${page.width * (zoom / 100)}px`, height: `${RULER_SIZE}px` }}
          >
            {/* Tick marks + numbers across the content area. */}
            <div
              className="absolute bottom-0 flex"
              style={{
                left: `${96 * (zoom / 100)}px`,
                width: `${(page.width - 192) * (zoom / 100)}px`,
              }}
            >
              {Array.from({ length: Math.max(2, Math.ceil((page.width - 192) / 96)) }, (_, i) => (
                <div key={i} className="relative flex-1">
                  <span className="absolute bottom-[7px] left-1 leading-none">{i + 1}</span>
                  <div className="absolute bottom-0 h-[5px] w-px bg-gdoc-muted/40" />
                </div>
              ))}
            </div>

            {/* Page-width marker: blue downward triangle at the right edge. */}
            <div
              className="absolute -bottom-1"
              style={{ left: 'calc(100% - 12px)' }}
              title="Right edge of the page"
            >
              <div
                className="h-0 w-0 border-x-[6px] border-t-[7px]"
                style={{
                  borderLeftColor: 'transparent',
                  borderRightColor: 'transparent',
                  borderTopColor: '#1a73e8',
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1100px] px-12">
        <div className="relative flex flex-col items-center gap-8 py-8">
          {Array.from({ length: pages }, (_, pageIndex) => (
            <div
              key={pageIndex}
              className="doc-paper rounded-sm relative"
              style={{
                width: `${page.width}px`,
                height: `${pageHeight}px`,
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top center',
              }}
            >
              {pageIndex === 0 ? (
                <div
                  ref={ref}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={spellCheck}
                  data-placeholder="Start writing…"
                  onInput={onInput}
                  className="doc-surface rounded-sm px-[96px] py-[80px] leading-relaxed"
                  style={{ minHeight: `${pageHeight}px` }}
                />
              ) : (
                <div
                  className="doc-surface rounded-sm px-[96px] py-[80px] leading-relaxed"
                  style={{
                    minHeight: `${pageHeight}px`,
                    color: '#a8a29a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  Page {pageIndex + 1}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Vertical ruler: a full-height white rail flush against the left edge
          of the canvas, starting just below the top ruler and running past the
          page stack (it lives outside the centred column on purpose). */}
      {showRuler && (
        <div
          className="no-print absolute z-10 select-none border-r border-gdoc-border bg-white text-[10px] text-gdoc-muted"
          style={{
            top: `${RULER_SIZE}px`,
            left: 0,
            width: `${RULER_SIZE}px`,
            height: `${
              pages * page.height * (zoom / 100) + (pages - 1) * PAGE_GAP + 2 * PAGE_GAP
            }px`,
          }}
        >
          {/* Tick marks + numbers down the content area. */}
          <div
            className="absolute flex flex-col"
            style={{
              top: `${PAGE_GAP + 80 * (zoom / 100)}px`,
              bottom: `${PAGE_GAP + 80 * (zoom / 100)}px`,
              left: 0,
              right: 0,
            }}
          >
            {Array.from({ length: Math.max(2, Math.ceil((page.height - 160) / 96)) }, (_, i) => (
              <div key={i} className="relative flex-1">
                <span className="absolute left-1.5 top-0.5 leading-none">{i + 1}</span>
                <div className="absolute right-0 top-0 h-px w-[5px] bg-gdoc-muted/40" />
              </div>
            ))}
          </div>

          {/* Page-height marker: blue triangle at the bottom edge of page 1. */}
          <div
            className="absolute right-0"
            style={{ top: `calc(${PAGE_GAP + page.height * (zoom / 100)}px - 3px)` }}
            title="Bottom edge of the page"
          >
            <div
              className="h-0 w-0 border-y-[6px] border-l-[7px]"
              style={{
                borderTopColor: 'transparent',
                borderBottomColor: 'transparent',
                borderLeftColor: '#1a73e8',
              }}
            />
          </div>
        </div>
      )}

      {/* Image editor overlay — rendered as a child of the scroll container so
          the border/handles use the same coordinate space as the image. */}
      {selectedImage && ref.current?.contains(selectedImage) && (
        <ImageEditor
          image={selectedImage}
          onUpdate={() => onInput()}
          zoom={zoom}
          containerRef={containerRef}
        />
      )}
    </div>
  );
}
