import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, Headphones } from 'lucide-react';
import { Checkbox, Modal, Select } from '@lumacast/ui';
import { WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE, type CaptureAudioMode } from '../../shared/capture-audio';
import type { AudioApplicationOption, CaptureCursorMode, DesktopSourceOption } from '../../shared/desktop-api';
import { explicitAudioInputDevices, type InputCaptureKind, type InputDeviceOption } from '../features/capture/helpers';

const CURSOR_MODE_OPTIONS: ReadonlyArray<{ value: CaptureCursorMode; label: string }> = [
  { value: 'always', label: 'Always' },
  { value: 'motion', label: 'Only when moving' },
  { value: 'never', label: 'Never' },
];

export interface CapturePickerProps {
  captureOptions: DesktopSourceOption[];
  captureKind: 'screen' | 'window' | 'audio' | null;
  captureTargetSourceId: string | null;
  runtimesSnapshot: ReadonlyMap<string, MediaStream>;
  working: boolean;
  supportsSystemAudio: boolean;
  supportsApplicationAudio: boolean;
  captureAudioMode: CaptureAudioMode;
  setCaptureAudioMode: (mode: CaptureAudioMode) => void;
  captureAudioApplications: AudioApplicationOption[] | null;
  captureAudioApplicationLoading: boolean;
  selectedCaptureAudioApplication: AudioApplicationOption | null;
  onLoadCaptureAudioApplications: () => void;
  onSelectCaptureAudioApplication: (application: AudioApplicationOption | null) => void;
  captureCursorMode: CaptureCursorMode;
  setCaptureCursorMode: Dispatch<SetStateAction<CaptureCursorMode>>;
  onSelect: (option: DesktopSourceOption) => void;
  onClose: () => void;
}

const applicationOptionValue = (application: AudioApplicationOption): string => `${application.pid}:${application.path}`;

export function CapturePicker({
  captureOptions,
  captureKind,
  captureTargetSourceId,
  runtimesSnapshot,
  working,
  supportsSystemAudio,
  supportsApplicationAudio,
  captureAudioMode,
  setCaptureAudioMode,
  captureAudioApplications,
  captureAudioApplicationLoading,
  selectedCaptureAudioApplication,
  onLoadCaptureAudioApplications,
  onSelectCaptureAudioApplication,
  captureCursorMode,
  setCaptureCursorMode,
  onSelect,
  onClose,
}: CapturePickerProps) {
  const hasAudioChoices = supportsSystemAudio || supportsApplicationAudio;
  const audioSourceOptions = [
    ...(supportsApplicationAudio ? [{ value: 'application' as const, label: 'Application audio' }] : []),
    ...(supportsSystemAudio ? [{ value: 'system' as const, label: 'System audio' }] : []),
  ];
  const listedApplications = captureAudioApplications ?? [];
  const selectedApplicationValue = selectedCaptureAudioApplication ? applicationOptionValue(selectedCaptureAudioApplication) : '';
  const applicationOptions = [
    { value: '', label: captureAudioApplicationLoading ? 'Loading applications…' : 'Select an application' },
    ...listedApplications.map((application) => ({ value: applicationOptionValue(application), label: application.name })),
    ...(selectedCaptureAudioApplication && !listedApplications.some((application) => applicationOptionValue(application) === selectedApplicationValue)
      ? [{ value: selectedApplicationValue, label: selectedCaptureAudioApplication.name }]
      : []),
  ];
  const canCapture = captureKind === 'window' || captureAudioMode !== 'application' || selectedCaptureAudioApplication !== null;

  return (
    <Modal open title={captureTargetSourceId ? (runtimesSnapshot.has(captureTargetSourceId) ? 'Change capture' : 'Reconnect capture') : captureKind === 'audio' ? 'Select a display for audio' : captureKind === 'screen' ? 'Select a display' : 'Select a window'} className="capture-modal" onClose={onClose} footer={<button className="secondary-button" disabled={working} onClick={onClose}>Cancel</button>}>
        <div className="capture-grid">{captureOptions.length === 0 ? <div className="capture-empty">No {captureKind === 'window' ? 'windows' : 'displays'} are available.</div> : captureOptions.map((option) => <button key={option.id} className="capture-option" disabled={working || !canCapture} onClick={() => onSelect(option)}>
          <img src={option.thumbnail} alt="" /><span className="capture-option-name">{option.name}</span>
        </button>)}</div>
        {captureKind === 'window' && <div className="flex flex-col gap-2 border-t border-[var(--border-color-secondary)] px-5 py-4">
          <div className="flex min-h-[24px] items-center gap-2">
            <Checkbox label="Capture audio" checked={false} disabled onCheckedChange={() => undefined} />
            <Headphones size={15} className="ml-auto text-tertiary" />
          </div>
          <div className="text-sm text-secondary">{WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE}</div>
        </div>}
        {captureKind === 'screen' && hasAudioChoices && <div className="flex flex-col gap-3 border-t border-[var(--border-color-secondary)] px-5 py-4">
          <div className="flex min-h-[24px] items-center gap-2">
            <Checkbox
              label="Capture audio"
              checked={captureAudioMode !== 'off'}
              disabled={working}
              onCheckedChange={(enabled) => {
                if (!enabled) {
                  setCaptureAudioMode('off');
                  return;
                }
                const defaultMode = supportsApplicationAudio ? 'application' : 'system';
                setCaptureAudioMode(defaultMode);
                if (defaultMode === 'application') onLoadCaptureAudioApplications();
              }}
            />
            <Headphones size={15} className="ml-auto text-tertiary" />
          </div>
          {captureAudioMode !== 'off' && <>
            <Select
              size="sm"
              label="Audio source"
              labelPlacement="inline"
              disabled={working || audioSourceOptions.length < 2}
              value={captureAudioMode}
              onValueChange={(value) => {
                const mode = value as CaptureAudioMode;
                setCaptureAudioMode(mode);
                if (mode === 'application') onLoadCaptureAudioApplications();
              }}
              options={audioSourceOptions}
            />
            {captureAudioMode === 'application' && <>
              <Select
                size="sm"
                label="Application"
                labelPlacement="inline"
                disabled={working || captureAudioApplicationLoading || (listedApplications.length === 0 && !selectedCaptureAudioApplication)}
                value={selectedApplicationValue}
                onValueChange={(value) => onSelectCaptureAudioApplication(listedApplications.find((application) => applicationOptionValue(application) === value) ?? null)}
                options={applicationOptions}
              />
              {captureAudioApplications === null && !captureAudioApplicationLoading && <button className="secondary-button" disabled={working} onClick={onLoadCaptureAudioApplications}>Refresh applications</button>}
              {captureAudioApplications?.length === 0 && !captureAudioApplicationLoading && <div className="capture-empty">No applications are available.</div>}
            </>}
          </>}
        </div>}
        {captureKind !== 'audio' && <div className="capture-cursor-option"><span>Capture Cursor</span><Select label="Capture cursor" labelPlacement="hidden" className="w-[180px]" size="sm" value={captureCursorMode} onValueChange={setCaptureCursorMode} options={CURSOR_MODE_OPTIONS} /></div>}
    </Modal>
  );
}

