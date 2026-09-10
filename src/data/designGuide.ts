/**
 * Design Bible 2.0, as data.
 *
 * Every page the guide documents gets an entry here with its typographic
 * rules, so the `/guide` route can show the spec, jump straight to editing
 * that page, and the Merge tool can put an issue together in the right order
 * (cover at the front, end page at the bottom).
 *
 * Source: "Design bible 2.0" (Eric Huang, head of formatting 2021).
 */

/** Where the page belongs in a finished issue. */
export type GuidePosition = 'front' | 'body' | 'end';

export interface GuideRule {
  /** What the rule styles — "Title", "Body", "Credit"… */
  role: string;
  font: string;
  size: string;
  colour?: string;
  note?: string;
}

export interface GuidePage {
  id: string;
  /** Page name as the guide calls it. */
  name: string;
  /** The guide's section heading. */
  section: string;
  summary: string;
  rules: GuideRule[];
  /** Template to open (or append) when this page is picked. */
  templateId?: string;
  /** Column count the guide asks for on this page. */
  columns?: number;
  position: GuidePosition;
}

/** House rules that apply to every page, from "General rules of thumb". */
export const GUIDE_GENERAL_RULES: string[] = [
  'Body text is Roboto Condensed at 13pt unless stated otherwise.',
  'Never write in pure black — use a very dark grey (the Bulletin is printed in black and white).',
  'Page titles are Franklin Gothic Heavy; drop the size a little if a long title will not fit one line.',
  'Font sizes other than 13pt body are a rule of thumb — go with what reads best, as long as a heading is obviously a heading.',
  'Two columns with a rule between them, spaced 0.449cm apart. Poems and column-sensitive pieces stay at one column.',
  'Finish every piece with a tombstone: right-aligned for articles, centred beneath the last line for poems.',
];

