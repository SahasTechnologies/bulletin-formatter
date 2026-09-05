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

export interface Template {
  id: string;
  name: string;
  subtitle: string;
  /** A short blurb used for the template's aria-label / tooltip. */
  blurb: string;
  content: string;
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
];

export const BLANK_TEMPLATE = TEMPLATES[0];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
