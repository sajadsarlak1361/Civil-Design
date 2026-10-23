# Contributing

Civil Design is the application in [sajadsarlak1361/Civil-Design](https://github.com/sajadsarlak1361/Civil-Design). Changes that ship in the desktop installers or the single-file page are distributed under GPL-3.0 because those builds include LibreDWG. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

Copyright (c) 2026 Sajad Sarlak. All rights reserved.

Sajad Sarlak holds the copyright in the Civil Design code and branding. That notice does not remove any right GPL-3.0 grants for LibreDWG or for a build that includes it. Do not add a term that forbids copying, modification, or distribution that GPL-3.0 allows. ODA File Converter is separate software and is not part of the build.

## Setup

Node.js 22:

```bash
npm install
npm run build:web
npm test
```

`npm test` runs Vitest and `scripts/check-offline.ts --require-web`. The offline check fails if `dist-web/index.html` is missing, so build the web page first. `npm run lint` runs ESLint.

Desktop changes also need Rust 1.77.2 or newer and the Tauri CLI. See [building-and-releasing.md](building-and-releasing.md).

## What to keep stable

- The app stays offline. Do not add a CDN, a font stylesheet, a tile server, a remote image, or a worker URL. `scripts/check-offline.ts` scans `index.html`, `src/`, `public/`, and the built pages. Namespace strings that are not fetched (SVG, XHTML, MathML, LandXML 1.2) are the allowlist. `data:` URIs are ignored. A root-absolute `src` or `href` fails the pages build.
- Keep LibreDWG in the desktop and web builds, and keep DWG Settings on Auto, LibreDWG, and ODA. Credit it in `THIRD_PARTY_NOTICES.md`.
- `beforeBuildCommand` in `src-tauri/tauri.conf.json` stays `npm run build`.
- `productName` stays `Civil-Design`. The window title stays Civil Design. The identifier stays `com.civildesign.app`.
- Internal identifiers stay `fieldline`: the project extension, the format id `fieldline-project`, the `localStorage` key `fieldline.dwg`, the clipboard format, the xref kind, and the Rust crate `fieldline` / library `fieldline_lib`.
- User-facing copy uses Civil Design. `src/brand.ts` is the source for the name, version, and copyright line.

## Code map

Geometry belongs in `src/engine` and must not import React. Command behavior belongs in `src/commands`. A new command that actually runs has to be added to `IMPLEMENTED_COMMANDS` or `HOME_COMMANDS` and handled by the session runner or `immediate` in `src/commands/runtime.ts`. A name that is only recognized should stay out of the user guide.

`src/features.ts` turns pipe networks and survey off. Leaving a flag false means the ribbon hides those tools and the command line says they are not available. Document the flag, not a hidden tool as if it were on the ribbon.

## Tests

Add or update a Vitest file next to the module you change. `npm test` is the check CI runs after it generates DWG fixtures with native LibreDWG. Do not require ODA File Converter. It is not installed in CI.

`npm run benchmark` is optional and is not part of CI.

## Documentation

Describe behavior that the current source implements. Menus, formats, and commands are the arrays in `src/components/fileMenu.ts`, `src/components/ribbonCatalog.ts`, `src/engine/formats/status.ts`, and `src/commands/catalog.ts`. When a command is recognized and not implemented, say so. The guides live in `docs/` and the public summary is `README.md`.

## Pull requests

The Desktop workflow runs on pull requests. The release job does not. A green pull request means the test job and the Windows and Linux installer jobs passed. Publishing a release is a `v*` tag or a manual run of that workflow, done separately from review.
