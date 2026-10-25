import { useState } from "react";
import { Checkbox, Modal, ReacstButton } from "@lumacast/ui";
import type { SuiteAppDescriptor } from "@lumacast/suite";

interface UninstallDialogProps {
  open: boolean;
  descriptor: SuiteAppDescriptor | null;
  installedVersion: string | null;
  onClose: () => void;
  onConfirm: (removeUserData: boolean) => void;
}

export function UninstallDialog({
  open,
  descriptor,
  installedVersion,
  onClose,
  onConfirm,
}: UninstallDialogProps) {
  const [removeUserData, setRemoveUserData] = useState(false);

  if (!descriptor) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Remove ${descriptor.productName} ${installedVersion ?? ""}?`.trim()}
    >
      <p className="paragraph-sm text-secondary">This can&rsquo;t be undone.</p>
      <Checkbox
        className="mt-4"
        label="Also delete its data"
        checked={removeUserData}
        onCheckedChange={setRemoveUserData}
      />
      <div className="mt-6 flex justify-end gap-2">
        <ReacstButton variant="ghost" onClick={onClose}>
          Cancel
        </ReacstButton>
        <ReacstButton
          variant="danger"
          onClick={() => onConfirm(removeUserData)}
        >
          Remove
        </ReacstButton>
      </div>
    </Modal>
  );
}
