export function mulberry32(a) {
  return function () {
    let t0 = (a |= 0);
    t0 = (t0 + 0x6d2b79f5) | 0;
    a = t0;
    let t = Math.imul(t0 ^ (t0 >>> 15), 1 | t0);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function triangular(u, a, c, b) {
  if (b <= a) return a;
  const mid = Math.min(b, Math.max(a, c));
  const f = (mid - a) / (b - a);
  return u < f
    ? a + Math.sqrt(u * (b - a) * (mid - a))
    : b - Math.sqrt((1 - u) * (b - a) * (b - mid));
}

export function smooth(a, n = 6) {
  const o = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    let c = 0;
    for (
      let k = Math.max(0, i - n);
      k <= Math.min(a.length - 1, i + n);
      k++
    ) {
      if (isFinite(a[k])) {
        s += a[k];
        c++;
      }
    }
    o[i] = c ? s / c : NaN;
  }
  return o;
}

export function range(arrs, pad = 0.08) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrs) {
    if (!a) continue;
    for (const v of a) {
      if (isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  if (!isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-12) {
    hi += 0.5;
    lo -= 0.5;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

export const formatNum = (v, d = 1) =>
  v !== null && isFinite(v) ? v.toFixed(d) : '–';
