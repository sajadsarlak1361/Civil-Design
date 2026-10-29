# Civil Design

Civil Design is an offline drafting and terrain application for TIN surfaces, contours, alignments, profiles, corridors, and tunnel sections cut from a 3D mesh. The same project opens in a browser and in the Windows and Linux desktop app.

Civil Design is an independent product by Sajad Sarlak. It is not affiliated with, endorsed by, or sponsored by any other CAD software vendor.

This repository is [sajadsarlak1361/Civil-Design](https://github.com/sajadsarlak1361/Civil-Design). The window title is Civil Design. Installers use the file name `Civil-Design`. Project files keep the `.fieldline` extension.

![Plan view: compact ribbon, layers, and the command line](docs/images/plan-view.png)

*Screenshot placeholder. Add `docs/images/plan-view.png`.*

![3D view of a TIN and a ball-pivoting mesh](docs/images/mesh-3d.png)

*Screenshot placeholder. Add `docs/images/mesh-3d.png`.*

![Tunnel section with overbreak and underbreak](docs/images/tunnel-section.png)

*Screenshot placeholder. Add `docs/images/tunnel-section.png`.*

## What it does

- Drafting follows familiar CAD command names: line, polyline, arc, circle, text, hatch, dimensions, blocks, and the modify tools (move, copy, rotate, scale, mirror, offset, trim, extend, fillet, chamfer, erase, explode, join, stretch, PEDIT).
- The menu bar is File, Edit, View, and Help. The ribbon is compact: double-click a tab or use the corner control to cycle full panels, titles, and tabs.
- Layers have color, on/off, freeze, lock, linetype, and lineweight. Each object can override color and can be locked on its own.
- The Properties palette edits the selection. Match Properties and Quick Select sit beside it.
- External references attach DXF, Civil Design drawings, and PNG or JPEG images, with overlay, bind, XBIND, and rectangular or polygonal XCLIP.
- `WBLOCK` writes a block definition to a DXF file.
- Surfaces are Delaunay TINs, with boundaries, breaklines, contours, elevation and slope shading, and TIN-to-TIN or surface-to-datum volumes.
- `CREATE3DMESH` builds a 3D mesh with ball pivoting, so a scan can keep a wall or an overhang. `MESHSECTION` cuts that mesh on a vertical plane and reports overbreak and underbreak against a design section.
- Alignments take tangents, circular curves, and Euler spirals. Profiles, sample lines, sections, offset alignments, superelevation, assemblies, corridors, intersections, grading, parcels, and mass haul are on the design ribbon.
- File formats include the Civil Design project, DXF (the drawing interchange: lines, polylines, points, and basic 3D, read and written in the app), LandXML, point files, ASCII DEM, a limited GeoTIFF, LAS 1.2, shapefile, images, PDF plot, and OBJ, STL, and glTF meshes. LAZ opens the file dialog after the command line explains that a decompressor is not bundled. Binary drawing files are not a menu format.
- Profile and section views are placed with a click on the plan. Esc cancels.
- Heavy TIN builds use a worker pool. A cloud of 25,000 points or more triangulates off the main thread. A mesh of 800 points or more is rebuilt in its own worker.
- The page does not request the network after it loads. Fonts and the TIN worker are inside the build.

Pipe networks and the survey tools (field book, figures, traverse adjustment) are implemented in `src/engine` and switched off in `src/features.ts`. The ribbon hides them. Typing those commands answers `not available in this version`.

A familiar CAD command name that Civil Design has not built answers `that command is not in this build`. The full list of commands that do run is in [docs/commands-and-shortcuts.md](docs/commands-and-shortcuts.md).

## Download

| Build | Where |
| --- | --- |
| Desktop installers | [Releases](https://github.com/sajadsarlak1361/Civil-Design/releases) |
| Browser | [https://sajadsarlak1361.github.io/Civil-Design/](https://sajadsarlak1361.github.io/Civil-Design/) |

The Pages workflow publishes `dist-web` from `main` to that site.

A published release attaches the Windows NSIS setup and MSI, the Linux `.deb` and AppImage, and `civil-design.html` (the same page as the web app, opened from disk). Each file is its own download. The MSI and the setup executable are separate, and each stays under GitHub's 2 GB asset limit. The Desktop workflow publishes that release when a `v*` tag is pushed. Running the workflow by hand publishes a prerelease.

Windows setup embeds Microsoft's WebView2 offline installer. The machine that runs setup does not need a network. The Windows build is unsigned. SmartScreen may say Windows protected your PC. Choose **More info**, then **Run anyway**.

The Linux `.deb` depends on WebKitGTK 4.1. The AppImage expects that library on the machine as well.

Details: [docs/getting-started.md](docs/getting-started.md) and [docs/building-and-releasing.md](docs/building-and-releasing.md).

## Build from source

Requirements: Node.js 22, npm, and a Rust toolchain at 1.77.2 or newer when you build the desktop shell. The web page does not need Rust.

```bash
npm install
npm run dev          # http://127.0.0.1:43123
npm run build        # dist/, used by the Tauri shell
npm run build:web    # dist-web/index.html for GitHub Pages
npm run build:single # dist-single/civil-design.html
npm test             # run build:web first; the offline check requires dist-web
```

Desktop, from `src-tauri`, after the Tauri CLI is installed:

```bash
cargo tauri dev
cargo tauri build
```

`beforeDevCommand` and `beforeBuildCommand` in `src-tauri/tauri.conf.json` are `npm run dev` and `npm run build`. npm finds the repository `package.json` from `src-tauri`. See [docs/building-and-releasing.md](docs/building-and-releasing.md).

CI builds Windows (`nsis`, `msi`) and Linux (`deb`, `appimage`) with `beforeBuildCommand` set to `npm run build`. Platform package lists are in [docs/building-and-releasing.md](docs/building-and-releasing.md).

## Documentation

| Guide | Contents |
| --- | --- |
| [Getting started](docs/getting-started.md) | Sample project, first surface, save |
| [User guide](docs/user-guide.md) | Each menu and ribbon tool |
| [Commands and shortcuts](docs/commands-and-shortcuts.md) | Commands that run, aliases, keys |
| [File formats](docs/file-formats.md) | Project, DXF, LandXML, point clouds |
| [Tunnel sections](docs/tunnel-sections.md) | Ball-pivoting mesh and MESHSECTION |
| [Architecture](docs/architecture.md) | Layout of the source |
| [Building and releasing](docs/building-and-releasing.md) | npm, Tauri, GitHub Actions |
| [Contributing](docs/CONTRIBUTING.md) | Tests, offline check, license |

## About the author

[Sajad Sarlak](https://github.com/sajadsarlak1361) is an AI / Data Scientist and BIM Modeling Expert, with 20 years of experience in design for geomatics and civil engineering projects. Civil Design is his project: civil and infrastructure design and tunnel analysis software that combines BIM, data science, and high-performance computing.

| | |
| --- | --- |
| Education | M.Sc. in GIS and Remote Sensing, University of Tehran |
| Email | [Sajadsarlak@gmail.com](mailto:Sajadsarlak@gmail.com) |
| GitHub | [github.com/sajadsarlak1361](https://github.com/sajadsarlak1361) |

## Copyright

Copyright (c) 2026 Sajad Sarlak. All rights reserved.

Sajad Sarlak holds the copyright in the Civil Design code and branding. Drawing interchange is DXF. A LibreDWG module remains in the repository for tests and stays under GPL-3.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
