/// <reference types="vite/client" />

declare global {
  interface LocalFontData {
    family: string;
    fullName: string;
    postscriptName: string;
    style: string;
  }

  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

export {};
