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
    <div ref={containerRef} className="relative flex-1 overflow-auto bg-gdoc-bg">
      {/* Ruler - Fixed at top, doesn't scroll with content */}
      {showRuler && (
        <div className="no-print sticky top-0 z-20 flex h-6 items-end border-b border-gdoc-border bg-gdoc-bg text-[10px] text-gdoc-muted">
          <div className="mx-auto flex max-w-[1100px] justify-center px-12" style={{ width: '100%' }}>
            <div style={{ width: `${page.width * (zoom / 100)}px`, display: 'flex' }}>
              <div style={{ width: `${96 * (zoom / 100)}px` }} /> {/* Left padding spacer */}
              <div className="flex flex-1">
                {Array.from({ length: 20 }, (_, i) => (
                  <div key={i} className="relative flex-1 border-l border-gdoc-border/70">
                    <span className="absolute -top-0.5 -translate-x-1/2">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex flex-col max-w-[1100px] items-center px-12 py-8 gap-8">
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
                  justifyContent: 'center'
                }}
              >
                Page {pageIndex + 1}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Image editor overlay */}
      {selectedImage && ref.current?.contains(selectedImage) && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 30 }}>
          <div className="relative mx-auto max-w-[1100px] h-full px-12 py-8">
            <div style={{ 
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
              width: `${page.width}px`,
              margin: '0 auto',
            }}>
              <ImageEditor image={selectedImage} onUpdate={() => onInput()} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
