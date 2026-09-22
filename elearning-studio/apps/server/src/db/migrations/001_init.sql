-- 001: entidades iniciales.
-- La base de datos guarda documentos del proyecto (JSON sin binarios),
-- metadatos y referencias. Los binarios viven en el almacenamiento de objetos.

CREATE TABLE projects (
  id              text PRIMARY KEY,
  title           text NOT NULL,
  schema_version  text NOT NULL,
  -- Documento editable SIN la lista de assets (se compone desde la tabla assets).
  document        jsonb NOT NULL,
  -- Control de concurrencia optimista: cada guardado incrementa la revisión.
  revision        integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX projects_updated_idx ON projects (updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE project_versions (
  id              uuid PRIMARY KEY,
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number  integer NOT NULL,
  revision        integer NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('manual', 'publication', 'restore-backup')),
  label           text,
  document        jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_number)
);

CREATE TABLE assets (
  id              text PRIMARY KEY,
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type            text NOT NULL,
  filename        text NOT NULL,
  mime_type       text NOT NULL,
  size            bigint NOT NULL CHECK (size >= 0),
  hash            char(64) NOT NULL,
  storage_key     text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Deduplicación: el mismo contenido no se guarda dos veces por proyecto.
  UNIQUE (project_id, hash)
);
CREATE INDEX assets_project_idx ON assets (project_id);

CREATE TABLE publications (
  id              uuid PRIMARY KEY,
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_id      uuid REFERENCES project_versions(id) ON DELETE SET NULL,
  standard        text NOT NULL CHECK (standard IN ('scorm12', 'scorm2004')),
  profile         jsonb NOT NULL,
  status          text NOT NULL CHECK (status IN ('queued', 'building', 'completed', 'failed')),
  report          jsonb,
  steps           jsonb,
  storage_key     text,
  size            bigint,
  snapshot_hash   text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX publications_project_idx ON publications (project_id, created_at DESC);

-- Cola de trabajos asíncronos (publicación hoy; importaciones en fases futuras).
CREATE TABLE jobs (
  id              uuid PRIMARY KEY,
  type            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  payload         jsonb NOT NULL,
  progress        integer NOT NULL DEFAULT 0,
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 3,
  error           text,
  run_after       timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queue_idx ON jobs (status, run_after);
