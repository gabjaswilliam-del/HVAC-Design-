import { describe, expect, it, vi } from "vitest";
import { httpKnowledge } from "./knowledge";
import { httpMemory } from "./memory";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("local knowledge and memory clients", () => {
  it("send writes as JSON with the client header, and lists as comma-separated queries", async () => {
    const fetchImpl = vi.fn(async () => json(200, { nodes: [], edges: [], total: 0, truncated: false, limit: 5 }));
    await httpKnowledge("/api/knowledge/v1", fetchImpl).getKnowledgeGraph({ types: ["fault", "symptom"], limit: 5 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/knowledge/v1/graph?types=fault%2Csymptom&limit=5");
    expect((init.headers as Record<string, string>)["X-HVAC-Client"]).toBe("dashboard");

    const post = vi.fn(async () => json(400, { error: { code: "INVALID_REQUEST", message: "Type a few words to search for.", retryable: false } }));
    await expect(httpKnowledge("/k", post).searchKnowledge({ query: "x" })).rejects.toMatchObject({ code: "INVALID_REQUEST", message: "Type a few words to search for." });
    const [, postInit] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(postInit.method).toBe("POST");
    expect(JSON.parse(postInit.body as string)).toEqual({ query: "x" });
  });

  it("keep the service's error details, such as the existing duplicate", async () => {
    const dup = vi.fn(async () =>
      json(409, { error: { code: "CONFLICT", message: "Already in the library.", retryable: false, details: { existingDocumentId: "doc_abc" } } }),
    );
    await expect(httpKnowledge("/k", dup).ingestDocument({ name: "a.md", contentBase64: "YQ==", kind: "manual" })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { existingDocumentId: "doc_abc" },
    });
    const big = vi.fn(async () => json(413, { error: { code: "TOO_LARGE", message: "The file is 30 MB.", retryable: false } }));
    await expect(httpKnowledge("/k", big).ingestDocument({ name: "a.md", contentBase64: "YQ==", kind: "manual" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("never mistake a page, a refusal to connect or a malformed answer for the service", async () => {
    const page = vi.fn(async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(httpKnowledge("/api/knowledge/v1", page).status()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(httpMemory("/api/memory/v1", down).status()).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
    const wrong = vi.fn(async () => json(200, { documents: "no" }));
    await expect(httpKnowledge("/k", wrong).listDocuments()).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    const proxy = vi.fn(async () => new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain" } }));
    await expect(httpMemory("/m", proxy).listMemories()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("cancel cleanly", async () => {
    const slow = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const controller = new AbortController();
    const pending = httpMemory("/m", slow as unknown as typeof fetch).getMemoryTimeline({}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("send memory filters as the service reads them", async () => {
    const fetchImpl = vi.fn(async () => json(200, { memories: [], total: 0, limit: 50, offset: 0, searched: true }));
    await httpMemory("/api/memory/v1", fetchImpl).searchMemories("fan", { kinds: ["finding", "event"], includeSuperseded: true, from: "2026-10-01T00:00:00Z" });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/memory/v1/memories?query=fan&kinds=finding%2Cevent&from=2026-10-01T00%3A00%3A00Z&includeSuperseded=true");
  });
});
