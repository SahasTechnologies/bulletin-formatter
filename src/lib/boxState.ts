/**
 * How a frame is written down, and how it is read back.
 *
 * A frame leaves the canvas through two doors - the undo stack and the saved
 * document - and returns through two more (`boxFromHistory` here, `buildBoxes`
 * in `frames.ts` for a stored document). Each of those four places used to spell
 * its own field list out by hand, and the lists drifted without anything
 * noticing: the saved document learned `rule`/`ruleWidth` while the undo stack
 * still had only `columns`, and the undo *rebuild* ignored `align`/`css` that the
 * history had been recording all along.
 *
 * That is the worst kind of bug to have, because neither half looks wrong on its
 * own. A field written but never read back is silent loss on the next reload; a
 * field read but never written is silent loss on the next Ctrl+Z; and a field
 * missing from both is silent loss the day someone adds it to `TextBox`.
 *
 * So the shape lives here, once: `BoxSnapshot` is what both writers must
 * produce and both readers must accept, and `tests/boxState.test.mjs` pushes a
 * frame carrying every field through both doors. The `FRAME_FIELDS` list below
 * is the checklist that test works from, and it is checked against `TextBox` at
 * compile time - so a new field on a frame fails the build until it is listed,
 * then fails the test until it survives a round trip.
 */
import { MIN_H, MIN_W } from './frames';
import type { TextBox } from './textbox';

/**
 * One frame as plain JSON - what the undo stack holds and what a document saves.
 *
 * Deliberately the *union* of both writers' shapes: a text frame populates the
 * typographic fields, a picture or shape fills the object fields, and neither
 * carries the other's. Every field is optional for exactly that reason, and a
 * reader has to tolerate all of them.
 */
export interface BoxSnapshot {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Flat content markup. Empty for anything that is not a text frame. */
  html: string;
  /** Next frame in the linked chain. */
  nextId: string | null;
  kind?: TextBox['kind'];
  src?: string;
  pdfPage?: number;
  radius?: number;
  fade?: number;
  fit?: 'cover' | 'contain';
  fill?: string;
  stroke?: string;
  thickness?: number;
  ph?: string;
  columns?: number;
  /** Column rule: its colour (`'none'` switches it off) and its weight, px. */
  rule?: string;
  ruleWidth?: number;
  align?: TextBox['align'];
  css?: string;
}

/**
 * Every field a frame can carry that has to survive being written down.
 *
 * The compile-time check under this list is the point of it: add a field to
 * `TextBox` and `UnlistedFrameField` stops being `never`, so `npm run build`
 * fails here until the field is accounted for. Then the round-trip test fails
 * until both the writers and the readers actually carry it.
 */
export const FRAME_FIELDS = [
  'id',
  'pageIndex',
  'x',
  'y',
  'w',
  'h',
  'html',
  'nextId',
  'kind',
  'src',
  'pdfPage',
  'radius',
  'fade',
  'fit',
  'fill',
  'stroke',
  'thickness',
  'ph',
  'columns',
  'rule',
  'ruleWidth',
  'align',
  'css',
] as const satisfies readonly (keyof TextBox)[];

/**
 * Fields a frame may carry that are deliberately never written down.
 *
 * `storyId` is the pre-linking story grouping. Chains are expressed by `nextId`
 * now, so the field exists only so frames saved by the old version still load;
 * nothing needs to preserve it through a save or an undo.
 */
type NotSerialized = 'storyId';

type UnlistedFrameField = Exclude<keyof TextBox, (typeof FRAME_FIELDS)[number] | NotSerialized>;

/** Fails to compile when a `TextBox` field is neither listed nor exempted. */
type ExpectNever<T extends never> = T;
type _EveryFrameFieldIsListed = ExpectNever<UnlistedFrameField>;

/**
 * The frame as the undo stack records it.
 *
 * `liveHtmlOf` is the DOM, because a text frame's `contentEditable` contents are
 * the truth while it is open - `box.html` is only the seed it was built from.
 * Objects (a picture, a rule, an empty-page marker) have no live text, so they
 * are written with none.
 */
export function snapshotOfBox(box: TextBox, liveHtmlOf: (id: string) => string | undefined): BoxSnapshot {
  return {
    id: box.id,
    pageIndex: box.pageIndex,
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
    html: box.kind ? '' : liveHtmlOf(box.id) ?? box.html,
    columns: box.columns,
    rule: box.rule,
    ruleWidth: typeof box.ruleWidth === 'number' ? Math.round(box.ruleWidth) : undefined,
    nextId: box.nextId,
    align: box.align,
    css: box.css,
    kind: box.kind,
    src: box.src,
    pdfPage: box.pdfPage,
    radius: box.radius,
    fade: box.fade,
    fit: box.fit,
    fill: box.fill,
    stroke: box.stroke,
    thickness: box.thickness,
    ph: box.ph,
  };
}

