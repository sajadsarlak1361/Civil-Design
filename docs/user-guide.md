# User guide

The shell is a menu bar, a ribbon, the drawing, a command line, and palettes. Commands you can type are listed in [commands-and-shortcuts.md](commands-and-shortcuts.md). A name this build has not built answers `that command is not in this build`.

## Menu bar

### File

| Item | Action |
| --- | --- |
| New | `NEW`. Starts a project. Ctrl+N. |
| Open | `OPEN`. One picker for the project and the import formats. Ctrl+O. |
| Import | Points, LandXML, DXF, DEM / GeoTIFF, LAS, shapefile, image, OBJ, STL, glTF. LAZ runs `LASZIP`: the command line explains the missing decompressor, then the file dialog opens. |
| Attach | `XATTACH`. Attach a DXF or Civil Design drawing as an xref. |
| Save | `QSAVE`. Project JSON. Ctrl+S. |
| Save As | `SAVEAS`. The same project save. Ctrl+Shift+S. On the desktop the filter is `.fieldline`. |
| Export | DXF, LandXML, points CSV, PDF, PNG, SVG, OBJ, STL, glTF, volume CSV. LAZ runs `LASZIP`, same as Import. DXF is the drawing interchange. See [file-formats.md](file-formats.md). |
| Recent Files | Names remembered locally. A stored path reopens on the desktop. A name without a path runs `OPEN` and asks you to choose that file. An empty list is an Open item. |
| Close, Exit | `QUIT`. In the browser the command line says to close the tab. |

### Edit

| Item | Action |
| --- | --- |
| Undo, Redo | Drawing checkpoints. Ctrl+Z, Ctrl+Y. Ctrl+Shift+Z also redoes. The menu lists up to eight undo steps. Surface boundary, breakline, and style edits are not on this stack. |
| Cut, Copy, Copy with Base Point, Copy Link | `CUTCLIP`, `COPYCLIP`, `COPYBASE`, `COPYLINK`. Shortcuts Ctrl+X, Ctrl+C, Ctrl+Shift+C. Locked objects are left in place and reported. |
| Paste, Paste as Block, Paste to Original Coordinates, Paste Special | `PASTECLIP`, `PASTEBLOCK`, `PASTEORIG`, `PASTESPEC`. Ctrl+V and Ctrl+Shift+V. Paste Special can place Civil Design entities or plain text. |
| Clear | Erase the selection. Delete. |
| Select All | `AI_SELALL`. Ctrl+A, unless the command line is focused. |
| OLE Links | `OLELINKS`. Lists linked drawings and images. Reload, detach, or attach. |
| Find and Replace | `FIND`. Text in the drawing. |
| Quick Select | `QSELECT`. Filter by property. Opens with the Properties palette. |
| Select Similar | `SELECTSIMILAR`. Same entity type and layer. |

### View

| Item | Action |
| --- | --- |
| Redraw, Regen, Regen All | `REDRAW` / `R`, `REGEN` / `RE`, `REGENALL` / `REA`. All three redraw the model. |
| Zoom | Realtime (`ZOOM`), Previous, Window, Dynamic (a window zoom), Scale (asks for a factor), Center (a point, then a magnification), Object (zoom to the selection), In (`2x`), Out (`0.5x`), All, Extents. |
| Pan | Realtime runs `PAN`. Point runs `-PAN` and asks for two points. Left, Right, Up, and Down pan by a step. |
| Orbit | Constrained (`3DORBIT`), Free (`3DFORBIT`), Continuous (`3DCORBIT`). Drag in the 3D view. |
| Camera | `CAMERA`. Switches to the 3D view and saves it as Camera 1, Camera 2, and so on. |
| Walk | `3DWALK`. Switches to the 3D view and steps forward. Arrow keys and WASD keep moving. Esc stops. |
| Fly | `3DFLY`. Same as walk, and Q / E change height. |
| Clean Screen | `CLEANSCREENON` / `CLEANSCREENOFF`. Ctrl+0. Hides the ribbon, panels, and status bar. |
| Viewports | Named viewports (`VPORTS`). New layouts of 1, 2, 3, or 4 tiled model viewports. Join can return to a single viewport or merge another viewport into the active one. |
| Named Views | `VIEW`. Save and restore a camera. |
| 3D Views | Top, bottom, left, right, front, back, and the four isometric corners (SW, SE, NE, NW). Plan View → Current UCS runs `PLAN`. Plan View → World is the top preset. |
| ViewCube, Navigation Bar | `VIEWCUBE`, `NAVBARDISPLAY`. The navigation bar (zoom in, zoom out, and pan arrows) sits on the drawing. The wheel zooms, and the middle button pans. |
| Visual Styles | 2D Wireframe, Wireframe, Hidden, Realistic, Conceptual, Shaded, Shaded with Edges, X-Ray, and Elevation. Visual Styles Manager is `VSCURRENT`. |
| Render | `RENDER`. Sets the realistic visual style and saves a PNG of the view. |
| Display | UCS icon on, off, or at the origin. Text window (F2). Lineweights (`LWDISPLAY`). Grid. |
| Toolbars | Properties, Layers, External References, Tool Palettes, Command Line (Ctrl+9), Status Bar. Each item shows or hides that chrome. |

