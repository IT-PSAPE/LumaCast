import { ChevronDown, ChevronUp, Pause, Play, Plus, Square, Volume2, VolumeX, X } from 'lucide-react';
import { Checkbox, NumberField, ReacstButton, Select, Slider, Textarea, TextField, type SelectOption } from '@lumacast/ui';
import { canReferenceScene } from '../../shared/scene-reference-graph';
import { textFontFamiliesForPlatform, type DesktopAudioCaptureMode, type StreamPlatform } from '../../shared/platform-capabilities';
import { sourceIcon, supportsSourceTransform } from '../source-ui';
import type { InputCaptureKind, InputDeviceOption } from '../features/capture/helpers';
import {
  AUDIO_TRACKS,
  CAMERA_FRAME_RATE_OPTIONS,
  CAMERA_RESOLUTION_OPTIONS,
  type AudioFilters,
  type AudioMonitoring,
  type AudioTrack,
  type CameraFrameRatePreset,
  type CaptureCursorMode,
  type ChromaKeyFilter,
  type SourceCrop,
  type SourceFilters,
  type StreamProject,
  type StreamScene,
  type StreamSource,
  type StreamTextStyle,
} from '../../shared/desktop-api';

const CURSOR_OPTIONS: ReadonlyArray<SelectOption<CaptureCursorMode>> = [
  { value: 'always', label: 'Always' },
  { value: 'motion', label: 'Only when moving' },
  { value: 'never', label: 'Never' },
];
const HORIZONTAL_ALIGN_OPTIONS: ReadonlyArray<SelectOption<StreamTextStyle['horizontalAlignment']>> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];
const VERTICAL_ALIGN_OPTIONS: ReadonlyArray<SelectOption<StreamTextStyle['verticalAlignment']>> = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
];
const MONITORING_OPTIONS: ReadonlyArray<SelectOption<AudioMonitoring>> = [
  { value: 'off', label: 'Off' },
  { value: 'monitor-only', label: 'Monitor Only' },
  { value: 'monitor-and-output', label: 'Monitor and Output' },
];
const TRANSFORM_LABELS = { x: 'Position X', y: 'Position Y', width: 'Width', height: 'Height' } as const;

const formatPx = (value: number): string => `${value}px`;
const formatPercent = (value: number): string => `${value}%`;
const formatDb = (value: number): string => `${value} dB`;
const formatMs = (value: number): string => `${value} ms`;
const formatRatio = (value: number): string => `${value}:1`;
const formatBalance = (value: number): string => (value < -2 ? 'Left' : value > 2 ? 'Right' : 'Center');
const clampInt = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.trunc(value)));

function supportsChromaKey(source: StreamSource): boolean {
  return ['display', 'window', 'camera', 'image', 'slideshow', 'browser'].includes(source.kind)
    || (source.kind === 'media' && source.mediaKind === 'video');
}

