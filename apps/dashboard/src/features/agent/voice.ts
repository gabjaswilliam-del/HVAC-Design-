/**
 * Voice input for the composer: record, transcribe through the speech-to-text boundary,
 * and put the words in the draft for the operator to read and send like typed text. The
 * microphone is asked for only after a transcription service has answered; without one
 * the control says it is not connected and nothing is recorded.
 */
import { useEffect, useRef, useState } from "react";
import { transcription } from "../../app/dataClient";
import type { SpeechStatus } from "../../lib/api/speech";

export type VoicePhase = "checking" | "off" | "ready" | "starting" | "recording" | "transcribing";
export type VoiceProblem = "denied" | "no_microphone" | "unsupported" | "failed" | "empty";

// One probe for the session; every composer shares its answer.
let probe: Promise<SpeechStatus> | null = null;
const status = () => (probe ??= transcription.status().catch(() => ({ available: false as const, reason: "The speech-to-text service could not be reached." })));

export function useVoiceInput(onText: (text: string) => void) {
  const [phase, setPhase] = useState<VoicePhase>("checking");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<{ code: VoiceProblem; detail?: string } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const recording = useRef<{ recorder: MediaRecorder; stream: MediaStream; discard: boolean } | null>(null);
  const deliver = useRef(onText);
  deliver.current = onText;

  useEffect(() => {
    let live = true;
    void status().then((s) => {
      if (!live) return;
      setPhase(s.available ? "ready" : "off");
      if (!s.available) setReason(s.reason);
    });
    return () => {
      live = false;
      // Leaving the view ends a recording without sending it.
      const r = recording.current;
      if (r) {
        r.discard = true;
        if (r.recorder.state !== "inactive") r.recorder.stop();
        r.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function start() {
    if (phase !== "ready") return; // never reaches the microphone without a service
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setProblem({ code: "unsupported" });
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setPhase("ready");
      const name = e instanceof DOMException ? e.name : "";
      return setProblem({ code: name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no_microphone" : "failed" });
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const rec = { recorder, stream, discard: false };
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recording.current = null;
      if (rec.discard) return setPhase("ready");
      setPhase("transcribing");
      try {
        const text = await transcription.transcribe(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        if (text) deliver.current(text);
        else setProblem({ code: "empty" });
      } catch (e) {
        setProblem({ code: "failed", detail: e instanceof Error ? e.message : String(e) });
      }
      setPhase("ready");
    };
    recording.current = rec;
    recorder.start();
    setStartedAt(Date.now());
    setPhase("recording");
  }

  const stop = (discard: boolean) => {
    const r = recording.current;
    if (!r || r.recorder.state === "inactive") return;
    r.discard = discard;
    r.recorder.stop();
  };

  return { phase, reason, problem, startedAt, start, finish: () => stop(false), discard: () => stop(true), clearProblem: () => setProblem(null) };
}