### Help

Command List runs `HELP` (also F1 and `?`). About shows the version, the independent-product line, the copyright line, and the DXF interchange note.

## Ribbon

Tabs: Home, Insert, Annotate, View, Manage, Output, Create Ground Data, Create Design, Profile & Section Views, Analyze.

On a narrow window, full mode collapses the right-hand panels to their titles. The three ribbon sizes are full, titles, and tabs.

### Home

| Panel | Tools |
| --- | --- |
| Draw | Line, polyline (arc, width, length), circle (center/radius, diameter, 2-point, 3-point, tan-tan-radius, tan-tan-tan), arc (3-point, start-center-end, start-center-angle, start-center-length, start-end-angle, start-end-direction, start-end-radius, center-start-end, center-start-angle, center-start-length, continue), rectangle (chamfer, fillet, area, dimensions, rotation, width), polygon, ellipse (axis-end, center, elliptical arc), spline (fit or control vertices), hatch and hatch edit, point and multiple points, plus boundary, region, divide, measure, construction line, ray, revision cloud, donut, and wipeout. |
| Modify | Move, copy, rotate, trim and quick trim, extend and quick extend, erase, mirror, scale (including Reference), offset, fillet, chamfer, rectangular / path / polar array and array edit, blend, explode, stretch, break, break at point, join, lengthen, align, reverse, PEDIT, spline edit, overkill, draw order, text to front, hatch to back. |
| Annotation | Single-line and multiline text, dimensions (smart, linear, aligned, angular, arc length, radius, diameter, jogged, ordinate, continue, baseline, quick), multileader, table, dimension style, station/offset label, and slope percent. |
| Layers | Current layer, current color, and Layer Properties Manager (`LAYER`). |
| Block | Define (`BLOCK`), insert (`INSERT`), edit in place (`BEDIT`), close the editor (`BCLOSE`), write block (`WBLOCK`). |
| Properties | Properties (`PROPERTIES`, also Ctrl+1), Match Properties, Quick Select. |
| Groups | Group, ungroup, group edit, pick style, classic group. |
| Utilities | Distance, area, ID, list, regen. |
| Clipboard | Cut, copy, paste, copy with base point. |
| View | Plan, 3D, profile, and fit. |

`PEDIT` accepts a polyline, or a line or arc which it converts. Options are Close or Open, Join, Width, Edit vertex, Fit, Spline, Decurve, Ltype gen, Reverse, Undo, and Exit. Edit vertex offers Next, Previous, Break, Insert, Move, Straighten, Tangent, Width, and Exit. Multiple mode asks for a fuzz distance and joins nearby chains.

`HATCH` fills a closed boundary. Patterns in `src/engine/hatch.ts` are SOLID, ANSI31–ANSI38, ISO02–ISO15, and the GR_ gradient names (linear, cylindrical, spherical, curved, and the inverted variants). `HATCHEDIT` changes pattern, scale, and angle.

`WBLOCK` asks for a block name and downloads `<name>.dxf` containing that definition.

### Insert

| Panel | Tools |
| --- | --- |
| Block | The same block tools as Home. |
| Reference | Xrefs (`XREF`), Attach (`XATTACH`), Clip (`XCLIP`), Bind (`XBIND`). |
| Import | The File → Import list. DXF is the drawing entry. |
| Point Cloud | 3D Mesh (`CREATE3DMESH`) and Mesh Section (`MESHSECTION`). See [tunnel-sections.md](tunnel-sections.md). |

The xref palette attaches, overlays, detaches, unloads, reloads, binds, and inserts. Path type is full, relative, or none. Clip is a rectangle or a polygon, and it can be inverted. Bind renames layers to `Name$0$Layer`. Insert keeps the layer name. Reload keeps layer overrides (VISRETAIN). A nested overlay is not drawn in the host. A nested attach is drawn while its parents are loaded. On the desktop, the shell watches the saved path and can mark the xref as needing a reload.

### Annotate

Text, Dimensions, Leaders, Tables, and Markup.

Dimensions that run: `DIM`, linear, aligned, angular, arc length, radius, diameter, jogged, ordinate, quick dimension, continue, baseline, space, break, inspect, jogged line, center mark, centerline, dimension edit, dimension text edit, left/center/right justification, override, reassociate, dimension layer, dimension style, and dimension scale.

