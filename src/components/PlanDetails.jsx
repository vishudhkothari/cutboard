const fmt = (n) => Math.round(n).toLocaleString("en-IN");
export default function PlanDetails({
  profile,
  plan,
  saving,
  onEdit,
  onMaintenance,
}) {
  return (
    <>
      <section className="grid two">
        <article className="panel">
          <p className="eyebrow">YOUR BASELINE</p>
          <h2>
            {fmt(plan.baselineMaintenance)} <small>kcal / day</small>
          </h2>
          <dl>
            <div>
              <dt>Resting energy estimate</dt>
              <dd>{fmt(plan.bmr)} kcal</dd>
            </div>
            <div>
              <dt>Usual daily steps</dt>
              <dd>{fmt(profile.baselineSteps)}</dd>
            </div>
            <div>
              <dt>Usual training</dt>
              <dd>
                {profile.gymDays} × {profile.gymMinutes} min / week
              </dd>
            </div>
            <div>
              <dt>Goal</dt>
              <dd>
                {profile.goalWeight} kg · {profile.goalDate}
              </dd>
            </div>
            <div>
              <dt>Model review</dt>
              <dd>{plan.nextReview}</dd>
            </div>
          </dl>
          <p className="muted">{plan.calibration.reason}</p>
          <button onClick={onEdit}>Edit plan</button>
        </article>
        <article className="panel">
          <p className="eyebrow">THE RULE</p>
          <h2>
            Move more. Eat more.
            <br />
            Keep the deficit.
          </h2>
          <p>
            Food target = baseline maintenance + step adjustment − planned
            deficit.
          </p>
          <p>
            Only steps above or below your baseline change this allowance. Gym
            sessions are averaged into baseline maintenance once. The training
            check-in never adds a second calorie credit.
          </p>
          <p>
            The baseline assumes your usual steps until the day is marked
            complete. Then a shortfall lowers the allowance, subject to the food
            minimum.
          </p>
          <p className="muted">
            Step calories are estimates based on body weight, height and level
            walking. Inclines, running, carried weight and individual efficiency
            vary. Calibration adjusts baseline expenditure; it cannot measure
            the exact burn of an extra walk.
          </p>
        </article>
      </section>
      <section className="panel">
        <p className="eyebrow">AFTER THE CUT</p>
        <h2>Maintenance is part of the plan.</h2>
        <p>
          A seven-day average with at least three weigh-ins at or below your
          goal ends the cut after the first week. The app moves directly to
          estimated maintenance and keeps that phase active as weight
          fluctuates. Keep logging to refine the estimate over the following
          weeks.
        </p>
        <p>
          Reaching the deadline alone does not mean the goal was achieved. If
          needed, extend it or start maintenance deliberately.
        </p>
        {plan.phase !== "maintenance" && (
          <button disabled={saving} onClick={onMaintenance}>
            Start maintenance today
          </button>
        )}
        <p className="muted">
          To begin a later cut, edit the plan with a new start weight, goal and
          dates.
        </p>
      </section>
      <details className="panel">
        <summary>Evidence and model limits</summary>
        <p>
          The app estimates energy balance, not guaranteed fat loss. A fixed
          7,700 kcal/kg is a short-term planning approximation; water changes
          and metabolic adaptation prevent exact predictions. Targets are
          reviewed weekly, using complete logs and bounded calibration after
          four weeks.
        </p>
        <p>
          The 0.75% weekly loss cap, 25% deficit cap and 1,500 / 1,200 kcal
          intake minima are conservative product rules, not personalized
          clinical thresholds. Protein starts at 2 g/kg during cutting and 1.8
          g/kg during maintenance, using goal-adjusted weight and bounded to fit
          the calorie budget.
        </p>
        <ul>
          <li>
            <a
              href="https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner"
              target="_blank"
              rel="noreferrer"
            >
              NIH: energy balance and maintenance planning
            </a>
          </li>
          <li>
            <a
              href="https://pubmed.ncbi.nlm.nih.gov/2305711/"
              target="_blank"
              rel="noreferrer"
            >
              Mifflin–St Jeor resting energy equation
            </a>
          </li>
          <li>
            <a
              href="https://pacompendium.com/adult-compendium/"
              target="_blank"
              rel="noreferrer"
            >
              2024 physical activity compendium
            </a>
          </li>
          <li>
            <a
              href="https://pubmed.ncbi.nlm.nih.gov/34453886/"
              target="_blank"
              rel="noreferrer"
            >
              Activity compensation varies between people
            </a>
          </li>
          <li>
            <a
              href="https://doi.org/10.1080/15502783.2025.2550185"
              target="_blank"
              rel="noreferrer"
            >
              2025 preliminary reverse-dieting trial
            </a>
          </li>
        </ul>
      </details>
    </>
  );
}