export interface SourcePropertiesProps {
  source: StreamSource;
  project: StreamProject;
  activeSceneId: string;
  referenceableScenes: StreamScene[];
  platform: StreamPlatform;
  working: boolean;
  desktopAudioMode: DesktopAudioCaptureMode;
  inputDeviceOptions: Record<InputCaptureKind, InputDeviceOption[]>;
  runtimesSnapshot: ReadonlyMap<string, MediaStream>;
  mediaElements: ReadonlyMap<string, HTMLMediaElement>;
  mediaPlaybackStates: Record<string, { paused: boolean; ended: boolean }>;
  textStyle: StreamTextStyle | null;
  filters: SourceFilters;
  crop: SourceCrop;
  chromaKey: ChromaKeyFilter;
  hasAudioMeter: boolean;
  onRemove: () => void;
  onUpdateSource: (sourceId: string, update: (source: StreamSource) => StreamSource) => void;
  onUpdateTextStyle: (sourceId: string, update: (style: StreamTextStyle) => StreamTextStyle) => void;
  onSwitchInputDevice: (source: StreamSource, deviceId: string | undefined) => void;
  onUpdateCameraCaptureSettings: (source: StreamSource, settings: Pick<StreamSource, 'cameraResolution' | 'cameraFrameRate'>) => void;
  onAddSystemAudioCapture: (targetSourceId?: string) => void;
  onOpenApplicationAudioPicker: (targetSourceId?: string) => void;
  onOpenCapturePicker: (kind: 'screen' | 'window' | 'audio', targetSourceId?: string) => void;
  onUpdateCaptureCursorMode: (sourceId: string, cursorMode: CaptureCursorMode) => void;
  onUpdateSourceTransform: (sourceId: string, key: keyof StreamSource['transform'], rawValue: string) => void;
  onFitSource: (source: StreamSource) => void;
  onCenterSource: (source: StreamSource) => void;
  onResetTransform: (source: StreamSource) => void;
  onTogglePlayback: (sourceId: string) => void;
  onRestartPlayback: (sourceId: string) => void;
  onStopPlayback: (sourceId: string) => void;
  onMoveSlideshowImage: (sourceId: string, index: number, direction: -1 | 1) => void;
  onRemoveSlideshowImage: (sourceId: string, index: number) => void;
  onAddSlideshowImage: (sourceId: string) => void;
  onUpdateBrowserAudio: (sourceId: string, enabled: boolean) => void;
  onUpdateSourceSettings: (sourceId: string, settings: Pick<StreamSource, 'volume' | 'muted'>) => void;
  onUpdateSourceMonitoring: (sourceId: string, audioMonitoring: AudioMonitoring) => void;
  onUpdateSourceAudioTrack: (sourceId: string, track: AudioTrack, enabled: boolean) => void;
  onUpdateSourceAudioFilters: (sourceId: string, filters: Partial<AudioFilters>) => void;
  onUpdateSourceFilters: (sourceId: string, filters: Partial<SourceFilters>) => void;
  onUpdateSourceCrop: (sourceId: string, crop: Partial<SourceCrop>) => void;
  onUpdateSourceChromaKey: (sourceId: string, chromaKey: Partial<ChromaKeyFilter>) => void;
}

