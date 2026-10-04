import type { ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";

const ICONS = { info: Info, warning: TriangleAlert, critical: CircleAlert };

/** Inline status message with an optional action. Critical/warning are announced. */
export function Notice({
  tone,
  children,
  action,
}: {
  tone: "info" | "warning" | "critical";
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const Icon = ICONS[tone];
  return (
    <div className={`notice notice--${tone}`} role={tone === "info" ? "status" : "alert"}>
      <Icon size={18} aria-hidden="true" />
      <div className="notice__body">{children}</div>
      {action && (
        <button type="button" className="button button--small" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