export interface InputDevicePickerProps {
  kind: InputCaptureKind;
  devices: InputDeviceOption[];
  audioDevices: InputDeviceOption[];
  captureAudioEnabled: boolean;
  setCaptureAudioEnabled: Dispatch<SetStateAction<boolean>>;
  audioDeviceId: string;
  setAudioDeviceId: Dispatch<SetStateAction<string>>;
  working: boolean;
  onChoose: (device: InputDeviceOption) => void;
  onClose: () => void;
}

export function InputDevicePicker({ kind, devices, audioDevices, captureAudioEnabled, setCaptureAudioEnabled, audioDeviceId, setAudioDeviceId, working, onChoose, onClose }: InputDevicePickerProps) {
  return (
    <Modal open title={`Select a ${kind === 'camera' ? 'camera' : 'microphone'}`} className="capture-modal device-modal" onClose={onClose} closeDisabled={working} footer={<button className="secondary-button" disabled={working} onClick={onClose}>Cancel</button>}>
        <div className="device-picker-list">{devices.length === 0
          ? <div className="capture-empty">No devices are available.</div>
          : devices.map((device) => <button key={device.deviceId || device.label} disabled={working} onClick={() => onChoose(device)}><span>{device.label}</span><ChevronDown size={14} /></button>)}</div>
        {kind === 'camera' && <div className="flex flex-col gap-3 border-t border-[var(--border-color-secondary)] px-5 py-4">
          <Checkbox label="Capture audio" checked={captureAudioEnabled} disabled={working} onCheckedChange={setCaptureAudioEnabled} />
          {captureAudioEnabled && <Select size="sm" label="Audio input" labelPlacement="inline" disabled={working} value={audioDeviceId} onValueChange={setAudioDeviceId} options={[
            { value: '', label: 'Select an audio input' },
            ...explicitAudioInputDevices(audioDevices).map((device) => ({ value: device.deviceId, label: device.label })),
          ]} />}
        </div>}
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
        <p className="px-5 pt-4 text-sm text-secondary">Captures audio from the selected app, including its other windows.</p>
        <div className="device-picker-list">{options.length === 0
          ? <div className="capture-empty">No apps with audio sessions are available.</div>
          : options.map((application) => <button key={`${application.pid}:${application.path}`} disabled={working} onClick={() => onChoose(application)}><span title={application.path}>{application.name}</span><ChevronDown size={14} /></button>)}</div>
    </Modal>
  );
}
