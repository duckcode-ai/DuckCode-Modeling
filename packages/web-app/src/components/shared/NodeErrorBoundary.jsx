import React from "react";

// Wraps a single diagram node so a bad render (e.g. a malformed field in
// one entity) surfaces as a red "malformed entity" chip instead of
// blanking the entire canvas. React error boundaries only catch errors
// during render of their children, which is exactly the granularity we
// want: one table card failing must not take the whole Canvas with it.
export default class NodeErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep a console breadcrumb — useful when debugging why a specific
    // entity fell through. Not fatal, and the fallback below already
    // tells the user which entity misbehaved.
    // eslint-disable-next-line no-console
    console.error("[NodeErrorBoundary]", this.props.label || "node", error, info);
  }

  render() {
    if (this.state.error) {
      const label = this.props.label || "entity";
      const msg = this.state.error?.message || String(this.state.error);
      return (
        <div
          className="node-error-chip"
          title={`Malformed ${label}: ${msg}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #ef4444",
            background: "rgba(239,68,68,0.10)",
            color: "#ef4444",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.02em",
            maxWidth: 220,
            ...(this.props.style || {}),
          }}
        >
          <span aria-hidden="true">⚠</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            malformed {label}
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}
