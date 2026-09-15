# Bulletin Formatter

A web-based desktop-publishing editor in the style of Google Docs, intended as a
Microsoft Publisher replacement. The toolbar mirrors the layout of Google Docs
and the font selector supports the **full Google Fonts catalog** (over 1,900
families), loaded on demand.

## Stack

- **Vite 5** + **React 18** + **TypeScript**
- **Tailwind CSS 3** for styling
- **Lucide React** for icons (no Material icons)

## Project structure

```
src/
  App.tsx                       # Top-level layout + editor state
  main.tsx                      # React entrypoint
  index.css                     # Tailwind + global styles + house @font-face rules
  data/
    googleFonts.ts              # Auto-generated full Google Fonts catalog
    localFonts.ts               # Hand-written house fonts (not on Google Fonts)
    designGuide.ts              # Design Bible 2.0, as data (one entry per page)
    templates/                  # One .html file per bulletin page
  lib/
    router.ts                   # Tiny history router (only route: /guide)
    merge.ts                    # Merges several .bulletin files into one issue
    master.ts                   # Master pages (running head + folio)
    format.ts                   # The .bulletin file format
  components/
    MenuBar.tsx                 # File / Edit / View / Insert / Format / Tools / Extensions / Help
    Toolbar.tsx                 # Formatting toolbar (search, undo/redo, font, etc.)
    DocumentCanvas.tsx          # Page area, text/image boxes, master-page view
    HomeScreen.tsx              # Templates, recents, Import / Merge / Guide
    GuideScreen.tsx             # /guide - pick a part of the issue to edit
    MergeDialog.tsx             # Merge several .bulletin files
    MasterSection.tsx           # Publisher-style Master Pages ribbon
    GoogleFontProvider.tsx      # Lazy-loads Google Fonts <link> tags on demand
scripts/
  build-fonts.mjs               # Fetches the full Google Fonts metadata and
                                # regenerates src/data/googleFonts.ts
public/fonts/                   # The four house typefaces
```

## Routes

| Path     | What it is |
| -------- | ---------- |
| `/`      | Home screen (templates, recents) and the editor |
| `/guide` | The Design Bible walkthrough - pick a part of the issue for numbered steps, then start editing it |

## Merging an issue

Home screen → **Merge** → pick two or more `.bulletin` files. Each file is
classified as cover / contents / article / poem / graphic / puzzle / end page,
you can reorder them, and Merge produces one document with the cover at the
front, the end page at the bottom and a generated **Page of Contents** - one
sheet, or two once an issue has more than fourteen parts. An imported contents
page is used instead of generating one.

## Templates

Each row of the Home-screen picker is one page of the Design Bible, and opening
one starts a new document that already has its frames, columns and master page
in place:

| Template | What it opens as |
| -------- | ---------------- |
| Blank page | An empty sheet (the big **+** card) |
| Title page | One full-bleed image frame - drop the cover artwork in |
| Editorial | Title, the news icon as its own movable image box, and the letter in a text box |
| Page of contents | A title, a separate movable rule, and one two-column list box |
| Article | Start page, four two-column continuation sheets, one extras sheet |
| Puzzle | A single full-page puzzle frame |
| Poem | One column, ending in the end-of-piece marker |
| Graphic | Title, byline, click-to-add art frame (never cropped) and credit - no subtitle |
| End page | Separate thanks / credit / message / card / website boxes and a two-column credits box |

Some pages declare their frames in the HTML itself with `data-frame="x,y,w,h"`
(the `layout` flag on the template): each top-level element opens as its own
object - a text box, a columned text box (`data-columns`), an orange rectangle
(`data-kind="shape"`, `data-fill`, `data-radius`) or a movable rule
(`data-kind="line"`, `data-stroke`, `data-thickness`). A frame may also declare
its **standard text type** with `data-text="font-size:13pt;line-height:1.45"`
and the alignment that governs text with none of its own with `data-align`;
a sheet laid out as bare blocks declares the same type through the manifest's
`text`. The standard is what plain text in the frame falls back to, and what a
wholesale retype (Ctrl+A, then type) adopts - the contents list's entries are
18pt so the list reads from the back of the room, but selecting the lot and
retyping it used to inherit that 18pt all the way down, overflow the frame and
turn its chrome red. Now the replacement comes back as house body type with the
design's spacing and its runs (bold numbers, italic credits) intact. The same
markup paints the Home-screen thumbnail and opens as the live, draggable frames.

