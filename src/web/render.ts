// Canvas rendering: cab view, DMI, line diagram, distance-speed chart.
import { altOf, clamp, gradeOf, idxOf, tunnelOf } from '../core';
import { $, ASPCOL, COL, F, L, LAMP, MONO, REDUCED, S, SANS, TR, app, fit, hash, mix, rgb } from './state';

const PAL = {
  day: {
    sky0: [78, 128, 170],
    sky1: [198, 214, 222],
    hill1: [148, 166, 170],
    hill2: [106, 136, 102],
    g0: [136, 152, 110],
    g1: [84, 104, 58],
    light: 1,
    haze: [214, 224, 228],
    cloud: [255, 255, 255],
  },
  dusk: {
    sky0: [52, 62, 110],
    sky1: [236, 150, 96],
    hill1: [118, 96, 108],
    hill2: [78, 78, 70],
    g0: [120, 108, 80],
    g1: [62, 64, 42],
    light: 0.72,
    haze: [232, 170, 128],
    cloud: [255, 196, 160],
  },
  night: {
    sky0: [6, 10, 24],
    sky1: [24, 34, 58],
    hill1: [22, 28, 40],
    hill2: [14, 20, 22],
    g0: [26, 32, 26],
    g1: [12, 16, 12],
    light: 0.16,
    haze: [30, 40, 60],
    cloud: [60, 70, 90],
  },
};
const CLOUDS = Array.from({ length: 14 }, (_, i) => ({
  az: hash(i * 3.1) * 6.28,
  el: 0.04 + hash(i * 5.7) * 0.16,
  w: 0.08 + hash(i * 9.3) * 0.14,
  p: hash(i * 1.9),
}));
const RAIN = Array.from({ length: 160 }, (_, i) => [hash(i * 1.3), hash(i * 2.7), 0.5 + hash(i * 4.1)]);
/** Essential 2D cab view (pseudo-perspective on canvas), used when the 3D view is off or unavailable */
export function renderView() {
  const sim = app.sim;
  const { c, W, H } = fit($('cvView'));
  const sc0 = sim.scen,
    pal = PAL[sc0.tod] || PAL.day,
    night = sc0.tod === 'night';
  const VEX = 2,
    f = H * 1.15,
    camH = 2.8;
  const g0 = (S.grade || gradeOf(L, S.s)) / 1000;
  const sway = REDUCED
    ? 0
    : Math.sin(S.t * 1.7) * 0.03 * Math.min(1, S.v / 20) + Math.sin(S.t * 5.3) * 0.01 * Math.min(1, S.v / 30);
  const bob = REDUCED ? 0 : Math.sin((S.s / 36) * Math.PI * 2) * 0.015 * Math.min(1, S.v / 15);
  const hy0 = H * 0.42,
    hyH = hy0 + g0 * VEX * f;
  const fogD = sc0.met === 'fog' ? 260 : sc0.met === 'rain' ? 1100 : 2400;
  const inTun = tunnelOf(L, S.s);
  const NZ = 170,
    dz = 10,
    lat = [0],
    dy = [0];
  let th = 0;
  const a0 = altOf(L, S.s);
  for (let k = 0; k < NZ; k++) {
    th += L.K[idxOf(L, S.s + k * dz)] * dz;
    lat.push(lat[k] + th * dz);
    dy.push(VEX * (altOf(L, S.s + (k + 1) * dz) - a0 - g0 * (k + 1) * dz));
  }
  const tab = (arr, z) => {
    const q = z / dz,
      i = Math.floor(q);
    if (i >= NZ) return arr[NZ];
    const r = q - i;
    return arr[i] * (1 - r) + arr[i + 1] * r;
  };
  const proj = (z, x, y) => [W / 2 + ((tab(lat, z) + x - sway) * f) / z, hy0 + ((camH + bob - y - tab(dy, z)) * f) / z];
  let zCap = 1650,
    portal = null,
    exitZ = null;
  if (!inTun) {
    for (const t of L.tun) {
      const z = t[0] - S.s;
      if (z > 2 && z < 1650) {
        zCap = z;
        portal = { z, t };
        break;
      }
    }
  } else {
    exitZ = inTun[1] - S.s;
    zCap = Math.min(1650, exitZ);
  }
  zCap = Math.min(zCap, fogD * 1.4);
  const fogA = z => clamp(z / fogD, 0, 1),
    haze = pal.haze,
    L1 = pal.light;
  // sky
  let g = c.createLinearGradient(0, 0, 0, Math.max(1, hyH));
  g.addColorStop(0, rgb(pal.sky0));
  g.addColorStop(1, rgb(pal.sky1));
  c.fillStyle = g;
  c.fillRect(0, 0, W, Math.max(0, hyH + 2));
  const hd = L.HEAD[idxOf(L, S.s)];
  if (night) {
    c.fillStyle = 'rgba(255,255,255,.8)';
    for (let i = 0; i < 90; i++) {
      const x = (((hash(i * 7.7) * W * 3 - hd * f * 0.4) % W) + W) % W,
        y = hash(i * 3.3) * hyH * 0.9;
      c.fillRect(x, y, hash(i) * 1.6 + 0.4, hash(i) * 1.6 + 0.4);
    }
  }
  if (sc0.tod === 'dusk') {
    const sx = (((W * 0.7 - hd * f * 0.4) % (W * 2)) + W * 2) % (W * 2);
    const sg = c.createRadialGradient(sx, hyH - H * 0.05, 2, sx, hyH - H * 0.05, H * 0.35);
    sg.addColorStop(0, 'rgba(255,220,150,.95)');
    sg.addColorStop(0.12, 'rgba(255,190,120,.6)');
    sg.addColorStop(1, 'rgba(255,160,100,0)');
    c.fillStyle = sg;
    c.fillRect(0, 0, W, Math.max(0, hyH));
  }
  if (sc0.met !== 'fog') {
    for (const cl of CLOUDS) {
      const x = (((((cl.az / 6.28) * W * 3 - hd * f * 0.5 + S.t * 2 * cl.p) % (W * 3)) + W * 3) % (W * 3)) - W * 0.5,
        y = hyH - cl.el * H * 1.9,
        w = cl.w * W;
      c.fillStyle = rgb(pal.cloud, sc0.met === 'rain' ? 0.55 : night ? 0.12 : 0.75);
      for (let q = 0; q < 5; q++) {
        c.beginPath();
        c.ellipse(x + (q - 2) * w * 0.22, y + Math.sin(q * 1.7) * w * 0.04, w * 0.22, w * 0.09, 0, 0, 7);
        c.fill();
      }
    }
  }
  if (sc0.met === 'rain') {
    c.fillStyle = 'rgba(90,100,110,.35)';
    c.fillRect(0, 0, W, Math.max(0, hyH));
  }
  const hill = (off, col, amp, freq) => {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(0, hyH + 1);
    for (let x = 0; x <= W + 8; x += 8) {
      const u = ((x + off) / W) * freq;
      c.lineTo(
        x,
        hyH -
          H * amp * (1.2 + 0.6 * Math.sin(u * 2.1) + 0.35 * Math.sin(u * 5.3 + 1.3) + 0.15 * Math.sin(u * 11.7 + 0.4)),
      );
    }
    c.lineTo(W, hyH + 1);
    c.closePath();
    c.fill();
  };
  const mountain = L.iup > 15 ? 1.8 : 1;
  hill(hd * f * 0.6, rgb(mix(pal.hill1, haze, sc0.met === 'fog' ? 0.9 : 0.25)), 0.11 * mountain, 1.3);
  hill(hd * f + 300, rgb(mix(pal.hill2, haze, sc0.met === 'fog' ? 0.85 : 0.1)), 0.06 * mountain, 2.9);
  g = c.createLinearGradient(0, Math.max(0, hyH), 0, H);
  g.addColorStop(0, rgb(mix(pal.g0, haze, sc0.met === 'fog' ? 0.7 : 0.15)));
  g.addColorStop(1, rgb(pal.g1));
  c.fillStyle = g;
  c.fillRect(0, hyH, W, H - hyH);
  if (inTun) {
    c.fillStyle = '#060707';
    c.fillRect(0, 0, W, H);
  }
  const zl = [];
  for (let z = zCap; z > 2; z *= 0.94) zl.push(z);
  zl.push(2);
  const poly = (pts, col) => {
    if (!pts.length) return;
    c.fillStyle = col;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.closePath();
    c.fill();
  };
  const strip = (x0, x1, y, col, zs) => {
    const a = zs.map(z => proj(z, x0, y)),
      b = zs.map(z => proj(z, x1, y)).reverse();
    poly(a.concat(b), col);
  };
  const wall = (x, y0, y1, col, zs) => {
    const a = zs.map(z => proj(z, x, y0)),
      b = zs.map(z => proj(z, x, y1)).reverse();
    poly(a.concat(b), col);
  };
  const shade = (rgbA, z, extra?) =>
    rgb(
      mix(
        mix(rgbA, [0, 0, 0], 1 - L1 * (extra || 1)),
        inTun ? [6, 7, 7] : haze,
        inTun ? clamp(z / 400, 0, 1) : fogA(z),
      ),
    );
  if (inTun) {
    wall(-4.2, 0, 6.2, '#141518', zl);
    wall(4.2, 0, 6.2, '#141518', zl);
    strip(-4.2, 4.2, 6.2, '#0c0d0f', zl);
    for (let q = 0; q < zl.length - 1; q++) {
      const z1 = zl[q],
        z2 = zl[q + 1] * 0.985,
        k = clamp(1 - z2 / 220, 0, 1);
      if (k <= 0) continue;
      const wc = rgb([20 + k * 26, 21 + k * 26, 24 + k * 26]),
        cc = rgb([12 + k * 14, 13 + k * 14, 15 + k * 14]);
      wall(-4.2, 0, 6.2, wc, [z1, z2]);
      wall(4.2, 0, 6.2, wc, [z1, z2]);
      strip(-4.2, 4.2, 6.2, cc, [z1, z2]);
    }
    if (exitZ < 1650) {
      const [x0, y0] = proj(exitZ, -4, 6.5),
        [x1, y1] = proj(exitZ, 4, 0);
      const eg = c.createLinearGradient(0, y0, 0, y1);
      eg.addColorStop(0, rgb(pal.sky1));
      eg.addColorStop(1, rgb(pal.g0));
      c.fillStyle = eg;
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  } else {
    const FL = [
        [150, 160, 98],
        [172, 154, 96],
        [118, 140, 80],
        [186, 176, 116],
        [136, 150, 92],
      ],
      SLT = 160;
    for (let k = Math.floor(S.s / SLT); k * SLT < S.s + zCap; k++) {
      const za = Math.max(2, k * SLT - S.s),
        zb = Math.min(zCap, (k + 1) * SLT - S.s);
      if (zb <= za) continue;
      const zs = [];
      for (let z = zb; z > za; z *= 0.9) zs.push(z);
      zs.push(za);
      for (const side of [-1, 1]) {
        const col = FL[Math.floor(hash(k * 5.3 + side * 2.1) * FL.length)];
        strip(side * 7, side * (60 + hash(k + side) * 240), 0, shade(col, za), zs);
      }
    }
    strip(-7, 7, 0, shade([118, 128, 92], 60), zl);
  }
  strip(-2.4, 2.4, 0, shade([142, 134, 124], 40, inTun ? 0.4 : 1), zl);
  c.fillStyle = shade([92, 76, 62], 10, inTun ? 0.4 : 1);
  for (let k = Math.ceil((S.s + 2) / 0.6); k * 0.6 < S.s + Math.min(75, zCap); k++) {
    const z = k * 0.6 - S.s;
    const a = proj(z, -1.3, 0.05),
      b = proj(z, 1.3, 0.05),
      d = proj(z + 0.24, 1.3, 0.05),
      e = proj(z + 0.24, -1.3, 0.05);
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.lineTo(d[0], d[1]);
    c.lineTo(e[0], e[1]);
    c.closePath();
    c.fill();
  }
  const railC = inTun ? '#7d8085' : rgb(mix([205, 208, 212], [0, 0, 0], 1 - Math.max(0.35, L1)));
  strip(-0.757, -0.677, 0.17, railC, zl);
  strip(0.677, 0.757, 0.17, railC, zl);
  for (const st of L.st) {
    const za = Math.max(2, st.s - 180 - S.s),
      zb = Math.min(zCap, st.s + 25 - S.s);
    if (zb <= 2 || za >= zb) continue;
    const zs = [];
    for (let z = zb; z > za; z *= 0.95) zs.push(z);
    zs.push(za);
    wall(-1.7, 0, 0.55, shade([138, 130, 118], za), zs);
    strip(-6.5, -1.7, 0.55, shade([186, 179, 167], za), zs);
    c.strokeStyle = '#e4c23b';
    c.lineWidth = 1.2;
    c.beginPath();
    zs.forEach((z, i) => {
      const [px, py] = proj(z, -2.15, 0.56);
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    });
    c.stroke();
    const ca = Math.max(2, st.s - 150 - S.s),
      cb = Math.min(zCap, st.s - 30 - S.s);
    if (cb > ca) {
      const cz = [];
      for (let z = cb; z > ca; z *= 0.95) cz.push(z);
      cz.push(ca);
      strip(-6.6, -2.3, 3.7, shade([70, 78, 84], ca), cz);
    }
  }
  c.strokeStyle = inTun ? '#3a3d40' : rgb(mix([40, 44, 46], haze, 0.2));
  c.lineWidth = 1;
  c.beginPath();
  zl.filter(z => z < 1100).forEach((z, i) => {
    const [px, py] = proj(z, 0, 5.6);
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  });
  c.stroke();
  const objs = [];
  const add = (z, d, gl?) => {
    if (z > 2 && z < zCap + 1) objs.push({ z, d, gl });
  };
  const inAnyTun = s => !!tunnelOf(L, s);
  if (!inTun)
    for (let ps = Math.ceil((S.s + 2) / 60) * 60; ps < S.s + Math.min(1100, zCap); ps += 60) {
      const z = ps - S.s;
      add(z, () => {
        const sc = f / z;
        const [bx, by] = proj(z, 3.3, 0),
          [tx, ty] = proj(z, 3.3, 6.5),
          [ax, ay] = proj(z, 0, 6.1);
        c.strokeStyle = shade([70, 76, 78], z);
        c.lineWidth = Math.max(1, 0.25 * sc);
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(tx, ty);
        c.stroke();
        c.lineWidth = Math.max(0.8, 0.1 * sc);
        c.beginPath();
        c.moveTo(tx, ty + 0.4 * sc);
        c.lineTo(ax, ay);
        c.stroke();
      });
    }
  if (inTun)
    for (let ps = Math.ceil((S.s + 2) / 40) * 40; ps < S.s + Math.min(600, zCap); ps += 40) {
      const z = ps - S.s;
      add(
        z,
        () => {},
        () => {
          const sc = f / z;
          const [x, y] = proj(z, -4.1, 3.2);
          c.fillStyle = 'rgba(255,214,140,.9)';
          c.beginPath();
          c.arc(x, y, Math.max(1, 0.12 * sc), 0, 7);
          c.fill();
        },
      );
    }
  for (let ps = Math.ceil((S.s + 3) / 100) * 100; ps < S.s + Math.min(320, zCap); ps += 100) {
    const z = ps - S.s;
    add(z, () => {
      const sc = f / z;
      const [bx, by] = proj(z, 2.5, 0),
        [, ty] = proj(z, 2.5, 0.9);
      c.fillStyle = shade([243, 243, 238], z);
      c.fillRect(bx - 0.07 * sc, ty, 0.14 * sc, by - ty);
      if (sc > 14) {
        c.fillStyle = '#111';
        c.font = Math.round(0.12 * sc) + 'px ' + MONO;
        c.textAlign = 'center';
        c.fillText(String(ps / 1000), bx, ty + 0.25 * sc);
      }
    });
  }
  if (!inTun) {
    const SL = 14,
      seed = L.def.name.length * 13.7;
    for (let k = Math.floor(S.s / SL); k * SL < S.s + Math.min(900, zCap); k++) {
      for (const side of [-1, 1]) {
        const r = hash(k * 2 + side * 7919 + seed),
          s = k * SL + hash(k * 3.1 + side) * 10,
          z = s - S.s;
        if (z < 4 || inAnyTun(s)) continue;
        const nearSt = L.st.some(st => Math.abs(s - st.s) < 520);
        if (nearSt && r < 0.55) {
          if (hash(k * 7.3 + side) < 0.55) continue;
          const lx = side * (13 + hash(k * 1.7 + side) * 26),
            w = 7 + hash(k * 4.4) * 6,
            h = 6 + hash(k * 8.8) * 5,
            col = [
              [214, 190, 160],
              [196, 170, 140],
              [226, 210, 186],
              [180, 150, 128],
            ][Math.floor(hash(k * 2.2) * 4)];
          add(z, () => {
            const sc = f / z;
            const [x0, y0] = proj(z, lx - w / 2, h),
              [x1, y1] = proj(z, lx + w / 2, 0);
            c.fillStyle = shade(col, z);
            c.fillRect(x0, y0, x1 - x0, y1 - y0);
            const [rx, ry] = proj(z, lx, h + 2.6);
            c.fillStyle = shade([150, 72, 52], z);
            c.beginPath();
            c.moveTo(x0 - 0.3 * sc, y0);
            c.lineTo(rx, ry);
            c.lineTo(x1 + 0.3 * sc, y0);
            c.closePath();
            c.fill();
            if (sc > 3) {
              c.fillStyle = night ? 'rgba(255,206,120,.9)' : shade([70, 84, 96], z);
              for (let fl = 0; fl < 2; fl++)
                for (let q = 0; q < 3; q++)
                  c.fillRect(
                    x0 + (x1 - x0) * (0.18 + q * 0.28),
                    y0 + (y1 - y0) * (0.2 + fl * 0.42),
                    (x1 - x0) * 0.12,
                    (y1 - y0) * 0.18,
                  );
            }
          });
          continue;
        }
        if (r > (nearSt ? 0.25 : 0.62)) continue;
        const lx = side * (6.5 + hash(k * 5.1 + side) * 34),
          ht = 5 + hash(k * 6.3 + side) * 11,
          con = hash(k * 9.9 + side) < 0.4,
          tone = hash(k * 2.9 + side);
        const col = con ? [46 + tone * 20, 86 + tone * 20, 54] : [70 + tone * 40, 110 + tone * 30, 56];
        add(z, () => {
          const sc = f / z;
          const [bx, by] = proj(z, lx, 0),
            [, ty] = proj(z, lx, ht);
          c.strokeStyle = shade([80, 62, 44], z);
          c.lineWidth = Math.max(1, 0.35 * sc);
          c.beginPath();
          c.moveTo(bx, by);
          c.lineTo(bx, by - (by - ty) * 0.35);
          c.stroke();
          c.fillStyle = shade(col, z);
          if (con) {
            c.beginPath();
            c.moveTo(bx - ht * 0.3 * sc, by - (by - ty) * 0.25);
            c.lineTo(bx, ty);
            c.lineTo(bx + ht * 0.3 * sc, by - (by - ty) * 0.25);
            c.closePath();
            c.fill();
          } else {
            const rr = ht * 0.32 * sc;
            c.beginPath();
            c.ellipse(bx, ty + rr * 0.9, rr, rr * 0.95, 0, 0, 7);
            c.fill();
            c.fillStyle = shade(
              col.map(v => Math.min(255, v + 18)),
              z,
            );
            c.beginPath();
            c.ellipse(bx - rr * 0.25, ty + rr * 0.7, rr * 0.55, rr * 0.5, 0, 0, 7);
            c.fill();
          }
        });
      }
    }
  }
  for (const st of L.st) {
    const zb = st.s - 95 - S.s;
    if (!inTun)
      add(zb, () => {
        const sc = f / zb;
        const [x0, y0] = proj(zb, -21, 7),
          [x1, y1] = proj(zb, -8, 0);
        c.fillStyle = shade([222, 196, 150], zb);
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        const [rx0, ry0] = proj(zb, -21.6, 7.8);
        c.fillStyle = shade([120, 64, 50], zb);
        c.fillRect(rx0, ry0, x1 - x0 + (x0 - rx0) * 2, y0 - ry0);
        if (sc > 2) {
          c.fillStyle = night ? 'rgba(255,210,130,.95)' : shade([60, 74, 86], zb);
          for (let fl = 0; fl < 2; fl++)
            for (let q = 0; q < 4; q++)
              c.fillRect(
                x0 + (x1 - x0) * (0.1 + q * 0.22),
                y0 + (y1 - y0) * (0.18 + fl * 0.45),
                (x1 - x0) * 0.1,
                (y1 - y0) * 0.22,
              );
        }
      });
    for (const off of [-70, -155]) {
      const z = st.s + off - S.s;
      if (z < 420)
        add(z, () => {
          const sc = f / z;
          const [l1x, b1y] = proj(z, -5.6, 0.55),
            [, t1y] = proj(z, -5.6, 2.4),
            [r1x] = proj(z, -3.4, 0.55);
          c.strokeStyle = '#3c4144';
          c.lineWidth = Math.max(1, 0.08 * sc);
          c.beginPath();
          c.moveTo(l1x, b1y);
          c.lineTo(l1x, t1y);
          c.moveTo(r1x, b1y);
          c.lineTo(r1x, t1y);
          c.stroke();
          const [bx0, by0] = proj(z, -5.8, 2.95),
            [bx1, by1] = proj(z, -3.2, 2.35);
          c.fillStyle = '#1f4f9d';
          c.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
          const fs = 0.32 * sc;
          if (fs > 5) {
            c.fillStyle = '#fff';
            c.font = '600 ' + Math.round(fs) + 'px ' + SANS;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(st.name, (bx0 + bx1) / 2, (by0 + by1) / 2, bx1 - bx0 - 4);
            c.textBaseline = 'alphabetic';
          }
        });
    }
    const z = st.s - S.s;
    if (z < 500)
      add(z, () => {
        const sc = f / z;
        const [bx, by] = proj(z, -1.95, 0.55),
          [tx, ty] = proj(z, -1.95, 2.1);
        c.strokeStyle = '#3c4144';
        c.lineWidth = Math.max(1, 0.06 * sc);
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(tx, ty);
        c.stroke();
        const w = 0.5 * sc;
        c.fillStyle = '#fafafa';
        c.fillRect(tx - w / 2, ty - w, w, w);
        c.strokeStyle = '#111';
        c.lineWidth = Math.max(1, 0.05 * sc);
        c.strokeRect(tx - w / 2, ty - w, w, w);
        c.fillStyle = '#111';
        c.fillRect(tx - w * 0.35, ty - w * 0.58, w * 0.7, w * 0.16);
      });
  }
  for (const sg of L.sig) {
    const z = sg.s - S.s;
    if (z <= 2 || z > 1900) continue;
    if (sim.scen.sig === 'BACC')
      add(
        z,
        () => {
          const sc = f / z;
          const [bx, by] = proj(z, -2.9, 0),
            [tx, ty] = proj(z, -2.9, 4.6);
          c.strokeStyle = '#3a3e40';
          c.lineWidth = Math.max(1, 0.17 * sc);
          c.beginPath();
          c.moveTo(bx, by);
          c.lineTo(tx, ty);
          c.stroke();
          const r = Math.max(1.6, 0.55 * sc);
          c.fillStyle = '#0a0a0a';
          c.beginPath();
          c.arc(tx, ty, r, 0, 7);
          c.fill();
          if (r > 3) {
            c.strokeStyle = '#ededed';
            c.lineWidth = Math.max(1, 0.09 * sc);
            c.stroke();
          }
          if (sc > 30) {
            const [px, py] = proj(z, -2.9, 3.2);
            const w = 0.42 * sc,
              h = 0.3 * sc;
            c.fillStyle = '#f4f4f0';
            c.fillRect(px - w / 2, py - h / 2, w, h);
            c.fillStyle = '#111';
            c.font = '600 ' + Math.round(0.22 * sc) + 'px ' + MONO;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(sg.id, px, py);
            c.textBaseline = 'alphabetic';
          }
        },
        () => {
          const sc = f / z;
          const [tx, ty] = proj(z, -2.9, 4.6);
          const col = LAMP[sg.asp],
            lr = Math.max(1.5, 0.17 * sc);
          c.save();
          c.shadowColor = col;
          c.shadowBlur = Math.max(6, lr * (night ? 5 : 3));
          c.fillStyle = col;
          c.beginPath();
          c.arc(tx, ty, lr, 0, 7);
          c.fill();
          c.restore();
        },
      );
    else if (z < 900)
      add(z, () => {
        const sc = f / z;
        const [bx, by] = proj(z, -2.4, 0),
          [tx, ty] = proj(z, -2.4, 2.6);
        c.strokeStyle = shade([70, 74, 78], z);
        c.lineWidth = Math.max(1, 0.09 * sc);
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(tx, ty);
        c.stroke();
        const w = 0.62 * sc;
        c.fillStyle = '#1c4fa3';
        c.fillRect(tx - w / 2, ty - w, w, w);
        c.strokeStyle = '#fff';
        c.lineWidth = Math.max(0.6, 0.03 * sc);
        c.strokeRect(tx - w / 2, ty - w, w, w);
        c.fillStyle = '#f6d21f';
        c.beginPath();
        c.moveTo(tx - w * 0.32, ty - w * 0.5);
        c.lineTo(tx + w * 0.25, ty - w * 0.82);
        c.lineTo(tx + w * 0.25, ty - w * 0.18);
        c.closePath();
        c.fill();
      });
  }
  if (portal)
    add(portal.z, () => {
      const z = portal.z;
      poly(
        [
          proj(z, -80, 0),
          proj(z, -80, 30),
          proj(z, -40, 44),
          proj(z, -14, 52),
          proj(z, 16, 46),
          proj(z, 50, 36),
          proj(z, 80, 26),
          proj(z, 80, 0),
        ],
        shade([84, 104, 70], z),
      );
      poly(
        [proj(z, -22, 0), proj(z, -18, 16), proj(z, -8, 22), proj(z, 8, 21), proj(z, 18, 14), proj(z, 22, 0)],
        shade([118, 116, 104], z),
      );
      const [px0, py0] = proj(z, -5.2, 9.4),
        [px1, py1] = proj(z, 5.2, 0);
      c.fillStyle = shade([150, 146, 136], z);
      c.fillRect(px0, py0, px1 - px0, py1 - py0);
      const ar = [proj(z, 4.2, 0)];
      for (let q = 0; q <= 16; q++) {
        const t = (Math.PI * q) / 16;
        ar.push(proj(z, 4.2 * Math.cos(t), 5 + 4 * Math.sin(t)));
      }
      ar.push(proj(z, -4.2, 0));
      poly(ar, '#050505');
    });
  if (!F.gone) {
    const z = F.s - F.len - S.s;
    if (z > 2 && z < Math.min(1900, zCap + 1))
      add(
        z,
        () => {
          const sc = f / z;
          const [x0, y0] = proj(z, -1.55, 4.0),
            [x1, y1] = proj(z, 1.55, 0.9);
          c.fillStyle = shade([96, 62, 44], z);
          c.fillRect(x0, y0, x1 - x0, y1 - y0);
          c.strokeStyle = '#2c1a12';
          c.lineWidth = Math.max(1, 0.05 * sc);
          c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        },
        () => {
          const sc = f / z;
          for (const sx of [-1.1, 1.1]) {
            const [lx, ly] = proj(z, sx, 1.15);
            const lr = Math.max(1.4, 0.13 * sc);
            c.save();
            c.shadowColor = '#ff3b30';
            c.shadowBlur = Math.max(5, lr * 3);
            c.fillStyle = '#ff3b30';
            c.beginPath();
            c.arc(lx, ly, lr, 0, 7);
            c.fill();
            c.restore();
          }
        },
      );
  }
  objs.sort((a, b) => b.z - a.z).forEach(o => o.d());
  if (!inTun) {
    const fh = sc0.met === 'fog' ? H * 0.32 : H * 0.06;
    g = c.createLinearGradient(0, hyH - fh, 0, hyH + fh * 0.8);
    g.addColorStop(0, rgb(haze, 0));
    g.addColorStop(0.55, rgb(haze, sc0.met === 'fog' ? 0.9 : 0.3));
    g.addColorStop(1, rgb(haze, 0));
    c.fillStyle = g;
    c.fillRect(0, hyH - fh, W, fh * 1.8);
  }
  if (night || inTun || sc0.tod === 'dusk') {
    const [hx, hyy] = proj(60, 0, 0);
    const rg = c.createRadialGradient(hx, hyy + H * 0.12, 4, hx, hyy + H * 0.12, H * 0.55);
    rg.addColorStop(0, 'rgba(255,240,210,' + (night || inTun ? 0.22 : 0.08) + ')');
    rg.addColorStop(1, 'rgba(255,240,210,0)');
    c.fillStyle = rg;
    c.fillRect(0, 0, W, H);
  }
  objs.forEach(o => {
    if (o.gl) o.gl();
  });
  if (sc0.met === 'rain' && !inTun) {
    c.strokeStyle = 'rgba(210,220,230,.35)';
    c.lineWidth = 1;
    c.beginPath();
    for (const [rx, ry, rs] of RAIN) {
      const x = (rx * W + S.t * 40 * rs) % W,
        y = (ry * H + S.t * 900 * rs) % H,
        l = 10 + S.v * 0.4;
      c.moveTo(x, y);
      c.lineTo(x - l * 0.15, y + l);
    }
    c.stroke();
  }
  c.fillStyle = '#090d10';
  c.beginPath();
  c.rect(0, 0, W, H);
  const ix = W * 0.018,
    iy = H * 0.035,
    iw = W - 2 * ix,
    ih = H * 0.88 - iy,
    rr = Math.min(W, H) * 0.06;
  if (c.roundRect) c.roundRect(ix, iy, iw, ih, rr);
  else c.rect(ix, iy, iw, ih);
  c.fill('evenodd');
  g = c.createLinearGradient(0, H * 0.86, 0, H);
  g.addColorStop(0, '#1a2228');
  g.addColorStop(1, '#0b0f12');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(0, H);
  c.lineTo(0, H * 0.9);
  c.quadraticCurveTo(W * 0.5, H * 0.84, W, H * 0.9);
  c.lineTo(W, H);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(127,208,230,.25)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(W * 0.1, H * 0.885);
  c.quadraticCurveTo(W * 0.5, H * 0.85, W * 0.9, H * 0.885);
  c.stroke();
}

const EC = {
  bg: '#031122',
  dg: '#555b63',
  mg: '#969696',
  gr: '#c3c3c3',
  wh: '#ffffff',
  ye: '#dfdf00',
  or: '#ea9100',
  rd: '#bf0002',
  db: '#08243f',
  sh: '#0d2f55',
};
/** DMI on canvas: speedometer with supervision curves, distance to target, planning area and messages.
 * The same canvas becomes the texture of the screen on the desk of the 3D view
 */
export function renderDmi() {
  const sim = app.sim;
  const { c, W, H } = fit($('cvDmi'));
  c.fillStyle = EC.bg;
  c.fillRect(0, 0, W, H);
  const etcs = sim.scen.sig === 'ETCS',
    sp = S.sup,
    v = S.v * 3.6;
  const stCol = { NOR: EC.gr, IND: EC.ye, OVS: EC.or, WAR: EC.or, SBI: EC.rd, INT: EC.rd }[sp.status] || EC.gr;
  const aW = W * 0.13,
    dW = W * 0.34,
    bW = W - aW - dW;
  c.font = '600 ' + Math.round(H * 0.05) + 'px ' + MONO;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const t = sp.tgt;
  if (t && t.d < 4000) {
    const frac = clamp(Math.log10(1 + t.d / 10) / Math.log10(401), 0, 1);
    const bh = H * 0.55 * frac;
    c.fillStyle = EC.dg;
    c.fillRect(aW * 0.42, H * 0.78 - H * 0.55, aW * 0.16, H * 0.55);
    c.fillStyle = sp.status === 'NOR' ? EC.gr : stCol;
    c.fillRect(aW * 0.42, H * 0.78 - bh, aW * 0.16, bh);
    c.fillStyle = EC.gr;
    c.fillText(String(Math.max(0, Math.round(t.d / 10) * 10)), aW / 2, H * 0.14);
    c.font = Math.round(H * 0.036) + 'px ' + MONO;
    c.fillStyle = EC.mg;
    c.fillText('m', aW / 2, H * 0.2);
  }
  if (!etcs) {
    const ns = sim.nextSignal(S.s);
    if (ns) {
      c.fillStyle = '#000';
      c.beginPath();
      c.arc(aW / 2, H * 0.88, H * 0.06, 0, 7);
      c.fill();
      c.strokeStyle = '#e9e9e9';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = LAMP[ns.asp];
      c.beginPath();
      c.arc(aW / 2, H * 0.88, H * 0.025, 0, 7);
      c.fill();
    }
  } else {
    c.fillStyle = EC.gr;
    c.font = '600 ' + Math.round(H * 0.045) + 'px ' + MONO;
    c.fillText('FS', aW / 2, H * 0.86);
    c.fillStyle = EC.mg;
    c.font = Math.round(H * 0.035) + 'px ' + MONO;
    c.fillText('L2', aW / 2, H * 0.93);
  }
  const cx = aW + bW / 2,
    cy = H * 0.47,
    R = Math.min(bW * 0.46, H * 0.44),
    VM = TR.vmax * 3.6 > 200 ? 400 : TR.vmax * 3.6 > 140 ? 250 : 180;
  const ang = x => ((144 + (clamp(x, 0, VM) / VM) * 252) * Math.PI) / 180;
  c.strokeStyle = EC.gr;
  c.lineWidth = 1;
  for (let x = 0; x <= VM; x += 10) {
    const a = ang(x),
      maj = x % (VM > 250 ? 50 : 20) === 0;
    c.lineWidth = maj ? 2 : 1;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * R * (maj ? 0.78 : 0.84), cy + Math.sin(a) * R * (maj ? 0.78 : 0.84));
    c.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9);
    c.stroke();
    if (maj && x % (VM > 250 ? 100 : 40) === 0) {
      c.fillStyle = EC.gr;
      c.font = Math.round(R * 0.11) + 'px ' + MONO;
      c.fillText(String(x), cx + Math.cos(a) * R * 0.64, cy + Math.sin(a) * R * 0.64);
    }
  }
  const vp = sp.vP * 3.6,
    vt = t ? t.v * 3.6 : vp,
    csgW = R * 0.09,
    rc = R * 0.97;
  c.lineWidth = csgW;
  c.lineCap = 'butt';
  if (etcs && sp.ind && vt < vp) {
    c.strokeStyle = EC.wh;
    c.beginPath();
    c.arc(cx, cy, rc, ang(0), ang(vt));
    c.stroke();
    c.strokeStyle = EC.ye;
    c.beginPath();
    c.arc(cx, cy, rc, ang(vt), ang(vp));
    c.stroke();
  } else {
    c.strokeStyle = etcs ? EC.dg : '#4a5962';
    c.beginPath();
    c.arc(cx, cy, rc, ang(0), ang(vp));
    c.stroke();
  }
  if (v > vp) {
    c.strokeStyle = stCol;
    c.beginPath();
    c.arc(cx, cy, rc, ang(vp), ang(v));
    c.stroke();
  }
  c.lineWidth = csgW * 1.8;
  c.strokeStyle = etcs ? (sp.ind ? EC.ye : EC.gr) : COL.accent;
  c.beginPath();
  c.arc(cx, cy, rc, ang(vp) - 0.025, ang(vp) + 0.025);
  c.stroke();
  const a = ang(v);
  c.strokeStyle = stCol;
  c.fillStyle = stCol;
  c.lineWidth = R * 0.05;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(cx + Math.cos(a) * R * 0.18, cy + Math.sin(a) * R * 0.18);
  c.lineTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82);
  c.stroke();
  c.lineCap = 'butt';
  c.beginPath();
  c.arc(cx, cy, R * 0.19, 0, 7);
  c.fill();
  c.fillStyle = EC.bg;
  c.font = '600 ' + Math.round(R * 0.17) + 'px ' + MONO;
  c.fillText(String(Math.round(v)), cx, cy + 1);
  c.fillStyle = EC.mg;
  c.font = Math.round(R * 0.08) + 'px ' + MONO;
  c.fillText('km/h', cx, cy + R * 0.32);
  const labels = {
    NOR: etcs ? 'normal supervision' : 'SCMT active',
    IND: 'indication',
    OVS: 'overspeed',
    WAR: 'warning',
    SBI: 'service braking',
    INT: 'intervention',
  };
  c.fillStyle = stCol;
  c.font = '600 ' + Math.round(R * 0.085) + 'px ' + SANS;
  c.fillText(labels[sp.status], cx, cy + R * 0.5);
  c.fillStyle = EC.gr;
  c.font = Math.round(R * 0.075) + 'px ' + MONO;
  c.fillText('permitted ' + Math.round(vp) + (t ? ' · target ' + Math.round(t.v * 3.6) : ''), cx, cy + R * 0.64);
  const x0 = aW + bW,
    pw = dW - 8,
    top = H * 0.06,
    bot = H * 0.92,
    dist = 4000;
  const Yd = d => bot - (bot - top) * (Math.log10(1 + d / 50) / Math.log10(1 + dist / 50));
  c.fillStyle = EC.db;
  c.fillRect(x0, top, pw, bot - top);
  c.strokeStyle = '#123a63';
  c.lineWidth = 1;
  c.font = Math.round(H * 0.032) + 'px ' + MONO;
  c.textAlign = 'left';
  for (const d of [0, 250, 500, 1000, 2000, 4000]) {
    const y = Yd(d);
    c.beginPath();
    c.moveTo(x0 + pw * 0.14, y);
    c.lineTo(x0 + pw, y);
    c.stroke();
    c.fillStyle = EC.mg;
    c.fillText(d >= 1000 ? d / 1000 + 'k' : String(d), x0 + pw * 0.83, y - H * 0.022);
  }
  for (const p of L.prof) {
    if (p.b < S.s || p.a > S.s + dist) continue;
    const ya = Yd(Math.max(0, p.a - S.s)),
      yb = Yd(Math.min(dist, p.b - S.s));
    c.fillStyle = p.i >= 0 ? EC.mg : EC.dg;
    c.fillRect(x0 + 2, yb, pw * 0.1, ya - yb);
    if (ya - yb > H * 0.07) {
      c.fillStyle = p.i >= 0 ? '#111' : EC.gr;
      c.textAlign = 'center';
      c.fillText((p.i >= 0 ? '+' : '−') + Math.round(Math.abs(p.i)), x0 + 2 + pw * 0.05, (ya + yb) / 2);
    }
  }
  const pvm = Math.max(...L.lim.map(l => Math.min(l[2], TR.vmax * 3.6)));
  c.textAlign = 'left';
  for (const [la, lb, lv] of L.lim) {
    if (lb < S.s || la > S.s + dist) continue;
    const vv = Math.min(lv, TR.vmax * 3.6);
    const ya = Yd(Math.max(0, la - S.s)),
      yb = Yd(Math.min(dist, lb - S.s)),
      w = (pw * 0.55 * vv) / pvm;
    c.fillStyle = EC.sh;
    c.fillRect(x0 + pw * 0.14, yb, w, ya - yb);
    if (la > S.s) {
      c.fillStyle = vv < sim.lineLimit(S.s) ? EC.ye : EC.gr;
      c.fillText(String(Math.round(vv)), x0 + pw * 0.16 + w, ya - H * 0.02);
    }
  }
  for (const st of L.st) {
    const d = st.s - S.s;
    if (d < 0 || d > dist) continue;
    const y = Yd(d);
    c.fillStyle = EC.wh;
    c.fillRect(x0 + pw * 0.14, y - 1, pw * 0.55, 2);
    c.fillStyle = EC.gr;
    c.fillText(st.name.slice(0, 12), x0 + pw * 0.16, y - H * 0.025);
  }
  if (t && t.v === 0 && t.d < dist) {
    const y = Yd(Math.max(0, t.d));
    c.fillStyle = etcs ? EC.ye : EC.rd;
    c.fillRect(x0 + pw * 0.14, y - 2, pw * 0.7, 4);
    c.fillText(etcs ? 'EoA' : 'red', x0 + pw * 0.16, y + H * 0.035);
  }
  c.fillStyle = EC.mg;
  c.textAlign = 'center';
  c.fillText(etcs ? 'planning' : 'static profile', x0 + pw / 2, H * 0.975);
}

