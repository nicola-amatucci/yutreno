// Scenarios tab: choice of the example scenarios, JSON editor, current events and verdict.
import { describeEvent, describeTrigger, isAnnounced, resolveScenario, toEnglish, validateScenario } from '../core';
import type { ScenarioDef } from '../core';
import { $, app, cfg, esc, saveCfg } from './state';
import { ctlStop } from './controllers';
import { editorsReset } from './editors';
import { copyText, resetRun, updateBrief } from './main';
import rbcEmergencyStop from '../../scenarios/rbc-emergency-stop.json';
import leaves from '../../scenarios/leaves-ponte-sabato.json';
import degradedBrake from '../../scenarios/degraded-brake.json';
import leaderEtcs from '../../scenarios/leader-stopped-etcs.json';
import leaderScmt from '../../scenarios/leader-stopped-scmt.json';
import radioLoss from '../../scenarios/radio-loss.json';
import movingBlock from '../../scenarios/moving-block.json';
import odometryDrift from '../../scenarios/odometry-drift.json';
import movingBlockStopped from '../../scenarios/moving-block-leader-stopped.json';
import movingBlockIntegrity from '../../scenarios/moving-block-integrity-loss.json';
import movingBlockRadio from '../../scenarios/moving-block-radio-loss.json';
import worksite from '../../scenarios/worksite-speed-restriction.json';
import wetDescent from '../../scenarios/wet-descent-worksite.json';
import ixlNominal from '../../scenarios/trackside/nominal.json';
import ixlPoint from '../../scenarios/trackside/point-failure.json';
import ixlTvps from '../../scenarios/trackside/tvps-failure.json';
import ixlOvertaking from '../../scenarios/trackside/overtaking.json';
import ixlOperator from '../../scenarios/trackside/operator-commands.json';
import ixlHandover from '../../scenarios/trackside/handover.json';
import ixlHandoverLink from '../../scenarios/trackside/handover-link-loss.json';
import ixlHandoverRadio from '../../scenarios/trackside/handover-radio-loss.json';
import svcFollowing from '../../scenarios/services/following.json';
import svcCrossing from '../../scenarios/services/crossing.json';
import svcPrecedence from '../../scenarios/services/precedence.json';
import svcBreakdown from '../../scenarios/services/breakdown.json';
import svcCrossingIlk from '../../scenarios/services/crossing-interlocking.json';
import svcCancellation from '../../scenarios/services/cancellation.json';
import svcBranch from '../../scenarios/services/branch.json';
import svcShuttle from '../../scenarios/services/branch-shuttle.json';
import svcBenevento from '../../scenarios/services/benevento.json';
import svcLoop from '../../scenarios/services/loop-reroute.json';

/** Example scenarios included in the page (the same files as the scenarios/ folder) */
export const BUILTIN_SCENARIOS: Record<string, ScenarioDef> = {
  'worksite-speed-restriction': worksite as ScenarioDef,
  'wet-descent-worksite': wetDescent as ScenarioDef,
  'radio-loss': radioLoss as ScenarioDef,
  'moving-block': movingBlock as ScenarioDef,
  'odometry-drift': odometryDrift as ScenarioDef,
  'moving-block-leader-stopped': movingBlockStopped as ScenarioDef,
  'moving-block-integrity-loss': movingBlockIntegrity as ScenarioDef,
  'moving-block-radio-loss': movingBlockRadio as ScenarioDef,
  'rbc-emergency-stop': rbcEmergencyStop as ScenarioDef,
  'leaves-ponte-sabato': leaves as ScenarioDef,
  'degraded-brake': degradedBrake as ScenarioDef,
  'leader-stopped-scmt': leaderScmt as ScenarioDef,
  'leader-stopped-etcs': leaderEtcs as ScenarioDef,
  'trackside/nominal': ixlNominal as ScenarioDef,
  'trackside/point-failure': ixlPoint as ScenarioDef,
  'trackside/tvps-failure': ixlTvps as ScenarioDef,
  'trackside/overtaking': ixlOvertaking as ScenarioDef,
  'trackside/operator-commands': ixlOperator as ScenarioDef,
  'trackside/handover': ixlHandover as ScenarioDef,
  'trackside/handover-link-loss': ixlHandoverLink as ScenarioDef,
  'trackside/handover-radio-loss': ixlHandoverRadio as ScenarioDef,
  'services/following': svcFollowing as ScenarioDef,
  'services/crossing': svcCrossing as ScenarioDef,
  'services/precedence': svcPrecedence as ScenarioDef,
  'services/breakdown': svcBreakdown as ScenarioDef,
  'services/crossing-interlocking': svcCrossingIlk as ScenarioDef,
  'services/cancellation': svcCancellation as ScenarioDef,
  'services/branch': svcBranch as ScenarioDef,
  'services/branch-shuttle': svcShuttle as ScenarioDef,
  'services/benevento': svcBenevento as unknown as ScenarioDef,
  'services/loop-reroute': svcLoop as ScenarioDef,
};

const CUSTOM = '__custom';
const json = (d: unknown) => JSON.stringify(d, null, 2);
const builtinKeyOf = (d: ScenarioDef | null) =>
  d ? Object.keys(BUILTIN_SCENARIOS).find(k => json(BUILTIN_SCENARIOS[k]) === json(d)) : undefined;

