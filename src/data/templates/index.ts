/**
 * Template manifest. Each template lives as its own `.html` file in this folder
 * so it can be edited independently (drop new HTML in, add an entry below).
 * The files are imported with Vite's `?raw` suffix, which loads them as plain
 * strings.
 *
 * Every template here is a Baulko Bulletin page. The typography follows
 * **Design Bible 2.0**: page titles 48pt Franklin Gothic Heavy (#3f3f3f),
 * body 13pt Roboto Condensed (#262626 — never pure black), bylines Arial 18pt
 * (#808080), artwork credits Aparajita 18pt italic (#999999), pull-quotes
 * Corbel 24pt italic and precursory notes Times New Roman 13pt italic.
 */
import blank from './blank.html?raw';
import bulletinCover from './bulletin-cover.html?raw';
import bulletinEditorial from './bulletin-editorial.html?raw';
import bulletinContents from './bulletin-contents.html?raw';
import bulletinArticle from './bulletin-article.html?raw';
import bulletinContinuation from './bulletin-continuation.html?raw';
import bulletinPuzzle from './bulletin-puzzle.html?raw';
import bulletinPoem from './bulletin-poem.html?raw';
import bulletinGraphic from './bulletin-graphic.html?raw';
import bulletinEndpage from './bulletin-endpage.html?raw';

export interface Template {
  id: string;
  name: string;
  subtitle: string;
  /** A short blurb used for the template's aria-label / tooltip. */
  blurb: string;
  content: string;
  /** Default master-page furniture: running head + folio shown on every page.
      Supports the @page / @month / @year tokens. */
  master?: { header: string; footer: string };
  /** Frame model for the template. When `frame.columns` > 1, the template
      opens as a single text box set to that many columns (so the Columns
      toolbar reports the right number and a real `column-rule` is drawn
      between the columns). The Home-screen thumbnail honours the same
      column count so the preview matches the opened document. */
  frame?: { columns: number };
}

/** The running head + folio every bulletin page carries (Design Bible §Set up:
    "Baulko Bulletin | n+#" in Biome 18, folio "page | Month Year"). */
const ISSUE_MASTER = {
  header: 'Baulko Bulletin | n+●●',
  footer: '@page |  @month @year',
};

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank page',
    subtitle: 'Bulletin',
    blurb: 'An empty bulletin page with the issue running head and folio',
    content: blank,
    master: ISSUE_MASTER,
  },
  // One template per page of the Design Bible, in the order an issue runs:
  // cover → editorial → contents → articles → … → end page.
  {
    id: 'bulletin-cover',
    name: 'Bulletin',
    subtitle: 'Title page',
    blurb: 'Cover with the official running head and a click-to-add artwork frame',
    content: bulletinCover,
    master: ISSUE_MASTER,
  },
  {
    id: 'bulletin-editorial',
    name: 'Bulletin',
    subtitle: 'Editorial',
    blurb: 'The editor’s welcome letter page, in the official editorial style',
    content: bulletinEditorial,
    master: ISSUE_MASTER,
  },
  {
    id: 'bulletin-contents',
    name: 'Bulletin',
    subtitle: 'Page of contents',
    blurb: 'The issue’s two-column contents list in official style',
    content: bulletinContents,
    master: ISSUE_MASTER,
    frame: { columns: 2 },
  },
  {
    id: 'bulletin-article',
    name: 'Bulletin',
    subtitle: 'Article',
    blurb: 'Two-column feature article: 48pt headline, byline, drop cap, pull-quote',
    content: bulletinArticle,
    master: ISSUE_MASTER,
    frame: { columns: 2 },
  },
  {
    id: 'bulletin-continuation',
    name: 'Bulletin',
    subtitle: 'Article continuation',
    blurb: 'The overflow page a long article runs onto — no headline, just the text',
    content: bulletinContinuation,
    master: ISSUE_MASTER,
    frame: { columns: 2 },
  },
  {
    id: 'bulletin-puzzle',
    name: 'Bulletin',
    subtitle: 'Puzzle',
    blurb: 'Puzzle page with title, byline, instructions and a grid art frame',
    content: bulletinPuzzle,
    master: ISSUE_MASTER,
  },
  {
    id: 'bulletin-poem',
    name: 'Bulletin',
    subtitle: 'Poem',
    blurb: 'Single-column poem page — columns matter, so the shape is kept',
    content: bulletinPoem,
    master: ISSUE_MASTER,
    frame: { columns: 1 },
  },
  {
    id: 'bulletin-graphic',
    name: 'Bulletin',
    subtitle: 'Graphic',
    blurb: 'Artwork page with title, byline and a click-to-add art frame',
    content: bulletinGraphic,
    master: ISSUE_MASTER,
  },
  {
    id: 'bulletin-endpage',
    name: 'Bulletin',
    subtitle: 'End page',
    blurb: 'Thank-you message, classroom/website cards and the full credits',
    content: bulletinEndpage,
    master: ISSUE_MASTER,
  },
];

export const BLANK_TEMPLATE = TEMPLATES[0];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