Leaders: multileader, add, remove, align, collect, and style. Tables: `TABLE`, `TABLESTYLE`, and `TABLEIMPORT`. Markup is revision cloud, wipeout, station/offset, and slope percent.

### View

Viewport tools (extents, pan, plan), model viewport layouts, named views, the visual styles, and the palette toggles (properties, layers, xrefs, tool palettes, command line).

### Manage

CAD Standards: Layers, Purge (unused block definitions), Select Similar. Cleanup: Overkill (duplicate geometry within a fuzz distance), Regen, and Audit (`AUDIT`), which counts zero-length lines, duplicate ids, and objects whose layer is missing.

### Output

Plot runs `EXPORT` (the command-line export menu) and `QSAVE`. The one-page PDF is File → Export → PDF, not a separate Plot button. Export writes contour DXF, TIN triangle DXF, LandXML, and the volume CSV when a volume result exists.

### Create Ground Data

| Group | Tools that run |
| --- | --- |
| Points | `CREATEPOINTS` (grid, along an alignment, interpolate, typed coordinate, or a click), `CREATEPOINTGROUP` (description wildcards `*` and `?`, elevation, point number; a group can build a surface), Import Points. |
| Surfaces | Create Surface, 3D Mesh, Mesh Section, point file, LandXML, boundary, breaklines, contours, edit surface. |

Traverse, Figures, and Survey are omitted from the ribbon while `features.survey` is false.

### Create Design

Each of these opens a dialog. Set the values, then Run.

| Group | Command | What it builds |
| --- | --- | --- |
| Parcel | `CREATEPARCELFROMOBJECTS` | A parcel from a rectangle, a boundary, a closed feature line, or clicked corners. The report is area, perimeter, misclosure, and quadrant bearings. |
| Feature Line | `CREATEFEATURELINES` | A 3D feature line. It can be draped on a TIN and given a grade (rise/run). |
| Grading | `CREATEGRADING` | Daylight from a feature line to a surface at a cut and fill slope (H:V). The daylight is a TIN. |
| Alignment | `CREATEALIGNMENTLAYOUT` | PIs. Modes on the split button: tangents only, circular curves, or Euler spirals into each curve. A radius or spiral that does not fit is reduced and reported. Station labels use metric `km+mmm` or foot `sta+ft`. |
| Alignment | `CREATEALIGNMENTENTITIES` | An alignment from a plan polyline or the active surface boundary. |
| Alignment | `CREATEOFFSETALIGNMENT` | A constant offset. Positive is to the right. The offset is stored as its own PIs and does not follow later edits of the parent. |
| Alignment | `CALCULATESUPERELEVATION` | An AASHTO diagram. The corridor uses those slopes on the lanes. |
| Profile | `CREATEPROFILEFROMSURFACE` | Sample the active TIN along the alignment, then pick where the profile view goes on the plan. |
| Profile | `CREATEPROFILELAYOUT` | A symmetric parabolic vertical curve, one unit above the active surface at mid-station. |
| Profile | `CREATEPROFILEFROMCORRIDOR` | Copy a corridor feature-line code onto the design profile. |
| Corridor | `CREATECORRIDOR` | An assembly along the alignment and profile. Reports cut, fill, pavement, and shoulder, and writes a corridor surface. |
| Corridor | `CREATEMASSHAULDIAGRAM` | Cumulative earthwork from corridor end areas, or from two surfaces along the alignment. Cut is positive and fill is negative. A free-haul chord marks the overhaul. A lobe whose crest is wider than the free-haul distance is a known limit. |
| Intersections | `CREATEINTERSECTION` | Curb returns. One alignment is enough: the command adds a crossing leg. |
| Assembly | `CREATEASSEMBLY` | Lane, shoulder, and daylight. The engine also has curb and sidewalk. The ribbon editor builds lane, shoulder, and daylight. |

Pipe Network and Pressure Network are omitted while `features.pipeNetworks` is false. The engine still contains Manning capacity and Hazen–Williams loops. Typing the commands answers `not available in this version`.

### Profile & Section Views

| Group | Command |
| --- | --- |
| Profile View | `CREATEPROFILEVIEW`, `CREATEMULTIPLEPROFILEVIEW` (split the profile into station sheets) |
| Sample Lines | `CREATESAMPLELINES`. Click the alignment. Lines stay perpendicular to it. Positive offset is to the right of increasing station. Esc places nothing. |
| Section Views | `CREATESECTIONVIEW` (one station), `CREATEMULTIPLESECTIONVIEW` (every sample line) |
| Data Bands | `ADDPROFILEVIEWBANDS`. Station, elevation, and geometry bands. |
| Superimpose | `SUPERIMPOSEPROFILE`. Project an offset profile onto this view. |
| Quick Profile | `CREATEQUICKPROFILE`. A profile across a surface without an alignment. |

