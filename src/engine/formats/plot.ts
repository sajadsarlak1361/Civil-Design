import type { DrawEntity } from '../drafting';

/** One-page PDF. The image is DeviceRGB, FlateDecode (zlib), with no external font or stream. */
export async function rgbToPdf(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  if (rgb.length < width * height * 3) throw new Error('PDF image is shorter than width × height × 3.');
  const stream = new CompressionStream('deflate');
  const packed = new Blob([rgb.buffer.slice(rgb.byteOffset, rgb.byteOffset + width * height * 3) as ArrayBuffer]).stream().pipeThrough(stream);
  const deflated = new Uint8Array(await new Response(packed).arrayBuffer());
  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im Do\nQ\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Im 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
  ];
  const imageHead = `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`;
  const imageTail = '\nendstream\nendobj\n';
  const header = '%PDF-1.4\n';
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode(header)];
  const offsets: number[] = [0];
  let cursor = header.length;
  for (const object of objects) {
    offsets.push(cursor);
    const bytes = encoder.encode(object);
    parts.push(bytes);
    cursor += bytes.length;
  }
  offsets.push(cursor);
  const headBytes = encoder.encode(imageHead);
  const tailBytes = encoder.encode(imageTail);
  parts.push(headBytes, deflated, tailBytes);
  cursor += headBytes.length + deflated.length + tailBytes.length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let index = 1; index <= 5; index += 1) xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`;
  parts.push(encoder.encode(xref));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const pdf = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    pdf.set(part, at);
    at += part.length;
  }
  return pdf;
}

export function pdfToText(pdf: Uint8Array): string {
  return new TextDecoder().decode(pdf);
}

function coord(entity: DrawEntity): { x: number; y: number }[] {
  if (entity.type === 'point' || entity.type === 'text') return [entity.p];
  if (entity.type === 'line') return [entity.a, entity.b];
  if (entity.type === 'polyline') return entity.vertices;
  if (entity.type === 'circle' || entity.type === 'arc') return [entity.center];
  return [];
}

/** SVG of plan entities. The namespace is an identifier, not a fetched resource. */
export function drawingToSvg(entities: DrawEntity[]): string {
  const points = entities.flatMap(coord);
  let minX = 0;
  let minY = 0;
  let maxX = 10;
  let maxY = 10;
  if (points.length) {
    minX = Math.min(...points.map((point) => point.x));
    minY = Math.min(...points.map((point) => point.y));
    maxX = Math.max(...points.map((point) => point.x));
    maxY = Math.max(...points.map((point) => point.y));
  }
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const body = entities
    .map((entity) => {
      if (entity.type === 'line') return `<line x1="${entity.a.x}" y1="${-entity.a.y}" x2="${entity.b.x}" y2="${-entity.b.y}" />`;
      if (entity.type === 'polyline') {
        const d = entity.vertices.map((vertex) => `${vertex.x},${-vertex.y}`).join(' ');
        return `<polyline points="${d}" />`;
      }
      if (entity.type === 'circle') return `<circle cx="${entity.center.x}" cy="${-entity.center.y}" r="${entity.radius}" />`;
      if (entity.type === 'text') return `<text x="${entity.p.x}" y="${-entity.p.y}">${entity.content.replace(/[&<>]/g, '')}</text>`;
      return '';
    })
    .filter(Boolean)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${width} ${height}">${body}</svg>`;
}
