import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, Headphones } from 'lucide-react';
import { Modal } from '@lumacast/ui';
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
  return (
    <Modal open title={captureTargetSourceId ? (runtimesSnapshot.has(captureTargetSourceId) ? 'Change capture' : 'Reconnect capture') : captureKind === 'audio' ? 'Select a display for audio' : captureKind === 'screen' ? 'Select a display' : 'Select a window'} className="capture-modal" onClose={onClose} footer={<button className="secondary-button" onClick={onClose}>Cancel</button>}>
        <div className="capture-grid">{captureOptions.length === 0 ? <div className="capture-empty">No {captureKind === 'window' ? 'windows' : 'displays'} are available.</div> : captureOptions.map((option) => <button key={option.id} className="capture-option" disabled={working} onClick={() => onSelect(option)}>
          <img src={option.thumbnail} alt="" /><span className="capture-option-name">{option.name}</span>
        </button>)}</div>
        {captureKind !== 'audio' && displayCaptureSystemAudio && <label className="system-audio-option"><input type="checkbox" checked={includeSystemAudio} onChange={(event) => setIncludeSystemAudio(event.target.checked)} /><span>Capture system audio</span><Headphones size={15} /></label>}
        {captureKind !== 'audio' && <label className="capture-cursor-option"><span>Capture Cursor</span><select aria-label="Capture cursor" value={captureCursorMode} onChange={(event) => setCaptureCursorMode(event.target.value as CaptureCursorMode)}><option value="always">Always</option><option value="motion">Only when moving</option><option value="never">Never</option></select></label>}
    </Modal>
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
  return (
    <Modal open title={`Select a ${kind === 'camera' ? 'camera' : 'microphone'}`} className="capture-modal device-modal" onClose={onClose} closeDisabled={working} footer={<button className="secondary-button" disabled={working} onClick={onClose}>Cancel</button>}>
        <div className="device-picker-list">{devices.length === 0
          ? <div className="capture-empty">No devices are available.</div>
          : devices.map((device) => <button key={device.deviceId || device.label} disabled={working} onClick={() => onChoose(device)}><span>{device.label}</span><ChevronDown size={14} /></button>)}</div>
    </Modal>
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
  return (
    <Modal open title={targetSourceId ? (runtimesSnapshot.has(targetSourceId) ? 'Change application' : 'Reconnect application') : 'Select an application'} className="capture-modal device-modal" onClose={onClose} closeDisabled={working} footer={<button className="secondary-button" disabled={working} onClick={onClose}>Cancel</button>}>
        <div className="device-picker-list">{options.length === 0
          ? <div className="capture-empty">No applications are available.</div>
          : options.map((application) => <button key={`${application.pid}:${application.path}`} disabled={working} onClick={() => onChoose(application)}><span title={`${application.path} · PID ${application.pid}`}>{application.name} · PID {application.pid}</span><ChevronDown size={14} /></button>)}</div>
    </Modal>
  );
}
