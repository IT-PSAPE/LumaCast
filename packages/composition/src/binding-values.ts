export interface BindingValue {
  currentSlideText: string | null;
  nextSlideText: string | null;
  slideNotes: string | null;
  talkScriptCurrent: string | null;
  talkScriptProgress: string | null;
  armedAtMs: number | null;
}

export type BindingOverride = Partial<BindingValue>;
