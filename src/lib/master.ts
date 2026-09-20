/**
 * Master pages - the page furniture Microsoft Publisher calls a *master*.
 *
 * Publisher's model, which this file now follows:
 *
 *  - A publication holds **one or more master pages**, each with a one-character
 *    **Page ID** ("A", "B"…) and a **description** ("Master Page A"). View >
 *    Master Page lists them and opens one for editing.
 *  - A master is either a **single-page master** or a **two-page master** (a
 *    facing spread: a left sheet and a right sheet with their own furniture).
 *  - Every publication page is **assigned** a master - or none at all, which
 *    leaves that page bare. Apply To ▸ All pages / Current page / Apply Master
 *    Page… (a page range) is how an assignment is made.
 *  - The furniture itself is one **header** and one **footer**. Publisher puts
 *    an insertion point at the left edge and gives the band three tab stops -
 *    left, centre, right - so a single band can carry "Baulko Bulletin" on the
 *    left and a page number on the right. A `\t` in the band's text is that tab
 *    stop (see `bandSegments`).
 *
 * A master page is an *independent* page: it is irrespective of margin. The
 * bands sit outside the master's own frame, and neither the frame nor the bands
 * move when a margin is dragged (see `MASTER_INSET` in DocumentCanvas).
 *
 * Text may carry field tokens, resolved per page at render time:
 *   @page   page number        @pages  total pages
 *   @month  month name         @year   year
 *   @date   today's date       @time   current time
 *   @title  document title
 */

export type MasterAlign = 'left' | 'center' | 'right';

/** One furniture band (a header or a footer) on the master. */
export interface MasterBand {
  /** Plain text, possibly containing field tokens and tab characters. Empty =
      the band is hidden on the page. */
  text: string;
  /** Alignment of a band with no tab stop in it. A band that holds a `\t` is
      laid out at Publisher's tab stops instead (see `bandSegments`). */
  align: MasterAlign;
}

export type BandSlot = 'header' | 'footer';
/** Which sheet of a master a band belongs to (left/right of a facing spread). */
export type MasterSide = 'right' | 'left';

/** The pair of bands one sheet of a master carries. */
export interface MasterBands {
  header: MasterBand;
  footer: MasterBand;
}

/** One master page - Publisher's "Master Page A", "Master Page B"… */
export interface MasterDef {
  /** One-character Page ID, as Publisher's "Page ID (1 character)" field. */
  id: string;
  /** Human description, e.g. "Master Page A" or "Cover". */
  description: string;
  /** A two-page master is a facing spread: its left sheet dresses the even
      pages, its right sheet the odd ones (and page 1). */
  twoPage: boolean;
  /** Furniture for right-hand (odd) pages - and for every page of a
      single-page master. */
  right: MasterBands;
  /** Furniture for left-hand (even) pages. Only drawn on a two-page master. */
  left: MasterBands;
  /** Publisher's global "Show Header/Footer" switch for this master. */
  headerFooterVisible: boolean;
}

/** The publication's master pages, who is assigned to what, and which one the
    master-page view is currently editing. */
export interface MasterSet {
  masters: MasterDef[];
  /** `pageIndex` (as a string) → master id, or `NO_MASTER` for a bare page.
      The key `'*'` is "every page" - what Apply To ▸ All pages records, so
      pages created later are covered too. A page with no entry falls back to
      the first master. */
  assignment: Record<string, string>;
  /** Master open in the master-page view. */
  activeId: string;
}

/** A page deliberately dressed by no master. */
export const NO_MASTER = 'none';

