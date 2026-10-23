# Architecture

Civil Design is a React 19 and Vite 6 application. Geometry does not import React, so the TIN, contour, volume, and mesh code can run under Vitest without a browser.

## Layout

```
src/engine       TIN, contours, volumes, alignments, corridors, mesh, formats. No React.
src/commands     classic.pgp, the parser, and the command-line runtime
src/components   Menu bar, ribbon, canvases, palettes, dialogs
src/state        Project store: surfaces, alignments, civil objects, drawing
src/view         Cameras, workspace chrome, plan drawing
src/lib          Desktop file dialogs, downloads, the UI bus
src/offline      The check that the page does not name a remote URL
src-tauri        Tauri v2 shell. Crate name fieldline, library fieldline_lib
scripts          Sample generator, offline check, DWG sample generator, benchmark
public/samples   Synthetic point files
```

`src/brand.ts` holds the user-facing name Civil Design, the version, and the copyright line. Project files, the `localStorage` key `fieldline.dwg`, the clipboard format `fieldline-clipboard`, and the xref kind `fieldline` keep the `fieldline` identifier.

## How a command runs

`src/commands/catalog.ts` parses `src/commands/classic.pgp` (the classic CAD alias table) and marks a name implemented only if it is in `IMPLEMENTED_COMMANDS` or `HOME_COMMANDS`. `src/features.ts` retires pipe and survey names while those flags are false. The runtime in `src/commands/runtime.ts` then either:

- starts a drawing session (`src/commands/session.ts` and `src/commands/homeSession.ts`), which prompts for points and keywords, or
- runs an immediate action: file, view, layer palette, or a civil dialog.

`src/engine/commands.ts` is the label and hint for each civil dialog. `src/engine/runCommand.ts` is the geometry behind those dialogs.

Ribbon panels are `src/components/Ribbon.tsx`, `DraftRibbon.tsx`, and the names in `ribbonCatalog.ts`. File and Insert rows are the arrays in `src/components/fileMenu.ts`.

## Surfaces and mesh

| Module | Role |
| --- | --- |
| `src/engine/tin.ts` | Delaunay TIN via Delaunator. Triangles are stored counterclockwise. Breaklines and boundaries are enforced afterwards. |
| `src/engine/contours.ts` | Marching contours. The app smooths them with two Laplacian passes. Tests call the unsmoothed polylines. |
| `src/engine/volume.ts` | TIN-to-TIN clip, then the prismoidal formula. Depth is comparison elevation minus base elevation. |
| `src/engine/bvh.ts` | Flat triangle BVH for profiles and the cursor. |
| `src/engine/mesh.ts` | Ball pivoting. Points stay where the scan put them. |
| `src/engine/meshSection.ts` | Triangle–plane sections, closed loops, overbreak and underbreak. |
| `src/engine/alignment.ts`, `fresnel.ts`, `vertical.ts` | Horizontal curves, clothoids, symmetric vertical parabolas. |
| `src/engine/corridor.ts`, `assembly.ts`, `masshaul.ts`, `superelevation.ts` | Corridor, assembly, mass haul, AASHTO superelevation. |

A surface keeps its original survey points. Rebuilds triangulate from those points. LandXML faces are kept until a rebuild.

## Workers

`src/engine/budget.ts` sizes the pool. The default CPU limit is 70% of `hardwareConcurrency`, at least one worker, and never every core when the machine has more than one. The limit is stored in `localStorage` as `fieldline.cpuLimit`.

| Worker | When |
| --- | --- |
| `src/engine/heavy.worker.ts`, pooled by `pool.ts` | TIN builds of 25,000 points or more (`surfaceWork.ts`). Also binary imports of at least 500,000 bytes and text imports of at least 750,000 characters (`importWork.ts`): LAS, GeoTIFF, DEM, OBJ, STL, glTF. |
| `src/engine/mesh.worker.ts` | Ball pivoting and mesh sections when the cloud has at least 800 points (`meshAsync.ts`). |
| `src/engine/formats/dwg.worker.ts` | LibreDWG read. The worker is an inline blob, so the single-file page does not fetch a script. |

The status bar reads `src/engine/tasks.ts` for the busy headline, stage, and cancel.

## Desktop shell

`src-tauri/tauri.conf.json` sets `productName` to `Civil-Design`, `mainBinaryName` to `civil-design`, the identifier `com.civildesign.app`, and the window title Civil Design. `beforeBuildCommand` is `npm run build`. The frontend dist is `../dist`. File associations use the `.fieldline` extension.

`src/lib/desktopFiles.ts` calls the Tauri dialog plugin and the `read_bytes` / `write_bytes` commands when `window.__TAURI_INTERNALS__` exists. The browser build uses downloads and `<input type="file">` instead. `src-tauri` also watches an xref path.

## Offline build

Vite `base` is `./`. `npm run build:single` and `npm run build:web` use the single-file plugin and inline IBM Plex (latin, latin-ext, cyrillic, cyrillic-ext, greek, vietnamese) and the LibreDWG module. `scripts/check-offline.ts` scans `index.html`, `src/`, `public/`, `dist/` when that build exists, `dist-single/civil-design.html`, and `dist-web/index.html`. It allows the SVG, XHTML, and MathML namespace identifiers, and the LandXML 1.2 export namespace. Those strings are not fetched. `data:` URIs are stripped before the scan. A root-absolute `src` or `href` fails the pages build.

## Tests

`npm test` runs Vitest on `src/**/*.test.ts` in the Node environment, then the offline check. The offline check requires `dist-web/index.html`, so run `npm run build:web` first. `npm run benchmark` times the TIN, contours, BVH, and volume routines on synthetic grids. It is not part of `npm test`.

One recorded run, kept here as a measurement and not as a limit:

| Routine | Data | Time | Check |
| --- | --- | --- | --- |
| Delaunay TIN | 1,000,000 points, 1,996,002 triangles | 4.82 s | elevation error 0 on `z = 2x + 0.5y` |
| Marching contours | same TIN, 500-unit interval | 2.15 s | 4 polylines |
| BVH build | same TIN | 4.50 s | |
| 100,000 elevation queries | BVH / uniform grid | 339 ms / 593 ms | 0 mismatches |
| TIN-to-TIN volume | 250,000 points on each surface | 8.06 s | fill 249,001, cut 0 |

## Sample data

| File | Contents |
| --- | --- |
| `public/samples/existing-ground-pnezd.csv` | Synthetic existing ground, PNEZD, meters |
| `public/samples/proposed-pad-pnezd.csv` | Synthetic pad at elevation 102.850 with 2:1 daylight, PNEZD, meters |

Regenerate with `npm run generate-samples` (`scripts/generate-samples.mjs`). CI builds a sample DWG with native LibreDWG (`scripts/generate-dwg-samples.mjs`) before the tests. That native binary is only a test fixture. The app reads DWG with the bundled WebAssembly module.
