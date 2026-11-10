/** Import of a timetable file of any supported format (GTFS, NeTEx, railML 2 and 3), recognised from its name and content */
import { detectFormat, type ImportOptions, type ImportResult } from './import';
import { importGtfs } from './import-gtfs';
import { importNetex } from './import-netex';
import { importRailml } from './railml';
import { unzip } from './zip';

/**
 * Services of a GTFS archive (.zip), of a NeTEx document or of a railML document. `inflateRaw` decompresses the deflated entries of a
 * ZIP (zlib.inflateRawSync in Node, DecompressionStream in the browser).
 */
export async function importTimetable(name: string, data: Uint8Array, o: ImportOptions = {},
  inflateRaw?: (d: Uint8Array) => Uint8Array | Promise<Uint8Array>): Promise<ImportResult> {
  const fmt = detectFormat(name, data), dec = new TextDecoder();
  if (fmt === 'gtfs') {
    const entries = await unzip(data, inflateRaw);
    // feeds zipped with a folder inside: take the files by their base name
    const files = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k.split('/').pop() as string, dec.decode(v)]));
    return importGtfs(files, o);
  }
  if (fmt === 'netex') return importNetex(dec.decode(data), o);
  if (fmt === 'railml') return importRailml(dec.decode(data), o);
  throw new Error(`${name}: format not recognised (GTFS .zip, NeTEx PublicationDelivery or railML expected)`);
}
