import { CHARTS } from '../constants/defaults';

export function ChartsGrid({ registerChartCanvas }) {
  return (
    <div className="charts" id="charts">
      {CHARTS.map((item) => (
        <div key={item.id} className="chart">
          <h3>{item.title}</h3>
          <p>{item.desc}</p>
          <canvas
            id={item.id}
            ref={(el) => registerChartCanvas(item.id, el)}
          />
        </div>
      ))}
    </div>
  );
}