export function SourceProperties({
  source: selectedSource,
  project,
  activeSceneId,
  referenceableScenes,
  platform,
  working,
  desktopAudioMode,
  inputDeviceOptions,
  runtimesSnapshot,
  mediaElements,
  mediaPlaybackStates,
  textStyle: selectedTextStyle,
  filters: selectedFilters,
  crop: selectedCrop,
  chromaKey: selectedChromaKey,
  hasAudioMeter,
  onRemove,
  onUpdateSource: updateSource,
  onUpdateTextStyle: updateTextStyle,
  onSwitchInputDevice,
  onUpdateCameraCaptureSettings,
  onAddSystemAudioCapture,
  onOpenApplicationAudioPicker,
  onOpenCapturePicker,
  onUpdateCaptureCursorMode,
  onUpdateSourceTransform,
  onFitSource: fitSource,
  onCenterSource: centerSource,
  onResetTransform,
  onTogglePlayback,
  onRestartPlayback,
  onStopPlayback,
  onMoveSlideshowImage: moveSlideshowImage,
  onRemoveSlideshowImage: removeSlideshowImage,
  onAddSlideshowImage: addSlideshowImage,
  onUpdateBrowserAudio: updateBrowserAudio,
  onUpdateSourceSettings: updateSourceSettings,
  onUpdateSourceMonitoring: updateSourceMonitoring,
  onUpdateSourceAudioTrack: updateSourceAudioTrack,
  onUpdateSourceAudioFilters: updateSourceAudioFilters,
  onUpdateSourceFilters: updateSourceFilters,
  onUpdateSourceCrop: updateSourceCrop,
  onUpdateSourceChromaKey: updateSourceChromaKey,
}: SourcePropertiesProps) {
  const af = selectedSource.audioFilters;
  const textStyle = selectedTextStyle;
  const patchTextStyle = (patch: Partial<StreamTextStyle>) => updateTextStyle(selectedSource.id, (style) => ({ ...style, ...patch }));
  const patchAudioFilters = (patch: Partial<AudioFilters>) => updateSourceAudioFilters(selectedSource.id, patch);
  const patchFilters = (patch: Partial<SourceFilters>) => updateSourceFilters(selectedSource.id, patch);
  const patchChromaKey = (patch: Partial<ChromaKeyFilter>) => updateSourceChromaKey(selectedSource.id, patch);
  const patchSource = (patch: Partial<StreamSource>) => updateSource(selectedSource.id, (source) => ({ ...source, ...patch }));
  const cropField = (side: keyof SourceCrop, label: string) => (
    <NumberField size="sm" label={label} labelPlacement="inline" suffix="px" min={0} max={16384} step={1} precision={0} value={selectedCrop[side]} onValueChange={(value) => updateSourceCrop(selectedSource.id, { [side]: clampInt(value, 0, 16384) })} />
  );
  const gateOff = !af?.noiseGate;
  const expanderOff = !af?.expander;
  const compressorOff = !af?.compressor;
  const gateOpen = af?.noiseGateOpenThresholdDb ?? -26;

  return (
    <div className="source-properties">
      <div className="property-heading"><span>{sourceIcon(selectedSource.kind, selectedSource.mediaKind)}{selectedSource.name}</span><ReacstButton.Icon variant="ghost" size="sm" label="Remove source" onClick={onRemove}><X /></ReacstButton.Icon></div>
      {selectedSource.kind === 'group' && <TextField size="sm" label="Group name" labelPlacement="inline" maxLength={120} commitOn="change" value={selectedSource.name} onValueChange={(name) => patchSource({ name })} />}
      {selectedSource.kind === 'scene' && <Select size="sm" label="Scene" labelPlacement="inline" value={selectedSource.referencedSceneId ?? ''} onValueChange={(sceneId) => {
        const target = project.scenes.find((scene) => scene.id === sceneId);
        if (!target || !canReferenceScene(project.scenes, activeSceneId, target.id)) return;
        patchSource({ name: target.name, referencedSceneId: target.id });
      }} options={referenceableScenes.map((scene) => ({ value: scene.id, label: scene.name }))} />}
      {(selectedSource.kind === 'camera' || selectedSource.kind === 'microphone') && <Select size="sm" label="Device" labelPlacement="inline" disabled={working} value={selectedSource.deviceId ?? ''} onValueChange={(deviceId) => onSwitchInputDevice(selectedSource, deviceId || undefined)} options={[
        ...(selectedSource.deviceId && !inputDeviceOptions[selectedSource.kind].some((device) => device.deviceId === selectedSource.deviceId) ? [{ value: selectedSource.deviceId, label: `${selectedSource.name} (Unavailable)` }] : []),
        { value: '', label: 'Default Device' },
        ...inputDeviceOptions[selectedSource.kind].map((device) => ({ value: device.deviceId, label: device.label })),
      ]} />}
      {selectedSource.kind === 'camera' && <>
        <Select size="sm" label="Resolution" labelPlacement="inline" disabled={working} value={selectedSource.cameraResolution ?? 'device-default'} onValueChange={(cameraResolution) => onUpdateCameraCaptureSettings(selectedSource, { cameraResolution })} options={CAMERA_RESOLUTION_OPTIONS} />
        <Select size="sm" label="FPS" labelPlacement="inline" disabled={working} value={selectedSource.cameraFrameRate === undefined ? '' : String(selectedSource.cameraFrameRate)} onValueChange={(rate) => onUpdateCameraCaptureSettings(selectedSource, { cameraFrameRate: rate ? Number(rate) as CameraFrameRatePreset : undefined })} options={[
          { value: '', label: 'Device Default' },
          ...CAMERA_FRAME_RATE_OPTIONS.map((rate) => ({ value: String(rate), label: `${rate} FPS` })),
        ]} />
      </>}
      {selectedSource.kind === 'desktop-audio' && !runtimesSnapshot.has(selectedSource.id) && desktopAudioMode !== 'unavailable' && <ReacstButton size="sm" disabled={working} onClick={() => desktopAudioMode === 'system-tap' ? onAddSystemAudioCapture(selectedSource.id) : onOpenCapturePicker('audio', selectedSource.id)}>Start Capture</ReacstButton>}
      {selectedSource.kind === 'application-audio' && <>
        <ReacstButton size="sm" disabled={working} onClick={() => onOpenApplicationAudioPicker(selectedSource.id)}>{runtimesSnapshot.has(selectedSource.id) ? 'Change Application' : 'Reconnect Application'}</ReacstButton>
        <TextField size="sm" label="Application path" labelPlacement="inline" readOnly value={selectedSource.applicationPath ?? ''} onValueChange={() => undefined} />
      </>}
      {(selectedSource.kind === 'display' || selectedSource.kind === 'window') && <>
        <ReacstButton size="sm" disabled={working} onClick={() => onOpenCapturePicker(selectedSource.kind === 'display' ? 'screen' : 'window', selectedSource.id)}>{runtimesSnapshot.has(selectedSource.id) ? 'Change Capture' : 'Reconnect Capture'}</ReacstButton>
        <Select size="sm" label="Capture Cursor" labelPlacement="inline" disabled={working} value={selectedSource.cursorMode ?? 'motion'} onValueChange={(cursorMode) => onUpdateCaptureCursorMode(selectedSource.id, cursorMode)} options={CURSOR_OPTIONS} />
      </>}
      {supportsSourceTransform(selectedSource) && <details className="filter-details"><summary>Transform</summary>
        <div className="source-transform-grid">
          {(['x', 'y', 'width', 'height'] as const).map((key) => <NumberField key={key} size="sm" label={TRANSFORM_LABELS[key]} disabled={selectedSource.locked} min={key === 'x' || key === 'y' ? -32768 : 1} max={32768} step={1} value={selectedSource.transform[key]} onValueChange={(value) => onUpdateSourceTransform(selectedSource.id, key, String(value))} />)}
          <NumberField size="sm" label="Rotation" disabled={selectedSource.locked} min={-180} max={180} step={1} value={selectedSource.transform.rotation ?? 0} onValueChange={(value) => onUpdateSourceTransform(selectedSource.id, 'rotation', String(value))} />
        </div>
        <div className="transform-actions"><ReacstButton size="sm" disabled={selectedSource.locked} onClick={() => fitSource(selectedSource)}>Fit to Canvas</ReacstButton><ReacstButton size="sm" disabled={selectedSource.locked} onClick={() => centerSource(selectedSource)}>Center</ReacstButton><ReacstButton size="sm" disabled={selectedSource.locked} onClick={() => onResetTransform(selectedSource)}>Reset</ReacstButton></div>
      </details>}
      {selectedSource.kind === 'text' && textStyle && <>
        <Textarea label="Text" rows={3} commitOn="change" value={selectedSource.text ?? ''} onValueChange={(text) => patchSource({ text })} />
        <Select size="sm" label="Font" labelPlacement="inline" value={textStyle.fontFamily} onValueChange={(fontFamily) => patchTextStyle({ fontFamily })} options={[...new Set([textStyle.fontFamily, ...textFontFamiliesForPlatform(platform)])].map((font) => ({ value: font, label: font }))} />
        <NumberField size="sm" label="Size" labelPlacement="inline" min={1} max={512} value={textStyle.fontSize} onValueChange={(fontSize) => patchTextStyle({ fontSize })} />
        <div className="text-style-toggles">
          <Checkbox label="Bold" checked={textStyle.bold} onCheckedChange={(bold) => patchTextStyle({ bold })} />
          <Checkbox label="Italic" checked={textStyle.italic} onCheckedChange={(italic) => patchTextStyle({ italic })} />
        </div>
        <Select size="sm" label="Align" labelPlacement="inline" value={textStyle.horizontalAlignment} onValueChange={(horizontalAlignment) => patchTextStyle({ horizontalAlignment })} options={HORIZONTAL_ALIGN_OPTIONS} />
        <Select size="sm" label="Vertical" labelPlacement="inline" value={textStyle.verticalAlignment} onValueChange={(verticalAlignment) => patchTextStyle({ verticalAlignment })} options={VERTICAL_ALIGN_OPTIONS} />
        <label className="color-property">Color<input aria-label="Text color" type="color" value={selectedSource.color ?? '#ffffff'} onChange={(event) => patchSource({ color: event.target.value })} /></label>
        <details className="filter-details text-style-details"><summary>Outline</summary>
          <Checkbox label="Enabled" checked={textStyle.outline.enabled} onCheckedChange={(enabled) => patchTextStyle({ outline: { ...textStyle.outline, enabled } })} />
          <label className="color-property">Color<input aria-label="Text outline color" type="color" disabled={!textStyle.outline.enabled} value={textStyle.outline.color} onChange={(event) => patchTextStyle({ outline: { ...textStyle.outline, color: event.target.value } })} /></label>
          <Slider size="sm" label="Width" labelPlacement="inline" min={0} max={32} disabled={!textStyle.outline.enabled} value={textStyle.outline.width} onValueChange={(width) => patchTextStyle({ outline: { ...textStyle.outline, width } })} showValue formatValue={formatPx} />
        </details>
        <details className="filter-details text-style-details"><summary>Drop Shadow</summary>
          <Checkbox label="Enabled" checked={textStyle.shadow.enabled} onCheckedChange={(enabled) => patchTextStyle({ shadow: { ...textStyle.shadow, enabled } })} />
          <label className="color-property">Color<input aria-label="Text shadow color" type="color" disabled={!textStyle.shadow.enabled} value={textStyle.shadow.color} onChange={(event) => patchTextStyle({ shadow: { ...textStyle.shadow, color: event.target.value } })} /></label>
          <Slider size="sm" label="Blur" labelPlacement="inline" min={0} max={100} disabled={!textStyle.shadow.enabled} value={textStyle.shadow.blur} onValueChange={(blur) => patchTextStyle({ shadow: { ...textStyle.shadow, blur } })} showValue formatValue={formatPx} />
          <NumberField size="sm" label="Offset X" labelPlacement="inline" min={-128} max={128} disabled={!textStyle.shadow.enabled} value={textStyle.shadow.offsetX} onValueChange={(offsetX) => patchTextStyle({ shadow: { ...textStyle.shadow, offsetX } })} />
          <NumberField size="sm" label="Offset Y" labelPlacement="inline" min={-128} max={128} disabled={!textStyle.shadow.enabled} value={textStyle.shadow.offsetY} onValueChange={(offsetY) => patchTextStyle({ shadow: { ...textStyle.shadow, offsetY } })} />
        </details>
        <details className="filter-details text-style-details"><summary>Background</summary>
          <label className="color-property">Color<input aria-label="Text background color" type="color" value={textStyle.background.color} onChange={(event) => patchTextStyle({ background: { ...textStyle.background, color: event.target.value } })} /></label>
          <Slider size="sm" label="Opacity" labelPlacement="inline" min={0} max={100} value={Math.round(textStyle.background.opacity * 100)} onValueChange={(value) => patchTextStyle({ background: { ...textStyle.background, opacity: value / 100 } })} showValue formatValue={formatPercent} />
        </details>
      </>}
      {selectedSource.kind === 'color' && <label className="color-property">Color<input type="color" value={selectedSource.color ?? '#ffffff'} onChange={(event) => patchSource({ color: event.target.value })} /></label>}
      {selectedSource.kind === 'media' && <>
        <div className="media-playback-controls">
          <ReacstButton size="sm" disabled={!mediaElements.has(selectedSource.id)} onClick={() => onTogglePlayback(selectedSource.id)}>{mediaPlaybackStates[selectedSource.id]?.paused ? <Play size={12} /> : <Pause size={12} />}{mediaPlaybackStates[selectedSource.id]?.paused ? 'Play' : 'Pause'}</ReacstButton>
          <ReacstButton size="sm" disabled={!mediaElements.has(selectedSource.id)} onClick={() => onRestartPlayback(selectedSource.id)}><Play size={12} />Restart</ReacstButton>
          <ReacstButton size="sm" disabled={!mediaElements.has(selectedSource.id)} onClick={() => onStopPlayback(selectedSource.id)}><Square size={11} />Stop</ReacstButton>
        </div>
        <Checkbox label="Loop" checked={selectedSource.loop ?? false} onCheckedChange={(loop) => patchSource({ loop })} />
        <Checkbox label="Restart playback when source becomes active" checked={selectedSource.restartPlaybackWhenActive ?? true} onCheckedChange={(restartPlaybackWhenActive) => patchSource({ restartPlaybackWhenActive })} />
        <Checkbox label="Show nothing when playback ends" checked={selectedSource.showNothingWhenPlaybackEnds ?? true} onCheckedChange={(showNothingWhenPlaybackEnds) => patchSource({ showNothingWhenPlaybackEnds })} />
      </>}
      {selectedSource.kind === 'slideshow' && <div className="slideshow-properties">
        <NumberField size="sm" label="Slide duration" labelPlacement="inline" suffix="s" min={1} max={600} value={selectedSource.slideshowIntervalSeconds ?? 5} onValueChange={(seconds) => patchSource({ slideshowIntervalSeconds: clampInt(seconds, 1, 600) })} />
        <Checkbox label="Loop" checked={selectedSource.slideshowLoop ?? true} onCheckedChange={(slideshowLoop) => patchSource({ slideshowLoop })} />
        <div className="slideshow-list" aria-label="Slideshow images">{(selectedSource.slideshowImages ?? []).map((image, index) => <div className="slideshow-image-row" key={image.assetId}>
          <span title={image.name}>{index + 1}. {image.name}</span>
          <div><ReacstButton.Icon variant="ghost" size="xs" label={`Move ${image.name} up`} disabled={index === 0} onClick={() => moveSlideshowImage(selectedSource.id, index, -1)}><ChevronUp /></ReacstButton.Icon><ReacstButton.Icon variant="ghost" size="xs" label={`Move ${image.name} down`} disabled={index === (selectedSource.slideshowImages?.length ?? 0) - 1} onClick={() => moveSlideshowImage(selectedSource.id, index, 1)}><ChevronDown /></ReacstButton.Icon><ReacstButton.Icon variant="ghost" size="xs" label={`Remove ${image.name}`} disabled={(selectedSource.slideshowImages?.length ?? 0) <= 1} onClick={() => removeSlideshowImage(selectedSource.id, index)}><X /></ReacstButton.Icon></div>
        </div>)}</div>
        <ReacstButton size="sm" fullWidth disabled={working || (selectedSource.slideshowImages?.length ?? 0) >= 100} onClick={() => addSlideshowImage(selectedSource.id)}><Plus size={12} />Add Image</ReacstButton>
      </div>}
      {selectedSource.kind === 'browser' && <TextField size="sm" label="URL" labelPlacement="inline" readOnly value={selectedSource.url ?? ''} onValueChange={() => undefined} />}
      {selectedSource.kind === 'browser' && <Checkbox label="Capture Audio" checked={selectedSource.browserAudioEnabled ?? false} onCheckedChange={(enabled) => updateBrowserAudio(selectedSource.id, enabled)} />}
      {hasAudioMeter && <div className="volume-property">
        <Slider size="sm" label="Volume" labelPlacement="inline" min={0} max={200} value={Math.round(selectedSource.muted ? 0 : selectedSource.volume * 100)} onValueChange={(value) => updateSourceSettings(selectedSource.id, { volume: value / 100, muted: false })} />
        <ReacstButton.Icon variant="ghost" size="sm" label="Mute source" pressed={selectedSource.muted} tooltip={selectedSource.muted ? 'Unmute source' : 'Mute source'} onClick={() => updateSourceSettings(selectedSource.id, { volume: selectedSource.volume, muted: !selectedSource.muted })}>{selectedSource.muted ? <VolumeX /> : <Volume2 />}</ReacstButton.Icon>
      </div>}
      {hasAudioMeter && <Slider size="sm" label="Balance" labelPlacement="inline" min={-100} max={100} fillFrom={0} value={Math.round((selectedSource.balance ?? 0) * 100)} onValueChange={(value) => patchSource({ balance: value / 100 })} showValue formatValue={formatBalance} />}
      {hasAudioMeter && <Select size="sm" label="Audio Monitoring" labelPlacement="inline" value={selectedSource.audioMonitoring ?? 'off'} onValueChange={(monitoring) => updateSourceMonitoring(selectedSource.id, monitoring)} options={MONITORING_OPTIONS} />}
      {hasAudioMeter && <details className="filter-details"><summary>Audio Tracks</summary>
        <div className="audio-track-grid">{AUDIO_TRACKS.map((track) => <Checkbox key={track} label={`Track ${track}`} checked={(selectedSource.audioTracks ?? [1]).includes(track)} onCheckedChange={(enabled) => updateSourceAudioTrack(selectedSource.id, track, enabled)} />)}</div>
      </details>}
      {hasAudioMeter && <details className="filter-details"><summary>Audio Filters</summary>
        <Slider size="sm" label="Gain" labelPlacement="inline" min={-30} max={30} step={0.5} fillFrom={0} value={af?.gainDb ?? 0} onValueChange={(gainDb) => patchAudioFilters({ gainDb })} showValue formatValue={formatDb} />
        {selectedSource.kind === 'microphone' && <Checkbox label="Neural Noise Suppression" checked={af?.noiseSuppression ?? false} onCheckedChange={(noiseSuppression) => patchAudioFilters({ noiseSuppression })} />}
        <Checkbox label="Noise Gate" checked={af?.noiseGate ?? false} onCheckedChange={(noiseGate) => patchAudioFilters({ noiseGate })} />
        <Slider size="sm" label="Gate opens" labelPlacement="inline" min={-80} max={0} disabled={gateOff} value={gateOpen} onValueChange={(noiseGateOpenThresholdDb) => patchAudioFilters({ noiseGateOpenThresholdDb })} showValue formatValue={formatDb} />
        <Slider size="sm" label="Gate closes" labelPlacement="inline" min={-80} max={gateOpen} disabled={gateOff} value={af?.noiseGateCloseThresholdDb ?? -32} onValueChange={(noiseGateCloseThresholdDb) => patchAudioFilters({ noiseGateCloseThresholdDb })} showValue formatValue={formatDb} />
        <Slider size="sm" label="Attack" labelPlacement="inline" min={1} max={100} disabled={gateOff} value={af?.noiseGateAttackMs ?? 10} onValueChange={(noiseGateAttackMs) => patchAudioFilters({ noiseGateAttackMs })} showValue formatValue={formatMs} />
        <Slider size="sm" label="Hold" labelPlacement="inline" min={0} max={1000} step={10} disabled={gateOff} value={af?.noiseGateHoldMs ?? 150} onValueChange={(noiseGateHoldMs) => patchAudioFilters({ noiseGateHoldMs })} showValue formatValue={formatMs} />
        <Slider size="sm" label="Release" labelPlacement="inline" min={10} max={1000} step={10} disabled={gateOff} value={af?.noiseGateReleaseMs ?? 250} onValueChange={(noiseGateReleaseMs) => patchAudioFilters({ noiseGateReleaseMs })} showValue formatValue={formatMs} />
        <Checkbox label="Expander" checked={af?.expander ?? false} onCheckedChange={(expander) => patchAudioFilters({ expander })} />
        <Slider size="sm" label="Threshold" labelPlacement="inline" min={-80} max={0} disabled={expanderOff} value={af?.expanderThresholdDb ?? -40} onValueChange={(expanderThresholdDb) => patchAudioFilters({ expanderThresholdDb })} showValue formatValue={formatDb} />
        <Slider size="sm" label="Ratio" labelPlacement="inline" min={1} max={10} step={0.5} disabled={expanderOff} value={af?.expanderRatio ?? 2} onValueChange={(expanderRatio) => patchAudioFilters({ expanderRatio })} showValue formatValue={formatRatio} />
        <Slider size="sm" label="Attack" labelPlacement="inline" min={1} max={100} disabled={expanderOff} value={af?.expanderAttackMs ?? 10} onValueChange={(expanderAttackMs) => patchAudioFilters({ expanderAttackMs })} showValue formatValue={formatMs} />
        <Slider size="sm" label="Release" labelPlacement="inline" min={10} max={1000} step={10} disabled={expanderOff} value={af?.expanderReleaseMs ?? 150} onValueChange={(expanderReleaseMs) => patchAudioFilters({ expanderReleaseMs })} showValue formatValue={formatMs} />
        <Checkbox label="Compressor" checked={af?.compressor ?? false} onCheckedChange={(compressor) => patchAudioFilters({ compressor })} />
        <Slider size="sm" label="Threshold" labelPlacement="inline" min={-60} max={0} disabled={compressorOff} value={af?.compressorThresholdDb ?? -18} onValueChange={(compressorThresholdDb) => patchAudioFilters({ compressorThresholdDb })} showValue formatValue={formatDb} />
        <Slider size="sm" label="Ratio" labelPlacement="inline" min={1} max={20} step={1} disabled={compressorOff} value={af?.compressorRatio ?? 4} onValueChange={(compressorRatio) => patchAudioFilters({ compressorRatio })} showValue formatValue={formatRatio} />
        <Checkbox label="Limiter" checked={af?.limiter ?? false} onCheckedChange={(limiter) => patchAudioFilters({ limiter })} />
      </details>}
      {selectedSource.kind !== 'group' && selectedSource.kind !== 'scene' && <details className="filter-details"><summary>Color Correction</summary>
        <Slider size="sm" label="Brightness" labelPlacement="inline" min={0} max={200} value={selectedFilters.brightness} onValueChange={(brightness) => patchFilters({ brightness })} showValue formatValue={formatPercent} />
        <Slider size="sm" label="Contrast" labelPlacement="inline" min={0} max={200} value={selectedFilters.contrast} onValueChange={(contrast) => patchFilters({ contrast })} showValue formatValue={formatPercent} />
        <Slider size="sm" label="Saturation" labelPlacement="inline" min={0} max={200} value={selectedFilters.saturation} onValueChange={(saturation) => patchFilters({ saturation })} showValue formatValue={formatPercent} />
        <Slider size="sm" label="Opacity" labelPlacement="inline" min={0} max={100} value={selectedFilters.opacity} onValueChange={(opacity) => patchFilters({ opacity })} showValue formatValue={formatPercent} />
        <Slider size="sm" label="Blur" labelPlacement="inline" min={0} max={20} value={selectedFilters.blur} onValueChange={(blur) => patchFilters({ blur })} showValue formatValue={formatPx} />
      </details>}
      {supportsChromaKey(selectedSource) && <details className="filter-details"><summary>Crop</summary>
        {cropField('top', 'Top')}
        {cropField('right', 'Right')}
        {cropField('bottom', 'Bottom')}
        {cropField('left', 'Left')}
      </details>}
      {supportsChromaKey(selectedSource) && <details className="filter-details"><summary>Chroma Key</summary>
        <Checkbox label="Enable" checked={selectedChromaKey.enabled} onCheckedChange={(enabled) => patchChromaKey({ enabled })} />
        <label className="color-property"><span>Key Color</span><input type="color" value={selectedChromaKey.keyColor} onChange={(event) => patchChromaKey({ keyColor: event.target.value })} /></label>
        <Slider size="sm" label="Similarity" labelPlacement="inline" min={0} max={100} disabled={!selectedChromaKey.enabled} value={selectedChromaKey.similarity} onValueChange={(similarity) => patchChromaKey({ similarity })} showValue />
        <Slider size="sm" label="Smoothness" labelPlacement="inline" min={0} max={100} disabled={!selectedChromaKey.enabled} value={selectedChromaKey.smoothness} onValueChange={(smoothness) => patchChromaKey({ smoothness })} showValue />
      </details>}
    </div>
  );
}
