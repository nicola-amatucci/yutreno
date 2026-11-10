# YuTreno: copyright and licences

Copyright 2026 Nicola Amatucci.

YuTreno is a personal project of Nicola Amatucci. Different parts of the repository are under different licences, listed below. Where a file or folder says otherwise, the file or folder wins.

## Code

All source code (`src/`, `scripts/`, `examples/` except the data listed below, `docker/`, `golden/`, `campaigns/`, `validation/`) is licensed under the **European Union Public Licence v. 1.2** ([LICENSE](LICENSE), SPDX `EUPL-1.2`). The EUPL is available with equal legal value in all official languages of the European Union, Italian included, at <https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12>.

Programs that talk to YuTreno only through its public protocols (controller, external dynamics, ETCS onboard, trackside, traffic regulator, agents, open data feeds; see `docs/API.md` and the other protocol documents) are separate works: they do not have to be under the EUPL.

## Documentation

The documentation (`docs/`, the `README.md` files and the other Markdown files that describe the project) and the images in `docs/img/` are licensed under **Creative Commons Attribution 4.0 International** (CC BY 4.0, <https://creativecommons.org/licenses/by/4.0/>). Attribution: "YuTreno, Nicola Amatucci".

## Third-party data

These files come from, or are derived from, data of others. They keep the licences of their sources, which are also stated in the README and the import report next to them.

| Files | Source | Licence and attribution |
| :-- | :-- | :-- |
| `examples/infra/*/overpass.json`, and the lines derived from them (`line.json`, `railml.xml`, `report.md` in the same folders) | OpenStreetMap | Open Database License 1.0 (ODbL): © OpenStreetMap contributors, <https://www.openstreetmap.org/copyright>. A database derived from these files must be shared under the ODbL. |
| `examples/infra/*/rinf.json`, and the values the lines take from it | RINF, register of infrastructure of the European Union Agency for Railways | ERA terms of use of the RINF data (<https://www.era.europa.eu/system/files/2022-11/rinf_terms_of_use_en.pdf>). Source: RINF, European Union Agency for Railways. |
| `examples/infra/*/eudem25m.json`, and the gradients derived from it | EU-DEM v1.1, Copernicus Land Monitoring Service, through OpenTopoData | Copernicus data policy, free use with attribution: "Produced using Copernicus data and information funded by the European Union - EU-DEM layers". |
| `examples/infra/salerno-mercato-s-severino/timetable.json` | Trenitalia trips in the NeTEx file of the Campania region (RAP Campania), published on the Italian National Access Point for multimodal travel information (CCISS) | Published by public administrations without an explicit licence, so open data by default under article 52, paragraph 2, of the Italian Digital Administration Code (Legislative Decree 82/2005). Source: Regione Campania, RAP Campania - NeTEx Livello 1, via the National Access Point (CCISS). |

The synthetic sources in `examples/infra/` (`synthetic-*.json`, `borgo-alto-ripa-bassa.*`) are invented by `scripts/infra-fixture.ts` and are under the EUPL like the code.

## Third-party code

- The npm dependencies in `package.json` (Three.js, esbuild, TypeScript, tsx, gtfs-realtime-bindings) and Playwright, used by the page checks, are not part of the repository; each is under its own permissive licence (MIT or Apache-2.0).
- The openETCS code is downloaded by `examples/openetcs/build.sh` into a folder outside the repository and is never committed; it is distributed under the openETCS Open License (EUPL 1.1 or later, CC BY-SA 3.0).
- The ETCS, EULYNX and RFI specifications are referred to by their section numbers and short titles only (`docs/traceability/`); their texts are not part of the repository.

## Reporting a copyright concern

Every effort has been made to include only material that the author wrote, that was generated for this project, or that is published under a licence allowing its reuse, and to credit every source. Still, the repository holds a large amount of code, documentation and data, part of it written with an AI assistant, and something may have slipped through: a passage too close to a protected text, an image, data whose terms are not what they seemed.

If you believe that something in this repository infringes your copyright or another right of yours, or that a source is not credited as it should be, please [open an issue](../../issues/new?template=copyright.md) with the file, what the concern is and, if you can, the original work. The issue will be answered and, where the concern is founded, the material will be removed, replaced or credited properly, without needing any formal notice. If you prefer not to write in public, GitHub's own procedure for copyright notices remains available (<https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy>).

## Use of AI

YuTreno was developed with an AI coding assistant under the direction of its author: see [docs/AI_USE.md](docs/AI_USE.md).
