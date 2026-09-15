/**
 * Snapping and smart guides for laying out frames on a page.
 *
 * Snaps moving and resizing frames to:
 *  - Master frame margins and page centre
 *  - Two- and three-column gutters
 *  - Edges and centres of neighbouring frames on the same page
 */

import { type TextBox } from './textbox';

export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  pos: number;
  kind?: 'master' | 'frame' | 'gutter' | 'center';
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SNAP_THRESHOLD_PX = 6;
const COLUMN_GAP = 28;

export function computeSnap(
  rect: Rect,
  page: { width: number; height: number },
  masterGuide: { left: number; top: number; width: number; height: number },
  otherBoxes: TextBox[],
  scale = 1,
): SnapResult {
  const threshold = SNAP_THRESHOLD_PX / Math.max(0.2, scale);

  const vTargets: { pos: number; kind: SnapGuide['kind'] }[] = [
    // Page & Master vertical lines
    { pos: masterGuide.left, kind: 'master' },
    { pos: masterGuide.left + masterGuide.width, kind: 'master' },
    { pos: page.width / 2, kind: 'center' },
    { pos: masterGuide.left + masterGuide.width / 2, kind: 'center' },
  ];

  // 2-column gutters
  const twoColW = (masterGuide.width - COLUMN_GAP) / 2;
  vTargets.push(
    { pos: masterGuide.left + twoColW, kind: 'gutter' },
    { pos: masterGuide.left + twoColW + COLUMN_GAP / 2, kind: 'gutter' },
    { pos: masterGuide.left + twoColW + COLUMN_GAP, kind: 'gutter' },
  );

  // 3-column gutters
  const threeColW = (masterGuide.width - COLUMN_GAP * 2) / 3;
  vTargets.push(
    { pos: masterGuide.left + threeColW, kind: 'gutter' },
    { pos: masterGuide.left + threeColW + COLUMN_GAP, kind: 'gutter' },
    { pos: masterGuide.left + threeColW * 2 + COLUMN_GAP, kind: 'gutter' },
    { pos: masterGuide.left + threeColW * 2 + COLUMN_GAP * 2, kind: 'gutter' },
  );

  const hTargets: { pos: number; kind: SnapGuide['kind'] }[] = [
    // Page & Master horizontal lines
    { pos: masterGuide.top, kind: 'master' },
    { pos: masterGuide.top + masterGuide.height, kind: 'master' },
    { pos: page.height / 2, kind: 'center' },
    { pos: masterGuide.top + masterGuide.height / 2, kind: 'center' },
  ];

  // Other frames' edges & centers
  for (const b of otherBoxes) {
    vTargets.push(
      { pos: b.x, kind: 'frame' },
      { pos: b.x + b.w, kind: 'frame' },
      { pos: b.x + b.w / 2, kind: 'frame' },
    );
    hTargets.push(
      { pos: b.y, kind: 'frame' },
      { pos: b.y + b.h, kind: 'frame' },
      { pos: b.y + b.h / 2, kind: 'frame' },
    );
  }

  let snappedX = rect.x;
  let snappedY = rect.y;
  const guides: SnapGuide[] = [];

  // Check horizontal snap (vertical lines)
  const xPoints = [
    { pt: rect.x, offset: 0 },
    { pt: rect.x + rect.w, offset: -rect.w },
    { pt: rect.x + rect.w / 2, offset: -rect.w / 2 },
  ];

  let minDeltaX = threshold + 1;
  let bestVGuide: SnapGuide | null = null;

  for (const xp of xPoints) {
    for (const target of vTargets) {
      const delta = Math.abs(xp.pt - target.pos);
      if (delta <= threshold && delta < minDeltaX) {
        minDeltaX = delta;
        snappedX = target.pos + xp.offset;
        bestVGuide = { type: 'vertical', pos: target.pos, kind: target.kind };
      }
    }
  }

  if (bestVGuide) {
    guides.push(bestVGuide);
  }

  // Check vertical snap (horizontal lines)
  const yPoints = [
    { pt: rect.y, offset: 0 },
    { pt: rect.y + rect.h, offset: -rect.h },
    { pt: rect.y + rect.h / 2, offset: -rect.h / 2 },
  ];

  let minDeltaY = threshold + 1;
  let bestHGuide: SnapGuide | null = null;

  for (const yp of yPoints) {
    for (const target of hTargets) {
      const delta = Math.abs(yp.pt - target.pos);
      if (delta <= threshold && delta < minDeltaY) {
        minDeltaY = delta;
        snappedY = target.pos + yp.offset;
        bestHGuide = { type: 'horizontal', pos: target.pos, kind: target.kind };
      }
    }
  }

  if (bestHGuide) {
    guides.push(bestHGuide);
  }

  return {
    x: Math.round(snappedX),
    y: Math.round(snappedY),
    guides,
  };
}