/** Line diagram: speed limits, tunnels, occupied sections, signals, stations and train position */
export function renderLine() {
  const sim = app.sim;
  const { c, W, H } = fit($('cvLine'));
  c.clearRect(0, 0, W, H);
  const pl = 6,
    pr = 6,
    X = s => pl + (s / L.len) * (W - pl - pr),
    ty = H * 0.46;
  const vmx = Math.max(...L.lim.map(l => l[2]));
  c.strokeStyle = COL.muted;
  c.lineWidth = 1.2;
  c.beginPath();
  L.lim.forEach(([a, b, l], i) => {
    const y = H * 0.24 - (l / vmx) * H * 0.2;
    const xa = X(a),
      xb = X(Math.min(b, L.len));
    i ? c.lineTo(xa, y) : c.moveTo(xa, y);
    c.lineTo(xb, y);
  });
  c.stroke();
  c.fillStyle = COL.muted;
  c.font = '10px ' + MONO;
  c.textAlign = 'center';
  L.lim.forEach(([a, b, l]) => {
    const xb = Math.min(b, L.len);
    if (X(xb) - X(a) > 28) c.fillText(String(l), (X(a) + X(xb)) / 2, H * 0.24 - (l / vmx) * H * 0.2 - 3);
  });
  for (const t of L.tun) {
    c.fillStyle = 'rgba(139,156,166,.25)';
    c.fillRect(X(t[0]), ty - 9, X(t[1]) - X(t[0]), 18);
  }
  // the other trains of the run (services), in the chainages of the line
  // (with a network, only those on the main line, the one drawn); the train ahead is drawn on its own, below
  const others = sim.trains
    .filter(r => r !== sim.train && r !== sim.leader && r.active && !r.S.finished)
    .flatMap(r => {
      const h = sim.mainChainage(r),
        t = sim.mainChainage(r, r.S.s - r.TR.L);
      if (h == null && t == null) return [];
      const x = h ?? (r.dir > 0 ? L.len : 0),
        y = t ?? (r.dir > 0 ? 0 : L.len);
      return [{ r, a: Math.min(x, y), b: Math.max(x, y) }];
    });
  L.sig.forEach((sg, i) => {
    const b0 = i + 1 < L.sig.length ? L.sig[i + 1].s : L.len;
    const ahead = !F.gone && F.s > sg.s && F.s - F.len < (i + 1 < L.sig.length ? L.sig[i + 1].s : L.len + 2000);
    if (ahead || others.some(o => o.b > sg.s && o.a < b0)) {
      const b = b0;
      c.fillStyle = 'rgba(238,74,69,.3)';
      c.fillRect(X(sg.s), ty - 7, X(b) - X(sg.s), 14);
    }
  });
  c.strokeStyle = COL.fg;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(X(0), ty);
  c.lineTo(X(L.len), ty);
  c.stroke();
  L.sig.forEach(sg => {
    const x = X(sg.s);
    c.strokeStyle = COL.muted;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, ty);
    c.lineTo(x, ty - 13);
    c.stroke();
    if (sim.scen.sig === 'BACC') {
      c.fillStyle = ASPCOL[sg.asp];
      c.beginPath();
      c.arc(x, ty - 16, 4, 0, 7);
      c.fill();
    } else {
      c.fillStyle = '#1c4fa3';
      c.fillRect(x - 3, ty - 19, 6, 6);
    }
  });
  if (S.ma) {
    const x = X(Math.min(L.len, S.ma.eoa));
    c.fillStyle = COL['sig-y'];
    c.fillRect(x - 1.5, ty - 12, 3, 24);
    c.fillRect(X(S.s), ty + 9, Math.max(0, x - X(S.s)), 2);
  }
  c.font = '11px ' + SANS;
  let lastR = -1e9;
  const n = L.st.length;
  const lastL = n ? X(L.st[n - 1].s) - c.measureText(L.st[n - 1].name).width - 6 : W;
  L.st.forEach((st, i) => {
    const x = X(st.s);
    c.fillStyle = COL.fg;
    c.fillRect(x - 1, ty - 2, 2, 12);
    const w = c.measureText(st.name).width,
      al = i === 0 ? 'left' : i === n - 1 ? 'right' : 'center',
      lx = al === 'left' ? Math.max(pl, x - 4) : al === 'right' ? x - w : x - w / 2;
    if (lx < lastR + 6 || (i < n - 1 && lx + w > lastL)) return;
    c.textAlign = al;
    c.fillText(st.name, al === 'left' ? Math.max(pl, x - 4) : x, ty + 24);
    lastR = lx + w;
  });
  if (!F.gone) {
    const x0 = X(Math.max(0, F.s - F.len)),
      x1 = X(Math.min(L.len, F.s));
    if (x1 > x0) {
      c.fillStyle = COL.orange;
      c.fillRect(x0, ty - 4, Math.max(3, x1 - x0), 8);
    }
  }
  c.font = '10px ' + MONO;
  for (const o of others) {
    const fw = o.r.dir > 0,
      x0 = X(Math.max(0, o.a)),
      x1 = X(Math.min(L.len, o.b)),
      y = fw ? ty - 4 : ty + 3;
    c.fillStyle = fw ? '#3d9bff' : '#e0a43a';
    c.fillRect(x0, y, Math.max(3, x1 - x0), fw ? 8 : 6);
    c.beginPath();
    if (fw) {
      c.moveTo(x1 + 6, y + 4);
      c.lineTo(x1, y - 1);
      c.lineTo(x1, y + 9);
    } else {
      c.moveTo(x0 - 6, y + 3);
      c.lineTo(x0, y - 2);
      c.lineTo(x0, y + 8);
    }
    c.fill();
    c.textAlign = 'center';
    c.fillText(o.r.id, (x0 + x1) / 2, fw ? ty - 24 : ty + 38);
  }
  const xp = X(S.s);
  c.fillStyle = COL.accent;
  c.fillRect(X(Math.max(0, S.s - TR.L)), ty - 4, Math.max(3, xp - X(S.s - TR.L)), 8);
  c.beginPath();
  c.moveTo(xp + 7, ty);
  c.lineTo(xp, ty - 7);
  c.lineTo(xp, ty + 7);
  c.fill();
  const y0 = H * 0.98,
    y1 = H * 0.7,
    Y = a => y0 - ((a - L.amin) / (L.amax - L.amin || 1)) * (y0 - y1);
  c.beginPath();
  c.moveTo(X(0), y0);
  for (let s = 0; s <= L.len; s += 50) c.lineTo(X(s), Y(altOf(L, s)));
  c.lineTo(X(L.len), y0);
  c.closePath();
  c.fillStyle = 'rgba(139,156,166,.18)';
  c.fill();
  c.strokeStyle = COL.muted;
  c.lineWidth = 1;
  c.stroke();
  c.fillStyle = COL.accent;
  c.beginPath();
  c.arc(xp, Y(altOf(L, S.s)), 3, 0, 7);
  c.fill();
  c.fillStyle = COL.muted;
  c.textAlign = 'right';
  c.font = '10px ' + MONO;
  c.fillText(Math.round(L.amax) + ' m', W - pr, y1 - 3);
}
/** Distance-speed chart of the run, with altitude profile and speed limits in the background */
export function renderChart() {
  const sim = app.sim;
  const { c, W, H } = fit($('cvChart'));
  c.clearRect(0, 0, W, H);
  const pl = 36,
    pr = 8,
    pt = 8,
    pb = 22;
  const VM = Math.ceil((Math.min(Math.max(...L.lim.map(l => l[2])), TR.vmax * 3.6) + 20) / 20) * 20;
  const X = s => pl + (s / L.len) * (W - pl - pr),
    Y = v => pt + (1 - Math.min(VM, v) / VM) * (H - pt - pb);
  const Ya = a => H - pb - ((a - L.amin) / (L.amax - L.amin || 1)) * (H - pt - pb) * 0.35;
  c.beginPath();
  c.moveTo(X(0), H - pb);
  for (let s = 0; s <= L.len; s += 50) c.lineTo(X(s), Ya(altOf(L, s)));
  c.lineTo(X(L.len), H - pb);
  c.closePath();
  c.fillStyle = 'rgba(58,74,84,.5)';
  c.fill();
  c.font = '10px ' + MONO;
  c.fillStyle = COL.muted;
  c.strokeStyle = COL.line;
  c.lineWidth = 1;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  const vs = VM > 200 ? 50 : VM > 120 ? 40 : 20;
  for (let v = 0; v <= VM; v += vs) {
    c.beginPath();
    c.moveTo(pl, Y(v));
    c.lineTo(W - pr, Y(v));
    c.stroke();
    c.fillText(String(v), pl - 6, Y(v));
  }
  c.textAlign = 'center';
  c.textBaseline = 'top';
  const kmStep = W < 620 ? 5 : L.len > 40000 ? 5 : 1;
  for (let k = 0; k * 1000 <= L.len; k += kmStep) c.fillText(String(k), X(k * 1000), H - pb + 5);
  c.textBaseline = 'alphabetic';
  for (const t of L.tun) {
    c.fillStyle = 'rgba(139,156,166,.1)';
    c.fillRect(X(t[0]), pt, X(t[1]) - X(t[0]), H - pt - pb);
  }
  L.st.forEach(st => {
    c.strokeStyle = COL.line;
    c.setLineDash([3, 3]);
    c.beginPath();
    c.moveTo(X(st.s), pt);
    c.lineTo(X(st.s), H - pb);
    c.stroke();
    c.setLineDash([]);
  });
  c.strokeStyle = COL.muted;
  c.lineWidth = 1.5;
  c.beginPath();
  L.lim.forEach(([a, b, l], i) => {
    const xa = X(a),
      xb = X(Math.min(b, L.len));
    i ? c.lineTo(xa, Y(l)) : c.moveTo(xa, Y(l));
    c.lineTo(xb, Y(l));
  });
  c.stroke();
  const end = Math.min(L.len, S.s + (sim.scen.sig === 'ETCS' && S.ma ? Math.max(300, S.ma.svl - S.s + 100) : 4500));
  const curve = (key, col, dash) => {
    c.strokeStyle = col;
    c.lineWidth = 1.5;
    c.setLineDash(dash);
    c.beginPath();
    let first = true;
    const stp = Math.max(10, (end - S.s) / 220);
    for (let s = S.s; s <= end; s += stp) {
      const sp = sim.supervise(s, 0);
      const v = sp[key];
      if (!isFinite(v)) continue;
      const y = Y(v * 3.6);
      first ? c.moveTo(X(s), y) : c.lineTo(X(s), y);
      first = false;
    }
    c.stroke();
    c.setLineDash([]);
  };
  curve('vP', COL.accent, [5, 3]);
  curve('vEBI', COL['sig-r'], [2, 3]);
  c.strokeStyle = COL.fg;
  c.lineWidth = 2;
  c.beginPath();
  S.trace.forEach(([s, v], i) => (i ? c.lineTo(X(s), Y(v)) : c.moveTo(X(s), Y(v))));
  c.lineTo(X(S.s), Y(S.v * 3.6));
  c.stroke();
  c.fillStyle = COL.fg;
  c.beginPath();
  c.arc(X(S.s), Y(S.v * 3.6), 3.5, 0, 7);
  c.fill();
  c.fillStyle = COL.muted;
  c.textAlign = 'left';
  c.fillText('km/h', pl + 4, pt + 10);
  c.textAlign = 'right';
  c.fillText('km', W - pr, H - pb - 4);
}

