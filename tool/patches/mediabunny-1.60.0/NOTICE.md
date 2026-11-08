# MediaBunny 1.60.0 lifecycle patch

MediaBunny is copyright (c) 2026-present, Vanilagy and contributors, and licensed under MPL-2.0 (LICENSE). These modified MediaBunny source files remain under MPL-2.0; original file notices are retained.

LumaChord changes source closure to return its cached completion promise and await muxer EOF, releases muxer locks after failures, closes custom encoders after failed serialized work, and waits for every source/target cleanup while preserving the first observed failure. Cancellation before closure uses forced cleanup. No media padding, trimming, or duration policy is added.

The repair covers the published modular ESM entry and its MediaSource.close Promise<void> declarations. The obsolete modular declaration-map link is removed because upstream offsets no longer match the modified source. CommonJS and standalone bundles are unmodified and outside this contract. LumaChord's build verifies the actual core and codec-extension resolution path and excludes the cohort from dependency prebundling.

Modified preferred TypeScript source is included in src/ beside this notice; upstream.diff records every source/runtime/declaration change, and patch.json records complete original/patched SHA-256 values and reproducible line edits.

Original unmodified source is available at https://github.com/Vanilagy/mediabunny/tree/v1.60.0 and the exact npm source archive https://registry.npmjs.org/mediabunny/-/mediabunny-1.60.0.tgz . A fresh install reconstructs the modification using the repository's Node-only tool/patch-mediabunny.mjs.

This local patch is temporary. Rebase or remove it only after upstream API/error/cleanup behavior passes the lifecycle and content regressions described in ADR-0123. Cancellation of a permanently stalled custom encoder is not guaranteed.

Conversion amendment: cancellation owns one joined cleanup operation; setup and pump failures wait for it while preserving the exact primary reason. Metadata/start admission guards prevent new producer work after cancellation, and pause listeners are removed on covered failures. The caller retains ownership of borrowed Input, including initialization failures before a Conversion handle exists. Already-admitted noncooperative reads/flushes remain cooperative limits; existing finalization/done semantics are unchanged. The obsolete Conversion declaration-map link is removed; public execute/cancel Promise<void> signatures are unchanged.
