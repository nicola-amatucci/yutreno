/** Import of the real infrastructure from OpenStreetMap and RINF (docs/INFRA_IMPORT.md) */
export * from './types';
export * from './geo';
export { parseOverpass, osmTrack, parseSpeed, type OsmData } from './osm';
export { parseRinf, rinfOverlay, abbreviated, type RinfOverlay } from './rinf';
export { importInfrastructure, reportMarkdown, OSM_ATTRIBUTION, RINF_ATTRIBUTION, DEM_ATTRIBUTION } from './build';
export { elevationPoints, parseElevation, demProfile, type ElevationPoint } from './dem';
export { railmlInfrastructure, importRailmlInfrastructure } from './railml';
export { overpassQuery, overpassStationQuery, rinfFindLineQuery, rinfSectionsQuery, demUrls, ENDPOINTS, type BBox } from './queries';
