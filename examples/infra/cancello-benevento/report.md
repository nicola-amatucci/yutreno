# Import report: Cancello – Benevento

Line `cancello-benevento`, 49.308 km from Cancello to Benevento. Suggested signalling: BACC.

## Sources and licences

- **osm**: OpenStreetMap, Overpass extract (76 ways on the path), data of 2026-11-06T16:33:58Z. Licence: Open Database License 1.0: attribution, and share-alike for derived databases such as this line. Attribution: © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
- **rinf**: RINF, register of infrastructure of the ERA, SPARQL query of the knowledge graph. Licence: ERA terms of use of the RINF data (https://www.era.europa.eu/system/files/2022-11/rinf_terms_of_use_en.pdf). Attribution: RINF, European Union Agency for Railways (https://www.era.europa.eu/domains/registers/rinf_en).
- **dem**: EU-DEM v1.1, 25 m (Copernicus Land Monitoring Service), through OpenTopoData, 491 points on the line. Licence: Copernicus data policy: free and open use with attribution. Attribution: Produced using Copernicus data and information funded by the European Union - EU-DEM layers.
- **yutreno**: rules of YuTreno for what the sources do not give. Licence: as the rest of YuTreno.

## How much of the line is real

| Property | Source / derived / generated |
| :-- | :-- |
| alignment | 100 % / 0 % / 0 % |
| stations | 11 / 1 / 0 stations |
| speed | 100 % / 0 % / 0 % |
| gradient | 98 % / 2 % / 0 % |
| tunnels | 100 % / 0 % / 0 % |
| signals | 0 % / 0 % / 100 % |
| signalling | 3 % / 0 % / 97 % |
| electrification | 100 % / 0 % / 0 % |

Signals: 3 mapped on the path, 0 main; block sections of 1300 m, generated. The signals of the simulation are generated with that block length: a result on this line is read with that caution.

## Stations

| Station | km | Provenance | Element |
| :-- | --: | :-- | :-- |
| Cancello | 0.466 | source | node/8425634253 |
| San Felice a Cancello | 6.150 | source | node/11407285517 |
| Santa Maria a Vico | 8.687 | source | node/11407285514 |
| Arpaia-Airola-Sant'Agata | 21.019 | source | node/1538249924 |
| Rotondi - Paolisi | 24.321 | source | node/3898090541 |
| Cervinara | 26.465 | source | node/11407285510 |
| San Martino Valle Caudina - Montesarchio - Pannarano | 29.821 | source | node/11407285507 |
| Tufara Valle - Arpaise - Ceppaloni | 35.494 | source | node/8892655281 |
| Benevento Pontecorvo - Castelpoto | 42.744 | derived | node/736959851 |
| Benevento Rione Libertà | 45.221 | source | node/735982268 |
| Benevento Appia | 46.165 | source | node/14066353416 |
| Benevento | 48.895 | source | node/1538249859 |

## Speed

| From km | To km | km/h | Provenance | Source |
| --: | --: | --: | :-- | :-- |
| 0.000 | 0.067 | 110 | source | osm way/184281341 |
| 0.067 | 0.448 | 90 | source | osm way/161965859 |
| 0.448 | 0.466 | 60 | source | osm way/140392376 |
| 0.466 | 48.895 | 80 | source | rinf http://data.europa.eu/949/sectionOfLine/89fff8fdc7 http://data.europa.eu/949/sectionOfLine/d914735dee http://data.europa.eu/949/sectionOfLine/7092452d47 … |
| 48.895 | 49.308 | 80 | source | osm way/1001067794 way/161911741 way/161911736 |

Where OSM gives less than RINF, the RINF value is kept (policy `rinf`, the default): these OSM limits are set aside and may be local limits that RINF does not record, to check against a timetable (`npm run plausibility`):

- km 0.466–0.939: OSM 60 km/h, RINF 80 km/h, kept RINF

## Gradients of RINF against the DEM

Climb from station to station (m) with the gradients of RINF, used for the line, and with the ground of the DEM:

| From | To | RINF m | DEM m |
| :-- | :-- | --: | --: |
| Cancello | San Felice a Cancello | 26.2 | 38.5 |
| San Felice a Cancello | Santa Maria a Vico | 6.1 | 7.3 |
| Santa Maria a Vico | Arpaia-Airola-Sant'Agata | 194.8 | 202.3 |
| Arpaia-Airola-Sant'Agata | Rotondi - Paolisi | -27 | -17.4 |
| Rotondi - Paolisi | Cervinara | -7.6 | 4.4 |
| Cervinara | San Martino Valle Caudina - Montesarchio - Pannarano | 11.9 | 4.7 |
| San Martino Valle Caudina - Montesarchio - Pannarano | Tufara Valle - Arpaise - Ceppaloni | -71.1 | -76.6 |
| Tufara Valle - Arpaise - Ceppaloni | Benevento Pontecorvo - Castelpoto | -80.7 | -70.1 |
| Benevento Pontecorvo - Castelpoto | Benevento Rione Libertà | -3.1 | -4 |
| Benevento Rione Libertà | Benevento Appia | -5.3 | -9.2 |
| Benevento Appia | Benevento | 7.3 | 5.5 |

## Consistency of the sources

| From | To | OSM m | RINF m | Difference |
| :-- | :-- | --: | --: | --: |
| Cancello | San Felice a Cancello | 5685 | 5689 | -0.08 % |
| San Felice a Cancello | Santa Maria a Vico | 2537 | 2514 | 0.9 % |
| Santa Maria a Vico | Arpaia-Airola-Sant'Agata | 12332 | 12374 | -0.34 % |
| Arpaia-Airola-Sant'Agata | Rotondi - Paolisi | 3302 | 3298 | 0.11 % |
| Rotondi - Paolisi | Cervinara | 2144 | 2148 | -0.2 % |
| Cervinara | San Martino Valle Caudina - Montesarchio - Pannarano | 3356 | 3376 | -0.59 % |
| San Martino Valle Caudina - Montesarchio - Pannarano | Tufara Valle - Arpaise - Ceppaloni | 5673 | 5656 | 0.31 % |
| Tufara Valle - Arpaise - Ceppaloni | Benevento Pontecorvo - Castelpoto | 7250 | 7242 | 0.11 % |
| Benevento Pontecorvo - Castelpoto | Benevento Rione Libertà | 2477 | 2481 | -0.15 % |
| Benevento Rione Libertà | Benevento Appia | 944 | 955000 | -99.9 % |
| Benevento Appia | Benevento | 2730 | 2735 | -0.19 % |

## Protection and electrification

- km 0.000–0.939: SCMT (osm)
- km 48.895–49.308: SSC (osm)
- km 0.000–0.466: contact_line 3000 V DC (osm)
- km 0.466–48.895: DC 3kV (rinf)
- km 48.895–49.028: contact_line 3000 V DC (osm)
- km 49.028–49.308: none (osm)

## Warnings

- RINF: change of gradient at km 132.411 outside the line, left out
- Benevento Rione Libertà – Benevento Appia: OSM 944 m against RINF 955000 m (-99.9 %)
