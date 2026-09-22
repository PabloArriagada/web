export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Caracteres de control no permitidos en XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Identificador XML válido (tipo xs:ID): empieza con letra, sin espacios. */
export function xmlId(prefix: string, raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `${prefix}-${cleaned}`;
}
