/**
 * Named paragraph styles driven by the Baulko Bulletin Design Bible 2.0.
 *
 * Provides authoritative definitions for each role in the publication,
 * enabling the Toolbar style picker, design guide walkthrough, and
 * consistent formatting across all frames.
 */

export interface ParagraphStyleDef {
  id: string;
  label: string;
  role: string;
  font: string;
  fontFamily: string;
  size: string;
  fontSizePt: number;
  colour: string;
  italic?: boolean;
  bold?: boolean;
  lineHeight: number;
  align: 'left' | 'center' | 'right' | 'justify';
  description: string;
}

export const BULLETIN_PARAGRAPH_STYLES: ParagraphStyleDef[] = [
  {
    id: 'title',
    label: 'Title',
    role: 'Headline / Title',
    font: 'Franklin Gothic Heavy',
    fontFamily: "'Franklin Gothic Heavy','Libre Franklin',Arial,sans-serif",
    size: '48pt',
    fontSizePt: 48,
    colour: '#3f3f3f',
    bold: true,
    lineHeight: 1.05,
    align: 'center',
    description: 'Franklin Gothic Heavy 48pt, centred headline',
  },
  {
    id: 'byline',
    label: 'Byline',
    role: 'Author Byline',
    font: 'Arial',
    fontFamily: 'Arial,Helvetica,sans-serif',
    size: '18pt',
    fontSizePt: 18,
    colour: '#808080',
    lineHeight: 1.3,
    align: 'center',
    description: 'Arial 18pt grey, centred under title',
  },
  {
    id: 'body',
    label: 'Body',
    role: 'Main Body Copy',
    font: 'Roboto Condensed',
    fontFamily: "'Roboto Condensed',Calibri,'Carlito','Segoe UI',Arial,sans-serif",
    size: '13pt',
    fontSizePt: 13,
    colour: '#262626',
    lineHeight: 1.45,
    align: 'justify',
    description: 'Roboto Condensed 13pt justified, two columns',
  },
  {
    id: 'pull-quote',
    label: 'Pull-quote',
    role: 'Callout / Pull-quote',
    font: 'Corbel',
    fontFamily: "Corbel,'Segoe UI',Arial,sans-serif",
    size: '24pt',
    fontSizePt: 24,
    colour: '#3f3f3f',
    italic: true,
    lineHeight: 1.3,
    align: 'center',
    description: 'Corbel 24pt italic, centred with quotes',
  },
  {
    id: 'credit',
    label: 'Artwork credit',
    role: 'Image / Artist Credit',
    font: 'Aparajita',
    fontFamily: "Aparajita,'Segoe UI',serif",
    size: '18pt',
    fontSizePt: 18,
    colour: '#999999',
    italic: true,
    lineHeight: 1.3,
    align: 'center',
    description: 'Aparajita 18pt italic grey, centred',
  },
  {
    id: 'running-head',
    label: 'Running head',
    role: 'Master Folio / Running Head',
    font: 'Biome',
    fontFamily: "Biome,'Red Hat Text',Arial,sans-serif",
    size: '18pt',
    fontSizePt: 18,
    colour: '#262626',
    lineHeight: 1.2,
    align: 'right',
    description: 'Biome 18pt right-aligned folio & header',
  },
  {
    id: 'contents-entry',
    label: 'Contents entry',
    role: 'Page of Contents item',
    font: 'Franklin Gothic Heavy',
    fontFamily: "'Franklin Gothic Heavy','Libre Franklin',Arial,sans-serif",
    size: '18pt',
    fontSizePt: 18,
    colour: '#3f3f3f',
    bold: true,
    lineHeight: 1.25,
    align: 'center',
    description: 'Franklin Gothic Heavy 18pt, centred',
  },
  {
    id: 'precursory',
    label: 'Precursory note',
    role: 'Trigger / Warning note',
    font: 'Times New Roman',
    fontFamily: "'Times New Roman',Times,serif",
    size: '13pt',
    fontSizePt: 13,
    colour: '#595959',
    italic: true,
    lineHeight: 1.35,
    align: 'center',
    description: 'Times New Roman 13pt italic',
  },
  {
    id: 'normal',
    label: 'Normal text',
    role: 'Standard Text',
    font: 'Roboto Condensed',
    fontFamily: "'Roboto Condensed','Red Hat Text',system-ui,sans-serif",
    size: '11pt',
    fontSizePt: 11,
    colour: '#2b2622',
    lineHeight: 1.5,
    align: 'left',
    description: 'Standard 11pt unstyled copy',
  },
];

export function getParagraphStyle(id: string): ParagraphStyleDef | undefined {
  return BULLETIN_PARAGRAPH_STYLES.find((s) => s.id === id || s.label.toLowerCase() === id.toLowerCase());
}
