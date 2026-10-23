import { useMemo, useState } from 'react';
import { COLOR_BOOK, aciHex, aciRgb, parseColorInput } from '../engine/aci';

interface ColorDialogProps {
  title?: string;
  onClose: () => void;
  onPick: (color: string, colorIndex?: number) => void;
}

export function ColorDialog({ title = 'Select Color', onClose, onPick }: ColorDialogProps) {
  const [tab, setTab] = useState<'index' | 'true' | 'book'>('index');
  const [rgb, setRgb] = useState({ r: 255, g: 0, b: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const trueHex = useMemo(() => `#${[rgb.r, rgb.g, rgb.b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`, [rgb]);

  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal color-dialog" role="dialog" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="color-tabs">
          {(['index', 'true', 'book'] as const).map((item) => (
            <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
              {item === 'index' ? 'Index Color' : item === 'true' ? 'True Color' : 'Color Books'}
            </button>
          ))}
        </div>
        {tab === 'index' && (
          <>
            <div className="color-special">
              <button type="button" onClick={() => onPick('bylayer')}>ByLayer</button>
              <button type="button" onClick={() => onPick('byblock')}>ByBlock</button>
              <span>{hover ? `ACI ${hover}  ${aciHex(hover)}` : 'Hover a color'}</span>
            </div>
            <div className="aci-standard">
              {Array.from({ length: 9 }, (_, index) => index + 1).map((index) => (
                <button key={index} type="button" title={`${index}`} style={{ background: aciHex(index) }} onMouseEnter={() => setHover(index)} onClick={() => onPick(aciHex(index), index)} />
              ))}
            </div>
            <div className="aci-grid">
              {Array.from({ length: 240 }, (_, index) => index + 10).map((index) => (
                <button key={index} type="button" title={`${index}`} style={{ background: aciHex(index) }} onMouseEnter={() => setHover(index)} onClick={() => onPick(aciHex(index), index)} />
              ))}
            </div>
            <div className="aci-grays">
              {Array.from({ length: 6 }, (_, index) => index + 250).map((index) => (
                <button key={index} type="button" title={`${index}`} style={{ background: aciHex(index) }} onMouseEnter={() => setHover(index)} onClick={() => onPick(aciHex(index), index)} />
              ))}
            </div>
          </>
        )}
        {tab === 'true' && (
          <div className="true-color">
            <div className="swatch" style={{ background: trueHex }} />
            {(['r', 'g', 'b'] as const).map((channel) => (
              <label key={channel}>
                {channel.toUpperCase()}
                <input type="range" min={0} max={255} value={rgb[channel]} onChange={(event) => setRgb((current) => ({ ...current, [channel]: Number(event.target.value) }))} />
                <input
                  value={rgb[channel]}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (value >= 0 && value <= 255) setRgb((current) => ({ ...current, [channel]: value }));
                  }}
                />
              </label>
            ))}
            <button
              type="button"
              className="primary"
              onClick={() => {
                const parsed = parseColorInput(trueHex);
                if (parsed) onPick(parsed.color);
              }}
            >
              OK
            </button>
            <span>{aciRgb(1) && trueHex.toUpperCase()}</span>
          </div>
        )}
        {tab === 'book' && (
          <ul className="color-book">
            {COLOR_BOOK.map((entry) => (
              <li key={entry.name}>
                <button type="button" onClick={() => onPick(entry.hex)}>
                  <i style={{ background: entry.hex }} />
                  {entry.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
