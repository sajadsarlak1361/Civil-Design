# Commands and shortcuts

A command in the tables below runs. Any other name from `src/commands/classic.pgp` is recognized and answers `that command is not in this build`. An unknown name answers `Unknown command`.

Resolution order is in `resolveToken`: a user alias from `ALIASEDIT`, then a design command name, then `classic.pgp`, then the Civil Design aliases `ZE`, `?`, and `MREDO`.

## Keyboard shortcuts

These are the keys bound in `src/components/CommandLine.tsx` and shown in the menu bar. On macOS the Command key is accepted wherever Ctrl is listed.

| Key | Command |
| --- | --- |
| F1 | HELP |
| F2 | Text window |
| F3 | Object snap |
| F8 | Ortho |
| F10 | Polar tracking |
| F11 | Object-snap tracking |
| F12 | Dynamic input |
| Enter, Space | Run the command line. Enter on an empty line repeats the last command. |
| Esc | Cancel the current command, or close a menu. |
| Tab | Accept the highlighted suggestion. |
| Up, Down | History, or the suggestion list. |
| Delete | Erase the selection when the command line is empty. |
| Ctrl+N | NEW |
| Ctrl+O | OPEN |
| Ctrl+S | QSAVE. Saves the project JSON. |
| Ctrl+Shift+S | SAVEAS. Saves the project JSON. |
| Ctrl+Z | Undo the last drawing command. |
| Ctrl+Y, Ctrl+Shift+Z | Redo. |
| Ctrl+X | CUTCLIP |
| Ctrl+C | COPYCLIP, unless text is already selected. |
| Ctrl+Shift+C | COPYBASE |
| Ctrl+V | PASTECLIP |
| Ctrl+Shift+V | PASTEBLOCK |
| Ctrl+A | AI_SELALL, unless the command line is focused. |
| Ctrl+0 | Clean screen. |
| Ctrl+1 | PROPERTIES |
| Ctrl+2 | 3D view |
| Ctrl+3 | Split view |
| Ctrl+4 | Profile view |
| Ctrl+5 | Section view |
| Ctrl+9 | Show or hide the command line. |

Menu labels that look like shortcuts and are typed aliases, not keys: Redraw is `R`, Regen is `RE`, Regen All is `REA`.

## Commands that run

