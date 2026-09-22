import { useEffect, useRef, type ReactNode } from "react";

/** Modal accesible basado en <dialog> (foco atrapado y Escape nativos). */
export function Dialog(props: { title: string; open: boolean; onClose: () => void; size?: "sm" | "md" | "lg"; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className={`dlg ${props.size ?? "lg"}`}
      aria-labelledby="dlg-title"
      onClose={props.onClose}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      {props.open && (
        <>
          <div className="dlg-head">
            <h2 id="dlg-title">{props.title}</h2>
            <button type="button" className="btn btn-ghost btn-icon" onClick={props.onClose} aria-label="Cerrar">
              ✕
            </button>
          </div>
          <div className="dlg-body">{props.children}</div>
          {props.footer && <div className="dlg-foot">{props.footer}</div>}
        </>
      )}
    </dialog>
  );
}
