import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ReacstButton, TextField } from '@lumacast/ui';

export interface StreamKeyFieldProps {
  /** Service-specific field label, e.g. "Stream key". */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}

/** Masked stream-key input with a reveal toggle. Owns its own reveal state, which resets whenever the host dialog unmounts. */
export function StreamKeyField({ label, value, onValueChange }: StreamKeyFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      label={label}
      type={visible ? 'text' : 'password'}
      maxLength={512}
      value={value}
      onValueChange={onValueChange}
      trailing={
        <ReacstButton.Icon size="xs" variant="ghost" label={visible ? 'Hide stream key' : 'Show stream key'} onClick={() => setVisible((current) => !current)}>
          {visible ? <EyeOff /> : <Eye />}
        </ReacstButton.Icon>
      }
    />
  );
}