| Command | What it does |
| --- | --- |
| `LINE` | Draw a line |
| `PLINE` | Draw a polyline, including arc segments and width |
| `CIRCLE` | Draw a circle by center and radius |
| `ARC` | Draw a three-point arc |
| `RECTANG` | Draw a rectangle |
| `POLYGON` | Draw an inscribed polygon |
| `POINT` | Draw a point |
| `TEXT` | Draw single-line text |
| `MTEXT` | Draw multiline text |
| `MOVE` | Move objects |
| `COPY` | Copy objects |
| `ROTATE` | Rotate objects |
| `SCALE` | Scale objects |
| `MIRROR` | Mirror objects |
| `OFFSET` | Offset a curve |
| `TRIM` | Trim to a cutting edge |
| `EXTEND` | Extend to a boundary |
| `FILLET` | Fillet two objects |
| `CHAMFER` | Chamfer two objects |
| `ERASE` | Erase objects |
| `EXPLODE` | Explode a polyline or block |
| `JOIN` | Join lines, arcs, and polylines that share an endpoint |
| `STRETCH` | Stretch objects with a crossing window |
| `LIST` | List object data |
| `DIST` | Measure a distance |
| `ID` | Report a coordinate |
| `AREA` | Report an area |
| `PROPERTIES` | Open or close the Properties palette. `PR`, `CH`, `MO`, and `PROPS` do the same |
| `PROPERTIESCLOSE` | Close the Properties palette |
| `QSELECT` | Quick select objects by property |
| `QUICKPROPERTIES` | Toggle the Quick Properties hover panel |
| `MATCHPROP` | Copy properties from one object to others |
| `CHPROP` | Change object properties |
| `-CHPROP` | Change object properties from the command line |
| `LOCKOBJECT` | Lock selected objects so they cannot be edited |
| `UNLOCKOBJECT` | Unlock selected objects |
| `ZOOM` | Zoom realtime, window, extents, or by a scale |
| `ZOOMEXTENTS` | Zoom to the extents of the model |
| `PAN` | Pan the view |
| `-PAN` | Pan by two points or a displacement |
| `REGEN` | Redraw the model |
| `REGENALL` | Redraw the model |
| `REDRAW` | Redraw the model |
| `REDRAWALL` | Redraw the model |
| `UNDO` | Undo the last drawing command |
| `U` | Undo the last drawing command |
| `REDO` | Redo the last undone drawing command |
| `LAYER` | Open the Layer Properties Manager |
| `-LAYER` | Layer command-line options |
| `LINETYPE` | Set the current linetype |
| `-LINETYPE` | Linetype command-line options |
| `LTSCALE` | Set the linetype scale |
| `COLOR` | Set the current color |
| `LWDISPLAY` | Toggle lineweight display |
| `LAYISO` | Isolate the layers of selected objects |
| `LAYUNISO` | Restore layers after LAYISO |
| `LAYOFF` | Turn off the layer of a selected object |
| `LAYON` | Turn all layers on |
| `LAYFRZ` | Freeze the layer of a selected object |
| `LAYTHW` | Thaw all layers |
| `LAYLCK` | Lock the layer of a selected object |
| `LAYULK` | Unlock the layer of a selected object |
| `LAYMCUR` | Make the selected object's layer current |
| `LAYCUR` | Move selected objects to the current layer |
| `LAYMCH` | Match the layer of a selected object |
| `LAYMRG` | Merge one layer into another |
| `LAYDEL` | Delete a layer and the objects on it |
| `LAYERP` | Restore the previous layer state |
| `LAYP` | Restore the previous layer state |
| `OSNAP` | Toggle object-snap modes |
| `-OSNAP` | Set object snaps from the command line |
| `DSETTINGS` | Drafting settings |
| `SNAP` | Grid snap |
| `UNITS` | Drawing units, meters or feet |
| `-UNITS` | Set units from the command line |
| `HELP` | List Civil Design commands |
| `ALIASEDIT` | Edit user command aliases |
| `NEW` | Start a new project |
| `OPEN` | Open a Civil Design project |
| `SAVE` | Save the project JSON |
| `QSAVE` | Save the project JSON |
| `SAVEAS` | Save the project JSON |
| `EXPORT` | Export contours, triangles, LandXML, a volume report, a mesh, or section report |
| `QUIT` | Leave Civil Design |
| `COPYCLIP` | Copy the selection to the clipboard |
| `CUTCLIP` | Cut the selection to the clipboard |
| `COPYBASE` | Copy the selection with a base point |
| `COPYLINK` | Copy the selection and a Civil Design link |
| `PASTECLIP` | Paste the clipboard into the drawing |
| `PASTEBLOCK` | Paste the clipboard as a block |
| `PASTEORIG` | Paste the clipboard at its original coordinates |
| `PASTESPEC` | Paste Civil Design entities or plain text |
| `AI_SELALL` | Select every object |
| `FIND` | Find and replace text |
| `SELECTSIMILAR` | Select objects of the same type and layer |
| `ORTHO` | Toggle ortho mode (F8) |
| `POLAR` | Toggle polar tracking (F10) |
| `OTRACK` | Toggle object-snap tracking (F11) |
| `DYNMODE` | Toggle dynamic input (F12) |
| `3DORBIT` | Constrained 3D orbit |
| `3DFORBIT` | Free 3D orbit |
| `3DCORBIT` | Continuous 3D orbit |
| `PLAN` | Plan view of the current UCS |
| `CLEANSCREENON` | Hide the ribbon, panels, and status bar |
| `CLEANSCREENOFF` | Show the ribbon, panels, and status bar |
| `VPORTS` | Tile model-space viewports |
| `VIEW` | Save or restore a named view |
| `UCSICON` | Toggle the UCS icon |
| `NAVBARDISPLAY` | Toggle the navigation bar |
| `VIEWCUBE` | Toggle the ViewCube |
| `VSCURRENT` | Set the visual style |
| `XREF` | Open the External References palette |
| `XATTACH` | Attach a DXF, DWG, or Civil Design drawing |
| `IMAGEATTACH` | Attach a PNG or JPEG |
| `XBIND` | Bind individual xref layers into the drawing |
| `XCLIP` | Clip an external reference with a rectangle |
| `CREATESURFACE` | Create a TIN surface from points or LandXML |
| `CREATE3DMESH` | Create a 3D mesh from points with ball pivoting |
| `MESHSECTION` | Cut tunnel sections through a 3D mesh |
| `ADDPOINTFILE` | Import a point file as a surface |
| `LANDXMLIN` | Import a LandXML TIN or CgPoints |
| `IMPORTPOINTS` | Import points or LandXML |
| `ADDSURFACEBOUNDARIES` | Add an outer boundary to the active surface |
| `ADDSURFACEBREAKLINES` | Add breaklines to the active surface |
| `CONTOURS` | Toggle contours on the active TIN surface |
| `EDITSURFACEPROPERTIES` | Edit the active surface style and rebuild settings |
| `CREATEALIGNMENTLAYOUT` | Draw an alignment from tangent PIs, curves, and spirals |
| `CREATEALIGNMENTENTITIES` | Create an alignment from a polyline or the surface boundary |
| `CREATEPROFILEFROMSURFACE` | Sample the active surface along the alignment |
| `CREATEPROFILELAYOUT` | Add a parabolic vertical curve above the surface |
| `CREATEPROFILEVIEW` | Open the profile view |
| `CREATESAMPLELINES` | Place sample lines along the alignment |
| `CREATESECTIONVIEW` | Open one section view |
| `CREATEMULTIPLESECTIONVIEW` | Open every sample line on one section sheet |
| `CREATEPOINTS` | Create COGO points |
| `CREATEPOINTGROUP` | Create a point group |
| `IMPORTSURVEYDATA` | Import a survey database |
| `TRAVERSEEDITOR` | Adjust a survey traverse |
| `CREATESURVEYFIGURE` | Create a survey figure |
| `CREATEFEATURELINES` | Create feature lines |
| `CREATEPARCELFROMOBJECTS` | Create parcels from objects |
| `CREATEGRADING` | Create a grading |
| `CREATEOFFSETALIGNMENT` | Create an offset alignment |
| `CALCULATESUPERELEVATION` | Calculate AASHTO superelevation |
| `CREATEPROFILEFROMCORRIDOR` | Create a profile from a corridor |
| `CREATECORRIDOR` | Create a corridor |
| `CREATEMASSHAULDIAGRAM` | Create a mass haul diagram |
| `CREATEINTERSECTION` | Create an intersection |
| `CREATEASSEMBLY` | Create an assembly |
| `CREATEPIPENETWORK` | Create a pipe network |
| `CREATEPRESSURENETWORK` | Create a pressure network |
| `CREATEMULTIPLEPROFILEVIEW` | Create multiple profile views |
| `SUPERIMPOSEPROFILE` | Superimpose a profile |
| `CREATEQUICKPROFILE` | Create a quick profile |
| `ADDPROFILEVIEWBANDS` | Add profile view data bands |
| `ELLIPSE` | Draw an ellipse by axis and end |
| `ELLIPSEC` | Draw an ellipse from its center |
| `ELLIPSEA` | Draw an elliptical arc |
| `SPLINE` | Draw a fit or control-vertex spline |
| `SPLINECV` | Draw a spline through control vertices |
| `HATCH` | Hatch a closed boundary |
| `HATCHEDIT` | Edit a hatch pattern, scale, and angle |
| `BOUNDARY` | Create a polyline from a pick point |
| `REGION` | Create a region from closed objects |
| `DIVIDE` | Place evenly spaced points along an object |
| `MEASURE` | Place points at a measured interval |
| `XLINE` | Draw a construction line |
| `RAY` | Draw a ray |
| `REVCLOUD` | Draw a revision cloud |
| `DONUT` | Draw a donut |
| `WIPEOUT` | Draw a wipeout mask |
| `POINTM` | Draw points until you cancel |
| `BLEND` | Blend two curves with a tangent spline |
| `ARRAY` | Create a rectangular, path, or polar array |
| `ARRAYRECT` | Create a rectangular array |
| `ARRAYPATH` | Create a path array |
| `ARRAYPOLAR` | Create a polar array |
| `ARRAYEDIT` | Edit an associative array |
| `BREAK` | Break an object between two points |
| `BREAKATPOINT` | Break an object at one point |
| `LENGTHEN` | Lengthen an object |
| `ALIGN` | Align objects to destination points |
| `REVERSE` | Reverse vertex order |
| `PEDIT` | Edit a polyline |
| `SPLINEDIT` | Edit a spline |
| `CHSPACE` | Move objects between model and paper space |
| `OVERKILL` | Delete duplicate overlapping objects |
| `DRAWORDER` | Change draw order |
| `TEXTTOFRONT` | Move text above other objects |
| `HATCHTOBACK` | Move hatches behind other objects |
| `STYLE` | Create or edit a text style |
| `DIM` | Smart dimension from picked geometry |
| `DIMLINEAR` | Linear dimension |
| `DIMALIGNED` | Aligned dimension |
| `DIMANGULAR` | Angular dimension |
| `DIMARC` | Arc length dimension |
| `DIMRADIUS` | Radius dimension |
| `DIMDIAMETER` | Diameter dimension |
| `DIMJOGGED` | Jogged radius dimension |
| `DIMORDINATE` | Ordinate dimension |
| `QDIM` | Quick dimension |
| `DIMCONTINUE` | Continue a dimension |
| `DIMBASELINE` | Baseline dimension |
| `DIMSPACE` | Space parallel dimensions |
| `DIMBREAK` | Break a dimension line |
| `DIMINSPECT` | Inspection dimension |
| `DIMJOGLINE` | Jog a linear dimension line |
| `CENTERMARK` | Center mark |
| `CENTERLINE` | Centerline between two circles |
| `DIMEDIT` | Oblique dimension extension lines |
| `DIMTEDIT` | Move or rotate dimension text |
| `DIMJUSTL` | Left-justify dimension text |
| `DIMJUSTC` | Center dimension text |
| `DIMJUSTR` | Right-justify dimension text |
| `DIMOVERRIDE` | Override a dimension variable |
| `DIMREASSOCIATE` | Reassociate a dimension |
| `DIMLAYER` | Layer override for new dimensions |
| `DIMSTYLE` | Dimension style manager |
| `-DIMSTYLE` | Dimension style from the command line |
| `DIMSCALE` | Set the dimension scale |
| `GROUPBBOX` | Toggle the group bounding box |
| `MLEADER` | Multileader |
| `MLEADERADD` | Add a leader line to a multileader |
| `MLEADERREMOVE` | Remove a leader line |
| `MLEADERALIGN` | Align multileaders |
| `MLEADERCOLLECT` | Collect multileaders |
| `MLEADERSTYLE` | Multileader style |
| `TABLE` | Insert a table |
| `TABLESTYLE` | Table style |
| `TABLEIMPORT` | Import a CSV as a table |
| `BLOCK` | Define a block |
| `INSERT` | Insert a block |
| `BEDIT` | Edit a block in place |
| `REFEDIT` | Edit a block in place. Uses the same prompt as BEDIT. |
| `BCLOSE` | Close the block editor and save the definition |
| `WBLOCK` | Write a block to a DXF file |
| `ATTDEF` | Define an attribute |
| `EATTEDIT` | Edit attribute values |
| `ATTEDIT` | Edit attribute values |
| `BATTMAN` | Block attribute manager |
| `PURGE` | Purge unused block definitions |
| `GROUP` | Group objects |
| `UNGROUP` | Ungroup |
| `GROUPEDIT` | Add or remove objects from a group |
| `PICKSTYLE` | Toggle group selection |
| `CLASSICGROUP` | Group manager |
| `STATIONLABEL` | Station and offset label |
| `SLOPELABEL` | Slope percent label |
| `CIRCLE2P` | Circle through two points |
| `CIRCLE3P` | Circle through three points |
| `CIRCLETTR` | Circle tangent to two objects with a radius |
| `CIRCLETTT` | Circle tangent to three objects |
| `CIRCLEDIA` | Circle by center and diameter |
| `ARCSEA` | Arc by start, end, and angle |
| `ARCSED` | Arc by start, end, and direction |
| `ARCSER` | Arc by start, end, and radius |
| `ARCSCA` | Arc by start, center, and angle |
| `ARCSCL` | Arc by start, center, and length |
| `ARCSCE` | Arc by start, center, and end |
| `ARCCSE` | Arc by center, start, and end |
| `ARCCSA` | Arc by center, start, and angle |
| `ARCCSL` | Arc by center, start, and length |
| `ARCCONT` | Continue an arc from the last curve |
| `RECTCHAMFER` | Rectangle with chamfered corners |
| `RECTFILLET` | Rectangle with filleted corners |
| `RECTAREA` | Rectangle from an area |
| `RECTDIMS` | Rectangle from length and width |
| `RECTROT` | Rotated rectangle |
| `RECTWIDTH` | Rectangle with a polyline width |
| `TRIMQUICK` | Trim without choosing cutting edges first |
| `EXTENDQUICK` | Extend without choosing boundary edges first |

