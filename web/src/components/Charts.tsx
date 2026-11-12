import { useState } from 'react';

const LINE_W = 460;
const LINE_H = 140;
const PAD = { l: 26, r: 10, t: 10, b: 22 };

export interface LineSeries {
  name: string;
  color: string;
  points: { date: string; count: number }[];
}

export function LineChart({ series }: { series: LineSeries[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = series[0]?.points.length ?? 0;
  if (n === 0) return <p className="empty">暂无数据</p>;

  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.count)));
  const plotW = LINE_W - PAD.l - PAD.r;
  const plotH = LINE_H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const ticks = [0, Math.ceil(max / 2), max];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${LINE_W} ${LINE_H}`} className="line-chart" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={LINE_W - PAD.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.l - 6} y={y(t) + 4} className="chart-label" textAnchor="end">{t}</text>
          </g>
        ))}
        {series.map((s) => {
          const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.count)}`).join(' ');
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2.5} className="chart-line" pathLength={100} />
              {s.points.map((p, i) => (
                <circle key={p.date} cx={x(i)} cy={y(p.count)} r={hover === i ? 5 : 3.5} fill="#fff" stroke={s.color} strokeWidth={2} />
              ))}
            </g>
          );
        })}
        {series[0].points.map((p, i) => (
          <text key={p.date} x={x(i)} y={LINE_H - 8} className="chart-label" textAnchor="middle">{p.date.slice(5)}</text>
        ))}
        {Array.from({ length: n }, (_, i) => (
          <rect
            key={i}
            x={x(i) - plotW / (2 * Math.max(1, n - 1))}
            y={PAD.t}
            width={n === 1 ? plotW : plotW / (n - 1)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} className="chart-cursor" />
        )}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
            {hover !== null && <b>：{s.points[hover].count}</b>}
          </span>
        ))}
        {hover !== null && <span className="chart-date">{series[0].points[hover].date}</span>}
      </div>
    </div>
  );
}

const PIE_COLORS = ['#2f6fed', '#1a9d5a', '#b7791f', '#8a5cd6', '#e07a5a', '#8a94a6'];

export function DonutChart({ data }: { data: { name: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const items = data.filter((d) => d.count > 0);
  const total = items.reduce((a, b) => a + b.count, 0);
  if (total === 0) return <p className="empty">暂无数据</p>;

  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const segments = items.map((d, i) => {
    const frac = d.count / total;
    const seg = { ...d, frac, dash: frac * C, offset: -acc * C, color: PIE_COLORS[i % PIE_COLORS.length], idx: i };
    acc += frac;
    return seg;
  });
  const active = hover !== null ? segments[hover] : null;

  return (
    <div className="chart-wrap donut-wrap">
      <svg viewBox="0 0 120 120" className="donut-chart">
        <g transform="rotate(-90 60 60)">
          {segments.map((s) => (
            <circle
              key={s.name}
              cx={60} cy={60} r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === s.idx ? 21 : 16}
              strokeDasharray={`${s.dash} ${C - s.dash}`}
              strokeDashoffset={s.offset}
              className="donut-seg"
              onMouseEnter={() => setHover(s.idx)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>
        <text x={60} y={57} textAnchor="middle" className="donut-total">{active ? active.count : total}</text>
        <text x={60} y={71} textAnchor="middle" className="donut-caption">{active ? active.name : '总学生数'}</text>
      </svg>
      <ul className="chart-legend vertical">
        {segments.map((s) => (
          <li
            key={s.name}
            className={hover === s.idx ? 'active' : ''}
            onMouseEnter={() => setHover(s.idx)}
            onMouseLeave={() => setHover(null)}
          >
            <i style={{ background: s.color }} />
            {s.name}
            <b>{s.count} · {Math.round(s.frac * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
