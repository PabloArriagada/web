import { useEffect, useState } from "react";
import { contrastRatio, normalizeHex } from "../lib/color.js";

const RECENT_KEY = "studio-recent-colors";

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function pushRecent(c: string) {
  try {
    const list = [c, ...readRecent().filter((x) => x !== c)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento local */
  }
}

/** Selector de color: visual + HEX + colores del proyecto + recientes + contraste. */
export function ColorField(props: { label: string; value: string; onChange: (hex: string) => void; projectColors: string[]; contrastWith?: string }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const commit = (v: string) => {
    const hex = normalizeHex(v);
    if (hex) {
      props.onChange(hex);
      pushRecent(hex);
    } else setText(props.value);
  };
  const ratio = props.contrastWith ? contrastRatio(props.value, props.contrastWith) : null;
  const recent = readRecent().filter((c) => !props.projectColors.includes(c));
  const id = `c-${props.label.replace(/\W+/g, "-")}`;
  return (
    <div className="field">
      <span id={id}>{props.label}</span>
      <div className="color-field">
        <input type="color" aria-labelledby={id} value={normalizeHex(props.value) ?? "#000000"} onChange={(e) => commit(e.target.value)} />
        <input
          className="input"
          aria-label={`${props.label} (HEX)`}
          value={text}
          maxLength={9}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
        />
      </div>
      <div className="swatches" role="group" aria-label="Colores del proyecto y recientes">
        {[...props.projectColors, ...recent].map((c) => (
          <button key={c} type="button" className="swatch" style={{ background: c }} title={c} aria-label={`Usar ${c}`} onClick={() => commit(c)} />
        ))}
      </div>
      {ratio !== null && (
        <span className={`contrast ${ratio < 4.5 ? "bad" : ""}`}>
          Contraste {ratio.toFixed(2)}:1 {ratio < 4.5 ? "· insuficiente para texto normal (WCAG AA 4.5:1)" : "· cumple WCAG AA"}
        </span>
      )}
    </div>
  );
}
