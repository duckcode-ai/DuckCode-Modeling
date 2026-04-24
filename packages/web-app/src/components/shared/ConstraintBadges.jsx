import React from "react";
import Icon from "../../design/icons";

function hasValue(value) {
  return value != null && String(value).trim() !== "";
}

export function getConstraintSpecs(column = {}) {
  const specs = [];
  if (column.pk) specs.push({ key: "pk", label: "PK", title: "Primary key", icon: Icon.Key, tone: "accent" });
  if (column.fk || column.semanticFk) {
    const target = column.fk || column.semanticFk || "";
    specs.push({
      key: "fk",
      label: "FK",
      title: target ? `Foreign key → ${target}` : "Foreign key",
      icon: Icon.Link,
      tone: "warning",
    });
  }
  if (column.nn) specs.push({ key: "nn", label: "NN", title: "Not null", icon: Icon.NotNull, tone: "info" });
  if (column.unique && !column.pk) specs.push({ key: "uq", label: "UQ", title: "Unique", icon: Icon.Unique, tone: "success" });
  if (column.generated) specs.push({ key: "gn", label: "GN", title: "Generated", icon: Icon.Generated, tone: "neutral" });
  if (hasValue(column.default)) {
    specs.push({
      key: "df",
      label: "DF",
      title: `Default ${column.default}`,
      icon: Icon.Default,
      tone: "neutral",
    });
  }
  if (hasValue(column.check)) {
    specs.push({
      key: "ck",
      label: "CK",
      title: `Check ${column.check}`,
      icon: Icon.Check2,
      tone: "warning",
    });
  }
  return specs;
}

export default function ConstraintBadges({
  column,
  className = "",
  size = 12,
  showEmpty = false,
  withLabels = false,
}) {
  const specs = getConstraintSpecs(column);
  if (specs.length === 0 && !showEmpty) return null;
  return (
    <div className={`constraint-badges ${className}`.trim()}>
      {specs.length === 0 ? (
        <span className="constraint-badge constraint-badge-empty" title="No constraints">
          ·
        </span>
      ) : specs.map((spec) => {
        const IconComponent = spec.icon;
        return (
          <span
            key={spec.key}
            className={`constraint-badge constraint-badge-${spec.key} constraint-badge-${spec.tone}`}
            title={spec.title}
          >
            <IconComponent width={size} height={size} />
            {withLabels && <span className="constraint-badge-label">{spec.label}</span>}
          </span>
        );
      })}
    </div>
  );
}
