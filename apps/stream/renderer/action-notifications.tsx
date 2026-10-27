import { useEffect } from 'react';
import { Toaster, useToast, type ToastTone } from '@lumacast/ui';

export function actionNotificationTone(message: string): ToastTone {
  if (message.startsWith('Saved ')) return 'success';
  if (/\b(disconnected|unavailable|not found|capture ended|could not restore)\b/i.test(message)) return 'warning';
  return 'error';
}

/** Keep action feedback near its own dismiss control, out of the production status strip. */
export function ActionNotifications({ message, sequence }: { message: string; sequence?: number }) {
  const { toast } = useToast();
  useEffect(() => {
    if (!message.trim()) return;
    toast({ description: message, tone: actionNotificationTone(message), duration: 6000 });
  }, [message, sequence, toast]);
  return <Toaster position="bottom-right" max={1} />;
}
