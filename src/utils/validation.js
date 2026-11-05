import { SCHEMA } from '../constants/defaults';

export function estimate(p) {
  const a = p.rMin;
  const c = p.rMean;
  const b = p.rMax;
  const mr = (a + b + c) / 3;
  const vr = (a * a + b * b + c * c - a * b - a * c - b * c) / 18;
  const ar =
    Math.PI *
    ((1 - p.finesFrac) * (mr * mr + vr) +
      p.finesFrac * p.rFine * p.rFine);
  const Ngen = ((p.level ? 1.2 : 1.0) * p.L * p.H * 0.83) / ar;
  const Nbed = (p.L * p.H * 0.83) / ar;
  const rmin = Math.min(p.rMin, p.finesFrac > 0 ? p.rFine : Infinity);
  const mmin = p.rho * Math.PI * rmin * rmin;
  const dt = p.dtFactor * Math.PI * Math.sqrt((0.5 * mmin) / p.kn);
  return { Ngen, Nbed, dt, d50: 2 * mr };
}

export function validate(p, badInputs = {}) {
  const E = [];
  const W = [];
  const I = [];

  if (Object.values(badInputs).some(Boolean)) {
    E.push('Some inputs are invalid (outlined in red).');
  }
  if (!(p.rMin <= p.rMean && p.rMean <= p.rMax)) {
    E.push('Grain radii must satisfy minimum ≤ most likely ≤ maximum.');
  }
  if (p.rwp * 3 >= p.R) {
    E.push('Rim radius must be more than three wheel-particle radii.');
  }

  const est = estimate(p);
  const nrad = Math.floor(p.hGrouser / p.rwp + 1e-9);

  if (p.nGrousers > 0 && nrad < 1) {
    W.push(
      'Grouser height is below one wheel-particle radius (' +
        (p.rwp * 1e3).toFixed(1) +
        ' mm), so no grouser particles will be placed.'
    );
  }
  if (p.nGrousers > 0 && nrad >= 1) {
    I.push(
      'Grousers: ' +
        p.nGrousers +
        ' × ' +
        nrad +
        ' particles, actual height ' +
        (nrad * p.rwp * 1e3).toFixed(1) +
        ' mm.'
    );
  }

  const Rtip = p.nGrousers > 0 && nrad > 0 ? p.R + nrad * p.rwp : p.R;
  if (p.H < p.R) {
    W.push(
      'Bed depth is smaller than the wheel radius; the base will stiffen the response.'
    );
  }
  if (p.boundary === 'walls' && p.L < 6 * p.R) {
    W.push('Bed is shorter than six wheel radii; side walls will dominate.');
  }
  if (p.boundary === 'periodic' && p.L < 4 * Rtip) {
    W.push(
      'Periodic bed shorter than four wheel radii: the wheel will interact with its own rut quickly.'
    );
  }
  if (p.R / est.d50 < 8) {
    W.push(
      'Wheel diameter is only ' +
        ((2 * p.R) / est.d50).toFixed(1) +
        ' median grain diameters; expect grain-scale scatter.'
    );
  }
  if (p.finesFrac > 0 && p.rFine >= p.rMin) {
    W.push(
      'Fines are not smaller than the coarse grains. They are still tracked as ejecta.'
    );
  }
  if (est.Ngen > 8000) {
    W.push(
      'About ' +
        Math.round(est.Ngen) +
        ' grains will be generated; the browser run will be slow.'
    );
  }

  const W0 = p.wheelMass * p.g;
  const ovl = W0 / (4 * p.kn);
  if (ovl > 0.05 * p.rMin) {
    W.push(
      'Wheel load gives contact overlaps near ' +
        ((100 * ovl) / p.rMin).toFixed(0) +
        ' % of the smallest radius. Raise kn.'
    );
  }
  if (p.mode === 'slip' && (p.slip >= 1 || p.slip <= -1)) {
    W.push(
      'Imposed slip of ' +
        p.slip +
        ' means the wheel does not advance or moves backwards.'
    );
  }
  if (p.boundary === 'walls') {
    const x0 =
      p.x0 >= 0 ? p.x0 : p.direction === 'cw' ? 0.25 * p.L : 0.75 * p.L;
    if (x0 - Rtip < 0 || x0 + Rtip > p.L) {
      E.push('Wheel start position puts the wheel through a side wall.');
    }
  }

  const travel =
    p.omega *
    p.R *
    (p.mode === 'slip' ? 1 - p.slip : 1) *
    Math.max(p.tDrive - 0.5 * p.tRamp, 0);
  const room =
    p.boundary === 'periodic'
      ? p.stopBeforeLap
        ? p.L - 2 * Rtip
        : Infinity
      : 0.5 * p.L;

  if (travel > room) {
    I.push(
      'At these settings the wheel would travel about ' +
        (travel * 1e3).toFixed(0) +
        ' mm; the drive will stop early at about ' +
        (room * 1e3).toFixed(0) +
        ' mm.'
    );
  }
  I.push(
    'About ' +
      Math.round(est.Nbed) +
      ' grains in the bed, Δt ≈ ' +
      (est.dt * 1e6).toFixed(1) +
      ' µs, ' +
      Math.round((p.tDrive + p.tCoast + 0.5) / est.dt).toLocaleString() +
      ' steps for the wheel phases.'
  );

  return { E, W, I };
}

export function bedChanged(bedParams, params) {
  if (!bedParams) return true;
  return SCHEMA.some(
    (s) => s.k && s.lvl === 'bed' && bedParams[s.k] !== params[s.k]
  );
}
