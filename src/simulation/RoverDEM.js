import { DEFAULTS } from '../constants/defaults.js';
import { mulberry32, triangular } from '../utils/math.js';

export const PHASE_SETTLING = 'settling';
export const PHASE_DRIVE = 'drive';

const SL = 12; // contact-history slots per grain

export class RoverDEM {
  constructor(params) {
    this.p = Object.assign({}, DEFAULTS, params);
    this.seedUsed =
      this.p.seed > 0
        ? Math.floor(this.p.seed)
        : 1 + Math.floor(Math.random() * 1e9);
    this.rng = mulberry32(this.seedUsed);
    this.periodic = this.p.boundary === 'periodic';
    this.hL = 0.5 * this.p.L;

    // Contact model physics: Young's Modulus E and Poisson's ratio nu
    if (this.p.E !== undefined && this.p.nu !== undefined) {
      const nu = this.p.nu;
      this.kn = this.p.E / (1 - nu * nu);
      this.kt = this.kn * ((1 - nu) / (1 - 0.5 * nu));
    } else {
      this.kn = this.p.kn;
      this.kt = (this.p.ktRatio || 0.5) * this.kn;
    }

    // Cohesion in Pa (input parameter in kN/m²)
    this.cohesionPa = (this.p.cohesion || 0) * 1000;

    // Fast-settling vs benchmark physics settings
    this.dtBenchmark = this.p.dtBenchmark || this.p.dt || 1.5e-5;
    this.dtSettling = this.p.dtSettling || 3.0e-5;
    this.enBenchmark = this.p.enBenchmark || this.p.en || 0.30;
    this.enSettling = this.p.enSettling !== undefined ? this.p.enSettling : 0.01;

    const leBench = Math.log(Math.max(this.enBenchmark, 1e-3));
    this.beta2Benchmark =
      2 * (-leBench / Math.sqrt(leBench * leBench + Math.PI * Math.PI));

    const leSettle = Math.log(Math.max(this.enSettling, 1e-3));
    this.beta2Settling =
      2 * (-leSettle / Math.sqrt(leSettle * leSettle + Math.PI * Math.PI));

    this.buildWheel();
    this.buildBed();
  }

  mi(dx) {
    if (!this.periodic) return dx;
    if (dx > this.hL) return dx - this.p.L;
    if (dx < -this.hL) return dx + this.p.L;
    return dx;
  }

  wrap(x) {
    if (!this.periodic) return x;
    const L = this.p.L;
    let wx = x % L;
    return wx < 0 ? wx + L : wx;
  }

  buildWheel() {
    const p = this.p;
    const R = p.R;
    const rp = p.rwp;
    const Rc = R - rp;
    const cx = [];
    const cy = [];
    const n = Math.max(8, Math.ceil((2 * Math.PI * Rc) / rp));

    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      cx.push(Rc * Math.cos(a));
      cy.push(Rc * Math.sin(a));
    }

    this.nRim = n;
    this.Rtip = R;
    const nrad = Math.floor(p.hGrouser / rp + 1e-9);

    if (p.nGrousers > 0 && nrad > 0) {
      for (let k = 0; k < p.nGrousers; k++) {
        const a = (2 * Math.PI * k) / p.nGrousers + Math.PI / p.nGrousers;
        for (let q = 1; q <= nrad; q++) {
          cx.push((Rc + q * rp) * Math.cos(a));
          cy.push((Rc + q * rp) * Math.sin(a));
        }
      }
      this.Rtip = Rc + nrad * rp + rp;
    }

    this.nGrouserPts = cx.length - n;
    this.wcx = Float64Array.from(cx);
    this.wcy = Float64Array.from(cy);
    this.Nw = cx.length;
    this.wrx = new Float64Array(this.Nw);
    this.wry = new Float64Array(this.Nw);
    this.wpx = new Float64Array(this.Nw);
    this.wpy = new Float64Array(this.Nw);

    // Compute exact vertical offset from wheel center to the lowest particle bottom
    let minRelY = 0;
    for (let k = 0; k < cx.length; k++) {
      const yBot = cy[k] - rp;
      if (yBot < minRelY) minRelY = yBot;
    }
    this.bottomOffset = -minRelY;

    const vx = [];
    const vy = [];
    const Rh = Math.max(p.hubFrac * R, rp);
    const nh = Math.max(6, Math.ceil((2 * Math.PI * Rh) / rp));

    for (let k = 0; k < nh; k++) {
      const a = (2 * Math.PI * k) / nh;
      vx.push(Rh * Math.cos(a));
      vy.push(Rh * Math.sin(a));
    }

    for (let k = 0; k < p.nSpokes; k++) {
      const a = (2 * Math.PI * k) / p.nSpokes;
      for (let rr = Rh + rp; rr < Rc - 0.5 * rp; rr += rp) {
        vx.push(rr * Math.cos(a));
        vy.push(rr * Math.sin(a));
      }
    }

    this.wvx = Float64Array.from(vx);
    this.wvy = Float64Array.from(vy);

