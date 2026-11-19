// 手写 SVG 图表（零依赖）：面积折线 / 柱状 / 环形 / 迷你走势
import { useId } from "react";

export const PALETTE = ["#f291a9", "#7fb98a", "#f0a85c", "#b98ad1", "#7fb6d9", "#e0a3c4", "#a8b6d9", "#d9c27a"];

interface LinePoint {
  x: number;
  y: number;
  label?: string;
}

/** 面积折线图（多系列） */
export function AreaChart({
  series,
  height = 180,
  xLabels = [],
  yFormat = (v: number) => String(v),
}: {
  series: Array<{ name: string; points: LinePoint[]; color: string }>;
  height?: number;
  xLabels?: string[];
  yFormat?: (v: number) => string;
}) {
  const gid = useId().replace(/:/g, "");
  const W = 640;
  const H = height;
  const pad = { t: 14, r: 12, b: 26, l: 38 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const all = series.flatMap((s) => s.points);
  const maxY = Math.max(1, ...all.map((p) => p.y));
  const maxX = Math.max(1, ...all.map((p) => p.x));
  const sx = (x: number) => pad.l + (x / maxX) * innerW;
  const sy = (y: number) => pad.t + innerH - (y / maxY) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="admChart" preserveAspectRatio="none">
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
          </linearGradient>
        ))}
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={sy(t)} x2={W - pad.r} y2={sy(t)} className="admChartGrid" />
          <text x={pad.l - 6} y={sy(t) + 4} className="admChartAxis" textAnchor="end">
            {yFormat(t)}
          </text>
        </g>
      ))}
      {series.map((s, si) => {
        if (!s.points.length) return null;
        const pts = s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");
        const area = `${pad.l},${pad.t + innerH} ${pts} ${sx(s.points[s.points.length - 1].x)},${pad.t + innerH}`;
        return (
          <g key={si}>
            <polygon points={area} fill={`url(#${gid}-${si})`} />
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((p, i) => (
              <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="2.6" fill={s.color}>
                <title>{`${p.label ?? ""} ${yFormat(p.y)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {xLabels.map((l, i) => {
        const x = pad.l + (i / Math.max(1, xLabels.length - 1)) * innerW;
        return (
          <text key={i} x={x} y={H - 8} className="admChartAxis" textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}>
            {l}
          </text>
        );
      })}
    </svg>
  );
}

/** 柱状图 */
export function BarChart({
  data,
  height = 180,
  color = "#f291a9",
  yFormat = (v: number) => String(v),
}: {
  data: Array<{ label: string; value: number }>;
  height?: number;
  color?: string;
  yFormat?: (v: number) => string;
}) {
  const W = 640;
  const H = height;
  const pad = { t: 14, r: 12, b: 26, l: 38 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const maxY = Math.max(1, ...data.map((d) => d.value));
  const bw = data.length ? innerW / data.length : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="admChart" preserveAspectRatio="none">
      {[0, 0.5, 1].map((f, i) => {
        const y = pad.t + innerH - f * innerH;
        return (
          <g key={i}>
            <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} className="admChartGrid" />
            <text x={pad.l - 6} y={y + 4} className="admChartAxis" textAnchor="end">
              {yFormat(Math.round(maxY * f))}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.value / maxY) * innerH;
        const x = pad.l + i * bw + bw * 0.18;
        const w = Math.max(2, bw * 0.64);
        return (
          <g key={i}>
            <rect x={x} y={pad.t + innerH - h} width={w} height={Math.max(1, h)} rx="4" fill={color} opacity="0.86">
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
            <text x={x + w / 2} y={H - 8} className="admChartAxis" textAnchor="middle">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 环形图 */
export function DonutChart({
  data,
  size = 168,
  centerLabel,
  centerSub,
}: {
  data: Array<{ label: string; value: number }>;
  size?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - 16;
  const cx = size / 2;
  const cy = size / 2;
  let angle = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const frac = total ? d.value / total : 0;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const path =
      frac >= 0.9999
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${cx} ${cy} Z`;
    return { path, color: PALETTE[i % PALETTE.length], label: d.label, value: d.value };
  });
  return (
    <div className="admDonutWrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="admDonut">
        {arcs.map((a, i) => (
          <path key={i} d={a.path} fill={a.color} opacity="0.9">
            <title>{`${a.label}: ${a.value}`}</title>
          </path>
        ))}
        {centerLabel && (
          <>
            <text x={cx} y={cy - 2} className="admDonutCenter" textAnchor="middle">
              {centerLabel}
            </text>
            {centerSub && (
              <text x={cx} y={cy + 16} className="admDonutSub" textAnchor="middle">
                {centerSub}
              </text>
            )}
          </>
        )}
      </svg>
      <div className="admLegend">
        {arcs.map((a, i) => (
          <div key={i} className="admLegendItem">
            <i style={{ background: a.color }} />
            <span className="admLegendLabel">{a.label}</span>
            <span className="admLegendValue">{a.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 迷你走势线 */
export function Sparkline({ values, color = "#f291a9", width = 90, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (!values.length) return <svg width={width} height={height} />;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const pts = values
    .map((v, i) => `${(i / Math.max(1, values.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="admSpark">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