## Aliases that run

Later duplicates in `classic.pgp` win. This table keeps the last spelling of each alias whose target is implemented. `CP` appears twice in the file and both targets are `COPY`.

| Alias | Command |
| --- | --- |
| `-LA` | `-LAYER` |
| `-LT` | `-LINETYPE` |
| `-LTYPE` | `-LINETYPE` |
| `-OS` | `-OSNAP` |
| `-P` | `-PAN` |
| `-UN` | `-UNITS` |
| `3DO` | `3DORBIT` |
| `A` | `ARC` |
| `AA` | `AREA` |
| `AL` | `ALIGN` |
| `AR` | `ARRAY` |
| `ATE` | `ATTEDIT` |
| `ATT` | `ATTDEF` |
| `B` | `BLOCK` |
| `BC` | `BCLOSE` |
| `BE` | `BEDIT` |
| `BH` | `HATCH` |
| `BMAKE` | `BLOCK` |
| `BMOD` | `BLOCK` |
| `BO` | `BOUNDARY` |
| `BPOLY` | `BOUNDARY` |
| `BR` | `BREAK` |
| `C` | `CIRCLE` |
| `CH` | `PROPERTIES` |
| `CHA` | `CHAMFER` |
| `CL` | `CENTERLINE` |
| `CM` | `CENTERMARK` |
| `CO` | `COPY` |
| `COL` | `COLOR` |
| `COLOUR` | `COLOR` |
| `CP` | `COPY` |
| `D` | `DIMSTYLE` |
| `DAL` | `DIMALIGNED` |
| `DAN` | `DIMANGULAR` |
| `DAR` | `DIMARC` |
| `DBA` | `DIMBASELINE` |
| `DCO` | `DIMCONTINUE` |
| `DDATTDEF` | `ATTDEF` |
| `DDATTE` | `ATTEDIT` |
| `DDCHPROP` | `PROPERTIES` |
| `DDCOLOR` | `COLOR` |
| `DDI` | `DIMDIAMETER` |
| `DDIM` | `DIMSTYLE` |
| `DDLMODES` | `LAYER` |
| `DDLTYPE` | `LINETYPE` |
| `DDMODIFY` | `PROPERTIES` |
| `DDOSNAP` | `OSNAP` |
| `DDRMODES` | `DSETTINGS` |
| `DDSTYLE` | `STYLE` |
| `DDUNITS` | `UNITS` |
| `DDVIEW` | `VIEW` |
| `DED` | `DIMEDIT` |
| `DELETE` | `ERASE` |
| `DI` | `DIST` |
| `DIMALI` | `DIMALIGNED` |
| `DIMANG` | `DIMANGULAR` |
| `DIMBASE` | `DIMBASELINE` |
| `DIMCONT` | `DIMCONTINUE` |
| `DIMDIA` | `DIMDIAMETER` |
| `DIMED` | `DIMEDIT` |
| `DIMHORIZONTAL` | `DIMLINEAR` |
| `DIMLIN` | `DIMLINEAR` |
| `DIMORD` | `DIMORDINATE` |
| `DIMOVER` | `DIMOVERRIDE` |
| `DIMRAD` | `DIMRADIUS` |
| `DIMROTATED` | `DIMLINEAR` |
| `DIMSTY` | `DIMSTYLE` |
| `DIMTED` | `DIMTEDIT` |
| `DIMVERTICAL` | `DIMLINEAR` |
| `DIV` | `DIVIDE` |
| `DJL` | `DIMJOGLINE` |
| `DJO` | `DIMJOGGED` |
| `DLI` | `DIMLINEAR` |
| `DO` | `DONUT` |
| `DOR` | `DIMORDINATE` |
| `DOUGHNUT` | `DONUT` |
| `DOV` | `DIMOVERRIDE` |
| `DR` | `DRAWORDER` |
| `DRA` | `DIMRADIUS` |
| `DRE` | `DIMREASSOCIATE` |
| `DS` | `DSETTINGS` |
| `DST` | `DIMSTYLE` |
| `DT` | `TEXT` |
| `DTEXT` | `TEXT` |
| `DXFIN` | `OPEN` |
| `DXFOUT` | `SAVEAS` |
| `E` | `ERASE` |
| `EL` | `ELLIPSE` |
| `EX` | `EXTEND` |
| `EXIT` | `QUIT` |
| `EXP` | `EXPORT` |
| `F` | `FILLET` |
| `G` | `GROUP` |
| `H` | `HATCH` |
| `HB` | `HATCHTOBACK` |
| `HE` | `HATCHEDIT` |
| `I` | `INSERT` |
| `IAT` | `IMAGEATTACH` |
| `INSERTURL` | `INSERT` |
| `J` | `JOIN` |
| `JOG` | `DIMJOGGED` |
| `L` | `LINE` |
| `LA` | `LAYER` |
| `LEN` | `LENGTHEN` |
| `LI` | `LIST` |
| `LS` | `LIST` |
| `LT` | `LINETYPE` |
| `LTS` | `LTSCALE` |
| `LTYPE` | `LINETYPE` |
| `M` | `MOVE` |
| `MA` | `MATCHPROP` |
| `ME` | `MEASURE` |
| `MI` | `MIRROR` |
| `MLA` | `MLEADERALIGN` |
| `MLC` | `MLEADERCOLLECT` |
| `MLD` | `MLEADER` |
| `MLS` | `MLEADERSTYLE` |
| `MO` | `PROPERTIES` |
| `MT` | `MTEXT` |
| `O` | `OFFSET` |
| `OPENURL` | `OPEN` |
| `ORBIT` | `3DORBIT` |
| `OS` | `OSNAP` |
| `P` | `PAN` |
| `PA` | `PASTESPEC` |
| `PAINTER` | `MATCHPROP` |
| `PE` | `PEDIT` |
| `PL` | `PLINE` |
| `PO` | `POINT` |
| `POL` | `POLYGON` |
| `PR` | `PROPERTIES` |
| `PRCLOSE` | `PROPERTIESCLOSE` |
| `PROPS` | `PROPERTIES` |
| `PU` | `PURGE` |
| `QP` | `QUICKPROPERTIES` |
| `R` | `REDRAW` |
| `RA` | `REDRAWALL` |
| `RE` | `REGEN` |
| `REA` | `REGENALL` |
| `REC` | `RECTANG` |
| `RECTANGLE` | `RECTANG` |
| `REG` | `REGION` |
| `RO` | `ROTATE` |
| `S` | `STRETCH` |
| `SAVEURL` | `SAVE` |
| `SC` | `SCALE` |
| `SE` | `DSETTINGS` |
| `SHOWMAT` | `LIST` |
| `SN` | `SNAP` |
| `SPE` | `SPLINEDIT` |
| `SPL` | `SPLINE` |
| `ST` | `STYLE` |
| `T` | `MTEXT` |
| `TB` | `TABLE` |
| `TR` | `TRIM` |
| `TS` | `TABLESTYLE` |
| `UN` | `UNITS` |
| `V` | `VIEW` |
| `VIEWPORTS` | `VPORTS` |
| `VS` | `VSCURRENT` |
| `W` | `WBLOCK` |
| `X` | `EXPLODE` |
| `XA` | `XATTACH` |
| `XB` | `XBIND` |
| `XC` | `XCLIP` |
| `XL` | `XLINE` |
| `XR` | `XREF` |
| `Z` | `ZOOM` |

