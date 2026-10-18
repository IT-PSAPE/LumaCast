// Turns a thrown value into a short, user-facing message. Shared by every
// feature hook's catch blocks so error copy stays consistent across the app.
export function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Capture permission was denied.';
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}
