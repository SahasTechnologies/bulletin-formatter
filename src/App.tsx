import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronUp, FileText } from 'lucide-react';
import MenuBar from './components/MenuBar';
import Toolbar from './components/Toolbar';
import DocumentCanvas from './components/DocumentCanvas';
import { GoogleFontProvider } from './components/GoogleFontProvider';
import * as ed from './lib/editor';

const PAGE_SIZES = {
  Letter: { width: 816, height: 1056 },
  A4: { width: 794, height: 1123 },
} as const;

type PageSizeName = keyof typeof PAGE_SIZES;

const SHORTCUTS: [string, string][] = [
  ['Ctrl + N', 'New document'],
  ['Ctrl + O', 'Open an HTML file'],
  ['Ctrl + S', 'Download as HTML'],
  ['Ctrl + P', 'Print'],
  ['Ctrl + F', 'Find in document'],
  ['Ctrl + Z / Ctrl + Y', 'Undo / redo'],
  ['Ctrl + B', 'Bold'],
  ['Ctrl + I', 'Italic'],
  ['Ctrl + U', 'Underline'],
  ['Ctrl + Shift + L / E / R / J', 'Align left / centre / right / justify'],
  ['Ctrl + Shift + C', 'Word count'],
  ['Ctrl + /', 'This shortcut list'],
];

