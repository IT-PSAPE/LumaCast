// The renderer imports its buttons and dialogs from here so the app's screens
// read exactly as the source did, while the primitives themselves live in
// @lumacast/ui (the domain-agnostic package every app may reuse). `Btn` is the
// name the Lumaflux screens already use; it is the shared `PlainButton`, whose
// props are unchanged from the source's Base UI `Button` wrapper.
export { PlainButton as Btn, Modal } from '@lumacast/ui';
