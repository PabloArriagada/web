/**
 * Cliente HTTP. Nunca llama a response.json() sin comprobar antes
 * response.ok, el status y el Content-Type: un 413 de un proxy devuelve
 * HTML/texto y no debe terminar en "Unexpected token … is not valid JSON".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function messageForStatus(status: number): string {
  switch (status) {
    case 0:
      return "No se pudo conectar con el servidor. Revisa tu conexión.";
    case 404:
      return "El recurso solicitado no existe.";
    case 409:
      return "Conflicto: los datos cambiaron en otra sesión.";
    case 413:
      return "El archivo supera el tamaño máximo permitido por el servidor.";
    case 415:
      return "Tipo de archivo no soportado.";
    case 422:
      return "Los datos enviados no son válidos.";
    case 502:
    case 503:
    case 504:
      return "El servidor no está disponible en este momento. Intenta nuevamente.";
    default:
      return status >= 500 ? "Error interno del servidor." : `La solicitud falló (HTTP ${status}).`;
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

/** Convierte cualquier respuesta no-OK en ApiError con un mensaje legible. */
export async function toApiError(status: number, contentType: string, readText: () => Promise<string>): Promise<ApiError> {
  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(await readText()) as ErrorBody;
      return new ApiError(status, body.error?.code ?? "http-error", body.error?.message ?? messageForStatus(status), body.error?.details);
    } catch {
      /* cuerpo JSON corrupto: se usa el mensaje genérico */
    }
  }
  return new ApiError(status, status === 413 ? "too-large" : "http-error", messageForStatus(status));
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", messageForStatus(0));
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok) throw await toApiError(res.status, ct, () => res.text());
  if (res.status === 204) return undefined as T;
  if (!ct.includes("application/json")) throw new ApiError(res.status, "bad-response", "Respuesta inesperada del servidor.");
  return (await res.json()) as T;
}

/** Subida multipart con progreso real (XMLHttpRequest expone upload.onprogress). */
export function uploadFiles<T>(url: string, files: File[], onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    for (const f of files) form.append("file", f, f.name);
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "network", messageForStatus(0)));
    xhr.onabort = () => reject(new ApiError(0, "aborted", "Subida cancelada."));
    xhr.onload = async () => {
      const ct = xhr.getResponseHeader("content-type") ?? "";
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(await toApiError(xhr.status, ct, async () => xhr.responseText));
        return;
      }
      if (!ct.includes("application/json")) {
        reject(new ApiError(xhr.status, "bad-response", "Respuesta inesperada del servidor."));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch {
        reject(new ApiError(xhr.status, "bad-response", "Respuesta inesperada del servidor."));
      }
    };
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
