/**
 * Template manifest. Each template lives as its own `.html` file in this folder
 * so it can be edited independently (drop new HTML in, add an entry below).
 * The files are imported with Vite's `?raw` suffix, which loads them as plain
 * strings.
 *
 * Every template here is a Baulko Bulletin page. The typography follows
 * **Design Bible 2.0**: page titles 48pt Franklin Gothic Heavy (#3f3f3f),
 * body 13pt Roboto Condensed (#262626 - never pure black), bylines Arial 18pt
 * (#808080), artwork credits Aparajita 18pt italic (#999999), pull-quotes
 * Corbel 24pt italic and precursory notes Times New Roman 13pt italic.
 */
import blank from './blank.html?raw';
import bulletinCover from './bulletin-cover.html?raw';
import bulletinEditorial from './bulletin-editorial.html?raw';
import bulletinContents from './bulletin-contents.html?raw';
import bulletinContentsSheet from './bulletin-contents-sheet.html?raw';
import bulletinArticle from './bulletin-article.html?raw';
import bulletinArticleSheet from './bulletin-article-sheet.html?raw';
import bulletinArticleExtras from './bulletin-article-extras.html?raw';
import bulletinPuzzle from './bulletin-puzzle.html?raw';
import bulletinPoem from './bulletin-poem.html?raw';
import bulletinGraphic from './bulletin-graphic.html?raw';
import bulletinEndpage from './bulletin-endpage.html?raw';

/** One extra sheet of a multi-sheet template. */
export interface TemplateSheet {
  html: string;
  /** Frame column count for this sheet. Omit it to let the sheet split into
      separate frames (so each block stays individually draggable). */
  columns?: number;
  /** The sheet body's **standard** text type (a CSS declaration list). A sheet
      made of bare blocks has no frame element to carry `data-text`, so its
      standard lives here. See `Template.frame.text`. */
  text?: string;
}

/** A full-page image frame a template opens with (cover artwork). */
export interface TemplateCover {
  /** Placeholder hint, e.g. "the cover artwork". */
  ph: string;
  radius?: number;
  fade?: number;
}

export interface Template {
  id: string;
  name: string;
  /** A short blurb used for the template's aria-label / tooltip. */
  blurb: string;
  content: string;
  /** Draw a big plus across the Home-screen thumbnail - the "start from
      nothing" affordance the blank page deserves. */
  plus?: boolean;
  /** Default master-page furniture: running head + folio shown on every page.
      Supports the @page / @month / @year tokens. */
  master?: { header: string; footer: string };
  /** Frame model for the template. When `frame.columns` is set, the template's
      whole HTML opens as a single full-content-area text box set to that many
      columns (so the Columns toolbar reports the right number and a gray
      `column-rule` is drawn between the columns). The Home-screen thumbnail
      honours the same column count so the preview matches the opened document. */
  frame?: {
    columns: number;
    /** The body frame's **standard** text type, e.g. `font-size:13pt;line-height:1.45`.
        Plain text in the frame falls back to it, and a wholesale retype (select
        all, then type or paste) adopts it - without it the replacement wears
        the first block's borrowed type, so retyping a list whose entries are
        18pt used to flood the frame and turn its chrome red. */
    text?: string;
  };
  /** Laid out with `data-frame="x,y,w,h"` attributes: every top-level element
      of `content` opens as its own object (text box, columned text box, image,
      orange shape or movable line) at exactly that place on the page. A frame
      may also carry `data-text` (its standard type, what plain text and a
      wholesale retype fall back to) and `data-align` (the alignment that
      governs text with none of its own). Used by the pages that need several
      independently movable frames - the contents divider, the editorial
      masthead icon and the whole thank-you page. */
  layout?: boolean;
  /** Extra sheets that open after `content` - a full-length article ships its
      continuation pages and a final extras sheet this way. */
  sheets?: TemplateSheet[];
  /** Open the page as one full-bleed *image* frame instead of a text frame.
      The title page is a piece of cover artwork, so it opens as a picture the
      user drops the art into - never as a page of type. */
  cover?: TemplateCover;
  /** A finished piece ends with a tombstone (the small black marker in the
      last page's corner). Templates that hold a whole piece turn it on. */
  tombstone?: boolean;
}

/** The running head + folio every bulletin page carries (Design Bible §Set up:
    "Baulko Bulletin | n+#" in Biome 18, folio "page | Month Year"). */
const ISSUE_MASTER = {
  header: 'Baulko Bulletin | n+●●',
  footer: '@page |  @month @year',
};

