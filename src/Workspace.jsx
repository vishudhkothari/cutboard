import { useEffect, useState } from "react";
import { buildPlan, today } from "./lib/cutEngine";
import { emptyLog } from "./lib/data";
import {
  cloudEnabled,
  exportState,
  loadState,
  saveState,
} from "./lib/repository";
import ProfileForm from "./components/ProfileForm";
import DayEditor from "./components/DayEditor";
import Progress from "./components/Progress";
import PlanDetails from "./components/PlanDetails";
import "./styles.css";

export default function Workspace({ userId, onSignOut }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("today");
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [date, setDate] = useState(today());
  const [clockDate, setClockDate] = useState(today());
  const [dirty, setDirty] = useState(false);
  const [dayDraft, setDayDraft] = useState(null);
  const navigate = (action) => {
    if (saving) return;
    if (
      !dirty ||
      window.confirm(
        "You have unsaved changes. Leave this day and discard them?",
      )
    ) {
      setDirty(false);
      setDayDraft(null);
      action();
    }
  };
  useEffect(() => {
    const timer = setInterval(() => setClockDate(today()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    setState(null);
    loadState(userId)
      .then((s) => {
        if (!active) return;
        if (s.version !== 2 || !Array.isArray(s.logs))
          throw new Error("This backup format is not supported.");
        setState(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [userId, reload]);
  async function persist(next) {
    setSaving(true);
    setError("");
    try {
      await saveState(next, userId);
      setState(next);
      return true;
    } catch (e) {
      setError(`Save failed. Your changes are still in the form. ${e.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }
  if (!state)
    return (
      <div className="loading">
        {error || "Loading your plan…"}
        {error && (
          <button
            onClick={() => {
              setError("");
              setReload((n) => n + 1);
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  const profile = state.profile;
  const original = state.logs.find((l) => l.date === date) || emptyLog(date);
  const draft = dayDraft || original;
  const previewLogs = dayDraft
    ? [...state.logs.filter((l) => l.date !== date), dayDraft]
    : state.logs;
  const exportData = dayDraft ? { ...state, logs: previewLogs } : state;
  let plan, planError;
  if (profile) {
    try {
      plan = buildPlan(
        profile,
        tab === "today" ? previewLogs : state.logs,
        tab === "today" ? date : clockDate,
      );
    } catch (e) {
      planError = e.message;
    }
  }
  const showProfile =
    !profile || state.needsProfileReview || editing || !!planError;
  const log = state.logs.find((l) => l.date === date);
  return (
    <div className="app-shell">
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate(() => setTab("today"));
          }}
        >
          CUT<span>IQ</span>
          <small>LESS NOISE. MORE PROGRESS.</small>
        </a>
        <div className="header-actions">
          <span className="storage-label">
            {cloudEnabled ? "Account storage" : "On this device"}
          </span>
          <button onClick={() => exportState(exportData)}>Export data</button>
          {cloudEnabled && (
            <button
              onClick={() =>
                navigate(async () => {
                  const { error } = await onSignOut();
                  if (error) setError(error.message);
                })
              }
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      {showProfile ? (
        <>
          <div className="page-heading">
            <p className="eyebrow">ONE PLAN. ONE CALCULATION.</p>
            <h1>
              {profile ? "Make the plan yours." : "A simpler way to cut."}
            </h1>
            <p>
              Set your goal. Log food, weight and steps. Keep the deficit
              consistent.
            </p>
          </div>
          {state.needsProfileReview && (
            <p className="notice">
              Your old logs have been imported. Review the scale-weight goal and
              activity baseline before starting. Original account data is
              preserved; imported food logs need confirmation before
              calibration.
            </p>
          )}
          {planError && <p className="notice danger">{planError}</p>}
          <ProfileForm
            profile={profile}
            busy={saving}
            onCancel={
              plan && !state.needsProfileReview ? () => setEditing(false) : null
            }
            onSave={async (p) => {
              if (
                await persist({
                  ...state,
                  profile: p,
                  needsProfileReview: false,
                })
              ) {
                setEditing(false);
                setDate(clockDate);
              }
            }}
          />
        </>
      ) : (
        <>
          <nav aria-label="Main navigation">
            {["today", "progress", "plan"].map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                className={tab === t ? "selected" : ""}
                onClick={() => t !== tab && navigate(() => setTab(t))}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {plan.phase === "maintenance"
                  ? "THE CUT IS DONE. KEEP THE RESULT."
                  : "SMALL INPUTS. CONSISTENT DIRECTION."}
              </p>
              <h1>
                {tab === "today"
                  ? `${profile.name ? `${profile.name}, your` : "Your"} daily plan.`
                  : tab === "progress"
                    ? "Look at the trend."
                    : "Know your numbers."}
              </h1>
            </div>
            <span className={`phase ${plan.phase}`}>{plan.phase}</span>
          </div>
          {tab === "today" && (
            <>
              <label className="date-picker">
                Viewing day
                <input
                  aria-label="Viewing day"
                  type="date"
                  min={
                    profile.startDate <= clockDate
                      ? profile.startDate
                      : undefined
                  }
                  max={clockDate}
                  value={date}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value) navigate(() => setDate(value));
                  }}
                />
              </label>
              {date !== clockDate && (
                <button
                  className="text-button"
                  onClick={() => navigate(() => setDate(clockDate))}
                >
                  Back to today
                </button>
              )}
              <DayEditor
                key={`${date}-${JSON.stringify(log)}`}
                profile={profile}
                original={original}
                draft={draft}
                plan={plan}
                onChange={(update) =>
                  setDayDraft((previous) =>
                    typeof update === "function"
                      ? update(previous || original)
                      : update,
                  )
                }
                busy={saving}
                onDirty={setDirty}
                onSave={async (nextLog) => {
                  const logs = [
                    ...state.logs.filter((l) => l.date !== date),
                    nextLog,
                  ].sort((a, b) => a.date.localeCompare(b.date));
                  const updated = buildPlan(profile, logs, date);
                  const nextProfile =
                    updated.reachedDate && !profile.maintenanceSince
                      ? { ...profile, maintenanceSince: updated.reachedDate }
                      : profile;
                  const saved = await persist({
                    ...state,
                    profile: nextProfile,
                    logs,
                  });
                  if (saved) setDayDraft(null);
                  return saved;
                }}
              />
            </>
          )}
          {tab === "progress" && (
            <Progress
              profile={profile}
              logs={state.logs}
              date={clockDate}
              plan={plan}
            />
          )}
          {tab === "plan" && (
            <PlanDetails
              profile={profile}
              plan={plan}
              saving={saving}
              onEdit={() => setEditing(true)}
              onMaintenance={() =>
                persist({
                  ...state,
                  profile: { ...profile, maintenanceSince: clockDate },
                })
              }
            />
          )}
        </>
      )}
      <footer>
        CUTIQ · A clear plan, adjusted by evidence.
        {!cloudEnabled &&
          " Local data stays in this browser. Export a backup to keep it."}
      </footer>
    </div>
  );
}
