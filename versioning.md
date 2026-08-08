# Versioning

This repo has two separate, related version numbers. They match, are bumped simultaneously, and are read by different things.

## 1. User-facing display version

Format: `X.Y.Z` or `vX.Y.Z-mA.B.C` (e.g. `2.9.3-m1.1.0`). This is the version players actually see in-game and in release notes.

| Location | Role |
|---|---|
| `public/json/version.json` (`version` field) | Source of truth - fetched at runtime by `App.js` (sets `app.version`, which is also stamped into exported level JSON), `OriginPageHome.vue`, and `BubblePageHome.vue`; this is what's displayed in-game |
| `public/manifest.json` (`version` field) | **Deliberately separate** - this file is also the browser-extension/PWA manifest, so its `version` field is managed independently for extension-store purposes and is never read for in-game display. Keep it in sync with `version.json` by convention, but nothing in the app enforces that |
| `public/json/changelog.json` | Full version history shown in-app; each entry has its own `version` + `revisions` list. The **last** entry should always match `version.json`'s current `version` |
| `extension-description.md` | Changelog text used for store listings (e.g. browser extension description); the top entry should match the current version |

**To bump:** update `public/json/version.json`'s `version`, update `public/manifest.json`'s `version` to match (by convention), add a new entry to the end of `public/json/changelog.json` describing what changed, and add a matching entry to the top of `extension-description.md`. All should agree on the current version string.

This split exists specifically so no in-game/display code path can accidentally read the wrong file (see "Known historical bug" below) - `version.json` has exactly one job and nothing else writes or reads it.

The `-mA.B.C` suffix (e.g. `-m1.1.0`) appears on some versions but not others (compare `2.9.2` vs `2.9.2-m1.0.0` vs `2.9.3` vs `2.9.3-m1.1.0` in the changelog). What exactly the `m` segment tracks isn't written down anywhere in the repo - if you know, it's worth adding a line here.

## 2. Technical/build version

Format: plain semver (`X.Y.Z`), currently unrelated in scale/meaning to the display version above (e.g. `1.1.0` vs `2.9.3-m1.1.0` - don't expect these numbers to line up).

| Location | Role |
|---|---|
| `package.json` (`version` field) | npm package version; also used by `files/js/build-extension.js` to name the extension zip files (`boxel-3d-${version}-chrome.zip` etc.) |
| `files/json/firefox/manifest.json` (`version` field) | The actual manifest bundled into the Firefox extension build - `build-extension.js` overwrites `dist/manifest.json` with this file's contents before zipping the Firefox package, so **this is the version Firefox's extension store checks/rejects on**, not `public/manifest.json` or `version.json`. Must be bumped by hand alongside `package.json` - nothing keeps them in sync automatically (this was the cause of a recurring "version already exists" Firefox submission error - it sat at `1.0.0` for a long time after everything else moved on) |
| `src-tauri/tauri.conf.json` (`version` field) | Desktop (Tauri) build version - shown in OS-level app info/installers |
| `android/app/build.gradle` (`versionName`/`versionCode`) | Android build version - shown in Play Store/app info |

These are meant to move together when doing a build/release, but there's no automated sync - bumping one doesn't bump the others. As of 2026-08-07, `package.json`, `files/json/firefox/manifest.json`, and `src-tauri/tauri.conf.json` are at `1.2.2`; `android/app/build.gradle` was deliberately left at `1.2.0` (`versionCode 35`) and needs reconciling before cutting an Android build.