/** The whole document as the undo stack records it. */
export function historyStateOf(
  boxes: TextBox[],
  liveHtmlOf: (id: string) => string | undefined,
): string {
  return JSON.stringify(boxes.map((b) => snapshotOfBox(b, liveHtmlOf)));
}

/**
 * The frame as the *saved document* records it.
 *
 * Nearly identical to `snapshotOfBox`, and deliberately so - but not identical,
 * because a document's saved shape only describes what a reload needs, and a
 * picture never needs typography. `liveHtml` is passed in rather than read from
 * a ref so this stays a pure function of the frame.
 */
export function storedBoxOf(box: TextBox, liveHtml?: string): BoxSnapshot {
  if (box.kind) {
    // Image, shape, line and empty-page markers have no live text.
    return {
      id: box.id,
      pageIndex: box.pageIndex,
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.w),
      h: Math.round(box.h),
      html: '',
      nextId: box.nextId,
      kind: box.kind,
      src: box.src,
      pdfPage: box.pdfPage,
      radius: typeof box.radius === 'number' ? Math.round(box.radius) : undefined,
      fade: typeof box.fade === 'number' ? Math.round(box.fade) : undefined,
      fit: box.fit,
      fill: box.fill,
      stroke: box.stroke,
      thickness: typeof box.thickness === 'number' ? Math.round(box.thickness) : undefined,
      ph: box.ph,
    };
  }
  return {
    id: box.id,
    pageIndex: box.pageIndex,
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
    html: liveHtml ?? box.html,
    // Keep an explicit 1 so a deliberate single-column frame survives a reload
    // as one frame instead of being re-split per element.
    columns: box.columns ? Math.max(1, box.columns) : undefined,
    // The column rule is part of the frame, so it has to be written down:
    // without these two the choice lived only in React state and was silently
    // gone on the next reload.
    rule: box.rule,
    ruleWidth: typeof box.ruleWidth === 'number' ? Math.round(box.ruleWidth) : undefined,
    nextId: box.nextId,
    // The frame's standard outlives the session: a retype after a reload must
    // still adopt it rather than the first block's borrowed type.
    align: box.align,
    css: box.css,
  };
}

/**
 * The frame a history entry rebuilds into - the exact inverse of
 * `snapshotOfBox`, and the other half of every Ctrl+Z.
 *
 * Every field the writer records is read back here. The geometry numbers came
 * with defaults because a history entry always holds them; the optional fields
 * are read defensively because a stack survives a reload of the app and an old
 * entry may simply not have them.
 */
export function boxFromHistory(entry: BoxSnapshot): TextBox {
  return {
    id: String(entry.id),
    pageIndex: Number(entry.pageIndex ?? 0),
    x: Number(entry.x ?? 0),
    y: Number(entry.y ?? 0),
    w: Number(entry.w ?? MIN_W),
    h: Number(entry.h ?? MIN_H),
    html: typeof entry.html === 'string' ? entry.html : '',
    nextId: (entry.nextId as string | null) ?? null,
    kind: entry.kind as TextBox['kind'],
    src: typeof entry.src === 'string' ? entry.src : undefined,
    pdfPage: typeof entry.pdfPage === 'number' ? entry.pdfPage : undefined,
    radius: typeof entry.radius === 'number' ? entry.radius : undefined,
    fade: typeof entry.fade === 'number' ? entry.fade : undefined,
    fit: entry.fit === 'contain' ? 'contain' : entry.fit === 'cover' ? 'cover' : undefined,
    fill: typeof entry.fill === 'string' ? entry.fill : undefined,
    stroke: typeof entry.stroke === 'string' ? entry.stroke : undefined,
    thickness: typeof entry.thickness === 'number' ? entry.thickness : undefined,
    ph: typeof entry.ph === 'string' ? entry.ph : undefined,
    columns: typeof entry.columns === 'number' ? entry.columns : undefined,
    rule: typeof entry.rule === 'string' ? entry.rule : undefined,
    ruleWidth: typeof entry.ruleWidth === 'number' ? entry.ruleWidth : undefined,
    align:
      entry.align === 'center' || entry.align === 'right' || entry.align === 'justify' || entry.align === 'left'
        ? entry.align
        : undefined,
    css: typeof entry.css === 'string' ? entry.css : undefined,
  };
}
