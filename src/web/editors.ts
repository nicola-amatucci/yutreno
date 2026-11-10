// Editors of the line (plan, profile, tables) and of the train (parameters, traction diagram).
import {
  DEFAULT_COUPLER,
  LINE_PRESETS,
  TRAIN_PRESETS,
  buildConsist,
  clone,
  compileLine,
  consistSummary,
  fitPlan,
  toEnglish,
  xyOf,
} from '../core';
import {
  $,
  COL,
  L,
  MONO,
  SANS,
  app,
  cfg,
  clampN as clamp,
  esc,
  fit,
  mmss,
  num,
  parseMmss,
  saveCfg,
  store,
  ui,
} from './state';
import { ctlStop } from './controllers';
import { copyText, resetRun, updateBrief } from './main';
const G = 9.81;
const TR_FIELDS: [string, string, number, number][] = [
  ['m', 'Mass (t)', 1e-3, 1],
  ['rot', 'Rotating mass factor', 1, 0.01],
  ['L', 'Length (m)', 1, 5],
  ['vmax', 'Max speed (km/h)', 3.6, 5],
  ['Pw', 'Power at the wheel (MW)', 1e-6, 0.1],
  ['Fmax', 'Max starting effort (kN)', 1e-3, 5],
  ['adh', 'Share of mass on motored axles', 1, 0.01],
  ['eta', 'Traction efficiency', 1, 0.01],
  ['A', 'Davis A (kN)', 1e-3, 0.1],
  ['B', 'Davis B', 1, 1],
  ['C', 'Davis C', 1, 0.1],
  ['bSvc', 'Service decel. (m/s²)', 1, 0.05],
  ['bEm', 'Emergency decel. (m/s²)', 1, 0.05],
  ['tauB', 'Brake application delay (s)', 1, 0.1],
  ['tauR', 'Brake release delay (s)', 1, 0.1],
  ['edMax', 'Max electric brake (kN)', 1e-3, 5],
  ['etaR', 'Regeneration efficiency', 1, 0.01],
];

let ED = null,
  EL = null,
  edSel = -1,
  edPSel = -1,
  edView = null,
  edDrag = null,
  edProfMap = null;
