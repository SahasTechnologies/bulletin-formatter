import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  FilePlus,
  HelpCircle,
  Laptop,
  ListOrdered,
  MousePointerClick,
  Pencil,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  FORMATTER_MASTER_STEPS,
  GUIDE_GENERAL_RULES,
  GUIDE_MASTER_SETUP,
  GUIDE_WORKFLOW_STEPS,
  NEW_FORMATTER_STEPS,
  type FormatterKind,
  type GuidePage,
  type GuideStep,
  type WalkthroughStep,
} from '../data/designGuide';
import Confetti from './Confetti';

/**
 * `/guide` - the guide, in the shape the person using it is in.
 *
 * It opens on a question ("What are you working on?") rather than a wall of
 * specification, because the two people who come here want different things:
 *
 *  - a first-time formatter, who needs the whole job one step at a time, from
 *    claiming a piece in the Classroom to handing the finished file in;
 *  - someone who already knows what they are doing, who wants the reference -
 *    the typographic rules for the page they are on and the moves every piece
 *    needs - without being walked through it again.
 *
 * The Formatter Master has a walkthrough of their own: collect the team's
 * files, merge them into an issue with a generated page of contents, keep it,
 * export it.
 */
export default function GuideScreen({
  pages,
  hasOpenDoc,
  onEdit,
  onBack,
}: {
  pages: GuidePage[];
  /** True when a document is already open - offers "add to this issue". */
  hasOpenDoc: boolean;
  onEdit: (page: GuidePage) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<'start' | 'wizard' | 'reference'>('start');
  /** Which walkthrough is running: a new formatter, or the Master. */
  const [run, setRun] = useState<'new' | 'master'>('new');
  const [step, setStep] = useState(0);
  /**
   * What the formatter said they were editing. It is what makes the article
   * and poem walkthroughs different from each other, so it lives up here rather
   * than inside the wizard: it must survive stepping backwards.
   */
  const [kind, setKind] = useState<FormatterKind | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_AT);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_AT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const steps = run === 'new' ? NEW_FORMATTER_STEPS : FORMATTER_MASTER_STEPS;

  /** The step that asks article-or-poem, so a later step can send you back. */
  const kindStep = steps.findIndex((s) => !!s.choices);

  /** Open a template from anywhere in the guide (the wizard's choices do). */
  const openTemplate = (templateId: string) => {
    const page = pages.find((p) => p.templateId === templateId);
    if (page) onEdit(page);
  };

  const startRun = (which: 'new' | 'master') => {
    setRun(which);
    setStep(0);
    setKind(null);
    setCelebrate(false);
    setMode('wizard');
  };

  if (narrow) return <UseALaptop onBack={onBack} />;

  return (
    <div className="guide-root relative flex h-full w-full flex-col overflow-hidden bg-[#f8f9fa] font-ui text-[#2b2622]">
      <GuideHeader
        mode={mode}
        onBack={onBack}
        onStartOver={() => {
          setMode('start');
          setStep(0);
          setCelebrate(false);
        }}
      />

      {mode === 'start' && (
        <StartScreen
          pages={pages}
          hasOpenDoc={hasOpenDoc}
          onNewHere={() => startRun('new')}
          onMaster={() => startRun('master')}
          onOpenTemplate={openTemplate}
          onSeeSteps={() => setMode('reference')}
        />
      )}

      {mode === 'wizard' && (
        <Wizard
          run={run}
          steps={steps}
          step={step}
          kind={kind}
          kindStep={kindStep}
          celebrate={celebrate}
          onKind={(k) => setKind(k)}
          onStep={setStep}
          onFinish={() => setCelebrate(true)}
          onOpenTemplate={openTemplate}
          onStartOver={() => {
            setCelebrate(false);
            setStep(0);
          }}
        />
      )}

      {mode === 'reference' && <Reference pages={pages} hasOpenDoc={hasOpenDoc} onEdit={onEdit} />}

      {celebrate && <Confetti />}
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function GuideHeader({
  mode,
  onBack,
  onStartOver,
}: {
  mode: 'start' | 'wizard' | 'reference';
  onBack: () => void;
  onStartOver: () => void;
}) {
  return (
    <header className="no-print flex h-16 flex-none items-center gap-3 border-b border-gdoc-border bg-white px-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-gdoc-muted hover:bg-gdoc-hover"
      >
        <ArrowLeft size={16} />
        Back
      </button>
      <img src="/logo.webp" alt="Baulko Bulletin" className="h-8 w-8 flex-none object-contain" />
      <h1 className="min-w-0 flex-1 truncate text-[18px] font-medium">Formatter guide</h1>
      {mode !== 'start' && (
        <button
          onClick={onStartOver}
          className="flex flex-none items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-gdoc-muted hover:bg-gdoc-hover"
          title="Back to “What are you working on?”"
        >
          <RotateCcw size={15} />
          Start over
        </button>
      )}
    </header>
  );
}

/* ------------------------------------------------------------ start screen */

function StartScreen({
  pages,
  hasOpenDoc,
  onNewHere,
  onMaster,
  onOpenTemplate,
  onSeeSteps,
}: {
  pages: GuidePage[];
  hasOpenDoc: boolean;
  onNewHere: () => void;
  onMaster: () => void;
  onOpenTemplate: (templateId: string) => void;
  onSeeSteps: () => void;
}) {
  const parts = useMemo(() => pages.filter((p) => p.templateId), [pages]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-6 pb-16 pt-10">
        <div className="rounded-xl border border-gdoc-border bg-white p-6 shadow-sm">
          <h2 className="text-[26px] font-medium text-[#3c4043]">What are you working on?</h2>
          <p className="mt-1 text-[13px] text-gdoc-muted">
            Two ways in: let the guide walk you through a piece from nothing, or pick the part of
            the issue you are editing and go straight to it.
          </p>

          <button
            onClick={onNewHere}
            className="mt-6 flex w-full items-center gap-4 rounded-xl bg-bb-500 px-5 py-4 text-left text-white shadow-sm transition-colors hover:bg-bb-600"
          >
            <Sparkles size={26} className="flex-none" />
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-medium">
                I don&apos;t know, I&apos;m new here
              </span>
              <span className="block text-[13px] text-white/85">
                Ten steps, start to finish: claim a piece, format it, hand it in.
              </span>
            </span>
            <ArrowRight size={22} className="flex-none" />
          </button>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              onClick={onMaster}
              className="flex items-start gap-3 rounded-lg border border-gdoc-border bg-white px-4 py-3 text-left transition-colors hover:border-bb-400 hover:bg-bb-500/5"
            >
              <ListOrdered size={20} className="mt-0.5 flex-none text-bb-600" />
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-[#3c4043]">
                  I&apos;m the Formatter Master
                </span>
                <span className="block text-[12px] text-gdoc-muted">
                  Merge the team&apos;s pages, generate the contents, export the issue.
                </span>
              </span>
            </button>

            <div className="rounded-lg border border-gdoc-border bg-white px-4 py-3">
              <div className="flex items-start gap-3">
                <Pencil size={20} className="mt-0.5 flex-none text-bb-600" />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-[#3c4043]">
                    I&apos;m editing one part
                  </p>
                  <p className="text-[12px] text-gdoc-muted">
                    Open that template - you only ever edit the templates that are already there.
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => (p.templateId ? onOpenTemplate(p.templateId) : undefined)}
                    title={hasOpenDoc ? `Add a ${p.name} page to this issue` : `Start a ${p.name}`}
                    className="rounded-full border border-gdoc-border px-2.5 py-1 text-[12px] text-[#3c4043] hover:border-bb-400 hover:bg-bb-500/10"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            onClick={onSeeSteps}
            className="flex items-center gap-1.5 rounded-full border border-gdoc-border bg-white px-4 py-2 text-[13px] font-medium text-[#3c4043] transition-colors hover:border-bb-400 hover:text-bb-700"
          >
            <BookOpen size={15} className="text-bb-600" />
            I want to see the steps
          </button>
          <p className="max-w-[520px] text-center text-[12px] text-gdoc-muted">
            The reference: every part of the issue with its typographic rules, plus the moves every
            piece needs - the master page, pasting the article, images, the tombstone, handing it
            in.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- wizard */

function Wizard({
  run,
  steps,
  step,
  kind,
  kindStep,
  celebrate,
  onKind,
  onStep,
  onFinish,
  onOpenTemplate,
  onStartOver,
}: {
  run: 'new' | 'master';
  steps: WalkthroughStep[];
  step: number;
  kind: FormatterKind | null;
  /** Index of the article-or-poem step, or -1 when this run has no choice. */
  kindStep: number;
  celebrate: boolean;
  onKind: (kind: FormatterKind) => void;
  onStep: (n: number) => void;
  onFinish: () => void;
  onOpenTemplate: (templateId: string) => void;
  onStartOver: () => void;
}) {
  const raw = steps[Math.min(step, steps.length - 1)];
  /**
   * The step as the formatter should read it. Answering "article" or "poem"
   * swaps in that kind's wording for the steps it changes - pasting, pictures,
   * trimming the sheets and signing off all differ - so the question earns its
   * place rather than being a branch that changed nothing.
   */
  const current: WalkthroughStep = kind
    ? { ...raw, ...(raw.variants?.[kind] ?? {}), choices: raw.choices, variants: undefined }
    : raw;
  const last = step === steps.length - 1;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** True at the article-or-poem step until one of them has been picked. */
  const needsKind = !!raw.choices && !kind;

  /**
   * A new step starts at the top of the card.
   *
   * Steps with a mock-up are tall, so without this the next step opened
   * wherever the last one had been scrolled to - past its own heading. The
   * focus move also carries a screen reader to the new step's title.
   */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    titleRef.current?.focus({ preventScroll: true });
  }, [step, run]);


  if (celebrate) {
    return (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[640px] px-6 pb-16 pt-16 text-center">
          <div className="rounded-xl border border-bb-400/60 bg-white p-8 shadow-sm">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-bb-500/15">
              <Check size={30} className="text-bb-600" />
            </span>
            <h2 className="mt-4 text-[24px] font-medium text-[#3c4043]">That&apos;s the whole job</h2>
            <p className="mx-auto mt-2 max-w-[46ch] text-[13px] leading-relaxed text-gdoc-muted">
              {run === 'new'
                ? 'Your page is formatted and handed in. The Formatter Master merges it into the issue exactly as you laid it out - thank you for the work.'
                : 'The issue is merged, saved and exported. Everyone who handed a page in can see their work in it, laid out the way they left it.'}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={onStartOver}
                className="flex items-center gap-1.5 rounded border border-gdoc-border bg-white px-3 py-2 text-[13px] text-[#3c4043] hover:border-bb-400"
              >
                <RotateCcw size={15} />
                Run through it again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-6 pb-24 pt-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-medium uppercase tracking-wide text-gdoc-muted">
            {run === 'new' ? 'Formatting your first piece' : 'Building the issue'}
          </p>
          <p className="text-[12px] text-gdoc-muted">
            Step {step + 1} of {steps.length}
          </p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#e8e1d8]">
          <div
            className="h-full rounded-full bg-bb-500 transition-[width] duration-300"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>

        <div className="mt-6 rounded-xl border border-gdoc-border bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-bb-500 text-[13px] font-semibold text-white">
              {step + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h2
                ref={titleRef}
                tabIndex={-1}
                className="text-[21px] font-medium leading-snug text-[#3c4043] outline-none"
              >
                {current.title}
              </h2>
              <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-gdoc-muted">
                {current.body}
              </p>
              {current.click && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-bb-500/40 bg-bb-500/10 px-3 py-1 text-[12px] text-bb-700">
                  <MousePointerClick size={13} />
                  {current.click}
                </p>
              )}
            </div>
          </div>

          {current.choices && (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {current.choices.map((c) => {
                  const active = kind === c.kind;
                  return (
                    <button
                      key={c.kind}
                      // Picking an answer rewrites the steps below; the template
                      // is opened separately, below, so answering does not throw
                      // the formatter out of the walkthrough mid-sentence.
                      onClick={() => onKind(c.kind)}
                      aria-pressed={active}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-medium ${
                        active
                          ? 'border-bb-500 bg-bb-500 text-white shadow-sm'
                          : 'border-gdoc-border bg-white text-[#3c4043] hover:border-bb-400'
                      }`}
                    >
                      {active ? <Check size={15} /> : <FilePlus size={15} />}
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {kind && (
                <button
                  onClick={() =>
                    onOpenTemplate(
                      current.choices?.find((c) => c.kind === kind)?.templateId ?? '',
                    )
                  }
                  className="mt-3 flex items-center gap-1.5 rounded border border-bb-500 bg-white px-3 py-2 text-[13px] font-medium text-bb-700 hover:bg-bb-500 hover:text-white"
                >
                  <Pencil size={15} />
                  Open the {kind === 'poem' ? 'Poem' : 'Article'} template
                </button>
              )}
            </>
          )}

          {current.preview && <StepPreview html={current.preview} />}

          {current.aside && (
            <p className="mt-4 rounded-lg border border-bb-400/50 bg-[#fef7f0] p-3 text-[12px] leading-relaxed text-[#5f5a53]">
              <b className="text-[#3c4043]">Note.</b> {current.aside}
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            onClick={() => onStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className={`flex items-center gap-1.5 rounded border px-3 py-2 text-[13px] ${
              step === 0
                ? 'cursor-not-allowed border-gdoc-border bg-white/60 text-gdoc-muted/60'
                : 'border-gdoc-border bg-white text-[#3c4043] hover:border-bb-400'
            }`}
          >
            <ArrowLeft size={15} />
            Back
          </button>

          {last ? (
            <button
              onClick={onFinish}
              className="flex items-center gap-2 rounded-lg bg-bb-500 px-5 py-2.5 text-[14px] font-medium text-white shadow-sm hover:bg-bb-600"
            >
              Done
              <Check size={16} />
            </button>
          ) : (
            <button
              onClick={() => !needsKind && onStep(step + 1)}
              disabled={needsKind}
              title={needsKind ? 'Say which one you are formatting first' : undefined}
              className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-[14px] font-medium shadow-sm ${
                needsKind
                  ? 'cursor-not-allowed bg-[#e8e1d8] text-gdoc-muted'
                  : 'bg-bb-500 text-white hover:bg-bb-600'
              }`}
            >
              Next
              <ArrowRight size={16} />
            </button>
          )}
        </div>

        {needsKind && (
          <p className="mt-3 text-center text-[12px] text-gdoc-muted">
            Pick one above and the steps that follow are written for it.
          </p>
        )}

        {/* Which walkthrough this is, and a way back to the question that
            decides it - the answer is worth being able to change. */}
        {kind && kindStep >= 0 && step > kindStep && (
          <div className="mt-6 flex items-center justify-center gap-2 text-[12px] text-gdoc-muted">
            <span className="rounded-full border border-gdoc-border bg-white px-2.5 py-1 capitalize">
              {kind} steps
            </span>
            <button
              onClick={() => onStep(kindStep)}
              className="rounded px-2 py-1 font-medium text-bb-700 hover:bg-bb-500/10"
            >
              change
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- reference */

function Reference({
  pages,
  hasOpenDoc,
  onEdit,
}: {
  pages: GuidePage[];
  hasOpenDoc: boolean;
  onEdit: (page: GuidePage) => void;
}) {
  const [selectedId, setSelectedId] = useState(pages[0]?.id ?? '');
  const page = pages.find((p) => p.id === selectedId) ?? pages[0];
  const [masterOpen, setMasterOpen] = useState(true);

  return (
    <div className="flex min-h-0 flex-1">
      {/* ---- Which part of the issue are you working on? ---- */}
      <nav className="no-print w-[240px] flex-none overflow-y-auto border-r border-gdoc-border bg-white p-3">
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

        <button
          onClick={() => setMasterOpen((v) => !v)}
          className="mt-4 flex w-full items-center gap-1.5 rounded border border-gdoc-border bg-[#f8f9fa] px-3 py-2 text-left text-[12px] font-medium text-[#3c4043] hover:border-bb-400"
        >
          <ChevronRight
            size={14}
            className={`flex-none text-bb-600 transition-transform ${masterOpen ? 'rotate-90' : ''}`}
          />
          Master page set-up
        </button>
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-gdoc-muted">
          Shown on every page of this guide, because the running head and folio belong to all of
          them - not to a page of their own.
        </p>
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

            {masterOpen && (
              <section className="mt-6 rounded-lg border border-gdoc-border bg-white p-4">
                <h3 className="flex items-center gap-2 text-[15px] font-medium text-[#3c4043]">
                  <FilePlus size={15} className="flex-none text-bb-600" />
                  Every page, first: the master page
                </h3>
                <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-gdoc-muted">
                  {GUIDE_MASTER_SETUP.summary}
                </p>
                <ol className="mt-4 space-y-4">
                  {GUIDE_MASTER_SETUP.steps.map((s, i) => (
                    <StepCard key={s.title} step={s} n={i + 1} />
                  ))}
                </ol>
                <table className="mt-4 w-full border-collapse text-left text-[12px]">
                  <thead>
                    <tr className="text-gdoc-muted">
                      <th className="border-b border-gdoc-border py-1 pr-2 font-medium">Role</th>
                      <th className="border-b border-gdoc-border py-1 pr-2 font-medium">Font</th>
                      <th className="border-b border-gdoc-border py-1 pr-2 font-medium">Size</th>
                      <th className="border-b border-gdoc-border py-1 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GUIDE_MASTER_SETUP.rules.map((r) => (
                      <tr key={r.role} className="align-top">
                        <td className="py-1 pr-2 text-[#3c4043]">{r.role}</td>
                        <td className="py-1 pr-2 text-gdoc-muted">{r.font}</td>
                        <td className="py-1 pr-2 text-gdoc-muted">{r.size}</td>
                        <td className="py-1 text-gdoc-muted">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <ol className="mt-6 space-y-5">
              {page.steps.map((step, i) => (
                <StepCard key={step.title} step={step} n={i + 1} />
              ))}
            </ol>

            <section className="mt-8 rounded-lg border border-gdoc-border bg-white p-4">
              <h3 className="flex items-center gap-2 text-[15px] font-medium text-[#3c4043]">
                <ListOrdered size={15} className="flex-none text-bb-600" />
                Every piece, in order
              </h3>
              <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-gdoc-muted">
                Whichever page you are on, these five moves are the job. Steps {page.steps.length + 1}
                &ndash;{page.steps.length + GUIDE_WORKFLOW_STEPS.length} of it.
              </p>
              <ol className="mt-4 space-y-5">
                {GUIDE_WORKFLOW_STEPS.map((s, i) => (
                  <StepCard key={s.title} step={s} n={page.steps.length + i + 1} />
                ))}
              </ol>
            </section>

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
                      <th className="border-b border-gdoc-border py-1 pr-2 font-medium">Notes</th>
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

            <section className="mt-8 rounded-lg border border-gdoc-border bg-white p-4">
              <h3 className="flex items-center gap-1.5 text-[15px] font-medium text-[#3c4043]">
                <HelpCircle size={15} className="flex-none text-bb-600" />
                General rules of thumb
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-gdoc-muted">
                {GUIDE_GENERAL_RULES.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>

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
                Pick a page from the list and start it; the master page comes with every template.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ small screen */

/**
 * Below this width the guide's own two panes cannot both fit beside each other
 * (240px of contents plus a readable column of steps), which is the point at
 * which the *whole* job - a sheet, the frames, the pages - stops being workable.
 * A phone is 390-430px and a portrait tablet around 768px, so this is the line
 * between "cramped but possible" and "not the right device".
 */
const NARROW_AT = 700;

/**
 * The formatter lays the sheet, the frame list and the pages pane side by side
 * and needs every one of them; squeezed onto a phone it is unusable rather than
 * merely cramped, so it says so instead of pretending.
 */
function UseALaptop({ onBack }: { onBack: () => void }) {
  return (
    <div className="guide-root flex h-full w-full flex-col items-center justify-center gap-4 bg-[#f8f9fa] px-6 text-center font-ui text-[#2b2622]">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-bb-500/15">
        <Laptop size={28} className="text-bb-600" />
      </span>
      <h1 className="max-w-[28ch] text-[22px] font-medium text-[#3c4043]">
        Please use your laptop to use Bulletin Formatter
      </h1>
      <p className="max-w-[46ch] text-[13px] leading-relaxed text-gdoc-muted">
        Formatting a bulletin means working on a whole A4 sheet with the frames list and the pages
        pane open beside it. There is not enough room here to do that properly.
      </p>
      <button
        onClick={onBack}
        className="mt-2 flex items-center gap-1.5 rounded border border-gdoc-border bg-white px-3 py-2 text-[13px] text-[#3c4043] hover:border-bb-400"
      >
        <ArrowLeft size={15} />
        Back
      </button>
    </div>
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
