# Fase 0 · Auditoría del prototipo `creador_elearning_scorm.html`

- Archivo auditado: `prototype/creador_elearning_scorm.html` (40 176 bytes, 265 líneas, un único HTML con CSS y JS en línea).
- Método: lectura completa del código y ejecución automatizada en Chromium 141 (Playwright), abriendo el archivo por `file://` a 1440×900, como lo usaría un autor.
- Reproducir: `npm run audit:prototype`. Los resultados quedan en `prototype/audit/results.json` y los pasos en `prototype/audit/audit.spec.ts`.
- El SCORM exportado por el prototipo se abrió dentro de un LMS simulado (API 1.2 y 2004, el mismo de las pruebas de la plataforma). **No se probó en Moodle real.**

## Veredicto

El prototipo es un **buen boceto de interacción del editor**, con varias funciones que operan: estructura, inserción, arrastre, copiar/pegar, deshacer y exportación de un ZIP. **No sirve como base de producción**, por cuatro defectos estructurales verificados:

1. **El SCORM no se comunica con el LMS.** Su runtime nunca busca `window.API` ni `API_1484_11`: hay 0 llamadas SCORM. Moodle verá el curso como "no iniciado" para siempre, sin completitud, puntaje ni reanudación.
2. **Hay dos motores distintos.** El editor dibuja con `elementNode()` y el preview/SCORM con `runtimeJs()`, que difiere (por ejemplo, el subrayado desaparece y cambian los radios de borde). Lo que se ve en el editor no es lo que se publica.
3. **Los binarios van en Base64 dentro del proyecto, del historial de deshacer y de localStorage.** Con un video de 6 MB el guardado falla y, al recargar, se pierde todo lo posterior al último guardado exitoso.
4. **El lienzo no escala.** En un monitor de 1440 px el lienzo mide 834 px, pero los objetos se dibujan en píxeles de 960. Al arrastrar, el objeto se mueve un 15 % más que el cursor y lo que está a la derecha de x≈834 queda oculto.

Estos cuatro puntos confirman la decisión de arquitectura de la Fase 1: runtime único, Asset Manager con almacenamiento de objetos, capa LMS con Tracker y persistencia en servidor.

## Resultados por prueba (ejecutados)

