# Web interface

## Purpose

`src/web/` lets a person drive, edit lines and trains, prepare scenarios, hand the train to a controller and read the data, in a page that works offline from a single HTML file. It contains no physics and no signalling: it reads the state of the core and sends it commands.

## Modules

| Module | Role |
| :-- | :-- |
| `main.ts` | the frame loop, tabs, driver controls, keyboard, briefing and summary, panels and tables |
| `state.ts` | shared state: saved configuration (translated from 0.x on load), current simulation, UI state, controller state, formatting |
| `render.ts` | 2D canvas: DMI, line diagram, distance-speed chart, coupler forces, essential cab view |
| `view3d.ts` | 3D cab view with Three.js: renderer, lights and atmosphere, the frame (`render3d`) |
| `view3d-state.ts`, `path3d.ts`, `world3d.ts`, `trains3d.ts`, `cab3d.ts` | the parts of the 3D view: shared state (`v3`), the line in space, the world built from the compiled line, trains and people and the train the camera rides in, the cab |
| `scene-fingerprint.ts` | a description of the 3D scene for the checks (`YuTreno.scene3d()`) |
| `controllers.ts` | in-browser controller in a Web Worker and external controller via WebSocket, both lockstep |
| `dynamics.ts`, `onboard.ts` | WebSocket connections to an external dynamics model and to an external EVC |
| `panel.ts` | control centre panel of the interlocking trackside |
| `editors.ts` | line editor (plan, profile, tables) and train editor (parameters, consist, traction diagram) |
| `scenarios.ts` | built-in scenarios, JSON editor, events and verdict |
| `timetable.ts` | space-time diagram (planned dashed, realised solid), editor of the service trains with drag in time, checks of the planned timetable (`checkTimetable`), import of GTFS, NeTEx and railML and download of the timetable in use in the three formats (`src/feeds/`) |
| `audio.ts`, `gamepad.ts` | procedural audio and input devices (standard controller, calibrated USB lever) |
| `control-room.ts` | control room: schematic of the network laid out from its topology (SVG), table of the trains, log and the existing commands, all from `sim.controlRoom()` ([CONTROL_ROOM.md](../CONTROL_ROOM.md)) |
| `index.html`, `styles.css` | markup and style; tab ids `drive`, `line`, `train`, `scenarios`, `timetable`, `control`, `controller`, `data` |

`src/docs/model.ts` and `model.html` build the dynamics model page with charts and laboratory computed by the core.

## Frame loop

With service trains the loop runs until every train has finished (`sim.done`); the controller drives only the controlled train. `frame()` accumulates real time multiplied by the chosen speed-up and advances the simulation by as many fixed steps as fit, with a ceiling per frame. Before a step it serves the channels in lockstep: the controller (`ctlSend`/`ctlReceive`, with a 1.5 s timeout and release after three timeouts), the external onboard (`obStep`) and the external dynamics (`dynStep`); if a response is pending the loop stops until the next frame. Then it draws: the DMI first, because its canvas is also the texture of the 3D desk, then the 3D or 2D view, the line diagram, the chart and the couplers; panels and tables are updated at most every 100 ms or when something changed.

## 3D view

The world is a deterministic function of the compiled line and of `hash()`: terrain ribbon, ballast, rails, sleepers (an instanced window ahead of the train), catenary, kilometre posts, tunnels with portals, stations, signals or marker boards, trees and houses, the train ahead. `sweep()` extrudes cross-sections along the track; `placeAt()` places objects by chainage, lateral offset and height. The cab is a child of the camera. Every station has a second track on the right (`track2At`, joined to the line by turnouts at both ends), a second platform with canopy, signs and stop marker, and a footbridge with stair towers; in stations the catenary masts stand beyond the second track. Service trains are built per run (`buildServices`) and placed every frame (`placeServices`): those running back on the second track in stations, turned round. It is rebuilt only when line, signalling, train ahead or quality change. Without WebGL the page stays on the 2D view.

## Controllers in the browser

The editor code runs in a Web Worker built from a Blob: it defines `control(obs, mem)` (version 3 observation) or, for 0.x code, `controllo(oss, mem)` (version 2). The worker reports which one it found in its `ready` message, and `ctlSend` asks the core for the matching observation version. Commands are passed to `applyCommand`, which accepts both languages.

## Persistence

`store` wraps `localStorage` and never throws. Keys: `yutreno-cfg-v1` (configuration, translated with `toEnglish` on load), `yutreno-ctl-code`, `yutreno-onboard-url`, `yutreno-view`, `yutreno-quality`, `bgf-lines` (line library), `banco-guida-leva-v1` (lever calibration).

## Invariants

- No physics or signalling decision in `src/web/`.
- The page must work as a single file without network; network features (external controller, dynamics, onboard) need the local page.
- Accessibility: keyboard controls, reduced motion respected (no camera sway, no wiper animation).

## Tests

`npm run typecheck` covers the web configuration. The files of `src/web/` follow the style of `.prettierrc.json` (`npx prettier --check src/web/*.ts`; Prettier is not a dependency of the project). `scripts/page-golden.mjs` is the golden master of the page: in Chrome with Playwright, with the clock of the page replaced by a manual one, it records the text and fields of every tab and the description of the 3D scene for 24 states (`golden/page.json`, with the scene lines in `golden/page-scene.txt` to see what changed), and fails if any differs; a change of the page on purpose writes it again with `--update`. `scripts/page-checks.mjs` checks the features of phase 7, and the page is smoke-tested when screenshots are regenerated (`scripts/screenshots.mjs`). The behaviour driven by the page is the core's, tested by the verify scripts.
