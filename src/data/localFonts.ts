/**
 * Locally bundled / locally installed fonts — the families that sit at the top
 * of the font picker and are not on Google Fonts.
 *
 * Hand-written on purpose: `googleFonts.ts` is regenerated from Google's
 * metadata API, and this list must survive that. `scripts/build-fonts.mjs`
 * re-exports it from there so existing imports keep working.
 *
 * Keep the array sorted by `family`. These entries are pinned above the Google
 * fonts in the picker (which arrive already alphabetical), so an unsorted block
 * here is the only place the dropdown can read out of order — that is exactly
 * how the Franklin Gothic weights ended up as Gothic, Book, Medium, Demi, Heavy.
 *
 * Every family here needs a matching `@font-face` in `src/index.css` (they live
 * in `public/fonts`, referenced as `local(...)` first, bundled file second).
 */
import type { FontCategory } from './googleFonts';

export interface LocalFont {
  family: string;
  category: FontCategory;
}

export const LOCAL_FONTS: LocalFont[] = [
  { family: 'Aparajita', category: 'serif' },
  { family: 'Biome', category: 'display' },
  { family: 'Dreaming Outloud Script', category: 'handwriting' },
  { family: 'Dreaming Outloud Script Pro', category: 'handwriting' },
  { family: 'Franklin Gothic', category: 'sans-serif' },
  { family: 'Franklin Gothic Book', category: 'sans-serif' },
  { family: 'Franklin Gothic Demi', category: 'sans-serif' },
  { family: 'Franklin Gothic Heavy', category: 'sans-serif' },
  { family: 'Franklin Gothic Medium', category: 'sans-serif' },
];

export const LOCAL_FONT_FAMILIES: string[] = LOCAL_FONTS.map((f) => f.family);
