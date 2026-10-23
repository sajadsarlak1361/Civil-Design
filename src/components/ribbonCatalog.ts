/** Ribbon tab and panel names. The renderer and the layout test share this list. */

export const RIBBON_TABS = [
  'Home',
  'Insert',
  'Annotate',
  'View',
  'Manage',
  'Output',
  'Create Ground Data',
  'Create Design',
  'Profile & Section Views',
  'Analyze',
] as const;

export type RibbonTab = (typeof RIBBON_TABS)[number];

export const HOME_PANELS = ['Draw', 'Modify', 'Annotation', 'Layers', 'Block', 'Properties', 'Groups', 'Utilities', 'Clipboard', 'View'] as const;

export const INSERT_PANELS = ['Block', 'Reference', 'Import', 'Point Cloud'] as const;

export const ANNOTATE_PANELS = ['Text', 'Dimensions', 'Leaders', 'Tables', 'Markup'] as const;

export const VIEW_PANELS = ['Viewport Tools', 'Model Viewports', 'Named Views', 'Visual Styles', 'Palettes', 'Interface'] as const;

export const MANAGE_PANELS = ['CAD Standards', 'Cleanup'] as const;

export const OUTPUT_PANELS = ['Plot', 'Export'] as const;

export const ANALYZE_PANELS = ['Inquiry', 'Volumes'] as const;
