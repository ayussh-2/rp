import { formatNum } from '../utils/math';

const PHASE_NAMES = {
  deposit: 'Depositing bed',
  final: 'Final settling at test gravity',
  ready: 'Bed settled. Wheel parked',
  drop: 'Wheel dropped, coming to rest',
  drive: 'Driving',
  coast: 'Wheel stopped, ejecta landing',
  done: 'Finished',
};

export function StatusBanner({ sim, err }) {
  if (err) {
    return (
      <div className="status" id="status">
        <b style={{ color: 'var(--bad)' }}>{err}</b>
      </div>
    );
  }

  if (!sim) {
    return <div className="status" id="status">Ready</div>;
  }

  const phaseName = PHASE_NAMES[sim.phase] || sim.phase;
  const isSettling = sim.phase === 'deposit' || sim.phase === 'final';

  return (
    <div className="status" id="status">
      <b>{phaseName}</b>, t = {sim.t.toFixed(3)} s, {sim.N} grains, Δt ={' '}
      {(sim.dt * 1e6).toFixed(1)} µs, seed {sim.seedUsed}
      {isSettling && (
        <>
          , mean speed {formatNum((sim.vmNow || 0) * 1e3, 2)} mm/s, max{' '}
          {formatNum((sim.vxNow || 0) * 1e3, 2)} mm/s
        </>
      )}
      {sim.phase === 'ready' && !sim.p.autoRelease && '. Press Release wheel.'}
      {sim.halted && (
        <>
          <br />
          <span style={{ color: 'var(--warn)' }}>{sim.halted}</span>
        </>
      )}
      {sim.stopReason && (sim.phase === 'coast' || sim.phase === 'done') && (
        <>. {sim.stopReason}</>
      )}
    </div>
  );
}
