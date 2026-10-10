/**
 * Speech-to-text boundary for voice input. A local transcription service (for example a
 * Whisper server behind the local API) would answer the OpenAI-compatible routes used
 * here: `GET {base}/models` and `POST {base}/audio/transcriptions`. Without one, voice
 * input says so and the microphone is never opened. Audio goes only to this same-origin
 * service, once, for one transcription; nothing is stored.
 */
import { z } from "zod";
import { ApiError, type RequestOptions } from "./client";

export type SpeechStatus = { available: true; model: string } | { available: false; reason: string };

export interface TranscriptionClient {
  /** Whether a transcription service answers. Never touches the microphone. */
  status(o?: RequestOptions): Promise<SpeechStatus>;
  /** The text spoken in a recording. */
  transcribe(audio: Blob, o?: RequestOptions): Promise<string>;
}

export const notConnected = (reason: string): TranscriptionClient => ({
  status: async () => ({ available: false, reason }),
  transcribe: async () => {
    throw new ApiError("UNAVAILABLE", reason, false);
  },
});

const models = z.object({ data: z.array(z.object({ id: z.string() })) });
const transcriptionResult = z.object({ text: z.string() });

export function httpTranscription(base: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): TranscriptionClient {
  let model: string | null = null;
  const aborted = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
  return {
    async status(o) {
      try {
        const r = await fetchImpl(`${base}/models`, { headers: { Accept: "application/json" }, signal: o?.signal });
        // A page served in place of the API (a 200 with HTML) is not a service.
        if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return { available: false, reason: "No speech-to-text service answered." };
        const body = models.safeParse(await r.json());
        if (!body.success || !body.data.data.length) return { available: false, reason: "The speech-to-text service lists no model." };
        model = body.data.data[0].id;
        return { available: true, model };
      } catch (e) {
        if (aborted(e)) throw new ApiError("ABORTED", "Request cancelled", false);
        return { available: false, reason: "The speech-to-text service could not be reached." };
      }
    },
    async transcribe(audio, o) {
      const form = new FormData();
      form.append("file", audio, `speech.${audio.type.includes("ogg") ? "ogg" : "webm"}`);
      form.append("model", model ?? "");
      let r: Response;
      try {
        r = await fetchImpl(`${base}/audio/transcriptions`, { method: "POST", body: form, headers: { Accept: "application/json" }, signal: o?.signal });
      } catch (e) {
        if (aborted(e)) throw new ApiError("ABORTED", "Request cancelled", false);
        throw new ApiError("UNAVAILABLE", "The speech-to-text service could not be reached.", true);
      }
      if (!r.ok) throw new ApiError("UNAVAILABLE", `The speech-to-text service answered ${r.status}.`, true);
      const body = transcriptionResult.safeParse(await r.json().catch(() => null));
      if (!body.success) throw new ApiError("MALFORMED_RESPONSE", "The speech-to-text service sent a result this dashboard cannot read.", false);
      return body.data.text.trim();
    },
  };
}
