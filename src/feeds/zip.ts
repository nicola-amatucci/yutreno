/** Minimal ZIP writer (stored entries, no compression): enough for a GTFS feed, without dependencies */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** ZIP archive of text files; the date of the entries is fixed, so the same files give the same bytes */
export function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  const DOS_TIME = 0, DOS_DATE = (2020 - 1980) << 9 | 1 << 5 | 1;
  for (const [name, text] of Object.entries(files)) {
    const data = enc.encode(text), nm = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, DOS_TIME, true); h.setUint16(12, DOS_DATE, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, DOS_TIME, true); c.setUint16(14, DOS_DATE, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}

/**
 * Entries of a ZIP archive, read from its central directory (so archives written with data descriptors work too).
 * Stored entries are returned as they are; deflated ones go through `inflateRaw`, which the caller provides
 * (zlib.inflateRawSync in Node, DecompressionStream('deflate-raw') in the browser).
 */
export async function unzip(b: Uint8Array, inflateRaw?: (d: Uint8Array) => Uint8Array | Promise<Uint8Array>): Promise<Record<string, Uint8Array>> {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength), dec = new TextDecoder();
  let eocd = -1;
  for (let p = b.length - 22; p >= Math.max(0, b.length - 22 - 65535); p--) if (d.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const n = d.getUint16(eocd + 10, true);
  let p = d.getUint32(eocd + 16, true);
  const out: Record<string, Uint8Array> = {};
  for (let k = 0; k < n; k++) {
    if (d.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP: broken central directory');
    const method = d.getUint16(p + 10, true), size = d.getUint32(p + 20, true);
    const nl = d.getUint16(p + 28, true), xl = d.getUint16(p + 30, true), cl = d.getUint16(p + 32, true), off = d.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const start = off + 30 + d.getUint16(off + 26, true) + d.getUint16(off + 28, true), data = b.subarray(start, start + size);
    if (method === 0) out[name] = data;
    else if (method === 8) {
      if (!inflateRaw) throw new Error(`ZIP: ${name} is compressed and no inflate function was given`);
      out[name] = await inflateRaw(data);
    } else throw new Error(`ZIP: compression method ${method} of ${name} not supported`);
  }
  return out;
}
