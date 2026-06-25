# Releasing & Versioning

A simple, drift-free scheme: one official version, and a build number that acts
as our internal patch sub-version. Every Windows build is traceable and lands in
its own versioned folder.

## Version scheme

- **Official version** (e.g. `0.3.1`) is the single source of truth in
  `src-tauri/Cargo.toml` under `[workspace.package] version`. The app, the CLI
  and `branding.rs` (via `CARGO_PKG_VERSION`) all read from there, so they can
  never disagree. `package.json` and `src-tauri/tauri.conf.json` mirror it; CI
  refuses to build on a mismatch.
- **Patch sub-version** is the CI build number (`github.run_number`). Between two
  official versions we can ship as many internal patches as we want just by
  rebuilding; each gets a fresh, increasing build number.

So a build is identified as `v<version>-build<n>`, e.g. `v0.3.1-build42`.

## Release folder layout

The Windows CI lays every build out as:

```
release-out/
  0.3.1/
    build-41/
      NKK-Secure-Access-Setup-v0.3.1-build41.exe
      NKK-Secure-Access-Setup-v0.3.1-build41.exe.sig
    build-42/
      NKK-Secure-Access-Setup-v0.3.1-build42.exe
      ...
  0.3.2/
    build-50/
      ...
```

The whole `release-out/<version>/build-<n>/` folder is uploaded as the GitHub
Actions artifact `NKK-Secure-Access-Windows-v<version>-build<n>`. Download it
from the workflow run and you have the finished `.exe`.

## Cutting a new official version

1. Bump `[workspace.package] version` in `src-tauri/Cargo.toml`.
2. Mirror the same value in `package.json` and `src-tauri/tauri.conf.json`.
3. Add a `## [x.y.z]` section to `CHANGELOG.md`.
4. Commit. Pushing builds Windows; tagging `vx.y.z` also publishes a Release.

## Shipping an internal patch (same official version)

Just rebuild (push, or re-run the workflow). The official version stays the
same; the build number increments, so `v0.3.1-build43` is the patch after
`v0.3.1-build42`. Nothing else to change.
