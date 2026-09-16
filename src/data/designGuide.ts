/**
 * Design Bible 2.0, as data.
 *
 * Every page the guide documents gets an entry here with its typographic
 * rules and a numbered walkthrough, so the `/guide` route can show the spec,
 * walk the formatter through the page step by step, jump straight to editing
 * that page, and the Merge tool can put an issue together in the right order
 * (cover at the front, end page at the bottom).
 *
 * Source: "Design bible 2.0" (Eric Huang, head of formatting 2021).
 */

/** Where the page belongs in a finished issue. */
export type GuidePosition = 'front' | 'body' | 'end';

export interface GuideRule {
  /** What the rule styles - "Title", "Body", "Credit"… */
  role: string;
  font: string;
  size: string;
  colour?: string;
  note?: string;
}

/**
 * One numbered step of the walkthrough shown on `/guide`.
 *
 * `preview` is the important one: a mock-up of the element written in the same
 * HTML the page itself uses, rendered at the real frame width - so "what to
 * click" is shown, not just described. Anything that has to be clicked carries
 * a dashed orange outline (`MARK`).
 */
export interface GuideStep {
  /** Imperative one-liner - "Write the headline and byline". */
  title: string;
  /** How to do it, in one or two sentences. */
  body: string;
  /** Mock-up of the element as it looks on the page (see the interface note). */
  preview?: string;
  /** The toolbar / menu path that does the work for this step. */
  click?: string;
}

export interface GuidePage {
  id: string;
  /** Page name as the guide calls it. */
  name: string;
  /** The guide's section heading. */
  section: string;
  summary: string;
  rules: GuideRule[];
  /** The numbered walkthrough: what to do, in order, for this part of the issue. */
  steps: GuideStep[];
  /** Template to open (or append) when this page is picked. */
  templateId?: string;
  /** Column count the guide asks for on this page. */
  columns?: number;
  position: GuidePosition;
}

/* ---- Shared building blocks for the step mock-ups ------------------------ */

/** Dashed orange outline marking the thing this step wants you to click. */
const MARK = 'outline:2px dashed #e8710a;outline-offset:4px;border-radius:3px;';

const FG = "'Franklin Gothic Heavy','Libre Franklin',Arial,sans-serif";
const BYLINE = 'Arial,Helvetica,sans-serif';
const BODY = "'Roboto Condensed',Calibri,'Carlito','Segoe UI',Arial,sans-serif";
const QUOTE = "Corbel,'Segoe UI',Arial,sans-serif";
const CREDIT = "Aparajita,'Segoe UI',serif";

/** A lorem sentence used in the body mock-ups. */
const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

/** House rules that apply to every page, from "General rules of thumb". */
export const GUIDE_GENERAL_RULES: string[] = [
  'Body text is Roboto Condensed at 13pt unless stated otherwise.',
  'Never write in pure black - use a very dark grey (the Bulletin is printed in black and white).',
  'Page titles are Franklin Gothic Heavy; drop the size a little if a long title will not fit one line.',
  'Font sizes other than 13pt body are a rule of thumb - go with what reads best, as long as a heading is obviously a heading.',
  'Two columns with a rule between them, spaced 0.449cm apart. Poems and column-sensitive pieces stay at one column.',
  'Finish every piece with a tombstone: right-aligned for articles, centred beneath the last line for poems.',
];

/**
 * Setting up the master page.
 *
 * This used to be a guide entry of its own ("Set up"), as if it were one more
 * part of the issue to go and edit. It is not: the running head and folio live
 * on the master page of *every* template, so the guide now shows this block on
 * each of its pages instead of hiding it behind a nav entry a formatter has to
 * know to click first.
 */
export const GUIDE_MASTER_SETUP: GuidePage = {
    id: 'master-setup',
    name: 'Master page',
    section: 'Every page, first',
    summary:
      'The running head and folio live on the master page: "Baulko Bulletin | n+#" top-right, and the page number with the month and year in the footers. Set this once and every sheet inherits it.',
    rules: [
      { role: 'Running head', font: 'Biome', size: '18pt', note: 'Top-right header, e.g. “Baulko Bulletin | n+33”' },
      { role: 'Footer (left)', font: 'Biome', size: '18pt', note: 'Page number, then “| Month Year”' },
      { role: 'Footer (right)', font: 'Biome', size: '18pt', note: 'Mirrored: “Month Year | page number”, right-aligned' },
    ],
    position: 'front',
    steps: [
      {
        title: 'Turn the master page on',
        body: 'The running head and folio are never typed on each sheet - they live on the master page, so one edit changes every page of the issue.',
        click: 'View ▸ Master page…',
        preview: `<div style="position:relative;height:150px;border:1px solid #e5ddd0;background:#fff;font-family:Biome,'Red Hat Text',Arial,sans-serif;font-size:15px;color:#262626;">
  <span style="${MARK}position:absolute;right:10px;top:8px;padding:2px 6px;">Baulko Bulletin | n+33</span>
  <span style="${MARK}position:absolute;left:10px;bottom:8px;padding:2px 6px;">1 | September 2026</span>
</div>`,
      },
      {
        title: 'Type the running head',
        body: 'Click the header band and type “Baulko Bulletin | n+33”. The issue number is fixed for the whole issue, so it looks the same on every page.',
        click: 'Click the header band on the sheet, then type',
        preview: `<p style="margin:0;text-align:right;font-family:Biome,'Red Hat Text',Arial,sans-serif;font-size:18pt;color:#262626;${MARK}">Baulko Bulletin | n+33</p>`,
      },
      {
        title: 'Drop the page number and date into the footers',
        body: 'Use the master ribbon to insert the page, month and year fields rather than typing them - they count themselves up on every sheet.',
        click: 'Master ribbon ▸ Page number / Month / Year',
        preview: `<table style="width:100%;border-collapse:collapse;font-family:Biome,'Red Hat Text',Arial,sans-serif;font-size:18pt;color:#262626;">
  <tr>
    <td style="${MARK}padding:4px 6px;">1 | September 2026</td>
    <td style="${MARK}padding:4px 6px;text-align:right;">September 2026 | 2</td>
  </tr>
</table>`,
      },
    ],
};

