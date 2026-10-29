# File formats

File → Import and File → Export list the formats Civil Design reads or writes. A row it cannot read or write stays in the menu only when a command can explain the limit (LAZ). The binary drawing format is omitted from the menus. The catalog is `FORMAT_CATALOG` in `src/engine/formats/status.ts`.

| Format | Extensions | Read | Write | What the code does |
| --- | --- | --- | --- | --- |
| Civil Design project | `.fieldline`, `.fieldline.json` | yes | yes | JSON, format id `fieldline-project`, version 1. Drawing entities and xrefs are included. Desktop save uses `.fieldline`. The browser download uses `.fieldline.json`. |
| DXF | `.dxf` | yes | yes | ASCII and binary DXF. Entities: POINT, LINE, LWPOLYLINE, POLYLINE with per-vertex elevation, CIRCLE, ARC, TEXT, 3DFACE. See below. |
| Binary drawing | `.dwg`, `.dwt` | no | no | Not offered. Use DXF. |
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

`SAVE`, `QSAVE`, and `SAVEAS` all call `saveProject`. They write the project JSON. They do not open a DXF save dialog. `DXFOUT` is a `classic.pgp` alias of `SAVEAS`, so it saves the project too. To write a DXF, use File → Export → DXF or the `EXPORT` command.

The unit (meters or feet) is a label for LandXML, stationing, and the volume report. Switching it does not convert stored coordinates.

## DXF

DXF is the drawing interchange path. Civil Design reads and writes it in `src/engine/formats/dxfDoc.ts`. Large files stream in `src/engine/formats/dxfStream.ts` instead of building one group list.

The writer emits Release 2000 group structure. The header token is `AC1015`. Later DXF readers accept that interchange version. The reader does not require a particular release. It keeps POINT, LINE, LWPOLYLINE (including bulge), POLYLINE/VERTEX when elevations differ, CIRCLE, ARC, TEXT, 3DFACE, and block inserts. ASCII and binary DXF both open. A flat polyline keeps one elevation. A polyline whose vertices are not at the same elevation is written as a 3D polyline so the elevations round-trip.

This is the app's own reader and writer. It does not call a paid CAD engine. A separate JavaScript package was not added: the maintained readers are import-only or do not stream a large civil drawing, and they would drop the 3D path this module already round-trips.

File → Import → DXF and File → Export → DXF are the menu entries. File → Save still writes the project JSON.

## Binary drawings

`.dwg` and `.dwt` are not in File → Import, File → Export, Insert, or the open dialog. Opening or attaching one reports that DXF is the interchange format and does not place geometry. There is no settings dialog for that format.

## Point clouds

File → Import → LAS reads LAS 1.2 point format 0 into survey points. File → Export can write the same record. LAZ is detected and refused, including a LAS file whose header names laszip.

The 3D mesh dialog accepts XYZ or CSV. If the chosen file is `.las` or `.laz`, the dialog reports that those formats are not supported there and asks for XYZ or CSV. Import the LAS first, then build the mesh from COGO points, a point group, selected drawing points, or the active surface.

Clouds above 200,000 points are voxel-downsampled for the 3D point display. Plan points keep one mark per four screen pixels.

## LandXML and meshes

LandXML import keeps faces until you rebuild. A rebuild triangulates from the stored survey points, so a boundary edit does not bake the previous mesh into the next one.

OBJ, STL, and glTF import as triangle meshes. `EXPORT` also offers contours, triangles, LandXML, a volume CSV, and a section report.
