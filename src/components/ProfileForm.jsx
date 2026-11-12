import { useState } from "react";
import { addDays, today, validateProfile } from "../lib/cutEngine";

export default function ProfileForm({ profile, onSave, onCancel, busy }) {
  const [form, setForm] = useState(
    profile || {
      name: "",
      age: "",
      height: "",
      sex: "male",
      startWeight: "",
      goalWeight: "",
      startDate: today(),
      goalDate: addDays(today(), 84),
      baselineSteps: 10000,
      gymDays: 5,
      gymMinutes: 60,
      maintenanceOverride: "",
    },
  );
  const [errors, setErrors] = useState([]);
  const set = (key, value) => setForm((p) => ({ ...p, [key]: value }));
  const fields = [
    ["age", "Age", 18, 100, 1],
    ["height", "Height · cm", 120, 230, 0.1],
    ["startWeight", "Start weight · kg", 40, 300, 0.1],
    ["goalWeight", "Goal weight · kg", 40, 300, 0.1],
    ["baselineSteps", "Usual steps / day", 0, 30000, 1],
    ["gymDays", "Gym days / week", 0, 7, 1],
    ["gymMinutes", "Minutes / gym session", 0, 180, 1],
  ];
  return (
    <form
      className="panel profile-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const next = { ...form };
        for (const [key] of fields) next[key] = +next[key];
        if (
          profile &&
          (next.startDate !== profile.startDate ||
            next.goalWeight !== profile.goalWeight)
        )
          delete next.maintenanceSince;
        if (
          profile &&
          next.startDate === profile.startDate &&
          [
            "age",
            "height",
            "sex",
            "startWeight",
            "baselineSteps",
            "gymDays",
            "gymMinutes",
            "maintenanceOverride",
          ].some(
            (key) => String(next[key] ?? "") !== String(profile[key] ?? ""),
          )
        )
          next.calibrationSince = today();
        if (profile && next.startDate !== profile.startDate)
          delete next.calibrationSince;
        const issues = validateProfile(next);
        setErrors(issues);
        if (!issues.length) await onSave(next);
      }}
    >
      <fieldset disabled={busy}>
        <div className="grid two">
          <label>
            Name
            <input
              maxLength={50}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <label>
            Sex used by energy equation
            <select
              value={form.sex}
              onChange={(e) => set("sex", e.target.value)}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
          {fields.map(([key, label, min, max, step]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                required
                min={min}
                max={max}
                step={step}
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
              />
            </label>
          ))}
          <label>
            Start date
            <input
              type="date"
              required
              value={form.startDate}
              onChange={(e) => set("startDate", e.target.value)}
            />
          </label>
          <label>
            Goal date
            <input
              type="date"
              required
              min={addDays(form.startDate || today(), 1)}
              value={form.goalDate}
              onChange={(e) => set("goalDate", e.target.value)}
            />
          </label>
        </div>
        <details>
          <summary>I already know my maintenance calories</summary>
          <label>
            Baseline maintenance · optional
            <input
              type="number"
              min="1200"
              max="6000"
              placeholder="Use calculated estimate"
              value={form.maintenanceOverride}
              onChange={(e) => set("maintenanceOverride", e.target.value)}
            />
          </label>
          <p className="muted">
            Only use a value supported by stable weight and complete food logs
            at your usual activity. This replaces the initial estimate; steps
            still adjust it.
          </p>
        </details>
        <p className="muted">
          Choose activity you can sustain. Gym is included in your baseline
          once; missing sessions repeatedly means this setting needs review.
          Changing the baseline restarts calibration using fresh logs.
        </p>
        {errors.map((error) => (
          <p role="alert" className="notice danger" key={error}>
            {error}
          </p>
        ))}
        <div className="actions">
          <button className="primary">
            {busy ? "Saving…" : "Save my plan"}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
