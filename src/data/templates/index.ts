/**
 * Template manifest. Each template lives as its own `.html` file in this folder
 * so it can be edited independently (drop new HTML in, add an entry below).
 * The files are imported with Vite's `?raw` suffix, which loads them as plain
 * strings.
 */
import blank from './blank.html?raw';
import projectProposal from './project-proposal.html?raw';
import essay from './essay.html?raw';
import reportSimple from './report-simple.html?raw';
import reportLuxe from './report-luxe.html?raw';
import reportMla from './report-mla.html?raw';
import bookReport from './book-report.html?raw';
import bulletinCover from './bulletin-cover.html?raw';
import bulletinEditorial from './bulletin-editorial.html?raw';
import bulletinContents from './bulletin-contents.html?raw';
import bulletinArticle from './bulletin-article.html?raw';
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
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank document',
    subtitle: 'Blank',
    blurb: 'Start from a clean page',
    content: blank,
  },
  {
    id: 'project-proposal',
    name: 'Project proposal',
    subtitle: 'Tropic',
    blurb: 'A structured proposal with a title block and sections',
    content: projectProposal,
  },
  {
    id: 'essay',
    name: 'Essay',
    subtitle: 'Paperback',
    blurb: 'A classic five-paragraph essay skeleton',
    content: essay,
  },
  {
    id: 'report-simple',
    name: 'Report',
    subtitle: 'Simple',
    blurb: 'A clean science-lab-style report',
    content: reportSimple,
  },
  {
    id: 'report-luxe',
    name: 'Report',
    subtitle: 'Luxe',
    blurb: 'A bold cover-page style report',
    content: reportLuxe,
  },
  {
    id: 'report-mla',
    name: 'Report',
    subtitle: 'MLA',
    blurb: 'A title page with formal MLA formatting',
    content: reportMla,
  },
  {
    id: 'book-report',
    name: 'Book report',
    subtitle: 'by Reading Rainbow',
    blurb: 'A title page ready for a favourite book',
    content: bookReport,
  },
  // Official bulletin page types, recreated from the published Baulko Bulletin
  // issues (WIPD × Spectrums 2026; n+32, June 2026) — the same fonts, sizes,
  // colours and layout, but with placeholder copy you can edit and empty
  // click-to-add image frames instead of embedded artwork.
  {
    id: 'bulletin-cover',
    name: 'Bulletin',
    subtitle: 'Issue cover',
    blurb: 'Cover with the official running head and a click-to-add artwork frame',
    content: bulletinCover,
    master: { header: "Baulko Bulletin – Spectrums | WIPD 2026 |", footer: '@page |  @month @year' },
  },
  {
    id: 'bulletin-editorial',
    name: 'Bulletin',
    subtitle: 'Editorial letter',
    blurb: 'The editor’s welcome letter page, in the official editorial style',
    content: bulletinEditorial,
    master: { header: "Baulko Bulletin – Spectrums | WIPD 2026 |", footer: '@page |  @month @year' },
  },
  {
    id: 'bulletin-contents',
    name: 'Bulletin',
    subtitle: 'Page of contents',
    blurb: 'The issue’s two-column contents list in official style',
    content: bulletinContents,
    master: { header: "Baulko Bulletin – Spectrums | WIPD 2026 |", footer: '@page |  @month @year' },
  },
  {
    id: 'bulletin-article',
    name: 'Bulletin',
    subtitle: 'Feature article',
    blurb: 'Two-column feature article with headline, byline and photo frame',
    content: bulletinArticle,
    master: { header: "Baulko Bulletin – Spectrums | WIPD 2026 |", footer: '@page |  @month @year' },
  },
  {
    id: 'bulletin-puzzle',
    name: 'Bulletin',
    subtitle: 'Puzzle',
    blurb: 'Puzzle page with title, byline, instructions and a grid art frame',
    content: bulletinPuzzle,
    master: { header: "Baulko Bulletin – Spectrums | WIPD 2026 |", footer: '@page |  @month @year' },
  },
  {
    id: 'bulletin-poem',
    name: 'Bulletin',
    subtitle: 'Poem',
    blurb: 'Handwritten Indie Flower poem page in official layout',
    content: bulletinPoem,
    master: { header: "Baulko Bulletin – Spectrums | WIPD 2026 |", footer: '@page |  @month @year' },
  },
  {
    id: 'bulletin-graphic',
    name: 'Bulletin',
    subtitle: 'Graphic page',
    blurb: 'Artwork page with title, byline and a click-to-add art frame',
    content: bulletinGraphic,
    master: { header: "Baulko Bulletin – Spectrums | WIPD 2026 |", footer: '@page |  @month @year' },
  },
  {
    id: 'bulletin-endpage',
    name: 'Bulletin',
    subtitle: 'End page',
    blurb: 'Thank-you message, classroom/website cards and the full credits',
    content: bulletinEndpage,
    master: { header: "Baulko Bulletin – Spectrums | WIPD 2026 |", footer: '@page |  @month @year' },
  },
];

export const BLANK_TEMPLATE = TEMPLATES[0];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
