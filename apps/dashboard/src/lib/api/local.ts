/**
 * Transport to the local API's JSON services on same-origin paths (in development the
 * dev server proxies them to `apps/api/local_server.py`). Each response is validated at
 * the boundary; the service's error contract becomes an ApiError with its message. A
 * page served in place of the API, an unreachable service or a malformed answer is an
 * error the screen shows. Nothing ever falls back to fixtures.
 */
import type { ZodType } from "zod";
import { ApiError, validate, type ErrorCode, type RequestOptions } from "./client";

const CODES: Record<string, ErrorCode> = {
  INVALID_REQUEST: "INVALID_REQUEST",
  TOO_LARGE: "INVALID_REQUEST",
  UNSUPPORTED: "INVALID_REQUEST",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  UNAVAILABLE: "UNAVAILABLE",
};

type Query = Record<string, string | number | boolean | readonly string[] | undefined>;
export type LocalRequest = <T>(schema: ZodType<T>, path: string, init?: { method?: string; body?: unknown; query?: Query }, o?: RequestOptions) => Promise<T>;

const aborted = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function localService(base: string, name: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): LocalRequest {
  return async (schema, path, init = {}, o) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
      q.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    const qs = q.toString();
    let r: Response;
    let body: unknown;
    try {
      r = await fetchImpl(`${base}${path}${qs ? `?${qs}` : ""}`, {
        method: init.method ?? "GET",
        headers: {
          Accept: "application/json",
          // The service accepts writes only with this header, which a cross-site page cannot set.
          "X-HVAC-Client": "dashboard",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: o?.signal,
      });
      // A page served in place of the API (a 200 with HTML) is not the service.
      if (!(r.headers.get("content-type") ?? "").includes("json")) {
        throw new ApiError("UNAVAILABLE", `No local ${name} service answered at ${base} (HTTP ${r.status}).`, true);
      }
      body = await r.json();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (aborted(e)) throw new ApiError("ABORTED", "Request cancelled", false);
      if (e instanceof SyntaxError) throw new ApiError("MALFORMED_RESPONSE", `The ${name} service sent a response that is not JSON.`, false);
      throw new ApiError("UNAVAILABLE", `The local ${name} service could not be reached.`, true);
    }
    if (!r.ok) {
      const err = (body as { error?: { code?: string; message?: unknown; retryable?: unknown; details?: Record<string, unknown> } } | null)?.error;
      if (err && typeof err.message === "string") {
        throw new ApiError(CODES[err.code ?? ""] ?? "UNAVAILABLE", err.message, err.retryable === true, err.details);
      }
      throw new ApiError("UNAVAILABLE", `The ${name} service answered ${r.status}.`, r.status >= 500);
    }
    return validate(schema, body, name);
  };
}
