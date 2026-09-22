/**
 * Modelo tipado del proyecto editable (archivo maestro).
 *
 * El SCORM nunca es el archivo maestro: este documento lo es. Los binarios
 * (imágenes, video, audio, fuentes…) NO viven aquí; los elementos los
 * referencian mediante URIs internas `asset://<assetId>` que el publicador
 * reescribe a rutas relativas del paquete.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0";

/* ------------------------------------------------------------------ */
/* Primitivas                                                          */
/* ------------------------------------------------------------------ */

export const ASSET_URI_PREFIX = "asset://";
const ID_RE = /^[a-z]{2,4}_[a-z0-9]{8,32}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ASSET_URI_RE = /^asset:\/\/[a-z]{2,4}_[a-z0-9]{8,32}$/;

export const IdSchema = z.string().regex(ID_RE, "Identificador inválido");
export const ColorSchema = z.string().regex(HEX_COLOR_RE, "Color HEX inválido");
export const AssetUriSchema = z.string().regex(ASSET_URI_RE, "Referencia de asset inválida");

export const FillSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("solid"), color: ColorSchema }),
  z.object({
    type: z.literal("linear-gradient"),
    angle: z.number().min(0).max(360),
    stops: z
      .array(z.object({ offset: z.number().min(0).max(1), color: ColorSchema }))
      .min(2)
      .max(8),
  }),
  z.object({
    type: z.literal("image"),
    src: AssetUriSchema,
    fit: z.enum(["cover", "contain", "fill"]),
    color: ColorSchema.optional(),
  }),
]);
export type Fill = z.infer<typeof FillSchema>;

export const StrokeSchema = z.object({
  color: ColorSchema,
  width: z.number().min(0).max(100),
  dash: z.enum(["solid", "dashed", "dotted"]).default("solid"),
});
export type Stroke = z.infer<typeof StrokeSchema>;

export const TextStyleSchema = z.object({
  fontFamily: z.string().min(1).max(120),
  fontSize: z.number().min(6).max(400),
  color: ColorSchema,
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  align: z.enum(["left", "center", "right", "justify"]),
  verticalAlign: z.enum(["top", "middle", "bottom"]),
  lineHeight: z.number().min(0.5).max(5),
  background: ColorSchema.optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const AccessibilitySchema = z.object({
  /** Texto alternativo / nombre accesible. */
  altText: z.string().max(1000).optional(),
  /** Elemento puramente decorativo: se oculta a lectores de pantalla. */
  decorative: z.boolean().default(false),
  /** Orden de foco explícito (Fase 7: editor de orden de foco). */
  tabOrder: z.number().int().min(0).optional(),
});
export type ElementAccessibility = z.infer<typeof AccessibilitySchema>;

/* ------------------------------------------------------------------ */
/* Elementos                                                           */
/* ------------------------------------------------------------------ */

const ElementBase = {
  id: IdSchema,
  name: z.string().min(1).max(200),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(1),
  height: z.number().finite().min(1),
  rotation: z.number().finite().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  /** Capa de la pantalla a la que pertenece. */
  layerId: IdSchema,
  accessibility: AccessibilitySchema.default({ decorative: false }),
};

export const ShapeKindSchema = z.enum([
  "rectangle",
  "rounded-rectangle",
  "ellipse",
  "triangle",
  "diamond",
  "pentagon",
  "hexagon",
  "star",
  "arrow-right",
  "arrow-left",
  "line",
]);
export type ShapeKind = z.infer<typeof ShapeKindSchema>;

export const TextElementSchema = z.object({
  ...ElementBase,
  type: z.literal("text"),
  text: z.string().max(20000),
  style: TextStyleSchema,
  padding: z.number().min(0).max(200).default(8),
  /** Semántica para lectores de pantalla. */
  role: z.enum(["paragraph", "heading-1", "heading-2", "heading-3"]).default("paragraph"),
});

export const ImageElementSchema = z.object({
  ...ElementBase,
  type: z.literal("image"),
  src: AssetUriSchema,
  fit: z.enum(["contain", "cover", "fill"]).default("contain"),
});

export const ShapeElementSchema = z.object({
  ...ElementBase,
  type: z.literal("shape"),
  shape: ShapeKindSchema,
  fill: FillSchema,
  stroke: StrokeSchema.optional(),
  cornerRadius: z.number().min(0).max(500).default(0),
  text: z.string().max(5000).default(""),
  textStyle: TextStyleSchema.optional(),
});

export const NavigationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("previous") }),
  z.object({ type: z.literal("goto-slide"), slideId: IdSchema }),
  z.object({ type: z.literal("none") }),
]);
export type NavigationAction = z.infer<typeof NavigationActionSchema>;

