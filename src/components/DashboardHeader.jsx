import { daysBetween } from "../lib/cutEngine";
import Icon from "./Icon";

export default function DashboardHeader({
  profile,
  plan,
  onToday,
  onSettings,
  onExport,
  onSignOut,
}) {
  const duration = plan ? daysBetween(profile.startDate, profile.goalDate) : 0;
  const elapsed = plan
    ? Math.max(0, daysBetween(profile.startDate, plan.date))
    : 0;
  const day = elapsed + 1;
  const daysLeft = Math.max(0, duration - elapsed);
  return (
    <header className="app-header">
      <div className="header-inner">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onToday();
          }}
        >
          <span className="brand-dot" />
          CUT<span className="brand-iq">IQ</span>
        </a>
        {plan && (
          <div className="header-timeline">
            <div className="timeline-track">
              <span
                style={{
                  width: `${Math.min(100, (elapsed / Math.max(1, duration)) * 100)}%`,
                }}
              />
            </div>
            <div className="timeline-labels">
              <span>
                {plan.phase === "maintenance"
                  ? `DAY ${day} · MAINTENANCE`
                  : plan.phase === "scheduled"
                    ? "STARTING SOON"
                    : elapsed >= duration
                      ? `DAY ${day} · REVIEW`
                      : `DAY ${day}`}
              </span>
              <span>
                {plan.phase === "maintenance"
                  ? plan.reachedDate
                    ? "GOAL REACHED"
                    : "HOLD STEADY"
                  : `${daysLeft}D LEFT`}
              </span>
            </div>
          </div>
        )}
        {plan && (
          <div className="header-weight" title="Weight trend → goal weight">
            <span>
              {plan.currentWeight.toFixed(1)}
              <small> kg</small>
            </span>
            <span className="weight-arrow">→</span>
            <span className="accent">
              {Number(profile.goalWeight).toFixed(1)}
              <small> kg</small>
            </span>
          </div>
        )}
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="Export data"
            title="Export data"
            onClick={onExport}
          >
            <Icon name="export" />
          </button>
          {plan && (
            <button
              className="icon-button"
              aria-label="Settings"
              title="Settings"
              onClick={onSettings}
            >
              <Icon name="gear" />
            </button>
          )}
          {onSignOut && (
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={onSignOut}
            >
              <Icon name="logout" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
