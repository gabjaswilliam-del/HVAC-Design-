import { describe, expect, it } from "vitest";
import { httpTranscription, notConnected } from "./speech";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("speech-to-text boundary", () => {
  it("reports not connected, and never transcribes, without a service", async () => {
    const off = notConnected("No speech-to-text service is connected in this build.");
    expect(await off.status()).toEqual({ available: false, reason: "No speech-to-text service is connected in this build." });
    await expect(off.transcribe(new Blob(["x"]))).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("does not mistake a page served in place of the API for a service", async () => {
    const html = httpTranscription("/api/stt/v1", async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }));
    expect((await html.status()).available).toBe(false);
    const missing = httpTranscription("/api/stt/v1", async () => new Response("", { status: 404 }));
    expect((await missing.status()).available).toBe(false);
    const empty = httpTranscription("/api/stt/v1", async () => json({ data: [] }));
    expect(await empty.status()).toEqual({ available: false, reason: "The speech-to-text service lists no model." });
    const down = httpTranscription("/api/stt/v1", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await down.status()).available).toBe(false);
  });

  it("sends one recording to the listed model and returns its text", async () => {
    const calls: { url: string; body?: BodyInit | null }[] = [];
    const client = httpTranscription("/api/stt/v1", async (url, init) => {
      calls.push({ url: String(url), body: init?.body });
      return String(url).endsWith("/models") ? json({ data: [{ id: "whisper-small" }] }) : json({ text: "  show me COP today " });
    });
    expect(await client.status()).toEqual({ available: true, model: "whisper-small" });
    expect(await client.transcribe(new Blob(["audio"], { type: "audio/webm" }))).toBe("show me COP today");
    const form = calls[1].body as FormData;
    expect(calls[1].url).toBe("/api/stt/v1/audio/transcriptions");
    expect(form.get("model")).toBe("whisper-small");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("reports a failed or unreadable transcription", async () => {
    const failing = httpTranscription("/api/stt/v1", async () => json({ error: "busy" }, 503));
    await expect(failing.transcribe(new Blob(["a"]))).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const odd = httpTranscription("/api/stt/v1", async () => json({ words: [] }));
    await expect(odd.transcribe(new Blob(["a"]))).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
});