A full-page image frame (the title page and the puzzle) is a fixed A4 window:
inserting a picture crops it to the sheet instead of shrinking it inside the
margins. Frames marked `data-fit="contain"` (the graphic page) show the whole
picture instead. **Insert ▸ Shape** drops an orange rectangle and **Insert ▸
Line** a free-standing rule - both are page objects, moved and resized like a
picture. New documents start in **Roboto Condensed**, the bulletin's body face.

The editorial, article, poem, graphic and end page open with the end-of-piece
**marker** already switched on (Tools ▸ Preferences); the title page, contents
and puzzle do not. The marker is *pinned furniture*, not a placed object: it
always sits outside the master page's frame in the sheet's bottom-right corner,
is never dragged, and is drawn above the content. A document saved when a
template put one elsewhere (the poem used to centre it under the stanzas) is
snapped into the corner when it opens.

## Undo, zoom and naming

The document canvas keeps its **own undo history** (Ctrl+Z / Ctrl+Shift+Z or
Ctrl+Y, the menu, or the toolbar buttons). The browser's native undo cannot be
relied on here: each text frame is an uncontrolled `contentEditable`, so the
native stack is lost whenever a frame is re-seeded, and it can never undo a
moved frame, a column change or a deleted box. Steps are coalesced - a typing
burst or a drag is one step.

**Zoom** has a slider in the status bar under the sheet and another on the Home
screen (which sizes the template and recent-document cards). Renaming a document
is just typing: **Enter** in the title field, or in a recents card, sets the
name; Escape or clicking away does the same.

## Offline behaviour

The app is a static bundle: documents live in `localStorage` and are exported as
`.bulletin` files, so **Download** is the only sharing verb (there is no server
to hand a link to). Two features reach the network, and neither needs an account
or an API key:

- **Google Fonts** - `GoogleFontProvider` injects a `fonts.googleapis.com`
  stylesheet per family. The four house typefaces in `public/fonts` are local.
- **Tools ▸ Dictionary** - a plain link to Google's dictionary search, which
  opens in a new tab. There is no dictionary service bundled with the app.

Spelling and grammar use the browser's built-in spellchecker. There is no
translation service: a feature that would need a paid API or a sign-up is not in
the menus.

## House typefaces

`Biome`, `Franklin Gothic` (Book / Medium / Demi / Heavy, each with an italic),
`Aparajita` (regular / italic / bold / bold-italic) and `Dreaming Outloud
Script` live in `public/fonts` and are listed at the top of the font picker via
`src/data/localFonts.ts`. Each `@font-face` in `src/index.css` names
`local(...)` first, so an installed copy is used with no download at all.

To install them for Microsoft 365 and other Windows apps, right-click each file
in `public/fonts` and choose *Install* (or *Install for all users*).

## Scripts

```bash
npm install      # install deps
npm run dev      # start Vite dev server on http://localhost:5173
npm run build    # type-check + build production bundle to dist/
npm run preview  # preview the production build
```

## Updating the Google Fonts catalog

The bundled list is generated from the official
`https://fonts.google.com/metadata/fonts` endpoint:

```bash
curl -sSL "https://fonts.google.com/metadata/fonts" -o gf-raw.json
node scripts/build-fonts.mjs
rm gf-raw.json
```

This regenerates `src/data/googleFonts.ts` with every family currently
published, grouped by category (`sans-serif`, `serif`, `display`,
`handwriting`, `monospace`).

## How the font selector works

When you pick a family in the toolbar, `GoogleFontProvider` injects a
`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">` into
`<head>`. The link is cached per family, so selecting a font again is instant.
On hover, the font is preloaded so the preview is rendered in the right
typeface.

If the family is not a Google Font (e.g. `Arial`, `Helvetica`), the provider
falls back to the system font of the same name.
