# Lensfun calibration data

`profiles.json` is a transformed subset of the Lensfun contributors' database, from https://github.com/lensfun/lensfun at revision `7314a049f33b89f8a59ae3d7c65a086cc1a85dc6`.

The database and this adaptation are licensed under **Creative Commons Attribution-ShareAlike 3.0 Unported**. Full terms are in `COPYING`. Attribution: Lensfun project and its database contributors, https://lensfun.github.io/.

Changes: converted XML to JSON, retained camera identities/crop factors/mounts and supported rectilinear lens calibration records, excluded projection types and off-center calibrations unsupported by this renderer. Numeric calibration values are unchanged. The application uses exact normalized model matching and linear focal interpolation inside the measured range; it does not reproduce Lensfun's fuzzy matcher or spline interpolator.

Regenerate reproducibly with `python3 scripts/import-lensfun.py /path/to/checked-out/lensfun`. Review the upstream revision before updating. No download happens at build time or when Auto is clicked. Existing edits retain a coefficient snapshot so updates do not silently change exports.