    if (this.next && this.N) {
      this.next = new Int32Array(this.N + this.Nw + 8);
    }
  }

  buildBed() {
    const p = this.p;
    const rng = this.rng;
    const useFastSettling = p.fastSettling !== false;

    let X = [];
    let Y = [];
    let R = [];
    let F = [];

    if (useFastSettling) {
      // 1. Optimal Dense Spawning:
      // Spawn grains in a tightly packed staggered hexagonal grid starting immediately
      // at the bottom and filling up to the target bed height H (0.14 m).
      const targetN = p.targetGrains || 5000;
      const rGrain = p.rMin || 2.0e-3;
      const dGrain = 2 * rGrain;
      const clearance = 1.005; // slight clearance prevents artificial initial overlap/strain
      const sx0 = dGrain * clearance;
      let nCols, dx, xs;

      if (this.periodic) {
        nCols = Math.max(3, Math.floor(p.L / sx0));
        dx = p.L / nCols;
        xs = 0.5 * dx;
      } else {
        nCols = Math.max(1, Math.floor((p.L - 2.4 * rGrain) / sx0) + 1);
        dx = (p.L - 2.4 * rGrain) / nCols;
        xs = 1.2 * rGrain;
      }

      const nRows = Math.ceil(targetN / nCols);
      // Span rows from bottom wall (y = rGrain) up to target bed height H (0.14 m)
      const dy = (p.H - rGrain) / Math.max(1, nRows - 1);

      for (let row = 0; row < nRows && X.length < targetN; row++) {
        const yPos = rGrain + row * dy;
        const xOffset = (row % 2 === 1) ? 0.5 * dx : 0;
        for (let col = 0; col < nCols && X.length < targetN; col++) {
          let xPos = xs + col * dx + xOffset;
          if (this.periodic) {
            xPos = this.wrap(xPos);
          }
          X.push(xPos);
          Y.push(yPos);
          R.push(rGrain);
          F.push(0);
        }
      }

      this.yGenTop = p.H + rGrain;
    } else {
      // Legacy deposition fallback
      const big = Math.max(p.rMax, p.rMin, p.rFine || p.rMin);
      const s0 = 2 * big * 1.05;
      let nCol, s, xs;

      if (this.periodic) {
        nCol = Math.max(3, Math.floor(p.L / s0));
        s = p.L / nCol;
        xs = 0.5 * s;
      } else {
        nCol = Math.max(1, Math.floor((p.L - 2.4 * big) / s0) + 1);
        s = s0;
        xs = 1.2 * big;
      }

      const targetPhi =
        p.targetBulkDensity && p.rho
          ? p.targetBulkDensity / p.rho
          : 1 - (p.por || 0.46);
      const target = (p.level ? 1.2 : 1.0) * p.L * p.H * targetPhi;
      let area = 0;
      let yrow = 1.2 * big;

      const isUniform =
        p.rMin === p.rMax ||
        p.finesFrac === 0 ||
        (p.rMin === p.rMean && p.rMean === p.rMax);

      while (area < target) {
        for (let c = 0; c < nCol; c++) {
          let rr;
          let isF = false;
          if (isUniform) {
            rr = p.rMin;
          } else {
            isF = rng() < p.finesFrac;
            rr = isF ? p.rFine : triangular(rng(), p.rMin, p.rMean, p.rMax);
          }
          X.push(this.wrap(xs + c * s + (rng() - 0.5) * 0.06 * s));
          Y.push(yrow + (rng() - 0.5) * 0.03 * s);
          R.push(rr);
          F.push(isF ? 1 : 0);
          area += Math.PI * rr * rr;
        }
        yrow += s;
        if (X.length > 300000) {
          throw new Error(
            'More than 300 000 grains requested. Reduce the bed size or increase grain radii.'
          );
        }
      }
      this.yGenTop = yrow + big;
    }

    this.setParticles(X, Y, R, F);

    for (let i = 0; i < this.N; i++) {
      this.vx[i] = (rng() - 0.5) * 1e-4;
      this.vy[i] = 0;
      this.w[i] = 0;
    }

    if (useFastSettling) {
      this.phase = PHASE_SETTLING;
      this.dt = this.dtSettling;
      this.en = this.enSettling;
      this.beta2 = this.beta2Settling;
    } else {
      this.phase = 'deposit';
      this.dt = this.dtBenchmark;
      this.en = this.enBenchmark;
      this.beta2 = this.beta2Benchmark;
    }

    this.walls = this.periodic
      ? [[0, 0, p.L, 0]]
      : [
          [0, 0, p.L, 0],
          [0, 0, 0, 50],
          [p.L, 0, p.L, 50],
        ];

    this.t = 0;
    this.tPhase = 0;
    this.kPhase = 0;
    this.hold = 0;
    this.extend = 1;
    this.wheelOn = false;
    this.halted = null;
    this.totalEk = 0;
    this.settleLog = { t: [], vm: [], vx: [], ek: [] };
    this.resetWheelLogs();
  }

  setParticles(X, Y, R, F) {
    const N = X.length;
    this.N = N;
    const A = () => new Float64Array(N);

    this.x = Float64Array.from(X);
    this.xu = Float64Array.from(X);
    this.y = Float64Array.from(Y);
    this.r = Float64Array.from(R);
    this.vx = A();
    this.vy = A();
    this.w = A();
    this.m = A();
    this.I = A();
    this.fx = A();
    this.fy = A();
    this.tq = A();
    this.nc = new Uint16Array(N);
    this.fine = Uint8Array.from(F);
    this.layer = new Uint8Array(N);

    for (let i = 0; i < N; i++) {
      const r = this.r[i];
      this.m[i] = this.p.rho * Math.PI * r * r;
      this.I[i] = 0.5 * this.m[i] * r * r;
    }

    this.hP = new Int32Array(N * SL);
    this.hS = new Float64Array(N * SL);
    this.hC = new Uint8Array(N);
    this.nP = new Int32Array(N * SL);
    this.nS = new Float64Array(N * SL);
    this.nC = new Uint8Array(N);
    this.next = new Int32Array(N + this.Nw + 8);
  }

  resetWheelLogs() {
    this.log = {
      t: [],
      dist: [],
      sink: [],
      slip: [],
      dp: [],
      tq: [],
      fy: [],
      dp3D: [],
      tq3D: [],
      fy3D: [],
      vx: [],
      vy: [],
      air: [],
      wheelY: [],
    };
    this.events = [];
    this.nextLog = 0;
    this.facc = [0, 0, 0];
    this.nacc = 0;
    this.ev = {
      n: 0,
      sumAbs: 0,
      maxAbs: 0,
      maxTf: 0,
      rear: 0,
      maxApex: 0,
    };
    this.settleTime = null;
    this.nAir = 0;
    this.tracking = false;
    this.FW = [0, 0, 0];
    this.nWc = 0;
    this.stopReason = '';
    this.tDriveStart = null;
    this.tStop = null;
    this.wheelRestHeight = null;
    this.staticSinkage = null;
  }

  kernel(i, j, nx, ny, ov, vrx, vry, meff, mu, rStar = 0) {
    const tx = -ny;
    const ty = nx;
    const vn = vrx * nx + vry * ny;
    const vt = vrx * tx + vry * ty;

    // JKR cohesive contact attraction
    let f_adh = 0;
    if (this.cohesionPa > 0 && rStar > 0) {
      f_adh = this.cohesionPa * 2 * rStar;
    }

    // Temporary heavy damping during PHASE_SETTLING, benchmark restitution otherwise
    const beta2 =
      this.phase === PHASE_SETTLING
        ? this.beta2Settling
        : this.beta2Benchmark;

    let fn = this.kn * ov - f_adh + beta2 * Math.sqrt(meff * this.kn) * vn;
    if (fn < -f_adh) fn = -f_adh;

    const b = i * SL;
    const hc = this.hC[i];
    let s0 = 0;

    for (let k = 0; k < hc; k++) {
      if (this.hP[b + k] === j) {
        s0 = this.hS[b + k];
        break;
      }
    }

    let st = s0 + vt * this.dt;
    let ft = -this.kt * st - beta2 * Math.sqrt(meff * this.kt) * vt;
    const lim = mu * Math.max(0, fn + f_adh);

    if (Math.abs(ft) > lim) {
      ft = Math.sign(ft) * lim;
      st = -ft / this.kt;
    }

    const c = this.nC[i];
    if (c < SL) {
      this.nP[b + c] = j;
      this.nS[b + c] = st;
      this.nC[i] = c + 1;
    }

    this._fn = fn;
    this._ft = ft;
  }

  step(g, mu, alpha) {
    const p = this.p;
    const N = this.N;
    const dt = this.dt;
    const muR = p.muR;
    const L = p.L;
    const per = this.periodic;
    const hL = this.hL;
    const x = this.x;
    const y = this.y;
    const vx = this.vx;
    const vy = this.vy;
    const w = this.w;
    const r = this.r;
    const m = this.m;
    const I = this.I;
    const fx = this.fx;
    const fy = this.fy;
    const tq = this.tq;
    const nc = this.nc;

    fx.fill(0);
    fy.fill(0);
    tq.fill(0);
    nc.fill(0);
    this.nC.fill(0);

    let FWx = 0;
    let FWy = 0;
    let TW = 0;
    let nWc = 0;

    const Vx = this.Vx;
    const Vy = this.Vy;
    const Wz = this.Wz;
    let nTot = N;

    if (this.wheelOn) {
      const co = Math.cos(this.th);
      const si = Math.sin(this.th);
      for (let k = 0; k < this.Nw; k++) {
        const rx = co * this.wcx[k] - si * this.wcy[k];
        const ry = si * this.wcx[k] + co * this.wcy[k];
        this.wrx[k] = rx;
        this.wry[k] = ry;
        this.wpx[k] = this.wrap(this.Xc + rx);
        this.wpy[k] = this.Yc + ry;
      }
      nTot = N + this.Nw;
    }

    const cs = 2 * Math.max(p.rMax, p.rFine, p.rwp) * 1.02;
    let ymin = Infinity;
    let ymax = -Infinity;

    for (let i = 0; i < N; i++) {
      if (y[i] < ymin) ymin = y[i];
      if (y[i] > ymax) ymax = y[i];
    }

    if (this.wheelOn) {
      ymin = Math.min(ymin, this.Yc - this.Rtip);
      ymax = Math.max(ymax, this.Yc + this.Rtip);
    }

    if (!isFinite(ymax) || ymax - ymin > 100) {
      throw new Error(
        'Grains left the domain: numerical instability. Lower the time-step factor or raise kn.'
      );
    }

    let nxC, csx, gx0;
    if (per) {
      nxC = Math.floor(L / cs);
      if (nxC < 3) {
        throw new Error('Bed length must exceed three largest-grain diameters.');
      }
      csx = L / nxC;
      gx0 = 0;
    } else {
      csx = cs;
      gx0 = -cs;
      nxC = Math.ceil((L + 2 * cs) / cs) + 2;
    }

    const gy0 = ymin - cs;
    const nyC = Math.floor((ymax - gy0) / cs) + 3;
    const nCell = nxC * nyC;

    if (!this.head || this.head.length < nCell) {
      this.head = new Int32Array(nCell * 2);
    }

    const head = this.head;
    const next = this.next;
    head.fill(-1, 0, nCell);

    for (let id = 0; id < nTot; id++) {
      const px = id < N ? x[id] : this.wpx[id - N];
      const py = id < N ? y[id] : this.wpy[id - N];
      let ci = Math.floor((px - gx0) / csx);
      if (ci < 0) ci = 0;
      else if (ci >= nxC) ci = nxC - 1;
      const c = ci + Math.floor((py - gy0) / cs) * nxC;
      next[id] = head[c];
      head[c] = id;
    }

    const muW = p.muWheel;
    const wcr = p.rwp;

    for (let i = 0; i < N; i++) {
      let ci = Math.floor((x[i] - gx0) / csx);
      if (ci < 0) ci = 0;
      else if (ci >= nxC) ci = nxC - 1;
      const cj = Math.floor((y[i] - gy0) / cs);

      for (let oy = -1; oy <= 1; oy++) {
        const yy = cj + oy;
        if (yy < 0 || yy >= nyC) continue;
        for (let ox = -1; ox <= 1; ox++) {
          let xx = ci + ox;
          if (per) {
            if (xx < 0) xx += nxC;
            else if (xx >= nxC) xx -= nxC;
          } else if (xx < 0 || xx >= nxC) continue;

          for (let j = head[xx + yy * nxC]; j !== -1; j = next[j]) {
            if (j < N) {
              if (j <= i) continue;
              let dx = x[j] - x[i];
              if (per) {
                if (dx > hL) dx -= L;
                else if (dx < -hL) dx += L;
              }
              const dy = y[j] - y[i];
              const rs = r[i] + r[j];
              const d2 = dx * dx + dy * dy;
              if (d2 >= rs * rs) continue;

              const d = Math.sqrt(d2);
              const nx = dx / d;
              const ny = dy / d;
              const wr = w[i] * r[i] + w[j] * r[j];
              const rStar = (r[i] * r[j]) / (r[i] + r[j]);

              this.kernel(
                i,
                j,
                nx,
                ny,
                rs - d,
                vx[i] - vx[j] - wr * ny,
                vy[i] - vy[j] + wr * nx,
                (m[i] * m[j]) / (m[i] + m[j]),
                mu,
                rStar
              );

              const fn = this._fn;
              const ft = this._ft;
              const Fx = -fn * nx - ft * ny;
              const Fy = -fn * ny + ft * nx;

              fx[i] += Fx;
              fy[i] += Fy;
              fx[j] -= Fx;
              fy[j] -= Fy;

              let Mr = 0;
              const wrel = w[i] - w[j];
              if (muR > 0 && wrel !== 0) {
                const Ie = (I[i] * I[j]) / (I[i] + I[j]);
                Mr =
                  -Math.sign(wrel) *
                  Math.min(
                    muR * ((r[i] * r[j]) / rs) * fn,
                    (0.5 * Ie * Math.abs(wrel)) / dt
                  );
              }

              tq[i] += r[i] * ft + Mr;
              tq[j] += r[j] * ft - Mr;
              nc[i]++;
              nc[j]++;
            } else {
              const k = j - N;
              let dx = this.wpx[k] - x[i];
              if (per) {
                if (dx > hL) dx -= L;
                else if (dx < -hL) dx += L;
              }
              const dy = this.wpy[k] - y[i];
              const rs = r[i] + wcr;
              const d2 = dx * dx + dy * dy;
              if (d2 >= rs * rs) continue;

              const d = Math.sqrt(d2);
              const nx = dx / d;
              const ny = dy / d;
              const rx = this.wrx[k];
              const ry = this.wry[k];
              const vkx = Vx - Wz * ry;
              const vky = Vy + Wz * rx;
              const wr = w[i] * r[i] + Wz * wcr;
              const rStar = (r[i] * wcr) / (r[i] + wcr);

              this.kernel(
                i,
                j,
                nx,
                ny,
                rs - d,
                vx[i] - vkx - wr * ny,
                vy[i] - vky + wr * nx,
                m[i],
                muW,
                rStar
              );

              const fn = this._fn;
              const ft = this._ft;
              const Fx = -fn * nx - ft * ny;
              const Fy = -fn * ny + ft * nx;

              fx[i] += Fx;
              fy[i] += Fy;
              tq[i] += r[i] * ft;
              nc[i]++;
              nWc++;

              const qx = rx - wcr * nx;
              const qy = ry - wcr * ny;
              FWx -= Fx;
              FWy -= Fy;
              TW += -qx * Fy + qy * Fx;
            }
          }
        }
      }
    }

    const walls = this.walls;
    const wb = N + this.Nw;

    for (let i = 0; i < N; i++) {
      const xi = x[i];
      const yi = y[i];
      const ri = r[i];

      for (let q = 0; q < walls.length; q++) {
        const s = walls[q];
        const ex = s[2] - s[0];
        const ey = s[3] - s[1];
        let u =
          ((xi - s[0]) * ex + (yi - s[1]) * ey) / (ex * ex + ey * ey);
        if (u < 0) u = 0;
        else if (u > 1) u = 1;

        const dx = s[0] + u * ex - xi;
        const dy = s[1] + u * ey - yi;
        const d2 = dx * dx + dy * dy;
        if (d2 >= ri * ri) continue;

        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const rStar = ri;

        this.kernel(
          i,
          wb + q,
          nx,
          ny,
          ri - d,
          vx[i] - w[i] * ri * ny,
          vy[i] + w[i] * ri * nx,
          m[i],
          p.muWall,
          rStar
        );

        const fn = this._fn;
        const ft = this._ft;
        fx[i] += -fn * nx - ft * ny;
        fy[i] += -fn * ny + ft * nx;

        let Mr = 0;
        if (muR > 0 && w[i] !== 0) {
          Mr =
            -Math.sign(w[i]) *
            Math.min(muR * ri * fn, (0.5 * I[i] * Math.abs(w[i])) / dt);
        }
        tq[i] += ri * ft + Mr;
        nc[i]++;
      }
    }

    let a1 = this.hP;
    this.hP = this.nP;
    this.nP = a1;

    let a2 = this.hS;
    this.hS = this.nS;
    this.nS = a2;

    let a3 = this.hC;
    this.hC = this.nC;
    this.nC = a3;

    const xu = this.xu;
    const isSettling = this.phase === PHASE_SETTLING;
    const settleDamp =
      p.settlingVelocityDamping !== undefined
        ? p.settlingVelocityDamping
        : 0.85;
    const bgDamp =
      p.backgroundDamping !== undefined
        ? p.backgroundDamping
        : p.damping !== undefined
        ? p.damping
        : 0.995;
    const applyBgDamp = bgDamp > 0 && bgDamp < 1;

    for (let i = 0; i < N; i++) {
      let Fx = fx[i];
      let Fy = fy[i] - m[i] * g;
      let T = tq[i];

      if (alpha > 0) {
        Fx -= alpha * Math.abs(Fx) * Math.sign(vx[i]);
        Fy -= alpha * Math.abs(Fy) * Math.sign(vy[i]);
        T -= alpha * Math.abs(T) * Math.sign(w[i]);
      }

      vx[i] += (Fx / m[i]) * dt;
      vy[i] += (Fy / m[i]) * dt;
      w[i] += (T / I[i]) * dt;

      // Heavy global velocity damping multiplier during PHASE_SETTLING
      if (isSettling) {
        vx[i] *= settleDamp;
        vy[i] *= settleDamp;
        w[i] *= settleDamp;
      }

      // Continuous background damping factor to bleed off accumulating numerical errors
      if (applyBgDamp) {
        vx[i] *= bgDamp;
        vy[i] *= bgDamp;
        w[i] *= bgDamp;
      }

      const ddx = vx[i] * dt;
      xu[i] += ddx;
      x[i] += ddx;
      y[i] += vy[i] * dt;

      if (per) {
        if (x[i] >= L) x[i] -= L;
        else if (x[i] < 0) x[i] += L;
      }
    }

    this.FW[0] = FWx;
    this.FW[1] = FWy;
    this.FW[2] = TW;
    this.nWc = nWc;

    this.t += dt;
    this.tPhase += dt;
    this.kPhase++;
  }

  speeds() {
    let s = 0;
    let v = 0;
    for (let i = 0; i < this.N; i++) {
      const q = Math.hypot(this.vx[i], this.vy[i]);
      s += q;
      if (q > v) v = q;
    }
    return [s / this.N, v];
  }

  computeTotalKineticEnergy() {
    let Ek = 0;
    const N = this.N;
    const m = this.m;
    const I = this.I;
    const vx = this.vx;
    const vy = this.vy;
    const w = this.w;
    for (let i = 0; i < N; i++) {
      Ek +=
        0.5 * m[i] * (vx[i] * vx[i] + vy[i] * vy[i]) + 0.5 * I[i] * w[i] * w[i];
    }
    return Ek;
  }

  settledCheck(tMin) {
    const p = this.p;
    const [vm, vmax] = this.speeds();
    this.settleLog.t.push(this.t);
    this.settleLog.vm.push(vm);
    this.settleLog.vx.push(vmax);
    this.vmNow = vm;
    this.vxNow = vmax;

    if (this.tPhase >= tMin && vm < p.vMeanTol && vmax < p.vMaxTol) {
      this.hold += 100 * this.dt;
    } else {
      this.hold = 0;
    }

    return this.hold >= p.tHold;
  }

  trim() {
    const X = [];
    const Y = [];
    const R = [];
    const F = [];
    const VX = [];
    const VY = [];
    const W = [];

    for (let i = 0; i < this.N; i++) {
      if (this.y[i] <= this.p.H) {
        X.push(this.x[i]);
        Y.push(this.y[i]);
        R.push(this.r[i]);
        F.push(this.fine[i]);
        VX.push(this.vx[i]);
        VY.push(this.vy[i]);
        W.push(this.w[i]);
      }
    }

    this.nRemoved = this.N - X.length;
    this.setParticles(X, Y, R, F);
    this.vx.set(VX);
    this.vy.set(VY);
    this.w.set(W);
  }

  finishBed() {
    const p = this.p;
    const N = this.N;
    this.tBedReady = this.t;
    const layerH = Math.max(p.H / 8, 4 * p.rMax);

    for (let i = 0; i < N; i++) {
      this.layer[i] = Math.floor(this.y[i] / layerH) % 2;
    }

    const nb = Math.max(4, Math.floor(p.L / (2 * p.rMax)));
    const bw = p.L / nb;
    const raw = new Float64Array(nb).fill(NaN);

    for (let i = 0; i < N; i++) {
      const b = Math.min(nb - 1, Math.max(0, Math.floor(this.x[i] / bw)));
      const top = this.y[i] + this.r[i];
      if (!(raw[b] >= top)) raw[b] = top;
    }

    for (let b = 0; b < nb; b++) {
      if (isNaN(raw[b])) raw[b] = b > 0 ? raw[b - 1] : p.H;
    }

    const sm = new Float64Array(nb);
    for (let b = 0; b < nb; b++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        let q = b + k;
        if (this.periodic) q = (q + nb) % nb;
        else q = Math.min(nb - 1, Math.max(0, q));
        s += raw[q];
      }
      sm[b] = s / 5;
    }

    this.surf = sm;
    this.surfBw = bw;
    const sorted = Array.from(sm).sort((a, b) => a - b);
    this.Hs = sorted[Math.floor(nb / 2)];

    const x0 = this.periodic ? 0 : 0.1 * p.L;
    const x1 = this.periodic ? p.L : 0.9 * p.L;
    const y0 = 2 * p.rMax;
    const y1 = this.Hs - 3 * p.rMax;
    let a = 0;

    for (let i = 0; i < N; i++) {
      const xi = this.x[i];
      const yi = this.y[i];
      if (xi > x0 && xi < x1 && yi > y0 && yi < y1) {
        a += Math.PI * this.r[i] * this.r[i];
      }
    }

    this.porosity = y1 > y0 ? 1 - a / ((x1 - x0) * (y1 - y0)) : NaN;
    this.bedSnap = {
      x: this.x.slice(),
      y: this.y.slice(),
      r: this.r.slice(),
      f: this.fine.slice(),
      layer: this.layer.slice(),
      surf: sm.slice(),
      surfBw: bw,
      Hs: this.Hs,
      porosity: this.porosity,
      t: this.t,
    };

    for (let i = 0; i < N; i++) {
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.w[i] = 0;
    }

    this.phase = 'ready';
  }

  surfAt(xq) {
    const nb = this.surf.length;
    let b = xq / this.surfBw - 0.5;

    if (this.periodic) {
      b = ((b % nb) + nb) % nb;
      const k = Math.floor(b);
      const f = b - k;
      return this.surf[k] * (1 - f) + this.surf[(k + 1) % nb] * f;
    }

    if (b <= 0) return this.surf[0];
    if (b >= nb - 1) return this.surf[nb - 1];
    const k = Math.floor(b);
    const f = b - k;
    return this.surf[k] * (1 - f) + this.surf[k + 1] * f;
  }

  releaseWheel() {
    const p = this.p;
    this.dir = p.direction === 'cw' ? 1 : -1;
    const x0 = p.x0 >= 0 ? p.x0 : this.dir > 0 ? 0.25 * p.L : 0.75 * p.L;
    this.Xc = this.wrap(x0);
    this.Xu = this.Xc;
    this.X0 = this.Xc;

    // 1. Surface Spawn Position:
    // The lowest point of the wheel (tip of bottom-most grouser) spawns
    // exactly touching the top of the settled soil bed (~H = 0.14 m) without overlap.
    const botOffset = this.bottomOffset || this.Rtip;
    const drop =
      p.dropHeight !== undefined && p.dropHeight > 0 ? p.dropHeight : 0;

    let surfaceY =
      this.surf && this.surf.length > 0
        ? this.surfAt(this.Xc)
        : this.Hs || p.H;

    // Check grain surface directly under the wheel contact patch at Xc to ensure zero-penetration spawn
    if (this.x && this.y && this.N > 0) {
      let maxNear = -Infinity;
      const rwp = p.rwp || 0.002;
      for (let i = 0; i < this.N; i++) {
        const dx = Math.abs(this.mi(this.x[i] - this.Xc));
        if (dx < (this.r[i] + rwp)) {
          const top =
            this.y[i] +
            Math.sqrt(Math.max(0, Math.pow(this.r[i] + rwp, 2) - dx * dx));
          if (top > maxNear) maxNear = top;
        }
      }
      if (maxNear > -Infinity && isFinite(maxNear)) {
        surfaceY = maxNear;
      }
    }

    this.Yc = surfaceY + botOffset + drop;
    this.wheelSpawnSurface = surfaceY;
    this.wheelSpawnYc = this.Yc;

    this.Vx = 0;
    this.Vy = 0;
    this.Wz = 0;
    this.th = 0;
    this.om = 0;
    this.wheelOn = true;
    this.tRelease = this.t;
    this.tPhase = 0;
    this.phase = 'drop'; // Static settling phase
    this.staticSettleT = 0;
    this.contactSeen = false;
    this.restHold = 0;
    this.restT = 0;
    this.resetWheelLogs();

    const N = this.N;
    this.prevAir = new Uint8Array(N);
    this.tL = new Float64Array(N).fill(NaN);
    this.xL = new Float64Array(N);
    this.yL = new Float64Array(N);
    this.vxL = new Float64Array(N);
    this.vyL = new Float64Array(N);
    this.ymx = new Float64Array(N);
    this.air = new Uint8Array(N);
  }

  transitionToDrivePhase() {
    const p = this.p;

    // 1. CRITICAL: Snap time step back to benchmark (1.5e-5 s)
    this.dt = this.dtBenchmark;

    // 2. CRITICAL: Restore benchmark Coefficient of Restitution to 0.30
    this.en = this.enBenchmark;
    this.beta2 = this.beta2Benchmark;

    // 3. Remove artificial global damping: exiting PHASE_SETTLING removes damping multiplier

    // 4. Level bed if requested & finalize surface geometry
    if (p.level) this.trim();
    this.finishBed();

    // 5. Zero residual velocities so bed starts in quiescent state
    for (let i = 0; i < this.N; i++) {
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.w[i] = 0;
    }

    // 6. Introduce wheel at surface and allow to settle statically under gravity for 1.0 s
    if (p.autoRelease) {
      this.releaseWheel();
    } else {
      this.phase = 'ready';
    }
  }

  rerun(params) {
    const s = this.bedSnap;
    Object.assign(this.p, params);
    if (this.p.E !== undefined && this.p.nu !== undefined) {
      const nu = this.p.nu;
      this.kn = this.p.E / (1 - nu * nu);
      this.kt = this.kn * ((1 - nu) / (1 - 0.5 * nu));
    }
    this.cohesionPa = (this.p.cohesion || 0) * 1000;
    if (this.p.dt !== undefined && this.p.dt > 0) {
      this.dt = this.p.dt;
    }
    this.buildWheel();
    this.setParticles(s.x, s.y, s.r, s.f);
    this.layer.set(s.layer);
    this.surf = s.surf.slice();
    this.surfBw = s.surfBw;
    this.Hs = s.Hs;
    this.porosity = s.porosity;
    this.t = s.t;
    this.halted = null;
    this.phase = 'ready';
    this.wheelOn = false;
    this.resetWheelLogs();
  }

  driveLimitHit() {
    const p = this.p;
    if (!this.periodic) {
      if (this.dir > 0 && this.Xc + this.Rtip > p.L - 0.01) {
        this.stopReason = 'Wheel reached the right wall.';
        return true;
      }
      if (this.dir < 0 && this.Xc - this.Rtip < 0.01) {
        this.stopReason = 'Wheel reached the left wall.';
        return true;
      }
    } else if (
      p.stopBeforeLap &&
      Math.abs(this.Xu - this.X0) > p.L - 2 * this.Rtip - 0.01
    ) {
      this.stopReason =
        'Stopped before the wheel re-entered its own rut (periodic bed).';
      return true;
    }
    return false;
  }

  advance() {
    const p = this.p;
    if (this.halted || this.phase === 'done') return false;

    // Fast-Settling Phase: Relaxed dt, heavy kinetic damping, kinetic energy monitoring
    if (this.phase === PHASE_SETTLING) {
      this.step(p.depositEarth ? 9.81 : p.g, p.muPrep, p.alphaPrep);
      const Ek = this.computeTotalKineticEnergy();
      this.totalEk = Ek;
      const [vm, vmax] = this.speeds();
      this.vmNow = vm;
      this.vxNow = vmax;

      if (this.kPhase % 20 === 0) {
        this.settleLog.t.push(this.t);
        this.settleLog.vm.push(vm);
        this.settleLog.vx.push(vmax);
        if (this.settleLog.ek) this.settleLog.ek.push(Ek);
      }

      // Constantly monitor total kinetic energy of the soil bed
      const ekThreshold =
        p.ekSettlingTol !== undefined ? p.ekSettlingTol : 1.0e-5;
      if (
        this.tPhase >= (p.tSettleMin || 0.01) &&
        (Ek < ekThreshold || (vm < p.vMeanTol && vmax < p.vMaxTol))
      ) {
        this.transitionToDrivePhase();
      } else if (this.tPhase > p.tSettleMax * this.extend) {
        this.halted =
          'Settling has not met the kinetic energy criteria (' +
          Ek.toExponential(2) +
          ' J vs tol ' +
          ekThreshold.toExponential(2) +
          ' J) after ' +
          this.tPhase.toFixed(2) +
          ' s. Press Resume to continue settling.';
        this.extend++;
        return false;
      }
      return true;
    }

    if (this.phase === 'deposit') {
      this.step(p.depositEarth ? 9.81 : p.g, p.muPrep, p.alphaPrep);
      if (this.kPhase % 100 === 0) {
        if (this.settledCheck(p.tSettleMin)) {
          this.tDeposit = this.tPhase;
          if (p.level) this.trim();
          this.phase = 'final';
          this.tPhase = 0;
          this.kPhase = 0;
          this.hold = 0;
        } else if (this.tPhase > p.tSettleMax * this.extend) {
          this.halted =
            'Deposition has not met the settling criteria after ' +
            this.tPhase.toFixed(2) +
            ' s. Press Resume to continue settling, or relax the tolerances.';
          this.extend++;
          return false;
        }
      }
      return true;
    }

    if (this.phase === 'final') {
      this.step(p.g, p.mu, 0);
      if (this.kPhase % 100 === 0) {
        if (this.settledCheck(0.1)) this.finishBed();
        else if (this.tPhase > p.tSettleMax * this.extend) {
          this.halted =
            'Final settling under the test gravity has not met the criteria after ' +
            this.tPhase.toFixed(2) +
            ' s. Press Resume to continue.';
          this.extend++;
          return false;
        }
      }
      return true;
    }

    if (this.phase === 'ready') {
      if (p.autoRelease) {
        this.releaseWheel();
        return true;
      }
      return false;
    }

    const tw = this.t - this.tRelease;
    if (
      this.phase === PHASE_DRIVE &&
      (tw - this.tDriveStart >= p.tDrive || this.driveLimitHit())
    ) {
      if (!this.stopReason) this.stopReason = 'Drive duration reached.';
      this.phase = 'coast';
      this.tStop = tw;
    }

    if (this.phase === 'coast' && tw - this.tStop >= p.tCoast) {
      this.phase = 'done';
      return false;
    }

    this.step(p.g, p.mu, 0);
    const dt = this.dt;
    const M = p.wheelMass;
    const Wload = p.wheelLoad !== undefined ? p.wheelLoad : M * p.g;
    const FW = this.FW;
    const dir = this.dir;
    let om = 0;

    let currentWload = Wload;
    if (this.phase === 'drop') {
      this.Wz = 0;
      this.Vx = 0;
      this.staticSettleT += dt;

      // 3. Load Ramp: Linearly ramp vertical load starting at 0.0 to Wload over tRampLoad (0.5 s)
      const tRampLoad = p.tRampLoad !== undefined ? p.tRampLoad : 0.5;
      const ramp =
        tRampLoad > 0 ? Math.min(1.0, this.staticSettleT / tRampLoad) : 1.0;
      currentWload = Wload * ramp;

      // Allow the wheel to sink naturally into the bed under gravity for exactly 1.0 simulated second
      const tStaticSettle =
        p.tStaticSettle !== undefined ? p.tStaticSettle : 1.0;
      if (this.staticSettleT >= tStaticSettle) {
        // Measure and log the final wheel height at the end of this 1.0-second period.
        // This is the static sinkage baseline.
        this.wheelRestHeight = this.Yc;
        this.staticSinkage = this.wheelSpawnYc - this.Yc;
        this.Vy = 0; // Quiesce vertical transient before beginning drive

        // Drive Phase Transition:
        // Transition to drive phase and apply nominal driving velocities
        this.phase = PHASE_DRIVE;
        this.tDriveStart = tw;
        this.tracking = true;
        this.prevAir.fill(1);
        this.tL.fill(NaN);
      }
    } else if (this.phase === PHASE_DRIVE) {
      const f =
        p.tRamp > 0
          ? Math.min(1, (tw - this.tDriveStart) / p.tRamp)
          : 1;
      om = f * p.omega;
      this.Wz = -dir * om;
      if (p.mode === 'slip') {
        this.Vx = dir * om * p.R * (1 - p.slip);
      } else {
        this.Vx += ((FW[0] - dir * f * p.drawbarLoad) / M) * dt;
      }
    } else {
      this.Wz = 0;
      this.Vx = 0;
    }

    this.om = om;
    this.Vy += ((FW[1] - currentWload) / M) * dt;
    const dX = this.Vx * dt;
    this.Xu += dX;
    this.Xc = this.wrap(this.Xc + dX);
    this.Yc += this.Vy * dt;
    this.th += this.Wz * dt;

    this.facc[0] += FW[0];
    this.facc[1] += FW[1];
    this.facc[2] += FW[2];
    this.nacc++;

    if (this.tracking) {
      const N = this.N;
      const nc = this.nc;
      const fine = this.fine;
      const air = this.air;
      const prev = this.prevAir;
      const tL = this.tL;
      const ev = this.ev;
      const g = p.g;
      let nAir = 0;

      for (let i = 0; i < N; i++) {
        if (!fine[i]) {
          air[i] = 0;
          continue;
        }
        const a = nc[i] === 0 ? 1 : 0;
        air[i] = a;

        if (a && !prev[i]) {
          tL[i] = this.t;
          this.xL[i] = this.xu[i];
          this.yL[i] = this.y[i];
          this.vxL[i] = this.vx[i];
          this.vyL[i] = this.vy[i];
          this.ymx[i] = this.y[i];
        } else if (a) {
          if (this.y[i] > this.ymx[i]) this.ymx[i] = this.y[i];
        } else if (prev[i] && !isNaN(tL[i])) {
          const tf = this.t - tL[i];
          if (tf > p.tMinFlight) {
            const dx = dir * (this.xu[i] - this.xL[i]);
            const vy0 = this.vyL[i];
            const y0 = this.yL[i];
            const y1 = this.y[i];
            const tb =
              (vy0 +
                Math.sqrt(Math.max(vy0 * vy0 + 2 * g * (y0 - y1), 0))) /
              g;
            const apex = this.ymx[i] - y0;
            const v0 = Math.hypot(this.vxL[i], vy0);
            const ang = (Math.atan2(vy0, dir * this.vxL[i]) * 180) / Math.PI;

            ev.n++;
            ev.sumAbs += Math.abs(dx);
            if (Math.abs(dx) > ev.maxAbs) ev.maxAbs = Math.abs(dx);
            if (tf > ev.maxTf) ev.maxTf = tf;
            if (dx < 0) ev.rear++;
            if (apex > ev.maxApex) ev.maxApex = apex;

            if (this.events.length < 50000) {
              this.events.push({
                t: tL[i] - this.tRelease,
                tf,
                tb,
                dx,
                apex,
                v0,
                ang,
                x0: this.xL[i],
                y0,
                y1,
              });
            }
          }
          tL[i] = NaN;
        }
        if (a && !isNaN(tL[i]) && this.t - tL[i] > p.tMinFlight) nAir++;
        prev[i] = a;
      }

      this.nAir = nAir;
      if (
        this.phase === 'coast' &&
        nAir === 0 &&
        this.settleTime === null &&
        tw - this.tStop > 0.005
      ) {
        this.settleTime = tw - this.tStop;
      }
    }

    if (tw >= this.nextLog) {
      const Lg = this.log;
      const n = Math.max(this.nacc, 1);
      const R = p.R;
      const w3D = p.wheelWidth3D || 0.08;

      const dp2D = (dir * this.facc[0]) / n;
      const tq2D = (dir * this.facc[2]) / n;
      const fy2D = this.facc[1] / n;

      // Dynamic sinkage measured from baseline static sinkage point (wheelRestHeight)
      // During static settling (before baseline is established), measure penetration from spawn position
      const baselineHeight =
        this.wheelRestHeight !== null
          ? this.wheelRestHeight
          : this.wheelSpawnYc !== undefined
          ? this.wheelSpawnYc
          : this.Yc;
      const dynamicSinkageMm = (baselineHeight - this.Yc) * 1e3;

      Lg.t.push(tw);
      Lg.dist.push(dir * (this.Xu - this.X0));
      Lg.sink.push(dynamicSinkageMm);
      if (Lg.wheelY) Lg.wheelY.push(this.Yc);
      Lg.slip.push(om > 1e-9 ? 1 - (dir * this.Vx) / (om * R) : NaN);
      Lg.dp.push(dp2D);
      Lg.tq.push(tq2D);
      Lg.fy.push(fy2D);
      if (Lg.dp3D) {
        Lg.dp3D.push(dp2D * w3D);
        Lg.tq3D.push(tq2D * w3D);
        Lg.fy3D.push(fy2D * w3D);
      }
      Lg.vx.push(dir * this.Vx);
      Lg.vy.push(this.Vy);
      Lg.air.push(this.nAir);

      this.facc = [0, 0, 0];
      this.nacc = 0;
      this.nextLog += p.logEvery;
    }

    return true;
  }
}
