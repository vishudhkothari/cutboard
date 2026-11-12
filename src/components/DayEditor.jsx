import { useEffect, useState } from "react";
import { FOOD_DB, mealFromFood } from "../lib/foodDB";

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
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const change = (key, value) => {
    setSaved(false);
    setDraft((d) => ({
      ...d,
      [key]: value,
      ...(key === "steps" && value == null ? { activityComplete: false } : {}),
    }));
  };
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
  const consumedProtein = draft.meals.reduce(
    (s, m) => s + (+m.protein || 0),
    0,
  );
  const percent = Math.min(100, (plan.consumed / plan.target) * 100);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(draft)) setSaved(true);
      }}
    >
      <fieldset disabled={busy}>
        <section className="hero-grid">
          <article className="panel calorie-hero">
            <p className="eyebrow">
              {plan.phase === "maintenance"
                ? "MAINTENANCE ALLOWANCE"
                : "YOUR FOOD TARGET"}
            </p>
            <div className="big-number">
              {fmt(plan.target)}
              <span>kcal</span>
            </div>
            <p className="hero-caption">
              {plan.activity > 0
                ? `Includes ${fmt(plan.activity)} kcal from extra steps.`
                : plan.activity < 0
                  ? `${fmt(-plan.activity)} kcal less for a lower-step day.`
                  : "At your usual activity baseline."}
            </p>
            <div className="progress-track">
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="between">
              <span>{fmt(plan.consumed)} eaten</span>
              <strong>
                {fmt(Math.abs(plan.remaining))}{" "}
                {plan.remaining >= 0 ? "left" : "over"}
              </strong>
            </div>
            <div className="macro-row">
              <div>
                <strong>
                  {fmt(consumedProtein)} / {plan.protein} g
                </strong>
                <span>protein</span>
              </div>
              <div>
                <strong>{plan.carbs} g</strong>
                <span>carb guide</span>
              </div>
              <div>
                <strong>{plan.fat} g</strong>
                <span>fat guide</span>
              </div>
            </div>
          </article>
          <article className="panel balance">
            <p className="eyebrow">THE ENERGY BALANCE</p>
            <dl>
              <div>
                <dt>Baseline maintenance</dt>
                <dd>{fmt(plan.baselineMaintenance)}</dd>
              </div>
              <div>
                <dt>Step adjustment</dt>
                <dd className="accent">
                  {plan.activity >= 0 ? "+" : "−"}
                  {fmt(Math.abs(plan.activity))}
                </dd>
              </div>
              <div className="subtotal">
                <dt>Estimated expenditure</dt>
                <dd>{fmt(plan.maintenance)}</dd>
              </div>
              <div>
                <dt>Food target</dt>
                <dd>−{fmt(plan.target)}</dd>
              </div>
              <div className="total">
                <dt>
                  {plan.deficit >= 0
                    ? "Planned net deficit"
                    : "Estimated surplus"}
                </dt>
                <dd>
                  {fmt(Math.abs(plan.deficit))}
                  <small> kcal</small>
                </dd>
              </div>
            </dl>
            <p className="muted">
              {plan.provisional
                ? "Provisional: your usual steps are assumed until you finish the day. Extra steps already logged raise the target."
                : "Final step count applied. A completed day can adjust the target down as well as up."}
            </p>
            <p className="muted">
              Deficit is a plan, not a measured burn. All calories shown are
              estimates.
            </p>
          </article>
        </section>
        {plan.warnings.map((w) => (
          <p className="notice" key={w}>
            {w}
          </p>
        ))}
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE DAILY CHECK-IN</p>
              <h2>Keep the inputs simple.</h2>
            </div>
            <span className="muted">
              {dirty ? "Unsaved changes" : saved ? "Saved" : "Saved values"}
            </span>
          </div>
          <div className="grid three">
            <label>
              Morning weight · kg
              <input
                type="number"
                min="35"
                max="350"
                step="0.1"
                placeholder="Optional"
                value={draft.weight ?? ""}
                onChange={(e) =>
                  change(
                    "weight",
                    e.target.value === "" ? null : +e.target.value,
                  )
                }
              />
            </label>
            <label>
              Steps so far
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                placeholder={`Baseline ${profile.baselineSteps}`}
                value={draft.steps ?? ""}
                onChange={(e) =>
                  change(
                    "steps",
                    e.target.value === "" ? null : +e.target.value,
                  )
                }
              />
            </label>
            <label className="check training">
              <input
                type="checkbox"
                checked={draft.trained}
                onChange={(e) => change("trained", e.target.checked)}
              />
              <span>
                I trained today<small>Included in the weekly baseline</small>
              </span>
            </label>
          </div>
          <p className="muted">
            Weigh under similar conditions, ideally after waking and using the
            bathroom. A seven-day average reduces scale noise.
          </p>
        </section>
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">FOOD LOG</p>
              <h2>Everything you ate.</h2>
            </div>
            <strong>{fmt(plan.consumed)} kcal</strong>
          </div>
          {draft.meals.length ? (
            <ul className="meal-list">
              {draft.meals.map((m, i) => (
                <li key={m.id || i}>
                  <div>
                    <strong>{m.name}</strong>
                    <small>{fmt(m.protein || 0)} g protein</small>
                  </div>
                  <span>{fmt(m.cals)} kcal</span>
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    onClick={() => {
                      change(
                        "meals",
                        draft.meals.filter((_, j) => i !== j),
                      );
                      change("foodComplete", false);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">
              No food logged yet. A blank log is unknown intake, not zero
              calories.
            </p>
          )}
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
        </section>
        <section className="panel">
          <h2>Finish the day.</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.foodComplete}
              onChange={(e) => change("foodComplete", e.target.checked)}
            />
            Food log includes the whole day, including oils, drinks and snacks.
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
          <label>
            Notes · optional
            <textarea
              rows="2"
              maxLength={2000}
              placeholder="Anything affecting weight, appetite or recovery?"
              value={draft.notes}
              onChange={(e) => change("notes", e.target.value)}
            />
          </label>
          <div className="actions">
            <button className="primary">{busy ? "Saving…" : "Save day"}</button>
            <span className="muted" role="status">
              {dirty
                ? "Save before switching day or tab."
                : saved
                  ? "Day saved."
                  : "Only complete days inform calibration."}
            </span>
          </div>
        </section>
      </fieldset>
    </form>
  );
}

function MealEntry({ onAdd }) {
  const [mode, setMode] = useState("quick"),
    [query, setQuery] = useState(""),
    [foodId, setFoodId] = useState(""),
    [amount, setAmount] = useState("100");
  const [name, setName] = useState(""),
    [calories, setCalories] = useState(""),
    [protein, setProtein] = useState("");
  const [error, setError] = useState("");
  const matches = FOOD_DB.filter((f) =>
    f.name.toLowerCase().includes(query.toLowerCase()),
  );
  const food = FOOD_DB.find((f) => f.id === foodId);
  function add() {
    setError("");
    if (mode === "food") {
      if (
        !food ||
        !Number.isFinite(+amount) ||
        +amount <= 0 ||
        +amount > 10000
      ) {
        setError("Choose a food and enter a valid amount.");
        return;
      }
      onAdd(mealFromFood(food, +amount));
      return;
    }
    if (
      !name.trim() ||
      calories === "" ||
      !Number.isFinite(+calories) ||
      +calories < 0 ||
      +calories > 10000 ||
      !Number.isFinite(+protein) ||
      +protein < 0 ||
      +protein > 1000 ||
      +protein * 4 > +calories + 10
    ) {
      setError(
        "Enter a meal name, valid calories, and protein consistent with those calories.",
      );
      return;
    }
    onAdd({ name: name.trim(), cals: +calories, protein: +protein });
    setName("");
    setCalories("");
    setProtein("");
  }
  return (
    <div className="meal-entry">
      <div className="mode-switch">
        <button
          type="button"
          className={mode === "quick" ? "selected" : ""}
          onClick={() => setMode("quick")}
        >
          Quick entry
        </button>
        <button
          type="button"
          className={mode === "food" ? "selected" : ""}
          onClick={() => setMode("food")}
        >
          Food library
        </button>
      </div>
      {mode === "quick" ? (
        <div className="grid three">
          <label>
            Meal name
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lunch, snack, recipe…"
            />
          </label>
          <label>
            Calories
            <input
              type="number"
              min="0"
              max="10000"
              value={calories}
              onChange={(e) => setCalories(e.target.value)}
            />
          </label>
          <label>
            Protein · g
            <input
              type="number"
              min="0"
              max="1000"
              step="0.1"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
              placeholder="0"
            />
          </label>
        </div>
      ) : (
        <>
          <div className="grid three">
            <label>
              Search foods
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setFoodId("");
                }}
                placeholder="Rice, paneer, whey…"
              />
            </label>
            <label>
              Choose food
              <select
                value={foodId}
                onChange={(e) => {
                  setFoodId(e.target.value);
                  const f = FOOD_DB.find((f) => f.id === e.target.value);
                  setAmount(f?.unit === "g" || f?.unit === "ml" ? "100" : "1");
                }}
              >
                <option value="">Select…</option>
                {matches.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount · {food?.unit || "g"}
              <input
                type="number"
                min="0.1"
                max="10000"
                step="0.1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            Use the raw / dry weight unless the food name specifies cooked. Food
            values are estimates; use package values when available.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      <button type="button" onClick={add}>
        + Add food
      </button>
    </div>
  );
}
