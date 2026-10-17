# FFmpeg notices

LumaStream bundles FFmpeg `9.0.2-28-g669f5ab083` as a shared Windows x64 build
from the BtbN FFmpeg Builds release `autobuild-2026-10-16-13-04`. The archive
SHA-256 is
`337bccf4f9ed8594255572907d0c3c19e673894713d63d92664d846c4ad183c8`.

The bundled executable reports GNU Lesser General Public License version 3 or
later. The full license text is in `COPYING.LGPLv3`. The build configuration
does not enable GPL or nonfree components; Stream communicates with FFmpeg as a
separate process and ships the shared libraries without renaming them.

Corresponding source and build references:

- FFmpeg source at commit [`669f5ab083`](https://github.com/FFmpeg/FFmpeg/tree/669f5ab083).
- [BtbN FFmpeg Builds release](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-16-13-04).
- [BtbN build scripts](https://github.com/BtbN/FFmpeg-Builds).
- [FFmpeg licensing and source requirements](https://ffmpeg.org/legal.html).

The archive is pinned in `apps/stream/script/prepare-media-engine.mjs`; that
script verifies its checksum, license report, and required encoders before it
copies the executable and DLLs into a Stream build.

This private repository contains the license text, build provenance, and
upstream source/build references, but does not yet contain the complete
corresponding source archive and all build materials for this exact binary.
Do not distribute a Stream binary containing this FFmpeg build until that
source package and the applicable LGPL materials are provided with the
distribution.
