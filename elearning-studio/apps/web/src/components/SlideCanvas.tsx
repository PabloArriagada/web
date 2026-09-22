import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderSlide } from "@studio/runtime";
import { parseAssetUri, type CourseProject, type Slide } from "@studio/schema";
import { assetContentUrl } from "../api/endpoints.js";

/**
 * Lienzo del editor: dibuja la pantalla con el MISMO renderizador del
 * Runtime (modo "static") y superpone zonas de selección. La edición
 * directa con arrastre/redimensión llega en la Fase 2.
 */
export function SlideCanvas(props: { project: CourseProject; slide: Slide; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { project, slide } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const pad = 32;
      const s = Math.min((wrap.clientWidth - pad) / slide.width, (wrap.clientHeight - pad) / slide.height);
      setScale(Math.max(0.1, Math.min(s, 1.5)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [slide.width, slide.height]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = renderSlide(slide, {
      mode: "static",
      theme: project.theme,
      resolveAsset: (src) => {
        const id = parseAssetUri(src);
        return id ? assetContentUrl(project.id, id) : src;
      },
    });
    stage.setAttribute("aria-hidden", "true");
    host.replaceChildren(stage);
  }, [slide, project.theme, project.id]);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <div className="canvas-frame" style={{ width: slide.width * scale, height: slide.height * scale }} onClick={() => props.onSelect(null)}>
        <div className="canvas-scale" style={{ width: slide.width, height: slide.height, transform: `scale(${scale})` }}>
          <div ref={hostRef} />
          <div className="hit-layer">
            {slide.elements.map((el) =>
              el.visible ? (
                <div
                  key={el.id}
                  className={`hit ${props.selectedId === el.id ? "selected" : ""}`}
                  style={{ left: el.x, top: el.y, width: el.width, height: el.height, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }}
                  title={el.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onSelect(el.id);
                  }}
                />
              ) : null,
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
