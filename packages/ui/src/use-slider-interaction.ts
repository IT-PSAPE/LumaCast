import type { RefObject } from 'react';
import type { Slider as BaseSlider } from '@base-ui/react/slider';
import { useSliderPointer } from './use-slider-pointer';
import { sliderThumbFocusStyles } from './use-slider-focus';

export interface SliderInteractionOptions {
  value: number;
  /** Fires continuously while dragging or stepping. */
  onValueChange: (value: number) => void;
  /** Fires once on pointer release or keyboard settle. */
  onCommit?: (value: number) => void;
  /** Clears an in-progress pointer draft when the interaction is cancelled. */
  onCancel?: () => void;
  min?: number;
  max?: number;
  step?: number;
  largeStep?: number;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
  /** Prevents edits during temporary unavailability while retaining focus. */
  readOnly?: boolean;
  /** Changing the editing identity cancels a gesture without remounting. */
  interactionKey?: string;
  /** Outside marks stay clear of arbitrary colors inside a colored thumb. */
  focusRing?: 'inset' | 'outside';
}

type RootProps = Pick<BaseSlider.Root.Props<number>,
  'value' | 'min' | 'max' | 'step' | 'largeStep' | 'orientation' | 'disabled' | 'aria-disabled' | 'onValueChange' | 'onValueCommitted'>;
type ControlProps = Pick<BaseSlider.Control.Props,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onTouchStartCapture' | 'onKeyDownCapture' | 'onBlurCapture' | 'style'>;
type ThumbProps = Pick<BaseSlider.Thumb.Props, 'inputRef' | 'onPointerDown'> & {
  ref: RefObject<HTMLDivElement | null>;
  'data-dragging': '' | undefined;
};

const outsideFocusStyles = 'has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-focus-ring has-[input:focus-visible]:outline-offset-2 forced-colors:has-[input:focus-visible]:outline-[Highlight]';

/**
 * Complete scalar Base UI wiring. Spread these authority bundles after visual
 * and ARIA props, without replacing their handlers or refs. Attach measurementRef
 * to the actual travel surface (a Track or a full-surface Control), and apply
 * focusClassName to the visible ancestor of the existing native input.
 */
export function useSliderInteraction({
  value, onValueChange, onCommit, onCancel,
  min = 0, max = 100, step = 1, largeStep = 10, orientation = 'horizontal',
  disabled = false, readOnly = false, interactionKey, focusRing = 'inset',
}: SliderInteractionOptions) {
  const pointer = useSliderPointer({ value, min, max, step, orientation, disabled, readOnly, interactionKey, onValueChange, onCommit, onCancel });
  const rootProps: RootProps = {
    value, min, max, step, largeStep, orientation, disabled,
    'aria-disabled': readOnly || undefined,
    onValueChange(next, details) {
      if (!pointer.permitsDiscrete(details.event)) { details.cancel(); return; }
      pointer.cancel();
      onValueChange(next);
    },
    onValueCommitted: onCommit ? (next, details) => {
      if (pointer.permitsDiscrete(details.event)) onCommit(next);
    } : undefined,
  };
  const controlProps: ControlProps = { ...pointer.controlHandlers, style: { touchAction: 'none' } };
  const thumbProps: ThumbProps = {
    ref: pointer.thumbRef,
    inputRef: pointer.inputRef,
    onPointerDown: (event) => event.preventBaseUIHandler(),
    'data-dragging': pointer.dragging ? '' : undefined,
  };
  return {
    rootProps, controlProps, thumbProps,
    measurementRef: pointer.trackRef,
    focusClassName: pointer.pointerFocus ? undefined : focusRing === 'outside' ? outsideFocusStyles : sliderThumbFocusStyles,
  };
}
