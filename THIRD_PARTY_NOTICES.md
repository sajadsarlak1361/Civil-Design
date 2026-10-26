Copyright (c) 2026 Sajad Sarlak. All rights reserved.

# Third-party notices

Civil Design includes [LibreDWG](https://www.gnu.org/software/libredwg/) compiled to WebAssembly by the `@mlightcad/libredwg-web` package (version 0.8.2).

LibreDWG is free software under the GNU General Public License, version 3. Because Civil Design ships that library inside the application and the single-file page, those builds are distributed under GPL-3.0 as well. Source for this program is the repository that produced the build. Source for LibreDWG is the GNU project and the `@mlightcad/libredwg-web` package.

The reader module reads DWG and DWT (R14 through 2018). Civil Design also bundles a LibreDWG writer module, built from LibreDWG commit `a8ccb1f3` with the write API enabled. The project wrapper is `src/engine/formats/vendor/cd-dxf2dwg.c`. That module writes DWG 2000 and DWG 2004. The 2007 release write is known not to work in this LibreDWG, and 2010 through 2018 writes are still planned upstream.

ODA File Converter is not part of Civil Design and is not covered by the GPL. It is optional, and only for those newer versions. The application shows its download address when a newer version is requested and the converter is not installed.
