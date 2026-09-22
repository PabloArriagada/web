import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetType } from "@studio/schema";
import { ApiError } from "../api/client.js";
import { api, assetContentUrl } from "../api/endpoints.js";
import type { AssetDto } from "../api/types.js";
import { Dialog } from "./Dialog.js";

const ICONS: Record<AssetType, string> = { image: "🖼", svg: "🖼", video: "🎬", audio: "🔊", font: "🔤", document: "📄", caption: "CC", transcript: "📝", source: "📦" };
const TYPE_NAMES: Record<AssetType, string> = { image: "Imagen", svg: "SVG", video: "Video", audio: "Audio", font: "Fuente", document: "Documento", caption: "Subtítulos", transcript: "Transcripción", source: "Fuente original" };
export const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.mp4,.webm,.mp3,.m4a,.ogg,.wav,.woff,.woff2,.ttf,.otf,.pdf,.vtt,.txt";

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * Asset Manager: subir (con progreso real), ver, buscar, reutilizar,
 * detectar duplicados y eliminar solo si no está en uso.
 */
export function AssetLibrary(props: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** Modo selección: filtra tipos y muestra "Insertar". */
  pick?: { types: AssetType[]; label: string; onPick: (a: AssetDto) => void } | null;
  onChanged: () => void;
}) {
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [messages, setMessages] = useState<Array<{ kind: "ok" | "error" | "info"; text: string }>>([]);
  const [over, setOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => api.listAssets(props.projectId).then((r) => setAssets(r.assets)).catch((e: Error) => setMessages([{ kind: "error", text: e.message }])), [props.projectId]);
  useEffect(() => {
    if (props.open) void load();
  }, [props.open, load]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress(0);
    setMessages([]);
    const msgs: typeof messages = [];
    // Un archivo por solicitud: un error no invalida los demás.
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      try {
        const r = await api.uploadAssets(props.projectId, [f], (x) => setProgress((i + x) / files.length), ctrl.signal);
        for (const res of r.results) msgs.push(res.duplicate ? { kind: "info", text: `"${f.name}" ya existía en la biblioteca (${res.asset.filename}); se reutiliza.` } : { kind: "ok", text: `"${f.name}" subido.` });
      } catch (e) {
        msgs.push({ kind: "error", text: `"${f.name}": ${e instanceof ApiError || e instanceof Error ? e.message : String(e)}` });
        if (e instanceof ApiError && e.code === "aborted") break;
      }
    }
    setProgress(null);
    abortRef.current = null;
    setMessages(msgs);
    await load();
    props.onChanged();
  };

  const remove = async (a: AssetDto) => {
    if (!confirm(`¿Eliminar "${a.filename}" de la biblioteca?`)) return;
    try {
      await api.deleteAsset(props.projectId, a.id);
      await load();
      props.onChanged();
    } catch (e) {
      setMessages([{ kind: "error", text: e instanceof Error ? e.message : String(e) }]);
    }
  };

  const visible = assets.filter((a) => (!props.pick || props.pick.types.includes(a.type)) && a.filename.toLowerCase().includes(query.toLowerCase()));

  return (
    <Dialog title={props.pick ? props.pick.label : "Biblioteca de recursos"} open={props.open} onClose={() => { abortRef.current?.abort(); props.onClose(); }}>
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload([...e.dataTransfer.files]);
        }}
      >
        <p>Arrastra archivos aquí o</p>
        <label className="btn btn-primary">
          Seleccionar archivos
          <input type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </label>
        <p className="hint">Imágenes, SVG, video, audio, subtítulos VTT, fuentes y PDF. Los archivos se suben directo al almacenamiento (sin Base64).</p>
        {progress !== null && (
          <div aria-live="polite">
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Progreso de subida">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="hint">Subiendo… {Math.round(progress * 100)}%</span>{" "}
            <button className="btn btn-sm" onClick={() => abortRef.current?.abort()}>
              Cancelar
            </button>
          </div>
        )}
      </div>
      <div aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`alert ${m.kind === "error" ? "" : "info"}`} role={m.kind === "error" ? "alert" : undefined}>
            {m.text}
          </div>
        ))}
      </div>
      <label className="field">
        <span>Buscar</span>
        <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre del archivo" />
      </label>
      {visible.length === 0 ? (
        <div className="empty">{assets.length ? "Ningún recurso coincide." : "La biblioteca está vacía."}</div>
      ) : (
        <div className="asset-grid">
          {visible.map((a) => (
            <article key={a.id} className="asset">
              <div className="thumb">
                {a.type === "image" || a.type === "svg" ? <img src={assetContentUrl(props.projectId, a.id)} alt="" loading="lazy" /> : <span aria-hidden="true">{ICONS[a.type]}</span>}
              </div>
              <div className="info">
                <strong>{a.filename}</strong>
                <span>
                  {TYPE_NAMES[a.type]} · {fmtBytes(a.size)}
                  {typeof a.metadata["width"] === "number" ? ` · ${String(a.metadata["width"])}×${String(a.metadata["height"])}` : ""}
                </span>
                <span title={a.usage.map((u) => `${u.slideTitle} › ${u.elementName}`).join("\n")}>
                  {a.usage.length ? `En uso: ${a.usage.length} ${a.usage.length === 1 ? "lugar" : "lugares"}` : "Sin uso"}
                </span>
              </div>
              <div className="actions">
                {props.pick && (
                  <button className="btn btn-primary btn-sm" onClick={() => props.pick?.onPick(a)}>
                    Insertar
                  </button>
                )}
                <a className="btn btn-sm" href={assetContentUrl(props.projectId, a.id)} target="_blank" rel="noopener">
                  Ver
                </a>
                <button className="btn btn-sm btn-danger" disabled={a.usage.length > 0} title={a.usage.length ? "No se puede eliminar: está en uso" : "Eliminar"} onClick={() => void remove(a)}>
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Dialog>
  );
}
