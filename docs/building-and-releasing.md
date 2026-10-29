# Building and releasing

## Requirements

| Tool | Used for |
| --- | --- |
| Node.js 22 and npm | The page, tests, and the frontend the desktop shell loads. CI uses Node 22. |
| Rust 1.77.2 or newer | `src-tauri`. `Cargo.toml` sets `rust-version` to 1.77.2 and edition 2021. |
| Tauri CLI 2 | `cargo install tauri-cli --version "^2.0.0"`, or the `tauri-apps/tauri-action` used in CI. |
| WebKitGTK 4.1 and the Linux packages below | Linux desktop builds only. |
| WebView2 | Windows installs it from the offline installer embedded in setup. The build machine downloads that installer once. |

The browser build does not need Rust.

## Web and tests

```bash
npm install
npm run dev
npm run build
npm run build:single
npm run build:web
npm test
```

| Script | Output |
| --- | --- |
| `npm run dev` | Vite on [http://127.0.0.1:43123](http://127.0.0.1:43123). `vite.config.ts` sets the port. |
| `npm run build` | Typecheck (`tsc -b`) and `dist/`. Tauri's `frontendDist` is this folder. |
| `npm run build:single` | `dist-single/civil-design.html` and `dist-single/index.html` (the same page), then the offline check. |
| `npm run build:web` | `dist-web/index.html`, `dist-web/civil-design.html`, and `dist-web/.nojekyll`, then the offline check on that folder. |
| `npm test` | Vitest, then `scripts/check-offline.ts --require-web`. `dist-web/index.html` must already exist. |
| `npm run benchmark` | Synthetic grids. Not part of `npm test`. |
| `npm run generate-samples` | Rewrites `public/samples`. |

`base` is `./`, so `dist/` and `dist-web/` load from any URL path and from `file://`. A push to `main` runs `.github/workflows/pages.yml`. That workflow builds `dist-web` and publishes it with `actions/deploy-pages` from this repository. The page is [https://sajadsarlak1361.github.io/Civil-Design/](https://sajadsarlak1361.github.io/Civil-Design/). In the repository settings, set GitHub Pages to deploy from GitHub Actions.

## Desktop

From `src-tauri`:

```bash
cargo tauri dev
cargo tauri build
```

`beforeDevCommand` is `npm run dev`. `beforeBuildCommand` is `npm run build`. Both are npm scripts. npm searches parent directories for `package.json`, so the commands run correctly from `src-tauri`. Leave `beforeBuildCommand` as `npm run build`.

`tauri.conf.json` has no separate installer file-name field in this Tauri version, so `productName` is `Civil-Design` (with the hyphen). The window title is Civil Design. The bundle id is `com.civildesign.app`. The installed program name is `civil-design`.

A 0.2.3 build produces:

| Platform | Files |
| --- | --- |
| Windows x64 | `Civil-Design_0.2.3_x64-setup.exe`, `Civil-Design_0.2.3_x64_en-US.msi` |
| Linux x64 | `Civil-Design_0.2.3_amd64.deb`, `Civil-Design_0.2.3_amd64.AppImage` |

Windows uses NSIS per-user install and `webviewInstallMode: offlineInstaller`. That offline installer is inside both the MSI and the setup executable, which is why each Windows file is about 210 MB. The Actions artifact that holds both files is about 438 MB. The release uploads the MSI and the setup executable as two assets.

Linux packages need the same libraries CI installs:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

## GitHub Actions

`.github/workflows/desktop.yml` runs on pull requests, on tags that start with `v`, and on `workflow_dispatch`. It does not run on a push to `main`.

1. **test** (Ubuntu): `npm ci`, build LibreDWG's `dxf2dwg` to generate sample DWG fixtures, `npm run build:single`, `npm run build:web`, `npm test`. Uploads `civil-design.html` and `dist-web/index.html`.
2. **desktop**: Windows (`nsis`, `msi`) and Ubuntu 22.04 (`deb`, `appimage`), after test. `tauri-action` uses `projectPath: src-tauri`.
3. **stage-assets**: copies the MSI, NSIS setup, `.deb`, AppImage, and `civil-design.html` into one flat directory. It fails if one of those files is missing, empty, or at least 2 GiB. Pull requests run this job and do not publish.
4. **release**: skipped on pull requests. On a tag or a manual run it publishes a GitHub Release that is not a draft and attaches those five files as separate assets. A manual run is marked prerelease and tagged `desktop-<sha>`. The job then reads the release back and fails if it is still a draft or if an asset is missing.

The Windows installer is unsigned.

`.github/workflows/pages.yml` runs on a push to `main` and from the Actions tab. It does not run on pull requests. The deploy job uses `actions/upload-pages-artifact` on `dist-web` and `actions/deploy-pages`. Releases stay on [https://github.com/sajadsarlak1361/Civil-Design/releases](https://github.com/sajadsarlak1361/Civil-Design/releases).

## Repository listing

GitHub's About description has a 350-character limit. Use the opening paragraph of `README.md`:

> Civil Design is an offline drafting and terrain application for TIN surfaces, contours, alignments, profiles, corridors, and tunnel sections cut from a 3D mesh. The same project opens in a browser and in the Windows and Linux desktop app.

Suggested topics:

`civil-engineering` `cad` `surveying` `tin` `contours` `landxml` `dxf` `dwg` `point-cloud` `tauri` `offline` `typescript` `react` `webassembly`

The repository URL is [https://github.com/sajadsarlak1361/Civil-Design](https://github.com/sajadsarlak1361/Civil-Design). The website field can point at [https://sajadsarlak1361.github.io/Civil-Design/](https://sajadsarlak1361.github.io/Civil-Design/).
