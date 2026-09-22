import type { FontFile } from "./types.js";
import { escapeXml } from "./xml.js";

export function buildIndexHtml(opts: { title: string; locale: string; standard: string; hasFonts: boolean }): string {
  const t = escapeXml(opts.title);
  return `<!doctype html>
<html lang="${escapeXml(opts.locale)}" data-standard="${escapeXml(opts.standard)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'; form-action 'none'">
<title>${t}</title>
${opts.hasFonts ? '<link rel="stylesheet" href="styles/fonts.css">\n' : ""}<link rel="stylesheet" href="styles/runtime.css">
<link rel="stylesheet" href="styles/course.css">
</head>
<body>
<div id="studio-course"><noscript>Este curso requiere JavaScript habilitado.</noscript></div>
<script src="course-data/course.js"></script>
<script src="runtime/runtime.js"></script>
</body>
</html>
`;
}

export const COURSE_CSS = `html, body { height: 100%; margin: 0; }
body { background: #e8edf1; }
#studio-course { height: 100%; }
`;

export function buildFontsCss(fonts: FontFile[]): string {
  return fonts
    .map(
      (f) => `@font-face {
  font-family: "${f.family.replace(/"/g, "")}";
  font-style: ${f.style};
  font-weight: ${f.weight};
  font-display: swap;
  src: url("../assets/fonts/${f.filename}") format("woff2");${f.unicodeRange ? `\n  unicode-range: ${f.unicodeRange};` : ""}
}
`,
    )
    .join("\n");
}