| # | Prueba | Clasificación | Evidencia medida |
|---|---|---|---|
| 1 | Crear módulo | **Funciona** | 2 módulos creados. Ids `Date.now`+aleatorio. No se puede renombrar, reordenar ni eliminar módulos (no hay controles) |
| 2 | Crear pantalla | **Funciona parcialmente** | Se crea. No se puede eliminar ni reordenar pantallas |
| 3 | Insertar texto | **Funciona parcialmente** | Se escribió "abcde" y un deshacer dejó "abcd": **cada tecla guarda una copia completa del proyecto** en el historial. La edición directa usa `prompt()`. No hay controles de alineación ni interlineado |
| 4 | Insertar forma | **Funciona parcialmente** | Siempre inserta un rectángulo redondeado. **No hay control para elegir otra forma**, aunque el código contempla círculo, óvalo y triángulo |
| 5 | Subir imagen | **Riesgo técnico** | Queda como `data:image/png;base64,…` dentro del JSON del proyecto |
| 6 | Subir video pequeño | **Riesgo técnico** | Un video de 50 229 B pasa a 66 995 caracteres (+33 %). Sin subtítulos, poster ni opciones de reproducción |
| 7 | Mover | **Funciona parcialmente** | Con un lienzo de 834 px, un movimiento de cursor de 100 px mueve el objeto 115 px en pantalla y en el modelo. Defecto de escala |
| 8 | Redimensionar | **Funciona parcialmente** | Un arrastre de 50 px deja el ancho en 300→358. Hay un solo tirador, sin proporción, rotación con el mouse, snap ni guías |
| 9 | Copiar / pegar | **Funciona** | Funciona en la misma pantalla y **entre pantallas**. El portapapeles es interno |
| 10 | Duplicar | **Funciona** | Ctrl+D duplica objetos. También se pueden duplicar pantallas |
| 11 | Eliminar | **Funciona** | Supr elimina objetos. No se pueden eliminar pantallas ni módulos |
| 12 | Deshacer / rehacer | **Funciona parcialmente** | Opera, pero cada paso clona el proyecto completo (con Base64) hasta 80 veces, y un simple clic sobre un objeto crea un paso. Ctrl+Z dentro de un campo deshace el proyecto, no el texto |
| 13 | Guardar | **Funciona parcialmente** | Guarda en localStorage (≈71 000 caracteres con 1 imagen y 1 video pequeños). Muestra un aviso emergente después de *cada* cambio. Sin versiones ni servidor |
| 14 | Recargar navegador | **Funciona** | Se conservan 2 módulos y 6 objetos |
| 15 | Exportar proyecto | **Funciona** | `.course.json` con los Data URLs dentro. El nombre sale mal escrito: `rso-sin-ti-tlo` (ver nota 1 abajo) |
| 16 | Reabrir proyecto | **Funciona parcialmente** | Se recuperan 6 de 6 objetos. La validación es mínima |
| 16b | Abrir un JSON malformado | **Riesgo técnico** | Avisa "No se pudo abrir…", pero **el estado en memoria ya fue reemplazado**: la siguiente acción produce `TypeError … reading 'reduce'` y el editor queda roto hasta recargar |
| 17 | Previsualizar | **Requiere rediseño** | Motor distinto: subrayado en editor ≠ preview (`none`), radio 20 px ≠ 12 px. Siempre abre en la pantalla 1. El iframe `srcdoc` no tiene `sandbox` y comparte el origen del editor |
| 18 | Validar | **Funciona parcialmente** | Revisa nombre, módulos vacíos, media sin archivo, ALT y tamaños. No revisa rutas, manifest, tamaño, enlaces ni contraste |
| 19 | Exportar SCORM | **Requiere rediseño** | **Sin Internet falla** (JSZip se carga desde el CDN jsDelivr). Con JSZip: `imsmanifest.xml` va en la raíz, pero **solo declara `index.html`**, sin runtime, estilos, datos ni assets. El 1.2 no tiene `<metadata>`. Los identificadores son fijos (`ORG`, `ITEM`, `RES`). `project-manifest.json` es una copia idéntica de `course.json` |
| 20 | SCORM 1.2 en LMS simulado | **No funciona** | 0 llamadas a la API. El estado queda en `not attempted`. Las imágenes cargan y no hay errores de JS |
| 20 | SCORM 2004 en LMS simulado | **No funciona** | 0 llamadas a la API. El estado queda en `unknown` |
| 21 | Límite de localStorage | **Riesgo técnico** | Con un video de 6 MB aparece "Error al guardar" y, tras recargar, el video y los cambios posteriores se pierden |
| 22 | Pegar imagen del portapapeles | **No funciona** | Con el foco en el lienzo no pasa nada. Solo funciona "por accidente" con el foco en un campo de texto, porque Ctrl+V hace `preventDefault` en `keydown` y cancela el evento `paste` |
| — | Pestaña "Capas" | **No funciona** | Botón decorativo: no cambia nada |
| — | "Duración", "Color principal", "Aprobación (%)" | **No funciona** | Se guardan pero no tienen ningún efecto en el preview ni en el SCORM |
| — | Quiz | **Funciona parcialmente** | Muestra feedback en el preview, pero no se puede marcar la respuesta correcta (siempre es la A) ni se envía puntaje |
| — | Consola | **Funciona** | Sin errores de JS en el uso normal |

> Nota 1: `slug()` usa `/[\\u0300-\\u036f]/` (con barra doble) dentro de un regex literal, lo que define una clase de caracteres que incluye el rango `0`–`\\`: borra **mayúsculas, dígitos y las letras u y f**, y deja las tildes. Verificado: "Curso sin título" → `rso-sin-ti-tlo`, "Inducción Seguridad 2026" → `ndccio-n-egridad`. Afecta el nombre de los archivos exportados.

## Hallazgos por análisis de código

Estos puntos no se automatizaron. Se indica la línea del prototipo.

**Seguridad**
- El preview usa `srcdoc` sin `sandbox` (l. 221): un contenido malicioso importado en el JSON correría con el origen del editor. El riesgo es acotado, porque el runtime usa `textContent`/`esc()` para los textos.
- `fontFamily` y los colores se concatenan en `cssText` sin validar (l. 217): permite inyectar CSS desde un JSON importado.
- La importación no valida esquema ni tipos (l. 229). Ver 16b.
- La dependencia de un CDN en tiempo de exportación no fija integridad (sin SRI).

**SCORM y publicación**
- No hay adaptador LMS, Initialize/Terminate, `cmi.*`, `suspend_data` ni `session_time` (l. 217).
- La extensión se deriva del MIME (l. 237): `image/svg+xml` produce `.svg+xml`, y `video/quicktime` produce `.quicktime`. Son rutas no portables y el LMS servirá un MIME incorrecto.
- No se reescriben rutas en CSS ni en otros campos: solo en `e.src`.
- No se valida el paquete antes de descargarlo.
- La navegación con `position:fixed` tapa el contenido. El player no escala a pantallas menores de 960 px (los objetos se recortan).

**Editor**
- `z` puede quedar negativo o repetido, y el orden depende de un número, no del orden del arreglo.
- Los ids `Date.now().toString(36)+5 caracteres aleatorios` pueden colisionar al duplicar en bucle dentro del mismo milisegundo (poco probable, pero posible).
- No hay bloqueo, ocultar, agrupar ni rotar con el mouse. Tampoco hay controles de alineación de texto (el campo `align` existe en el modelo).

