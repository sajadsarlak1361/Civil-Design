export interface EntityStyle {
  locked?: boolean;
  linetype?: string;
  linetypeScale?: number;
  /** Hundredths of a millimetre, or -1 ByLayer, -2 ByBlock, -3 Default. */
  lineweight?: number;
  transparency?: number | 'bylayer';
  plotStyle?: string;
  thickness?: number;
  hyperlink?: string;
  material?: string;
  colorIndex?: number;
}

export function copyStyle(raw: object): EntityStyle {
  const source = raw as EntityStyle;
  const style: EntityStyle = {};
  if (typeof source.locked === 'boolean') style.locked = source.locked;
  if (typeof source.linetype === 'string') style.linetype = source.linetype;
  if (typeof source.linetypeScale === 'number' && Number.isFinite(source.linetypeScale)) style.linetypeScale = source.linetypeScale;
  if (typeof source.lineweight === 'number' && Number.isFinite(source.lineweight)) style.lineweight = source.lineweight;
  if (typeof source.transparency === 'number' || source.transparency === 'bylayer') style.transparency = source.transparency;
  if (typeof source.plotStyle === 'string') style.plotStyle = source.plotStyle;
  if (typeof source.thickness === 'number' && Number.isFinite(source.thickness)) style.thickness = source.thickness;
  if (typeof source.hyperlink === 'string') style.hyperlink = source.hyperlink;
  if (typeof source.material === 'string') style.material = source.material;
  if (typeof source.colorIndex === 'number' && Number.isFinite(source.colorIndex)) style.colorIndex = source.colorIndex;
  return style;
}
