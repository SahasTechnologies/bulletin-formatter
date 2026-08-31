import { createContext, useContext, useMemo } from 'react';
import { GOOGLE_FONT_FAMILIES } from '../data/googleFonts';

interface GoogleFontCtx {
  /** Returns a stylesheet <link> element for a given Google Font family, or
   *  null if it's not a Google Font. Injects it once and reuses the cached
   *  tag. */
  loadFont: (family: string) => HTMLLinkElement | null;
  isGoogleFont: (family: string) => boolean;
}

const Ctx = createContext<GoogleFontCtx | null>(null);

// Set of names we know are Google Fonts (lower-cased comparison).
const GFSET = new Set(GOOGLE_FONT_FAMILIES.map((f) => f.toLowerCase()));

export function GoogleFontProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<GoogleFontCtx>(() => {
    const cache = new Map<string, HTMLLinkElement>();
    return {
      isGoogleFont: (family: string) => GFSET.has(family.toLowerCase()),
      loadFont: (family: string) => {
        if (!GFSET.has(family.toLowerCase())) return null;
        const key = family;
        if (cache.has(key)) return cache.get(key)!;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        // No weight axis: requesting specific weights is unnecessary (the
        // browser synthesises bold/italic when a family lacks them) and keeps
        // the URL valid for every one of the 1,946 families.
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`;
        link.dataset.font = family;
        document.head.appendChild(link);
        // Force the download immediately so text never lingers on a fallback.
        document.fonts?.load(`400 16px "${family}"`).catch(() => {
          /* non-fatal: the <link> alone is enough */
        });
        cache.set(key, link);
        return link;
      },
    };
  }, []);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGoogleFont(): GoogleFontCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGoogleFont must be used inside <GoogleFontProvider>');
  return ctx;
}
