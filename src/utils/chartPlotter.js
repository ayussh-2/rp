import { range } from './math';

export function frameAxes(c, lo, hi, xlo, xhi, opt = {}, colours = {}, dpr = 1) {
  const x = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const d = dpr;
  const l = 46 * d;
  const r = 8 * d;
  const t = 6 * d;
  const b = 18 * d;

  const X = (v) => l + ((W - l - r) * (v - xlo)) / (xhi - xlo || 1);
  const Y = (v) => t + (H - t - b) * (1 - (v - lo) / (hi - lo || 1));

  x.font = 11 * d + "px 'Inter', system-ui, -apple-system, sans-serif";
  x.fillStyle = colours.muted || '#5b6571';
  x.strokeStyle = colours.line || '#c5cbd2';
  x.lineWidth = d;
  x.beginPath();
  x.moveTo(l, t);
  x.lineTo(l, H - b);
  x.lineTo(W - r, H - b);
  x.stroke();

  if (lo < 0 && hi > 0 && !opt.logy) {
    x.setLineDash([3 * d, 3 * d]);
    x.beginPath();
    x.moveTo(l, Y(0));
    x.lineTo(W - r, Y(0));
    x.stroke();
    x.setLineDash([]);
  }

  const fy = (v) =>
    opt.logy
      ? '1e' + v.toFixed(0)
      : Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)
        ? v.toExponential(1)
        : v.toFixed(opt.dec ?? 2);

  x.textAlign = 'right';
  x.fillText(fy(hi), l - 4 * d, t + 9 * d);
  x.fillText(fy(lo), l - 4 * d, H - b);

  const fx = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  x.textAlign = 'left';
  x.fillText(fx(xlo), l, H - 4 * d);
  x.textAlign = 'right';
  x.fillText(fx(xhi) + (opt.xu || ''), W - r, H - 4 * d);

  return { x, X, Y, d, l, r, t, b, W, H };
}

export function lineChart(c, xs, series, opt = {}, colours = {}, dpr = 1) {
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!xs || xs.length < 2) return;

  const tr = opt.logy ? (v) => (v > 0 ? Math.log10(v) : NaN) : (v) => v;
  const vals = series.map((s) => s.v.map(tr));
  const hl = (opt.hlines || []).map((h) => tr(h.y));
  let [lo, hi] = range(vals.concat([hl]));

  if (opt.lo !== undefined) lo = Math.min(lo, opt.lo);
  if (opt.hi !== undefined) hi = Math.max(hi, opt.hi);
  if (opt.logy) {
    lo = Math.floor(lo);
    hi = Math.ceil(hi);
  }

  let [xlo, xhi] = range([xs], 0);
  if (opt.x0 !== undefined) xlo = Math.min(xlo, opt.x0);

  const A = frameAxes(c, lo, hi, xlo, xhi, opt, colours, dpr);
  const x = A.x;

  (opt.vlines || []).forEach((v) => {
    if (v > xlo && v < xhi) {
      x.strokeStyle = colours.line || '#c5cbd2';
      x.beginPath();
      x.moveTo(A.X(v), A.t);
      x.lineTo(A.X(v), A.H - A.b);
      x.stroke();
    }
  });

  (opt.hlines || []).forEach((h, k) => {
    const yv = hl[k];
    if (!isFinite(yv)) return;
    x.strokeStyle = h.c;
    x.setLineDash([4 * A.d, 3 * A.d]);
    x.beginPath();
    x.moveTo(A.l, A.Y(yv));
    x.lineTo(A.W - A.r, A.Y(yv));
    x.stroke();
    x.setLineDash([]);
  });

  series.forEach((s, k) => {
    const v = vals[k];
    x.strokeStyle = s.c;
    x.lineWidth = (s.w || 1.4) * A.d;
    x.globalAlpha = s.a || 1;
    x.beginPath();
    let pen = false;
    for (let i = 0; i < xs.length; i++) {
      if (!isFinite(v[i]) || !isFinite(xs[i])) {
        pen = false;
        continue;
      }
      const px = A.X(xs[i]);
      const py = A.Y(v[i]);
      if (!pen) {
        x.moveTo(px, py);
        pen = true;
      } else {
        x.lineTo(px, py);
      }
    }
    x.stroke();
    x.globalAlpha = 1;
  });
}

export function histChart(c, vals, nb = 36, colours = {}, dpr = 1) {
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!vals || vals.length < 2) return;

  const [lo, hi] = range([vals], 0.02);
  const w = (hi - lo) / nb;
  const cnt = new Array(nb).fill(0);

  for (const v of vals) {
    cnt[Math.min(nb - 1, Math.max(0, Math.floor((v - lo) / (w || 1))))]++;
  }

  const A = frameAxes(
    c,
    0,
    Math.max(...cnt) * 1.05,
    lo,
    hi,
    { dec: 0 },
    colours,
    dpr
  );
  const x = A.x;

  x.fillStyle = colours.s1 || '#27435f';
  for (let k = 0; k < nb; k++) {
    const x0 = A.X(lo + k * w);
    const x1 = A.X(lo + (k + 1) * w);
    const y0 = A.Y(cnt[k]);
    x.fillRect(
      x0 + 0.5 * A.d,
      y0,
      Math.max(x1 - x0 - A.d, 1),
      A.Y(0) - y0
    );
  }

  if (lo < 0 && hi > 0) {
    x.strokeStyle = colours.s2 || '#b5471d';
    x.beginPath();
    x.moveTo(A.X(0), A.t);
    x.lineTo(A.X(0), A.H - A.b);
    x.stroke();
  }
}

export function scatterChart(c, xs, ys, opt = {}, colours = {}, dpr = 1) {
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!xs || xs.length < 2) return;

  let [lo, hi] = range([ys]);
  let [xlo, xhi] = range([xs]);

  if (opt.oneToOne) {
    lo = xlo = Math.min(0, lo, xlo);
    hi = xhi = Math.max(hi, xhi);
  }

  const A = frameAxes(c, lo, hi, xlo, xhi, { dec: opt.dec ?? 3 }, colours, dpr);
  const x = A.x;

  x.fillStyle = colours.s1 || '#27435f';
  x.globalAlpha = 0.55;
  const rr = 1.6 * A.d;

  for (let i = 0; i < xs.length; i++) {
    x.fillRect(A.X(xs[i]) - rr, A.Y(ys[i]) - rr, 2 * rr, 2 * rr);
  }

  x.globalAlpha = 1;

  if (opt.oneToOne) {
    x.strokeStyle = colours.s2 || '#b5471d';
    x.lineWidth = 1.2 * A.d;
    x.beginPath();
    x.moveTo(A.X(lo), A.Y(lo));
    x.lineTo(A.X(hi), A.Y(hi));
    x.stroke();
  }
}
