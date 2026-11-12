const fmt = (n) => Math.round(n).toLocaleString("en-IN");

export default function CalorieRing({ consumed, target }) {
  const radius = 67;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(1, Math.max(0, consumed / target));
  const remaining = target - consumed;
  return (
    <div
      className={`calorie-ring ${remaining < 0 ? "is-over" : ""}`}
      role="img"
      aria-label={`${fmt(consumed)} of ${fmt(target)} calories eaten, ${fmt(Math.abs(remaining))} ${remaining >= 0 ? "remaining" : "over target"}`}
    >
      <svg viewBox="0 0 156 156" aria-hidden="true">
        <circle className="ring-track" cx="78" cy="78" r={radius} />
        <circle
          className="ring-value"
          cx="78"
          cy="78"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>
      <div className="ring-label">
        <span>
          {fmt(Math.abs(remaining))} {remaining >= 0 ? "left" : "over"}
        </span>
        <strong>{fmt(consumed)}</strong>
        <small>of {fmt(target)} kcal</small>
      </div>
    </div>
  );
}
