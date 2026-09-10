// One-off script: convert the raw google-fonts metadata JSON
// (`curl https://fonts.google.com/metadata/fonts`) into a clean
// TypeScript file with the full family list and categories.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const raw = JSON.parse(readFileSync(resolve(ROOT, 'gf-raw.json'), 'utf-8'));
const families = Array.isArray(raw?.familyMetadataList) ? raw.familyMetadataList : [];

// Map Google Fonts category strings to our enum
const CATEGORY_MAP = {
  'sans-serif': 'sans-serif',
  'serif': 'serif',
  'display': 'display',
  'handwriting': 'handwriting',
  'monospace': 'monospace',
};

const seen = new Set();
const cleaned = [];
for (const f of families) {
  if (!f?.family) continue;
  if (seen.has(f.family)) continue;
  seen.add(f.family);
  const cat = CATEGORY_MAP[f.category] ?? 'sans-serif';
  cleaned.push({ family: f.family, category: cat });
}

cleaned.sort((a, b) => a.family.localeCompare(b.family));

const out = `// AUTO-GENERATED from https://fonts.google.com/metadata/fonts
// Contains ${cleaned.length} Google Fonts. Do not edit by hand — regenerate via scripts/build-fonts.mjs.
export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';

export interface GoogleFont {
  family: string;
  category: FontCategory;
}

export const GOOGLE_FONTS: GoogleFont[] = ${JSON.stringify(cleaned, null, 2)};

export const GOOGLE_FONT_FAMILIES: string[] = GOOGLE_FONTS.map(f => f.family);

/** Locally bundled / locally installed fonts. Hand-written in
    \`./localFonts.ts\` so regenerating this file does not lose them. */
export { LOCAL_FONTS } from './localFonts';
`;

writeFileSync(resolve(ROOT, 'src/data/googleFonts.ts'), out, 'utf-8');
console.log(`Wrote ${cleaned.length} fonts to src/data/googleFonts.ts`);