export const ButtonElementSchema = z.object({
  ...ElementBase,
  type: z.literal("button"),
  label: z.string().min(1).max(200),
  style: TextStyleSchema,
  fill: FillSchema,
  stroke: StrokeSchema.optional(),
  cornerRadius: z.number().min(0).max(500).default(8),
  action: NavigationActionSchema,
});

export const VideoElementSchema = z.object({
  ...ElementBase,
  type: z.literal("video"),
  src: AssetUriSchema,
  poster: AssetUriSchema.optional(),
  captions: z
    .array(
      z.object({
        src: AssetUriSchema,
        srclang: z.string().min(2).max(10),
        label: z.string().min(1).max(60),
        default: z.boolean().default(false),
      }),
    )
    .default([]),
  controls: z.boolean().default(true),
  autoplay: z.boolean().default(false),
  loop: z.boolean().default(false),
  muted: z.boolean().default(false),
});

export const AudioElementSchema = z.object({
  ...ElementBase,
  type: z.literal("audio"),
  src: AssetUriSchema,
  controls: z.boolean().default(true),
  autoplay: z.boolean().default(false),
  loop: z.boolean().default(false),
});

export const ElementNodeSchema = z.discriminatedUnion("type", [
  TextElementSchema,
  ImageElementSchema,
  ShapeElementSchema,
  ButtonElementSchema,
  VideoElementSchema,
  AudioElementSchema,
]);
export type ElementNode = z.infer<typeof ElementNodeSchema>;
export type ElementType = ElementNode["type"];
export type TextElement = z.infer<typeof TextElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type ButtonElement = z.infer<typeof ButtonElementSchema>;
export type VideoElement = z.infer<typeof VideoElementSchema>;
export type AudioElement = z.infer<typeof AudioElementSchema>;

/* ------------------------------------------------------------------ */
/* Pantallas y módulos                                                 */
/* ------------------------------------------------------------------ */

export const SlideLayerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  kind: z.enum(["base", "info", "popup", "feedback", "help", "custom"]),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
});
export type SlideLayer = z.infer<typeof SlideLayerSchema>;

/**
 * Timeline e interacciones: reservados para Fases 4 y 7. El esquema los
 * acepta vacíos para que los proyectos no requieran migración al activarlos;
 * el runtime actual los ignora y la UI no los expone.
 */
export const TimelineTrackSchema = z.object({
  elementId: IdSchema,
  start: z.number().min(0),
  end: z.number().min(0).optional(),
});
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;

export const InteractionSchema = z.object({
  id: IdSchema,
  kind: z.string().min(1),
  config: z.record(z.unknown()),
});
export type Interaction = z.infer<typeof InteractionSchema>;

export const SlideAccessibilitySchema = z.object({
  /** Descripción opcional leída al entrar a la pantalla. */
  description: z.string().max(2000).optional(),
});

export const SlideSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200),
  width: z.number().int().min(320).max(3840),
  height: z.number().int().min(240).max(2160),
  background: FillSchema,
  /** Duración en segundos (0 = sin timeline). */
  duration: z.number().min(0).max(36000).default(0),
  elements: z.array(ElementNodeSchema),
  layers: z.array(SlideLayerSchema).min(1),
  timeline: z.array(TimelineTrackSchema).default([]),
  interactions: z.array(InteractionSchema).default([]),
  notes: z.string().max(20000).default(""),
  accessibility: SlideAccessibilitySchema.default({}),
});
export type Slide = z.infer<typeof SlideSchema>;

export const CourseModuleSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200),
  order: z.number().int().min(0),
  slides: z.array(SlideSchema),
});
export type CourseModule = z.infer<typeof CourseModuleSchema>;

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export const AssetTypeSchema = z.enum([
  "image",
  "svg",
  "video",
  "audio",
  "font",
  "document",
  "caption",
  "transcript",
  "source",
]);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  type: AssetTypeSchema,
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(120),
  size: z.number().int().min(0),
  /** SHA-256 hex del contenido: detecta duplicados. */
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Clave en el almacenamiento de objetos (nunca una URL). */
  storageKey: z.string().min(1).max(1024),
  projectPath: z.string().max(1024).optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type Asset = z.infer<typeof AssetSchema>;

