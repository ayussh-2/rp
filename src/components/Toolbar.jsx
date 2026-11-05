export function Toolbar({
  running,
  canBuild,
  canRerun,
  canRelease,
  simSpeed,
  colourMode,
  onBuildBed,
  onRerun,
  onRelease,
  onTogglePause,
  onStep,
  onChangeSpeed,
  onChangeColour,
  onExportCsv,
  onExportEjCsv,
}) {
  return (
    <div className="bar">
      <button
        type="button"
        className="primary"
        id="btnBed"
        disabled={!canBuild}
        onClick={onBuildBed}
      >
        Build bed and run
      </button>
      <button
        type="button"
        id="btnRerun"
        disabled={!canRerun}
        onClick={onRerun}
      >
        Rerun wheel on this bed
      </button>
      <button
        type="button"
        id="btnRelease"
        disabled={!canRelease}
        onClick={onRelease}
      >
        Release wheel
      </button>
      <button
        type="button"
        id="btnPause"
        onClick={onTogglePause}
      >
        {running ? 'Pause' : 'Resume'}
      </button>
      <button
        type="button"
        id="btnStep"
        onClick={onStep}
      >
        Step
      </button>
      <select
        id="speed"
        aria-label="Simulation speed"
        value={simSpeed}
        onChange={(e) => onChangeSpeed(e.target.value)}
      >
        <option value="max">Full speed</option>
        <option value="slow">Slow motion</option>
      </select>
      <select
        id="colour"
        aria-label="Colour grains by"
        value={colourMode}
        onChange={(e) => onChangeColour(e.target.value)}
      >
        <option value="layers">Colour: layers</option>
        <option value="speed">Colour: speed</option>
        <option value="plain">Colour: fines only</option>
      </select>
      <button type="button" id="btnCsv" onClick={onExportCsv}>
        Export time series
      </button>
      <button type="button" id="btnEjCsv" onClick={onExportEjCsv}>
        Export ejecta
      </button>
    </div>
  );
}
