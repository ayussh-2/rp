import { useState, useEffect, useRef, useCallback } from 'react';
import { DEFAULTS, SCHEMA } from './constants/defaults';
import { RoverDEM } from './simulation/RoverDEM';
import { drawStage } from './simulation/drawing';
import { validate, bedChanged } from './utils/validation';
import { smooth } from './utils/math';
import { lineChart, histChart, scatterChart } from './utils/chartPlotter';
import { downloadTimeSeriesCSV, downloadEjectaCSV } from './utils/export';
import { ControlSidebar } from './components/sidebar/ControlSidebar';
import { Toolbar } from './components/Toolbar';
import { StatusBanner } from './components/StatusBanner';
import { ValidationChecks } from './components/ValidationChecks';
import { StageCanvas } from './components/StageCanvas';
import { ReadoutGrid } from './components/ReadoutGrid';
import { ChartsGrid } from './components/ChartsGrid';
import './App.css';

export default function App() {
  const [params, setParams] = useState(DEFAULTS);
  const [sim, setSim] = useState(() => {
    try {
      return new RoverDEM(DEFAULTS);
    } catch {
      return null;
    }
  });
  const [bedParams, setBedParams] = useState(DEFAULTS);
  const [badInputs, setBadInputs] = useState({});
  const [running, setRunning] = useState(true);
  const [simSpeed, setSimSpeed] = useState('max');
  const [colourMode, setColourMode] = useState('layers');
  const [err, setErr] = useState(null);
  const [, setUiTick] = useState(0);

  const simRef = useRef(sim);
  const viewCanvasRef = useRef(null);
  const traceCanvasRef = useRef(null);
  const chartCanvasesRef = useRef({});
  const coloursRef = useRef({});
  const viewRef = useRef({ s: 1, yTop: 0.2, dpr: 1 });
  const viewDirtyRef = useRef(true);
  const frameNoRef = useRef(0);

  // Keep simRef in sync
  useEffect(() => {
    simRef.current = sim;
  }, [sim]);

  const readColours = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    const keys = [
      'bg', 'panel', 'ink', 'muted', 'line',
      'reg-a', 'reg-b', 'fines', 'ejecta',
      'wheel', 'wheel-2', 'trace',
      's1', 's2', 's3', 's4',
    ];
    const c = {};
    for (const k of keys) {
      c[k] = cs.getPropertyValue('--' + k).trim();
    }
    coloursRef.current = c;
  }, []);

  const clearTrace = useCallback(() => {
    const trace = traceCanvasRef.current;
    if (trace) {
      const tctx = trace.getContext('2d');
      tctx.clearRect(0, 0, trace.width, trace.height);
    }
  }, []);

  const handleResize = useCallback(() => {
    const cv = viewCanvasRef.current;
    if (!cv || !cv.parentElement) return;

    const dpr = window.devicePixelRatio || 1;
    const wCss = cv.parentElement.clientWidth;
    const currentSim = simRef.current;
    const p = currentSim ? currentSim.p : params;
    const Rtip = currentSim ? currentSim.Rtip : p.R;
    const yTop = Math.max(
      currentSim ? currentSim.yGenTop : p.H * 1.8,
      p.H + 2 * Rtip + p.dropHeight + 0.02
    );
    const hCss = Math.max(160, Math.round((wCss * (yTop + 0.004)) / p.L));

    cv.width = Math.round(wCss * dpr);
    cv.height = Math.round(hCss * dpr);
    cv.style.height = hCss + 'px';

    if (!traceCanvasRef.current) {
      traceCanvasRef.current = document.createElement('canvas');
    }
    traceCanvasRef.current.width = cv.width;
    traceCanvasRef.current.height = cv.height;

    viewRef.current = { s: cv.width / p.L, yTop, dpr };

    Object.values(chartCanvasesRef.current).forEach((c) => {
      if (c && c.clientWidth) {
        c.width = Math.round(c.clientWidth * dpr);
        c.height = Math.round(160 * dpr);
      }
    });

    viewDirtyRef.current = false;
  }, [params]);

  // Read colours and attach window resize listener
  useEffect(() => {
    readColours();
    handleResize();

    const onWinResize = () => {
      viewDirtyRef.current = true;
      clearTrace();
    };
    window.addEventListener('resize', onWinResize);
    return () => {
      window.removeEventListener('resize', onWinResize);
    };
  }, [readColours, handleResize, clearTrace]);

  const updateCharts = useCallback(() => {
    const currentSim = simRef.current;
    if (!currentSim) return;
    const canvases = chartCanvasesRef.current;
    const C = coloursRef.current;
    const dpr = viewRef.current.dpr;

    const S = currentSim.settleLog;
    lineChart(
      canvases.cSettle,
      S.t,
      [
        { v: S.vm, c: C.s1 },
        { v: S.vx, c: C.s2 },
      ],
      {
        logy: true,
        hlines: [
          { y: currentSim.p.vMeanTol, c: C.s1 },
          { y: currentSim.p.vMaxTol, c: C.s2 },
        ],
        xu: ' s',
      },
      C,
      dpr
    );

    const L = currentSim.log;
    const T = L.t;
    const vl = [currentSim.tDriveStart, currentSim.tStop].filter(
      (v) => v !== null && v !== undefined
    );

    lineChart(
      canvases.cSinkX,
      L.dist.map((v) => v * 1e3),
      [{ v: L.sink, c: C.s1 }],
      { xu: ' mm', dec: 1 },
      C,
      dpr
    );

    lineChart(
      canvases.cSink,
      T,
      [{ v: L.sink, c: C.s1 }],
      { vlines: vl, xu: ' s', x0: 0, dec: 1 },
      C,
      dpr
    );

    lineChart(
      canvases.cSlip,
      T,
      [{ v: L.slip, c: C.s1 }],
      { vlines: vl, xu: ' s', x0: 0, lo: 0, hi: 1 },
      C,
      dpr
    );

    lineChart(
      canvases.cDP,
      T,
      [
        { v: L.dp, c: C.s2, w: 0.8, a: 0.35 },
        { v: smooth(L.dp), c: C.s2, w: 1.6 },
      ],
      { vlines: vl, xu: ' s', x0: 0, dec: 1 },
      C,
      dpr
    );

    lineChart(
      canvases.cTq,
      T,
      [
        { v: L.tq, c: C.s3, w: 0.8, a: 0.35 },
        { v: smooth(L.tq), c: C.s3, w: 1.6 },
      ],
      { vlines: vl, xu: ' s', x0: 0, dec: 3 },
      C,
      dpr
    );

    lineChart(
      canvases.cVel,
      T,
      [
        { v: L.vx, c: C.s1 },
        { v: L.vy, c: C.s2 },
      ],
      { vlines: vl, xu: ' s', x0: 0, dec: 3 },
      C,
      dpr
    );

    lineChart(
      canvases.cFy,
      T,
      [{ v: smooth(L.fy, 3), c: C.s4 }],
      {
        vlines: vl,
        xu: ' s',
        x0: 0,
        hlines: [{ y: currentSim.p.wheelMass * currentSim.p.g, c: C.muted }],
        dec: 1,
      },
      C,
      dpr
    );

    lineChart(
      canvases.cAir,
      T,
      [{ v: L.air, c: C.s2 }],
      { vlines: vl, xu: ' s', x0: 0, lo: 0, dec: 0 },
      C,
      dpr
    );

    const E = currentSim.events;
    histChart(
      canvases.cHist,
      E.map((e) => e.dx * 1e3),
      36,
      C,
      dpr
    );

    scatterChart(
      canvases.cBall,
      E.map((e) => e.tb),
      E.map((e) => e.tf),
      { oneToOne: true },
      C,
      dpr
    );

    scatterChart(
      canvases.cLaunch,
      E.map((e) => e.v0),
      E.map((e) => e.dx * 1e3),
      { dec: 1 },
      C,
      dpr
    );
  }, []);

  const handleBuildBed = () => {
    const v = validate(params, badInputs);
    if (v.E.length > 0) return;
    setErr(null);

    try {
      const newSim = new RoverDEM(Object.assign({}, params));
      simRef.current = newSim;
      setSim(newSim);
      setBedParams(Object.assign({}, params));
      setRunning(true);
      viewDirtyRef.current = true;
      clearTrace();
    } catch (e) {
      setErr(e.message);
      simRef.current = null;
      setSim(null);
    }
  };

  const handleRerun = () => {
    const currentSim = simRef.current;
    if (!currentSim || !currentSim.bedSnap || bedChanged(bedParams, params)) {
      handleBuildBed();
      return;
    }
    setErr(null);

    const wp = {};
    for (const s of SCHEMA) {
      if (s.k && s.lvl === 'wheel') wp[s.k] = params[s.k];
    }
    currentSim.rerun(wp);
    setSim(currentSim);
    setRunning(true);
    viewDirtyRef.current = true;
    clearTrace();
  };

  const handleRelease = () => {
    const currentSim = simRef.current;
    if (currentSim && currentSim.phase === 'ready') {
      const wp = {};
      for (const s of SCHEMA) {
        if (s.k && s.lvl === 'wheel') wp[s.k] = params[s.k];
      }
      Object.assign(currentSim.p, wp);
      currentSim.buildWheel();
      currentSim.releaseWheel();
      setSim(currentSim);
      setRunning(true);
      viewDirtyRef.current = true;
      clearTrace();
    }
  };

  const handleTogglePause = () => {
    const currentSim = simRef.current;
    if (!currentSim) return;
    if (currentSim.halted) {
      currentSim.halted = null;
      setRunning(true);
    } else {
      setRunning((prev) => !prev);
    }
  };

  const handleStep = () => {
    const currentSim = simRef.current;
    if (!currentSim) return;
    setRunning(false);
    if (currentSim.halted) currentSim.halted = null;
    try {
      for (let k = 0; k < 50; k++) {
        if (!currentSim.advance()) break;
      }
    } catch (e) {
      setErr(e.message);
    }
    setUiTick((t) => t + 1);
  };

  const handleParamChange = (k, v, isBad) => {
    setParams((prev) => ({ ...prev, [k]: v }));
    setBadInputs((prev) => ({ ...prev, [k]: isBad }));
  };

  const handleApplyPreset = (presetConfig) => {
    setParams((prev) => ({ ...prev, ...presetConfig }));
    setBadInputs({});
  };

  // Animation frame loop
  useEffect(() => {
    let animId;

    const frame = () => {
      const currentSim = simRef.current;
      if (running && currentSim && !err) {
        try {
          if (simSpeed === 'slow') {
            for (let k = 0; k < 20; k++) {
              if (!currentSim.advance()) {
                setRunning(false);
                break;
              }
            }
          } else {
            const t0 = performance.now();
            outer: while (performance.now() - t0 < 22) {
              for (let k = 0; k < 25; k++) {
                if (!currentSim.advance()) {
                  setRunning(false);
                  break outer;
                }
              }
            }
          }
        } catch (e) {
          setErr(e.message);
          setRunning(false);
        }
      }

      // Draw stage
      if (viewDirtyRef.current) handleResize();
      const cv = viewCanvasRef.current;
      if (cv) {
        const ctx = cv.getContext('2d');
        const tctx = traceCanvasRef.current?.getContext('2d');
        drawStage(
          ctx,
          tctx,
          traceCanvasRef.current,
          currentSim,
          params,
          coloursRef.current,
          colourMode,
          viewRef.current,
          cv.width,
          cv.height
        );
      }

      // Update UI & charts every 4 frames
      if (frameNoRef.current++ % 4 === 0) {
        updateCharts();
        setUiTick((t) => t + 1);
      }

      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animId);
  }, [running, simSpeed, colourMode, err, handleResize, updateCharts, params]);

  const checks = validate(params, badInputs);
  const isBedDifferent = !!(sim && bedParams && bedChanged(bedParams, params));
  const canBuild = checks.E.length === 0;
  const canRerun =
    checks.E.length === 0 &&
    !!sim &&
    !!sim.bedSnap &&
    !isBedDifferent;
  const canRelease = !!(sim && sim.phase === 'ready');

  return (
    <div className="wrap">
      <ControlSidebar
        params={params}
        badInputs={badInputs}
        onChange={handleParamChange}
        onApplyPreset={handleApplyPreset}
      />
      <main>
        <Toolbar
          running={running}
          canBuild={canBuild}
          canRerun={canRerun}
          canRelease={canRelease}
          simSpeed={simSpeed}
          colourMode={colourMode}
          onBuildBed={handleBuildBed}
          onRerun={handleRerun}
          onRelease={handleRelease}
          onTogglePause={handleTogglePause}
          onStep={handleStep}
          onChangeSpeed={setSimSpeed}
          onChangeColour={setColourMode}
          onExportCsv={() => downloadTimeSeriesCSV(sim)}
          onExportEjCsv={() => downloadEjectaCSV(sim)}
        />
        <StatusBanner sim={sim} err={err} />
        <ValidationChecks
          checks={checks}
          isBedDifferent={isBedDifferent}
        />
        <StageCanvas canvasRef={viewCanvasRef} />
        <ReadoutGrid sim={sim} />
        <ChartsGrid
          registerChartCanvas={(id, el) => {
            if (el) chartCanvasesRef.current[id] = el;
          }}
        />
      </main>
    </div>
  );
}