**Accesibilidad**
- Los objetos del lienzo son `div` no enfocables: no se pueden seleccionar con teclado.
- El modal no atrapa el foco ni lo devuelve. El aviso emergente no es región viva (`aria-live`).
- Los botones de ícono (↶ ↷ + ⧉ ×) solo tienen `title`.
- En el SCORM: sin `lang` por pantalla, sin anuncio del cambio de pantalla y sin foco gestionado. El video no tiene pista de subtítulos.

**Dependencias externas**
- JSZip 3.10.1 desde cdn.jsdelivr.net, solo al exportar.
- La fuente Montserrat se declara pero **no se incluye** en el editor ni en el SCORM: en equipos sin Montserrat se usa Arial.

## Qué se rescata, qué se migra y qué se descarta

| Elemento | Decisión | Dónde quedó |
|---|---|---|
| Distribución del editor (estructura · lienzo · propiedades, barra "Insertar") | **Rescatado** | `apps/web` (misma disposición y paleta corporativa) |
| Flujo copiar / pegar / duplicar / eliminar con atajos, **también entre pantallas** | **Migrar (Fase 2)** | Hoy: duplicar (Ctrl+D) y eliminar (Supr). Copiar/pegar pasará a Commands |
| Deshacer / rehacer | **Migrar con otro diseño** | Fase 2: patrón Command con diffs, no clones completos |
| Arrastrar y redimensionar con Pointer Events | **Migrar corrigiendo la escala** | Fase 2: el lienzo nuevo ya aplica `transform: scale()`; faltan los tiradores |
| Pegar imagen del portapapeles | **Migrar corrigiendo el bug** | Fase 2: evento `paste` → Asset Manager (sin Data URL) |
| Quiz con feedback | **Migrar** | Fase 5 (con respuesta correcta configurable, puntaje e interacciones SCORM; el Tracker ya lo soporta) |
| Exportar / abrir proyecto `.course.json` | **Reemplazado** | Persistencia en servidor + versiones. El paquete SCORM nativo incluye el proyecto editable (round-trip). Pendiente: la UI de importación (Fase 6) y un **importador del formato `.course.json` del prototipo** (ver abajo) |
| Validación de ALT y media sin archivo | **Rescatado** | `validateProject()` (más reglas) |
| `escapeHtml`, `safeJson` | **Rescatado como criterio** | El runtime nuevo usa `textContent`, sin HTML de autor |
| Runtime `runtimeJs()` en texto dentro de un string | **Descartado** | Reemplazado por `packages/runtime` (TypeScript, probado, un solo motor) |
| Data URLs / Base64 / localStorage como almacenamiento | **Descartado** | Asset Manager + almacenamiento de objetos + PostgreSQL |
| JSZip desde CDN | **Descartado** | ZIP en servidor con fflate (sin Internet en el navegador) |
| Manifest con `<file href='index.html'/>` y ids fijos | **Descartado** | Manifest generado con todos los archivos, ids por proyecto y validado |
| Pestaña Capas, Duración, Color principal, Aprobación sin efecto | **Descartado de la UI** | Regla 2: no mostrar funciones que no operan. Volverán al funcionar: capas (Fase 2/7), duración (Fase 4) y aprobación (Fase 5) |

### Funciones del prototipo que la plataforma aún no tiene (regla 4)

No se eliminan: se posponen, cada una con su motivo.

| Función del prototipo | Estado en el prototipo | Plan |
|---|---|---|
| Arrastrar / redimensionar en el lienzo | Parcial (bug de escala) | Fase 2, primer incremento |
| Copiar/pegar entre pantallas, deshacer/rehacer | Funciona | Fase 2 (Commands) |
| Pegar imagen del portapapeles | No funciona sobre el lienzo | Fase 2 |
| Quiz de 2 alternativas | Parcial, sin puntaje | Fase 5 |
| Exportar/abrir JSON local | Funciona | Reemplazado por guardado en servidor. Se propone un importador del `.course.json` del prototipo para no perder cursos ya creados |

## Impacto en el plan

- **Se confirma** el orden de fases: los defectos más graves del prototipo (tracking SCORM, doble motor, Base64) son justo los que resolvió la Fase 1.
- **Se propone agregar al inicio de la Fase 2** un importador de `.course.json` del prototipo. Convertiría módulos, pantallas y objetos, pasaría los Data URLs a assets, escalaría 960×540 → 1280×720 y reportaría lo no convertible. Así los cursos hechos con el prototipo no se pierden.
- **Arrastrar/redimensionar** es la primera tarea de la Fase 2, porque es lo que el prototipo ya ofrecía y la plataforma no.
