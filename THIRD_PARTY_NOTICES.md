Copyright (c) 2026 Sajad Sarlak. All rights reserved.

# Third-party notices

Civil Design includes [LibreDWG](https://www.gnu.org/software/libredwg/) compiled to WebAssembly by the `@mlightcad/libredwg-web` package (version 0.8.2).

LibreDWG is free software under the GNU General Public License, version 3. Because Civil Design ships that library inside the application and the single-file page, those builds are distributed under GPL-3.0 as well. Source for this program is the repository that produced the build. Source for LibreDWG is the GNU project and the `@mlightcad/libredwg-web` package.

The bundled WebAssembly module reads DWG and DWT (R14 through 2018). That build does not include the DWG writer. Writing a DWG on the desktop uses ODA File Converter when you install it separately. ODA File Converter is not part of Civil Design and is not covered by the GPL.

LibreDWG's own DXF-to-DWG writer, used to generate the sample files in CI, currently encodes DWG 2000 and 2004 reliably. The 2007 release write is known not to work in this LibreDWG, and 2010 through 2018 writes are still planned upstream. ODA File Converter is the path that writes those versions.
