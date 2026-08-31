import { useEffect, useState } from 'react';
import { LayoutTemplate, FileText, Mail, Folder, ArrowLeft, Plus } from 'lucide-react';

interface DocumentCanvasProps {
  settings: import('../App').DocumentSettings;
}

export default function DocumentCanvas({ settings }: DocumentCanvasProps) {
  const [content, setContent] = useState(
    'Welcome to Bulletin Formatter!\n\nThis is a Microsoft Publisher replacement built with React, TypeScript, Tailwind, and Lucide icons. Click anywhere on this page and start typing — your font, size, weight, color, and alignment from the toolbar will apply automatically.\n\nTry the font dropdown: every Google Font (over 1,900 of them) is available and will load on demand.',
  );
  const [showTemplates, setShowTemplates] = useState(true);

  return (
    <div className="relative flex-1 overflow-auto bg-gdoc-bg">
      {/* Ruler */}
      <div className="sticky top-0 z-10 flex h-6 items-end border-b border-gdoc-border bg-gdoc-bg pl-[200px] pr-3 text-[10px] text-gdoc-muted">
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="relative flex-1 border-l border-gdoc-border/70">
            <span className="absolute -top-0.5 -translate-x-1/2">{i + 1}</span>
          </div>
        ))}
      </div>

      <div className="mx-auto flex max-w-[1024px] gap-6 px-12 py-8">
        <div className="flex-1">
          <div
            className="doc-paper mx-auto"
            style={{ width: '816px', minHeight: '1056px' }}
          >
            <textarea
              className="doc-textarea block w-full resize-none rounded p-12 leading-relaxed"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (showTemplates) setShowTemplates(false);
              }}
              style={{
                fontFamily: `"${settings.font}", system-ui`,
                fontSize: `${settings.size * 1.4}pt`,
                fontWeight: settings.bold ? 700 : 400,
                fontStyle: settings.italic ? 'italic' : 'normal',
                textDecoration: settings.underline ? 'underline' : 'none',
                color: settings.textColor,
                background: settings.highlight === 'transparent' ? 'transparent' : settings.highlight,
                textAlign: settings.align,
              }}
            />
          </div>
        </div>

        {/* Quick-start templates panel (shown when document is empty) */}
        {showTemplates && (
          <div className="mt-12 w-[260px] flex-shrink-0 rounded-lg border border-gdoc-border bg-white p-4 text-[13px] shadow-sm">
            <div className="mb-2 flex items-center justify-between text-gdoc-muted">
              <span>Start with a template</span>
              <button
                className="rounded p-1 hover:bg-gdoc-hover"
                onClick={() => setShowTemplates(false)}
              >
                <ArrowLeft size={14} />
              </button>
            </div>
            <div className="space-y-2">
              <TemplateButton icon={<LayoutTemplate size={16} />} label="Templates" sub="Choose from 100s" />
              <TemplateButton icon={<FileText size={16} />} label="Meeting notes" sub="Agenda & minutes" />
              <TemplateButton icon={<Mail size={16} />} label="Email draft" sub="Quick letter" />
              <TemplateButton icon={<Folder size={16} />} label="More" sub="Browse library" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateButton({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-md border border-transparent bg-white px-3 py-2 text-left hover:border-gdoc-border hover:bg-gdoc-hover">
      <div className="grid h-7 w-7 place-items-center rounded bg-gdoc-active text-[#1a73e8]">{icon}</div>
      <div className="flex flex-col leading-tight">
        <span className="text-[13px] font-medium text-[#202124]">{label}</span>
        <span className="text-[11px] text-gdoc-muted">{sub}</span>
      </div>
    </button>
  );
}
