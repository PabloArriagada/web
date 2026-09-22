# Arquitectura

## Principio central

```
PROYECTO EDITABLE (PostgreSQL, JSON versionado + assets en almacenamiento de objetos)
        │
        ▼
PIPELINE DE PUBLICACIÓN (packages/publisher)
        │  snapshot → validar → recopilar → copiar → reescribir → runtime → wrapper → manifest → validar → ZIP
        ▼
PAQUETE (index.html + runtime/runtime.js + course-data/ + assets/)
        │
        ├── Preview del editor    (el servidor sirve ESTOS archivos, sin ZIP)
        ├── ZIP SCORM 1.2 / 2004  (los MISMOS archivos)
        └── LMS (Moodle, etc.)
```

- **Un solo Runtime Engine** (`packages/runtime`): `renderSlide()` dibuja cada pantalla.
  El editor la usa en modo `static` para el lienzo. El paquete usa `Player`, que
  llama a ese mismo `renderSlide()`.
- **El preview es el paquete**: `POST /api/projects/:id/preview` ejecuta
  `buildPackage()`, el mismo que usa la publicación, y guarda en memoria la lista
  de archivos. Los assets se leen del almacenamiento. El iframe carga
  `/api/preview/<build>/index.html`, así que lo que se ve es lo que entra al ZIP.
- **El SCORM no es el archivo maestro**: cada paquete incluye
  `course-data/project-manifest.json` con el proyecto editable completo.
  `readNativePackage()` lo recupera y verifica el hash de cada asset
  (round-trip probado).

## Monorepo

| Paquete | Rol | Depende de |
|---|---|---|
| `packages/schema` | Modelo tipado (zod), ids, factorías, migraciones de esquema, validación semántica, curso QA | zod |
| `packages/runtime` | Renderizador, Player (navegación, reanudación, progreso), adaptadores LMS, Tracker, LMS simulado | schema (solo tipos) |
| `packages/publisher` | Pipeline, manifest 1.2/2004, validador de paquete, ZIP en streaming, round-trip | schema, runtime (bundle), fflate, fast-xml-parser, @fontsource/montserrat |
| `apps/server` | API Fastify, PostgreSQL, almacenamiento S3/fs, cola de trabajos, Asset Manager | todos |
| `apps/web` | Editor React | schema, runtime |

### Decisiones y justificación

| Decisión | Motivo |
|---|---|
| **Vite + React** (no Next.js) | El editor es una SPA muy interactiva y no necesita SSR ni SEO. La API es un servicio aparte. Vite da builds y HMR rápidos con menos piezas. |
| **Fastify** | Validación y serialización rápidas, logs estructurados con pino integrados, multipart en streaming. |
| **zod** | Un solo esquema sirve como tipos TypeScript, validación del servidor y validación del editor. |
| **Runtime sin framework** (TS a IIFE, ~25 KB) | El paquete SCORM no debe cargar React ni depender de un CDN. Compatible con los navegadores de los LMS. |
| **PostgreSQL** con JSONB | El documento del proyecto (sin binarios) se guarda de forma atómica, con control de revisión y versiones. Las entidades relacionales (assets, publicaciones, trabajos) tienen claves e índices. |
| **Almacenamiento de objetos** (S3/MinIO, o `fs` en local) | Los binarios nunca pasan por JSON ni Base64. La base de datos guarda solo `storage_key`, hash y metadatos. |
| **Cola en PostgreSQL** (`FOR UPDATE SKIP LOCKED`) | Procesa publicaciones de forma asíncrona sin Redis. Admite varios procesos sin duplicar trabajos. Tiene reintentos con backoff y recupera trabajos huérfanos. |
| **fflate** para ZIP | Mantenida y sin dependencias. Escribe en streaming y guarda la media sin recomprimir (método *stored*). |
| **Montserrat vía @fontsource** (SIL OFL) | La fuente viaja dentro del paquete (`assets/fonts/*.woff2`), sin Google Fonts en el LMS. |
| Enrutador propio (History API) | Solo hay dos rutas; no justifica una dependencia. |

## Modelo de datos (resumen)

`CourseProject` → `modules[]` → `slides[]` → `elements[]` (unión discriminada:
`text | image | shape | button | video | audio`). Detalle completo en
`packages/schema/src/model.ts`.

- Ids estables con prefijo (`prj_`, `mod_`, `sld_`, `el_`, `lyr_`, `ast_`, `pub_`): 20 caracteres base36.
- Los elementos referencian assets con la URI `asset://<assetId>`. El publicador
  la reescribe a `assets/<carpeta>/<assetId>.<ext>`.
- `schemaVersion` = `1.0.0`. `loadProject()` aplica migraciones en cadena y
  rechaza esquemas futuros.
- `layers`, `timeline`, `interactions`, `variables` y `assessments` ya existen en
  el esquema (vacíos) para que las fases 4, 5 y 7 no rompan proyectos. El runtime
  actual respeta la visibilidad de capas e ignora el resto.

### Base de datos (`apps/server/src/db/migrations/001_init.sql`)