/** Tokens offered by the master panel's "Insert field" row. */
export const MASTER_TOKENS: { token: string; label: string }[] = [
  { token: '@page', label: 'Page number' },
  { token: '@pages', label: 'Page count' },
  { token: '@month', label: 'Month' },
  { token: '@year', label: 'Year' },
  { token: '@date', label: 'Date' },
  { token: '@time', label: 'Time' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const band = (text = '', align: MasterAlign = 'left'): MasterBand => ({ text, align });

function emptyBands(): MasterBands {
  return { header: band('', 'right'), footer: band('', 'left') };
}

/** Every band slot a master holds, in the order the panel edits them. */
export type BandKey = 'rightHeader' | 'rightFooter' | 'leftHeader' | 'leftFooter';

export const BAND_LABELS: Record<BandKey, string> = {
  rightHeader: 'Header',
  rightFooter: 'Footer',
  leftHeader: 'Left page header',
  leftFooter: 'Left page footer',
};

export function bandKey(side: MasterSide, slot: BandSlot): BandKey {
  return `${side}${slot === 'header' ? 'Header' : 'Footer'}` as BandKey;
}

export function splitBandKey(key: BandKey): { side: MasterSide; slot: BandSlot } {
  return {
    side: key.startsWith('left') ? 'left' : 'right',
    slot: key.endsWith('Header') ? 'header' : 'footer',
  };
}

/* ------------------------------------------------------------- creation -- */

export function newMaster(id: string, description: string, twoPage = false): MasterDef {
  return {
    id,
    description,
    twoPage,
    right: emptyBands(),
    left: emptyBands(),
    headerFooterVisible: true,
  };
}

/** A publication with one blank master, "A". */
export function emptyMasterSet(): MasterSet {
  return { masters: [newMaster('A', 'Master Page A')], assignment: {}, activeId: 'A' };
}

/**
 * The next free one-character Page ID: A, B, … Z, then the digits.
 *
 * The id has to be a *single* character - that is what Publisher's "Page ID (1
 * character)" field holds, and `sanitizeId` truncates anything longer. The old
 * fallback returned a two-character id (`M4`), which `addMaster` then sanitized
 * back down to `M` - an id that was already taken - so the twenty-seventh
 * master could not be created at all. The digits are the honest place to look
 * past the alphabet.
 *
 * Returns null once all thirty-six are taken, which no real publication reaches.
 * It cannot fall back to a taken id: a second master sharing one would be
 * unreachable, since every lookup (`find(m => m.id === id)`) resolves to the
 * first. Callers refuse the new master and say so instead.
 */
export function nextMasterId(set: MasterSet): string | null {
  const used = new Set(set.masters.map((m) => m.id.toUpperCase()));
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    if (!used.has(ch)) return ch;
  }
  return null;
}

/** Publisher's default description for a new master. */
export function defaultDescription(id: string): string {
  return `Master Page ${id}`;
}

/** Clean a Page ID to what Publisher accepts: one visible character. */
export function sanitizeId(raw: string): string {
  const t = (raw || '').trim();
  return t ? t.slice(0, 1).toUpperCase() : '';
}

export function masterById(set: MasterSet, id: string | null | undefined): MasterDef | null {
  if (!id) return null;
  return set.masters.find((m) => m.id === id) ?? null;
}

/** The master the master-page view is editing (never null for a valid set). */
export function activeMaster(set: MasterSet): MasterDef {
  return masterById(set, set.activeId) ?? set.masters[0] ?? newMaster('A', 'Master Page A');
}

/** The master assigned to a page, or null when the page carries none. */
export function masterForPage(set: MasterSet, pageIndex: number): MasterDef | null {
  const assigned =
    set.assignment[String(pageIndex)] ?? set.assignment['*'] ?? set.masters[0]?.id;
  if (!assigned || assigned === NO_MASTER) return null;
  return masterById(set, assigned) ?? set.masters[0] ?? null;
}

/** Which sheet of a two-page master a page uses: odd pages sit on the right. */
export function sideForPage(master: MasterDef, pageIndex: number): MasterSide {
  if (!master.twoPage) return 'right';
  return pageIndex % 2 === 1 ? 'left' : 'right';
}

/**
 * The band that actually prints on a given page, or null when the page carries
 * none. `pageIndex` is zero-based (page 1 is index 0).
 */
export function bandForPage(
  set: MasterSet,
  slot: BandSlot,
  pageIndex: number,
): MasterBand | null {
  const m = masterForPage(set, pageIndex);
  if (!m || m.headerFooterVisible === false) return null;
  return m[sideForPage(m, pageIndex)][slot];
}

/** A band to edit in master view - always present, even when empty. */
export function bandOf(master: MasterDef, side: MasterSide, slot: BandSlot): MasterBand {
  return master[side][slot];
}

/* --------------------------------------------------------------- edits -- */

/** Write a band back into a master. */
export function withBand(
  set: MasterSet,
  masterId: string,
  side: MasterSide,
  slot: BandSlot,
  patch: Partial<MasterBand>,
): MasterSet {
  return {
    ...set,
    masters: set.masters.map((m) => {
      if (m.id !== masterId) return m;
      const current = m[side][slot];
      return {
        ...m,
        [side]: {
          ...m[side],
          [slot]: {
            text: patch.text !== undefined ? patch.text : current.text,
            align: patch.align !== undefined ? patch.align : current.align,
          },
        },
      };
    }),
  };
}

/** Patch one master's own settings (description, two-page, Show Header/Footer). */
export function updateMaster(
  set: MasterSet,
  id: string,
  patch: Partial<Omit<MasterDef, 'id'>>,
): MasterSet {
  return {
    ...set,
    masters: set.masters.map((m) => (m.id === id ? { ...m, ...patch, id: m.id } : m)),
  };
}

/**
 * Add a master. Fails (returns the set unchanged, with a message) when the Page
 * ID is empty or already taken - Publisher refuses both.
 */
export function addMaster(
  set: MasterSet,
  id: string,
  description: string,
  twoPage = false,
): { set: MasterSet; error?: string } {
  const clean = sanitizeId(id);
  if (!clean) return { set, error: 'A master page needs a one-character Page ID.' };
  if (masterById(set, clean)) {
    return { set, error: `Master page ${clean} already exists - pick another Page ID.` };
  }
  const master = newMaster(clean, description.trim() || defaultDescription(clean), twoPage);
  return { set: { ...set, masters: [...set.masters, master], activeId: clean } };
}

/** Copy a master under a new Page ID (Publisher's Duplicate). */
export function duplicateMaster(
  set: MasterSet,
  fromId: string,
  id: string,
  description: string,
): { set: MasterSet; error?: string } {
  const src = masterById(set, fromId);
  if (!src) return { set, error: 'That master page no longer exists.' };
  const clean = sanitizeId(id);
  if (!clean) return { set, error: 'A master page needs a one-character Page ID.' };
  if (masterById(set, clean)) {
    return { set, error: `Master page ${clean} already exists - pick another Page ID.` };
  }
  const copy: MasterDef = {
    ...src,
    id: clean,
    description: description.trim() || defaultDescription(clean),
    right: { header: { ...src.right.header }, footer: { ...src.right.footer } },
    left: { header: { ...src.left.header }, footer: { ...src.left.footer } },
  };
  return { set: { ...set, masters: [...set.masters, copy], activeId: clean } };
}

/** Rename a master's Page ID and/or description, keeping its assignments. */
export function renameMaster(
  set: MasterSet,
  fromId: string,
  id: string,
  description: string,
): { set: MasterSet; error?: string } {
  const src = masterById(set, fromId);
  if (!src) return { set, error: 'That master page no longer exists.' };
  const clean = sanitizeId(id);
  if (!clean) return { set, error: 'A master page needs a one-character Page ID.' };
  if (clean !== src.id && masterById(set, clean)) {
    return { set, error: `Master page ${clean} already exists - pick another Page ID.` };
  }
  const assignment: Record<string, string> = {};
  for (const [page, assigned] of Object.entries(set.assignment)) {
    assignment[page] = assigned === src.id ? clean : assigned;
  }
  return {
    set: {
      ...set,
      masters: set.masters.map((m) =>
        m.id === src.id
          ? { ...m, id: clean, description: description.trim() || defaultDescription(clean) }
          : m,
      ),
      assignment,
      activeId: set.activeId === src.id ? clean : set.activeId,
    },
  };
}

/**
 * Delete a master. Publisher substitutes the first master for any page that
 * used it, so pages never lose their furniture by accident.
 */
export function removeMaster(
  set: MasterSet,
  id: string,
): { set: MasterSet; error?: string } {
  if (set.masters.length <= 1) {
    return { set, error: 'A publication needs at least one master page.' };
  }
  const fallback = set.masters.find((m) => m.id !== id)?.id ?? '';
  const assignment: Record<string, string> = {};
  for (const [page, assigned] of Object.entries(set.assignment)) {
    assignment[page] = assigned === id ? fallback : assigned;
  }
  const masters = set.masters.filter((m) => m.id !== id);
  const activeId = set.activeId === id ? masters[0]?.id ?? fallback : set.activeId;
  return { set: { ...set, masters, assignment, activeId } };
}

/**
 * Publisher's Apply To. `pages` is `'all'` (recorded as the `'*'` assignment so
 * later pages are covered too) or a list of zero-based page indexes.
 */
export function applyMasterTo(
  set: MasterSet,
  id: string,
  pages: 'all' | number[],
): MasterSet {
  if (pages === 'all') {
    return { ...set, assignment: { '*': id } };
  }
  const assignment: Record<string, string> = { ...set.assignment };
  for (const p of pages) assignment[String(Math.max(0, p))] = id;
  return { ...set, assignment };
}

/** The masters assigned to each page, for the panel's summary line. */
export function assignmentSummary(set: MasterSet, pageCount: number): string {
  const counts = new Map<string, number>();
  for (let i = 0; i < Math.max(1, pageCount); i++) {
    const m = masterForPage(set, i);
    const key = m ? m.id : NO_MASTER;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, n]) => (id === NO_MASTER ? `no master ×${n}` : `${id} ×${n}`))
    .join(', ');
}

