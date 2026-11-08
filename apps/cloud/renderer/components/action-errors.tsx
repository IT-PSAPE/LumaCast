import { Banner, ReacstButton } from "@lumacast/ui";
import type { ActionFailure } from "../hooks/use-cloud-actions";

export function ActionErrors<Action>({ failures, onRetry, onDismiss, isBusy }: {
  failures: ActionFailure<Action>[];
  onRetry: (failure: ActionFailure<Action>) => void;
  onDismiss: (failure: ActionFailure<Action>) => void;
  isBusy: (failure: ActionFailure<Action>) => boolean;
}) {
  return failures.map((failure) => (
    <Banner key={failure.key} tone="error" onDismiss={() => onDismiss(failure)} action={
      <ReacstButton variant="ghost" disabled={isBusy(failure)} onClick={() => onRetry(failure)}>
        Retry
      </ReacstButton>
    }>
      {failure.message}
    </Banner>
  ));
}
