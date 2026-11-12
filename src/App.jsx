import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { cloudEnabled } from "./lib/repository";
import Auth from "./components/Auth";
import Workspace from "./Workspace";

export default function App() {
  const [session, setSession] = useState(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!cloudEnabled) return;
    let active = true;
    let authEventSeen = false;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || authEventSeen) return;
        if (error) setError(error.message);
        setSession(data.session);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setSession(null);
        }
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, next) => {
      authEventSeen = true;
      if (active) {
        setSession(next);
        setError("");
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  if (!cloudEnabled) return <Workspace key="local" />;
  if (session === undefined)
    return <div className="loading">Opening CUTIQ…</div>;
  if (!session) return <Auth error={error} />;
  // A different identity gets a new workspace. In-flight reads/writes and drafts
  // from the previous account cannot populate the next account's React state.
  return (
    <Workspace
      key={session.user.id}
      userId={session.user.id}
      onSignOut={() => supabase.auth.signOut()}
    />
  );
}
