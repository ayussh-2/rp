const SPEEDCOL = [
  '#b8b8b8',
  '#9a9a9a',
  '#7c7c7c',
  '#5e5e5e',
  '#3f3f3f',
  '#1c1c1c',
];

export function circles(c, xs, ys, rs, idx, col, view) {
  if (!idx.length) return;
  const PX = (x) => x * view.s;
  const PY = (y) => (view.yTop - y) * view.s;

  c.fillStyle = col;
  c.beginPath();
  for (const i of idx) {
    const px = PX(xs[i]);
    const py = PY(ys[i]);
    const pr = Math.max(rs[i] * view.s, 0.6);
    c.moveTo(px + pr, py);
    c.arc(px, py, pr, 0, 6.2832);
  }
  c.fill();
}

export function drawStage(
  ctx,
  tctx,
  traceCanvas,
  sim,
  params,
  colours,
  colourMode,
  view,
  width,
  height
) {
  const PX = (x) => x * view.s;
  const PY = (y) => (view.yTop - y) * view.s;

  ctx.fillStyle = colours.panel || '#f6f7f8';
  ctx.fillRect(0, 0, width, height);
  if (!sim) return;

  const p = sim.p;
  const N = sim.N;

  if (traceCanvas) {
    ctx.drawImage(traceCanvas, 0, 0);
  }

  // Boundaries
  ctx.strokeStyle = colours.muted || '#5b6571';
  ctx.lineWidth = 2 * view.dpr;
  ctx.beginPath();
  if (sim.periodic) {
    ctx.moveTo(PX(0), PY(0));
    ctx.lineTo(PX(p.L), PY(0));
  } else {
    ctx.moveTo(PX(0), PY(view.yTop));
    ctx.lineTo(PX(0), PY(0));
    ctx.lineTo(PX(p.L), PY(0));
    ctx.lineTo(PX(p.L), PY(view.yTop));
  }
  ctx.stroke();

  // Settled surface dashed line
  if (sim.surf) {
    ctx.strokeStyle = colours.muted || '#5b6571';
    ctx.lineWidth = view.dpr;
    ctx.setLineDash([5 * view.dpr, 4 * view.dpr]);
    ctx.beginPath();
    for (let k = 0; k <= 200; k++) {
      const xq = (p.L * k) / 200;
      const yq = sim.surfAt(xq);
      if (k) ctx.lineTo(PX(xq), PY(yq));
      else ctx.moveTo(PX(xq), PY(yq));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const g = [[], [], [], []];
  const bins = [[], [], [], [], [], []];
  const airOn = sim.tracking && sim.air;

  for (let i = 0; i < N; i++) {
    if (airOn && sim.air[i]) {
      g[3].push(i);
      continue;
    }
    if (colourMode === 'speed') {
      const v = Math.hypot(sim.vx[i], sim.vy[i]);
      bins[Math.min(5, Math.floor(v / 0.03))].push(i);
    } else if (sim.fine[i]) {
      g[2].push(i);
    } else {
      g[colourMode === 'plain' ? 0 : sim.layer[i]].push(i);
    }
  }

  if (colourMode === 'speed') {
    bins.forEach((b, k) =>
      circles(ctx, sim.x, sim.y, sim.r, b, SPEEDCOL[k], view)
    );
  } else {
    circles(ctx, sim.x, sim.y, sim.r, g[0], colours['reg-a'], view);
    circles(ctx, sim.x, sim.y, sim.r, g[1], colours['reg-b'], view);
    circles(ctx, sim.x, sim.y, sim.r, g[2], colours.fines, view);
  }
  circles(ctx, sim.x, sim.y, sim.r, g[3], colours.ejecta, view);

  // Ejecta flight trace
  if (g[3].length && tctx) {
    tctx.fillStyle = 'rgba(' + (colours.trace || '217, 128, 31') + ',0.28)';
    tctx.beginPath();
    for (const i of g[3]) {
      const px = PX(sim.x[i]);
      const py = PY(sim.y[i]);
      tctx.moveTo(px + 1.1 * view.dpr, py);
      tctx.arc(px, py, 1.1 * view.dpr, 0, 6.2832);
    }
    tctx.fill();
  }

  // Wheel
  if (sim.wheelOn) {
    const co = Math.cos(sim.th);
    const si = Math.sin(sim.th);
    const rp = p.rwp * view.s;
    const shifts = sim.periodic ? [0, -p.L, p.L] : [0];

    for (const sh of shifts) {
      const xc = sim.Xc + sh;
      if (xc + sim.Rtip < 0 || xc - sim.Rtip > p.L) continue;

      const dot = (lx, ly, col) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        for (let k = 0; k < lx.length; k++) {
          const px = PX(xc + co * lx[k] - si * ly[k]);
          const py = PY(sim.Yc + si * lx[k] + co * ly[k]);
          ctx.moveTo(px + rp, py);
          ctx.arc(px, py, rp, 0, 6.2832);
        }
        ctx.fill();
      };

      dot(sim.wvx, sim.wvy, colours['wheel-2']);
      dot(sim.wcx, sim.wcy, colours.wheel);

      // Rotation arrow
      if (Math.abs(sim.Wz) > 0) {
        const R0 = 0.55 * p.R * view.s;
        const cx = PX(xc);
        const cy = PY(sim.Yc);
        const ccw = sim.Wz > 0;
        ctx.strokeStyle = colours.ejecta;
        ctx.lineWidth = 2 * view.dpr;
        ctx.beginPath();
        const a0 = -2.4;
        const a1 = -0.8;
        ctx.arc(cx, cy, R0, a0, a1, false);
        ctx.stroke();

        const ae = ccw ? a0 : a1;
        const ex = cx + R0 * Math.cos(ae);
        const ey = cy + R0 * Math.sin(ae);
        const tdir = ccw ? -1 : 1;
        const tx = -Math.sin(ae) * tdir;
        const ty = Math.cos(ae) * tdir;
        const h = 6 * view.dpr;

        ctx.fillStyle = colours.ejecta;
        ctx.beginPath();
        ctx.moveTo(ex + tx * h, ey + ty * h);
        ctx.lineTo(ex - ty * h * 0.6, ey + tx * h * 0.6);
        ctx.lineTo(ex + ty * h * 0.6, ey - tx * h * 0.6);
        ctx.fill();
      }
    }
  }
}