/* ------------------------------------------------------------------ */
/* Tema, player y publicación                                          */
/* ------------------------------------------------------------------ */

export const ThemeSchema = z.object({
  colors: z.object({
    primary: ColorSchema,
    primaryDark: ColorSchema,
    accent: ColorSchema,
    danger: ColorSchema,
    background: ColorSchema,
    surface: ColorSchema,
    text: ColorSchema,
  }),
  fonts: z.object({
    heading: z.string().min(1),
    body: z.string().min(1),
  }),
  /** Paleta del proyecto (colores reutilizables en el editor). */
  projectColors: z.array(ColorSchema).max(64).default([]),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const PlayerConfigSchema = z.object({
  showMenu: z.boolean().default(true),
  showProgress: z.boolean().default(true),
  showNavigation: z.boolean().default(true),
  /** free: navegar a cualquier pantalla. linear: solo a visitadas o la siguiente. */
  navigation: z.enum(["free", "linear"]).default("free"),
  /** ask: preguntar si reanudar; always: reanudar sin preguntar; never. */
  resume: z.enum(["ask", "always", "never"]).default("ask"),
});
export type PlayerConfig = z.infer<typeof PlayerConfigSchema>;

export const VariableDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  type: z.enum(["text", "number", "boolean"]),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]),
});
export type VariableDefinition = z.infer<typeof VariableDefinitionSchema>;

/** Fase 5: evaluaciones. Reservado; el runtime actual no las reproduce. */
export const AssessmentSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  passingScore: z.number().min(0).max(100),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export const ScormStandardSchema = z.enum(["scorm12", "scorm2004"]);
export type ScormStandard = z.infer<typeof ScormStandardSchema>;

export const PublicationProfileSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  standard: ScormStandardSchema,
  lms: z.enum(["moodle", "generic"]),
  completion: z.object({
    rule: z.enum(["all-slides", "percent-slides"]),
    /** Porcentaje de pantallas vistas (1-100) cuando rule = percent-slides. */
    percent: z.number().int().min(1).max(100).default(100),
  }),
  /**
   * Aprobación: solo aplica cuando existan evaluaciones (Fase 5). Si está
   * desactivada, el curso reporta únicamente completitud.
   */
  passing: z.object({
    enabled: z.boolean().default(false),
    threshold: z.number().min(0).max(100).default(80),
  }),
  /** Intentos máximos declarados en metadatos (0 = ilimitado; el LMS decide). */
  maxAttempts: z.number().int().min(0).max(100).default(0),
});
export type PublicationProfile = z.infer<typeof PublicationProfileSchema>;

/* ------------------------------------------------------------------ */
/* Proyecto                                                            */
/* ------------------------------------------------------------------ */

export const CourseProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: IdSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  locale: z.string().min(2).max(20),
  stage: z.object({
    width: z.number().int().min(320).max(3840),
    height: z.number().int().min(240).max(2160),
  }),
  theme: ThemeSchema,
  player: PlayerConfigSchema,
  modules: z.array(CourseModuleSchema),
  assets: z.array(AssetSchema),
  variables: z.array(VariableDefinitionSchema).default([]),
  assessments: z.array(AssessmentSchema).default([]),
  publicationProfiles: z.array(PublicationProfileSchema).min(1),
  metadata: z.record(z.unknown()).default({}),
});
export type CourseProject = z.infer<typeof CourseProjectSchema>;

/**
 * Datos que consume el Runtime Engine. Es un subconjunto del proyecto
 * (sin claves de almacenamiento ni metadatos internos) con las URIs de
 * assets ya resueltas a rutas relativas o URLs de preview.
 */
export type RuntimeCourse = {
  schemaVersion: string;
  id: string;
  title: string;
  locale: string;
  stage: CourseProject["stage"];
  theme: Theme;
  player: PlayerConfig;
  modules: CourseModule[];
  tracking: {
    standard: ScormStandard | "none";
    completion: PublicationProfile["completion"];
    passing: PublicationProfile["passing"];
    lms: PublicationProfile["lms"];
  };
};
