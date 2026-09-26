import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

interface FontOption {
  value: string;
  label: string;
  style: CSSProperties;
}

const FALLBACK_FAMILIES = [
  // macOS
  'Avenir Next',
  'Helvetica Neue',
  'Helvetica',
  'SF Pro Display',
  'Menlo',
  // Windows
  'Segoe UI',
  'Calibri',
  'Cambria',
  'Consolas',
  'Tahoma',
  // Cross-platform
  'Arial',
  'Verdana',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  // Linux
  'DejaVu Sans',
  'Noto Sans',
  'Ubuntu',
  'Liberation Sans',
];

export function useSystemFonts(activeFont: string): FontOption[] {
  const [families, setFamilies] = useState<string[]>(FALLBACK_FAMILIES);

  useEffect(() => {
    let cancelled = false;

    async function loadSystemFonts() {
      if (!('queryLocalFonts' in window) || typeof window.queryLocalFonts !== 'function') {
        console.warn('[useSystemFonts] queryLocalFonts API not available, using fallback list');
        return;
      }
      try {
        const localFonts = await window.queryLocalFonts();
        if (cancelled) return;
        const uniqueFamilies = Array.from(new Set(localFonts.map((font) => font.family).filter(Boolean)));
        if (uniqueFamilies.length > 0) {
          uniqueFamilies.sort((a, b) => a.localeCompare(b));
          setFamilies(uniqueFamilies);
        }
      } catch (error) {
        console.warn('[useSystemFonts] queryLocalFonts failed:', error);
      }
    }

    void loadSystemFonts();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const nextFamilies = new Set(families);
    if (activeFont) nextFamilies.add(activeFont);
    return Array.from(nextFamilies)
      .sort((a, b) => a.localeCompare(b))
      .map((family) => ({ value: family, label: family, style: { fontFamily: family } }));
  }, [activeFont, families]);
}
