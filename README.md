# Bulletin Formatter

A browser-based desktop-publishing editor for the **Baulko Bulletin**, built as a
Microsoft Publisher replacement that reads like Google Docs. Every page is a real
sheet of paper with movable, resizable, linkable frames on it - text boxes,
pictures, orange cards, rules, imported PDF pages - plus Publisher's master pages
for the running head and folio.

It is a **static, offline-first app**: there is no server, no account and no
database. Documents live in the browser's own storage and are shared by
downloading a `.bulletin` file, so everything below ("where is my document")
means *this browser, this device*.

---

## Contents

1. [Quick start](#quick-start)
2. [The 60-second tour](#the-60-second-tour)
3. [Using the editor](#using-the-editor)
4. [Master pages (running head and folio)](#master-pages-running-head-and-folio)
5. [Merging an issue](#merging-an-issue)
6. [Keyboard shortcuts](#keyboard-shortcuts)
7. [Where documents live](#where-documents-live)
8. [The `.bulletin` file format](#the-bulletin-file-format)
9. [Templates and the Design Bible](#templates-and-the-design-bible)
10. [How it works: architecture](#how-it-works-architecture)
11. [The document model (frames and stories)](#the-document-model-frames-and-stories)
12. [Codebase map](#codebase-map)
13. [Working on the code](#working-on-the-code)
14. [Printing, fonts and offline behaviour](#printing-fonts-and-offline-behaviour)
15. [Known limitations](#known-limitations)

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
| ------ | ------------ |
| `npm run dev` | Vite dev server with hot module replacement |
| `npm run build` | `tsc -b` (type-check the whole project) **then** `vite build` → `dist/` |
| `npm test` | The round-trip tests for a frame (see [Tests](#tests)) |
| `npm run preview` | Serve the built bundle from `dist/` |

`npm run build` type-checks every file before it bundles, so a red build means a
type error somewhere. Beyond that, the honest check after a change is `npm test`
plus a pass through the running app - most flows (opening a template, typing in a
frame, threading an overflow, dragging a rule) are interactive and have no
automated cover.

**Stack**: Vite 5 · React 18 · TypeScript 5.6 · Tailwind CSS 3 · lucide-react
(icons, no Material) · pdfjs-dist (PDF import).

---

## The 60-second tour

The app has two screens.

- **`/` - the home screen.** A template strip, the recent-documents grid, and
  the **Guide**, **Merge** and **Import** buttons. Clicking a template card opens
  a brand-new document; clicking a recent card reopens that document.
- **`/guide` - the Design Bible.** Every page of the house style as a numbered
  walkthrough, with mock-ups of the elements and a button that opens that page in
  the editor.

The editor itself is a document window:

```
┌──────────────────────────────────────────────────────────────┐
│ Bulletin   [title]  ☆   File Edit View Insert Format Tools Help│  menu bar
├──────────────────────────────────────────────────────────────┤
│ search undo redo print | style ▾ font ▾ - size + B I U …      │  toolbar
├──────────────────────────────────────────────────────────────┤
│  [ master-page ribbon, only while the master page is open ]   │
├───────────┬──────────────────────────────────────┬───────────┤
│ pages     │            ruler                     │ master /  │
│ pane      │  ┌────────────────────────────┐      │ layers    │
│ (thumbs)  │  │        the sheet           │      │ panel     │
│           │  └────────────────────────────┘      │           │
├───────────┴──────────────────────────────────────┴───────────┤
│ A4 794×1123px   zoom ─────●────  282 words · Normal text …    │  status bar
└──────────────────────────────────────────────────────────────┘
```

---

## Using the editor

### Frames: everything on the page is an object

Text never sits on the page itself - it sits in a **frame**. A frame can be:

| Kind | What it is | How to make one |
| ---- | ---------- | --------------- |
| Text | A text box, 1-4 newspaper columns | **Insert ▸ Text box**, or type in one |
| Image | A picture, cropped (`cover`) or whole (`contain`) | **Insert ▸ Image**, or drop art in |
| Shape | A filled rectangle (the orange cards) | **Insert ▸ Shape** |
| Line | A free-standing rule | **Insert ▸ Line** |
| PDF | An imported PDF page, shown live so its text stays selectable | the pages pane ▸ *Insert PDF below* (how puzzles usually arrive) |
| Sheet | An empty-page marker that reserves a blank page | automatic |
| Tombstone | The end-of-piece marker (◼), pinned furniture | **Insert ▸ Tombstone**. You can also turn it on for the page via Tools ▸ Preferences |

**Click** a frame to select it; **double-click** (or press Enter) to type in it;
drag the box to move it, drag a handle to resize it. A frame with no text shows
its placeholder hint ("Click to add a header", "Type here…").

The blue selection chrome belongs to the editor, never to the page: set
**View ▸ Viewing** to see the sheet exactly as it prints.

A two-column frame fills **column one to the bottom, then column two**
(`column-fill: auto`) - the newspaper order, and the one the flow engine's
capacity model measures against. `balance`, which shares a short story out
between the columns, left both of them floating above the frame's bottom edge.

A selected frame's own toolbar sits above it. A text frame offers its column
count (1 / 2 / 3) and, once it has more than one column, the gutter **rule**: a
colour picker and a weight box, exactly as a line box has them, plus a
"no rule" button for two plain columns. The rule is drawn as a rounded bar
rather than a CSS `column-rule`, whose ends are always square, and the colour
and weight are saved with the frame.

One grey, one weight, everywhere. `COLUMN_RULE_COLOR` (#d9d3c9) and
`COLUMN_RULE_WIDTH` (2px) in `src/lib/textbox.ts` are the house rule, and they
are the same for the gutter between two columns, the line under a byline (its
own object on the article and poem start pages), the rule under a contents
heading and the merged issue's. The article's byline rule, its column rule and
the contents rule are therefore one line, not three lines that nearly match.

### Threading text (linked frames)

A chain of linked frames shares **one story**. When the last frame of a chain
cannot show everything it is *in overflow*: its chrome turns red and it offers a
link handle. Click the handle, then click on any page - the remainder flows into
a new frame there. This is how an article runs from its start page onto the
continuation sheets. Resize or move any frame in the chain and the text
redistributes; nothing is ever lost, even when it does not fit (the leftover
stays clipped in the last frame until you resize it).

### The pages pane (left)

One thumbnail per sheet, named **Page 1**, **Page 2**… with an optional name you
can give it. The toolbar of the pane adds a page, and each tile has a
right-click menu:

- *Insert page below* / *Insert PDF below*
- *Insert duplicate page* (copies the layout, clears the words - a fresh
  template) / *Duplicate page* (a true copy, content and all)
- *Move page…*, *Rename page…*
- *Master page* ▸ which master dresses this page
- *View two-page spread*
- *Delete page* (asks first when the sheet has content)

Tiles can also be dragged to reorder pages - every frame on a page travels with
it.

### The layers panel (right)

**View ▸ Layers panel** lists the frames on the current sheet, front-most first,
with what each one is (its first words, "Orange card", "PDF Page 2"…). Each row
has *bring forward*, *send backward*, *bring to front*, *send to back* and
*delete*. The same restacking is on **Format ▸ Order** and on `Ctrl+]` /
`Ctrl+[` (`Ctrl+Shift+]` / `Ctrl+Shift+[` for front/back). Painting order *is*
the frame order, so this is how you decide whether the orange card covers the
picture or the other way round. The end-of-piece marker is pinned above
everything and takes no part in the ordering.

### Find, replace and the rest of the menus

| Menu | What is in it |
| ---- | ------------- |
| **File** | New, Open, Make a copy, Download (`.bulletin` / `.html` / `.txt`), Rename, Move ▸ *Back to home screen*, *Move to trash*, Version history, Details, Page setup ▸ paper & orientation, Print |
| **Edit** | Undo/Redo, Cut/Copy/Paste, Paste without formatting, Select all, Delete, Find and replace |
| **View** | Editing / Viewing, Zoom in/out/reset, Show ruler, Show toolbar, **Master page…**, Layers panel, Full screen |
| **Insert** | Text box, Image, Table (grid picker), Symbols & emoji, Link, Shape, Line, Horizontal line, Tombstone, Break ▸ page/column, Today's date |
| **Format** | Text styles, Size, Capitalisation, Paragraph styles, Align & indent, Line & paragraph spacing, **Columns (1-3)**, Bullets & numbering, Heading 1-4, Quote, Order, Tombstone, Clear formatting |
| **Tools** | Spelling and grammar, Word count, Dictionary (online lookup), Preferences ▸ automatic spellcheck, end-of-piece marker |
| **Help** | Search the menus (`Alt+/`), Keyboard shortcuts, Design guide, About |

Undo is the canvas's **own** history, not the browser's: a typing burst or a drag
is one step, and it can undo a moved frame, a column change or a deleted page -
none of which the native `contentEditable` stack could ever restore.

### Messages and confirmations

Notices appear as toasts in the bottom-left corner (errors linger twice as long
as successes) and anything destructive asks in the app's own dialog -
*Move “Article” to trash?*, *Delete page 4?*, *Delete master page A?*, *Delete
all 16 documents?*. Nothing in the app uses a native `alert`/`confirm`, which
would freeze the tab and cannot be styled or inspected.

Deleting one document is done from its card on the home screen. **Delete all**
sits at the right of the *Recent documents* heading (only while there is
something to delete) and asks once, in the same dialog; `purgeAllDocs` then
clears the list, the version histories and every picture or PDF blob those
documents referred to, so it really does leave the browser as empty as a fresh
install.

---

## Master pages (running head and folio)

The running head and folio are not typed on every sheet. They live on a **master
page** and print on every page that wears it - Publisher's model, rebuilt here.

**View ▸ Master page…** opens master view. The publication is replaced by the
master sheet, the dashed bands are now live text, and a **Master Page** ribbon
appears across the top of the window.

### The ribbon

| Button | What it does |
| ------ | ------------ |
| **Add Master Page** | A new master with its own one-character Page ID and description |
| **Two-Page Master** | Make this master a facing spread: a left and a right sheet, each with its own furniture (warns before dropping the left sheet) |
| **Apply To** | *All pages* (including pages added later), *current page*, *pages…* (a range like `2-5, 9`), or *no master* |
| **Rename** | Change the Page ID and description (refuses an ID already in use) |
| **Duplicate** | Copy this master under a new Page ID |
| **Delete** | Delete it; pages using it are handed to another master (refuses to delete the last one) |
| **Show Header/Footer** | Show or hide this master's furniture |
| **Insert Page Number / Date / Time** | Drop a field into the band you are editing, at the caret |
| **Close Master Page** | Back to the publication |

The master tiles in the left pane (Page ID + description) switch which master you
are editing; the panel on the right edits the header and footer text of the
active master, including which of the three Tab stops each band uses.

### Bands, tab stops and fields

A band is one line of furniture, split into three **Tab stops** - left, centre,
right - by pressing **Tab** while typing in it. That is how one band carries
"Baulko Bulletin | n+33" on the right and a page number on the left.

Fields resolve **per page** when the sheet is drawn:

| Field | Becomes |
| ----- | ------- |
| `@page` | that sheet's page number |
| `@pages` | the publication's page count |
| `@month` / `@year` | the month name / year |
| `@date` | today's date, long form |
| `@time` | the current time |
| `@title` | the document's title |

A master page is an **independent page**: its frame and its bands are fixed
design geometry (a 48 px - half-inch - inset on A4) and deliberately do *not*
move with anything in the publication. Publisher draws that frame as a guide
when you are not in master view; here it is the faint orange rectangle you can
see on ordinary pages.

### Applying a master

A master set is many masters plus an *assignment* of pages to masters. `Apply
To ▸ All pages` writes `{ "*": "A" }`, a per-page choice writes `{ "3": "A" }`,
and a range writes one entry per page. A page with no assignment falls back to
the master set's active master; `Apply no master` gives a bare page. Applying a
master again on the current page is also on the page tile's right-click menu.

Documents saved before masters existed (a single `masterHeader` / `masterFooter`
string) are migrated on open: the old text becomes the furniture of master
"A". Nothing to do, and nothing is thrown away.

---

## Merging an issue

The Design Bible fixes the running order of an issue - cover at the front, end
page and credits at the bottom - so **Merge** takes the parts you have written
and builds the issue in that order, with a generated **Page of Contents**.

### How to use it

1. Write (or open) the parts as ordinary documents and **File ▸ Download ▸
   Bulletin (.bulletin)** each one. They stay independent files - an article, a
   poem, a puzzle, the cover, the end page.
2. On the **home screen**, click **Merge** in the top bar and pick two or more
   `.bulletin` files (the picker accepts several at once).
3. The dialog lists what it read, in the order it will be laid out. Each row
   shows the part's title, its file name and **how Merge classified it** -
   `COVER`, `CONTENTS`, `ARTICLE`, `POEM`, `GRAPHIC`, `PUZZLE`, `END`. A part's
   saved template is what decides (the poem template is a poem); a document with
   no template falls back to a guess from its title.
4. Reorder with the ↑/↓ arrows, drop a part with the bin, and set the **issue
   title**.
5. Choose the options: *Build a Page of contents from the merged pages*, *Keep
   the cover page at the front*, *Keep the end page at the bottom*. The line
   under them previews the result - e.g. *"Result: 4 pages, plus a generated page
   of contents."*
6. **Merge**. The issue opens as a new document: cover first, then the generated
   contents, then every other part in the order you set, then the end page. The
   Page of Contents lists each part with the page it starts on, in the house
   two-column style, spilling onto a second sheet when an issue has more than
   fourteen parts. Merge also dresses the new issue in the house master page
   (running head + folio) and gives it the end-of-piece marker.

Notes:

- If one of the files **is** a contents page, Merge uses yours instead of
  generating one.
- Parts keep their frames, and linked-frame chains are re-pointed at their new
  ids, so a threaded article is still threaded after the merge.
- A part imported without frames (a plain HTML document) is split into one frame
  per element first, so a merge never produces an un-editable blob.
- Page numbers shift automatically around the generated contents sheet, so the
  numbers printed in the list match the sheets.
- Files that are not `.bulletin` documents are skipped, not fatal.

---

## Keyboard shortcuts

| Keys | Action |
| ---- | ------ |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+P` | New / open / download `.bulletin` / print |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo (the canvas's own history) |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Bold / italic / underline |
| `Ctrl+X` / `Ctrl+C` / `Ctrl+V` | Cut / copy / paste |
| `Ctrl+Shift+V` | Paste without formatting |
| `Ctrl+F` / `Ctrl+H` | Find / find and replace |
| `Ctrl+K` | Insert a link |
| `Ctrl+A` | Select all (contents of the frame you are in; the whole sheet when the frame is selected) |
| `Ctrl+Shift+L` / `E` / `R` / `J` | Align left / centre / right / justify |
| — (pill: the break-long-words button) | Cut a word wider than the column with a hyphen, and continue it on the next line, for the paragraphs the selection touches |
| `Ctrl+\` | Clear formatting |
| `Ctrl+]` / `Ctrl+[` | Bring forward / send backward |
| `Ctrl+Shift+]` / `Ctrl+Shift+[` | Bring to front / send to back |
| `Ctrl+Shift+C` | Word count |
| `Ctrl+Shift+Y` | Dictionary lookup |
| `Ctrl+Shift+Backspace` | Move to trash |
| `Tab` (in a master band) | Next Tab stop |
| `Alt+/` | Search the menus by name |
| `Ctrl+/` | The shortcut list |

---

## Where documents live

There is no server. A document exists in three places, all local to the browser:

| Store | Key / database | Holds |
| ----- | -------------- | ----- |
| `localStorage` | `bulletin.recentDocs` | Up to **16** recent documents (title, HTML, frames JSON, page names, master page) |
| `localStorage` | `bulletin.docVersions` | Up to **10** snapshots per document, recorded when the word count drifts by 15 words |
| IndexedDB | `bulletin_media_db` → `media` | Pictures, and whole imported PDF files, as binary blobs |

Heavy binary data never goes into `localStorage` (which is capped around 5 MB):
a picture's `src` is written to IndexedDB and the frame is left holding a
lightweight reference - `asset:…`, `img:…` or `pdf:…`. The frame resolves that
reference back to a blob URL when it renders, and a **save only swaps the data
URL for a reference once the blob is confirmed in IndexedDB**, so saving and
reloading quickly can never leave a document pointing at media that is not
there. When a document is deleted, `purgeDoc` removes its snapshots and reclaims
every blob nothing else refers to.

Consequences worth knowing:

- **Clearing site data deletes the documents.** There is no cloud copy -
  `File ▸ Download ▸ Bulletin` is the backup.
- Recent documents are capped at 16; older ones drop off the list (their
  version snapshots stay until purged).
- Deleting the document that is still open in memory drops the in-memory copy
  with it, so the next save cannot write it back after it was deleted.
- **File ▸ Version history** lists the snapshots of the open document and can
  restore one.
- **File ▸ Details** shows where the file came from and what it contains.

---

## The `.bulletin` file format

A `.bulletin` file is JSON - deliberately small, readable and easy to diff:

```jsonc
{
  "format": "bulletin",          // the only marker parseBulletin trusts
  "version": 1,
  "title": "Editorial",
  "content": "<p …>…</p>",       // flat page HTML (legacy fallback + print)
  "page": "A4",                  // or "Letter"
  "createdAt": 1737000000000,
  "updatedAt": 1737000000000,
  "template": "bulletin-editorial",
  "boxes": "[ { \"id\":\"tb…\", \"pageIndex\":0, \"x\":96, \"y\":80, \"w\":602, \"h\":92,\n              \"html\":\"<h1 …>\", \"nextId\":null, \"kind\":\"image\", \"src\":\"asset:…\",\n              \"columns\":1, \"css\":\"font-size:13pt\" } ]",
  "pageNames": "[\"\", \"Contents\"]",
  "master": "{ \"masters\":[ … ], \"assignment\":{ \"*\":\"A\" }, \"activeId\":\"A\" }"
}
```

`boxes` and `pageNames` and `master` are JSON *strings* nested inside the file -
that keeps the shape stable as those models grow, and lets an old build ignore a
field it does not understand instead of failing to parse a document.

Rules the format keeps:

- **Fresh ids on every load.** Stored frame ids are remapped when a document is
  built, and stored `nextId` links are translated with them, so a rebuild remounts
  the DOM cleanly and chains survive.
- **Absent frames are legacy.** A file with no `boxes` is a document from before
  the frame model: its `content` is split into one frame per element on open.
- **A deliberate full-page frame stays whole.** A template that asks for one text
  box (any column count, including 1) stores `columns`, so it is never mistaken
  for the old coarse full-page migration and re-split.
- **Unknown fields are ignored, bad files are refused.** `parseBulletin` returns
  `null` rather than half a document, and the app says so in a toast.

---

## Templates and the Design Bible

`src/data/templates/` holds one HTML file per page of the house style, and
`src/data/templates/index.ts` is the manifest that turns it into frames. Each row
of the Home-screen picker is one of them:

| Template | What it opens as |
| -------- | ---------------- |
| Blank page | An empty sheet (the big **+** card) |
| Title page | One full-bleed image frame - drop the cover artwork in |
| Editorial | Title, the news icon as its own movable image box, and the letter in a text box |
| Page of contents | A title, a separate movable rule, and one two-column list box |
| Article | Headline, byline, rule and two-column body as four separate objects on the start page, four two-column continuation sheets, one extras sheet |
| Puzzle | A single full-page puzzle frame |
| Poem | One column, ending in the end-of-piece marker |
| Graphic | Title, byline, click-to-add art frame (never cropped) and credit |
| End page | Thanks / credit / message / card / website boxes and a two-column credits box |

Some pages declare their frames **in the HTML** (`data-frame="x,y,w,h"`, the
manifest's `layout` flag): each top-level element opens as its own object - a
text box, a columned text box (`data-columns`), an orange rectangle
(`data-kind="shape"`, `data-fill`, `data-radius`) or a movable rule
(`data-kind="line"`, `data-stroke`, `data-thickness`). A frame can also declare
its **standard text type** with `data-text="font-size:13pt;line-height:1.45"` -
what plain text in it falls back to, and what a wholesale retype (Ctrl+A then
type) adopts - and the alignment its text falls back to with `data-align`. A
standard may also carry `overflow-wrap:break-word`, the one layout rule worth
putting there: it is what keeps a pasted article breaking its long words (see
*Long words* below).

That markup both paints the Home-screen thumbnail and produces the live,
draggable frames, so a template cannot drift out of step with its thumbnail: the
thumbnail lays the `data-frame` objects out at their own coordinates, exactly as
the canvas does.

### Long words

A word wider than its column is cut with a hyphen and continued on the next
line. That is `src/lib/longWords.ts`: the canvas measures each word against the
frame's column (a Range over the text, one client rect per line box) and puts a
**soft hyphen** (U+00AD) at the furthest position that still fits, which is a
break opportunity every engine honours without a dictionary. Paragraphs consent
to it with `overflow-wrap: break-word` - the pill's break-long-words button
writes it, and body frames declare it in their standard - and the pass runs
before the overflow verdicts on every layout change, so a word that has just
been broken is not reported as clipping. Taking the setting off (or widening the
frame) strips the soft hyphens again: every pass starts from clean text.

`src/data/designGuide.ts` is **Design Bible 2.0 as data**: nine page entries with
their typographic rules (role, font, size, colour), a numbered walkthrough for
each, and mock-ups written in the same HTML the page itself uses. `/guide` renders
it and can jump straight into editing that page.

`src/data/paragraphStyles.ts` is the named house type (Title 48pt, Byline 18pt,
Body 13pt, Pull-quote 24pt, Artwork credit 18pt, Running head 18pt, Contents
entry 18pt, Precursory note 13pt, Normal text 11pt) that the toolbar's style
picker applies.

---

## How it works: architecture

```
main.tsx
  └── <App>                       FeedbackProvider (toasts + confirm dialogs)
        └── <AppShell>            all editor state, command dispatch, persistence
              ├── <HomeScreen>    templates, recents, Import / Merge / Guide
              ├── <GuideScreen>   /guide
              ├── <MenuBar>       the seven menus + menu search
              ├── <Toolbar>       formatting toolbar
              ├── <MasterSection> the Master Page ribbon
              ├── <MergeDialog>
              ├── <DocumentCanvas>  ← the editor proper
              │     ├── <PageSidebar>   the pages pane
              │     ├── <LayersPanel>   the layers panel
              │     ├── <TextBoxFrame>  a text frame
              │     └── (image / shape / line / PDF / master-band renderers)
              └── <MasterPanel>   the right-hand master editor
```

The division of responsibility is deliberate:

- **`App.tsx` owns the document.** Title, page size, zoom, the master set, the
  recent list, the command switch (`run(id)`), the keyboard shortcuts, and
  persistence (debounced saves, flushed on unload). It knows nothing about
  pixels.
- **`DocumentCanvas.tsx` owns the frames.** Their geometry and content, the undo
  history, selection, drag/resize, the flow engine's results, the pages pane's
  thumbnails, and the master-page view. It reports changes upward (`onDocChange`)
  and takes *requests* downward - `columnsTick`, `arrange`, `masterToken`, `rev`
  - which is why the menus can drive the canvas without the canvas knowing what a
  menu is.
- **`lib/` is pure domain logic.** The frame model, the flow engine, master
  pages, the file format, storage, media, merge. `lib` never imports from
  `components` (a `lib/frames.ts` split exists exactly to keep that true), so the
  Merge tool and the app shell can both build frames without pulling in React.
- **`components/` renders.** Small presentational pieces, most of them driven
  entirely by props.

### Where a keystroke goes

```
contentEditable input
  → DocumentCanvas: liveHtml keeps the frame's DOM, reflowAll() recomposes the
    chain, flowStory() redistributes the story, overflow flags a frame red
  → onDocChange(content, boxes)   (debounced inside the canvas)
  → App: state + snapshot() into the undo history
  → persistNow() / debounced save → localStorage (+ IndexedDB for media)
```

### Commands

Every menu item, toolbar button and shortcut is a **command id** - `file.download.bulletin`,
`columns.2`, `order.front`, `style.h1`. `MenuBar` sends the id to `App.run(id)`,
which switches on it, applies the change, and asks the canvas to do the visual
part. A few families are handled by prefix (`insert.char.…`, `style.…`,
`spacing.…`, `columns.…`), which is worth knowing when you add a menu item:
**an id with no case matching it is a menu item that silently does nothing.**

### Feedback

`components/Feedback.tsx` provides `useFeedback()` →
`{ toast(message, options), confirm({title, body, …}) }`. `confirm` returns a
promise, so a destructive action reads exactly like the native call it replaced:

```tsx
if (!(await confirm({ title: 'Delete page 4?', danger: true }))) return;
```

---

## The document model (frames and stories)

`src/lib/textbox.ts` is the heart of the app.

```ts
interface FrameGeom {
  id: string; pageIndex: number;
  x: number; y: number; w: number; h: number;
  columns?: number;            // 1-4 (text frames)
  nextId: string | null;       // the next frame in this chain
}
interface TextBox extends FrameGeom {
  html: string;                // the seed/fallback; the live DOM wins while editing
  kind?: 'image' | 'sheet' | 'shape' | 'line' | 'pdf' | 'tombstone';
  src?, radius?, fade?, fit?, fill?, stroke?, thickness?, ph?, align?, css?,
  pdfPage?
}
```

There is **one** definition of a frame (`lib/textbox.ts`); the canvas, the layers
panel and the flow engine all speak it. It used to exist twice, and the copies
drifted - the reason the layers panel once read properties the model never had.

**The story is the source of truth, never the frames.** Frames store geometry;
their contents are recomputed after every edit:

1. `recomposeStory(slices)` stitches the frames' slices back into one story,
   merging the `data-flow="head"` / `"tail"` halves of a paragraph that was split
   across a frame boundary - so repeatedly editing a threaded article does not
   chop one paragraph into two, then three, then four.
2. `splitTopLevelBlocks` cuts the story into measurable units.
3. `flowStory(story, boxes, font)` measures each unit in one hidden div styled
   like a real frame (`overflow:hidden` so the last block's bottom margin counts,
   matching `scrollHeight`), fills each frame in chain order, and binary-searches
   a word boundary when a block does not fit. A frame with N columns holds N
   times its own height of single-column text.
4. `overflow` is reported back, the last frame's chrome turns red, and the text
   that fits nowhere is appended there anyway - **text is never destroyed**.

Caret position is preserved across a reflow by character offset
(`caretOffsetIn` / `setCaretOffset`), which is what lets you keep typing while the
text is moving between frames underneath you.

`src/lib/frames.ts` is the other half of the model: turning stored documents into
frames - loading a saved `boxes` list (remapping ids, promoting an image saved
inside a text frame, keeping a deliberate full-page frame whole) or splitting
flat legacy HTML into one frame per element with real measured heights.

---

## Codebase map

```
src/
  main.tsx                 React entrypoint
  index.css                Tailwind layers, global editor CSS, print CSS, @font-face
  App.tsx                  App shell: state, commands, shortcuts, persistence
  lib/
    textbox.ts             Frame model + story-flow engine (recompose/flow/caret)
    frames.ts              Document → frames (saved boxes, or split legacy HTML)
    boxState.ts            How a frame is written down and read back (undo + save)
    master.ts              Master pages: masters, assignment, bands, Tab stops, fields
    format.ts              The .bulletin file format (serialize / parse / download)
    storage.ts             localStorage: recent docs, versions, purge, media offload
    mediaStore.ts          IndexedDB: pictures and imported PDFs, asset refs
    pdfStore.ts            PDF import: count pages with pdfjs, store the file, resolve it
    merge.ts               Merging parts into an issue + the Page of Contents
    frameStyle.ts          A frame's standard type; sanitising pasted/borrowed type
    paragraphStyles.ts*    Named house paragraph styles
    longWords.ts           Cutting a word wider than its column, with a hyphen
    marker.ts              The end-of-piece marker's geometry and corner rule
    editor.ts              contentEditable command layer (exec, styles, tracking)
    router.ts              Tiny history router ("/" and "/guide")
    fuzzy.ts               Fuzzy matching for the home screen's search box
    snapping.ts            Frame snapping geometry (present, not yet wired up)
  components/
    DocumentCanvas.tsx     The editor: sheets, frames, ruler, pages pane, master view
    PageSidebar.tsx        The pages pane (thumbnails, drag-reorder, page menu)
    LayersPanel.tsx        Front-to-back list of the current sheet's frames
    TextBoxFrame.tsx       A text frame (selection, drag, resize, column chrome)
    MenuBar.tsx            The seven menus, grid picker, symbol panel, menu search
    Toolbar.tsx            Formatting toolbar (style, font, size, B/I/U, columns…)
    MasterSection.tsx      The Master Page ribbon + its dialogs
    MergeDialog.tsx        Pick, order and merge .bulletin files
    HomeScreen.tsx         Templates, recents, Import / Merge / Guide
    GuideScreen.tsx        /guide - the Design Bible walkthrough
    Feedback.tsx           Toasts and confirm dialogs (useFeedback)
    GoogleFontProvider.tsx Lazy <link> injection for Google Fonts
  data/
    templates/*.html       One file per bulletin page
    templates/index.ts     The template manifest (frames, master, type)
    designGuide.ts         Design Bible 2.0 as data
    paragraphStyles.ts     The house paragraph styles
    localFonts.ts          The four house typefaces
    googleFonts.ts         Generated full Google Fonts catalogue (1,900+ families)
scripts/build-fonts.mjs    Regenerates src/data/googleFonts.ts
tests/                     Round-trip tests for a frame (`npm test`)
public/fonts/              Biome, Franklin Gothic, Aparajita, Dreaming Outloud Script
public/logo.webp           The masthead mark
```

`*` `src/data/paragraphStyles.ts`; kept in `data/` because it is content, not
logic.

---

## Working on the code

### Conventions this codebase actually follows

- **Domain logic in `lib`, pixels in `components`.** If a function would be
  useful to the Merge tool, it belongs in `lib` - and `lib` must not import from
  `components`.
- **One model, one definition.** Frames, masters and the file format each have a
  single source of truth; nothing re-declares them.
- **Comment the *why*.** The existing code explains the reason a rule exists
  (usually a bug that was fixed) rather than restating what the line does. Keep
  that: e.g. *"the markers had to move below the fold because …"*.
- **Fail soft at the edges, never in the middle.** Storage, media and parsing all
  swallow their own failures and return a safe default, because the alternative
  is losing someone's document.
- **No native dialogs.** `useFeedback()` for anything the user must know or
  confirm.
- **`npm run build` before you call it done.** It type-checks the whole project.

### Tests

```bash
npm test
```

One suite, `tests/boxState.test.mjs`, guarding one thing: **a frame field cannot
be written by one serializer and dropped by another.** A frame leaves the canvas
through two doors - the undo stack and the saved document - and returns through
two more (`boxFromHistory` and `buildModel`). Each of those four places used to
spell out its own field list, and the lists drifted in silence: the undo stack
recorded a frame's column rule before its rebuild could read it, and the rebuild
learned to read the frame's alignment before the stack had ever recorded it.
Neither half looked wrong on its own; a real frame lost its rule on the next
Ctrl+Z.

So the shape lives in `src/lib/boxState.ts`, once, and the suite pushes a frame
carrying *every* field through both round trips:

1. `FRAME_FIELDS` in `src/lib/boxState.ts` is checked against `TextBox` **by the
   TypeScript build** - add a field to a frame and `npm run build` fails until it
   is listed (or exempted as deliberately unsaved).
2. The tests fail until that field actually survives a save/reload *and* an
   undo, and until nothing invents a value for a field that was never set.

The suite runs on Node's own test runner through Vite's module loader, so there
is no test framework to install: Vite is already here, and it is what makes the
bundler-style imports and TypeScript readable outside the browser. The only DOM
call the code under test makes is stubbed at the top of the file.

### Adding a template page

1. Add `src/data/templates/bulletin-<name>.html` - the page's HTML, either flat
   blocks or elements carrying `data-frame="x,y,w,h"`.
2. Add an entry to `src/data/templates/index.ts`: `id`, `name`, `blurb`, the
   `content` import, `frame` (columns / width / text standard), `master` (header
   and footer furniture), and `layout: true` if the HTML declares frames.
3. It appears in the Home-screen picker, in the search index and in Merge's
   classification automatically.

### Adding a master-page field

`src/lib/master.ts` → add the token to `MASTER_TOKENS`, resolve it in
`fillMasterTokens`, and surface it (the master panel's field chips and the
ribbon's Insert buttons both read from those two places).

### Adding a menu command

Add the item to the right menu in `components/MenuBar.tsx`, then handle its id in
`App.run()` (or a prefix of it). Check it end to end: a menu item with no handler
is invisible dead weight - four of them hid in plain sight until a sweep compared
every declared id against every handled one.

### Updating the Google Fonts catalogue

```bash
curl -sSL "https://fonts.google.com/metadata/fonts" -o gf-raw.json
node scripts/build-fonts.mjs     # regenerates src/data/googleFonts.ts
rm gf-raw.json
```

The font picker lazy-loads a `fonts.googleapis.com` stylesheet per family via
`GoogleFontProvider`, so a family is only downloaded when it is chosen (and
preloaded on hover).

---

## Printing, fonts and offline behaviour

- **Printing** uses the browser's own dialog (`Ctrl+P`) against a print
  stylesheet: the chrome (`no-print`) is hidden, the sheet loses its shadow and
  zoom transform, and one sheet becomes one printed page. An imported PDF is
  embedded as the *original vector file* through the browser's own viewer rather
  than flattened to images, so its text and line art stay selectable on screen
  and come out as real text on paper - printing one is the browser's viewer's
  job, and that is the one piece of a sheet the app does not lay out itself.
- **Fonts**: the four house typefaces live in `public/fonts` and are declared with
  `local(…)` first in `@font-face`, so an installed copy is used with no download
  at all. Everything else is Google Fonts, on demand.
- **Offline**: the app is a static bundle and works offline except for Google
  Fonts and the dictionary lookup (a plain link to Google's dictionary, which
  opens in a new tab). Spelling and grammar use the browser's built-in
  spellchecker.

---

## Known limitations

- **No cloud, no accounts, no sharing.** Documents live in this browser.
  `Download` is the only way to move one.
- **Tailwind's 500 kB chunk warning** on `npm run build` is expected: the app is
  one bundle plus the PDF worker. Code-splitting the PDF import would be the
  first improvement.
- **`src/lib/snapping.ts`** implements margin / centre / gutter / neighbour
  snapping geometry that nothing imports yet - the frames do not snap while
  dragging. It is finished work waiting for an owner, not dead code.
- **Imported PDF pages print through the browser's PDF viewer.** Keeping the
  file vector is what makes its text selectable, so how faithfully it lands on
  paper is the viewer's business, not ours: if a page must be flattened, print
  the PDF separately, or take a screenshot and place it as an image.
- **Word count and spellcheck** are the browser's; there is no translation
  service, because that would need a paid API or a sign-up.
- **Breaking a long word needs no dictionary here.** The pill's
  break-long-words button writes `overflow-wrap: break-word` on the paragraphs
  the selection touches (body frames declare it in their standard, so it
  survives a wholesale paste), and the canvas then cuts any word wider than the
  column with a real hyphen and continues it on the next line - see
  `src/lib/longWords.ts`. It does *not* use the browser's linguistic
  hyphenation (`hyphens: auto`), which needs a dictionary the engine may not
  ship; a soft hyphen is a break opportunity every engine honours. The breaks
  are re-decided on every layout pass, so widening a frame or turning the
  setting off heals the text back.
- **The words break at the furthest character that fits, not at syllables.**
  There is no hyphenation dictionary in the bundle, so `extra&#8209;ordinary`
  cannot break `extra-` at the syllable - it breaks where the measure runs out,
  which is what "cut off with a hyphen" means in practice.