export const GUIDE_PAGES: GuidePage[] = [
  {
    id: 'title-page',
    name: 'Title page',
    section: 'Title Page, Editorial and Contents',
    summary:
      'The title page is one piece of cover artwork and nothing else - a picture edge to edge across the whole sheet. No title text, no byline, no date: the title artwork carries the page, and the credits go on the end page.',
    rules: [
      { role: 'Cover artwork', font: '-', size: 'Full page', note: 'One image, edge to edge (full bleed)' },
    ],
    templateId: 'bulletin-cover',
    position: 'front',
    steps: [
      {
        title: 'Drop the cover artwork in',
        body: 'The page opens as one empty full-page picture frame. Click it and choose the finished cover image - it lands at the exact size of the sheet.',
        click: 'Insert ▸ Image…',
        preview: `<div style="height:170px;display:grid;place-items:center;background:#faf8f5;border:1px dashed #c9c1b5;color:#8a8378;font-family:${BODY};font-size:13pt;${MARK}">
  Add the cover artwork
</div>`,
      },
      {
        title: 'Let it fill the whole sheet',
        body: 'The frame is already full-bleed - it opens at 0, 0 across the entire page, not inside the text margins. Nudge or resize it with the corner handles if the artwork needs it, and leave the master\'s running head and folio alone.',
        click: 'Drag a corner handle to resize',
        preview: `<div style="height:170px;position:relative;background:#efe9e1;border:1px solid #e5ddd0;">
  <div style="position:absolute;inset:0;display:grid;place-items:center;color:#8a8378;font-family:${BODY};font-size:12pt;${MARK}">Cover artwork - edge to edge</div>
</div>`,
      },
    ],
  },
  {
    id: 'editorial',
    name: 'Editorial',
    section: 'Title Page, Editorial and Contents',
    summary:
      'A message from the editor-in-chief about the issue and everyone who made it. The news icon sits centred under the title and every paragraph lives in one text box, so the whole letter flows as a single story.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f', note: '“Editorial”, centred' },
      { role: 'Icon', font: '-', size: '22px', note: 'News icon, centred between the title rules' },
      { role: 'Body', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Justified, one text box for all paragraphs' },
      { role: 'Sign-off', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Name, then “(Editor-in-Chief)”' },
      { role: 'Tombstone', font: '-', size: '12px', note: 'Black square in the last page\'s corner - on by default' },
    ],
    templateId: 'bulletin-editorial',
    position: 'front',
    steps: [
      {
        title: 'Write the title and keep the news icon',
        body: 'The title “Editorial” stays centred, with the news icon on its own between the two rules. Do not move the icon to the side or add a byline above it.',
        click: 'Click the icon to select it if you need to nudge it',
        preview: `<p style="margin:0;padding:6px 0;text-align:center;font-family:${FG};font-size:48pt;line-height:1.05;color:#3f3f3f;">Editorial</p>
<table style="width:100%;border-collapse:collapse;margin:0 0 10px;">
  <tr>
    <td style="border-top:1px solid #d9d3c9;width:40%;">&nbsp;</td>
    <td style="width:20%;text-align:center;${MARK}"><span style="display:inline-block;width:22px;height:22px;border:2px solid #3f3f3f;border-radius:3px;"></span></td>
    <td style="border-top:1px solid #d9d3c9;width:40%;">&nbsp;</td>
  </tr>
</table>`,
      },
      {
        title: 'Write the whole letter in one text box',
        body: 'Every paragraph stays in the same box - that is what lets the text flow and the spacing stay even. Press Enter for a new paragraph; never drag in a second box for the middle of the letter.',
        click: 'Insert ▸ Text box (only if you need a brand-new box)',
        preview: `<div style="${MARK}padding:6px 4px;">
  <p style="margin:0;text-align:justify;font-family:${BODY};font-size:13pt;line-height:1.5;color:#262626;">Hark, gentle readers, to the newest edition of Baulko Bulletin! Write a short welcome here - a couple of sentences about the theme of this issue and what made it fun to put together.</p>
  <p style="margin:8px 0 0;text-align:justify;font-family:${BODY};font-size:13pt;line-height:1.5;color:#262626;">Then take a paragraph to walk readers through what is inside: the articles, puzzles, poems and artwork they are about to turn the page to find.</p>
</div>`,
      },
      {
        title: 'Sign off with your name and title',
        body: 'End the letter with your name on one line and “(Editor-in-Chief)” beneath it - left-aligned, same 13pt body text, no bold.',
        preview: `<p style="margin:0;text-align:left;font-family:${BODY};font-size:13pt;line-height:1.4;color:#262626;">[Your name]<br />(Editor-in-Chief)</p>`,
      },
      {
        title: 'Close the piece with its tombstone',
        body: 'The editorial already opens with the end-of-document marker switched on, so the black square closes the piece. Check it in Tools ▸ Preferences ▸ End-of-document marker if it has been turned off.',
        click: 'Tools ▸ Preferences ▸ End-of-document marker',
        preview: `<div style="position:relative;height:90px;border:1px solid #e5ddd0;background:#fff;padding:8px;font-family:${BODY};font-size:12pt;color:#262626;">
  …and that is the issue.<br />[Your name] (Editor-in-Chief)
  <span style="${MARK}position:absolute;right:12px;bottom:8px;display:inline-block;width:12px;height:12px;border-radius:3.5px;background:#1f1f1f;"></span>
</div>`,
      },
    ],
  },
  {
    id: 'contents',
    name: 'Page of contents',
    section: 'Title Page, Editorial and Contents',
    summary:
      'Two pages, two columns each, with the gray rule down the middle. The list runs from the title straight to the bottom margin on page 1 and carries on across the second contents page - leave it to the very end, once you know which page every article landed on.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f', note: '“Page of Contents”, spans both columns' },
      { role: 'Entry number & kind', font: 'Franklin Gothic Heavy', size: '18pt', colour: '#3f3f3f', note: 'e.g. “1 - Article”' },
      { role: 'Entry title', font: 'Franklin Gothic Medium', size: '18pt', colour: '#262626' },
    ],
    templateId: 'bulletin-contents',
    columns: 2,
    position: 'front',
    steps: [
      {
        title: 'Leave the contents until the very end',
        body: 'The page numbers are the last thing you know. Finish every article, puzzle and poem first, then come back and fill this page in.',
        click: 'Format ▸ Columns ▸ Two columns',
        preview: `<div style="column-count:2;column-gap:28px;column-rule:1px solid #d8d2ca;padding:4px 0;">
  <p style="margin:0;padding:10px 0;text-align:center;font-family:${FG};font-size:18pt;line-height:1.25;color:#3f3f3f;break-inside:avoid;"><b>5 - Puzzle</b><br /><span style="font-family:'Franklin Gothic Medium','Libre Franklin',Arial,sans-serif;color:#262626;">Monster Hunter</span></p>
  <p style="margin:0;padding:10px 0;text-align:center;font-family:${FG};font-size:18pt;line-height:1.25;color:#3f3f3f;break-inside:avoid;"><b>7 - Article</b><br /><span style="font-family:'Franklin Gothic Medium','Libre Franklin',Arial,sans-serif;color:#262626;">The Monster in the Shadow</span></p>
</div>`,
      },
      {
        title: 'Type each entry as “number - kind”, then the title',
        body: 'The number and the kind of piece go on the first line in Franklin Gothic Heavy; the title follows on the next line in Franklin Gothic Medium. Keep every entry centred and never break one across the two columns.',
        preview: `<p style="margin:0;padding:16px 0;text-align:center;font-family:${FG};font-size:18pt;line-height:1.25;color:#3f3f3f;break-inside:avoid;${MARK}"><b>14 - Puzzle</b><br /><span style="font-family:'Franklin Gothic Medium','Libre Franklin',Arial,sans-serif;color:#262626;">Horror</span></p>`,
      },
      {
        title: 'Run the list to the bottom margin, then on to the second page',
        body: 'The entries fill the left column, then the right column, then continue on the second contents sheet - the template ships both pages, so you only add or delete entries. Delete the second sheet if the issue is short enough to fit one page.',
        click: 'Page thumbnails ▸ delete a page',
        preview: `<div style="display:flex;gap:10px;">
  <div style="flex:1;height:120px;border:1px solid #e5ddd0;background:#fff;padding:6px;font-size:10px;color:#3f3f3f;font-family:${FG};${MARK}">Page of Contents<br /><span style="font-family:${BODY};color:#808080;">entries 1–14</span></div>
  <div style="flex:1;height:120px;border:1px solid #e5ddd0;background:#fff;padding:6px;font-size:10px;color:#3f3f3f;font-family:${FG};${MARK}">Page of Contents (cont.)<br /><span style="font-family:${BODY};color:#808080;">entries 15–…</span></div>
</div>`,
      },
    ],
  },
  {
    id: 'article',
    name: 'Article',
    section: 'Articles',
    summary:
      'The full article opens as six sheets: the start page, four two-column continuation sheets, then a spare extras sheet. Title, byline, a gray rule across the page and the body in two columns with a drop cap; the extra sheet holds pull-quotes and Aparajita credits to drag in - or delete it.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f', note: 'Reduce a little if it will not fit one line' },
      { role: 'Byline', font: 'Arial', size: '18pt', colour: '#808080', note: 'Directly beneath the title' },
      { role: 'Precursory note', font: 'Times New Roman', size: '13pt', note: 'Italic - trigger or language warnings go here' },
      { role: 'Separating rule', font: '-', size: '1px', colour: '#d9d3c9', note: 'Gray line between the author and the start of the article' },
      { role: 'Body', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Two columns, drop cap on the first letter' },
      { role: 'Continuation sheet', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Two columns of body copy, no headline' },
      { role: 'Pull-quote', font: 'Corbel', size: '24pt', colour: '#3f3f3f', note: 'Italic, with speech marks' },
      { role: 'Artwork credit', font: 'Aparajita', size: '18pt', colour: '#999999', note: 'Italic - on the extras sheet' },
      { role: 'Column rule', font: '-', size: '1px', colour: '#d9d3c9', note: 'Gray line straight down the middle of every two-column frame' },
      { role: 'Tombstone', font: '-', size: '12px', note: 'Black square in the last sheet\'s corner - on by default' },
    ],
    templateId: 'bulletin-article',
    columns: 2,
    position: 'body',
    steps: [
      {
        title: 'Write the title and the byline',
        body: 'Set the headline in Franklin Gothic Heavy, centred, then put the writer underneath it in Arial 18pt grey. A trigger or language warning, if the piece needs one, goes on the line below the byline in Times New Roman italics.',
        click: 'Toolbar ▸ style / font / size',
        preview: `<p style="margin:0;padding:4px 0;text-align:center;font-family:${FG};font-size:48pt;line-height:1.05;color:#3f3f3f;${MARK}">[Article Headline]</p>
<p style="margin:0;text-align:center;font-family:${BYLINE};font-size:18pt;line-height:1.3;color:#808080;${MARK}">By [Writer’s name]</p>
<hr style="margin:12px 0 0;border:0;border-top:1px solid #d9d3c9;" />`,
      },
      {
        title: 'Paste the article into the two-column body',
        body: 'The gray rule separates the author from the first line of the piece. Paste the copy below it and let it flow through both columns - the rule down the middle of the frame appears on its own. Keep the drop cap on the first letter.',
        click: 'Format ▸ Columns ▸ Two columns',
        preview: `<div style="column-count:2;column-gap:28px;column-rule:1px solid #d8d2ca;${MARK}padding:6px 0;">
  <p style="margin:0;text-align:justify;font-family:${BODY};font-size:13pt;line-height:1.45;color:#262626;"><span style="float:left;font-family:${FG};font-size:44pt;line-height:0.82;padding:4px 6px 0 0;">L</span>orem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p>
  <p style="margin:10px 0 0;text-align:justify;font-family:${BODY};font-size:13pt;line-height:1.45;color:#262626;">Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis.</p>
</div>`,
      },
      {
        title: 'Add the artwork and credit it',
        body: 'Insert the pictures you were sent, then drag the matching credit line out of the extras sheet. Pull-quotes also live on that last sheet - Corbel 24pt italics with speech marks - and are made to break up a long column.',
        click: 'Insert ▸ Image…',
        preview: `<p style="margin:0;padding:14px 18px;text-align:center;font-family:${QUOTE};font-size:24pt;font-style:italic;line-height:1.3;color:#3f3f3f;">“A pull-quote you can drop into any article.”</p>
<p style="margin:0;padding:8px 0;text-align:center;font-family:${CREDIT};font-size:18pt;font-style:italic;line-height:1.3;color:#999;${MARK}">Image Credit to [Source]</p>`,
      },
      {
        title: 'Delete the pages you do not need',
        body: 'The article opens with five continuation sheets plus the extras page. If your copy is shorter, delete the spare sheets from the page thumbnails; if it is longer, duplicate one instead. Never leave an empty sheet in the issue.',
        click: 'Page thumbnails ▸ Delete page',
        preview: `<div style="display:flex;gap:8px;">
  <div style="flex:1;height:96px;border:1px solid #e5ddd0;background:#fff;"></div>
  <div style="flex:1;height:96px;border:1px solid #e5ddd0;background:#fff;opacity:0.45;position:relative;${MARK}"><span style="position:absolute;inset:0;display:grid;place-items:center;font-family:${BODY};font-size:12px;color:#c53929;">delete</span></div>
  <div style="flex:1;height:96px;border:1px solid #e5ddd0;background:#fff;opacity:0.45;position:relative;${MARK}"><span style="position:absolute;inset:0;display:grid;place-items:center;font-family:${BODY};font-size:12px;color:#c53929;">delete</span></div>
</div>`,
      },
      {
        title: 'Finish the piece with its tombstone',
        body: 'Articles end with a tombstone on the last sheet. It opens switched on, so once the spare pages are deleted the square lands on the article\'s real last page - turn it on or off from Tools ▸ Preferences.',
        click: 'Tools ▸ Preferences ▸ End-of-document marker',
        preview: `<div style="position:relative;height:96px;border:1px solid #e5ddd0;background:#fff;padding:8px;font-family:${BODY};font-size:12pt;color:#262626;">
  …the end of the last column.
  <span style="${MARK}position:absolute;right:12px;bottom:8px;display:inline-block;width:12px;height:12px;border-radius:3.5px;background:#1f1f1f;"></span>
</div>`,
      },
    ],
  },
  {
    id: 'poem',
    name: 'Poem',
    section: 'Articles',
    summary:
      'One column only - columns matter in a poem, so the shape the writer chose has to survive. The type is the bulletin’s usual schema: Franklin Gothic Heavy title, Arial byline, Roboto Condensed body.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f', note: 'Centred' },
      { role: 'Byline', font: 'Arial', size: '18pt', colour: '#808080', note: 'Directly beneath the title' },
      { role: 'Body', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'One column, line breaks kept' },
      { role: 'Tombstone', font: '-', size: '-', note: 'Centred directly beneath the last line' },
    ],
    templateId: 'bulletin-poem',
    columns: 1,
    position: 'body',
    steps: [
      {
        title: 'Write the title and byline',
        body: 'Same schema as every other piece: the title centred in Franklin Gothic Heavy, the poet’s name underneath in Arial 18pt grey, then the gray rule across the page.',
        preview: `<p style="margin:0;padding:6px 0;text-align:center;font-family:${FG};font-size:48pt;line-height:1.05;color:#3f3f3f;">[Poem Title]</p>
<p style="margin:0;text-align:center;font-family:${BYLINE};font-size:18pt;line-height:1.3;color:#808080;">By [Poet’s name]</p>
<hr style="margin:12px 0 0;border:0;border-top:1px solid #d9d3c9;" />`,
      },
      {
        title: 'Keep it in one column and keep the line breaks',
        body: 'A poem never goes into two columns - the writer broke the lines where they meant to, and the layout has to respect that. Press Shift + Enter for a new line inside a stanza and Enter for a new verse.',
        click: 'Format ▸ Columns ▸ One column',
        preview: `<p style="margin:0;text-align:left;font-family:${BODY};font-size:13pt;line-height:1.7;color:#262626;${MARK}">Morning comes to the bulletin boards,<br />ink still damp on the newest page,<br />someone laughs in the hallway,<br />and the story finds its readers.</p>`,
      },
      {
        title: 'Close with the tombstone',
        body: 'Poems end with a centred tombstone directly beneath the last line - the square that tells the reader the piece is over.',
        click: 'Tools ▸ Preferences ▸ End-of-document marker',
        preview: `<p style="margin:0;text-align:left;font-family:${BODY};font-size:13pt;line-height:1.7;color:#262626;">(Your poem, your name, your voice.)</p>
<p style="margin:14px 0 0;text-align:center;font-size:13pt;color:#262626;${MARK}">&#9632;</p>`,
      },
    ],
  },
  {
    id: 'graphic',
    name: 'Graphic',
    section: 'Articles',
    summary:
      'A page of artwork. Graphics usually sit directly beneath the piece they belong to, but a standalone art page is fine too - just credit the artist. No subtitle; the title carries the page.',
    rules: [
      { role: 'Title', font: 'Franklin Gothic Heavy', size: '48pt', colour: '#3f3f3f' },
      { role: 'Byline', font: 'Arial', size: '18pt', colour: '#808080' },
      { role: 'Credit', font: 'Aparajita', size: '18pt', colour: '#999999', note: 'Italic' },
      { role: 'Tombstone', font: '-', size: '12px', note: 'Black square in the corner, on by default' },
    ],
    templateId: 'bulletin-graphic',
    position: 'body',
    steps: [
      {
        title: 'Write the title and byline - no subtitle',
        body: 'The graphic page has a title and the artist’s name and nothing between them. Do not add a subtitle or caption line above the artwork.',
        preview: `<p style="margin:0;padding:6px 0 0;text-align:center;font-family:${FG};font-size:48pt;line-height:1.05;color:#3f3f3f;">[Graphic Title]</p>
<p style="margin:0;text-align:center;font-family:${BYLINE};font-size:18pt;line-height:1.3;color:#808080;">By [Artist’s name]</p>`,
      },
      {
        title: 'Click the frame and drop the artwork in',
        body: 'The dashed rectangle is a picture frame, not a text box. Click it once, choose the image, and it fills the frame - drag the corner handles if you want it bigger or smaller.',
        click: 'Click the dashed art frame ▸ choose image',
        preview: `<div style="height:150px;border:2px dashed #b9b0a4;border-radius:10px;display:grid;place-items:center;font-family:${BODY};font-size:13px;color:#8a8175;${MARK}">click to add the artwork</div>`,
      },
      {
        title: 'Credit the artist underneath',
        body: 'Finish the page with the credit line in Aparajita 18pt italic grey - “Image Credit to …” or “Artwork by …”. The tombstone then closes the page.',
        preview: `<p style="margin:0;text-align:center;font-family:${CREDIT};font-size:18pt;font-style:italic;line-height:1.3;color:#999;${MARK}">Image Credit to [Source]</p>
<div style="position:relative;height:70px;border:1px solid #e5ddd0;background:#fff;margin-top:6px;">
  <span style="${MARK}position:absolute;right:12px;bottom:8px;display:inline-block;width:12px;height:12px;border-radius:3.5px;background:#1f1f1f;"></span>
</div>`,
      },
    ],
  },
  {
    id: 'puzzle',
    name: 'Puzzle',
    section: 'Puzzles',
    summary:
      'The puzzle is the whole page: one artwork frame fills the sheet edge to edge, with the title and instructions set into the puzzle image itself.',
    rules: [
      { role: 'Puzzle', font: '-', size: '-', note: 'Full-page artwork frame - drag your grid in to fill it' },
    ],
    templateId: 'bulletin-puzzle',
    position: 'body',
    steps: [
      {
        title: 'Drop the puzzle into the full-page frame',
        body: 'The page opens as a single frame the size of the print area. Click it, pick the puzzle image, and let it fill the sheet.',
        click: 'Click the dashed frame ▸ choose image',
        preview: `<div style="height:200px;border:2px dashed #b9b0a4;border-radius:8px;display:grid;place-items:center;font-family:${BODY};font-size:13px;color:#8a8175;${MARK}">click to add the puzzle - it fills the whole page</div>`,
      },
      {
        title: 'Keep the page to the puzzle alone',
        body: 'No title, byline or instruction text on the sheet: the title and the clues are already part of the artwork, and anything typed around it breaks the full-bleed look.',
        preview: `<div style="height:200px;border:1px solid #e5ddd0;background:#fff;display:grid;place-items:center;font-family:${BODY};font-size:13px;color:#b3aca2;">the whole print area, nothing but the puzzle</div>`,
      },
    ],
  },
  {
    id: 'end-page',
    name: 'End page',
    section: 'Credits',
    summary:
      'The thank-you page: the message sits at the top, and the two orange cards with the full credits are pinned to the bottom of the sheet, so the note has the whole page to breathe.',
    rules: [
      { role: 'Thank-you', font: 'Dreaming Outloud Script', size: '44pt', colour: '#3f3f3f' },
      { role: 'Body', font: 'Roboto Condensed', size: '13pt', colour: '#262626' },
      { role: 'Credits', font: 'Roboto Condensed', size: '13pt', colour: '#262626', note: 'Two columns, leaders and formatters' },
    ],
    templateId: 'bulletin-endpage',
    position: 'end',
    steps: [
      {
        title: 'Write the thank-you message at the top',
        body: 'The heading and the note sit at the top of the page. Write as much as you like - the cards and credits below are pinned to the bottom, so the message is not fighting them for space.',
        preview: `<p style="margin:0;padding-top:10px;text-align:center;font-family:'Dreaming Outloud Script Pro','Segoe Print',cursive;font-size:42pt;line-height:1.35;color:#3f3f3f;">Thank You for Reading!!!</p>
<p style="margin:10px 0 0;text-align:justify;font-family:${BODY};font-size:13pt;line-height:1.4;color:#262626;${MARK}">Happy [theme] everyone! Write a short thank-you note to your readers here - what this issue is about, and why the team loved making it.</p>`,
      },
      {
        title: 'Keep the orange cards and the credits at the bottom',
        body: 'The classroom/website cards and the two credit columns are anchored to the bottom margin. Leave them there, and fill the names in - leaders, formatters, graphics, interviewers, puzzlemakers.',
        click: 'Drag the bottom block only if the page overflows',
        preview: `<div style="border-top:1px solid #e5ddd0;padding-top:10px;${MARK}">
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
    <tr>
      <td style="padding:10px;background:#ffe0cc;border-radius:14px;text-align:center;font-family:Roboto,'Segoe UI',Arial,sans-serif;font-size:14pt;line-height:1.35;color:#262626;">Join the Bulletin classroom<br />with the code: <b>[code]</b></td>
      <td style="width:16px;">&nbsp;</td>
      <td style="padding:10px;background:#ffe0cc;border-radius:14px;text-align:center;font-family:Roboto,'Segoe UI',Arial,sans-serif;font-size:14pt;line-height:1.35;color:#262626;">Visit our website:<br /><b>baulkobulletin.com</b></td>
    </tr>
  </table>
</div>`,
      },
      {
        title: 'Fill in the credits',
        body: 'The left column lists the team by role; the right column thanks everyone who worked on this issue. Replace every [Name] and delete the roles that do not apply this time.',
        preview: `<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <tr style="vertical-align:top;">
    <td style="width:50%;padding:4px 22px 0 0;">
      <p style="margin:0;font-family:${BODY};font-size:13pt;line-height:1.4;color:#262626;"><b>Special Thanks to:</b></p>
      <p style="margin:0;font-family:${BODY};font-size:13pt;line-height:1.4;color:#262626;">Leaders: [Name] &amp; [Name]</p>
      <p style="margin:0;font-family:${BODY};font-size:13pt;line-height:1.4;color:#262626;">Editor-in-Chief: [Name]</p>
    </td>
    <td style="width:50%;padding:4px 0 0 22px;border-left:1px solid #e5ddd0;${MARK}">
      <p style="margin:0;font-family:${BODY};font-size:13pt;line-height:1.4;color:#262626;"><b>And those who worked hard to make this issue complete:</b></p>
      <p style="margin:0;font-family:${BODY};font-size:13pt;line-height:1.4;color:#262626;">Formatters: [Name]</p>
    </td>
  </tr>
</table>`,
      },
    ],
  },
];

