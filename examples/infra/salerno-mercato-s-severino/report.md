# Import report: Salerno – Mercato San Severino

Line `salerno-mercato-s-severino`, 18.420 km from Salerno to Mercato San Severino. Suggested signalling: BACC.

## Sources and licences

- **osm**: OpenStreetMap, Overpass extract (61 ways on the path), data of 2026-11-06T19:22:51Z. Licence: Open Database License 1.0: attribution, and share-alike for derived databases such as this line. Attribution: © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
- **rinf**: RINF, register of infrastructure of the ERA, SPARQL query of the knowledge graph. Licence: ERA terms of use of the RINF data (https://www.era.europa.eu/system/files/2022-11/rinf_terms_of_use_en.pdf). Attribution: RINF, European Union Agency for Railways (https://www.era.europa.eu/domains/registers/rinf_en).
- **dem**: EU-DEM v1.1, 25 m (Copernicus Land Monitoring Service), through OpenTopoData, 185 points on the line. Licence: Copernicus data policy: free and open use with attribution. Attribution: Produced using Copernicus data and information funded by the European Union - EU-DEM layers.
- **yutreno**: rules of YuTreno for what the sources do not give. Licence: as the rest of YuTreno.

## How much of the line is real

| Property | Source / derived / generated |
| :-- | :-- |
| alignment | 100 % / 0 % / 0 % |
| stations | 9 / 0 / 0 stations |
| speed | 100 % / 0 % / 0 % |
| gradient | 96 % / 4 % / 0 % |
| tunnels | 100 % / 0 % / 0 % |
| signals | 0 % / 0 % / 100 % |
| signalling | 98 % / 0 % / 2 % |
| electrification | 100 % / 0 % / 0 % |

Signals: 2 mapped on the path, 0 main; block sections of 1300 m, generated. The signals of the simulation are generated with that block length: a result on this line is read with that caution.

## Stations

| Station | km | Provenance | Element |
| :-- | --: | :-- | :-- |
| Salerno | 0.420 | source | node/4459476379 |
| Salerno Irno | 1.835 | source | node/651269519 |
| Fratte-Villa Comunale | 3.425 | source | node/13416771608 |
| Fratte | 3.854 | source | node/8761494916 |
| Pellezzano | 9.850 | source | node/13416770369 |
| Acquamela | 11.140 | source | node/13416782398 |
| Baronissi | 12.604 | source | node/13416815824 |
| Fisciano | 14.348 | source | node/13416836228 |
| Mercato San Severino | 18.024 | source | node/8772897520 |

## Speed

| From km | To km | km/h | Provenance | Source |
| --: | --: | --: | :-- | :-- |
| 0.000 | 0.420 | 110 | source | osm way/400574905 way/400574904 way/225207215 … |
| 0.420 | 3.425 | 60 | source | rinf http://data.europa.eu/949/sectionOfLine/f068b31e05 http://data.europa.eu/949/sectionOfLine/c3aa57b929 |
| 3.425 | 9.850 | 85 | source | rinf http://data.europa.eu/949/sectionOfLine/83818d108f http://data.europa.eu/949/sectionOfLine/3110089892 |
| 9.850 | 11.140 | 80 | source | rinf http://data.europa.eu/949/sectionOfLine/3e9f6cd0c9 |
| 11.140 | 18.024 | 85 | source | rinf http://data.europa.eu/949/sectionOfLine/c34c16f2da http://data.europa.eu/949/sectionOfLine/f95d1967c5 http://data.europa.eu/949/sectionOfLine/b7b89a6332 |
| 18.024 | 18.248 | 85 | source | osm way/946490538 way/946490539 way/946490549 … |
| 18.248 | 18.420 | 120 | source | osm way/1035377290 |

Where OSM gives more than the RINF maximum of the section, the RINF value is kept:

- km 0.420–0.828: OSM 110 km/h, RINF 60 km/h
- km 10.720–11.140: OSM 85 km/h, RINF 80 km/h

Where OSM gives less than RINF, the RINF value is kept (policy `rinf`, the default): these OSM limits are set aside and may be local limits that RINF does not record, to check against a timetable (`npm run plausibility`):

- km 0.828–1.613: OSM 30 km/h, RINF 60 km/h, kept RINF
- km 3.425–3.497: OSM 60 km/h, RINF 85 km/h, kept RINF
- km 8.490–9.850: OSM 80 km/h, RINF 85 km/h, kept RINF

## Gradients of RINF against the DEM

Climb from station to station (m) with the gradients of RINF, used for the line, and with the ground of the DEM:

| From | To | RINF m | DEM m |
| :-- | :-- | --: | --: |
| Salerno | Salerno Irno | 15.9 | 17.6 |
| Salerno Irno | Fratte-Villa Comunale | 25.4 | 21.5 |
| Fratte-Villa Comunale | Fratte | 4 | 6.5 |
| Fratte | Pellezzano | 88 | 87.7 |
| Pellezzano | Acquamela | 14.3 | 18.3 |
| Acquamela | Baronissi | 23.9 | 22.7 |
| Baronissi | Fisciano | 10.5 | 8.5 |
| Fisciano | Mercato San Severino | -52.6 | -52.2 |

## Consistency of the sources

| From | To | OSM m | RINF m | Difference |
| :-- | :-- | --: | --: | --: |
| Salerno | Salerno Irno | 1416 | 1407 | 0.6 % |
| Salerno Irno | Fratte-Villa Comunale | 1589 | 1578 | 0.72 % |
| Fratte-Villa Comunale | Fratte | 430 | 435 | -1.15 % |
| Fratte | Pellezzano | 5995 | 6036 | -0.68 % |
| Pellezzano | Acquamela | 1291 | 1296 | -0.42 % |
| Acquamela | Baronissi | 1463 | 1454 | 0.65 % |
| Baronissi | Fisciano | 1745 | 1747 | -0.13 % |
| Fisciano | Mercato San Severino | 3675 | 3674 | 0.04 % |

## Protection and electrification

- km 0.420–18.024: SCMT (rinf)
- km 18.024–18.420: SCMT (osm)
- km 0.000–0.420: contact_line 3000 V DC (osm)
- km 0.420–18.024: DC 3kV (rinf)
- km 18.024–18.420: contact_line 3000 V DC (osm)

## Warnings

- RINF: kilometre 53.090 of Salerno does not agree with the next stations, not used for the gradients
- RINF: kilometre 43.664 of Mercato San Severino does not agree with the next stations, not used for the gradients
- RINF: change of gradient at km 17.749 outside the line, left out
