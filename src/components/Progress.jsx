import { addDays, daysBetween, intake } from "../lib/cutEngine";
import { useEffect, useRef, useState } from "react";
const fmt = (n) => Number(n.toFixed(2)).toLocaleString("en-IN");
export default function Progress({ profile, logs, date, plan }) {
  const chartRef = useRef(null);
  const [chartWidth, setChartWidth] = useState(760);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setChartWidth(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);
  const chartHeight = chartWidth < 600 ? 240 : 280;
  const recent = logs.filter(
    (l) =>
      l.date >= profile.startDate &&
      l.date >= addDays(date, -13) &&
      l.date <= date,
  );
  const complete = recent.filter((l) => l.foodComplete);
  const trained = logs.filter(
    (l) =>
      l.date >= profile.startDate &&
      l.date >= addDays(date, -6) &&
      l.date <= date &&
      l.trained,
  ).length;
  const data = plan.trend;
  const min = Math.min(+profile.goalWeight, ...data.map((p) => p.raw)) - 0.5;
  const max = Math.max(+profile.startWeight, ...data.map((p) => p.raw)) + 0.5;
  const span = Math.max(1, daysBetween(data[0]?.date || date, date));
  const x = (d) =>
    44 + (daysBetween(data[0]?.date || date, d) / span) * (chartWidth - 62);
  const y = (w) =>
    chartHeight - 35 - ((w - min) / (max - min)) * (chartHeight - 70);
  const raw = data.map((p) => `${x(p.date)},${y(p.raw)}`).join(" ");
  const trend = data.map((p) => `${x(p.date)},${y(p.trend)}`).join(" ");
  return (
    <>
      <section className="grid three stats">
        <article className="panel">
          <p className="eyebrow">SEVEN-DAY AVERAGE</p>
          <h2>
            {fmt(plan.currentWeight)} <small>kg</small>
          </h2>
          <p className="muted">
            {plan.weightSamples
              ? `${plan.weightSamples} weigh-ins in latest window`
              : "Start weight; waiting for weigh-ins"}
          </p>
        </article>
        <article className="panel">
          <p className="eyebrow">OBSERVED LOSS</p>
          <h2>
            {plan.observedWeeklyLoss == null
              ? "Learning"
              : `${fmt(plan.observedWeeklyLoss)} kg/wk`}
          </h2>
          <p className="muted">Raw-weight regression over up to 14 days</p>
        </article>
        <article className="panel">
          <p className="eyebrow">GOAL WEIGHT</p>
          <h2>
            {profile.goalWeight} <small>kg</small>
          </h2>
          <p className="muted">
            {plan.phase === "maintenance"
              ? "Maintenance phase active"
              : plan.projectedDate
                ? `Rough estimate: ${plan.projectedDate}`
                : "Waiting for an estimate"}
          </p>
        </article>
      </section>
      <section className="panel chart" ref={chartRef}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">PROGRESS, WITHOUT THE DAILY NOISE</p>
            <h2>Weight over time.</h2>
          </div>
          <span className="muted">Pale: scale · Green: seven-day average</span>
        </div>
        {data.length ? (
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label="Scale weight and seven-day average over time"
          >
            <text x="5" y="20">
              {fmt(max)} kg
            </text>
            <text x="5" y={chartHeight - 16}>
              {fmt(min)} kg
            </text>
            <line
              x1="44"
              x2={chartWidth - 18}
              y1={y(+profile.goalWeight)}
              y2={y(+profile.goalWeight)}
              stroke="#567469"
              strokeDasharray="5 6"
            />
            <text
              x={chartWidth - 18}
              textAnchor="end"
              y={y(+profile.goalWeight) - 8}
            >
              Goal {profile.goalWeight} kg
            </text>
            <polyline
              points={raw}
              fill="none"
              stroke="#64716e"
              strokeWidth="1.5"
            />
            <polyline
              points={trend}
              fill="none"
              stroke="#b6ed91"
              strokeWidth="3"
            />
            {data.map((p) => (
              <circle
                key={p.date}
                cx={x(p.date)}
                cy={y(p.raw)}
                r="3"
                fill="#64716e"
              >
                <title>
                  {p.date}: {p.raw} kg; average {fmt(p.trend)} kg
                </title>
              </circle>
            ))}
            <text x="44" y={chartHeight - 5}>
              {data[0].date}
            </text>
            <text x={chartWidth - 18} textAnchor="end" y={chartHeight - 5}>
              {date}
            </text>
          </svg>
        ) : (
          <p className="empty">
            Log your first morning weight to begin the trend.
          </p>
        )}
        <p className="muted">
          Dates are rough estimates using the current planned deficit, not a
          guarantee. Energy needs, adherence and water weight change over time.
        </p>
      </section>
      <section className="grid two">
        <article className="panel">
          <h2>Enough data to learn?</h2>
          <dl>
            <div>
              <dt>Complete food logs · past 14 days</dt>
              <dd>{complete.length} / 14</dd>
            </div>
            <div>
              <dt>Complete step logs · past 14 days</dt>
              <dd>
                {
                  recent.filter((l) => l.activityComplete && l.steps != null)
                    .length
                }{" "}
                / 14
              </dd>
            </div>
            <div>
              <dt>Training check-ins · past 7 days</dt>
              <dd>
                {trained} / {profile.gymDays}
              </dd>
            </div>
            <div>
              <dt>Average intake · complete days</dt>
              <dd>
                {complete.length
                  ? `${Math.round(complete.reduce((s, l) => s + intake(l), 0) / complete.length)} kcal`
                  : "Unknown"}
              </dd>
            </div>
          </dl>
          <p className="muted">{plan.calibration.reason}</p>
          {trained < +profile.gymDays && (
            <p className="muted">
              If your usual training changes, update the baseline instead of
              counting sessions as extra calories.
            </p>
          )}
        </article>
        <article className="panel">
          <h2>
            {plan.phase === "maintenance"
              ? "Protect the result."
              : "What matters next."}
          </h2>
          <p>
            {plan.phase === "maintenance"
              ? "Keep eating at estimated maintenance, keep your activity routine and keep logging. A short scale rebound can be water and food mass. Compare multiple weeks before changing food."
              : "Hit the food target as consistently as practical, keep protein high, and maintain resistance training. Log complete days so the model can learn rather than guess."}
          </p>
          <p className="muted">
            One high-calorie day does not create a punishment target tomorrow.
            CUTIQ reviews the baseline weekly and never invents unlogged intake.
          </p>
          {plan.warnings.map((w) => (
            <p className="notice" key={w}>
              {w}
            </p>
          ))}
        </article>
      </section>
    </>
  );
}