Each of these asks for an insertion point on the plan. The graph is drawn at that world point, so the plan and the profile or section sit in one drawing. Esc cancels and places nothing. Sample lines are the exception: the click chooses the alignment, and the lines stay on that alignment.

The profile and section panes are still available from the View menu. Creating a view does not jump to those panes.

These section views sample TIN surfaces along an alignment. Tunnel sections through a 3D mesh are `MESHSECTION`, documented in [tunnel-sections.md](tunnel-sections.md).

### Analyze

Inquiry repeats distance, area, ID, and list. Volumes shows contours (`CONTOURS`) and Volume Surface (`CREATESURFACECOMPOSITE`), which adds a TIN of comparison-minus-base elevation and reports cut and fill. The sample project already has two surfaces, so the button can run immediately.

## Layers and object properties

Layer Properties Manager (`LAYER`, alias `LA`) edits name, ACI color, on/off, freeze, lock, plot, linetype, lineweight, transparency, and a description. Viewport freeze is stored per viewport id.

Layer commands that run: `LAYISO`, `LAYUNISO`, `LAYOFF`, `LAYON`, `LAYFRZ`, `LAYTHW`, `LAYLCK`, `LAYULK`, `LAYMCUR`, `LAYCUR`, `LAYMCH`, `LAYMRG`, `LAYDEL`, `LAYERP` / `LAYP`. Isolate hides the other layers. `LAYUNISO` restores that state. `LAYERP` restores the previous layer state.

Default civil layers, created with the drawing, include `C-TOPO`, `C-ROAD`, `C-CORR`, `C-FEAT`, `C-GRADING`, `C-PARCEL`, `C-PIPE`, `C-PRESS`, and `C-PNT`, each with an ACI color.

`LOCKOBJECT` and `UNLOCKOBJECT` lock one object. A locked object is not cut, moved, or otherwise edited. `COLOR` and `CHPROP` set color. Bylayer uses the layer color.

The Properties palette (`PROPERTIES`, aliases `PR`, `CH`, `MO`, and `PROPS`, also Ctrl+1) groups General, Geometry, and Misc. Typing the command or an alias opens it, and typing the same name again closes it. It lists the type, layer, color, and geometry of the current selection, and it updates when the selection changes. An empty selection says No selection. One object shows that object's values. Several objects of one type show the same rows, with `*VARIES*` where a value differs. A mix of types shows the rows they share. General fields include color, layer, linetype, linetype scale, plot style, lineweight, transparency, hyperlink, thickness, and locked. Geometry depends on the entity: a line has start, end, delta, length, and angle; a polyline has vertex, bulge, widths, elevation, and area; a circle has center, radius, and diameter. `QUICKPROPERTIES` toggles the hover panel. `MATCHPROP` copies properties from one object to the next.

## Command line

The dock under the drawing is the command line. F3 object snap, F8 ortho, F10 polar, F11 object-snap tracking, F12 dynamic input. Object snaps are endpoint, midpoint, center, node, intersection, and nearest. `OSNAP` toggles each mode. Coordinates accept `x,y`, `x,y,z`, `@dx,dy`, and `@distance<angle`.

`ALIASEDIT` stores extra aliases in this browser. A user alias wins over every other spelling. A design command name wins over a `classic.pgp` alias spelled the same way. The Civil Design aliases `ZE`, `?`, and `MREDO` are checked after the pgp table.

`HELP` lists the design command names first. Up and Down walk history, or the suggestion list. Tab accepts the highlighted suggestion.

## Navigation keys

| Key | Action |
| --- | --- |
| Ctrl+1 | Properties palette |
| Ctrl+2 | 3D view |
| Ctrl+3 | Split view |
| Ctrl+4 | Profile view |
| Ctrl+5 | Section view |

Plan view is View → 3D Views → Plan View, the Home view control, or `PLAN`.

## Not in this version

- Coordinate systems, geoid models, and converting numbers when the unit changes
- Undo for surface boundary, breakline, and style edits
- Sheet layout beyond the one-page PDF and the profile sheets
- Data shortcuts and a full label catalog
- Subassemblies on the ribbon beyond lane, shoulder, and daylight
- Offset alignments that follow the parent after the parent moves
- Survey curve codes beyond begin, end, and close, and the survey ribbon (the flag is off)
- A pipe-network rule editor, and the pipe ribbon (the flag is off)
- Mass-haul free haul when a lobe's crest is wider than the free-haul distance
- The other recognized surface-edit names listed in [commands-and-shortcuts.md](commands-and-shortcuts.md). `CREATESURFACECOMPOSITE` does run: Analyze → Volume Surface builds the depth TIN.
