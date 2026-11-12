import { Component } from "react";
export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("CUTIQ render failed", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth">
        <h1>Unable to show this view.</h1>
        <p>Your saved data has not been cleared. Reload to try again.</p>
        <p className="notice danger">{String(this.state.error.message)}</p>
        <button onClick={() => window.location.reload()}>Reload CUTIQ</button>
      </div>
    );
  }
}