/** The second contents page - the list runs on from entries 15 upwards, so
    nothing has to be squeezed to fit one sheet. */
/** Contents pages run to 18pt entries so the list reads from the back of the
    room; the frame's standard is the house body, so retyping the list (the
    normal way to fill the page in) comes back as body type that still fits. */
const CONTENTS_TEXT = 'font-size:13pt;line-height:1.45';
const CONTENTS_SHEETS: TemplateSheet[] = [
  { html: bulletinContentsSheet, columns: 2, text: CONTENTS_TEXT },
];

/** House body type: what a continuation sheet writes in, and what its frame
    standard declares, so retyping a sheet keeps the article's own measure. */
const ARTICLE_TEXT = 'font-size:13pt;line-height:1.45';

/** The four plain lorem-ipsum continuation sheets a full article opens with. */
const ARTICLE_SHEETS: TemplateSheet[] = [
  { html: bulletinArticleSheet, columns: 2, text: ARTICLE_TEXT },
  { html: bulletinArticleSheet, columns: 2, text: ARTICLE_TEXT },
  { html: bulletinArticleSheet, columns: 2, text: ARTICLE_TEXT },
  { html: bulletinArticleSheet, columns: 2, text: ARTICLE_TEXT },
  // Sixth sheet: spare pull-quotes and credit lines, left as separate frames
  // so they can be dragged into an article - or the whole page deleted.
  { html: bulletinArticleExtras },
];

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank page',
    blurb: 'An empty bulletin page with the issue running head and folio',
    content: blank,
    master: ISSUE_MASTER,
    plus: true,
  },
  // One template per page of the Design Bible, in the order an issue runs:
  // cover → editorial → contents → articles → … → end page.
  {
    id: 'bulletin-cover',
    name: 'Title page',
    blurb: 'Title page - the cover artwork filling the whole sheet',
    content: bulletinCover,
    master: ISSUE_MASTER,
    cover: { ph: 'the cover artwork' },
  },
  {
    id: 'bulletin-editorial',
    name: 'Editorial',
    blurb: 'The editor’s welcome letter page, in the official editorial style',
    content: bulletinEditorial,
    master: ISSUE_MASTER,
    layout: true,
    tombstone: true,
  },
  {
    id: 'bulletin-contents',
    name: 'Page of contents',
    blurb:
      'Two contents pages - a two-column list filled to the bottom margin and a second sheet to continue it',
    content: bulletinContents,
    master: ISSUE_MASTER,
    layout: true,
    sheets: CONTENTS_SHEETS,
  },
  {
    id: 'bulletin-article',
    name: 'Article',
    blurb:
      'Full article - two-column start page, four lorem continuation sheets and an extras sheet',
    content: bulletinArticle,
    master: ISSUE_MASTER,
    frame: { columns: 2, text: ARTICLE_TEXT },
    sheets: ARTICLE_SHEETS,
    tombstone: true,
  },
  {
    id: 'bulletin-puzzle',
    name: 'Puzzle',
    blurb:
      'A full-page puzzle frame - drop the grid in as an image, or import the puzzle as a PDF page',
    content: bulletinPuzzle,
    master: ISSUE_MASTER,
    // A puzzle fills the sheet edge to edge: the frame opens full-page (0, 0,
    // 794 × 1123) and a picture dropped in is cropped to that A4 frame instead
    // of shrinking to fit inside the margins.
    cover: { ph: 'the puzzle' },
  },
  {
    id: 'bulletin-poem',
    name: 'Poem',
    blurb: 'Single-column poem page in the bulletin’s own type, ending in the end-of-piece marker',
    content: bulletinPoem,
    master: ISSUE_MASTER,
    // The title, the byline, the rule, the poem and the end-of-piece marker are
    // five separate objects on the sheet, so the rule can be moved on its own
    // and the poem can be re-flowed without disturbing the credit line. The
    // marker itself is pinned (bottom-right, outside the master frame) - it can
    // be removed, never dragged.
    layout: true,
  },
  {
    id: 'bulletin-graphic',
    name: 'Graphic',
    blurb: 'Artwork page with title, byline and a click-to-add art frame - no subtitle',
    content: bulletinGraphic,
    master: ISSUE_MASTER,
    tombstone: true,
  },
  {
    id: 'bulletin-endpage',
    name: 'End page',
    blurb: 'Thank-you message on top, with the classroom cards and the full credits pinned to the bottom',
    content: bulletinEndpage,
    master: ISSUE_MASTER,
    layout: true,
    tombstone: true,
  },
];

export const BLANK_TEMPLATE = TEMPLATES[0];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