function libLines() {
  const l = store.get('bgf-lines') || {};
  for (const k of Object.keys(l)) l[k] = toEnglish(l[k]);
  return l;
}
function edFillPresets() {
  const sel = $('lnPreset'),
    lib = libLines();
  sel.innerHTML =
    '<option value="">— line in use —</option>' +
    Object.entries(LINE_PRESETS)
      .map(([k, v]) => '<option value="p:' + k + '">' + esc(v.name) + ' (built-in)</option>')
      .join('') +
    Object.keys(lib)
      .map(k => '<option value="u:' + esc(k) + '">' + esc(k) + '</option>')
      .join('');
}
/** Opens the line editor on the line in use */
export function edOpen() {
  if (!ED) {
    ED = clone(cfg.line);
    edFillPresets();
    edRebuild(true);
  } else edRender();
}
function edMark(d) {
  $('lnDirty').textContent = d ? 'changes not applied' : 'applied';
  $('lnDirty').className = 'pill' + (d ? ' on' : '');
}
function edRebuild(refit) {
  EL = compileLine(ED);
  if (refit) edView = null;
  $('lnName').value = ED.name;
  $('lnBlock').value = ED.block || 1300;
  const fr = ED.freight || {};
  $('frOn').value = fr.on ? '1' : '0';
  $('frS0').value = ((fr.s0 || 0) / 1000).toFixed(2);
  $('frV').value = fr.vmax || 60;
  $('frL').value = fr.len || 400;
  $('frStop').value = ((fr.stopAt || 0) / 1000).toFixed(2);
  $('frWait').value = fr.wait || 0;
  edTables();
  edRender();
}
function edChanged(refit) {
  EL = compileLine(ED);
  if (refit) edView = null;
  edMark(true);
  edRender();
}
function edStats() {
  const r = EL.rmin,
    bad = r < 400;
  $('plStats').innerHTML =
    '<span>Length <b>' +
    num(EL.len / 1000, 2) +
    ' km</b></span><span class="' +
    (bad ? 'bad' : '') +
    '">Minimum radius <b>' +
    (r > 1e5 ? 'straight' : Math.round(r) + ' m') +
    '</b></span>' +
    '<span>Max gradient <b>' +
    num(EL.imax, 1) +
    ' ‰</b></span><span>Altitudes <b>' +
    Math.round(EL.amin) +
    '–' +
    Math.round(EL.amax) +
    ' m</b></span><span>Signals or marker boards <b>' +
    EL.sig.length +
    '</b></span>' +
    (EL.warnings.length ? '<span class="bad">Warning: ' + EL.warnings.join(', ') + '</span>' : '');
}
function planView(W, H) {
  if (edView) return edView;
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (let k = 0; k < EL.N; k++) {
    x0 = Math.min(x0, EL.X[k]);
    x1 = Math.max(x1, EL.X[k]);
    y0 = Math.min(y0, EL.Y[k]);
    y1 = Math.max(y1, EL.Y[k]);
  }
  ED.plan.forEach(p => {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  });
  const pd = 40,
    sc = Math.min((W - 2 * pd) / Math.max(200, x1 - x0), (H - 2 * pd) / Math.max(200, y1 - y0));
  edView = { sc, ox: W / 2 - ((x0 + x1) / 2) * sc, oy: H / 2 + ((y0 + y1) / 2) * sc };
  return edView;
}
function renderPlan() {
  const { c, W, H } = fit($('cvPlan'));
  c.fillStyle = COL.panel2;
  c.fillRect(0, 0, W, H);
  const v = planView(W, H),
    P = (x, y) => [v.ox + x * v.sc, v.oy - y * v.sc];
  const gs = v.sc * 1000 > 120 ? 1000 : v.sc * 1000 > 40 ? 2000 : 5000;
  c.strokeStyle = 'rgba(139,156,166,.12)';
  c.lineWidth = 1;
  const gx0 = Math.floor(-v.ox / v.sc / gs) * gs,
    gy0 = Math.floor((v.oy - H) / v.sc / gs) * gs;
  for (let x = gx0; x < gx0 + W / v.sc + gs; x += gs) {
    const [px] = P(x, 0);
    c.beginPath();
    c.moveTo(px, 0);
    c.lineTo(px, H);
    c.stroke();
  }
  for (let y = gy0; y < gy0 + H / v.sc + gs; y += gs) {
    const [, py] = P(0, y);
    c.beginPath();
    c.moveTo(0, py);
    c.lineTo(W, py);
    c.stroke();
  }
  c.fillStyle = COL.muted;
  c.font = '10px ' + MONO;
  c.textAlign = 'left';
  c.fillText('grid ' + gs / 1000 + ' km', 8, H - 8);
  for (const t of EL.tun) {
    c.strokeStyle = 'rgba(139,156,166,.5)';
    c.lineWidth = 9;
    c.beginPath();
    for (let s = t[0]; s <= t[1]; s += 20) {
      const [x, y] = P(...xyOf(EL, s));
      s === t[0] ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
  }
  c.lineWidth = 3;
  for (let k = 0; k < EL.N - 1; k++) {
    const r = 1 / Math.max(1e-9, Math.abs(EL.K[k]));
    c.strokeStyle = r < 400 ? COL.orange : COL.fg;
    const [ax, ay] = P(EL.X[k], EL.Y[k]),
      [bx, by] = P(EL.X[k + 1], EL.Y[k + 1]);
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(bx, by);
    c.stroke();
  }
  for (const sg of EL.sig) {
    const [x, y] = P(...xyOf(EL, sg.s));
    c.fillStyle = '#3d78d8';
    c.fillRect(x - 2.5, y - 2.5, 5, 5);
  }
  for (let k = 0; k * 1000 < EL.len; k++) {
    if (k % (EL.len > 20000 ? 5 : 2)) continue;
    const [x, y] = P(...xyOf(EL, k * 1000));
    c.fillStyle = COL.muted;
    c.font = '10px ' + MONO;
    c.textAlign = 'left';
    c.fillText('km ' + k, x + 6, y + 14);
  }
  EL.st.forEach(st => {
    const [x, y] = P(...xyOf(EL, st.s));
    c.fillStyle = COL.accent;
    c.beginPath();
    c.arc(x, y, 6, 0, 7);
    c.fill();
    c.fillStyle = COL.fg;
    c.font = '600 12px ' + SANS;
    c.textAlign = 'left';
    c.fillText(st.name, x + 9, y - 8);
  });
  ED.plan.forEach((p, i) => {
    const [x, y] = P(p[0], p[1]);
    c.fillStyle = i === edSel ? COL['sig-y'] : COL.panel;
    c.strokeStyle = i === 0 ? COL['sig-g'] : i === ED.plan.length - 1 ? COL['sig-r'] : COL.muted;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, i === edSel ? 7 : 5.5, 0, 7);
    c.fill();
    c.stroke();
  });
}
function edProfPts() {
  const sorted = ED.profile.slice().sort((a, b) => a[0] - b[0]);
  const a0 = sorted.length ? sorted[0][1] : 100,
    aEnd = sorted.length ? sorted[sorted.length - 1][1] : a0;
  ED.profile = [[0, a0], ...sorted.filter(p => p[0] > 0 && p[0] < EL.len - 1), [EL.len, aEnd]];
  return ED.profile;
}
function renderProf() {
  const { c, W, H } = fit($('cvProf'));
  c.fillStyle = COL.panel2;
  c.fillRect(0, 0, W, H);
  const pl = 44,
    pr = 12,
    pt = 18,
    pb = 22;
  const pts = edProfPts();
  let amin = Math.min(...pts.map(p => p[1])) - 15,
    amax = Math.max(...pts.map(p => p[1])) + 15;
  if (edProfMap && edProfMap.lock) {
    amin = Math.min(amin, edProfMap.lock[0]);
    amax = Math.max(amax, edProfMap.lock[1]);
  }
  const X = s => pl + (s / EL.len) * (W - pl - pr),
    Y = a => pt + (1 - (a - amin) / (amax - amin)) * (H - pt - pb);
  c.font = '10px ' + MONO;
  c.fillStyle = COL.muted;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  c.strokeStyle = 'rgba(139,156,166,.14)';
  c.lineWidth = 1;
  const raw = (amax - amin) / 5,
    mg = Math.pow(10, Math.floor(Math.log10(raw))),
    st = (raw / mg > 5 ? 10 : raw / mg > 2 ? 5 : raw / mg > 1 ? 2 : 1) * mg;
  for (let a = Math.ceil(amin / st) * st; a <= amax; a += st) {
    c.beginPath();
    c.moveTo(pl, Y(a));
    c.lineTo(W - pr, Y(a));
    c.stroke();
    c.fillText(String(Math.round(a)), pl - 6, Y(a));
  }
  c.textAlign = 'center';
  c.textBaseline = 'top';
  for (let k = 0; k * 1000 <= EL.len; k += EL.len > 20000 || W < 620 ? 5 : 1)
    c.fillText(String(k), X(k * 1000), H - pb + 5);
  c.textBaseline = 'alphabetic';
  for (const t of EL.tun) {
    c.fillStyle = 'rgba(139,156,166,.14)';
    c.fillRect(X(t[0]), pt, X(t[1]) - X(t[0]), H - pt - pb);
  }
  for (const s of EL.st) {
    c.strokeStyle = COL.accent;
    c.setLineDash([3, 3]);
    c.beginPath();
    c.moveTo(X(s.s), pt);
    c.lineTo(X(s.s), H - pb);
    c.stroke();
    c.setLineDash([]);
  }
  c.beginPath();
  c.moveTo(X(0), H - pb);
  pts.forEach(p => c.lineTo(X(p[0]), Y(p[1])));
  c.lineTo(X(EL.len), H - pb);
  c.closePath();
  c.fillStyle = 'rgba(127,208,230,.1)';
  c.fill();
  c.strokeStyle = COL.fg;
  c.lineWidth = 2;
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
  c.stroke();
  c.font = '600 11px ' + MONO;
  c.textAlign = 'center';
  for (let i = 0; i < pts.length - 1; i++) {
    const g = ((pts[i + 1][1] - pts[i][1]) / Math.max(1, pts[i + 1][0] - pts[i][0])) * 1000;
    const xm = (X(pts[i][0]) + X(pts[i + 1][0])) / 2;
    if (X(pts[i + 1][0]) - X(pts[i][0]) < 34) continue;
    c.fillStyle = Math.abs(g) > 35 ? COL['sig-r'] : Math.abs(g) > 25 ? COL.orange : COL.muted;
    c.fillText(
      (g >= 0 ? '+' : '−') + num(Math.abs(g), 1) + ' ‰',
      xm,
      Math.max(pt + 2, Math.min(Y(pts[i][1]), Y(pts[i + 1][1])) - 8),
    );
  }
  pts.forEach((p, i) => {
    c.fillStyle = i === edPSel ? COL['sig-y'] : COL.panel;
    c.strokeStyle = COL.fg;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(X(p[0]), Y(p[1]), i === edPSel ? 6.5 : 5, 0, 7);
    c.fill();
    c.stroke();
  });
  edProfMap = { X, Y, amin, amax, pl, pr, pt, pb, W, H, lock: edProfMap && edProfMap.lock };
}
function edRender() {
  if (!EL) return;
  renderPlan();
  renderProf();
  edStats();
  const p = ED.profile[edPSel];
  $('pvKm').value = p ? (p[0] / 1000).toFixed(3) : '';
  $('pvAlt').value = p ? p[1].toFixed(1) : '';
  $('pvKm').disabled = !p || edPSel === 0 || edPSel === ED.profile.length - 1;
  $('pvAlt').disabled = !p;
}
function cvPos(cv, e) {
  const r = cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
(function () {
  const cv = $('cvPlan');
  let lastTap = 0;
  cv.addEventListener('pointerdown', e => {
    if (!EL || !edView) return;
    const [mx, my] = cvPos(cv, e),
      v = edView,
      P = (x, y) => [v.ox + x * v.sc, v.oy - y * v.sc],
      U = (px, py) => [(px - v.ox) / v.sc, (v.oy - py) / v.sc];
    let hit = -1,
      best = 14;
    ED.plan.forEach((p, i) => {
      const [x, y] = P(p[0], p[1]);
      const d = Math.hypot(x - mx, y - my);
      if (d < best) {
        best = d;
        hit = i;
      }
    });
    const now = performance.now();
    if (hit >= 0) {
      if (now - lastTap < 350 && edSel === hit && ED.plan.length > 2) {
        ED.plan.splice(hit, 1);
        edSel = -1;
        edChanged(false);
        return;
      }
      lastTap = now;
      edSel = hit;
      edDrag = { i: hit };
      cv.setPointerCapture(e.pointerId);
      edRender();
      return;
    }
    const w = U(mx, my);
    let seg = -1,
      bd = 12;
    for (let i = 0; i < ED.plan.length - 1; i++) {
      const [ax, ay] = P(ED.plan[i][0], ED.plan[i][1]),
        [bx, by] = P(ED.plan[i + 1][0], ED.plan[i + 1][1]);
      const t = clamp(
        ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / Math.max(1, (bx - ax) ** 2 + (by - ay) ** 2),
        0,
        1,
      );
      const d = Math.hypot(ax + (bx - ax) * t - mx, ay + (by - ay) * t - my);
      if (d < bd) {
        bd = d;
        seg = i;
      }
    }
    if (seg >= 0) {
      ED.plan.splice(seg + 1, 0, w);
      edSel = seg + 1;
    } else {
      ED.plan.push(w);
      edSel = ED.plan.length - 1;
    }
    edDrag = { i: edSel };
    cv.setPointerCapture(e.pointerId);
    edChanged(false);
  });
  cv.addEventListener('pointermove', e => {
    if (!edDrag) return;
    const [mx, my] = cvPos(cv, e),
      v = edView;
    ED.plan[edDrag.i] = [(mx - v.ox) / v.sc, (v.oy - my) / v.sc];
    edChanged(false);
  });
  const up = () => {
    if (edDrag) {
      edDrag = null;
      edTables();
      edRender();
    }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
})();
(function () {
  const cv = $('cvProf');
  let drag = null,
    lastTap = 0;
  cv.addEventListener('pointerdown', e => {
    if (!edProfMap) return;
    const [mx, my] = cvPos(cv, e),
      m = edProfMap,
      pts = ED.profile;
    let hit = -1,
      best = 14;
    pts.forEach((p, i) => {
      const d = Math.hypot(m.X(p[0]) - mx, m.Y(p[1]) - my);
      if (d < best) {
        best = d;
        hit = i;
      }
    });
    const now = performance.now();
    m.lock = [m.amin, m.amax];
    if (hit >= 0) {
      if (now - lastTap < 350 && edPSel === hit && hit > 0 && hit < pts.length - 1) {
        pts.splice(hit, 1);
        edPSel = -1;
        m.lock = null;
        edChanged(false);
        return;
      }
      lastTap = now;
      edPSel = hit;
      drag = { i: hit };
      cv.setPointerCapture(e.pointerId);
      edRender();
      return;
    }
    const s = clamp(((mx - m.pl) / (m.W - m.pl - m.pr)) * EL.len, 1, EL.len - 1),
      a = m.amin + (1 - (my - m.pt) / (m.H - m.pt - m.pb)) * (m.amax - m.amin);
    pts.push([s, Math.round(a * 2) / 2]);
    pts.sort((x, y) => x[0] - y[0]);
    edPSel = pts.findIndex(p => p[0] === s);
    drag = { i: edPSel };
    cv.setPointerCapture(e.pointerId);
    edChanged(false);
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const [mx, my] = cvPos(cv, e),
      m = edProfMap,
      pts = ED.profile,
      i = drag.i;
    const a = m.amin + (1 - (my - m.pt) / (m.H - m.pt - m.pb)) * (m.amax - m.amin);
    let s = pts[i][0];
    if (i > 0 && i < pts.length - 1)
      s = clamp(((mx - m.pl) / (m.W - m.pl - m.pr)) * EL.len, pts[i - 1][0] + 20, pts[i + 1][0] - 20);
    pts[i] = [s, Math.round(a * 2) / 2];
    edChanged(false);
  });
  const up = () => {
    drag = null;
    if (edProfMap) edProfMap.lock = null;
    edRender();
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
})();
$('pvKm').onchange = () => {
  const p = ED.profile[edPSel];
  if (!p || edPSel === 0 || edPSel === ED.profile.length - 1) return;
  p[0] = clamp(+$('pvKm').value * 1000, ED.profile[edPSel - 1][0] + 20, ED.profile[edPSel + 1][0] - 20);
  edChanged(false);
};
$('pvAlt').onchange = () => {
  const p = ED.profile[edPSel];
  if (!p) return;
  p[1] = +$('pvAlt').value;
  edChanged(false);
};
$('pvDel').onclick = () => {
  if (edPSel > 0 && edPSel < ED.profile.length - 1) {
    ED.profile.splice(edPSel, 1);
    edPSel = -1;
    edChanged(false);
  }
};
$('pvFlat').onclick = () => {
  const a = ED.profile[0] ? ED.profile[0][1] : 100;
  ED.profile = [
    [0, a],
    [EL.len, a],
  ];
  edPSel = -1;
  edChanged(false);
};
$('plDel').onclick = () => {
  if (edSel >= 0 && ED.plan.length > 2) {
    ED.plan.splice(edSel, 1);
    edSel = -1;
    edChanged(false);
  }
};
$('plRev').onclick = () => {
  ED.plan.reverse();
  edChanged(false);
};
$('plFit').onclick = () => {
  edView = null;
  edRender();
};
$('plNew').onclick = () => {
  ED = {
    name: 'New line',
    plan: [
      [0, 0],
      [5000, 0],
      [10000, 0],
    ],
    profile: [
      [0, 100],
      [10000, 100],
    ],
    stations: [
      { name: 'Station A', s: 200, arr: null, dep: 0 },
      { name: 'Station B', s: 9700, arr: 420, dep: null },
    ],
    limits: [[0, 1e9, 120]],
    tunnels: [],
    block: 1300,
    freight: { on: false, s0: 0, vmax: 60, stopAt: 0, wait: 0, len: 400 },
  };
  edSel = -1;
  edPSel = -1;
  edRebuild(true);
  edMark(true);
};
function edTables() {
  $('tbSt').innerHTML =
    '<tr><th>Name</th><th>km</th><th>Arrival</th><th>Departure</th><th></th></tr>' +
    ED.stations
      .map(
        (s, i) =>
          '<tr><td><input type="text" id="st' +
          i +
          'n" value="' +
          esc(s.name) +
          '" aria-label="Station name"></td><td><input type="number" id="st' +
          i +
          's" step="0.01" value="' +
          (s.s / 1000).toFixed(3) +
          '" aria-label="Chainage km"></td>' +
          '<td><input type="text" id="st' +
          i +
          'a" placeholder="mm:ss" value="' +
          mmss(s.arr) +
          '" aria-label="Arrival"></td><td><input type="text" id="st' +
          i +
          'd" placeholder="mm:ss" value="' +
          mmss(s.dep) +
          '" aria-label="Departure"></td>' +
          '<td><button class="x" data-del="st" data-i="' +
          i +
          '" aria-label="Delete station">×</button></td></tr>',
      )
      .join('');
  $('tbLim').innerHTML =
    '<tr><th>From km</th><th>To km</th><th>km/h</th><th></th></tr>' +
    ED.limits
      .map(
        (l, i) =>
          '<tr><td><input type="number" id="lm' +
          i +
          'a" step="0.1" value="' +
          (l[0] / 1000).toFixed(2) +
          '" aria-label="Da km"></td><td><input type="number" id="lm' +
          i +
          'b" step="0.1" value="' +
          (l[1] >= 1e8 ? '' : (l[1] / 1000).toFixed(2)) +
          '" placeholder="end" aria-label="To km"></td>' +
          '<td><input type="number" id="lm' +
          i +
          'v" step="5" value="' +
          l[2] +
          '" aria-label="Speed"></td><td><button class="x" data-del="lm" data-i="' +
          i +
          '" aria-label="Delete limit">×</button></td></tr>',
      )
      .join('');
  $('tbTun').innerHTML = (ED.tunnels || []).length
    ? '<tr><th>From km</th><th>To km</th><th></th></tr>' +
      ED.tunnels
        .map(
          (t, i) =>
            '<tr><td><input type="number" id="tn' +
            i +
            'a" step="0.1" value="' +
            (t[0] / 1000).toFixed(2) +
            '" aria-label="Da km"></td><td><input type="number" id="tn' +
            i +
            'b" step="0.1" value="' +
            (t[1] / 1000).toFixed(2) +
            '" aria-label="A km"></td><td><button class="x" data-del="tn" data-i="' +
            i +
            '" aria-label="Delete tunnel">×</button></td></tr>',
        )
        .join('')
    : '<tr><td style="color:var(--muted)">No tunnel</td></tr>';
}
function edReadTables() {
  ED.stations = ED.stations.map((s, i) =>
    $('st' + i + 'n')
      ? {
          name: $('st' + i + 'n').value || 'Station ' + (i + 1),
          s: (+$('st' + i + 's').value || 0) * 1000,
          arr: parseMmss($('st' + i + 'a').value),
          dep: parseMmss($('st' + i + 'd').value),
        }
      : s,
  );
  ED.limits = ED.limits.map((l, i) =>
    $('lm' + i + 'a')
      ? [
          (+$('lm' + i + 'a').value || 0) * 1000,
          $('lm' + i + 'b').value === '' ? 1e9 : +$('lm' + i + 'b').value * 1000,
          clamp(+$('lm' + i + 'v').value || 30, 5, 400),
        ]
      : l,
  );
  ED.tunnels = (ED.tunnels || []).map((t, i) =>
    $('tn' + i + 'a') ? [(+$('tn' + i + 'a').value || 0) * 1000, (+$('tn' + i + 'b').value || 0) * 1000] : t,
  );
}
['tbSt', 'tbLim', 'tbTun'].forEach(id => {
  $(id).addEventListener('change', () => {
    edReadTables();
    edChanged(false);
  });
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button[data-del]');
    if (!b) return;
    edReadTables();
    const i = +b.dataset.i;
    if (b.dataset.del === 'st') ED.stations.splice(i, 1);
    if (b.dataset.del === 'lm') ED.limits.splice(i, 1);
    if (b.dataset.del === 'tn') ED.tunnels.splice(i, 1);
    edTables();
    edChanged(false);
  });
});
$('addSt').onclick = () => {
  edReadTables();
  const last = ED.stations[ED.stations.length - 1];
  const s = Math.min(EL.len - 100, (last ? last.s : 0) + 3000);
  ED.stations.push({ name: 'New station', s, arr: last && last.dep != null ? last.dep + 180 : null, dep: null });
  ED.stations.sort((a, b) => a.s - b.s);
  edTables();
  edChanged(false);
};
$('addLim').onclick = () => {
  edReadTables();
  const m = Math.round(EL.len / 2000) * 1000;
  ED.limits.push([m, m + 1000, 60]);
  edTables();
  edChanged(false);
};
$('addTun').onclick = () => {
  edReadTables();
  ED.tunnels = ED.tunnels || [];
  const m = Math.round(EL.len / 2000) * 1000;
  ED.tunnels.push([m, m + 800]);
  edTables();
  edChanged(false);
};
$('lnBlock').onchange = () => {
  ED.block = clamp(+$('lnBlock').value || 1300, 400, 5000);
  edChanged(false);
};
$('lnName').onchange = () => {
  ED.name = $('lnName').value.trim() || 'Unnamed line';
  edMark(true);
};
['frOn', 'frS0', 'frV', 'frL', 'frStop', 'frWait'].forEach(id =>
  $(id).addEventListener('change', () => {
    ED.freight = {
      on: $('frOn').value === '1',
      s0: (+$('frS0').value || 0) * 1000,
      vmax: clamp(+$('frV').value || 60, 10, 200),
      len: clamp(+$('frL').value || 400, 20, 1500),
      stopAt: (+$('frStop').value || 0) * 1000,
      wait: Math.max(0, +$('frWait').value || 0),
    };
    edMark(true);
  }),
);
$('lnPreset').onchange = () => {
  const v = $('lnPreset').value;
  if (!v) ED = clone(cfg.line);
  else if (v.startsWith('p:')) ED = clone(LINE_PRESETS[v.slice(2)]);
  else ED = clone(libLines()[v.slice(2)]);
  edSel = -1;
  edPSel = -1;
  edRebuild(true);
  edMark(!!v);
};
$('lnSave').onclick = () => {
  edReadTables();
  const lib = libLines();
  lib[ED.name] = clone(ED);
  store.set('bgf-lines', lib);
  edFillPresets();
  $('lnMsg').textContent = 'Line «' + ED.name + '» saved in the library of this browser.';
};
$('lnDelete').onclick = () => {
  const lib = libLines();
  if (lib[ED.name]) {
    delete lib[ED.name];
    store.set('bgf-lines', lib);
    edFillPresets();
    $('lnMsg').textContent = 'Line «' + ED.name + '» deleted from the library.';
  } else $('lnMsg').textContent = 'This line is not in the library.';
};
$('lnApply').onclick = () => {
  edReadTables();
  cfg.line = clone(ED);
  saveCfg();
  ctlStop('');
  resetRun();
  updateBrief();
  $('summary').hidden = true;
  $('brief').hidden = false;
  edMark(false);
  $('lnMsg').textContent = 'Line applied: you find it in the Drive tab.';
};
$('lnExport').onclick = () => {
  edReadTables();
  const t = JSON.stringify(ED);
  $('lnJson').value = t;
  copyText(t, 'Line data', 'lnMsg');
};
$('lnImport').onclick = () => {
  try {
    const d = toEnglish<any>(JSON.parse($('lnJson').value));
    if (!Array.isArray(d.plan) || d.plan.length < 2 || !Array.isArray(d.stations))
      throw new Error('at least plan and stations are needed');
    d.profile = d.profile || [[0, 100]];
    d.limits = d.limits || [[0, 1e9, 100]];
    d.tunnels = d.tunnels || [];
    d.block = d.block || 1300;
    d.freight = d.freight || { on: false };
    d.name = d.name || 'Imported line';
    ED = fitPlan(d);
    edSel = -1;
    edPSel = -1;
    edRebuild(true);
    edMark(true);
    $('lnMsg').textContent = 'Line imported. Press Apply and restart to drive it.';
  } catch (e) {
    $('lnMsg').textContent = 'Invalid JSON: ' + e.message;
  }
};

let TE = null;
/** Forgets the pending changes in the editors (after a scenario changed line or train) */
export function editorsReset() {
  ED = null;
  TE = null;
}
/** Opens the train editor on the train in use */
export function trOpen() {
  if (!TE) {
    TE = clone(cfg.train);
    syncFromConsist();
    $('trPreset').innerHTML =
      '<option value="">— train in use —</option>' +
      Object.entries(TRAIN_PRESETS)
        .map(([k, v]) => '<option value="' + k + '">' + esc(v.name) + '</option>')
        .join('');
    trForm();
    vehTable();
  }
  renderTr();
}
const DERIVED = ['m', 'L', 'adh'];
/** True if the train has a consist: multi-mass and external model, which receives it at the start of the run */
const multi = () => (TE.model ?? 'multimass') !== 'point';
function syncFromConsist() {
  if (!multi()) return;
  if (!TE.consist || !TE.consist.length) TE.consist = buildConsist(TE);
  const s = consistSummary(TE.consist);
  TE.m = s.m;
  TE.L = s.L;
  TE.adh = +s.adh.toFixed(4);
}
function vehTable() {
  const cp = TE.coupler ?? DEFAULT_COUPLER;
  $('trModel').value = TE.model ?? 'multimass';
  const ext = TE.model === 'external';
  ['dynUrlL', 'dynPerL', 'dynHint'].forEach(id => {
    $(id).hidden = !ext;
  });
  $('dynUrl').value = TE.external?.address ?? 'ws://localhost:8766';
  $('dynPer').value = TE.external?.period_s ?? 0.05;
  $('cpK').value = +(cp.k / 1e6).toFixed(3);
  $('cpC').value = +(cp.c / 1e3).toFixed(1);
  $('cpG').value = +(cp.slack * 1000).toFixed(1);
  $('trEP').value = TE.epBrake === false ? '0' : '1';
  $('trVP').value = TE.vProp ?? 280;
  $('trKG').value = TE.kTunnel ?? 1.6;
  const dis = !multi();
  ['cpK', 'cpC', 'cpG', 'trEP', 'trVP', 'trKG', 'vehAdd', 'vehDup'].forEach(id => {
    $(id).disabled = dis;
  });
  const list = TE.consist && TE.consist.length ? TE.consist : buildConsist(TE);
  $('tbVeh').innerHTML =
    '<tr><th>#</th><th>Vehicle</th><th>Mass (t)</th><th>Length (m)</th><th>Motored</th><th></th></tr>' +
    list
      .map(
        (v, i) =>
          '<tr><td class="n">' +
          (i + 1) +
          '</td><td><input type="text" id="vn' +
          i +
          '" value="' +
          esc(v.name || '') +
          '" aria-label="Vehicle name"' +
          (dis ? ' disabled' : '') +
          '></td>' +
          '<td><input type="number" id="vm' +
          i +
          '" step="0.5" value="' +
          +(v.m / 1000).toFixed(2) +
          '" aria-label="Mass"' +
          (dis ? ' disabled' : '') +
          '></td>' +
          '<td><input type="number" id="vl' +
          i +
          '" step="0.5" value="' +
          +v.L.toFixed(3) +
          '" aria-label="Length"' +
          (dis ? ' disabled' : '') +
          '></td>' +
          '<td><input type="checkbox" id="vx' +
          i +
          '"' +
          (v.motored ? ' checked' : '') +
          ' aria-label="Motored vehicle"' +
          (dis ? ' disabled' : '') +
          '></td>' +
          '<td>' +
          (list.length > 1 && !dis
            ? '<button class="x" data-del="' + i + '" aria-label="Delete vehicle">×</button>'
            : '') +
          '</td></tr>',
      )
      .join('');
  const s = consistSummary(list),
    f = Math.sqrt((cp.k * 2) / (s.m / Math.max(1, s.n))) / (2 * Math.PI);
  $('vehStats').innerHTML =
    '<span>Vehicles <b>' +
    s.n +
    '</b></span><span>Mass <b>' +
    num(s.m / 1000, 1) +
    ' t</b></span><span>Length <b>' +
    num(s.L, 1) +
    ' m</b></span>' +
    '<span>Motored share <b>' +
    num(s.adh * 100, 1) +
    '%</b></span><span>Natural frequency between two vehicles <b>' +
    num(f, 2) +
    ' Hz</b></span>' +
    (TE.epBrake === false
      ? '<span>Brake delay at the tail <b>' + num(s.L / (TE.vProp ?? 280), 2) + ' s</b></span>'
      : '');
  $('vehHint').hidden = false;
}
function readVeh() {
  if (!multi()) return;
  const list = TE.consist && TE.consist.length ? TE.consist : buildConsist(TE);
  TE.consist = list.map((v, i) => ({
    name: $('vn' + i).value,
    m: Math.max(1, (+$('vm' + i).value || 0) * 1000),
    L: Math.max(0.1, +$('vl' + i).value || 0),
    motored: $('vx' + i).checked,
  }));
  if (!TE.consist.some(v => v.motored)) TE.consist[0].motored = true;
  TE.coupler = {
    k: Math.max(1, (+$('cpK').value || 0) * 1e6),
    c: Math.max(0, (+$('cpC').value || 0) * 1e3),
    slack: Math.max(0, (+$('cpG').value || 0) / 1000),
  };
  TE.epBrake = $('trEP').value === '1';
  TE.vProp = Math.max(50, +$('trVP').value || 280);
  TE.kTunnel = Math.max(1, +$('trKG').value || 1.6);
}
function trChanged() {
  syncFromConsist();
  trForm();
  vehTable();
  $('trDirty').textContent = 'changes not applied';
  $('trDirty').className = 'pill on';
  renderTr();
}
['cpK', 'cpC', 'cpG', 'trEP', 'trVP', 'trKG'].forEach(id =>
  $(id).addEventListener('change', () => {
    readVeh();
    trChanged();
  }),
);
$('tbVeh').addEventListener('change', () => {
  readVeh();
  trChanged();
});
$('tbVeh').addEventListener('click', e => {
  const b = (e.target as any).closest('button[data-del]');
  if (!b) return;
  readVeh();
  TE.consist.splice(+b.dataset.del, 1);
  trChanged();
});
$('vehAdd').onclick = () => {
  readVeh();
  TE.consist.push({ name: 'Vehicle ' + (TE.consist.length + 1), m: 40000, L: 25, motored: false });
  trChanged();
};
$('vehDup').onclick = () => {
  readVeh();
  const l = TE.consist[TE.consist.length - 1];
  TE.consist.push({ ...l });
  trChanged();
};
$('trModel').onchange = () => {
  readVeh();
  TE.model = $('trModel').value;
  trChanged();
};
['dynUrl', 'dynPer'].forEach(id =>
  $(id).addEventListener('change', () => {
    TE.external = {
      ...TE.external,
      address: $('dynUrl').value.trim(),
      period_s: Math.max(0.005, +$('dynPer').value || 0.05),
    };
    trChanged();
  }),
);
function trForm() {
  $('trName').value = TE.name;
  $('trForm').innerHTML = TR_FIELDS.map(
    ([k, l, f, st]) =>
      '<label class="f">' +
      l +
      '<input type="number" id="tf_' +
      k +
      '" step="' +
      st +
      '" value="' +
      +(TE[k] * f).toFixed(4) +
      '"' +
      (multi() && DERIVED.includes(k) ? ' disabled title="Derived from the consist"' : '') +
      '></label>',
  ).join('');
}
$('trForm').addEventListener('input', () => {
  TR_FIELDS.forEach(([k, , f]) => {
    if (multi() && DERIVED.includes(k)) return;
    const v = +$('tf_' + k).value;
    if (isFinite(v) && v > 0) TE[k] = v / f;
  });
  $('trDirty').textContent = 'changes not applied';
  $('trDirty').className = 'pill on';
  renderTr();
});
$('trName').onchange = () => {
  TE.name = $('trName').value.trim() || 'Train';
};
$('trPreset').onchange = () => {
  const v = $('trPreset').value;
  TE = clone(v ? TRAIN_PRESETS[v] : cfg.train);
  syncFromConsist();
  trForm();
  vehTable();
  renderTr();
  $('trDirty').textContent = v ? 'changes not applied' : 'applied';
  $('trDirty').className = 'pill' + (v ? ' on' : '');
};
$('trApply').onclick = () => {
  cfg.train = clone(TE);
  saveCfg();
  ctlStop('');
  resetRun();
  updateBrief();
  $('summary').hidden = true;
  $('brief').hidden = false;
  $('trDirty').textContent = 'applied';
  $('trDirty').className = 'pill';
};
/** Redraws the traction diagram and the derived quantities of the train being edited */
export function renderTr() {
  const { c, W, H } = fit($('cvTr'));
  c.clearRect(0, 0, W, H);
  const T = TE,
    vmax = T.vmax * 1.15,
    pl = 44,
    pr = 10,
    pt = 10,
    pb = 24,
    iup = L.iup || 0;
  const Ft = v => Math.min(T.Fmax, T.Pw / Math.max(v, 1)),
    Ra = v => T.A + T.B * v + T.C * v * v,
    Rg = v => Ra(v) + (T.m * G * iup) / 1000,
    Ad = T.adh * T.m * G * app.sim.mu;
  const fmax = Math.max(T.Fmax, Ad, Rg(vmax)) * 1.1;
  const X = v => pl + (v / vmax) * (W - pl - pr),
    Y = f => pt + (1 - f / fmax) * (H - pt - pb);
  c.font = '10px ' + MONO;
  c.fillStyle = COL.muted;
  c.strokeStyle = COL.line;
  c.lineWidth = 1;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  const raw = fmax / 1000 / 4,
    mag = Math.pow(10, Math.floor(Math.log10(raw))),
    fs = (raw / mag > 5 ? 10 : raw / mag > 2 ? 5 : raw / mag > 1 ? 2 : 1) * mag * 1000;
  for (let f = 0; f <= fmax; f += fs) {
    c.beginPath();
    c.moveTo(pl, Y(f));
    c.lineTo(W - pr, Y(f));
    c.stroke();
    c.fillText(String(Math.round(f / 1000)), pl - 6, Y(f));
  }
  c.textAlign = 'center';
  c.textBaseline = 'top';
  const vs = vmax * 3.6 > 250 ? 50 : 20;
  for (let v = 0; v <= vmax * 3.6; v += vs) c.fillText(String(v), X(v / 3.6), H - pb + 6);
  c.textBaseline = 'alphabetic';
  const line = (fn, col, w, dash?) => {
    c.strokeStyle = col;
    c.lineWidth = w;
    c.setLineDash(dash || []);
    c.beginPath();
    for (let v = 0; v <= vmax; v += vmax / 200) {
      const y = Y(fn(v));
      v ? c.lineTo(X(v), y) : c.moveTo(X(v), y);
    }
    c.stroke();
    c.setLineDash([]);
  };
  line(() => Ad, COL['sig-y'], 1.5, [5, 4]);
  line(Ra, COL.muted, 1.5);
  if (iup > 0) line(Rg, COL.orange, 1.5);
  line(Ft, COL.accent, 2.5);
  c.strokeStyle = COL.line;
  c.beginPath();
  c.moveTo(X(T.vmax), pt);
  c.lineTo(X(T.vmax), H - pb);
  c.stroke();
  c.fillStyle = COL.muted;
  c.textAlign = 'left';
  c.fillText('kN', pl + 4, pt + 10);
  c.textAlign = 'right';
  c.fillText('km/h', W - pr, H - pb - 6);
  const bal = fn => {
    let v = 0;
    for (; v < T.vmax * 1.5; v += 0.1) if (Math.min(Ft(v), Ad) < fn(v)) break;
    return v;
  };
  const vb = bal(Ra),
    vg = bal(Rg),
    me = T.m * T.rot,
    bs = (v, a) => (v * v) / (2 * a);
  $('trStats').innerHTML =
    '<span>Specific power <b>' +
    num(T.Pw / T.m, 1) +
    ' W/kg</b></span><span>Balancing speed on level track <b>' +
    (vb >= T.vmax * 1.49 ? 'over ' + Math.round(T.vmax * 3.6 * 1.5) : Math.round(vb * 3.6)) +
    ' km/h</b></span>' +
    (iup > 0
      ? '<span class="' +
        (vg < 5 ? 'bad' : '') +
        '">On ' +
        num(iup, 1) +
        ' ‰ (' +
        esc(L.def.name) +
        ') <b>' +
        (vg < 0.5 ? 'cannot start' : Math.round(Math.min(vg, T.vmax * 1.5) * 3.6) + ' km/h') +
        '</b></span>'
      : '') +
    '<span>Starting acceleration <b>' +
    num((Math.min(T.Fmax, Ad) - T.A) / me, 2) +
    ' m/s²</b></span><span>Stop from vmax <b>' +
    Math.round(bs(T.vmax, T.bSvc)) +
    ' m</b> service, <b>' +
    Math.round(bs(T.vmax, T.bEm)) +
    ' m</b> emergency</span>';
}
