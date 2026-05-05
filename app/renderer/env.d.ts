/// <reference types="vite/client" />
import type { MainApi } from '@core/ipc';

declare global {
  interface LocalFontData {
    family: string;
    fullName: string;
    postscriptName: string;
    style: string;
  }

  interface Window {
    castApi: MainApi;
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

export {};
