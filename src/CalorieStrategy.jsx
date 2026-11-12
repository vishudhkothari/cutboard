import { C, F, card, btn } from "./lib/theme";
import { STEP_KCAL_PER_1000 } from "./lib/planEngine";

const formatDate = (date) =>
  date
    ? new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      })
    : "—";

export default function CalorieStrategy({ plan, energy, onUseAutomatic }) {
  const quality = energy.calibration;
  const note =
    quality.status === "transition_hold"
      ? "Maintenance transition: holding calibration while water weight settles."
      : quality.status === "needs_data"
        ? "Recent records are incomplete or too noisy to recalibrate. Keep morning weigh-ins and mark food and steps complete."
        : !energy.isDataDriven
          ? "Starting from a formula estimate. Weekly learning begins after four weeks of complete food, steps and weight records."
          : "Maintenance learns from completed logs and weight trends. Each weekly correction is limited to 100 kcal; missing data holds the last learned estimate.";
  const row = (label, value, color = C.text) => (
    <div
      key={label}
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 0",
        borderBottom: `1px solid ${C.borderSoft}`,
        fontSize: 13,
      }}
    >
      <span style={{ color: C.textSub }}>{label}</span>
      <span style={{ fontFamily: F.mono, color, whiteSpace: "nowrap" }}>
        {value} kcal
      </span>
    </div>
  );
  return (
    <div style={card()}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontFamily: F.head, fontWeight: 700, fontSize: 16 }}>
          Calorie Strategy
        </div>
        <span
          style={{
            fontSize: 10,
            color: C.accent,
            background: `${C.accent}18`,
            border: `1px solid ${C.accent}44`,
            padding: "3px 10px",
            borderRadius: 20,
            fontWeight: 700,
          }}
        >
          {energy.isManual
            ? "MANUAL"
            : energy.isDataDriven
              ? "CALIBRATED ESTIMATE"
              : "FORMULA ESTIMATE"}
        </span>
      </div>
      {row("Baseline maintenance TDEE", energy.base)}
      {row(
        `Extra steps · ${STEP_KCAL_PER_1000} kcal / 1,000`,
        `${energy.stepCredit > 0 ? "+" : ""}${energy.stepCredit}`,
        C.teal,
      )}
      {row(
        plan.deficit >= 0 ? "Planned net deficit" : "Planned surplus",
        `${plan.deficit >= 0 ? "−" : "+"}${Math.abs(plan.deficit)}`,
        plan.deficit >= 0 ? C.red : C.orange,
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          padding: "14px 0 4px",
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        <span>Today's Target</span>
        <span
          style={{
            fontFamily: F.mono,
            color: C.accent,
            fontSize: 24,
            whiteSpace: "nowrap",
          }}
        >
          {plan.eatTarget} kcal
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          color: C.textSub,
          lineHeight: 1.55,
          marginTop: 12,
        }}
      >
        {energy.isManual
          ? "A fixed baseline food override is active. It will not adjust automatically as maintenance changes."
          : note}
      </div>
      {energy.isManual && (
        <button
          style={{ ...btn(false, true), marginTop: 10 }}
          onClick={onUseAutomatic}
        >
          Use adaptive target
        </button>
      )}
      <div
        style={{
          fontSize: 11,
          color: C.textFaint,
          lineHeight: 1.5,
          marginTop: 10,
        }}
      >
        Completed prior days: {quality.completeDays} · Weigh-ins:{" "}
        {quality.weighIns} · Next review: {formatDate(quality.nextReviewDate)}
      </div>
      {(energy.deadlineMissed || energy.goalTooAggressive) && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: C.orange,
            borderLeft: `3px solid ${C.orange}`,
            padding: "8px 11px",
            marginTop: 12,
            background: `${C.orange}12`,
            borderRadius: 8,
          }}
        >
          {energy.deadlineMissed
            ? "The deadline passed, but the goal is not confirmed. The cut continues within its limits; review the timeline."
            : energy.isManual
              ? "The timeline needs review. A fixed override does not follow automatic deficit limits; switch to adaptive for bounded planning."
              : "The selected timeline exceeds the planning limit. The automatic deficit is capped; a longer cut may be needed."}
        </div>
      )}
      {energy.phase === "cut" &&
        (energy.target <= energy.floor || plan.deficit <= 0) && (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: C.orange,
              marginTop: 12,
            }}
          >
            {energy.target <= energy.floor
              ? "The intake floor limits this plan. Food will not be reduced further to force the deadline."
              : "This allowance does not create a planned deficit. Review the fixed override or profile before relying on it for a cut."}
          </div>
        )}
      <div
        style={{
          fontSize: 11,
          color: C.textFaint,
          marginTop: 12,
          lineHeight: 1.5,
        }}
      >
        Food and activity calories are estimates. Review the weight trend over
        several weeks; one weigh-in cannot verify a deficit.
      </div>
    </div>
  );
}
