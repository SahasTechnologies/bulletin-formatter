import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FileStack, Trash2, X } from 'lucide-react';
import { mergeIssue, readMergeInputs, type MergeInput } from '../lib/merge';

/**
 * The Merge dialog: pick several `.bulletin` files, put them in order, and
 * build one issue out of them with a generated Page of Contents.
 */
export default function MergeDialog({
  files,
  onCancel,
  onMerge,
}: {
  files: File[];
  onCancel: () => void;
  onMerge: (result: ReturnType<typeof mergeIssue>) => void;
}) {
  const [inputs, setInputs] = useState<MergeInput[] | null>(null);
  const [title, setTitle] = useState('Merged issue');
  const [makeContents, setMakeContents] = useState(true);
  const [coverFirst, setCoverFirst] = useState(true);
  const [endLast, setEndLast] = useState(true);

  useEffect(() => {
    let alive = true;
    readMergeInputs(files).then((parsed) => {
      if (!alive) return;
      setInputs(parsed);
      if (parsed.length) {
        setTitle(
          parsed.length === 1 ? parsed[0].title : `Merged issue (${parsed.length} pages)`,
        );
      }
    });
    return () => {
      alive = false;
    };
  }, [files]);

  const move = (i: number, dir: -1 | 1) =>
    setInputs((list) => {
      if (!list) return list;
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const remove = (i: number) =>
    setInputs((list) => (list ? list.filter((_, k) => k !== i) : list));

  const ready = (inputs?.length ?? 0) > 0;
  /** A contents page is only generated when the import did not bring one. */
  const importedContents = (inputs ?? []).some((i) => i.kind === 'contents');
  const willGenerateContents = makeContents && !importedContents;

  const preview = useMemo(() => {
    if (!inputs?.length) return null;
    return mergeIssue(inputs, { makeContents, coverFirst, endLast, title });
  }, [inputs, makeContents, coverFirst, endLast, title]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-[620px] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <header className="flex flex-none items-center gap-2 border-b border-gdoc-border px-4 py-3">
          <FileStack size={18} className="text-bb-600" />
          <h2 className="flex-1 text-[15px] font-medium text-[#3c4043]">Merge bulletins</h2>
          <button
            onClick={onCancel}
            className="rounded p-1 text-gdoc-muted hover:bg-gdoc-hover"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!inputs ? (
            <p className="text-[13px] text-gdoc-muted">Reading files…</p>
          ) : inputs.length === 0 ? (
            <p className="text-[13px] text-gdoc-muted">
              None of those files could be read as a <code>.bulletin</code> document.
            </p>
          ) : (
            <>
              <p className="mb-2 text-[13px] text-gdoc-muted">
                {inputs.length} page{inputs.length === 1 ? '' : 's'} - drag them into the order
                you want with the arrows. The cover goes to the front, the end page to the
                bottom.
              </p>
              <ul className="overflow-hidden rounded border border-gdoc-border">
                {inputs.map((input, i) => (
                  <li
                    key={`${input.fileName}-${i}`}
                    className="relative flex items-center gap-2 px-3 py-2"
                  >
                    {/* A rounded bar over a `divide-y` hairline, so the rows
                        are fenced off the same way every other divider in the
                        app is drawn. */}
                    {i > 0 && (
                      <span
                        className="divider-bar pointer-events-none absolute inset-x-3 top-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="w-5 flex-none text-[12px] text-gdoc-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[#3c4043]">
                        {input.title}
                      </span>
                      <span className="block truncate text-[11px] text-gdoc-muted">
                        {input.fileName}
                      </span>
                    </span>
                    <span className="flex-none rounded border border-gdoc-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gdoc-muted">
                      {input.kind}
                    </span>
                    <span className="flex flex-none items-center">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        title="Move up"
                        className="grid h-6 w-6 place-items-center rounded text-gdoc-muted hover:bg-gdoc-hover disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === inputs.length - 1}
                        title="Move down"
                        className="grid h-6 w-6 place-items-center rounded text-gdoc-muted hover:bg-gdoc-hover disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        onClick={() => remove(i)}
                        title="Remove"
                        className="grid h-6 w-6 place-items-center rounded text-gdoc-muted hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>

              <label className="mt-4 block">
                <span className="text-[12px] text-gdoc-muted">Issue title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded border border-gdoc-border px-2 py-1.5 text-[13px] outline-none focus:border-bb-400"
                />
              </label>

              <div className="mt-3 space-y-1.5">
                <Check
                  checked={makeContents}
                  onChange={setMakeContents}
                  label="Build a Page of contents from the merged pages"
                />
                <Check
                  checked={coverFirst}
                  onChange={setCoverFirst}
                  label="Keep the cover page at the front"
                />
                <Check
                  checked={endLast}
                  onChange={setEndLast}
                  label="Keep the end page at the bottom"
                />
              </div>

              {preview && (
                <p className="mt-3 rounded bg-[#faf7f4] px-3 py-2 text-[12px] text-gdoc-muted">
                  Result: {preview.pageCount} page
                  {preview.pageCount === 1 ? '' : 's'}
                  {willGenerateContents
                    ? ', plus a generated page of contents'
                    : importedContents
                      ? ' - using the contents page you imported'
                      : ''}
                  .
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-none items-center justify-end gap-2 border-t border-gdoc-border px-4 py-3">
          <button
            onClick={onCancel}
            className="rounded border border-gdoc-border px-3 py-1.5 text-[13px] text-[#2b2622] hover:bg-gdoc-hover"
          >
            Cancel
          </button>
          <button
            disabled={!ready}
            onClick={() => {
              if (!inputs?.length) return;
              onMerge(mergeIssue(inputs, { makeContents, coverFirst, endLast, title }));
            }}
            className="rounded bg-bb-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-bb-600 disabled:opacity-40"
          >
            Merge
          </button>
        </footer>
      </div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-[#3c4043]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-bb-500"
      />
      {label}
    </label>
  );
}
