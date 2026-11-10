/**
 * The queries of the infrastructure import (docs/INFRA_IMPORT.md, docs/LINE_TUTORIAL.md), in one place: the tutorial
 * shows them for manual use and `npm run line-from-sources` sends them.
 */

/** Bounding box in the order of Overpass: south, west, north, east (degrees) */
export type BBox = [number, number, number, number];

/** Overpass query for the railway of a bounding box: running tracks with their nodes, stations, stops, signals */
export function overpassQuery(b: BBox): string {
  const bb = b.map(x => +x.toFixed(5)).join(',');
  return `[out:json][timeout:180];
(
  way["railway"~"^(rail|narrow_gauge)$"](${bb});
  node["railway"~"^(station|halt|stop|signal)$"](${bb});
  node["public_transport"~"^(station|stop_position)$"]["train"="yes"](${bb});
);
out body;
>;
out skel qt;`;
}

/** Overpass query for the stations with a given name, anywhere: to find the bounding box of a line */
export function overpassStationQuery(names: string[]): string {
  const re = names.map(n => n.replace(/[\\^$.*+?()[\]{}|"]/g, '\\$&')).join('|');
  return `[out:json][timeout:60];
node["railway"~"^(station|halt)$"]["name"~"^(${re})$",i];
out body;`;
}

/** RINF: the national lines with an operational point whose name contains `word` (case ignored) */
export function rinfFindLineQuery(word: string): string {
  return `PREFIX era: <http://data.europa.eu/949/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?line ?name WHERE {
  ?op a era:OperationalPoint ; era:opName ?name . FILTER (CONTAINS(LCASE(STR(?name)), ${JSON.stringify(word.toLowerCase())}))
  { ?sol era:opStart ?op } UNION { ?sol era:opEnd ?op }
  ?sol era:nationalLine/rdfs:label ?line .
}`;
}

/** RINF: the sections of a national line, one row per track, with the columns that src/infra/rinf.ts reads */
export function rinfSectionsQuery(lineId: string): string {
  return `PREFIX era: <http://data.europa.eu/949/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?sol ?opStart ?opEnd ?opStartName ?opEndName ?length ?maxSpeed ?etcsLevel ?protection ?contactLine ?lineId
  (GROUP_CONCAT(DISTINCT ?gp; separator=" ") AS ?gradientProfile)
  (GROUP_CONCAT(DISTINCT ?ks; separator=";") AS ?opStartKm) (GROUP_CONCAT(DISTINCT ?ke; separator=";") AS ?opEndKm) WHERE {
  ?sol a era:SectionOfLine ; era:opStart ?opStart ; era:opEnd ?opEnd ; era:nationalLine ?nl .
  ?nl rdfs:label ?lineLabel . BIND (STR(?lineLabel) AS ?lineId) FILTER (?lineId = ${JSON.stringify(lineId)})
  ?opStart era:opName ?opStartName . ?opEnd era:opName ?opEndName .
  OPTIONAL { ?sol era:lengthOfSectionOfLine ?km } BIND (?km * 1000 AS ?length)
  OPTIONAL { ?sol era:hasPart ?track . ?track a era:RunningTrack .
    OPTIONAL { ?track era:maximumPermittedSpeed ?maxSpeed }
    OPTIONAL { ?track era:etcs/era:etcsLevelType/skos:prefLabel ?etcsLevel }
    OPTIONAL { ?track era:protectionLegacySystem/skos:prefLabel ?protection }
    OPTIONAL { ?track era:contactLineSystem/era:energySupplySystem/skos:prefLabel ?contactLine }
    OPTIONAL { ?track era:gradientProfile ?gp } }
  OPTIONAL { ?opStart era:netReference/era:hasLrsCoordinate/rdfs:label ?ks }
  OPTIONAL { ?opEnd era:netReference/era:hasLrsCoordinate/rdfs:label ?ke }
} GROUP BY ?sol ?opStart ?opEnd ?opStartName ?opEndName ?length ?maxSpeed ?etcsLevel ?protection ?contactLine ?lineId`;
}

/** Public endpoints, in order of preference */
export const ENDPOINTS = {
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'],
  rinf: 'https://graph.data.era.europa.eu/repositories/rinf-plus',
  dem: 'https://api.opentopodata.org/v1/eudem25m',
};

/** URLs of OpenTopoData for a list of points, 100 points per request */
export function demUrls(points: { lat: number; lon: number }[], base = ENDPOINTS.dem): string[] {
  const out: string[] = [];
  for (let i = 0; i < points.length; i += 100) out.push(`${base}?locations=${points.slice(i, i + 100).map(p => `${p.lat},${p.lon}`).join('|')}`);
  return out;
}
