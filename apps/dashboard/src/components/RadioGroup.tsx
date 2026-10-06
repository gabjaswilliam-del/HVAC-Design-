import { useRef, type ReactNode } from "react";

export interface RadioOption<T extends string> {
  value: T;
  label?: ReactNode;
  /** Accessible name when the label is an icon only. */
  name?: string;
  title?: string;
  disabled?: boolean;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A segmented control with radio semantics: one tab stop, arrow keys move and choose.
 * `value` may match no option (nothing chosen); the first option then takes the tab stop.
 */
export function RadioGroup<T extends string>({
  label,
  labelledBy,
  value,
  options,
  onChange,
  className = "",
}: {
  label?: string;
  labelledBy?: string;
  value: T | null;
  options: RadioOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  const current = enabled.findIndex((o) => o.value === value);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = STEP[e.key];
    if (!step || !enabled.length) return;
    e.preventDefault();
    const next = enabled[(Math.max(current, 0) + (current < 0 ? 0 : step) + enabled.length) % enabled.length];
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus());
  };

  return (
    <div ref={ref} className={`segmented ${className}`} role="radiogroup" aria-label={label} aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const checked = o.value === value;
        const tabbable = checked || (current < 0 && o === enabled[0]);
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            data-value={o.value}
            aria-checked={checked}
            aria-label={o.name}
            title={o.title}
            disabled={o.disabled}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
