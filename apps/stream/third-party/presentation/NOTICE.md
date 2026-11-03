# Presentation import dependencies

LumaStream imports static slides locally using these packages:

- `@office-kit/pptx` 0.28.0 and `@office-kit/pptx-preview` 0.21.0:
  [office-kit/pptx](https://github.com/office-kit/pptx), MIT.
- `@resvg/resvg-js` 2.6.2:
  [resvg-js](https://github.com/yisibl/resvg-js), MPL-2.0.
- `@hyzyla/pdfium` 3.0.0:
  [PDFium wrapper](https://github.com/hyzyla/pdfium), MIT. Its WebAssembly
  runtime is pdfium-lib 8046d, built from PDFium `chromium/8046`; see
  `LICENSE-PDFium` for the upstream BSD and Apache terms and the
  [upstream third-party metadata](https://pdfium.googlesource.com/pdfium/+/refs/heads/chromium/8046/third_party/).
- `sharp` 0.35.4: [Sharp](https://github.com/lovell/sharp), Apache-2.0.
  Native binding packages retain their license files; the platform libvips
  package retains its dependency/license table and `versions.json`.
- The preview renderer's bundled Carlito, Caladea, and Liberation font families
  use the SIL Open Font License or Apache License 2.0, as listed in
  `LICENSES-fonts.md`.

The accompanying files preserve upstream license texts and notices. These
notices and the font licenses ship with every LumaStream package.
