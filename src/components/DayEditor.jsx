import { useEffect, useState } from "react";
import CalorieRing from "./CalorieRing";
import Icon from "./Icon";
import MealEntry from "./MealEntry";

const fmt = (n) => Math.round(n).toLocaleString("en-IN");
export default function DayEditor({
  profile,
  original,
  draft,
  plan,
  onChange: setDraft,
  busy,
  onSave,
  onDirty,
}) {
  const [saved, setSaved] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    const handler = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const change = (key, value) => {
    setSaved(false);
    setDraft((d) => ({
      ...d,
      [key]: value,
      ...(key === "steps" && value == null ? { activityComplete: false } : {}),
    }));
  };
  const macroTotal = (key) =>
    draft.meals.every(
      (m) => m[key] != null && m[key] !== "" && Number.isFinite(+m[key]),
    )
      ? draft.meals.reduce((sum, m) => sum + +m[key], 0)
      : null;
  const stepProgress =
    profile.baselineSteps > 0 && draft.steps != null
      ? Math.min(100, (draft.steps / profile.baselineSteps) * 100)
      : 0;
  return (
    <form
      className="day-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(draft)) setSaved(true);
      }}
    >
      <fieldset disabled={busy}>
        <div className="today-grid">
          <section
            className="panel calorie-hero full-width"
            aria-label="Calorie and macro summary"
          >
            <div className="hero-heading">
              <span className="eyebrow">
                {plan.phase === "maintenance"
                  ? "MAINTENANCE ALLOWANCE"
                  : "DAILY NUTRITION"}
              </span>
              <span className={`phase ${plan.phase}`}>{plan.phase}</span>
            </div>
            <div className="hero-body">
              <CalorieRing consumed={plan.consumed} target={plan.target} />
              <div className="hero-nutrition">
                <div className="target-heading">
                  <span>Today's target</span>
                  <div className="big-number">
                    {fmt(plan.target)}
                    <small> kcal</small>
                  </div>
                </div>
                <MacroBar
                  label="Protein"
                  value={macroTotal("protein")}
                  target={plan.protein}
                  tone="protein"
                />
                <MacroBar
                  label="Carbs"
                  value={macroTotal("carbs")}
                  target={plan.carbs}
                  tone="carbs"
                />
                <MacroBar
                  label="Fat"
                  value={macroTotal("fat")}
                  target={plan.fat}
                  tone="fat"
                />
              </div>
            </div>
            <div className="hero-footer">
              <span
                className={
                  plan.activity > 0
                    ? "positive"
                    : plan.activity < 0
                      ? "warning-text"
                      : "muted"
                }
              >
                <Icon name="steps" size={14} />
                {plan.activity > 0
                  ? `+${fmt(plan.activity)} kcal earned from extra steps`
                  : plan.activity < 0
                    ? `${fmt(Math.abs(plan.activity))} kcal less for today's steps`
                    : `${fmt(profile.baselineSteps)} steps included in your baseline`}
              </span>
              <span className="muted">
                {plan.provisional
                  ? "Activity provisional"
                  : "Final steps applied"}
              </span>
            </div>
          </section>

          {plan.warnings.length > 0 && (
            <div className="full-width notices">
              {plan.warnings.map((w) => (
                <p className="notice" key={w}>
                  {w}
                </p>
              ))}
            </div>
          )}

          <section className="panel coach-panel">
            <div className="section-heading">
              <h2>
                <Icon name="sparkle" className="accent" />
                Coach
              </h2>
              <span className="subtle-tag">
                {plan.calibration.source === "calibrated"
                  ? "Calibrated"
                  : "Learning"}
              </span>
            </div>
            <div className="coach-insight">
              <span className="status-dot" />
              <p>
                {plan.phase === "maintenance"
                  ? "Maintenance is active. Keep your usual activity and watch the trend over the next few weeks."
                  : plan.activity > 0
                    ? `Your extra steps raise today's food target. The planned deficit is ${fmt(plan.deficit)} kcal.`
                    : plan.provisional
                      ? "Your target assumes your usual activity. Extra steps increase your allowance as you log them."
                      : `Today's final step count is included in your ${fmt(plan.target)} kcal target.`}
              </p>
            </div>
            <div className="balance-summary">
              <div>
                <span>Expenditure</span>
                <strong>{fmt(plan.maintenance)}</strong>
              </div>
              <span className="equation-symbol">−</span>
              <div>
                <span>Food target</span>
                <strong>{fmt(plan.target)}</strong>
              </div>
              <span className="equation-symbol">=</span>
              <div>
                <span>{plan.deficit >= 0 ? "Net deficit" : "Surplus"}</span>
                <strong className="accent">
                  {fmt(Math.abs(plan.deficit))}
                </strong>
              </div>
            </div>
            <details className="balance-details">
              <summary>See calorie calculation</summary>
              <dl>
                <div>
                  <dt>Baseline maintenance</dt>
                  <dd>{fmt(plan.baselineMaintenance)} kcal</dd>
                </div>
                <div>
                  <dt>Step adjustment</dt>
                  <dd>
                    {plan.activity >= 0 ? "+" : "−"}
                    {fmt(Math.abs(plan.activity))} kcal
                  </dd>
                </div>
                <div>
                  <dt>Estimated expenditure</dt>
                  <dd>{fmt(plan.maintenance)} kcal</dd>
                </div>
                <div>
                  <dt>Food target</dt>
                  <dd>{fmt(plan.target)} kcal</dd>
                </div>
              </dl>
              <p className="muted">{plan.calibration.reason}</p>
              <p className="muted">
                Activity burn is estimated. Mark your steps final to apply a
                lower-step day too.
              </p>
            </details>
          </section>

          <section className="panel vitals-panel">
            <div className="section-heading">
              <h2>Today's vitals</h2>
              <span className={`save-state ${dirty ? "unsaved" : ""}`}>
                {dirty ? "Unsaved" : saved ? "Saved" : "Daily check-in"}
              </span>
            </div>
            <div className="vital-rows">
              <label className="vital-row">
                <Icon name="scale" />
                <span>Morning weight</span>
                <input
                  aria-label="Morning weight · kg"
                  type="number"
                  inputMode="decimal"
                  min="35"
                  max="350"
                  step="0.1"
                  placeholder="—"
                  value={draft.weight ?? ""}
                  onChange={(e) =>
                    change(
                      "weight",
                      e.target.value === "" ? null : +e.target.value,
                    )
                  }
                />
                <small>kg</small>
              </label>
              <label className="vital-row">
                <Icon name="steps" />
                <span>Steps</span>
                <input
                  aria-label="Steps so far"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="100000"
                  step="1"
                  placeholder="—"
                  value={draft.steps ?? ""}
                  onChange={(e) =>
                    change(
                      "steps",
                      e.target.value === "" ? null : +e.target.value,
                    )
                  }
                />
                <small />{" "}
              </label>
            </div>
            <div className="step-progress">
              <div>
                <span>Daily baseline</span>
                <span>
                  {draft.steps == null ? "—" : fmt(draft.steps)}{" "}
                  <span className="muted">/ {fmt(profile.baselineSteps)}</span>
                </span>
              </div>
              <div className="progress-track">
                <span style={{ width: `${stepProgress}%` }} />
              </div>
            </div>
            <label className="check training">
              <input
                type="checkbox"
                checked={draft.trained}
                onChange={(e) => change("trained", e.target.checked)}
              />
              <span>
                I trained today<small>Included in your weekly baseline</small>
              </span>
            </label>
          </section>

          <section className="panel meals-panel full-width">
            <div className="section-heading">
              <h2>Meals</h2>
              <div className="meal-actions">
                <button
                  type="button"
                  className={addOpen ? "small-button" : "primary small-button"}
                  aria-expanded={addOpen}
                  onClick={() => setAddOpen((open) => !open)}
                >
                  <Icon name={addOpen ? "close" : "plus"} size={15} />
                  {addOpen ? "Close" : "Add meal"}
                </button>
              </div>
            </div>
            {draft.meals.length ? (
              <details className="meal-history" open={draft.meals.length < 3}>
                <summary>
                  <strong>
                    {draft.meals.length}{" "}
                    {draft.meals.length === 1 ? "item" : "items"}
                  </strong>
                  <span>{fmt(plan.consumed)} kcal</span>
                  <Icon name="chevronRight" size={14} />
                </summary>
                <ul className="meal-list">
                  {draft.meals.map((m, i) => (
                    <li key={m.id || i}>
                      <div className="meal-marker">
                        <Icon name="clipboard" size={17} />
                      </div>
                      <div className="meal-description">
                        <strong>{m.name}</strong>
                        <small>
                          {m.protein != null
                            ? `${fmt(m.protein)} g protein`
                            : "Protein not recorded"}
                        </small>
                      </div>
                      <span>
                        {fmt(m.cals)}
                        <small> kcal</small>
                      </span>
                      <button
                        className="icon-button remove-meal"
                        type="button"
                        aria-label={`Remove ${m.name}`}
                        onClick={() => {
                          setSaved(false);
                          setDraft((d) => ({
                            ...d,
                            meals: d.meals.filter((_, index) => index !== i),
                            foodComplete: false,
                          }));
                        }}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <div className="empty">
                <Icon name="clipboard" size={25} />
                <p>
                  No meals yet.
                  <span>Add your first meal to start tracking today.</span>
                </p>
              </div>
            )}
            {addOpen && (
              <MealEntry
                onAdd={(m) => {
                  setSaved(false);
                  setDraft((d) => ({
                    ...d,
                    foodComplete: false,
                    meals: [...d.meals, { ...m, id: crypto.randomUUID() }],
                  }));
                }}
              />
            )}
          </section>

          <section className="panel day-completion full-width">
            <div className="section-heading">
              <h2>Finish your day</h2>
              <span className="muted">Complete logs help your plan learn.</span>
            </div>
            <div className="completion-checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.foodComplete}
                  onChange={(e) => change("foodComplete", e.target.checked)}
                />
                Food log includes the whole day, including oils, drinks and
                snacks.
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.activityComplete}
                  disabled={draft.steps == null}
                  onChange={(e) => change("activityComplete", e.target.checked)}
                />
                Step count is final for this day.
              </label>
            </div>
            <details className="notes-entry">
              <summary>Add a note</summary>
              <label>
                Notes · optional
                <textarea
                  rows="2"
                  maxLength={2000}
                  placeholder="Appetite, recovery or anything worth remembering…"
                  value={draft.notes}
                  onChange={(e) => change("notes", e.target.value)}
                />
              </label>
            </details>
            <div className="actions">
              <span className="muted" role="status">
                {dirty
                  ? "You have unsaved changes."
                  : saved
                    ? "Day saved."
                    : "Complete days help refine your plan."}
              </span>
              <button className="primary">
                <Icon name="check" size={16} />
                {busy ? "Saving…" : "Save day"}
              </button>
            </div>
          </section>
        </div>
      </fieldset>
    </form>
  );
}

function MacroBar({ label, value, target, tone }) {
  const known = value != null;
  return (
    <div className={`macro-bar ${tone}`}>
      <div>
        <span>{label}</span>
        <span
          className="macro-value"
          title={known ? undefined : "Not recorded for every meal"}
        >
          {known ? fmt(value) : "—"}
          <small> / {target} g</small>
        </span>
      </div>
      <div className="macro-track">
        <span
          style={{
            width: `${known && target > 0 ? Math.min(100, (value / target) * 100) : 0}%`,
          }}
        />
      </div>
    </div>
  );
}
