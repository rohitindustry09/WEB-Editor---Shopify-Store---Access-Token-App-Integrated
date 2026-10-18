interface Point {
  label: string;
  value: number;
}

export function SalesChart({ data }: { data: Point[] }) {
  const width = 640;
  const height = 200;
  const padding = 24;
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((d.value - min) / range) * (height - padding * 2);
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${height - padding} L${points[0].x},${height - padding} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Sales over the last 7 days">
      <defs>
        <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brass)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--color-brass)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={padding}
          x2={width - padding}
          y1={padding + f * (height - padding * 2)}
          y2={padding + f * (height - padding * 2)}
          stroke="var(--color-border)"
          strokeWidth="1"
        />
      ))}
      <path d={areaPath} fill="url(#salesFill)" />
      <path d={linePath} fill="none" stroke="var(--color-brass)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p) => (
        <circle key={p.label} cx={p.x} cy={p.y} r={p.label === data[data.length - 1].label ? 4.5 : 3} fill="var(--color-surface)" stroke="var(--color-brass)" strokeWidth="2" />
      ))}
      {points.map((p) => (
        <text key={p.label} x={p.x} y={height - 4} textAnchor="middle" fontSize="10" fill="var(--color-ink-faint)">
          {p.label}
        </text>
      ))}
    </svg>
  );
}
