import { BookOpen, FilePlus, ArrowLeft, Pencil } from 'lucide-react';
import { GUIDE_GENERAL_RULES, type GuidePage } from '../data/designGuide';

/**
 * `/guide` — the Design Bible as a picker. Pick the part of the issue you are
 * formatting and the editor opens (or extends) that page with the guide's
 * typography already applied, so all that is left is the writing.
 */
export default function GuideScreen({
  pages,
  hasOpenDoc,
  onEdit,
  onBack,
}: {
  pages: GuidePage[];
  /** True when a document is already open — offers "add to this issue". */
  hasOpenDoc: boolean;
  onEdit: (page: GuidePage) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#f8f9fa] font-ui text-[#2b2622]">
      <header className="flex h-16 flex-none items-center gap-3 border-b border-gdoc-border bg-white px-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-gdoc-muted hover:bg-gdoc-hover"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <img src="/logo.webp" alt="Baulko Bulletin" className="h-8 w-8 flex-none object-contain" />
        <div className="min-w-0">
          <h1 className="truncate text-[18px] font-medium">Design guide</h1>
          <p className="truncate text-[12px] text-gdoc-muted">
            Design Bible 2.0 — pick a part of the issue to start editing it
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1000px] px-6 pb-16">
          <section className="mt-6 rounded-lg border border-gdoc-border bg-white p-4">
            <h2 className="flex items-center gap-2 text-[15px] font-medium text-[#3c4043]">
              <BookOpen size={16} className="text-bb-600" />
              General rules of thumb
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-[13px] leading-relaxed text-gdoc-muted">
              {GUIDE_GENERAL_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>

          <h2 className="mt-8 text-[18px] font-medium text-[#3c4043]">Pages of the issue</h2>
          <p className="mb-4 text-[13px] text-gdoc-muted">
            Each page below is a template built to the guide’s spec — choose one and it opens
            ready to edit.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {pages.map((page) => (
              <article
                key={page.id}
                className="flex flex-col rounded-lg border border-gdoc-border bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-medium text-[#3c4043]">{page.name}</h3>
                    <p className="truncate text-[11px] uppercase tracking-wide text-gdoc-muted">
                      {page.section}
                    </p>
                  </div>
                  <span className="flex-none rounded border border-gdoc-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gdoc-muted">
                    {page.position === 'front'
                      ? 'Front'
                      : page.position === 'end'
                        ? 'End'
                        : 'Body'}
                  </span>
                </div>

                <p className="mt-2 text-[13px] leading-relaxed text-gdoc-muted">{page.summary}</p>

                {page.rules.length > 0 && (
                  <table className="mt-3 w-full border-collapse text-left text-[12px]">
                    <thead>
                      <tr className="text-gdoc-muted">
                        <th className="border-b border-gdoc-border py-1 pr-2 font-medium">Role</th>
                        <th className="border-b border-gdoc-border py-1 pr-2 font-medium">Font</th>
                        <th className="border-b border-gdoc-border py-1 font-medium">Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.rules.map((r) => (
                        <tr key={`${page.id}-${r.role}`} className="align-top">
                          <td className="py-1 pr-2 text-[#3c4043]">{r.role}</td>
                          <td className="py-1 pr-2 text-gdoc-muted">{r.font}</td>
                          <td className="py-1 text-gdoc-muted">{r.size}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {page.templateId && (
                  <button
                    onClick={() => onEdit(page)}
                    className="mt-4 flex items-center justify-center gap-1.5 self-start rounded bg-bb-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-bb-600"
                    title={
                      hasOpenDoc
                        ? `Add a ${page.name} page to the current issue`
                        : `Open a ${page.name} page`
                    }
                  >
                    {hasOpenDoc ? <FilePlus size={15} /> : <Pencil size={15} />}
                    {hasOpenDoc ? 'Add to this issue' : 'Edit this page'}
                  </button>
                )}
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
