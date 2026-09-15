import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  FilePlus,
  MousePointerClick,
  Pencil,
  Send,
} from 'lucide-react';
import {
  GUIDE_GENERAL_RULES,
  type GuidePage,
  type GuideStep,
} from '../data/designGuide';

/**
 * `/guide` - the Design Bible as a walkthrough.
 *
 * Pick a part of the issue on the left and the right-hand pane shows the
 * numbered steps for it: what to write, what to click, and a mock-up of the
 * element rendered in the page's own HTML, so "what you are aiming at" is
 * shown rather than described. The last step of each page ends with a button
 * that opens (or extends) that page in the editor with the guide's typography
 * already applied, so all that is left is the writing.
 */
export default function GuideScreen({
  pages,
  hasOpenDoc,
  onEdit,
  onDownload,
  onBack,
}: {
  pages: GuidePage[];
  /** True when a document is already open - offers "add to this issue". */
  hasOpenDoc: boolean;
  onEdit: (page: GuidePage) => void;
  /** Save the open document as a `.bulletin` file to send to the Master. */
  onDownload: () => void;
  onBack: () => void;
}) {
  const [selectedId, setSelectedId] = useState(pages[0]?.id ?? '');
  const page = pages.find((p) => p.id === selectedId) ?? pages[0];

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
            Design Bible 2.0 - pick a part of the issue for a step-by-step
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---- Which part of the issue are you working on? ---- */}
        <nav className="w-[230px] flex-none overflow-y-auto border-r border-gdoc-border bg-white p-3">
          <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-gdoc-muted">
            What are you working on?
          </p>
          <ul className="space-y-0.5">
            {pages.map((p) => {
              const active = p.id === page?.id;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full rounded px-2 py-2 text-left ${
                      active ? 'bg-bb-500/10 text-bb-700' : 'hover:bg-gdoc-hover'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.name}</span>
                      {active && <Check size={14} className="flex-none text-bb-600" />}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-gdoc-muted">
                      {p.steps.length} steps
                      {p.columns ? ` · ${p.columns} column${p.columns > 1 ? 's' : ''}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 rounded-md border border-gdoc-border bg-[#f8f9fa] p-3">
            <h2 className="flex items-center gap-1.5 text-[12px] font-medium text-[#3c4043]">
              <BookOpen size={14} className="text-bb-600" />
              General rules of thumb
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-gdoc-muted">
              {GUIDE_GENERAL_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </nav>

        {/* ---- The steps for the chosen part of the issue ---- */}
        {page && (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[860px] px-6 pb-16">
              <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gdoc-muted">
                    {page.section}
                  </p>
                  <h2 className="text-[22px] font-medium text-[#3c4043]">{page.name}</h2>
                </div>
                <span className="flex-none rounded border border-gdoc-border px-2 py-1 text-[10px] uppercase tracking-wide text-gdoc-muted">
                  {page.position === 'front' ? 'Front' : page.position === 'end' ? 'End' : 'Body'}
                  {page.columns ? ` · ${page.columns} col` : ''}
                </span>
              </div>

              <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-gdoc-muted">
                {page.summary}
              </p>

              <ol className="mt-6 space-y-5">
                {page.steps.map((step, i) => (
                  <StepCard key={step.title} step={step} n={i + 1} />
                ))}
              </ol>

              {page.rules.length > 0 && (
                <section className="mt-8 rounded-lg border border-gdoc-border bg-white p-4">
                  <h3 className="text-[15px] font-medium text-[#3c4043]">
                    Font schema for this page
                  </h3>
                  <table className="mt-2 w-full border-collapse text-left text-[12px]">
                    <thead>
                      <tr className="text-gdoc-muted">
                        <th className="border-b border-gdoc-border py-1 pr-2 font-medium">Role</th>
                        <th className="border-b border-gdoc-border py-1 pr-2 font-medium">Font</th>
                        <th className="border-b border-gdoc-border py-1 pr-2 font-medium">Size</th>
                        <th className="border-b border-gdoc-border py-1 font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.rules.map((r) => (
                        <tr key={`${page.id}-${r.role}`} className="align-top">
                          <td className="py-1 pr-2 text-[#3c4043]">{r.role}</td>
                          <td className="py-1 pr-2 text-gdoc-muted">{r.font}</td>
                          <td className="py-1 pr-2 text-gdoc-muted">{r.size}</td>
                          <td className="py-1 text-gdoc-muted">
                            {r.note}
                            {r.colour && (
                              <span
                                className="ml-1 inline-block h-2.5 w-2.5 rounded-sm align-middle ring-1 ring-black/10"
                                style={{ background: r.colour }}
                                title={r.colour}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {page.templateId ? (
                <button
                  onClick={() => onEdit(page)}
                  className="mt-6 flex items-center gap-1.5 rounded bg-bb-500 px-3 py-2 text-[13px] font-medium text-white hover:bg-bb-600"
                  title={
                    hasOpenDoc
                      ? `Add a ${page.name} page to the current issue`
                      : `Open a ${page.name} page`
                  }
                >
                  {hasOpenDoc ? <FilePlus size={15} /> : <Pencil size={15} />}
                  {hasOpenDoc ? 'Add to this issue' : 'Start this page'}
                </button>
              ) : (
                <p className="mt-6 rounded-lg border border-gdoc-border bg-white p-3 text-[13px] text-gdoc-muted">
                  The master page is not a page of its own - it is part of every template. Open any
                  page from the list and turn it on with <b>View ▸ Master page…</b>
                </p>
              )}

              <ShipItCard hasOpenDoc={hasOpenDoc} onDownload={onDownload} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The end of every guide: what to do with the page once it is written.
 *
 * A page only counts as finished once it leaves the editor as a `.bulletin`
 * file, so the last thing on each guide sheet is the two steps that get it
 * there: save the file, then send it on to the Formatter Master, who drops it
 * straight into the issue.
 */
function ShipItCard({
  hasOpenDoc,
  onDownload,
}: {
  hasOpenDoc: boolean;
  onDownload: () => void;
}) {
  return (
    <section className="mt-8 rounded-lg border border-bb-400/60 bg-[#fef7f0] p-4">
      <h3 className="flex items-center gap-2 text-[15px] font-medium text-[#3c4043]">
        <Send size={15} className="flex-none text-bb-600" />
        Finished this page? Ship it to the Formatter Master
      </h3>
      <ol className="mt-3 space-y-3">
        <li className="flex items-start gap-3">
          <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-bb-500 text-[11px] font-semibold text-white">
            1
          </span>
          <div className="min-w-0">
            <p className="text-[13px] text-[#3c4043]">
              Download your page as a <b>.bulletin</b> file. It carries everything the Master
              needs: the words, the frames, the pictures and the master page.
            </p>
            <button
              onClick={onDownload}
              disabled={!hasOpenDoc}
              className={`mt-2 flex items-center gap-1.5 rounded border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                hasOpenDoc
                  ? 'border-bb-500 bg-white text-bb-700 hover:bg-bb-500 hover:text-white'
                  : 'cursor-not-allowed border-gdoc-border bg-white/60 text-gdoc-muted/70'
              }`}
              title={
                hasOpenDoc
                  ? 'Save this page as a .bulletin file'
                  : 'Open or start a page first - the button then saves it as a .bulletin file'
              }
            >
              <Download size={14} />
              Download .bulletin
            </button>
            {!hasOpenDoc && (
              <p className="mt-2 text-[12px] text-gdoc-muted">
                Nothing is open yet. Start a page from the button above (or open a document from
                the home screen), and this saves it as a file you can send on.
              </p>
            )}
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-bb-500 text-[11px] font-semibold text-white">
            2
          </span>
          <p className="text-[13px] text-[#3c4043]">
            Send that file to the <b>Formatter Master</b> the way your bulletin team shares work.
            The Master merges it into the issue, so the whole page arrives exactly as you laid it
            out - no re-typing, no lost pictures.
          </p>
        </li>
      </ol>
    </section>
  );
}

/** One numbered step: what to do, what to click, and a mock-up of the result. */
function StepCard({ step, n }: { step: GuideStep; n: number }) {
  return (
    <li className="rounded-lg border border-gdoc-border bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-bb-500 text-[12px] font-semibold text-white">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-medium text-[#3c4043]">{step.title}</h3>
          <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-gdoc-muted">{step.body}</p>
          {step.click && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-bb-500/40 bg-bb-500/10 px-2.5 py-1 text-[12px] text-bb-700">
              <MousePointerClick size={13} />
              {step.click}
            </p>
          )}
        </div>
      </div>

      {step.preview && <StepPreview html={step.preview} />}
    </li>
  );
}

/** The mock-up's own width - the print area of an A4 sheet at 96dpi. */
const PREVIEW_WIDTH = 602;

/**
 * A step mock-up, rendered in the page's own HTML at the real frame width and
 * scaled down to whatever room the guide has. Real fonts, real sizes, and a
 * dashed orange outline on whatever the step wants you to click.
 */
function StepPreview({ html }: { html: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const update = () => {
      const available = box.clientWidth - 24; // the panel's own padding
      const k = Math.min(1, available / PREVIEW_WIDTH);
      setScale(k);
      // offsetHeight ignores the transform, so this is the mock's real height.
      setHeight(inner.offsetHeight * k);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [html]);

  return (
    <div
      ref={boxRef}
      className="mt-3 rounded border border-gdoc-border bg-[#fbfaf8] p-3"
      aria-hidden="true"
    >
      <div className="overflow-hidden" style={{ height: height || undefined }}>
        <div
          ref={innerRef}
          className="w-[602px] origin-top-left rounded-sm bg-white p-3 text-[#262626] shadow-sm"
          style={{ transform: scale < 1 ? `scale(${scale})` : undefined }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
