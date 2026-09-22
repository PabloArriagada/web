import { createId } from "./ids.js";
import {
  SCHEMA_VERSION,
  type AudioElement,
  type ButtonElement,
  type CourseModule,
  type CourseProject,
  type ImageElement,
  type PublicationProfile,
  type ShapeElement,
  type ShapeKind,
  type Slide,
  type TextElement,
  type TextStyle,
  type Theme,
  type VideoElement,
} from "./model.js";

export const DEFAULT_STAGE = { width: 1280, height: 720 } as const;

/** Identidad corporativa por defecto. */
export function createDefaultTheme(): Theme {
  return {
    colors: {
      primary: "#003a5d",
      primaryDark: "#002b46",
      accent: "#36b9d6",
      danger: "#bd1550",
      background: "#ffffff",
      surface: "#f2f5f7",
      text: "#1d2b36",
    },
    fonts: { heading: "Montserrat", body: "Montserrat" },
    projectColors: ["#003a5d", "#002b46", "#36b9d6", "#bd1550", "#ffffff", "#f2f5f7"],
  };
}

export function createDefaultProfiles(): PublicationProfile[] {
  return [
    {
      id: createId("pub"),
      name: "Moodle · SCORM 1.2",
      standard: "scorm12",
      lms: "moodle",
      completion: { rule: "all-slides", percent: 100 },
      passing: { enabled: false, threshold: 80 },
      maxAttempts: 0,
    },
    {
      id: createId("pub"),
      name: "LMS genérico · SCORM 2004 4ª ed.",
      standard: "scorm2004",
      lms: "generic",
      completion: { rule: "all-slides", percent: 100 },
      passing: { enabled: false, threshold: 80 },
      maxAttempts: 0,
    },
  ];
}

export function defaultTextStyle(theme: Theme, overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: theme.fonts.body,
    fontSize: 24,
    color: theme.colors.text,
    bold: false,
    italic: false,
    underline: false,
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.4,
    ...overrides,
  };
}

export function createSlide(
  title: string,
  stage: { width: number; height: number } = DEFAULT_STAGE,
  background = "#ffffff",
): Slide {
  return {
    id: createId("sld"),
    title,
    width: stage.width,
    height: stage.height,
    background: { type: "solid", color: background },
    duration: 0,
    elements: [],
    layers: [{ id: createId("lyr"), name: "Base", kind: "base", visible: true, locked: false }],
    timeline: [],
    interactions: [],
    notes: "",
    accessibility: {},
  };
}

export function createModule(title: string, order: number, slides: Slide[] = []): CourseModule {
  return { id: createId("mod"), title, order, slides };
}

export function createProject(input: { title: string; locale?: string; description?: string }): CourseProject {
  const theme = createDefaultTheme();
  const cover = createSlide("Portada");
  const baseLayer = cover.layers[0]!.id;
  cover.elements.push(
    createTextElement(theme, baseLayer, {
      name: "Título",
      text: input.title,
      x: 120,
      y: 280,
      width: 1040,
      height: 120,
      role: "heading-1",
      style: defaultTextStyle(theme, { fontSize: 56, bold: true, color: theme.colors.primary, align: "center" }),
    }),
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId("prj"),
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    locale: input.locale ?? "es",
    stage: { ...DEFAULT_STAGE },
    theme,
    player: { showMenu: true, showProgress: true, showNavigation: true, navigation: "free", resume: "ask" },
    modules: [createModule("Módulo 1", 0, [cover])],
    assets: [],
    variables: [],
    assessments: [],
    publicationProfiles: createDefaultProfiles(),
    metadata: {},
  };
}

type Common = { name?: string; x?: number; y?: number; width?: number; height?: number };

function base(layerId: string, name: string, c: Common, w: number, h: number) {
  return {
    id: createId("el"),
    name: c.name ?? name,
    x: c.x ?? 80,
    y: c.y ?? 80,
    width: c.width ?? w,
    height: c.height ?? h,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    layerId,
    accessibility: { decorative: false },
  };
}

export function createTextElement(
  theme: Theme,
  layerId: string,
  o: Common & { text?: string; style?: TextStyle; role?: TextElement["role"] } = {},
): TextElement {
  return {
    ...base(layerId, "Texto", o, 480, 80),
    type: "text",
    text: o.text ?? "Nuevo texto",
    style: o.style ?? defaultTextStyle(theme),
    padding: 8,
    role: o.role ?? "paragraph",
  };
}

export function createShapeElement(
  theme: Theme,
  layerId: string,
  o: Common & { shape?: ShapeKind; color?: string } = {},
): ShapeElement {
  const shape = o.shape ?? "rectangle";
  return {
    ...base(layerId, "Forma", o, 240, 160),
    type: "shape",
    shape,
    fill: { type: "solid", color: o.color ?? theme.colors.accent },
    cornerRadius: shape === "rounded-rectangle" ? 16 : 0,
    text: "",
    accessibility: { decorative: true },
  };
}

export function createImageElement(layerId: string, src: string, o: Common & { alt?: string } = {}): ImageElement {
  return {
    ...base(layerId, "Imagen", o, 400, 300),
    type: "image",
    src,
    fit: "contain",
    accessibility: { decorative: false, ...(o.alt !== undefined ? { altText: o.alt } : {}) },
  };
}

export function createButtonElement(
  theme: Theme,
  layerId: string,
  o: Common & { label?: string; action?: ButtonElement["action"] } = {},
): ButtonElement {
  return {
    ...base(layerId, "Botón", o, 220, 56),
    type: "button",
    label: o.label ?? "Continuar",
    style: defaultTextStyle(theme, { color: "#ffffff", bold: true, align: "center", verticalAlign: "middle", fontSize: 20 }),
    fill: { type: "solid", color: theme.colors.primary },
    cornerRadius: 8,
    action: o.action ?? { type: "next" },
  };
}

export function createVideoElement(layerId: string, src: string, o: Common = {}): VideoElement {
  return {
    ...base(layerId, "Video", o, 640, 360),
    type: "video",
    src,
    captions: [],
    controls: true,
    autoplay: false,
    loop: false,
    muted: false,
  };
}

export function createAudioElement(layerId: string, src: string, o: Common = {}): AudioElement {
  return {
    ...base(layerId, "Audio", o, 320, 54),
    type: "audio",
    src,
    controls: true,
    autoplay: false,
    loop: false,
  };
}