/** Guide pages that carry a template - what the picker and Merge can act on. */
export const EDITABLE_GUIDE_PAGES = GUIDE_PAGES.filter((p) => p.templateId);

export function getGuidePage(id: string): GuidePage | undefined {
  return GUIDE_PAGES.find((p) => p.id === id);
}

/* ---- The steps that are the same for every piece ------------------------ */

/**
 * Paste, illustrate, trim, sign off, send - the five moves every piece needs,
 * whichever template it started from. The reference guide shows these on every
 * page of the guide rather than repeating them inside each one, because they
 * are not about the *kind* of piece: they are the job.
 */
export const GUIDE_WORKFLOW_STEPS: GuideStep[] = [
  {
    title: 'Paste the article into its frame',
    body: 'Click into the body frame, select the template\'s lorem text and paste the real words over it. Everything you type stays in the frame, so the sheet\'s shape does not move. Do not paste into the master page - that furniture belongs to every page.',
    click: 'Click the body frame ▸ Ctrl+V',
    preview: `<div style="border:1px solid #e5ddd0;background:#fff;padding:10px 12px;font-family:${BODY};font-size:13pt;line-height:1.45;color:#262626;${MARK}">
  <p style="margin:0;font-family:${FG};font-size:26px;color:#3f3f3f;">[Headline]</p>
  <p style="margin:2px 0 8px;font-family:${BYLINE};font-size:14px;color:#808080;">By [Writer's name]</p>
  <p style="margin:0;">Paste the article here - the frame keeps its width, so the columns fill top to bottom and stop at the margin.</p>
</div>`,
  },
  {
    title: 'Insert the images and size them',
    body: 'Insert ▸ Image… drops a picture into a frame of its own; drag a corner handle to size it, and use Fit to choose whether the whole picture is shown (contain) or cropped to fill the frame (cover). Artwork pages start with the frame already open.',
    click: 'Insert ▸ Image…',
    preview: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-family:${BODY};font-size:12pt;color:#262626;">
  <div style="border:1px dashed #c9c1b5;background:#faf8f5;height:110px;display:grid;place-items:center;${MARK}">Image - fit: contain</div>
  <div style="border:1px solid #e5ddd0;background:#efe9e1;height:110px;display:grid;place-items:center;">Image - fit: cover (cropped)</div>
</div>`,
  },
  {
    title: 'Delete the sheets you do not need',
    body: 'Every template opens with more sheets than one piece fills. In the pages pane, right-click a thumbnail and delete it; the folio and the running head renumber themselves, so nothing needs fixing by hand.',
    click: 'Pages pane ▸ right-click ▸ Delete page',
  },
  {
    title: 'Finish the piece with the tombstone',
    body: 'Insert ▸ Tombstone pins the little black square to the bottom-right corner of the last sheet - outside the master page\'s frame and clear of the footer band. It is furniture, not type: it is placed for you and can be removed, never dragged into the text.',
    click: 'Insert ▸ Tombstone',
    preview: `<div style="position:relative;height:96px;border:1px solid #e5ddd0;background:#fff;">
  <span style="position:absolute;left:10px;bottom:8px;font-family:${BODY};font-size:11pt;color:#8a8378;">1 | September 2026</span>
  <span style="position:absolute;right:12px;bottom:12px;width:14px;height:14px;background:#262626;display:inline-block;${MARK}"></span>
</div>`,
  },
  {
    title: 'Download the page and hand it in',
    body: 'File ▸ Download ▸ Bulletin (.bulletin) saves the page as a file that carries its words, frames, pictures and master page. Upload it to the issue\'s assignment in the Google Classroom; if there is no assignment, email it to the Formatter Master - everyone\'s addresses are in the Classroom material for the issue.',
    click: 'File ▸ Download ▸ Bulletin (.bulletin)',
  },
];

/* ---- The two interactive walkthroughs ----------------------------------- */

/** Which kind of piece a walkthrough is about. */
export type FormatterKind = 'article' | 'poem';

/** One step of an interactive walkthrough, as the `/guide` wizard shows it. */
export interface WalkthroughStep {
  /** Imperative one-liner. */
  title: string;
  body: string;
  /** The menu path or button that does the work. */
  click?: string;
  /**
   * The options the formatter picks between. Picking one is what tells the
   * walkthrough which steps to show: an article is pasted into two columns and
   * illustrated, a poem is set centred in one and usually has no picture at
   * all, so the two cannot share the same middle steps. The choice also offers
   * the template it belongs to.
   */
  choices?: { label: string; templateId: string; kind: FormatterKind }[];
  /**
   * What this step turns into once the formatter has said what they are
   * editing. A step with no variant for the chosen kind reads the same either
   * way, and its own `title`/`body` are the fallback.
   */
  variants?: Partial<Record<FormatterKind, Partial<WalkthroughStep>>>;
  /** Background for the Formatter Master, who does this once per issue. */
  aside?: string;
  /** A mock-up, in the page's own HTML (see `GuideStep.preview`). */
  preview?: string;
}

/**
 * "I don't know, I'm new here" - the whole job, start to finish, for someone
 * formatting one piece of an issue for the first time.
 */
export const NEW_FORMATTER_STEPS: WalkthroughStep[] = [
  {
    title: 'Get your assignment',
    body: 'Open the Formatting sheet in the Baulko Bulletin Google Classroom and put your name next to the one piece you are going to format. If two people want the same piece, settle it in the Classroom before you start - not here.',
    click: 'Google Classroom ▸ the Formatting sheet',
  },
  {
    title: 'Keep this tab for the steps, and edit in a new tab',
    body: 'This tab is your reference and nothing else: it keeps the steps while you work. Open a new tab (Ctrl+T), open Bulletin Formatter in it, and do all the editing over there - everything from here on happens in that tab, and you can look back at these steps without losing your place.',
    click: 'Ctrl+T ▸ open Bulletin Formatter',
  },
  {
    title: 'Are you formatting an article or a poem?',
    body: 'This is the one question the walkthrough cannot answer for you, and it changes what comes next: an article is two columns of prose with pictures through it, a poem is set centred in a single column and almost never shares its sheet. Answer here and the steps below are rewritten for your answer - nothing opens in this tab, because the template is opened in your editing tab.',
    choices: [
      { label: 'An article', templateId: 'bulletin-article', kind: 'article' },
      { label: 'A poem', templateId: 'bulletin-poem', kind: 'poem' },
    ],
  },
  {
    title: 'Set the master page',
    body: 'The running head and folio are never typed on each sheet - they live on the master page, so one edit dresses every page: “Baulko Bulletin | n+33” top-right, the page number with the month and year in the footers. The tombstone is deliberately *not* master furniture: keep it off the master page so it only appears where a piece actually ends.',
    click: 'View ▸ Master page…',
    aside: 'If the issue number or the month looks wrong, fix it here once - it is wrong on the whole issue otherwise.',
    preview: `<div style="position:relative;height:120px;border:1px solid #e5ddd0;background:#fff;font-family:${BODY};font-size:12pt;color:#262626;">
  <span style="position:absolute;right:10px;top:8px;${MARK}padding:2px 6px;">Baulko Bulletin | n+33</span>
  <span style="position:absolute;left:12px;bottom:8px;padding:2px 6px;">1 | September 2026</span>
  <span style="position:absolute;right:12px;bottom:8px;padding:2px 6px;">September 2026 | 2</span>
</div>`,
  },
  {
    title: 'Paste the writing into the body frame',
    body: 'Click the body frame and paste the writing over the template\'s lorem text, then style the headline and byline the way the page asks. Nothing you type should land outside a frame.',
    click: 'Click the body frame ▸ Ctrl+V',
    variants: {
      article: {
        title: 'Paste the article into the two columns',
        body: "The Article template opens with two columns and a rule between them, and the copy fills the first column to the bottom before it carries on in the second. Click the body frame, replace the lorem text with the real article, then set the headline in Franklin Gothic Heavy with the byline under it in grey Arial.",
      },
      poem: {
        title: 'Type the poem centred, in one column',
        body: 'A poem keeps to a single column and sits centred on the sheet: title on top, byline under it, then the stanzas. Paste it in and keep each stanza as its own paragraph - the frame re-flows the lines for you, so nothing has to be placed line by line.',
        preview: `<div style="border:1px solid #e5ddd0;background:#fff;padding:16px 20px;text-align:center;${MARK}">
  <p style="margin:0;font-family:${FG};font-size:24px;color:#3f3f3f;">[Poem Title]</p>
  <p style="margin:4px 0 12px;font-family:${BYLINE};font-size:14px;color:#808080;">By [Poet&rsquo;s name]</p>
  <p style="margin:0;font-family:${BODY};font-size:13pt;line-height:1.6;color:#262626;">It is pleasant, indeed, while the summer lasts,<br>with the mild pheasant&rsquo;s song on the air;<br>but now I feel the northern wind&rsquo;s blast -<br>its severe weather strong.</p>
</div>`,
      },
    },
  },
  {
    title: 'Insert the images and size them',
    body: 'Insert ▸ Image… for each picture, then drag a corner handle to size it. Fit: contain keeps the whole picture, Fit: cover crops it to fill the frame - artwork and puzzle pages open with the frame already full-page.',
    click: 'Insert ▸ Image…',
    variants: {
      article: {
        title: "Insert the article's pictures",
        body: 'Insert ▸ Image… for each picture and leave Fit on contain so nothing is cropped, then drag a corner handle to size it. Keep a picture inside one column: type does not flow around an image here, so one dropped across the rule pushes the column out of shape.',
      },
      poem: {
        title: 'Add artwork only if the poem came with it',
        body: 'Most poems are words and nothing else, and a lone picture on an otherwise empty sheet reads like a mistake. If this one did come with artwork, put it above the title or below the last stanza - never between stanzas - and set Fit: contain.',
      },
    },
  },
  {
    title: 'Delete the pages you do not need',
    body: 'Every template opens with more sheets than one piece fills. Right-click the extra thumbnails in the pages pane and delete them; the running head and page numbers renumber themselves.',
    click: 'Pages pane ▸ right-click ▸ Delete page',
    variants: {
      article: {
        title: 'Trim the article to the sheets it really needs',
        body: 'The Article template opens a two-column start page, several continuation sheets and an extras sheet, and most articles run two or three. Delete the surplus in the pages pane once the copy has stopped flowing onto them; a sheet holding only a line or two is a sign to tighten the piece, not to print a nearly empty page.',
      },
      poem: {
        title: 'Delete every sheet the poem does not fill',
        body: 'A poem is one sheet, so delete the rest in the pages pane. If it genuinely runs past one sheet, let the frame re-flow into a narrower column rather than keeping a second sheet for a handful of lines.',
      },
    },
  },
  {
    title: 'Add the tombstone to the last page',
    body: 'Insert ▸ Tombstone puts the end-of-piece marker in the bottom-right corner of the last sheet of the piece - outside the master page\'s frame, so it never lands in the type or on pages that do not need it. Right-aligned for an article, centred under the last line for a poem.',
    click: 'Insert ▸ Tombstone',
    variants: {
      article: {
        title: 'Sign the article off with the tombstone',
        body: 'Insert ▸ Tombstone. On an article the marker follows the end of the prose, landing in the bottom-right corner of the sheet the article finishes on - the printer&rsquo;s full stop for the piece.',
      },
      poem: {
        title: 'Sign the poem off with the tombstone',
        body: 'Insert ▸ Tombstone. A poem takes the same marker as any other piece, in the bottom-right corner of its sheet. The Design Bible asks for it centred under the last stanza; the app pins it to the corner so it stays outside the master page frame and clear of the folio.',
      },
    },
    aside: 'A piece which ends mid-page still gets its marker on that page - the marker is furniture, and it can be removed but never dragged.',
    preview: `<div style="position:relative;height:110px;border:1px solid #e5ddd0;background:#fff;">
  <span style="position:absolute;left:10px;bottom:8px;font-family:${BODY};font-size:11pt;color:#8a8378;">1 | September 2026</span>
  <span style="position:absolute;right:12px;bottom:12px;width:14px;height:14px;background:#262626;display:inline-block;${MARK}"></span>
</div>`,
  },
  {
    title: 'Download the page as a .bulletin file',
    body: 'File ▸ Download ▸ Bulletin (.bulletin) saves everything the Master needs: the words, the frames, the pictures and the master page. Do not send a screenshot or a PDF for this step - the .bulletin file is what keeps the layout.',
    click: 'File ▸ Download ▸ Bulletin (.bulletin)',
  },
  {
    title: 'Hand it in',
    body: 'If the Classroom has an assignment for this issue, upload your .bulletin file there. If it does not, email the file to the Formatter Master - the material for the issue lists everyone\'s addresses. Then you are done: the Master merges your page into the issue exactly as you laid it out.',
    aside: 'Never re-type or re-format the piece somewhere else on the way in - the file is the finished page, and merging it is what keeps it finished.',
  },
];

/**
 * What the Formatter Master does once everyone has handed their pages in: put
 * the issue together, keep it, and export it.
 */
export const FORMATTER_MASTER_STEPS: WalkthroughStep[] = [
  {
    title: 'Collect everyone\'s pages',
    body: 'Gather the .bulletin files the team handed in - from the Classroom assignment, or by email - and download them onto the computer you are building the issue on.',
    click: 'Google Classroom ▸ the issue assignment ▸ Download all',
  },
  {
    title: 'Merge them into one issue',
    body: 'Home screen ▸ Merge, and pick every .bulletin file at once. The tool recognises what each file is (cover, contents, article, poem, puzzle, graphic, end page) and offers them in issue order rather than the order you picked them.',
    click: 'Home ▸ Merge',
  },
  {
    title: 'Let it build the page of contents',
    body: 'Tick “generate a page of contents” and the Merge writes the contents list for you - each piece with the page it starts on - and reserves exactly as many sheets as the list needs. The title page and the end page belong in the file set already: the cover first, the credits last.',
    click: 'Merge ▸ Page of contents',
  },
  {
    title: 'Check that everything is there',
    body: 'Read the contents list against the pieces you collected: every article, poem, puzzle and graphic present, in an order that reads well, the title page first and the end page last. Fix the order with the arrows in the dialog before you merge - it is much harder afterwards.',
    click: 'Merge ▸ the arrows next to each file',
  },
  {
    title: 'The issue is saved as you work',
    body: 'The merged issue opens as a document of its own, and documents save themselves in this browser, so there is nothing to do to keep it: close the tab, come back tomorrow, and it is on the home screen under Recent documents. Copy it (File ▸ Make a copy) before trying anything drastic.',
    aside: 'Nothing lives in the cloud. The browser copy is the only copy - export a .bulletin file whenever an issue is finished.',
  },
  {
    title: 'Export the finished issue',
    body: 'File ▸ Download ▸ Bulletin (.bulletin) hands the whole issue on as one file the team can reopen. When you need something to print or share, File ▸ Print (Ctrl+P) and choose “Save as PDF” - the print stylesheet lays one sheet onto each printed page.',
    click: 'File ▸ Download ▸ Bulletin, or File ▸ Print ▸ Save as PDF',
  },
];

/** Classify a document/template as an issue part, for ordering a merge. */
export function guidePositionOf(templateId?: string, title = ''): GuidePosition {
  const page = templateId ? GUIDE_PAGES.find((p) => p.templateId === templateId) : undefined;
  if (page) return page.position;
  const t = title.toLowerCase();
  if (t.includes('cover') || t.includes('title page')) return 'front';
  if (t.includes('end page') || t.includes('credit') || t.includes('thank')) return 'end';
  return 'body';
}
