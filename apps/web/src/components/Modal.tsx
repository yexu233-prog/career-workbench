import { useEffect, type ReactNode } from "react";

export function Modal({ title, children, onClose, variant = "dialog" }: { title: string; children: ReactNode; onClose: () => void; variant?: "dialog" | "drawer" }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={`modal-backdrop${variant === "drawer" ? " drawer-backdrop" : ""}`} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className={`modal${variant === "drawer" ? " side-drawer" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header>
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}
