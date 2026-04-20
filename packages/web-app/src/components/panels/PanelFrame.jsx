/* PanelFrame — shared primitives that every bottom-drawer panel can adopt
   so they share one layout language (padding, section breathing, tone
   colours, table style) and track the active Luna theme automatically.

   Primitives exported:
     PanelFrame    — root wrapper with header (icon / eyebrow / title /
                     subtitle / status / actions) + optional toolbar +
                     scrollable body.
     PanelSection  — titled content group with count + trailing action.
     PanelCard     — labelled surface card with a semantic `tone`.
     StatusPill    — small pill badge (tones: neutral/accent/info/success/
                     warning/error).
     PanelEmpty    — centred icon + title + description for zero-state
                     views (reuses the existing EmptyState component).
     PanelToolbar  — horizontal bar above the body for search / filter
                     controls.
     KeyValueGrid  — responsive 2-column label/value grid.

   All primitives use Luna CSS variables exclusively, so they follow the
   active theme with no extra wiring. */
import React from "react";
import EmptyState from "../shared/EmptyState";

/* ──────────────────────────────────────────────────────────────────────── */
/* PanelFrame                                                               */
/* ──────────────────────────────────────────────────────────────────────── */
export function PanelFrame({
  icon,
  eyebrow,
  title,
  subtitle,
  status,
  actions,
  toolbar,
  bodyPadding = 14,
  children,
}) {
  return (
    <div className="panel-frame">
      <div className="panel-frame-header">
        <div className="panel-frame-heading">
          {icon && <span className="panel-frame-icon">{icon}</span>}
          <div className="panel-frame-title-col">
            {eyebrow && <div className="panel-frame-eyebrow">{eyebrow}</div>}
            <div className="panel-frame-title-row">
              {title && <h2 className="panel-frame-title">{title}</h2>}
              {status && <span className="panel-frame-status">{status}</span>}
            </div>
            {subtitle && <div className="panel-frame-subtitle">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="panel-frame-actions">{actions}</div>}
      </div>
      {toolbar && <div className="panel-frame-toolbar">{toolbar}</div>}
      <div className="panel-frame-body" style={{ padding: bodyPadding }}>
        {children}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* PanelSection                                                             */
/* ──────────────────────────────────────────────────────────────────────── */
export function PanelSection({
  title,
  count,
  icon,
  action,
  description,
  padded = true,
  children,
}) {
  return (
    <section className="panel-section">
      <header className="panel-section-header">
        <div className="panel-section-title-wrap">
          {icon && <span className="panel-section-icon">{icon}</span>}
          {title && <h3 className="panel-section-title">{title}</h3>}
          {typeof count === "number" && <span className="panel-section-count">{count}</span>}
        </div>
        {action && <div className="panel-section-action">{action}</div>}
      </header>
      {description && <p className="panel-section-desc">{description}</p>}
      <div className={`panel-section-body ${padded ? "padded" : ""}`}>{children}</div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* PanelCard                                                                */
/* ──────────────────────────────────────────────────────────────────────── */
export function PanelCard({
  title,
  eyebrow,
  subtitle,
  icon,
  actions,
  tone = "neutral", // neutral | accent | info | success | warning | error
  dense = false,
  children,
  className = "",
  ...rest
}) {
  return (
    <div className={`panel-card tone-${tone} ${dense ? "dense" : ""} ${className}`} {...rest}>
      {(title || eyebrow || subtitle || actions || icon) && (
        <div className="panel-card-header">
          <div className="panel-card-heading">
            {icon && <span className="panel-card-icon">{icon}</span>}
            <div className="panel-card-title-col">
              {eyebrow && <div className="panel-card-eyebrow">{eyebrow}</div>}
              {title && <div className="panel-card-title">{title}</div>}
              {subtitle && <div className="panel-card-subtitle">{subtitle}</div>}
            </div>
          </div>
          {actions && <div className="panel-card-actions">{actions}</div>}
        </div>
      )}
      {children != null && <div className="panel-card-body">{children}</div>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* StatusPill                                                               */
/* ──────────────────────────────────────────────────────────────────────── */
export function StatusPill({
  tone = "neutral", // neutral | accent | info | success | warning | error
  icon,
  children,
  className = "",
  ...rest
}) {
  return (
    <span className={`status-pill tone-${tone} ${className}`} {...rest}>
      {icon && <span className="status-pill-icon">{icon}</span>}
      {children}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* PanelEmpty                                                               */
/* ──────────────────────────────────────────────────────────────────────── */
export function PanelEmpty({ icon, title, description, action }) {
  return <EmptyState icon={icon} title={title} description={description} action={action} />;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* PanelToolbar                                                             */
/* ──────────────────────────────────────────────────────────────────────── */
export function PanelToolbar({ left, right, children, className = "" }) {
  return (
    <div className={`panel-toolbar ${className}`}>
      {left && <div className="panel-toolbar-left">{left}</div>}
      {children && <div className="panel-toolbar-center">{children}</div>}
      {right && <div className="panel-toolbar-right">{right}</div>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* KeyValueGrid                                                             */
/* Two-column label/value grid with a responsive fallback to one column on
   narrow drawers. Pass either `items={[{label, value}]}` or children.     */
/* ──────────────────────────────────────────────────────────────────────── */
export function KeyValueGrid({ items, columns = 2, children }) {
  if (items && items.length > 0) {
    return (
      <dl
        className="panel-kv-grid"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${columns === 1 ? "100%" : "220px"}, 1fr))` }}
      >
        {items.map((it, idx) => (
          <div key={idx} className="panel-kv-row">
            <dt className="panel-kv-label">{it.label}</dt>
            <dd className="panel-kv-value">{it.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl
      className="panel-kv-grid"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${columns === 1 ? "100%" : "220px"}, 1fr))` }}
    >
      {children}
    </dl>
  );
}

export default PanelFrame;
