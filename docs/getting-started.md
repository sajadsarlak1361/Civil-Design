# Getting started

Civil Design opens a sample project on launch. The existing ground and the proposed pad are synthetic. They are labeled `SAMPLE` in the point file and in the app. They are not a survey and not a design. Sample data is in meters.

## Open the app

**Browser.** Open [https://sajadsarlak1361.github.io/Civil-Design/](https://sajadsarlak1361.github.io/Civil-Design/) or double-click `civil-design.html` from a release. Chrome, Edge, and Safari open that file from `file://`. After the page loads it does not request the network.

**Desktop.** Install from the [Releases](https://github.com/sajadsarlak1361/Civil-Design/releases) page. Windows setup embeds the WebView2 offline installer, so the computer does not need a network to finish installing. The build is unsigned: if SmartScreen says Windows protected your PC, choose **More info**, then **Run anyway**. On Linux, the `.deb` depends on WebKitGTK 4.1, and the AppImage expects that library too.

**From source.** Node.js 22 and npm:

```bash
npm install
npm run dev
```

The dev server is [http://127.0.0.1:43123](http://127.0.0.1:43123).

## The window

The top row is File, Edit, View, and Help. Under it is the ribbon. Double-click a ribbon tab, or use the corner control, to cycle three sizes: full panels, panel titles, and tab names only. Ctrl+0 is Clean Screen.

The large area is the drawing. Drag to pan, scroll to zoom, and use Fit or `ZE` to frame the model. Typing goes to the command line at the bottom. Enter or Space runs the text. Esc cancels. Enter on an empty line repeats the last command. F2 expands the text window.

Ctrl+2 through Ctrl+5 switch 3D, Split, Profile, and Section. Ctrl+1 opens the Properties palette. The status bar toggles object snap, ortho, polar tracking, object-snap tracking, and dynamic input.

## Make a surface

1. File → Import → Points, or type `ADDPOINTFILE`.
2. Choose a CSV or TXT file. Formats are PNEZD, PENZD, PNEZ, PENZ, NEZ, and ENZ. The picker shows a preview and the coordinate bounds, so a swapped northing and easting shows up before you commit.
3. The app builds a Delaunay TIN. Optional limits are a maximum triangle edge and an outer boundary (`ADDSURFACEBOUNDARIES`). Breaklines are `ADDSURFACEBREAKLINES`.
4. `CONTOURS` shows or hides contours. Intervals and colors are in the surface inspector (`EDITSURFACEPROPERTIES`).

LandXML surfaces and CgPoints use File → Import → LandXML, or `LANDXMLIN`.

## Volumes

In the surface inspector, choose a base surface and either a comparison surface or a datum elevation, then **Compute volume**. Cut means the base is above the comparison. Fill means the comparison is higher. Net is fill minus cut. The map colors the overlap. File → Export → Volume CSV writes the report when a result exists. When the project unit is feet, the report also lists cubic yards.

The Analyze ribbon button **Volume Surface** runs `CREATESURFACECOMPOSITE`, which this build recognizes and does not run.

## Save

Ctrl+S (`QSAVE`) and Ctrl+Shift+S (`SAVEAS`) both write the Civil Design project. On the desktop the dialog saves a `.fieldline` file. In the browser the download is `.fieldline.json`. The document is JSON, version 1, and includes the drawing and external references. `civil` is optional, so an older file still opens.

DXF, DWG, LandXML, points, PDF, PNG, SVG, and meshes are File → Export. They are separate from the project file. See [file-formats.md](file-formats.md).

## Next

- [User guide](user-guide.md) for every menu and ribbon tab
- [Commands and shortcuts](commands-and-shortcuts.md)
- [Tunnel sections](tunnel-sections.md) for a scan mesh and overbreak
