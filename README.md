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
    GuideScreen.tsx             # /guide — pick a part of the issue to edit
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
| `/guide` | The Design Bible picker — choose a part of the issue and start editing it |

## Merging an issue

Home screen → **Merge** → pick two or more `.bulletin` files. Each file is
classified as cover / contents / article / poem / graphic / puzzle / end page,
you can reorder them, and Merge produces one document with the cover at the
front, the end page at the bottom and a generated **Page of Contents**. An
imported contents page is used instead of generating a second one.

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
