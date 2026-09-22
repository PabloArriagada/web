# Fase 0 · Auditoría del prototipo `creador_elearning_scorm.html`

## Estado: **NO REALIZADA — el archivo no fue entregado**

El encargo pedía auditar `creador_elearning_scorm.html` antes de crear el proyecto.
Ese archivo **no estaba** en el repositorio (`PabloArriagada/web`, rama
`claude/elearning-scorm-platform-owxfhf`), ni en la conversación, ni en el
sistema de archivos del entorno de trabajo. Se buscó con:

```bash
find / -name "creador_elearning*" -not -path "/proc/*"
git log --all --oneline   # un solo commit: plantilla "Start Bootstrap – New Age"
```

Por lo tanto **no hay hallazgos que informar** sobre el prototipo: cualquier
clasificación ("funciona", "no funciona", etc.) sería inventada. El repositorio
solo contiene una landing page de Bootstrap (`src/`, `dist/`), sin relación con
la autoría e-learning, que **no se modificó**.

Decisión tomada: se avanzó con la Fase 1 diseñando la arquitectura a partir de
los requisitos del encargo (secciones 4–8, 25, 27–28). Cuando el archivo esté
disponible, la auditoría se hará con el protocolo de abajo y sus conclusiones
podrán cambiar las prioridades de la Fase 2 (editor), que es donde un prototipo
aporta más.

## Cómo entregar el archivo

Copiarlo en `elearning-studio/prototype/creador_elearning_scorm.html` (o
adjuntarlo en la conversación) y pedir: *"Ejecuta la auditoría de Fase 0"*.

## Protocolo de auditoría preparado

Cada punto se ejecutará en Chromium (Playwright) con la consola abierta y se
clasificará como **Funciona / Funciona parcialmente / No funciona / Riesgo
técnico / Requiere backend / Requiere rediseño**.

| # | Prueba | Qué se observa |
|---|--------|----------------|
| 1 | Crear módulo | ids estables vs. índices, persistencia |
| 2 | Crear pantalla | tamaño de escenario, orden |
| 3 | Insertar texto | edición directa, estilos, sanitización (innerHTML) |
| 4 | Insertar forma | tipos, SVG vs. CSS, bordes |
| 5 | Subir imagen | Base64/Data URL vs. referencia, tamaño en localStorage |
| 6 | Subir video pequeño | Base64 (límite de ~5 MB de localStorage), blob: URLs |
| 7–8 | Mover / redimensionar | Pointer Events, touch, precisión con escala |
| 9–12 | Copiar / pegar / duplicar / eliminar | ids nuevos, referencias rotas |
| 13–14 | Deshacer / rehacer | patrón usado, límites, estado inconsistente |
| 15–16 | Guardar / recargar | localStorage, cuota, pérdida de datos |
| 17–18 | Exportar / reabrir proyecto | formato, versión de esquema |
| 19 | Previsualizar | ¿mismo motor que el export? |
| 20 | Validar | qué valida realmente |
| 21 | Exportar SCORM | manifest en raíz, rutas, Data URLs, API 1.2/2004, `LMSFinish`, `suspend_data` > 4096 |

Además: dependencias externas (CDN) que el SCORM necesitaría en el LMS,
accesibilidad (roles, foco, ALT), seguridad (XSS por `innerHTML`, `eval`,
URLs `javascript:`), y diferencias editor ↔ preview.

## Riesgos que la arquitectura ya cubre, sin importar el prototipo

Estos son problemas típicos de un creador e-learning hecho en un solo HTML.
La plataforma nueva los evita por diseño. **No** son hallazgos del prototipo:

| Riesgo típico | Cómo lo evita la plataforma nueva |
|---|---|
| Binarios en Base64 dentro de JSON/localStorage | Asset Manager con almacenamiento de objetos; el JSON solo guarda `asset://id` |
| Motores distintos para editor, preview y SCORM | Un único Runtime (`packages/runtime`); el preview sirve el paquete compilado |
| `blob:`/`localhost`/URLs firmadas dentro del SCORM | Reescritura de rutas + validador que bloquea la descarga |
| Manifest en subcarpeta o archivos no declarados | Validador de paquete + verificación del ZIP generado |
| Pérdida de datos por cuota de localStorage | PostgreSQL + autosave con revisión; localStorage solo como copia de emergencia |
| XSS por texto del autor | El runtime usa `textContent`, nunca `innerHTML` |
