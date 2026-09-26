import { useState } from 'react';
import { Checkbox } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { cn, Modal, ReacstButton } from '@lumacast/ui';
import type { SuiteAppDescriptor } from '@lumacast/suite';

interface UninstallDialogProps {
  open: boolean;
  descriptor: SuiteAppDescriptor | null;
  installedVersion: string | null;
  onClose: () => void;
  onConfirm: (removeUserData: boolean) => void;
}

export function UninstallDialog({ open, descriptor, installedVersion, onClose, onConfirm }: UninstallDialogProps) {
  const [removeUserData, setRemoveUserData] = useState(false);

  if (!descriptor) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Remove ${descriptor.productName} ${installedVersion ?? ''}?`.trim()}>
      <p className="paragraph-sm text-secondary">This can&rsquo;t be undone.</p>
      <label className="mt-4 flex items-center gap-2 label-sm text-secondary">
        <Checkbox.Root
          checked={removeUserData}
          onCheckedChange={(checked) => setRemoveUserData(checked === true)}
          className={(state) =>
            cn(
              'grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
              state.checked ? 'border-brand bg-brand/15 text-brand' : 'border-primary bg-primary text-transparent',
            )
          }
        >
          <Checkbox.Indicator>
            <Check size={11} strokeWidth={2.5} />
          </Checkbox.Indicator>
        </Checkbox.Root>
        Also delete its data
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <ReacstButton variant="ghost" onClick={onClose}>
          Cancel
        </ReacstButton>
        <ReacstButton variant="danger" onClick={() => onConfirm(removeUserData)}>
          Remove
        </ReacstButton>
      </div>
    </Modal>
  );
}