/** Coupler forces along the train: bars upwards in tension, downwards in compression */
export function renderCouplers() {
  const sim = app.sim,
    M = sim.mm,
    { c, W, H } = fit($('cvCoup'));
  c.clearRect(0, 0, W, H);
  c.font = '11px ' + SANS;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (!M || M.n < 2) {
    c.fillStyle = COL.muted;
    c.fillText(
      M
        ? 'A single vehicle: no coupler.'
        : 'Point mass model: the internal forces are not computed. Choose the multi-mass model in the Train tab.',
      W / 2,
      H / 2,
    );
    return;
  }
  const pl = 46,
    pr = 10,
    pt = 10,
    pb = 26,
    mid = pt + (H - pt - pb) / 2;
  const peak = Math.max(20000, S.maxTension, S.maxCompression) * 1.1;
  const Y = f => mid - ((f / peak) * (H - pt - pb)) / 2;
  c.strokeStyle = COL.line;
  c.lineWidth = 1;
  c.textAlign = 'right';
  c.fillStyle = COL.muted;
  c.font = '10px ' + MONO;
  const st =
    Math.pow(10, Math.floor(Math.log10(peak / 2))) *
    (peak / 2 / Math.pow(10, Math.floor(Math.log10(peak / 2))) > 5
      ? 5
      : peak / 2 / Math.pow(10, Math.floor(Math.log10(peak / 2))) > 2
        ? 2
        : 1);
  for (let f = -Math.floor(peak / st) * st; f <= peak; f += st) {
    const y = Y(f);
    if (y < pt - 1 || y > H - pb + 1) continue;
    c.beginPath();
    c.moveTo(pl, y);
    c.lineTo(W - pr, y);
    c.stroke();
    c.fillText(String(Math.round(f / 1000)), pl - 6, y);
  }
  c.strokeStyle = COL.muted;
  c.beginPath();
  c.moveTo(pl, mid);
  c.lineTo(W - pr, mid);
  c.stroke();
  const tot = M.veh.reduce((a, v) => a + v.L, 0),
    X = d => pl + (d / tot) * (W - pl - pr);
  // vehicles
  let off = 0;
  for (let i = 0; i < M.n; i++) {
    const v = M.veh[i],
      x0 = X(off) + 1,
      x1 = X(off + v.L) - 1;
    c.fillStyle = v.motored ? 'rgba(127,208,230,.22)' : 'rgba(139,156,166,.14)';
    c.fillRect(x0, H - pb + 6, x1 - x0, 10);
    off += v.L;
  }
  // forces
  off = 0;
  const bw = Math.max(2, Math.min(18, ((W - pl - pr) / M.n) * 0.5));
  for (let j = 0; j < M.n - 1; j++) {
    off += M.veh[j].L;
    const x = X(off),
      f = M.T[j],
      y = Y(f);
    c.fillStyle = f >= 0 ? COL.accent : COL.orange;
    c.fillRect(x - bw / 2, Math.min(y, mid), bw, Math.abs(y - mid));
  }
  c.fillStyle = COL.muted;
  c.textAlign = 'left';
  c.font = '10px ' + MONO;
  c.fillText('kN', pl + 4, pt + 6);
  c.textAlign = 'left';
  c.fillText('head', pl, H - 6);
  c.textAlign = 'right';
  c.fillText('tail', W - pr, H - 6);
}
