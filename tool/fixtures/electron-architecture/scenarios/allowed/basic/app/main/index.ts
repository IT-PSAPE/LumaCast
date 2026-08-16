import { register } from './ipc';
import { readStore } from '@database/store';

export function start(): void {
  register();
  readStore();
}