/* Shared modal chrome.
   Renders a consistent overlay + card + header + body + footer using the
   `.dlx-modal-*` primitives in `datalex-integration.css`. Replaces the
   hand-rolled Tailwind dialog shells that each project modal previously
   carried. All theme-aware, all keyboard-aware, no styling drift.

   Features:
     - Escape closes
     - Click-outside-card closes
     - Focus trapped to the card while open
     - First focusable element auto-focused on open
     - Prevents background page scroll while open
     - Sizes: sm (380) / md (480 default 420) / lg (620) / xl (780) */
import React from "react";
import { X } from "lucide-react";

const SIZE_CLASS = { sm: "sm", md: "md", lg: "lg", xl: "xl", default: "" };

function focusableElements(root) {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export default function Modal({
  icon,
  title,
  subtitle,
  size = "default",
  onClose,
  closeOnBackdrop = true,
  closeOnEscape = true,
  bodyClassName = "",
  cardClassName = "",
  header, // optional override — if provided, replaces the default header row
  footer, // optional footer node; rendered inside `.dlx-modal-footer`
  footerStatus, // optional small status text on the left of the footer
  footerAlign = "end", // "end" | "between"
  children,
}) {
  const cardRef = React.useRef(null);

  // Escape + focus management.
  React.useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e) => {
      if (closeOnEscape && e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === "Tab" && cardRef.current) {
        const focusables = focusableElements(cardRef.current);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);

    // Auto-focus the first focusable on mount (skip if something is already
    // inside the card — e.g. autoFocus on an input).
    requestAnimationFrame(() => {
      if (!cardRef.current) return;
      if (cardRef.current.contains(document.activeElement)) return;
      const focusables = focusableElements(cardRef.current);
      focusables[0]?.focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, closeOnEscape]);

  const handleBackdrop = (e) => {
    if (!closeOnBackdrop) return;
    if (e.target === e.currentTarget) onClose?.();
  };

  const sizeClass = SIZE_CLASS[size] || "";
  const footerClass = footerAlign === "between" ? "between" : "";

  return (
    <div
      className="dlx-modal-overlay"
      onMouseDown={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div
        ref={cardRef}
        className={`dlx-modal-card ${sizeClass} ${cardClassName}`.trim()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {header !== undefined ? (
          header
        ) : (
          <div className="dlx-modal-header">
            <div className="dlx-modal-title-group">
              {icon && <span className="dlx-modal-icon">{icon}</span>}
              <div style={{ minWidth: 0 }}>
                <div className="dlx-modal-title">{title}</div>
                {subtitle && <div className="dlx-modal-subtitle">{subtitle}</div>}
              </div>
            </div>
            {onClose && (
              <button
                type="button"
                className="dlx-modal-close"
                onClick={onClose}
                aria-label="Close"
                title="Close"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        <div className={`dlx-modal-body ${bodyClassName}`.trim()}>
          {children}
        </div>

        {footer && (
          <div className={`dlx-modal-footer ${footerClass}`.trim()}>
            {footerStatus && (
              <span className="dlx-modal-footer-status">{footerStatus}</span>
            )}
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* Small helper — renders a checkbox row styled via `.dlx-check`. Use this
   instead of raw <label><input type="checkbox"/></label> to get theming,
   hover, checked state, and focus rings for free. */
export function ModalCheckbox({ checked, onChange, disabled, children, title }) {
  return (
    <label className={`dlx-check ${checked ? "on" : ""}`} title={title}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
      />
      <span className="dlx-check-text">{children}</span>
    </label>
  );
}
