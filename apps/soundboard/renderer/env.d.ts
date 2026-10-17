/// <reference types="vite/client" />

import type { SoundboardAPI } from "../shared/desktop-api";

declare global {
  interface Window {
    soundboard: SoundboardAPI;
  }
}

export {};
