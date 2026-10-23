# File formats

File → Import and File → Export list every format. A row Civil Design cannot read or write stays in the menu, greyed out, with the reason on the tooltip. The catalog is `FORMAT_CATALOG` in `src/engine/formats/status.ts`.

| Format | Extensions | Read | Write | What the code does |
| --- | --- | --- | --- | --- |
| Civil Design project | `.fieldline`, `.fieldline.json` | yes | yes | JSON, format id `fieldline-project`, version 1. Drawing entities and xrefs are included. Desktop save uses `.fieldline`. The browser download uses `.fieldline.json`. |
| DXF | `.dxf` | yes | yes | ASCII and binary DXF. Entities: POINT, LINE, LWPOLYLINE, CIRCLE, ARC, TEXT, 3DFACE. |
| DWG / DWT | `.dwg`, `.dwt` | yes | partial | See below. |
| LandXML | `.xml`, `.landxml` | yes | yes | Surfaces (`Pnts` / `Faces`), CgPoints, alignments, and profiles. Export is LandXML 1.2. |
| Point file | `.csv`, `.txt`, `.xyz` | yes | yes | PNEZD, PENZD, PNEZ, PENZ, NEZ, ENZ, and XYZ. Delimiters are comma, whitespace, or tab. |
| ASCII DEM | `.asc` | yes | yes | ESRI ASCII grid, and an XYZ grid of cell centers. |
| GeoTIFF | `.tif`, `.tiff` | partial | partial | Uncompressed float32 with a tie point and a pixel scale. LZW, JPEG, Deflate, and PackBits are refused. |
| LAS | `.las` | yes | yes | LAS 1.2, point record format 0 (20 bytes). |
| LAZ | `.laz` | no | no | Greyed out. LAZ needs a decompressor that is not bundled. Export the cloud as LAS. |
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

LibreDWG 0.14, packaged as `@mlightcad/libredwg-web` 0.8.2, is compiled into the page and the desktop app. The first DWG open loads it in a worker. That module reads R14 through 2018. The published module does not include a DWG writer. GPL-3.0 credit is in `THIRD_PARTY_NOTICES.md`.

**Browser and `civil-design.html`.** Open reads the DWG with LibreDWG. Save As of a DWG writes the DXF that a later `dxf2dwg` step can consume. There is no ODA path in the single-file page.

**Desktop.** File → DWG Settings stores the engine in `localStorage` under `fieldline.dwg`:

| Engine | Behavior |
| --- | --- |
| Auto | Use ODA File Converter when it is found. Otherwise read with LibreDWG and write DXF. |
| LibreDWG | Always the bundled reader. Write stays DXF. |
| ODA | Require ODA File Converter. |

ODA is not shipped. Windows looks in `Program Files\ODA\ODAFileConverter` and in versioned folders beside it. Linux looks at `/usr/bin/ODAFileConverter`, `/usr/local/bin/ODAFileConverter`, `/opt/ODAFileConverter/ODAFileConverter`, and `ODAFileConverter` under the home directory. You can set another path in DWG Settings.

When ODA is installed, desktop save converts the DXF to DWG at the chosen version: 2000, 2004, 2007, 2010, 2013, or 2018. LibreDWG's own writer, used only to generate CI samples, encodes 2000 and 2004 reliably. It does not encode 2007, and 2010 through 2018 writes are still planned upstream. Those versions in the app go through ODA.

Mapped drawing entities are line, polyline, arc, circle, text, point, 3DFACE, and block inserts. Other entity types are skipped.

## Point clouds

File → Import → LAS reads LAS 1.2 point format 0 into survey points. File → Export can write the same record. LAZ is detected and refused, including a LAS file whose header names laszip.

The 3D mesh dialog accepts XYZ or CSV. If the chosen file is `.las` or `.laz`, the dialog reports that those formats are not supported there and asks for XYZ or CSV. Import the LAS first, then build the mesh from COGO points, a point group, selected drawing points, or the active surface.

Clouds above 200,000 points are voxel-downsampled for the 3D point display. Plan points keep one mark per four screen pixels.

## LandXML and meshes

LandXML import keeps faces until you rebuild. A rebuild triangulates from the stored survey points, so a boundary edit does not bake the previous mesh into the next one.

OBJ, STL, and glTF import as triangle meshes. `EXPORT` also offers contours, triangles, LandXML, a volume CSV, and a section report.