export const GUIDE_PAGES: GuidePage[] = [
  {
    id: 'set-up',
    name: 'Set up',
    section: 'Set up',
    summary:
      'The running head and folio live on the master page: "Baulko Bulletin | n+#" top-right, and the page number with the month and year in the footers.',
    rules: [
      { role: 'Running head', font: 'Biome', size: '18pt', note: 'Top-right header, e.g. “Baulko Bulletin | n+33”' },
      { role: 'Footer (left)', font: 'Biome', size: '18pt', note: 'Page number, then “| Month Year”' },
      { role: 'Footer (right)', font: 'Biome', size: '18pt', note: 'Mirrored: “Month Year | page number”, right-aligned' },
    ],
    position: 'front',
  },
  {
    id: 'title-page',
    name: 'Title page',
    section: 'Title Page, Editorial and Contents',
    summary:
      'The cover art usually fills the whole first page — drag the corners until it fits and try not to distort it. Credits go on the end page, not here.',
    rules: [
      { role: 'Issue title', font: 'Biome', size: '60pt', colour: '#262626' },
      { role: 'Tagline', font: 'Biome', size: '18pt', colour: '#808080', note: 'Italic' },
      { role: 'Cover credit', font: 'Arial', size: '12pt', note: 'Under the artwork' },
    ],
    templateId: 'bulletin-cover',
    position: 'front',
  },
  {
    id: 'editorial',
    name: 'Editorial',
    section: 'Title Page, Editorial and Contents',
    summary:
      'A message from the editor-in-chief about the issue and everyone who made it. It usually takes the whole page.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f', note: '“Editorial”, centred' },
      { role: 'Rule', font: '—', size: '1px', colour: '#d9d3c9', note: 'Horizontal line directly beneath the title' },
      { role: 'Body', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Justified' },
      { role: 'Sign-off', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Name, then “(Editor-in-Chief)”' },
    ],
    templateId: 'bulletin-editorial',
    position: 'front',
  },
  {
    id: 'contents',
    name: 'Page of contents',
    section: 'Title Page, Editorial and Contents',
    summary:
      'Leave the contents page to the very end, once you know which page every article landed on.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f', note: '“Page of Contents”, spans both columns' },
      { role: 'Entry number & kind', font: 'Franklin Gothic Heavy', size: '18pt', colour: '#3f3f3f', note: 'e.g. “1 — Article”' },
      { role: 'Entry title', font: 'Franklin Gothic Medium', size: '18pt', colour: '#262626' },
    ],
    templateId: 'bulletin-contents',
    columns: 2,
    position: 'front',
  },
  {
    id: 'article',
    name: 'Article',
    section: 'Articles',
    summary:
      'Title, byline, artwork with its credit, then the body in two linked columns with a drop cap, a rule down the middle and a tombstone at the end.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f', note: 'Reduce a little if it will not fit one line' },
      { role: 'Byline', font: 'Arial', size: '18pt', colour: '#808080', note: 'Directly beneath the title' },
      { role: 'Precursory note', font: 'Times New Roman', size: '13pt', note: 'Italic — trigger or language warnings go here' },
      { role: 'Artwork credit', font: 'Aparajita', size: '18pt', colour: '#999999', note: 'Italic, under the graphic' },
      { role: 'Body', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Two columns, drop cap on the first letter' },
      { role: 'Pull-quote', font: 'Corbel', size: '24pt', colour: '#3f3f3f', note: 'Italic, with speech marks' },
      { role: 'Column rule', font: '—', size: '1px', colour: '#d9d3c9', note: 'Straight down the middle of the gutter' },
    ],
    templateId: 'bulletin-article',
    columns: 2,
    position: 'body',
  },
  {
    id: 'continuation',
    name: 'Article continuation',
    section: 'Articles',
    summary:
      'When a text box overflows, link it to another empty text box and the story carries on. A long article may need this two or three times.',
    rules: [
      { role: 'Running title', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: '“(continued)” — no second headline' },
      { role: 'Body', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Same paragraph style as page one' },
    ],
    templateId: 'bulletin-continuation',
    columns: 2,
    position: 'body',
  },
  {
    id: 'poem',
    name: 'Poem',
    section: 'Articles',
    summary:
      'One column only — columns matter in a poem, so the shape the writer chose has to survive.',
    rules: [
      { role: 'Title', font: 'Euphoria Script', size: '44pt', colour: '#3f3f3f' },
      { role: 'Byline', font: 'Arial', size: '18pt', colour: '#808080' },
      { role: 'Body', font: 'Nothing You Could Do', size: '13pt', colour: '#262626', note: 'One column, line breaks kept' },
      { role: 'Tombstone', font: '—', size: '—', note: 'Centred directly beneath the last line' },
    ],
    templateId: 'bulletin-poem',
    columns: 1,
    position: 'body',
  },
  {
    id: 'graphic',
    name: 'Graphic',
    section: 'Articles',
    summary:
      'A page of artwork. Graphics usually sit directly beneath the piece they belong to, but a standalone art page is fine too — just credit the artist.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f' },
      { role: 'Subtitle', font: 'Franklin Gothic Heavy', size: '28pt', colour: '#3f3f3f' },
      { role: 'Byline', font: 'Arial', size: '18pt', colour: '#808080' },
      { role: 'Credit', font: 'Aparajita', size: '18pt', colour: '#999999', note: 'Italic' },
    ],
    templateId: 'bulletin-graphic',
    position: 'body',
  },
  {
    id: 'puzzle',
    name: 'Puzzle',
    section: 'Puzzles',
    summary:
      'Title, maker, instructions and the grid. Say where the answers go, or hint at the next puzzle.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f' },
      { role: 'Byline', font: 'Arial', size: '18pt', colour: '#808080' },
      { role: 'Instructions', font: 'Franklin Gothic Medium', size: '13.5pt', colour: '#262626' },
    ],
    templateId: 'bulletin-puzzle',
    position: 'body',
  },
  {
    id: 'end-page',
    name: 'End page',
    section: 'Credits',
    summary:
      'The thank-you page: where the cover art is credited, the classroom and website cards go, and the whole team gets listed.',
    rules: [
      { role: 'Thank-you', font: 'Dreaming Outloud Script', size: '44pt', colour: '#3f3f3f' },
      { role: 'Body', font: 'Roboto Condensed', size: '13pt', colour: '#262626' },
      { role: 'Credits', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Two columns, leaders and formatters' },
    ],
    templateId: 'bulletin-endpage',
    position: 'end',
  },
];

/** Guide pages that carry a template — what the picker and Merge can act on. */
export const EDITABLE_GUIDE_PAGES = GUIDE_PAGES.filter((p) => p.templateId);

export function getGuidePage(id: string): GuidePage | undefined {
  return GUIDE_PAGES.find((p) => p.id === id);
}

/** Classify a document/template as an issue part, for ordering a merge. */
export function guidePositionOf(templateId?: string, title = ''): GuidePosition {
  const page = templateId ? GUIDE_PAGES.find((p) => p.templateId === templateId) : undefined;
  if (page) return page.position;
  const t = title.toLowerCase();
  if (t.includes('cover') || t.includes('title page')) return 'front';
  if (t.includes('end page') || t.includes('credit') || t.includes('thank')) return 'end';
  return 'body';
}
