import React from "react";

/** Labeled form field used across all inspectors. Keeps spacing/type consistent. */
export function InspectorField({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1 px-3 py-2">
      <span className="t-overline text-text-muted">{label}</span>
      {children}
      {hint && <span className="t-caption text-text-muted">{hint}</span>}
    </label>
  );
}

export function InspectorSection({ title, children }) {
  return (
    <div className="border-b border-border-primary last:border-b-0">
      {title && (
        <div className="px-3 pt-3 pb-1 t-overline text-text-muted">{title}</div>
      )}
      <div className="pb-2">{children}</div>
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, readOnly, type = "text" }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className="h-8 px-2 rounded-md border border-border-primary bg-bg-primary text-sm text-text-primary outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/20 transition-colors disabled:opacity-60 read-only:opacity-70"
    />
  );
}

export function SelectInput({ value, onChange, options, readOnly }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={readOnly}
      className="h-8 px-2 rounded-md border border-border-primary bg-bg-primary text-sm text-text-primary outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/20 transition-colors disabled:opacity-60"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

export function CheckboxInput({ checked, onChange, label, readOnly }) {
  return (
    <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-bg-hover transition-colors">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={readOnly}
        className="accent-accent-blue"
      />
      <span className="text-sm text-text-secondary">{label}</span>
    </label>
  );
}

export function TextareaInput({ value, onChange, rows = 3, placeholder, readOnly }) {
  return (
    <textarea
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      readOnly={readOnly}
      className="px-2 py-1.5 rounded-md border border-border-primary bg-bg-primary text-sm text-text-primary outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/20 transition-colors resize-y"
    />
  );
}
