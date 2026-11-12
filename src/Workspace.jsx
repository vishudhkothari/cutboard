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
import DashboardHeader from "./components/DashboardHeader";
import DateNavigation from "./components/DateNavigation";
import Icon from "./components/Icon";
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
      <DashboardHeader
        profile={profile}
        plan={plan}
        onToday={() =>
          navigate(() => {
            setTab("today");
            if (plan && !state.needsProfileReview) setEditing(false);
          })
        }
        onSettings={() => navigate(() => setEditing(true))}
        onExport={() => exportState(exportData)}
        onSignOut={
          cloudEnabled
            ? () =>
                navigate(async () => {
                  const { error } = await onSignOut();
                  if (error) setError(error.message);
                })
            : null
        }
      />
      <main className="workspace-content">
        {error && (
          <p className="notice danger" role="alert">
            {error}
          </p>
        )}
        {showProfile ? (
          <>
            <div className="page-heading profile-heading">
              <h1>{profile ? "Your profile" : "Set up your cut"}</h1>
              <p>
                Choose your goal and usual activity. You can adjust these later.
              </p>
            </div>
            {state.needsProfileReview && (
              <p className="notice">
                Your old logs have been imported. Review the scale-weight goal
                and activity baseline before starting. Original account data is
                preserved; imported food logs need confirmation before
                calibration.
              </p>
            )}
            {planError && <p className="notice danger">{planError}</p>}
            <ProfileForm
              profile={profile}
              busy={saving}
              onCancel={
                plan && !state.needsProfileReview
                  ? () => setEditing(false)
                  : null
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
            <nav className="main-nav" aria-label="Main navigation">
              {["today", "progress", "plan"].map((t) => (
                <button
                  key={t}
                  aria-current={tab === t ? "page" : undefined}
                  className={tab === t ? "selected" : ""}
                  onClick={() => t !== tab && navigate(() => setTab(t))}
                >
                  <Icon
                    name={
                      t === "today"
                        ? "clipboard"
                        : t === "progress"
                          ? "chart"
                          : "target"
                    }
                    size={19}
                  />
                  <span>
                    {t === "today"
                      ? "Today"
                      : t === "progress"
                        ? "Progress"
                        : "Plan"}
                  </span>
                </button>
              ))}
            </nav>
            {tab !== "today" && (
              <div className="view-heading">
                <div>
                  <h1>{tab === "progress" ? "Progress" : "Your plan"}</h1>
                  <p>
                    {tab === "progress"
                      ? "Your weight trend and the habits behind it."
                      : "Your baseline, daily target and what comes next."}
                  </p>
                </div>
                <span className={`phase ${plan.phase}`}>{plan.phase}</span>
              </div>
            )}
            {tab === "today" && (
              <>
                <DateNavigation
                  date={date}
                  currentDate={clockDate}
                  startDate={profile.startDate}
                  onChange={(value) => navigate(() => setDate(value))}
                />
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
          <span>CUTIQ</span>
          <span>
            {cloudEnabled
              ? "Private account storage"
              : "Saved on this device · Export a backup to keep it"}
          </span>
        </footer>
      </main>
    </div>
  );
}
