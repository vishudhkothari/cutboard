import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Auth({ error: externalError }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [signup, setSignup] = useState(false);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth">
      <p className="brand">
        CUT<span>IQ</span>
      </p>
      <h1>
        Your cut.
        <br />
        Made clear.
      </h1>
      <p className="muted">
        One food target. Dynamic steps. A plan that learns.
      </p>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const { data, error } = signup
              ? await supabase.auth.signUp({ email, password })
              : await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            if (signup && !data.session)
              setMessage("Check your email to confirm your account.");
          } catch (e) {
            setMessage(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            minLength={6}
            autoComplete={signup ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
        </button>
        {(message || externalError) && (
          <p role="status">{message || externalError}</p>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => setSignup(!signup)}
        >
          {signup ? "Already have an account? Sign in" : "Create an account"}
        </button>
      </form>
    </div>
  );
}
