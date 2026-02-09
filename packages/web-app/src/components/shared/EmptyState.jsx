import React from "react";

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      {Icon && <Icon size={36} className="text-text-muted/40 mb-3" />}
      {title && <p className="text-sm font-medium text-text-secondary mb-1">{title}</p>}
      {description && <p className="text-xs text-text-muted max-w-[240px]">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
