/**
 * The end-of-piece marker - the black square a bulletin piece signs off with
 * (the printer's "end of story" mark).
 *
 * The marker is *pinned*, never placed: it belongs outside the master page's
 * frame in the bottom-right corner of the sheet, clear of the orange guide line
 * and the footer band that sit inside it. Publisher's own end mark is a fixed
 * piece of furniture, and treating it that way here has two payoffs:
 *
 *  - Templates cannot drift: a template that declared a marker in the middle of
 *    the master frame (the poem used to centre one under the stanzas) still
 *    lands in the corner, because the position comes from here, not from the
 *    template's `data-frame`.
 *  - Documents saved before the marker was standardised are snapped into place
 *    when they open (see `normalizeTombstones` in DocumentCanvas), so an old
 *    piece is corrected rather than left with its marker inside the type.
 */

/** Side of the marker's square, px. Twice the 12px square the bulletin first
    drew, so it still reads as a full stop at print size. */
export const TOMBSTONE_SIZE = 24;

/**
 * Distance from the sheet's trim edges, px.
 *
 * The master frame is inset `MASTER_INSET` (48px) from every edge and the
 * footer band sits in that margin, so a 24px square parked 12px from the corner
 * clears both: the frame's edge is 48px in, and the marker's near edge is 12px
 * out from the trim - squarely in the bottom-right margin, on the paper.
 */
export const TOMBSTONE_EDGE_GAP = 12;

export interface SheetSize {
  width: number;
  height: number;
}

/** Where the marker sits on a sheet: the bottom-right corner, outside the
    master page's frame. Geometry only, in page px. */
export function tombstoneCorner(page: SheetSize): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: Math.round(page.width - TOMBSTONE_SIZE - TOMBSTONE_EDGE_GAP),
    y: Math.round(page.height - TOMBSTONE_SIZE - TOMBSTONE_EDGE_GAP),
    w: TOMBSTONE_SIZE,
    h: TOMBSTONE_SIZE,
  };
}

/** True when `box` is a marker sitting anywhere other than the standard corner
    on a sheet of this size - i.e. it needs snapping back into place. */
export function tombstoneOffCorner(
  box: { x: number; y: number; w: number; h: number },
  page: SheetSize,
): boolean {
  const corner = tombstoneCorner(page);
  return (
    box.x !== corner.x || box.y !== corner.y || box.w !== corner.w || box.h !== corner.h
  );
}