/* ------------------------------------------------------------- resolve -- */

/** Resolve the field tokens in a band's text for one particular page. */
export function fillMasterTokens(
  text: string,
  pageNumber: number,
  pageCount: number,
  title = '',
): string {
  const now = new Date();
  return (text || '')
    .replace(/@pages/g, String(Math.max(1, pageCount)))
    .replace(/@page/g, String(pageNumber))
    .replace(/@month/g, MONTHS[now.getMonth()] ?? '')
    .replace(/@year/g, String(now.getFullYear()))
    .replace(/@date/g, now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))
    .replace(/@time/g, now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
    .replace(/@title/g, title);
}

/**
 * Split a band's raw text into Publisher's three tab stops.
 *
 * A band with no tab is plain text (aligned by `band.align`). A band holding
 * `\t` is laid out on the left, centre and right stops, so one header can carry
 * the running head on the left and the folio on the right - exactly what
 * Publisher's Tab key does inside the header. Everything after the third stop
 * is folded into the right slot so no typing is ever lost.
 */
export function bandSegments(text: string): [string, string, string] {
  const parts = (text ?? '').split('\t');
  const left = parts[0] ?? '';
  const centre = parts.length > 1 ? parts[1] ?? '' : '';
  const right = parts.length > 2 ? parts.slice(2).join('\t') : '';
  return [left, centre, right];
}

