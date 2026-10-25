import { describe, expect, it } from 'vitest';
import { chromeMetrics, drawingShare, nextRibbonMode, panelsToCollapse } from './chromeLayout';
import { HOME_PANELS, RIBBON_TABS } from '../components/ribbonCatalog';

describe('compact chrome', () => {
  it('leaves at least 80% of a 1920×1080 window for the drawing', () => {
    const share = drawingShare(1920, 1080, 'full', 0);
    expect(share).toBeGreaterThanOrEqual(0.8);
    const metrics = chromeMetrics(1080, 'full');
    expect(metrics.menu).toBe(20);
    expect(metrics.tabs).toBe(20);
    expect(metrics.ribbon).toBe(72);
    expect(metrics.command).toBe(40);
    expect(metrics.status).toBe(20);
  });

  it('leaves at least 80% of a 1366×768 window with the ribbon expanded and palettes collapsed', () => {
    expect(drawingShare(1366, 768, 'full', 0)).toBeGreaterThanOrEqual(0.8);
    const metrics = chromeMetrics(768, 'full');
    expect(metrics.short).toBe(true);
    expect(metrics.ribbon).toBeGreaterThan(0);
  });

  it('cycles the ribbon full, then panel titles, then tab names', () => {
    expect(nextRibbonMode('full')).toBe('titles');
    expect(nextRibbonMode('titles')).toBe('tabs');
    expect(nextRibbonMode('tabs')).toBe('full');
  });

  it('collapses only the panels that do not fit', () => {
    expect(panelsToCollapse([80, 80, 80], 240)).toBe(0);
    expect(panelsToCollapse([80, 80, 80], 180)).toBe(2);
    expect(panelsToCollapse([40], 10)).toBe(1);
  });

  it('groups commands into ribbon tabs', () => {
    expect(RIBBON_TABS).toEqual([
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
    ]);
    expect(HOME_PANELS).toEqual(['Draw', 'Modify', 'Annotation', 'Layers', 'Block', 'Properties', 'Groups', 'Utilities', 'Clipboard', 'View']);
  });
});