Civil Design aliases, checked after the pgp table:

| Alias | Command |
| --- | --- |
| `ZE` | `ZOOMEXTENTS` |
| `?` | `HELP` |
| `MREDO` | `REDO` |

## Named, and not run, in this build

Pipe networks and survey are implemented in `src/engine` and retired by `src/features.ts`. Typing one answers `not available in this version`.

| Command | State |
| --- | --- |
| `CREATEPIPENETWORK` | Retired while its feature flag is false. |
| `CREATEPRESSURENETWORK` | Retired while its feature flag is false. |
| `IMPORTSURVEYDATA` | Retired while its feature flag is false. |
| `CREATESURVEYFIGURE` | Retired while its feature flag is false. |
| `TRAVERSEEDITOR` | Retired while its feature flag is false. |
| `TRAVERSE` | Retired while its feature flag is false. |

`CREATESURFACECOMPOSITE` builds a TIN whose elevation is comparison minus base (or the datum) and stores the cut and fill totals.

These design command names are listed in `CIVIL_COMMANDS` and are not in the implemented set. Typing one answers `that command is not in this build`.

| Command |
| --- |
| `ADDSURFACECONTOURS` |
| `ADDSURFACEPOINT` |
| `ADDSURFACELINE` |
| `EDITSURFACEPASTE` |
| `EDITSURFACESWAPEDGE` |
| `CREATEALIGNMENTREFERENCE` |
| `CREATEALIGNFROMEXISTING` |
| `EDITALIGNMENT` |
| `CREATEPROFILEFROMFILE` |
| `EDITPROFILELAYOUT` |
| `ADDPROFILEPVI` |
| `DELETEPROFILEPVI` |

The rest of `src/commands/classic.pgp` resolves to commands from other CAD programs that this build does not run. External pgp lines, such as `DEL`, are recognized and do not run.

