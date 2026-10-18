import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, Headphones, X } from 'lucide-react';
import { useEscapeKey } from '../modal-dialog';
import type { AudioApplicationOption, CaptureCursorMode, DesktopSourceOption } from '../../shared/desktop-api';
import type { InputCaptureKind, InputDeviceOption } from '../features/capture/helpers';

export interface CapturePickerProps {
  captureOptions: DesktopSourceOption[];
  captureKind: 'screen' | 'window' | 'audio' | null;
  captureTargetSourceId: string | null;
  runtimesSnapshot: ReadonlyMap<string, MediaStream>;
  working: boolean;
  displayCaptureSystemAudio: boolean;
  includeSystemAudio: boolean;
  setIncludeSystemAudio: Dispatch<SetStateAction<boolean>>;
  captureCursorMode: CaptureCursorMode;
  setCaptureCursorMode: Dispatch<SetStateAction<CaptureCursorMode>>;
  onSelect: (option: DesktopSourceOption) => void;
  onClose: () => void;
}

export function CapturePicker({ captureOptions, captureKind, captureTargetSourceId, runtimesSnapshot, working, displayCaptureSystemAudio, includeSystemAudio, setIncludeSystemAudio, captureCursorMode, setCaptureCursorMode, onSelect, onClose }: CapturePickerProps) {
  useEscapeKey(onClose);
  return (
    <div className="stream-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="capture-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title">
        <div className="modal-heading"><div><h2 id="capture-title">{captureTargetSourceId ? (runtimesSnapshot.has(captureTargetSourceId) ? 'Change capture' : 'Reconnect capture') : captureKind === 'audio' ? 'Select a display for audio' : captureKind === 'screen' ? 'Select a display' : 'Select a window'}</h2></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
        <div className="capture-grid">{captureOptions.length === 0 ? <div className="capture-empty">No {captureKind === 'window' ? 'windows' : 'displays'} are available.</div> : captureOptions.map((option) => <button key={option.id} className="capture-option" disabled={working} onClick={() => onSelect(option)}>
          <img src={option.thumbnail} alt="" /><span className="capture-option-name">{option.name}</span>
        </button>)}</div>
        {captureKind !== 'audio' && displayCaptureSystemAudio && <label className="system-audio-option"><input type="checkbox" checked={includeSystemAudio} onChange={(event) => setIncludeSystemAudio(event.target.checked)} /><span>Capture system audio</span><Headphones size={15} /></label>}
        {captureKind !== 'audio' && <label className="capture-cursor-option"><span>Capture Cursor</span><select aria-label="Capture cursor" value={captureCursorMode} onChange={(event) => setCaptureCursorMode(event.target.value as CaptureCursorMode)}><option value="always">Always</option><option value="motion">Only when moving</option><option value="never">Never</option></select></label>}
        <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}

export interface InputDevicePickerProps {
  kind: InputCaptureKind;
  devices: InputDeviceOption[];
  working: boolean;
  onChoose: (device: InputDeviceOption) => void;
  onClose: () => void;
}

export function InputDevicePicker({ kind, devices, working, onChoose, onClose }: InputDevicePickerProps) {
  useEscapeKey(onClose, working);
  return (
    <div className="stream-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
      <section className="capture-modal device-modal" role="dialog" aria-modal="true" aria-labelledby="input-device-title">
        <div className="modal-heading"><div><h2 id="input-device-title">Select a {kind === 'camera' ? 'camera' : 'microphone'}</h2></div><button className="icon-button" aria-label="Close" disabled={working} onClick={onClose}><X size={17} /></button></div>
        <div className="device-picker-list">{devices.length === 0
          ? <div className="capture-empty">No devices are available.</div>
          : devices.map((device) => <button key={device.deviceId || device.label} disabled={working} onClick={() => onChoose(device)}><span>{device.label}</span><ChevronDown size={14} /></button>)}</div>
        <div className="modal-footer"><button className="secondary-button" disabled={working} onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}

export interface ApplicationAudioPickerProps {
  options: AudioApplicationOption[];
  targetSourceId: string | null;
  runtimesSnapshot: ReadonlyMap<string, MediaStream>;
  working: boolean;
  onChoose: (application: AudioApplicationOption) => void;
  onClose: () => void;
}

export function ApplicationAudioPicker({ options, targetSourceId, runtimesSnapshot, working, onChoose, onClose }: ApplicationAudioPickerProps) {
  useEscapeKey(onClose, working);
  return (
    <div className="stream-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) onClose(); }}>
      <section className="capture-modal device-modal" role="dialog" aria-modal="true" aria-labelledby="application-audio-title">
        <div className="modal-heading"><div><h2 id="application-audio-title">{targetSourceId ? (runtimesSnapshot.has(targetSourceId) ? 'Change application' : 'Reconnect application') : 'Select an application'}</h2></div><button className="icon-button" aria-label="Close" disabled={working} onClick={onClose}><X size={17} /></button></div>
        <div className="device-picker-list">{options.length === 0
          ? <div className="capture-empty">No applications are available.</div>
          : options.map((application) => <button key={`${application.pid}:${application.path}`} disabled={working} onClick={() => onChoose(application)}><span title={`${application.path} · PID ${application.pid}`}>{application.name} · PID {application.pid}</span><ChevronDown size={14} /></button>)}</div>
        <div className="modal-footer"><button className="secondary-button" disabled={working} onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}