export default function App() {
  const [title, setTitle] = useState('Untitled bulletin');
  const [starred, setStarred] = useState(false);

  const [font, setFont] = useState('Red Hat Text');
  const [size, setSize] = useState(11);
  const [style, setStyle] = useState('Normal text');
  const [zoom, setZoom] = useState(100);
  const [spellCheck, setSpellCheck] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showRuler, setShowRuler] = useState(true);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [pageName, setPageName] = useState<PageSizeName>('Letter');

  const [findQuery, setFindQuery] = useState('');
  const [findStatus, setFindStatus] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [dialog, setDialog] = useState<null | 'about' | 'shortcuts' | 'wordcount'>(null);

  const titleRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const recalc = useCallback(() => {
    const el = ed.getEditor();
    if (!el) return;
    const text = (el.textContent ?? '').trim();
    setWordCount(text ? text.split(/\s+/).length : 0);
  }, []);

  useEffect(() => {
    recalc();
  }, [recalc]);

  /** Wrap the document body in a standalone HTML file and download it. */
  const download = useCallback(
    (filename: string) => {
      const el = ed.getEditor();
      if (!el) return;
      const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:'Red Hat Text',system-ui;max-width:816px;margin:40px auto;line-height:1.5}</style>
</head><body>${el.innerHTML}</body></html>`;
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.endsWith('.html') ? filename : `${filename}.html`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [title],
  );

  const pickImage = useCallback((onPick: (f: File) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) onPick(f);
    };
    input.click();
  }, []);

  const runFind = useCallback((q: string) => {
    if (!q) {
      setFindStatus('');
      return;
    }
    const n = ed.findAndSelect(q);
    setFindStatus(n ? 'Match found' : 'No matches');
  }, []);

  /* ---------------- menu actions ---------------- */

  const run = useCallback(
    (id: string) => {
      const el = ed.getEditor();
      switch (id) {
        case 'file.new':
          if (el && window.confirm('Start a new document? Unsaved changes will be lost.')) {
            el.innerHTML = '<p><br></p>';
            el.focus();
            recalc();
          }
          break;
        case 'file.open': {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.html,.htm,.txt,text/html,text/plain';
          input.onchange = () => {
            const f = input.files?.[0];
            if (!f || !el) return;
            const reader = new FileReader();
            reader.onload = () => {
              el.innerHTML = String(reader.result);
              recalc();
            };
            reader.readAsText(f);
          };
          input.click();
          break;
        }
        case 'file.copy':
          download(`${title} - copy.html`);
          break;
        case 'file.download':
          download(`${title}.html`);
          break;
        case 'file.pagesetup':
          setPageName((p) => (p === 'Letter' ? 'A4' : 'Letter'));
          break;
        case 'file.print':
          window.print();
          break;
        case 'file.rename':
          titleRef.current?.focus();
          titleRef.current?.select();
          break;

        case 'edit.undo': ed.exec('undo'); break;
        case 'edit.redo': ed.exec('redo'); break;
        case 'edit.cut': ed.exec('cut'); break;
        case 'edit.copy': ed.exec('copy'); break;
        case 'edit.paste':
          navigator.clipboard
            ?.readText()
            .then((t) => ed.exec('insertText', t))
            .catch(() => ed.exec('paste'));
          break;
        case 'edit.find':
          setSearchOpen(true);
          setTimeout(() => findRef.current?.focus(), 0);
          break;
        case 'edit.selectall': ed.exec('selectAll'); break;

        case 'view.zoomin': setZoom((z) => Math.min(200, z + 10)); break;
        case 'view.zoomout': setZoom((z) => Math.max(50, z - 10)); break;
        case 'view.zoomreset': setZoom(100); break;
        case 'view.ruler': setShowRuler((r) => !r); break;
        case 'view.fullscreen':
          if (document.fullscreenElement) document.exitFullscreen();
          else document.documentElement.requestFullscreen?.();
          break;

        case 'insert.image': pickImage((f) => ed.insertImageFromFile(f)); break;
        case 'insert.table':
          ed.exec(
            'insertHTML',
            '<table style="border-collapse:collapse;width:100%"><tbody>' +
              Array.from({ length: 3 })
                .map(
                  () =>
                    '<tr>' +
                    Array.from({ length: 3 })
                      .map(() => '<td style="border:1px solid #d6cfc4;padding:8px">&nbsp;</td>')
                      .join('') +
                    '</tr>',
                )
                .join('') +
              '</tbody></table><p><br></p>',
          );
          break;
        case 'insert.rule': ed.exec('insertHorizontalRule'); break;
        case 'insert.pagebreak':
          ed.exec('insertHTML', '<div style="page-break-after:always"></div><p><br></p>');
          break;
        case 'insert.date':
          ed.exec(
            'insertText',
            new Date().toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          );
          break;

        case 'format.bold': ed.exec('bold'); break;
        case 'format.italic': ed.exec('italic'); break;
        case 'format.underline': ed.exec('underline'); break;
        case 'format.strike': ed.exec('strikeThrough'); break;
        case 'format.left': ed.exec('justifyLeft'); break;
        case 'format.center': ed.exec('justifyCenter'); break;
        case 'format.right': ed.exec('justifyRight'); break;
        case 'format.justify': ed.exec('justifyFull'); break;
        case 'format.clear': ed.clearFormatting(); break;

        case 'tools.wordcount': setDialog('wordcount'); break;
        case 'tools.spellcheck': setSpellCheck((s) => !s); break;

        case 'help.shortcuts': setDialog('shortcuts'); break;
        case 'help.about': setDialog('about'); break;

        default:
          break;
      }
    },
    [download, pickImage, recalc, title],
  );

  /* ---------------- keyboard shortcuts ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();

      if (k === 's') {
        e.preventDefault();
        download(`${title}.html`);
      } else if (k === 'p') {
        e.preventDefault();
        window.print();
      } else if (k === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => findRef.current?.focus(), 0);
      } else if (k === '/') {
        e.preventDefault();
        setDialog('shortcuts');
      } else if (k === 'n') {
        e.preventDefault();
        run('file.new');
      } else if (k === 'o') {
        e.preventDefault();
        run('file.open');
      } else if (k === 'c' && e.shiftKey) {
        e.preventDefault();
        setDialog('wordcount');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [download, run, title]);

  const page = PAGE_SIZES[pageName];

  return (
    <GoogleFontProvider>
      <div className="flex h-full w-full flex-col bg-gdoc-bg font-ui text-[#2b2622]">
        <MenuBar
          title={title}
          starred={starred}
          onTitleChange={setTitle}
          onToggleStar={() => setStarred((s) => !s)}
          onRun={run}
          wordCount={wordCount}
          titleRef={titleRef}
        />

        {toolbarHidden ? (
          <button
            onClick={() => setToolbarHidden(false)}
            className="no-print flex h-8 flex-none items-center justify-center gap-1 border-b border-gdoc-border bg-white text-[12px] text-gdoc-muted hover:bg-gdoc-hover"
          >
            <ChevronUp size={14} className="rotate-180" /> Show toolbar
          </button>
        ) : (
          <Toolbar
            font={font}
            size={size}
            style={style}
            zoom={zoom}
            spellCheck={spellCheck}
            searchOpen={searchOpen}
            setFont={setFont}
            setSize={setSize}
            setStyle={setStyle}
            setZoom={setZoom}
            setSpellCheck={setSpellCheck}
            setSearchOpen={setSearchOpen}
            onToggleToolbar={() => setToolbarHidden(true)}
          />
        )}

        {searchOpen && (
          <div className="no-print flex flex-none items-center gap-2 border-b border-gdoc-border bg-white px-3 py-1.5">
            <input
              ref={findRef}
              autoFocus
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runFind(findQuery);
                if (e.key === 'Escape') setSearchOpen(false);
              }}
              placeholder="Find in document…"
              className="w-64 rounded border border-gdoc-border px-2 py-1 text-[13px] outline-none focus:border-bb-400"
            />
            <button
              onClick={() => runFind(findQuery)}
              className="rounded bg-bb-500 px-3 py-1 text-[12px] font-medium text-white hover:bg-bb-600"
            >
              Find
            </button>
            <span className="text-[12px] text-gdoc-muted">{findStatus}</span>
            <button
              onClick={() => setSearchOpen(false)}
              className="ml-auto rounded p-1 text-gdoc-muted hover:bg-gdoc-hover"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <DocumentCanvas
          zoom={zoom}
          spellCheck={spellCheck}
          showRuler={showRuler}
          page={page}
          onInput={recalc}
        />

        <div className="no-print flex flex-none items-center gap-3 border-t border-gdoc-border bg-white px-3 py-1.5 text-[11px] text-gdoc-muted">
          <FileText size={12} />
          <span>{pageName}</span>
          <span>
            {page.width} × {page.height} px
          </span>
          <span>Zoom {zoom}%</span>
          <span className="ml-auto">
            {wordCount.toLocaleString()} words · {style} · {font} {size}pt
          </span>
        </div>

        {dialog && (
          <Dialog onClose={() => setDialog(null)}>
            {dialog === 'about' && (
              <>
                <h2 className="mb-2 text-[16px] font-semibold">About Bulletin Formatter</h2>
                <p className="mb-3 text-[13px] leading-relaxed text-gdoc-muted">
                  A page-based editor for laying out the Baulko Bulletin — a Microsoft
                  Publisher replacement in the browser. Built with React, TypeScript,
                  Tailwind and Lucide icons. All 1,946 Google Fonts are available from
                  the font dropdown.
                </p>
                <p className="text-[12px] text-gdoc-muted">
                  Brand orange <span className="font-medium text-bb-600">#fe9c53</span>,
                  sampled from the bulletin logo.
                </p>
              </>
            )}
            {dialog === 'shortcuts' && (
              <>
                <h2 className="mb-3 text-[16px] font-semibold">Keyboard shortcuts</h2>
                <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
                  {SHORTCUTS.map(([k, v]) => (
                    <div key={k} className="contents">
                      <code className="whitespace-nowrap rounded bg-gdoc-hover px-1.5 py-0.5 text-[11px] text-[#2b2622]">
                        {k}
                      </code>
                      <span className="text-gdoc-muted">{v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {dialog === 'wordcount' && (
              <>
                <h2 className="mb-3 text-[16px] font-semibold">Word count</h2>
                <p className="text-[13px] text-gdoc-muted">
                  This document contains{' '}
                  <span className="font-semibold text-[#2b2622]">{wordCount.toLocaleString()}</span>{' '}
                  {wordCount === 1 ? 'word' : 'words'}.
                </p>
              </>
            )}
          </Dialog>
        )}
      </div>
    </GoogleFontProvider>
  );
}

function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div
      className="no-print fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-bb-500 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-bb-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
