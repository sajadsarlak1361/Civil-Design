import { useMemo, useState } from 'react';
import { looksLikeLandXml, parseLandXml, parsePointFile, pointFormatColumns, type DelimiterChoice, type FormatChoice, type PointColumnKey, type SurveyPoint } from '../engine';
import { formatNumber } from '../lib/format';

const FORMATS: FormatChoice[] = ['auto', 'PNEZD', 'PENZD', 'PNEZ', 'PENZ', 'NEZ', 'ENZ', 'XYZ'];

function previewCell(point: SurveyPoint, key: PointColumnKey): string {
  if (key === 'point') return point.number ?? '';
  if (key === 'description') return point.description ?? '';
  if (key === 'x') return formatNumber(point.x, 3);
  if (key === 'y') return formatNumber(point.y, 3);
  return formatNumber(point.z, 3);
}

interface ImportDialogProps {
  filename: string;
  text: string;
  onClose: () => void;
  onPoints: (name: string, points: ReturnType<typeof parsePointFile>['points']) => void;
  onLandXml: (xml: string) => void;
}

export function ImportDialog({ filename, text, onClose, onPoints, onLandXml }: ImportDialogProps) {
  const landXml = looksLikeLandXml(text);
  const xml = useMemo(() => (landXml ? parseLandXml(text) : null), [landXml, text]);
  const [format, setFormat] = useState<FormatChoice>('auto');
  const [delimiter, setDelimiter] = useState<DelimiterChoice>('auto');
  const [name, setName] = useState(filename.replace(/\.[^.]+$/, '') || 'Surface');
  const parsed = useMemo(() => (landXml ? null : parsePointFile(text, { format, delimiter })), [delimiter, format, landXml, text]);
  const columns = useMemo(() => (parsed ? pointFormatColumns(parsed.format) : []), [parsed]);

  const bounds = useMemo(() => {
    if (!parsed || parsed.points.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of parsed.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
  }, [parsed]);

  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2 id="import-title">Import survey</h2>
          <p>{filename}</p>
        </header>
        {landXml && xml ? (
          <div className="modal-body">
            <p>
              LandXML · {xml.surfaces.length} surface{xml.surfaces.length === 1 ? '' : 's'} · {xml.pointGroups.length} point group
              {xml.pointGroups.length === 1 ? '' : 's'}
            </p>
            <ul className="xml-list">
              {xml.surfaces.map((surface) => (
                <li key={surface.name}>
                  <strong>{surface.name}</strong>
                  <span>
                    {surface.points.length.toLocaleString()} points · {surface.triangles.length.toLocaleString()} triangles
                  </span>
                </li>
              ))}
              {xml.pointGroups.map((group) => (
                <li key={group.name}>
                  <strong>{group.name}</strong>
                  <span>{group.points.length.toLocaleString()} CgPoints, triangulated on import</span>
                </li>
              ))}
            </ul>
            {xml.surfaces.length === 0 && xml.pointGroups.length === 0 && <p className="error">No surfaces or CgPoints in this file.</p>}
          </div>
        ) : parsed ? (
          <div className="modal-body">
            <div className="pair">
              <label>
                Format
                <select value={format} onChange={(event) => setFormat(event.target.value as FormatChoice)}>
                  {FORMATS.map((item) => (
                    <option key={item} value={item}>
                      {item === 'auto' ? `Auto (${parsed.format})` : item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Delimiter
                <select value={delimiter} onChange={(event) => setDelimiter(event.target.value as DelimiterChoice)}>
                  <option value="auto">Auto ({parsed.delimiter})</option>
                  <option value="comma">Comma</option>
                  <option value="whitespace">Space</option>
                  <option value="tab">Tab</option>
                </select>
              </label>
            </div>
            <label>
              Surface name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <p className="hint">
              {parsed.points.length.toLocaleString()} points
              {parsed.skipped.length > 0 ? ` · ${parsed.skipped.length} skipped lines` : ''}
              {bounds
                ? ` · E ${formatNumber(bounds.minX, 2)} to ${formatNumber(bounds.maxX, 2)} · N ${formatNumber(bounds.minY, 2)} to ${formatNumber(bounds.maxY, 2)} · Z ${formatNumber(bounds.minZ, 2)} to ${formatNumber(bounds.maxZ, 2)}`
                : ''}
            </p>
            <p className="hint column-map" data-format={parsed.format}>
              {columns.map((column, index) => `${index + 1} ${column.label}`).join(' · ')}
            </p>
            <div className="preview-wrap">
              <table key={parsed.format}>
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={`${parsed.format}-${column.key}`} data-axis={column.key}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.points.slice(0, 12).map((point, index) => (
                    <tr key={`${parsed.format}-${point.number ?? index}-${index}`}>
                      {columns.map((column) => (
                        <td key={`${parsed.format}-${column.key}`} data-axis={column.key}>
                          {previewCell(point, column.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.points.length === 0 && <p className="error">No points matched this format. Try swapping PNEZD and PENZD if northing and easting look reversed.</p>}
          </div>
        ) : null}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {landXml ? (
            <button
              type="button"
              className="primary"
              disabled={!xml || (xml.surfaces.length === 0 && xml.pointGroups.length === 0)}
              onClick={() => onLandXml(text)}
            >
              Import LandXML
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!parsed || parsed.points.length < 3 || !name.trim()}
              onClick={() => parsed && onPoints(name.trim(), parsed.points)}
            >
              Add surface
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
