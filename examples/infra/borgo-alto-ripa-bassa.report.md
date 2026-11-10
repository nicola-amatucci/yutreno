# Import report: Borgo Alto – Ripa Bassa

Line `borgo-alto-ripa-bassa`, 14.250 km from Borgo Alto to Ripa Bassa. Suggested signalling: BACC.

## Sources and licences

- **osm**: OpenStreetMap, Overpass extract (5 ways on the path), data of 2026-11-06T00:00:00Z. Licence: Open Database License 1.0: attribution, and share-alike for derived databases such as this line. Attribution: © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
- **rinf**: RINF, register of infrastructure of the ERA, SPARQL query of the knowledge graph. Licence: ERA terms of use of the RINF data (https://www.era.europa.eu/system/files/2022-11/rinf_terms_of_use_en.pdf). Attribution: RINF, European Union Agency for Railways (https://www.era.europa.eu/domains/registers/rinf_en).
- **yutreno**: rules of YuTreno for what the sources do not give. Licence: as the rest of YuTreno.

## How much of the line is real

| Property | Source / derived / generated |
| :-- | :-- |
| alignment | 100 % / 0 % / 0 % |
| stations | 1 / 3 / 0 stations |
| speed | 70 % / 28 % / 2 % |
| gradient | 35 % / 61 % / 4 % |
| tunnels | 100 % / 0 % / 0 % |
| signals | 0 % / 100 % / 0 % |
| signalling | 72 % / 28 % / 0 % |
| electrification | 72 % / 28 % / 0 % |

Signals: 5 mapped on the path, 4 main; block sections of 1350 m, derived. The signals of the simulation are generated with that block length: a result on this line is read with that caution.

## Stations

| Station | km | Provenance | Element |
| :-- | --: | :-- | :-- |
| Borgo Alto | 0.300 | derived | node/1585 |
| Case Nuove | 5.033 | source | node/1199 |
| Selva Piana | 9.000 | derived | node/1587 |
| Ripa Bassa | 13.950 | derived | node/1588 |

## Speed

| From km | To km | km/h | Provenance | Source |
| --: | --: | --: | :-- | :-- |
| 0.000 | 0.300 | 60 | source | osm way/501 |
| 0.300 | 5.033 | 100 | source | rinf http://data.europa.eu/949/functionalInfrastructure/sectionsOfLine/sol1 |
| 5.033 | 7.016 | 110 | derived | rinf http://data.europa.eu/949/functionalInfrastructure/sectionsOfLine/sol2 |
| 7.016 | 9.000 | 105 | derived | rinf http://data.europa.eu/949/functionalInfrastructure/sectionsOfLine/sol3 |
| 9.000 | 13.950 | 90 | source | rinf http://data.europa.eu/949/functionalInfrastructure/sectionsOfLine/sol4 |
| 13.950 | 14.250 | 80 | generated | yutreno |

Where OSM gives more than the RINF maximum of the section, the RINF value is kept:

- km 1.996–5.033: OSM 120 km/h, RINF 100 km/h
- km 5.033–5.992: OSM 120 km/h, RINF 110 km/h
- km 9.000–10.008: OSM 100 km/h, RINF 90 km/h

Where OSM gives less than RINF, the RINF value is kept (policy `rinf`, the default): these OSM limits are set aside and may be local limits that RINF does not record, to check against a timetable (`npm run plausibility`):

- km 0.300–1.996: OSM 60 km/h, RINF 100 km/h, kept RINF
- km 5.992–7.016: OSM 100 km/h, RINF 110 km/h, kept RINF
- km 7.016–9.000: OSM 100 km/h, RINF 105 km/h, kept RINF

## Consistency of the sources

| From | To | OSM m | RINF m | Difference |
| :-- | :-- | --: | --: | --: |
| Borgo Alto | Case Nuove | 4733 | 4700 | 0.69 % |
| Case Nuove | Selva Piana | 3967 | 4000 | -0.82 % |
| Selva Piana | Ripa Bassa | 4950 | 4950 | 0 % |

## Protection and electrification

- km 0.000–0.300: SCMT (osm)
- km 0.300–5.033: SCMT (rinf)
- km 5.033–9.000: SCMT (rinf)
- km 9.000–13.950: SCMT (rinf)
- km 13.950–14.182: SCMT (osm)
- km 0.000–0.300: contact_line 3000 V DC (osm)
- km 0.300–5.033: overhead 3 kV DC (rinf)
- km 5.033–9.000: overhead 3 kV DC (rinf)
- km 9.000–13.950: overhead 3 kV DC (rinf)
- km 13.950–14.182: contact_line 3000 V DC (osm)

## Warnings

- the mapped track ends near a terminal: 68 m of straight track added
