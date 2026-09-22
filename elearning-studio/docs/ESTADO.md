# Estado del proyecto · Fase 0 + primera entrega de Fase 1

Leyenda: ✅ funciona y está probado · 🟡 implementado, verificación parcial · ⛔ pendiente

## Criterio de aceptación (sección 28) para lo entregado

| Función | Editor | Preview | Guardar | Cerrar/Reabrir | Publicar | Dentro del SCORM | Moodle real |
|---|---|---|---|---|---|---|---|
| Módulos y pantallas (crear, renombrar, ordenar, duplicar, eliminar) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| Texto (contenido, fuente, tamaño, color, fondo, N/K/S, alineación, interlineado, semántica) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| Formas (11 tipos, relleno, borde, texto interno, cambio de forma conservando propiedades) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| Imagen / SVG (desde la biblioteca, proporción, ALT) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| Botón con navegación (siguiente, anterior, ir a pantalla) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| Video con subtítulos VTT / audio | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (E2E: metadata cargada, pista CC) | ⛔ |
| Fondo de pantalla (color / imagen) | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 (color probado E2E; imagen de fondo sin prueba automática) | ⛔ |
| Completitud + ubicación + reanudación | — | ✅ | — | — | ✅ | ✅ (E2E 1.2 y 2004) | ⛔ |

"✅ Dentro del SCORM" significa: probado con el ZIP real, descomprimido, servido
por HTTP y abierto en Chromium dentro de un iframe con un LMS simulado que
implementa la API 1.2 y 2004 (ciclo de vida, errores, vocabularios y persistencia
entre lanzamientos). **No se probó en Moodle**: este entorno no tiene Docker ni
acceso a imágenes. Es el primer paso del próximo incremento.

## Terminado en esta entrega

- **Fase 0**: la auditoría del HTML **no se pudo hacer** porque el archivo no se entregó (ver `docs/AUDITORIA.md`). La arquitectura quedó definida (`docs/ARQUITECTURA.md`).
- Monorepo TypeScript estricto: `schema`, `runtime`, `publisher`, `server` y `web`.
- Modelo tipado con zod, ids estables, factorías, validación semántica y migraciones de esquema con prueba de encadenamiento.
- Migración SQL inicial con proyectos, versiones, assets, publicaciones y trabajos.
- **Asset Manager mínimo**: subida multipart en streaming con progreso real, SHA-256, deduplicación, verificación de firma, rechazo de SVG activos, tamaño máximo con 413 legible, vista, búsqueda, referencias de uso y eliminación bloqueada si está en uso. Soporta Range para video y audio.
- **Runtime Engine** compartido: renderizador, Player accesible (menú, progreso, región viva, foco, diálogo de reanudación con trampa de foco) y navegación libre o lineal.
- **Preview** del paquete compilado con **SCORM Debugger**: estado, ubicación, suspend data, puntaje, interacciones, errores y log de llamadas. Incluye "Cerrar y volver a entrar" para probar la reanudación.
- **Exportación SCORM 1.2 y 2004 4ª ed.** con perfiles Moodle y genérico, completitud configurable (todas las pantallas o un porcentaje) y ZIP verificado.
- **Validador** de proyecto y de paquete, con los pasos del pipeline visibles.
- Guardado: autosave, Ctrl+S, estados "Guardando…", "Guardado" y "Error al guardar", conflicto 409 entre pestañas, copia local de recuperación, versiones manuales y restauración con respaldo automático.
- Round-trip: `project-manifest.json` en cada paquete y `readNativePackage()` probado.
- Curso QA automático (texto, formas, imagen, SVG, botones, video con subtítulos y audio).
- Modo simple / experto: el modo experto muestra el SCORM Debugger y el detalle del pipeline por defecto.
- En la portada, las funciones futuras aparecen como tarjetas "Próximamente" desactivadas.

## Pendiente o parcial

| Tema | Estado | Nota |
|---|---|---|
| Auditoría del HTML adjunto | ⛔ | Falta el archivo |
| Prueba en **Moodle real** | ⛔ | Siguiente incremento (Docker con Moodle + MariaDB) |
| Driver **S3/MinIO** | 🟡 | Implementado con `@aws-sdk/client-s3`; **no probado** aquí (sin Docker). Las pruebas usan el driver `fs` |
| XSD oficiales de ADL en el paquete | ⛔ | El manifest no declara `schemaLocation`; falta validar contra XSD |
| Autenticación / multiusuario | ⛔ | La API asume un único usuario local |
| Reemplazar asset / optimizar imágenes / miniaturas | ⛔ | El resto del Asset Manager está hecho |
| Editor visual: arrastrar, redimensionar, rotar con el mouse, snap, guías, multiselección, agrupar, bloquear, copiar/pegar entre pantallas, Undo/Redo (Command) | ⛔ | **Fase 2**. Hoy la posición y el tamaño se editan numéricamente |
| Pegar imagen desde el portapapeles / soltar sobre el lienzo | ⛔ | Fase 2 (la subida por arrastre en la biblioteca sí funciona) |
| Degradados e imagen como relleno de formas en la UI | 🟡 | Soportado por el esquema y el runtime; la UI solo ofrece color sólido |
| Capas (panel), estados, variables, triggers | ⛔ | Fases 2 y 7 (el esquema ya reserva capas) |
| Timeline / animaciones | ⛔ | Fase 4 |
| Quiz, puntaje, interacciones desde contenido | ⛔ | Fase 5. El Tracker ya envía puntaje e interacciones (probado con pruebas unitarias) |
| PowerPoint, PDF, IA, importar SCORM | ⛔ | Fases 3, 6 y 8 |
| Auditor de accesibilidad completo | 🟡 | El validador hoy revisa ALT, subtítulos y contraste en el selector de color |
| CI (GitHub Actions) | ⛔ | Los comandos están listos; falta el workflow |

## Limitaciones conocidas

- Los builds de preview se guardan en memoria del proceso (expiran a los 60 min; máximo 30).
- `suspend_data` de 1.2: si un curso supera unas 16.000 pantallas, se excedería el límite. Se detecta y se registra.
- Al eliminar un asset que solo usa una versión antigua, esa versión no podrá publicarse. El validador lo informa como `asset-missing-storage`.
- `cmi.exit` siempre es `suspend`, para permitir revisitar el curso completado. Algunos administradores prefieren `normal` al completar; falta hacerlo configurable por perfil.
