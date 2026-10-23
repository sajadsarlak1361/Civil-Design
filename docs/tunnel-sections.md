# Tunnel sections

Civil Design builds a 3D mesh with ball pivoting, then cuts vertical sections through it. Overbreak and underbreak are the areas between an as-built loop and a design ring. The commands are `CREATE3DMESH` and `MESHSECTION`. Both are on Insert → Point Cloud and on Create Ground Data → Surfaces.

![Tunnel section with overbreak and underbreak](images/tunnel-section.png)

*Screenshot placeholder. Add `docs/images/tunnel-section.png`.*

## Build the mesh

`CREATE3DMESH` opens the 3D mesh dialog.

| Field | Meaning |
| --- | --- |
| Name, description, layer, color, lock | Stored on the mesh. The default layer name is `MESH`. |
| Points | A point file (XYZ or CSV), COGO points, a point group, selected drawing points, or the points of the active surface. At least three points. LAS and LAZ are refused in this dialog. |
| Ball radii | `auto`, or a list of positive lengths such as `0.5, 1, 2`. Auto uses 1×, 2×, and 4× the median nearest-neighbor spacing. |
| Normals | Auto flips toward the tunnel axis when the cloud is a tube. Toward the tunnel axis and outward from the centroid are the other choices. |
| Max edge | Drop any triangle with an edge longer than this. Empty means no limit. |
| Fill holes up to | Close boundary loops of at most this many edges. `0` leaves holes open. |

**Build mesh** runs ball pivoting (Bernardini, Mittleman, Rushmeier, Silva, and Taubin, 1999) in `src/engine/mesh.ts`. Points are not moved or inserted. A vertical face or an overhang keeps the elevations the scan measured. The plan Delaunay TIN is a different surface: it cannot hold two elevations at one easting and northing.

A cloud of 800 points or more is reconstructed in `src/engine/mesh.worker.ts`. Smaller clouds run on the main thread. Cancel stops the worker.

The mesh is stored as a surface with kind `mesh`. Volume in the inspector skips mesh surfaces. The TIN volume tools stay on the Delaunay surfaces.

## Cut a section

`MESHSECTION` opens the mesh section dialog. It needs a mesh. Station and interval modes also need an alignment. Pick line does not.

| Mode | What you enter |
| --- | --- |
| Station | One station along the alignment. The plane is vertical and perpendicular to the alignment. Positive offset is to the right of increasing station. |
| Interval | From, to, and a positive interval. Stations come from `stationsInRange`. |
| Pick line | After the dialog closes, you pick a section line in the drawing. |

Design section, optional:

| Design | Input |
| --- | --- |
| None | As-built loops only. Comparison stays empty. |
| Circle | Radius, center offset, and center elevation. |
| Horseshoe | Width, wall height, and invert elevation. |
| Offset, elevation list | One `offset, elevation` pair per line. The ring must close. |
| Selected closed polyline | The current selection must include a closed polyline. |

**Draw 3D polylines in the model** places the section loops in the drawing when it is checked.

**Cut sections** calls `sectionMesh` in `src/engine/meshSection.ts`. Each triangle is cut by the plane. Segments are chained into loops. The report for a station has area and perimeter of the largest closed loop, a centroid, and, when a design ring exists:

- overbreak area and the overbreak regions (as-built outside the design)
- underbreak area and the underbreak regions (design outside the as-built)
- maximum overbreak and maximum underbreak

The section view paints overbreak in orange and underbreak in blue. The caption shows the two areas and the two maxima. `EXPORT` can write the section table as CSV: station, area, perimeter, centroid offset, centroid elevation, overbreak area, underbreak area, max overbreak, max underbreak, and loop count.

## Limits

- The section plane for an alignment is vertical. A tilted plane is not a dialog option.
- Design comparison uses one closed design ring against the as-built loops.
- LAS must be imported first, then passed in as points. The mesh dialog does not read LAS.
- Ball pivoting can leave holes. Fill holes closes short boundary loops. It does not invent a surface across a large gap.
