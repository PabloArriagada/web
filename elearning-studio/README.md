# Studio E-learning

Plataforma independiente de autoría e-learning: crea cursos, gestiona recursos,
previsualiza con el mismo motor que se publica y exporta **SCORM 1.2** y
**SCORM 2004 4ª edición** listos para Moodle y otros LMS.

> Estado: **Fase 0 + primera entrega de Fase 1**. Ver [`docs/ESTADO.md`](docs/ESTADO.md)
> (qué está terminado y qué falta), [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md)
> y [`docs/AUDITORIA.md`](docs/AUDITORIA.md).

## Requisitos

- Node.js ≥ 20.11 (probado con 22.22)
- PostgreSQL ≥ 13 (probado con 16)
- Opcional: Docker, para levantar PostgreSQL + MinIO con `docker compose`
- Opcional: Chromium para las pruebas E2E (Playwright 1.56)

## Puesta en marcha local

```bash
cd elearning-studio
cp .env.example .env            # revisa DATABASE_URL y STORAGE_DRIVER

# Opción A: con Docker (PostgreSQL + MinIO)
docker compose up -d
#   en .env: STORAGE_DRIVER=s3 (MinIO) o fs (carpeta local)

# Opción B: PostgreSQL ya instalado
createuser -P studio            # contraseña: studio
createdb -O studio studio

npm install
npm run db:migrate              # aplica apps/server/src/db/migrations/*.sql
npm run dev                     # API :3000 + editor :5173 (http://localhost:5173)
```

Producción (un solo proceso sirve la API y el editor compilado):

```bash
npm run build                   # runtime + web + servidor
npm start                       # http://localhost:3000 (migra al arrancar)
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | API con recarga (tsx) + Vite con proxy `/api` |
| `npm run build` | Compila `runtime.js`, la web (`apps/web/dist`) y el servidor (`apps/server/dist`) |
| `npm run db:migrate` | Aplica las migraciones SQL pendientes |
| `npm run lint` | ESLint (typescript-eslint) |
| `npm run typecheck` | `tsc` estricto en los 5 paquetes |
| `npm test` | Vitest: esquema, runtime, publicador, API (PostgreSQL real) y lógica del editor |
| `npm run test:e2e` | Playwright: paquete SCORM real en Chromium + flujo completo en la app |

Las pruebas de la API usan `TEST_DATABASE_URL`
(por defecto `postgres://studio:studio@localhost:5432/studio_test`) y **borran
su esquema**. Las E2E usan `E2E_DATABASE_URL` (por defecto `.../studio_e2e`).
Crea ambas bases antes:

```bash
createdb -O studio studio_test && createdb -O studio studio_e2e
```

Si Playwright no encuentra su navegador, indica uno con
`CHROMIUM_PATH=/ruta/a/chrome npm run test:e2e`.

## Variables de entorno

Todas se leen **solo en el servidor** (`apps/server/src/config.ts`, validadas con zod).

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `LOG_LEVEL` | `info` | `fatal`…`trace` o `silent` (logs JSON de pino) |
| `DATABASE_URL` | — (obligatoria) | Cadena de conexión PostgreSQL |
| `STORAGE_DRIVER` | `fs` | `fs` (carpeta local) o `s3` (S3/MinIO) |
| `STORAGE_FS_ROOT` | `./.data/storage` | Carpeta del driver `fs` |
| `S3_ENDPOINT` | — | p. ej. `http://localhost:9000` para MinIO |
| `S3_REGION` | `us-east-1` | Región |
| `S3_BUCKET` | `studio-assets` | Bucket (docker compose lo crea) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | Obligatorias con `s3` |
| `S3_FORCE_PATH_STYLE` | `true` | Necesario para MinIO |
| `MAX_UPLOAD_BYTES` | `524288000` | Tamaño máximo por archivo (500 MB) |
| `PREVIEW_TTL_MINUTES` | `60` | Vida de los builds de preview en memoria |
| `WEB_DIST` | `apps/web/dist` | Carpeta de la web compilada que sirve el servidor |

## Estructura

```
elearning-studio/
├── packages/
│   ├── schema/      modelo tipado (zod), ids, migraciones de esquema, validación, curso QA
│   ├── runtime/     Runtime Engine: render, Player, LMS (1.2/2004/local), Tracker, LMS simulado
│   └── publisher/   pipeline de publicación, manifest, validador de paquete, ZIP, round-trip
├── apps/
│   ├── server/      API Fastify, PostgreSQL, almacenamiento, cola de trabajos
│   └── web/         editor React + Vite
├── e2e/             pruebas Playwright
├── fixtures/        video de prueba (y su generador)
└── docs/            auditoría, arquitectura, estado
```

## Paquete SCORM generado

```
curso-scorm12.zip
├── imsmanifest.xml              (raíz; primera entrada del ZIP)
├── index.html                   (launch)
├── runtime/runtime.js           (Runtime Engine, sin dependencias externas)
├── styles/{runtime,course,fonts}.css
├── course-data/
│   ├── course.json              (datos del curso con rutas relativas)
│   ├── course.js                (lo mismo, cargable también desde file://)
│   └── project-manifest.json    (proyecto editable completo → round-trip)
└── assets/{images,video,audio,fonts,documents,captions}/<assetId>.<ext>
```

No se genera la carpeta `scripts/` del esquema propuesto: en esta fase no hay
scripts aparte del runtime y los datos del curso.

## Dependencias

| Dependencia | Uso | Licencia |
|---|---|---|
| react, react-dom | UI del editor | MIT |
| vite, @vitejs/plugin-react | build de la web | MIT |
| fastify, @fastify/multipart, @fastify/static | API, subida en streaming, estáticos | MIT |
| pg | PostgreSQL | MIT |
| @aws-sdk/client-s3 | almacenamiento S3/MinIO | Apache-2.0 |
| zod | esquemas y validación | MIT |
| fflate | ZIP en streaming | MIT |
| fast-xml-parser | validación del manifest | MIT |
| @fontsource/montserrat | fuente empaquetada en web y SCORM | OFL-1.1 |
| esbuild, tsx, typescript | compilación | MIT / Apache-2.0 |
| vitest, happy-dom, @playwright/test | pruebas | MIT / Apache-2.0 |
| eslint, typescript-eslint | lint | MIT |
