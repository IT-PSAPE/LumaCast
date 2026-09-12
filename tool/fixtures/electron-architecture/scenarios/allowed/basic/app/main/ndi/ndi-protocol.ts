export type NdiHostCommand = { type: string };
export type NdiHostEvent = { type: string };
export interface NdiServiceLike {
  send(): void;
}