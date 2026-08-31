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
  index.css                     # Tailwind + global styles
  data/
    googleFonts.ts              # Auto-generated full Google Fonts catalog
  components/
    MenuBar.tsx                 # File / Edit / View / Insert / Format / Tools / Extensions / Help
    Toolbar.tsx                 # Formatting toolbar (search, undo/redo, font, etc.)
    DocumentCanvas.tsx          # Page area + quick-start templates panel
    LeftSidebar.tsx             # Document tabs panel
    RightRail.tsx               # Right-side icon rail (chat, search, etc.)
    GoogleFontProvider.tsx      # Lazy-loads Google Fonts <link> tags on demand
scripts/
  build-fonts.mjs               # Fetches the full Google Fonts metadata and
                                # regenerates src/data/googleFonts.ts
```

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
