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
  let s =
    't_s,travel_m,sinkage_mm,slip,drawbar_pull_N_per_m,drive_torque_Nm_per_m,forward_speed_m_s,vertical_speed_m_s,vertical_soil_force_N_per_m,airborne_fines\n';

  for (let k = 0; k < L.t.length; k++) {
    s +=
      [
        L.t[k],
        L.dist[k],
        L.sink[k],
        L.slip[k],
        L.dp[k],
        L.tq[k],
        L.vx[k],
        L.vy[k],
        L.fy[k],
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