/** Rebuild a band's raw text from its tab stops, dropping empty trailing ones. */
export function joinBandSegments(segments: [string, string, string]): string {
  const [l, c, r] = segments;
  if (r !== '') return `${l}\t${c}\t${r}`;
  if (c !== '') return `${l}\t${c}`;
  return l;
}

/** True when a band is laid out on tab stops rather than by `align`. */
export function hasTabStops(text: string): boolean {
  return (text ?? '').includes('\t');
}

/* ----------------------------------------------------------- migration -- */

const isAlign = (v: unknown): v is MasterAlign =>
  v === 'left' || v === 'center' || v === 'right';

function readBand(raw: unknown, fallback: MasterBand): MasterBand {
  if (!raw || typeof raw !== 'object') {
    // Oldest format: the band was a bare string.
    return typeof raw === 'string' ? band(raw, fallback.align) : { ...fallback };
  }
  const r = raw as Partial<MasterBand>;
  return {
    text: typeof r.text === 'string' ? r.text : '',
    align: isAlign(r.align) ? r.align : fallback.align,
  };
}

function readBands(raw: unknown, fallback: MasterBands): MasterBands {
  const r = (raw ?? {}) as Partial<MasterBands>;
  return { header: readBand(r.header, fallback.header), footer: readBand(r.footer, fallback.footer) };
}

/** The pre-multiple-masters shape: one master with first-page/odd-even variants. */
interface LegacySingleMaster {
  header?: unknown;
  footer?: unknown;
  firstHeader?: unknown;
  firstFooter?: unknown;
  evenHeader?: unknown;
  evenFooter?: unknown;
  differentFirstPage?: unknown;
  differentOddEven?: unknown;
  showOnFirstPage?: unknown;
  bandsVisible?: unknown;
}

function sameBand(a: MasterBand, b: MasterBand): boolean {
  return a.text === b.text && a.align === b.align;
}

