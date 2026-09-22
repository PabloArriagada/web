/**
 * Identificadores estables. Nunca se usa el índice visual como identidad.
 * Formato: `<prefijo>_<20 caracteres base36>` (≈103 bits de entropía).
 */
export type IdPrefix =
  | "prj" // proyecto
  | "mod" // módulo
  | "sld" // pantalla
  | "el" // elemento
  | "lyr" // capa
  | "ast" // asset
  | "var" // variable
  | "pub" // perfil de publicación
  | "asm"; // evaluación

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function createId(prefix: IdPrefix): string {
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 36];
  return `${prefix}_${out}`;
}
