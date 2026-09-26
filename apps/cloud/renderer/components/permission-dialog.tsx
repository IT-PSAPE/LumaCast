import { Modal, ReacstButton } from '@lumacast/ui';
import type { SuiteAppDescriptor } from '@lumacast/suite';

interface PermissionDialogProps {
  open: boolean;
  descriptor: SuiteAppDescriptor | null;
  onAllow: () => void;
  onNotNow: () => void;
}

const PERMITTED_ACTIONS = ['Install', 'Update', 'Downgrade', 'Remove', 'Open'];

export function PermissionDialog({ open, descriptor, onAllow, onNotNow }: PermissionDialogProps) {
  if (!descriptor) return null;

  return (
    <Modal open={open} onClose={onNotNow} title={`Allow LumaCloud to manage ${descriptor.productName}?`}>
      <p className="paragraph-sm text-secondary">{descriptor.bundleId}</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 paragraph-sm text-secondary">
        {PERMITTED_ACTIONS.map((action) => (
          <li key={action}>{action}</li>
        ))}
      </ul>
      <div className="mt-6 flex justify-end gap-2">
        <ReacstButton variant="ghost" onClick={onNotNow}>
          Not now
        </ReacstButton>
        <ReacstButton className="bg-brand/15 text-brand hover:bg-brand/25" onClick={onAllow}>
          Allow
        </ReacstButton>
      </div>
    </Modal>
  );
}