function fillSelect(): void {
  const cur = builtinKeyOf(cfg.scenario);
  $('scnSel').innerHTML =
    Object.entries(BUILTIN_SCENARIOS)
      .map(([k, d]) => `<option value="${k}">${esc(d.name)}</option>`)
      .join('') + (cfg.scenario && !cur ? `<option value="${CUSTOM}">${esc(cfg.scenario.name)} (custom)</option>` : '');
  $('scnSel').value = cur ?? (cfg.scenario ? CUSTOM : Object.keys(BUILTIN_SCENARIOS)[0]);
  preview();
}

/** Shows description and JSON of the scenario chosen in the menu, without applying it */
function preview(): void {
  const k = $('scnSel').value;
  const d = k === CUSTOM ? cfg.scenario : BUILTIN_SCENARIOS[k];
  if (!d) return;
  $('scnDesc').textContent = d.description || 'No description.';
  const r = resolveScenario(d, { line: cfg.line, train: cfg.train, scen: cfg.scen });
  $('scnMeta').innerHTML =
    `<span>Line <b>${esc(r.line.name)}</b></span><span>Train <b>${esc(r.train.name)}</b></span>` +
    `<span>Signalling <b>${r.scen.sig === 'ETCS' ? 'ETCS L2' : 'BAcc + SCMT'}</b></span><span>Events <b>${(d.events || []).length}</b></span>` +
    (d.services?.length ? `<span>Service trains <b>${d.services.length}</b></span>` : '');
  $('scnJson').value = json(d);
}

/** Uses a scenario (or none) for the next runs and restarts */
export function applyScenario(def: ScenarioDef | null): void {
  apply(def);
}

function apply(def: ScenarioDef | null): void {
  if (def) {
    const r = resolveScenario(def, { line: cfg.line, train: cfg.train, scen: cfg.scen });
    cfg.line = r.line;
    cfg.train = r.train;
    cfg.scen = r.scen;
  }
  cfg.scenario = def;
  saveCfg();
  editorsReset();
  ctlStop('');
  resetRun();
  updateBrief();
  $('summary').hidden = true;
  $('brief').hidden = false;
  fillSelect();
  renderScenarioTab();
}

export function verdictHtml(final: boolean): string {
  const v = app.sim.verdict();
  const ko = v.checks.filter(c => !c.ok);
  if (!final) return '';
  return (
    `<div class="esito ${v.outcome === 'passed' ? 'ok' : 'ko'}">${app.sim.scenario ? 'Scenario «' + esc(app.sim.scenario.name) + '»: ' : 'Outcome: '}` +
    `${v.outcome}${ko.length ? ' · ' + ko.map(c => esc(c.name.toLowerCase()) + ' ' + esc(c.value)).join(', ') : ''}</div>`
  );
}

export function renderScenarioTab(): void {
  const sim = app.sim,
    sc = sim.scenario;
  $('scnPill').textContent = sc ? 'in use: ' + sc.name : 'no scenario in use';
  $('scnPill').className = 'pill' + (sc ? ' on' : '');
  $('scnEvents').innerHTML = sim.scenarioEvents.length
    ? '<tr><th>Event</th><th>When</th><th>State</th></tr>' +
      sim.scenarioEvents
        .map(
          e =>
            `<tr><td>${esc(describeEvent(e.def))}${isAnnounced(e.def) ? '' : ' <span class="hint">· not announced</span>'}</td><td>${esc(describeTrigger(e.def))}</td>` +
            `<td><span class="phase ${e.phase}">${e.phase === 'pending' ? 'waiting' : e.phase}</span></td></tr>`,
        )
        .join('')
    : '<tr><td style="color:var(--muted)">The current run has no scenario: it takes place without scheduled events.</td></tr>';
  const v = sim.verdict();
  $('scnVerdictHint').textContent = sim.S.finished
    ? `Run finished: ${v.outcome === 'passed' ? 'scenario passed' : 'scenario failed'}.`
    : 'Provisional verdict: it becomes final when the run ends.';
  $('scnVerdict').innerHTML =
    '<tr><th>Check</th><th style="text-align:right">Value</th><th style="text-align:right">Threshold</th><th></th></tr>' +
    v.checks
      .map(
        c =>
          `<tr><td>${esc(c.name)}</td><td class="n">${esc(c.value)}</td><td class="n">${esc(c.threshold)}</td><td class="${c.ok ? 'ok' : 'ko'}">${c.ok ? 'ok' : 'no'}</td></tr>`,
      )
      .join('');
}

$('scnSel').addEventListener('change', preview);
$('scnApply').onclick = () => {
  const k = $('scnSel').value;
  apply(k === CUSTOM ? cfg.scenario : JSON.parse(json(BUILTIN_SCENARIOS[k])));
  $('scnMsg').textContent = 'Scenario applied: start the run from the Drive tab.';
};
$('scnNone').onclick = () => {
  apply(null);
  $('scnMsg').textContent = 'Run without scenario: line and train stay the ones in use.';
};
$('scnFromJson').onclick = () => {
  let d: ScenarioDef;
  try {
    d = toEnglish(JSON.parse($('scnJson').value));
  } catch (e) {
    $('scnMsg').textContent = 'Invalid JSON: ' + (e as Error).message;
    return;
  }
  const err = validateScenario(d);
  if (err.length) {
    $('scnMsg').textContent = 'The scenario has errors: ' + err.join('; ') + '.';
    return;
  }
  apply(d);
  $('scnMsg').textContent = 'Scenario «' + d.name + '» applied: start the run from the Drive tab.';
};
$('scnCopy').onclick = () => copyText($('scnJson').value, 'Scenario data', 'scnMsg');
fillSelect();
