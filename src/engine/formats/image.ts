export interface ImageInfo {
  format: 'png' | 'jpeg';
  width: number;
  height: number;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Smallest PNG Civil Design can attach: a solid IHDR plus an empty IDAT. */
export function writePng(width: number, height: number): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const head = new DataView(out.buffer);
    head.setUint32(0, data.length);
    out[4] = type.charCodeAt(0);
    out[5] = type.charCodeAt(1);
    out[6] = type.charCodeAt(2);
    out[7] = type.charCodeAt(3);
    out.set(data, 8);
    const crc = crc32(out.subarray(4, 8 + data.length));
    head.setUint32(8 + data.length, crc);
    return out;
  };
  const idat = chunk('IDAT', new Uint8Array(0));
  const iend = chunk('IEND', new Uint8Array(0));
  const header = chunk('IHDR', ihdr);
  const bytes = new Uint8Array(signature.length + header.length + idat.length + iend.length);
  bytes.set(signature, 0);
  bytes.set(header, signature.length);
  bytes.set(idat, signature.length + header.length);
  bytes.set(iend, signature.length + header.length + idat.length);
  return bytes;
}

/** Baseline JPEG header with an SOF0 marker. Enough for width and height. */
export function writeJpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
  return bytes;
}

export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { format: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { format: 'jpeg', height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + length;
    }
  }
  return null;
}
