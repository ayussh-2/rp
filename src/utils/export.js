export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadTimeSeriesCSV(sim) {
  if (!sim) return;
  const L = sim.log;
  const w3D = sim.p.wheelWidth3D || 0.08;
  const baselineY =
    sim.wheelRestHeight !== null && sim.wheelRestHeight !== undefined
      ? sim.wheelRestHeight
      : (sim.wheelSpawnYc !== undefined
          ? sim.wheelSpawnYc
          : (sim.Hs ? sim.Hs + (sim.Rtip || sim.p.R) : 0));
  let s =
    't_s,travel_m,sinkage_mm,slip,drawbar_pull_N_per_m,drive_torque_Nm_per_m,forward_speed_m_s,vertical_speed_m_s,vertical_soil_force_N_per_m,drawbar_pull_3D_N,drive_torque_3D_Nm,vertical_soil_force_3D_N,airborne_fines\n';

  for (let k = 0; k < L.t.length; k++) {
    const dp3D = L.dp3D && L.dp3D[k] !== undefined ? L.dp3D[k] : L.dp[k] * w3D;
    const tq3D = L.tq3D && L.tq3D[k] !== undefined ? L.tq3D[k] : L.tq[k] * w3D;
    const fy3D = L.fy3D && L.fy3D[k] !== undefined ? L.fy3D[k] : L.fy[k] * w3D;

    // Measure dynamic sinkage from baseline static sinkage point, rather than absolute floor
    const sinkageVal =
      L.wheelY && L.wheelY[k] !== undefined && baselineY !== 0
        ? (baselineY - L.wheelY[k]) * 1e3
        : L.sink[k];

    s +=
      [
        L.t[k],
        L.dist[k],
        sinkageVal,
        L.slip[k],
        L.dp[k],
        L.tq[k],
        L.vx[k],
        L.vy[k],
        L.fy[k],
        dp3D,
        tq3D,
        fy3D,
        L.air[k],
      ]
        .map((v) => (isFinite(v) ? +v.toPrecision(7) : ''))
        .join(',') + '\n';
  }

  download('rover_dem_timeseries_seed' + sim.seedUsed + '.csv', s);
}

export function downloadEjectaCSV(sim) {
  if (!sim) return;
  let s =
    't_launch_s,flight_time_s,ballistic_time_s,distance_along_travel_m,apex_m,launch_speed_m_s,launch_angle_deg,x0_m,y0_m,y_land_m\n';

  for (const e of sim.events) {
    s +=
      [e.t, e.tf, e.tb, e.dx, e.apex, e.v0, e.ang, e.x0, e.y0, e.y1]
        .map((v) => +v.toPrecision(7))
        .join(',') + '\n';
  }

  download('rover_dem_ejecta_seed' + sim.seedUsed + '.csv', s);
}
