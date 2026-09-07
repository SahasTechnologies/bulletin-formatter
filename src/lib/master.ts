/**
 * Master pages — the page furniture Microsoft Publisher calls a *master*.
 *
 * In Publisher, View > Master Page takes you to the master, where the header
 * and footer sit inside the page's top and bottom margins, drawn with dashed
 * non-printing guides. You type directly into them, and every page in the
 * publication picks the change up. A master supports:
 *
 *  - a separate running head/folio on page 1 ("Different first page"),
 *  - separate furniture on even pages ("Different odd & even pages"),
 *  - and hiding the furniture from page 1 entirely.
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
  /** Plain text, possibly containing field tokens. Empty = band is hidden. */
  text: string;
  align: MasterAlign;
}

export interface MasterPage {
  /** Bands used on ordinary (odd) pages. */
  header: MasterBand;
  footer: MasterBand;
  /** Page 1 gets its own pair of bands. */
  differentFirstPage: boolean;
  firstHeader: MasterBand;
  firstFooter: MasterBand;
  /** Even pages get their own pair of bands. */
  differentOddEven: boolean;
  evenHeader: MasterBand;
  evenFooter: MasterBand;
  /** With this off, page 1 carries no header/footer at all. */
  showOnFirstPage: boolean;
}

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

/** A master with both bands switched off. */
export function emptyMaster(): MasterPage {
  return {
    header: band('', 'right'),
    footer: band('', 'left'),
    differentFirstPage: false,
    firstHeader: band('', 'right'),
    firstFooter: band('', 'left'),
    differentOddEven: false,
    evenHeader: band('', 'right'),
    evenFooter: band('', 'left'),
    showOnFirstPage: true,
  };
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

/**
 * Rebuild a MasterPage from anything stored on disk: a serialized MasterPage,
 * the legacy `masterHeader`/`masterFooter` string pair, or nothing at all.
 * Never throws — a corrupt master must not stop a document from opening.
 */
export function normalizeMaster(
  raw: unknown,
  legacy?: { masterHeader?: string; masterFooter?: string },
): MasterPage {
  const base = emptyMaster();
  if (raw && typeof raw === 'object') {
    const r = raw as Partial<MasterPage>;
    base.header = readBand(r.header, band('', 'right'));
    base.footer = readBand(r.footer, band('', 'left'));
    base.firstHeader = readBand(r.firstHeader, { ...base.header });
    base.firstFooter = readBand(r.firstFooter, { ...base.footer });
    base.evenHeader = readBand(r.evenHeader, { ...base.header });
    base.evenFooter = readBand(r.evenFooter, { ...base.footer });
    base.differentFirstPage = r.differentFirstPage === true;
    base.differentOddEven = r.differentOddEven === true;
    base.showOnFirstPage = r.showOnFirstPage !== false;
    return base;
  }
  if (legacy?.masterHeader || legacy?.masterFooter) {
    base.header = band(legacy.masterHeader ?? '', 'right');
    base.footer = band(legacy.masterFooter ?? '', 'left');
  }
  return base;
}

/** Read a master back from its stored JSON, falling back to the legacy pair. */
export function loadMaster(
  json: string | undefined,
  legacy?: { masterHeader?: string; masterFooter?: string },
): MasterPage {
  if (json) {
    try {
      return normalizeMaster(JSON.parse(json), legacy);
    } catch {
      /* corrupt JSON — fall through to the legacy fields / empty master */
    }
  }
  return normalizeMaster(undefined, legacy);
}

export function serializeMaster(m: MasterPage): string {
  return JSON.stringify(m);
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

export type BandSlot = 'header' | 'footer';

/**
 * Which band actually prints on a given page, honouring the master's
 * first-page and odd/even options. Returns null when the page carries none.
 */
export function bandForPage(
  m: MasterPage,
  slot: BandSlot,
  pageIndex: number,
): MasterBand | null {
  if (pageIndex === 0) {
    if (!m.showOnFirstPage) return null;
    if (m.differentFirstPage) return slot === 'header' ? m.firstHeader : m.firstFooter;
    return slot === 'header' ? m.header : m.footer;
  }
  if (m.differentOddEven && pageIndex % 2 === 1) {
    return slot === 'header' ? m.evenHeader : m.evenFooter;
  }
  return slot === 'header' ? m.header : m.footer;
}

/**
 * Write a band back into the master. `slot` names which variant the page the
 * user is editing actually shows, so typing on page 1 of a "different first
 * page" master updates the first-page band, not the default one.
 */
export function withBand(
  m: MasterPage,
  slot: BandKey,
  patch: Partial<MasterBand>,
): MasterPage {
  const current = m[slot];
  const next: MasterBand = {
    text: patch.text !== undefined ? patch.text : current.text,
    align: patch.align !== undefined ? patch.align : current.align,
  };
  return { ...m, [slot]: next };
}

/** Every band slot a master holds. */
export type BandKey =
  | 'header'
  | 'footer'
  | 'firstHeader'
  | 'firstFooter'
  | 'evenHeader'
  | 'evenFooter';

/** The slot a given page actually renders/edits for `slot`. */
export function slotForPage(m: MasterPage, slot: BandSlot, pageIndex: number): BandKey {
  if (pageIndex === 0) {
    if (m.differentFirstPage) return slot === 'header' ? 'firstHeader' : 'firstFooter';
    return slot;
  }
  if (m.differentOddEven && pageIndex % 2 === 1) {
    return slot === 'header' ? 'evenHeader' : 'evenFooter';
  }
  return slot;
}

export const BAND_LABELS: Record<BandKey, string> = {
  header: 'Header',
  footer: 'Footer',
  firstHeader: 'First page header',
  firstFooter: 'First page footer',
  evenHeader: 'Even page header',
  evenFooter: 'Even page footer',
};