/** Turn the old single master into Master A (plus B when page 1 differed). */
function fromLegacySingle(
  raw: LegacySingleMaster,
  legacy?: { masterHeader?: string; masterFooter?: string },
): MasterSet {
  const right: MasterBands = {
    header: readBand(raw.header, legacy?.masterHeader
      ? band(legacy.masterHeader, 'right')
      : emptyBands().header),
    footer: readBand(raw.footer, legacy?.masterFooter
      ? band(legacy.masterFooter, 'left')
      : emptyBands().footer),
  };
  const twoPage = raw.differentOddEven === true;
  const left: MasterBands = twoPage
    ? {
        header: readBand(raw.evenHeader, { ...right.header }),
        footer: readBand(raw.evenFooter, { ...right.footer }),
      }
    : emptyBands();

  const masterA: MasterDef = {
    id: 'A',
    description: 'Master Page A',
    twoPage,
    right,
    left,
    headerFooterVisible: raw.bandsVisible !== false,
  };

  const masters: MasterDef[] = [masterA];
  const assignment: Record<string, string> = {};

  // "Different first page" is a second master in Publisher's world: page 1 is
  // simply assigned a different one. Keep the old bands by making that master,
  // but only when page 1 really did differ - otherwise don't invent a B.
  if (raw.differentFirstPage === true) {
    const firstHeader = readBand(raw.firstHeader, { ...right.header });
    const firstFooter = readBand(raw.firstFooter, { ...right.footer });
    if (!sameBand(firstHeader, right.header) || !sameBand(firstFooter, right.footer)) {
      masters.push({
        id: 'B',
        description: 'First page',
        twoPage: false,
        right: { header: firstHeader, footer: firstFooter },
        left: emptyBands(),
        headerFooterVisible: masterA.headerFooterVisible,
      });
      assignment['0'] = 'B';
    }
  }
  if (raw.showOnFirstPage === false) assignment['0'] = NO_MASTER;

  return { masters, assignment, activeId: 'A' };
}

/** True when `raw` looks like the old single-master object rather than a set. */
function looksSingle(raw: Record<string, unknown>): boolean {
  return !Array.isArray(raw.masters) && ('header' in raw || 'footer' in raw);
}

/**
 * Rebuild a MasterSet from anything stored on disk: a serialized MasterSet, the
 * older single-master object, the legacy `masterHeader`/`masterFooter` string
 * pair, or nothing at all. Never throws - a corrupt master must not stop a
 * document from opening.
 */
export function normalizeMasterSet(
  raw: unknown,
  legacy?: { masterHeader?: string; masterFooter?: string },
): MasterSet {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (looksSingle(r)) return fromLegacySingle(r as LegacySingleMaster, legacy);
    if (Array.isArray(r.masters) && r.masters.length) {
      const masters: MasterDef[] = (r.masters as unknown[]).map((m, i) => {
        const d = (m ?? {}) as Partial<MasterDef>;
        const fallback = newMaster(
          sanitizeId(String(d.id ?? '')) || String.fromCharCode(65 + i),
          String(d.description ?? ''),
        );
        return {
          id: fallback.id,
          description: typeof d.description === 'string' && d.description.trim()
            ? d.description
            : defaultDescription(fallback.id),
          twoPage: d.twoPage === true,
          right: readBands(d.right, fallback.right),
          left: readBands(d.left, fallback.left),
          headerFooterVisible: d.headerFooterVisible !== false,
        };
      });
      // Duplicate ids would make an assignment ambiguous; drop the later ones.
      const seen = new Set<string>();
      const unique = masters.filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      const assignment: Record<string, string> = {};
      if (r.assignment && typeof r.assignment === 'object') {
        for (const [page, id] of Object.entries(r.assignment as Record<string, unknown>)) {
          if (typeof id === 'string' && (id === NO_MASTER || seen.has(id))) assignment[page] = id;
        }
      }
      const activeId =
        typeof r.activeId === 'string' && seen.has(r.activeId) ? r.activeId : unique[0].id;
      return { masters: unique, assignment, activeId };
    }
  }
  const base = emptyMasterSet();
  if (legacy?.masterHeader || legacy?.masterFooter) {
    base.masters[0].right.header = band(legacy.masterHeader ?? '', 'right');
    base.masters[0].right.footer = band(legacy.masterFooter ?? '', 'left');
  }
  return base;
}

/** Read a master set back from its stored JSON, falling back to the legacy pair. */
export function loadMaster(
  json: string | undefined,
  legacy?: { masterHeader?: string; masterFooter?: string },
): MasterSet {
  if (json) {
    try {
      return normalizeMasterSet(JSON.parse(json), legacy);
    } catch {
      /* corrupt JSON - fall through to the legacy fields / empty set */
    }
  }
  return normalizeMasterSet(undefined, legacy);
}

export function serializeMaster(set: MasterSet): string {
  return JSON.stringify(set);
}
