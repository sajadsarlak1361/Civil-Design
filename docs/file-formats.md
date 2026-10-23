# File formats

File → Import and File → Export list every format. A row Civil Design cannot read or write stays in the menu, greyed out, with the reason on the tooltip. The catalog is `FORMAT_CATALOG` in `src/engine/formats/status.ts`.

| Format | Extensions | Read | Write | What the code does |
| --- | --- | --- | --- | --- |
| Civil Design project | `.fieldline`, `.fieldline.json` | yes | yes | JSON, format id `fieldline-project`, version 1. Drawing entities and xrefs are included. Desktop save uses `.fieldline`. The browser download uses `.fieldline.json`. |
| DXF | `.dxf` | yes | yes | ASCII and binary DXF. Entities: POINT, LINE, LWPOLYLINE, CIRCLE, ARC, TEXT, 3DFACE. |
| DWG / DWT | `.dwg`, `.dwt` | yes | yes | See below. |
| LandXML | `.xml`, `.landxml` | yes | yes | Surfaces (`Pnts` / `Faces`), CgPoints, alignments, and profiles. Export is LandXML 1.2. |
| Point file | `.csv`, `.txt`, `.xyz` | yes | yes | PNEZD, PENZD, PNEZ, PENZ, NEZ, ENZ, and XYZ. Delimiters are comma, whitespace, or tab. |
| ASCII DEM | `.asc` | yes | yes | ESRI ASCII grid, and an XYZ grid of cell centers. |
| GeoTIFF | `.tif`, `.tiff` | partial | partial | Uncompressed float32 with a tie point and a pixel scale. LZW, JPEG, Deflate, and PackBits are refused. |
| LAS | `.las` | yes | yes | LAS 1.2, point record format 0 (20 bytes). |
| LAZ | `.laz` | no | no | The menu item explains that a decompressor is not bundled, then opens the file dialog. A `.laz` file is still refused. Export the cloud as LAS. |
| Shapefile | `.shp` | yes | yes | Point, polyline, and polygon. Attributes in `.dbf` are not read. |
| Image | `.png`, `.jpg`, `.jpeg` | yes | partial | Attach reads width and height. PNG export is the current view. |
| PDF | `.pdf` | no | yes | One-page Flate RGB plot. A PDF underlay is not bundled. |
| SVG | `.svg` | no | yes | File → Export → SVG writes the drawing entities. There is no SVG import. |
| OBJ | `.obj` | yes | yes | Triangle mesh. Coordinates are easting, northing, elevation. |
| STL | `.stl` | yes | yes | ASCII STL triangles. |
| glTF | `.gltf` | yes | yes | glTF 2.0, Y-up, geometry kept inside the file. |
| PLY | | | yes | `EXPORT` can write a mesh as PLY. There is no PLY import row. |

Open accepts those extensions in one picker. The desktop filters are in `src/lib/desktopFiles.ts`. Classification is `classifyFile` in `src/engine/formats/ingest.ts`. A binary larger than 500,000 bytes, or text longer than 750,000 characters, parses on the worker pool when the pool is available.

## Project file

`SAVE`, `QSAVE`, and `SAVEAS` all call `saveProject`. They write the project JSON. They do not open a DWG or DXF save dialog. `DXFOUT` is a `classic.pgp` alias of `SAVEAS`, so it saves the project too. To write a DXF, use File → Export → DXF or the `EXPORT` command.

The unit (meters or feet) is a label for LandXML, stationing, and the volume report. Switching it does not convert stored coordinates.

## DWG

LibreDWG reads and writes DWG offline in the browser and on the desktop. No other program is required for reading, or for writing DWG 2000 and DWG 2004.

The reader is LibreDWG 0.14, packaged as `@mlightcad/libredwg-web` 0.8.2. The first DWG open loads it in a worker. It reads R14 through 2018. That published package does not include a writer, so Civil Design also bundles a second LibreDWG module, built with the write API from commit `a8ccb1f3`. The wrapper is `src/engine/formats/vendor/cd-dxf2dwg.c`. GPL-3.0 credit is in `THIRD_PARTY_NOTICES.md`.

File → Export → DWG writes a DWG file. File → Save, Save As, and `DXFOUT` still write the project JSON.

**Browser and `civil-design.html`.** Open and Export → DWG both use the bundled LibreDWG modules. There is no converter in the page. DWG 2000 and DWG 2004 are written directly. A newer save version still produces a DWG 2000 file, and the message includes the download address for ODA File Converter.

**Desktop.** File → DWG Settings stores the engine in `localStorage` under `fieldline.dwg`. The default save version is DWG 2000.

| Engine | Behavior |
| --- | --- |
| Auto | Write DWG 2000 or DWG 2004 with LibreDWG. For 2007 and later, use ODA File Converter when it is found. Otherwise write DWG 2000 and show the download address. |
| LibreDWG | Always the bundled reader and writer. Newer versions are saved as DWG 2000. |
| ODA | Require ODA File Converter. |

ODA is not shipped. The download address is `https://www.opendesign.com/guestfiles/oda_file_converter`. Windows looks in `Program Files\ODA\ODAFileConverter` and in versioned folders beside it. Linux looks at `/usr/bin/ODAFileConverter`, `/usr/local/bin/ODAFileConverter`, `/opt/ODAFileConverter/ODAFileConverter`, and `ODAFileConverter` under the home directory. You can set another path in DWG Settings.

LibreDWG encodes 2000 and 2004. It does not encode 2007, and 2010 through 2018 writes are still planned upstream. Those versions are written only when ODA File Converter is installed. A DWG 2004 file from this writer is much larger than the same drawing saved as DWG 2000.

Mapped drawing entities are line, polyline, arc, circle, text, point, 3DFACE, and block inserts. Other entity types are skipped.

## Point clouds

File → Import → LAS reads LAS 1.2 point format 0 into survey points. File → Export can write the same record. LAZ is detected and refused, including a LAS file whose header names laszip.

The 3D mesh dialog accepts XYZ or CSV. If the chosen file is `.las` or `.laz`, the dialog reports that those formats are not supported there and asks for XYZ or CSV. Import the LAS first, then build the mesh from COGO points, a point group, selected drawing points, or the active surface.

Clouds above 200,000 points are voxel-downsampled for the 3D point display. Plan points keep one mark per four screen pixels.

## LandXML and meshes

LandXML import keeps faces until you rebuild. A rebuild triangulates from the stored survey points, so a boundary edit does not bake the previous mesh into the next one.

OBJ, STL, and glTF import as triangle meshes. `EXPORT` also offers contours, triangles, LandXML, a volume CSV, and a section report.
