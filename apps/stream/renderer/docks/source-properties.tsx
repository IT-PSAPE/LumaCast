import { ChevronDown, ChevronUp, Pause, Play, Plus, Square, Volume2, VolumeX, X } from 'lucide-react';
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
  type CameraResolutionPreset,
  type CaptureCursorMode,
  type ChromaKeyFilter,
  type SourceCrop,
  type SourceFilters,
  type StreamProject,
  type StreamScene,
  type StreamSource,
  type StreamTextStyle,
} from '../../shared/desktop-api';

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
  return (
    <div className="source-properties">
      <div className="property-heading"><span>{sourceIcon(selectedSource.kind, selectedSource.mediaKind)}{selectedSource.name}</span><button className="mini-icon danger" aria-label="Remove source" onClick={onRemove}><X size={14} /></button></div>
      {selectedSource.kind === 'group' && <label className="text-property">Group name<input aria-label="Group name" maxLength={120} value={selectedSource.name} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, name: event.target.value }))} /></label>}
      {selectedSource.kind === 'scene' && <label className="device-property">Scene<select aria-label="Referenced scene" value={selectedSource.referencedSceneId ?? ''} onChange={(event) => {
        const target = project.scenes.find((scene) => scene.id === event.target.value);
        if (!target || !canReferenceScene(project.scenes, activeSceneId, target.id)) return;
        updateSource(selectedSource.id, (source) => ({ ...source, name: target.name, referencedSceneId: target.id }));
      }}>
        {referenceableScenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
      </select></label>}
      {(selectedSource.kind === 'camera' || selectedSource.kind === 'microphone') && <label className="device-property">Device<select aria-label="Capture device" disabled={working} value={selectedSource.deviceId ?? ''} onChange={(event) => onSwitchInputDevice(selectedSource, event.target.value || undefined)}>
        {selectedSource.deviceId && !inputDeviceOptions[selectedSource.kind].some((device) => device.deviceId === selectedSource.deviceId) && <option value={selectedSource.deviceId}>{selectedSource.name} (Unavailable)</option>}
        <option value="">Default Device</option>
        {inputDeviceOptions[selectedSource.kind].map((device) => <option key={device.deviceId || device.label} value={device.deviceId}>{device.label}</option>)}
      </select></label>}
      {selectedSource.kind === 'camera' && <>
        <label className="device-property">Resolution<select aria-label="Camera resolution" disabled={working} value={selectedSource.cameraResolution ?? 'device-default'} onChange={(event) => onUpdateCameraCaptureSettings(selectedSource, { cameraResolution: event.target.value as CameraResolutionPreset })}>
          {CAMERA_RESOLUTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <label className="device-property">FPS<select aria-label="Camera frame rate" disabled={working} value={selectedSource.cameraFrameRate ?? ''} onChange={(event) => onUpdateCameraCaptureSettings(selectedSource, { cameraFrameRate: event.target.value ? Number(event.target.value) as CameraFrameRatePreset : undefined })}>
          <option value="">Device Default</option>
          {CAMERA_FRAME_RATE_OPTIONS.map((rate) => <option key={rate} value={rate}>{rate} FPS</option>)}
        </select></label>
      </>}
      {selectedSource.kind === 'desktop-audio' && !runtimesSnapshot.has(selectedSource.id) && desktopAudioMode !== 'unavailable' && <button className="secondary-button device-property" disabled={working} onClick={() => desktopAudioMode === 'system-tap' ? onAddSystemAudioCapture(selectedSource.id) : onOpenCapturePicker('audio', selectedSource.id)}>Start Capture</button>}
      {selectedSource.kind === 'application-audio' && <>
        <button className="secondary-button device-property" disabled={working} onClick={() => onOpenApplicationAudioPicker(selectedSource.id)}>{runtimesSnapshot.has(selectedSource.id) ? 'Change Application' : 'Reconnect Application'}</button>
        <label className="device-property">Application path<input value={selectedSource.applicationPath ?? ''} readOnly title={selectedSource.applicationPath} /></label>
      </>}
      {(selectedSource.kind === 'display' || selectedSource.kind === 'window') && <>
        <button className="secondary-button device-property" disabled={working} onClick={() => onOpenCapturePicker(selectedSource.kind === 'display' ? 'screen' : 'window', selectedSource.id)}>{runtimesSnapshot.has(selectedSource.id) ? 'Change Capture' : 'Reconnect Capture'}</button>
        <label className="device-property">Capture Cursor<select aria-label="Capture cursor" disabled={working} value={selectedSource.cursorMode ?? 'motion'} onChange={(event) => onUpdateCaptureCursorMode(selectedSource.id, event.target.value as CaptureCursorMode)}><option value="always">Always</option><option value="motion">Only when moving</option><option value="never">Never</option></select></label>
      </>}
      {supportsSourceTransform(selectedSource) && <details className="filter-details"><summary>Transform</summary>
        <div className="source-transform-grid">
          {(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key === 'x' ? 'Position X' : key === 'y' ? 'Position Y' : key === 'width' ? 'Width' : 'Height'}<input aria-label={`Source ${key}`} disabled={selectedSource.locked} type="number" min={key === 'x' || key === 'y' ? -32768 : 1} max="32768" step="1" key={`${selectedSource.id}-${key}-${selectedSource.transform[key]}`} defaultValue={selectedSource.transform[key]} onBlur={(event) => onUpdateSourceTransform(selectedSource.id, key, event.currentTarget.value)} /></label>)}
          <label>Rotation<input aria-label="Source rotation" disabled={selectedSource.locked} type="number" min="-180" max="180" step="1" key={`${selectedSource.id}-rotation-${selectedSource.transform.rotation ?? 0}`} defaultValue={selectedSource.transform.rotation ?? 0} onBlur={(event) => onUpdateSourceTransform(selectedSource.id, 'rotation', event.currentTarget.value)} /></label>
        </div>
        <div className="transform-actions"><button type="button" disabled={selectedSource.locked} onClick={() => fitSource(selectedSource)}>Fit to Canvas</button><button type="button" disabled={selectedSource.locked} onClick={() => centerSource(selectedSource)}>Center</button><button type="button" disabled={selectedSource.locked} onClick={() => onResetTransform(selectedSource)}>Reset</button></div>
      </details>}
      {selectedSource.kind === 'text' && selectedTextStyle && <>
        <label className="text-property text-property-stack">Text<textarea rows={3} value={selectedSource.text ?? ''} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, text: event.target.value }))} /></label>
        <label className="device-property">Font<select aria-label="Text font" value={selectedTextStyle.fontFamily} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, fontFamily: event.target.value }))}>{[...new Set([selectedTextStyle.fontFamily, ...textFontFamiliesForPlatform(platform)])].map((font) => <option key={font} value={font}>{font}</option>)}</select></label>
        <label className="device-property">Size<input aria-label="Text font size" type="number" min="1" max="512" value={selectedTextStyle.fontSize} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, fontSize: Math.max(1, Math.min(512, Number(event.target.value) || 1)) }))} /></label>
        <div className="text-style-toggles">
          <label><input type="checkbox" checked={selectedTextStyle.bold} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, bold: event.target.checked }))} /><span>Bold</span></label>
          <label><input type="checkbox" checked={selectedTextStyle.italic} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, italic: event.target.checked }))} /><span>Italic</span></label>
        </div>
        <label className="device-property">Align<select aria-label="Text alignment" value={selectedTextStyle.horizontalAlignment} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, horizontalAlignment: event.target.value as StreamTextStyle['horizontalAlignment'] }))}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <label className="device-property">Vertical<select aria-label="Text vertical alignment" value={selectedTextStyle.verticalAlignment} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, verticalAlignment: event.target.value as StreamTextStyle['verticalAlignment'] }))}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label>
        <label className="color-property">Color<input aria-label="Text color" type="color" value={selectedSource.color ?? '#ffffff'} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, color: event.target.value }))} /></label>
        <details className="filter-details text-style-details"><summary>Outline</summary>
          <label className="audio-filter-toggle"><input type="checkbox" checked={selectedTextStyle.outline.enabled} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, outline: { ...style.outline, enabled: event.target.checked } }))} /><span>Enabled</span></label>
          <label className="color-property">Color<input aria-label="Text outline color" type="color" disabled={!selectedTextStyle.outline.enabled} value={selectedTextStyle.outline.color} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, outline: { ...style.outline, color: event.target.value } }))} /></label>
          <label className="filter-control"><span>Width</span><input aria-label="Text outline width" type="range" min="0" max="32" value={selectedTextStyle.outline.width} disabled={!selectedTextStyle.outline.enabled} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, outline: { ...style.outline, width: Number(event.target.value) } }))} /><b>{selectedTextStyle.outline.width}px</b></label>
        </details>
        <details className="filter-details text-style-details"><summary>Drop Shadow</summary>
          <label className="audio-filter-toggle"><input type="checkbox" checked={selectedTextStyle.shadow.enabled} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, enabled: event.target.checked } }))} /><span>Enabled</span></label>
          <label className="color-property">Color<input aria-label="Text shadow color" type="color" disabled={!selectedTextStyle.shadow.enabled} value={selectedTextStyle.shadow.color} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, color: event.target.value } }))} /></label>
          <label className="filter-control"><span>Blur</span><input aria-label="Text shadow blur" type="range" min="0" max="100" value={selectedTextStyle.shadow.blur} disabled={!selectedTextStyle.shadow.enabled} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, blur: Number(event.target.value) } }))} /><b>{selectedTextStyle.shadow.blur}px</b></label>
          <label className="device-property">Offset X<input aria-label="Text shadow offset X" type="number" min="-128" max="128" disabled={!selectedTextStyle.shadow.enabled} value={selectedTextStyle.shadow.offsetX} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, offsetX: Math.max(-128, Math.min(128, Number(event.target.value) || 0)) } }))} /></label>
          <label className="device-property">Offset Y<input aria-label="Text shadow offset Y" type="number" min="-128" max="128" disabled={!selectedTextStyle.shadow.enabled} value={selectedTextStyle.shadow.offsetY} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, offsetY: Math.max(-128, Math.min(128, Number(event.target.value) || 0)) } }))} /></label>
        </details>
        <details className="filter-details text-style-details"><summary>Background</summary>
          <label className="color-property">Color<input aria-label="Text background color" type="color" value={selectedTextStyle.background.color} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, background: { ...style.background, color: event.target.value } }))} /></label>
          <label className="filter-control"><span>Opacity</span><input aria-label="Text background opacity" type="range" min="0" max="100" value={Math.round(selectedTextStyle.background.opacity * 100)} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, background: { ...style.background, opacity: Number(event.target.value) / 100 } }))} /><b>{Math.round(selectedTextStyle.background.opacity * 100)}%</b></label>
        </details>
      </>}
      {selectedSource.kind === 'color' && <label className="color-property">Color<input type="color" value={selectedSource.color ?? '#ffffff'} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, color: event.target.value }))} /></label>}
      {selectedSource.kind === 'media' && <>
        <div className="media-playback-controls">
          <button className="secondary-button" disabled={!mediaElements.has(selectedSource.id)} onClick={() => onTogglePlayback(selectedSource.id)}>{mediaPlaybackStates[selectedSource.id]?.paused ? <Play size={12} /> : <Pause size={12} />}{mediaPlaybackStates[selectedSource.id]?.paused ? 'Play' : 'Pause'}</button>
          <button className="secondary-button" disabled={!mediaElements.has(selectedSource.id)} onClick={() => onRestartPlayback(selectedSource.id)}><Play size={12} />Restart</button>
          <button className="secondary-button" disabled={!mediaElements.has(selectedSource.id)} onClick={() => onStopPlayback(selectedSource.id)}><Square size={11} />Stop</button>
        </div>
        <label className="media-loop-property"><input type="checkbox" checked={selectedSource.loop ?? false} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, loop: event.target.checked }))} /><span>Loop</span></label>
        <label className="media-loop-property"><input type="checkbox" checked={selectedSource.restartPlaybackWhenActive ?? true} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, restartPlaybackWhenActive: event.target.checked }))} /><span>Restart playback when source becomes active</span></label>
        <label className="media-loop-property"><input type="checkbox" checked={selectedSource.showNothingWhenPlaybackEnds ?? true} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, showNothingWhenPlaybackEnds: event.target.checked }))} /><span>Show nothing when playback ends</span></label>
      </>}
      {selectedSource.kind === 'slideshow' && <div className="slideshow-properties">
        <label className="device-property">Slide duration (seconds)<input aria-label="Slide duration in seconds" type="number" min="1" max="600" value={selectedSource.slideshowIntervalSeconds ?? 5} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, slideshowIntervalSeconds: Math.max(1, Math.min(600, Number(event.target.value) || 1)) }))} /></label>
        <label className="media-loop-property"><input type="checkbox" checked={selectedSource.slideshowLoop ?? true} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, slideshowLoop: event.target.checked }))} /><span>Loop</span></label>
        <div className="slideshow-list" aria-label="Slideshow images">{(selectedSource.slideshowImages ?? []).map((image, index) => <div className="slideshow-image-row" key={image.assetId}>
          <span title={image.name}>{index + 1}. {image.name}</span>
          <div><button className="mini-icon" aria-label={`Move ${image.name} up`} disabled={index === 0} onClick={() => moveSlideshowImage(selectedSource.id, index, -1)}><ChevronUp size={12} /></button><button className="mini-icon" aria-label={`Move ${image.name} down`} disabled={index === (selectedSource.slideshowImages?.length ?? 0) - 1} onClick={() => moveSlideshowImage(selectedSource.id, index, 1)}><ChevronDown size={12} /></button><button className="mini-icon danger" aria-label={`Remove ${image.name}`} disabled={(selectedSource.slideshowImages?.length ?? 0) <= 1} onClick={() => removeSlideshowImage(selectedSource.id, index)}><X size={12} /></button></div>
        </div>)}</div>
        <button className="slideshow-add-image" disabled={working || (selectedSource.slideshowImages?.length ?? 0) >= 100} onClick={() => addSlideshowImage(selectedSource.id)}><Plus size={12} />Add Image</button>
      </div>}
      {selectedSource.kind === 'browser' && <label className="text-property">URL<input value={selectedSource.url ?? ''} readOnly title={selectedSource.url} /></label>}
      {selectedSource.kind === 'browser' && <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.browserAudioEnabled ?? false} onChange={(event) => updateBrowserAudio(selectedSource.id, event.target.checked)} /><span>Capture Audio</span></label>}
      {hasAudioMeter && <label className="volume-property"><span>Volume</span><input type="range" min="0" max="200" value={selectedSource.muted ? 0 : selectedSource.volume * 100} onChange={(event) => updateSourceSettings(selectedSource.id, { volume: Number(event.target.value) / 100, muted: false })} /><button className="mini-icon" aria-label={selectedSource.muted ? 'Unmute source' : 'Mute source'} onClick={() => updateSourceSettings(selectedSource.id, { volume: selectedSource.volume, muted: !selectedSource.muted })}>{selectedSource.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button></label>}
      {hasAudioMeter && <label className="balance-property"><span>Balance</span><input aria-label="Audio balance" type="range" min="-100" max="100" value={Math.round((selectedSource.balance ?? 0) * 100)} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, balance: Number(event.target.value) / 100 }))} /><b>{(selectedSource.balance ?? 0) < -0.02 ? 'Left' : (selectedSource.balance ?? 0) > 0.02 ? 'Right' : 'Center'}</b></label>}
      {hasAudioMeter && <label className="monitoring-property">Audio Monitoring<select aria-label="Audio monitoring" value={selectedSource.audioMonitoring ?? 'off'} onChange={(event) => updateSourceMonitoring(selectedSource.id, event.target.value as AudioMonitoring)}><option value="off">Off</option><option value="monitor-only">Monitor Only</option><option value="monitor-and-output">Monitor and Output</option></select></label>}
      {hasAudioMeter && <details className="filter-details"><summary>Audio Tracks</summary>
        <div className="audio-track-grid">{AUDIO_TRACKS.map((track) => <label key={track} className="audio-track-toggle"><input type="checkbox" checked={(selectedSource.audioTracks ?? [1]).includes(track)} onChange={(event) => updateSourceAudioTrack(selectedSource.id, track, event.target.checked)} /><span>Track {track}</span></label>)}</div>
      </details>}
      {hasAudioMeter && <details className="filter-details"><summary>Audio Filters</summary>
        <label className="filter-control"><span>Gain</span><input type="range" min="-30" max="30" step="0.5" value={selectedSource.audioFilters?.gainDb ?? 0} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { gainDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.gainDb ?? 0} dB</b></label>
        {selectedSource.kind === 'microphone' && <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.noiseSuppression ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseSuppression: event.target.checked })} /><span>Neural Noise Suppression</span></label>}
        <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.noiseGate ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGate: event.target.checked })} /><span>Noise Gate</span></label>
        <label className="filter-control"><span>Gate opens</span><input type="range" min="-80" max="0" value={selectedSource.audioFilters?.noiseGateOpenThresholdDb ?? -26} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateOpenThresholdDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateOpenThresholdDb ?? -26} dB</b></label>
        <label className="filter-control"><span>Gate closes</span><input type="range" min="-80" max={selectedSource.audioFilters?.noiseGateOpenThresholdDb ?? -26} value={selectedSource.audioFilters?.noiseGateCloseThresholdDb ?? -32} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateCloseThresholdDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateCloseThresholdDb ?? -32} dB</b></label>
        <label className="filter-control"><span>Attack</span><input type="range" min="1" max="100" value={selectedSource.audioFilters?.noiseGateAttackMs ?? 10} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateAttackMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateAttackMs ?? 10} ms</b></label>
        <label className="filter-control"><span>Hold</span><input type="range" min="0" max="1000" step="10" value={selectedSource.audioFilters?.noiseGateHoldMs ?? 150} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateHoldMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateHoldMs ?? 150} ms</b></label>
        <label className="filter-control"><span>Release</span><input type="range" min="10" max="1000" step="10" value={selectedSource.audioFilters?.noiseGateReleaseMs ?? 250} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateReleaseMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateReleaseMs ?? 250} ms</b></label>
        <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.expander ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expander: event.target.checked })} /><span>Expander</span></label>
        <label className="filter-control"><span>Threshold</span><input type="range" min="-80" max="0" value={selectedSource.audioFilters?.expanderThresholdDb ?? -40} disabled={!selectedSource.audioFilters?.expander} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expanderThresholdDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.expanderThresholdDb ?? -40} dB</b></label>
        <label className="filter-control"><span>Ratio</span><input type="range" min="1" max="10" step="0.5" value={selectedSource.audioFilters?.expanderRatio ?? 2} disabled={!selectedSource.audioFilters?.expander} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expanderRatio: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.expanderRatio ?? 2}:1</b></label>
        <label className="filter-control"><span>Attack</span><input type="range" min="1" max="100" value={selectedSource.audioFilters?.expanderAttackMs ?? 10} disabled={!selectedSource.audioFilters?.expander} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expanderAttackMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.expanderAttackMs ?? 10} ms</b></label>
        <label className="filter-control"><span>Release</span><input type="range" min="10" max="1000" step="10" value={selectedSource.audioFilters?.expanderReleaseMs ?? 150} disabled={!selectedSource.audioFilters?.expander} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expanderReleaseMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.expanderReleaseMs ?? 150} ms</b></label>
        <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.compressor ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { compressor: event.target.checked })} /><span>Compressor</span></label>
        <label className="filter-control"><span>Threshold</span><input type="range" min="-60" max="0" value={selectedSource.audioFilters?.compressorThresholdDb ?? -18} disabled={!selectedSource.audioFilters?.compressor} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { compressorThresholdDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.compressorThresholdDb ?? -18} dB</b></label>
        <label className="filter-control"><span>Ratio</span><input type="range" min="1" max="20" step="1" value={selectedSource.audioFilters?.compressorRatio ?? 4} disabled={!selectedSource.audioFilters?.compressor} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { compressorRatio: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.compressorRatio ?? 4}:1</b></label>
        <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.limiter ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { limiter: event.target.checked })} /><span>Limiter</span></label>
      </details>}
      {selectedSource.kind !== 'group' && selectedSource.kind !== 'scene' && <details className="filter-details"><summary>Color Correction</summary>
        <label className="filter-control"><span>Brightness</span><input type="range" min="0" max="200" value={selectedFilters.brightness} onChange={(event) => updateSourceFilters(selectedSource.id, { brightness: Number(event.target.value) })} /><b>{selectedFilters.brightness}%</b></label>
        <label className="filter-control"><span>Contrast</span><input type="range" min="0" max="200" value={selectedFilters.contrast} onChange={(event) => updateSourceFilters(selectedSource.id, { contrast: Number(event.target.value) })} /><b>{selectedFilters.contrast}%</b></label>
        <label className="filter-control"><span>Saturation</span><input type="range" min="0" max="200" value={selectedFilters.saturation} onChange={(event) => updateSourceFilters(selectedSource.id, { saturation: Number(event.target.value) })} /><b>{selectedFilters.saturation}%</b></label>
        <label className="filter-control"><span>Opacity</span><input type="range" min="0" max="100" value={selectedFilters.opacity} onChange={(event) => updateSourceFilters(selectedSource.id, { opacity: Number(event.target.value) })} /><b>{selectedFilters.opacity}%</b></label>
        <label className="filter-control"><span>Blur</span><input type="range" min="0" max="20" value={selectedFilters.blur} onChange={(event) => updateSourceFilters(selectedSource.id, { blur: Number(event.target.value) })} /><b>{selectedFilters.blur}px</b></label>
      </details>}
      {supportsChromaKey(selectedSource) && <details className="filter-details"><summary>Crop</summary>
        <label className="crop-control"><span>Top</span><input type="number" min="0" max="16384" step="1" value={selectedCrop.top} onChange={(event) => updateSourceCrop(selectedSource.id, { top: Math.max(0, Math.min(16384, Math.trunc(Number(event.target.value) || 0))) })} /><b>px</b></label>
        <label className="crop-control"><span>Right</span><input type="number" min="0" max="16384" step="1" value={selectedCrop.right} onChange={(event) => updateSourceCrop(selectedSource.id, { right: Math.max(0, Math.min(16384, Math.trunc(Number(event.target.value) || 0))) })} /><b>px</b></label>
        <label className="crop-control"><span>Bottom</span><input type="number" min="0" max="16384" step="1" value={selectedCrop.bottom} onChange={(event) => updateSourceCrop(selectedSource.id, { bottom: Math.max(0, Math.min(16384, Math.trunc(Number(event.target.value) || 0))) })} /><b>px</b></label>
        <label className="crop-control"><span>Left</span><input type="number" min="0" max="16384" step="1" value={selectedCrop.left} onChange={(event) => updateSourceCrop(selectedSource.id, { left: Math.max(0, Math.min(16384, Math.trunc(Number(event.target.value) || 0))) })} /><b>px</b></label>
      </details>}
      {supportsChromaKey(selectedSource) && <details className="filter-details"><summary>Chroma Key</summary>
        <label className="audio-filter-toggle"><input type="checkbox" checked={selectedChromaKey.enabled} onChange={(event) => updateSourceChromaKey(selectedSource.id, { enabled: event.target.checked })} /><span>Enable</span></label>
        <label className="color-property"><span>Key Color</span><input type="color" value={selectedChromaKey.keyColor} onChange={(event) => updateSourceChromaKey(selectedSource.id, { keyColor: event.target.value })} /></label>
        <label className="filter-control"><span>Similarity</span><input type="range" min="0" max="100" value={selectedChromaKey.similarity} disabled={!selectedChromaKey.enabled} onChange={(event) => updateSourceChromaKey(selectedSource.id, { similarity: Number(event.target.value) })} /><b>{selectedChromaKey.similarity}</b></label>
        <label className="filter-control"><span>Smoothness</span><input type="range" min="0" max="100" value={selectedChromaKey.smoothness} disabled={!selectedChromaKey.enabled} onChange={(event) => updateSourceChromaKey(selectedSource.id, { smoothness: Number(event.target.value) })} /><b>{selectedChromaKey.smoothness}</b></label>
      </details>}
    </div>
  );
}
