import { formatNum } from '../utils/math';

function computeSteady(sim, arr) {
  if (!sim || !sim.log || !sim.log.t) return NaN;
  const L = sim.log.t;
  if (sim.tDriveStart === null || sim.tDriveStart === undefined) return NaN;
  const t0 = sim.tDriveStart;
  const t1 = sim.tStop ?? L[L.length - 1];
  const a = t0 + 0.5 * (t1 - t0);
  let s = 0;
  let c = 0;

  for (let k = 0; k < L.length; k++) {
    if (L[k] > a && L[k] <= t1 && isFinite(arr[k])) {
      s += arr[k];
      c++;
    }
  }
  return c ? s / c : NaN;
}

export function ReadoutGrid({ sim }) {
  if (!sim) {
    return <div className="readout" id="readout" />;
  }

  const L = sim.log || { t: [], dist: [], sink: [], slip: [], dp: [], tq: [] };
  const last = (a) => (a && a.length ? a[a.length - 1] : NaN);
  const ev = sim.ev || { n: 0, sumAbs: 0, maxAbs: 0, rear: 0, maxTf: 0, maxApex: 0 };
  const wh = !!sim.wheelOn;

  const cells = [
    ['Grains in bed', String(sim.N)],
    [
      'Bed settled after',
      sim.tBedReady !== undefined ? formatNum(sim.tBedReady, 2) + ' s' : '–',
    ],
    [
      '2D areal porosity',
      sim.porosity !== undefined ? formatNum(sim.porosity, 3) : '–',
    ],
    ['Settled surface height', sim.Hs ? formatNum(sim.Hs * 1e3) + ' mm' : '–'],
    ['Wheel load', formatNum(sim.p.wheelMass * sim.p.g, 1) + ' N/m'],
    [
      'Rotation',
      sim.p.direction === 'ccw' ? 'Counterclockwise' : 'Clockwise',
    ],
    ['Sinkage now', wh ? formatNum(last(L.sink)) + ' mm' : '–'],
    ['Travel', wh ? formatNum(last(L.dist) * 1e3, 0) + ' mm' : '–'],
    ['Slip, steady', formatNum(computeSteady(sim, L.slip), 3)],
    ['Drawbar pull, steady', formatNum(computeSteady(sim, L.dp)) + ' N/m'],
    ['Torque, steady', formatNum(computeSteady(sim, L.tq), 3) + ' N·m/m'],
    ['Sinkage, steady', formatNum(computeSteady(sim, L.sink)) + ' mm'],
    ['Airborne fines', wh ? String(sim.nAir) : '–'],
    ['Ejecta flights', String(ev.n)],
    [
      'Mean flight distance',
      ev.n ? formatNum((ev.sumAbs / ev.n) * 1e3) + ' mm' : '–',
    ],
    ['Longest flight distance', ev.n ? formatNum(ev.maxAbs * 1e3) + ' mm' : '–'],
    [
      'Thrown behind wheel',
      ev.n ? formatNum((100 * ev.rear) / ev.n, 0) + ' %' : '–',
    ],
    ['Longest flight time', ev.n ? formatNum(ev.maxTf, 3) + ' s' : '–'],
    ['Highest apex', ev.n ? formatNum(ev.maxApex * 1e3) + ' mm' : '–'],
    [
      'Ejecta settled after stop',
      sim.settleTime !== null && sim.settleTime !== undefined
        ? formatNum(sim.settleTime, 3) + ' s'
        : '–',
    ],
  ];

  return (
    <div className="readout" id="readout">
      {cells.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}
