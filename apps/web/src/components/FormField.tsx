import type { ReactNode } from "react";

export function FormField({ label, hint, children, wide = false }: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`form-field${wide ? " wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