| Tabla | Contenido |
|---|---|
| `projects` | documento JSONB **sin** assets, `revision` (concurrencia optimista), borrado lógico |
| `project_versions` | instantáneas inmutables: `manual`, `publication`, `restore-backup` |
| `assets` | metadatos + `storage_key` + `hash` SHA-256 (`UNIQUE(project_id, hash)` = deduplicación) |
| `publications` | estado, perfil, informe de validación, pasos del pipeline, clave del ZIP |
| `jobs` | cola asíncrona (tipo, estado, intentos, `run_after`, `locked_at`) |
| `schema_migrations` | control de migraciones (se aplican con advisory lock) |

## Flujo de guardado

1. Cada cambio en el editor produce un proyecto nuevo (inmutable) y marca "Cambios sin guardar".
2. Se escribe una copia local de emergencia en localStorage (`studio-draft:<id>`).
3. Autosave con debounce de 1,2 s: `PUT /api/projects/:id { project, baseRevision }`.
4. El servidor migra y valida con zod, y actualiza con `WHERE revision = baseRevision`.
   Si otra sesión guardó antes, responde **409** y el editor muestra
   "Conflicto de versión" sin sobrescribir.
5. Antes de preview, validación, publicación, versiones o salida, se fuerza el guardado (`flush`).

## Pipeline de publicación

`packages/publisher/src/build.ts`. Cada paso queda registrado con su duración:

1. **snapshot**: `structuredClone` + congelado profundo + SHA-256 del JSON canónico.
2. **validar-proyecto**: zod + reglas semánticas (ids duplicados, capas, assets, enlaces, URLs prohibidas, accesibilidad).
3. **recopilar-assets**: solo los referenciados.
4. **copiar-assets**: verifica existencia y tamaño en el almacenamiento.
5. **reescribir-rutas**: `asset://id` → ruta relativa, en todo el árbol JSON.
6. **construir-runtime**: `runtime.js`, `runtime.css` y las fuentes usadas.
7. **construir-wrapper**: `index.html`, `course-data/course.json`, `course.js` y `project-manifest.json`.
8. **generar-manifest**: `imsmanifest.xml` 1.2 o 2004 4ª ed., con todos los archivos declarados.
9. **validar-publicacion**: XML bien formado, versión, organización y SCO, launch,
   archivos declarados y existentes, referencias de HTML y CSS, `course.json` sin
   `asset://`, colisiones de mayúsculas, rutas no portables, MIME por extensión,
   URLs temporales, hash del runtime y project manifest.
10. **generar-zip** (worker): streaming a un archivo temporal; `imsmanifest.xml` va primero.
11. **verificar-zip**: lee el directorio central del ZIP y lo compara con la lista validada.
    Recién entonces lo sube al almacenamiento y habilita la descarga.

Con cualquier error, la publicación queda `failed` con su informe y **no se genera ZIP**.

## Capa LMS

- `LMSAdapter` (interfaz del encargo): `Scorm12Adapter` (`window.API`),
  `Scorm2004Adapter` (`window.API_1484_11`) y `LocalAdapter` (sin LMS; guarda en localStorage).
- `findApi()`: algoritmo estándar que recorre `parent` (hasta 500 niveles) y luego `opener`.
- `Tracker` traduce la semántica a claves de cada estándar:

| Semántica | SCORM 1.2 | SCORM 2004 |
|---|---|---|
| ubicación | `cmi.core.lesson_location` | `cmi.location` |
| estado | `cmi.core.lesson_status` | `cmi.completion_status` + `cmi.success_status` |
| puntaje | `cmi.core.score.raw/min/max` | `cmi.score.raw/min/max/scaled` |
| progreso | — | `cmi.progress_measure` |
| reanudación | `cmi.suspend_data` (≤ 4096) | `cmi.suspend_data` (≤ 64000) |
| interacciones | `cmi.interactions.n.student_response` (`,`), result `wrong` | `learner_response` (`[,]`), result `incorrect` |
| cierre | `session_time` HHHH:MM:SS.SS, `exit=suspend` | `session_time` PT#H#M#S, `exit=suspend` |

- `suspend_data` compacto: `{"v":1,"n":<pantallas>,"seen":"<bits en hex>"}`. 100 pantallas ocupan unos 45 caracteres.
- Perfil **Moodle**: SCORM 2004 sin reglas de secuenciación (Moodle las soporta parcialmente).
  Perfil **genérico**: `controlMode choice + flow`.

## Seguridad

- Las claves de S3 y de la base de datos solo existen en el servidor (`.env`). El navegador nunca las ve.
- Subidas: se verifican la extensión permitida, la firma real del contenido
  (magic bytes), el tamaño máximo (413 con JSON legible) y que el archivo no esté vacío.
  Se rechazan SVG activos (`<script>`, `on*=`, `javascript:`, `foreignObject`, entidades, recursos externos).
- Los assets se sirven con `Content-Security-Policy: sandbox`, `nosniff` y caché inmutable.
- Las claves de almacenamiento se validan (sin `..`), y los ids de rutas se validan con regex/zod.
- El runtime nunca interpreta texto del autor como HTML.
- **Pendiente**: autenticación y autorización. Hoy la API asume un único usuario
  local y **no debe exponerse a Internet** así.

## Escalabilidad prevista

- La cola ya admite varios workers. El worker puede separarse en su propio proceso sin cambios en la cola.
- Los previews se guardan en memoria por proceso: con varias instancias hará falta
  afinidad o guardar el build en almacenamiento.
- Carga directa navegador → S3 con URL firmada: prevista para PowerPoint grande (Fase 3).
