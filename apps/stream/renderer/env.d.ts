/// <reference types="vite/client" />

import type { StreamAPI } from '../shared/desktop-api';

declare global {
  interface Window {
    streamApi: StreamAPI;
  }
}

export {};
