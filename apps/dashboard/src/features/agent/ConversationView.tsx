import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Beaker, FileText, LoaderCircle, Mic, Paperclip, Send, Square, X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import type { SiteBundle } from "../../lib/contracts";
import type { AttachmentInput } from "../../lib/contracts/agent";
import { EXTENSIONS, formatBytes, readAttachments, type AttachmentProblem } from "../../lib/agent/attachments";
import { Notice } from "../../components/Notice";
import { operating, useOperating } from "../../app/operatingContext";
import { useAgentContext } from "../../app/site";
import { TurnView } from "./TurnView";
import { session, sessionTurns, turnKey, useSession, wasApplied } from "./conversationSession";
import { useVoiceInput } from "./voice";

/** Within this many pixels of the end, the reader is reading the latest. */
const NEAR_END = 48;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface ConversationViewProps {
  site: SiteBundle;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  suggestions: string[];
  /** A question asked from elsewhere (e.g. "Ask the assistant" on equipment). */
  request?: { prompt: string; equipmentId: string | null; nonce: number } | null;
  onRequestHandled?: () => void;
  /** Called after each answer finishes, e.g. to refresh the history list. */
  onTurnEnd?: () => void;
}

/**
 * One conversation with its composer; shared by the workspace and the full page. The
 * conversation itself lives in the session, so a streamed answer survives this view
 * being unmounted.
 */
export function ConversationView({ site, conversationId, onConversationChange, suggestions, request, onRequestHandled, onTurnEnd }: ConversationViewProps) {
  const s = useStrings();
  const a = s.agent;
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  const composerId = useId();
  const contextFor = useAgentContext();
  const scenarioId = useOperating((x) => x.scenarioId);
  const st = useSession();
  const { conversation, loadError, sendError, busy: streaming, cancelling, draft, attachments } = st;
  const turns = sessionTurns(st);
  const [announcement, setAnnouncement] = useState("");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [problems, setProblems] = useState<AttachmentProblem[]>([]);
  const [reading, setReading] = useState(false);
  const handled = useRef<number | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachHintId = useId();
  const voiceNoteId = useId();
  // A transcription joins the draft, to be read and sent like typed text.
  const voice = useVoiceInput((text) => {
    session.setDraft(draft.trim() ? `${draft.trimEnd()} ${text}` : text);
    composer.current?.focus();
  });
  const [, tick] = useState(0);
  useEffect(() => {
    if (voice.phase !== "recording") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [voice.phase]);
  const seconds = Math.max(0, Math.floor((Date.now() - voice.startedAt) / 1000));

  const attach = async (files: File[]) => {
    if (!files.length) return;
    setReading(true);
    const { added, problems: found } = await readAttachments(files, session.attachments());
    session.setAttachments([...session.attachments(), ...added]);
    setProblems(found);
    setReading(false);
    if (added.length) operating.setDetailsCollapsed(true);
  };
  // Stop: nothing more is drawn from this moment, and the composer is ready for the next question.
  const stop = () => {
    void session.cancel();
    composer.current?.focus();
  };

  // Following: the newest text stays in view as it arrives, until the reader scrolls up
  // or works with something in the conversation; "Jump to latest" brings them back.
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastTop = useRef(0);
  const shown = useRef({ busy: false, turns: 0 });
  const [away, setAway] = useState(false);
  const toEnd = (smooth: boolean) => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  };
  const follow = (smooth: boolean) => {
    following.current = true;
    setAway(false);
    toEnd(smooth);
  };
  const stopFollowing = () => {
    if (!following.current) return;
    following.current = false;
    // Halt a glide toward the end, or it would carry the reader back down.
    const el = scrollRef.current!;
    el.scrollTo({ top: el.scrollTop, behavior: "instant" });
  };

  // In the commit that draws it: a conversation created meanwhile is never shown away.
  useLayoutEffect(() => session.show(conversationId), [conversationId]);
  // A conversation opens at its end.
  useLayoutEffect(() => {
    following.current = true;
    setAway(false);
  }, [conversationId]);
  useLayoutEffect(() => {
    shown.current = { busy: streaming, turns: turns.length };
  });

  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => {
      if (!shown.current.turns) return el.scrollTo(0, 0); // suggestions read from the top
      // With everything in view there is nothing to have scrolled away from.
      if (el.scrollHeight <= el.clientHeight) following.current = true;
      if (following.current) toEnd(shown.current.busy); // glide while an answer streams
      else setAway(el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_END);
    });
    ro.observe(el);
    ro.observe(logRef.current!);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current!;
    const top = el.scrollTop;
    const distance = el.scrollHeight - top - el.clientHeight;
    // Back at the end follows again; any move up (never caused by following) stops it.
    if (distance <= 2 || (top > lastTop.current && distance <= NEAR_END)) following.current = true;
    else if (top < lastTop.current - 1) stopFollowing();
    lastTop.current = el.scrollTop;
    setAway(!following.current && distance > NEAR_END);
  };

  /** Typed, transcribed or suggested, with files or without: one message, one path. */
  const ask = async (prompt: string, equipmentId?: string | null, files: AttachmentInput[] = []) => {
    const context = contextFor(equipmentId);
    if ((!prompt.trim() && !files.length) || !context || streaming || reading) return;
    session.setDraft("");
    session.setAttachments([]);
    setAnnouncement("");
    setVoiceNote(null);
    setProblems([]);
    follow(true);
    // A follow-up keeps its conversation's recorded context; a new conversation uses
    // the requested one (never a previously shown conversation's context).
    const ok = await session.send({ prompt: prompt.trim(), attachments: files }, conversationId ? conversation?.context ?? context : context, onConversationChange);
    if (ok) {
      // What the answer opened, or pointed to, in the workspace is announced with it.
      const last = session.current().conversation?.turns.at(-1);
      const done = last?.parts.flatMap((p) => (p.type === "action" && wasApplied(last.id, p.action) ? [p.action] : [])) ?? [];
      const opened = done.filter((x) => x.kind === "open").map((x) => x.label);
      const pointed = done.filter((x) => x.kind === "reveal").map((x) => x.label);
      setAnnouncement(opened.length ? a.answeredOpened(opened.join(", ")) : pointed.length ? a.answeredPointed(pointed.join(", ")) : a.answered);
    } else {
      // Keep the question and its files so it can be retried.
      session.setDraft(prompt);
      session.setAttachments(files);
    }
    onTurnEnd?.();
  };

  useEffect(() => {
    if (!request || handled.current === request.nonce) return;
    handled.current = request.nonce;
    onRequestHandled?.();
    void ask(request.prompt, request.equipmentId);
  }, [request?.nonce]); // a request is handled once, identified by its nonce

  const ctx = conversation?.context;
  const mismatch = ctx?.demoScenario && ctx.demoScenario.id !== scenarioId;
  const equipmentLabel = ctx?.equipmentId ? site.topology.devices.find((d) => d.id === ctx.equipmentId)?.label : null;

  return (
    <div className="agent-conversation">
      <p className="agent-notice">
        <Beaker size={14} aria-hidden="true" /> {a.notice}
      </p>

      {ctx && (
        <p className="agent-context num">
          <span className="agent-context__label">{a.context}:</span>{" "}
          {a.contextValue(ctx.demoScenario?.label ?? "", `${formatTime(ctx.at, tz)} ${tzLabel}`)}
          {equipmentLabel && (
            <>
              , {a.contextEquipment} {equipmentLabel}
            </>
          )}
        </p>
      )}
      {mismatch && (
        <Notice tone="info" action={{ label: a.askCurrent, onClick: () => onConversationChange(null) }}>
          {a.mismatch(ctx!.demoScenario!.label, `${formatTime(ctx!.at, tz)} ${tzLabel}`)}
        </Notice>
      )}
      {loadError && <Notice tone="warning">{loadError.code === "NOT_FOUND" ? a.notFound : loadError.message}</Notice>}

      <div className="agent-scroll">
        <div
          ref={scrollRef}
          className="agent-turns"
          tabIndex={0}
          role="region"
          aria-label={a.conversation}
          aria-live="off"
          onScroll={onScroll}
          onWheel={(e) => e.deltaY < 0 && e.currentTarget.scrollTop > 0 && stopFollowing()}
          onKeyDown={(e) => ["ArrowUp", "PageUp", "Home"].includes(e.key) && stopFollowing()}
        >
          <div ref={logRef} className="agent-log" onPointerDown={stopFollowing} onFocus={stopFollowing}>
            {turns.map((t) => (
              <TurnView key={turnKey(t)} turn={t} site={site} context={ctx ?? contextFor()!} />
            ))}
            {turns.length === 0 && !streaming && (
              <div className="agent-suggestions">
                <h2>{a.suggestions}</h2>
                <ul>
                  {suggestions.map((p) => (
                    <li key={p}>
                      <button type="button" className="agent-suggestion" onClick={() => void ask(p)}>
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        {away && (
          <button
            type="button"
            className="button button--small agent-jump"
            onClick={(e) => {
              const hadFocus = document.activeElement === e.currentTarget;
              follow(true);
              // The button goes once at the end; focus stays in the conversation.
              if (hadFocus) scrollRef.current?.focus({ preventScroll: true });
            }}
          >
            <ArrowDown size={14} aria-hidden="true" />
            {a.jumpToLatest}
          </button>
        )}
      </div>

      {sendError && (
        <Notice tone="warning" action={{ label: a.tryAgain, onClick: () => void ask(draft, undefined, attachments) }}>
          {sendError.code === "UNAVAILABLE" ? a.unavailable : `${a.failed} ${sendError.message}`}
        </Notice>
      )}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>

      <form
        className="agent-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft, undefined, attachments);
        }}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          void attach([...e.dataTransfer.files]);
        }}
      >
        <label htmlFor={composerId} className="visually-hidden">
          {a.composerLabel}
        </label>
        {attachments.length > 0 && (
          <ul className="agent-files agent-composer__files" aria-label={a.attachedFiles}>
            {attachments.map((f) => (
              <li key={`${f.name}:${f.size}`} className="agent-file">
                <FileText size={13} aria-hidden="true" />
                <span className="agent-file__name" title={f.name}>{f.name}</span>
                <span className="agent-file__size num">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  className="icon-button agent-file__remove"
                  aria-label={a.removeFile(f.name)}
                  title={a.removeFile(f.name)}
                  onClick={() => {
                    session.setAttachments(attachments.filter((x) => x !== f));
                    composer.current?.focus();
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={composer}
          id={composerId}
          rows={2}
          value={draft}
          placeholder={a.composerPlaceholder}
          onChange={(e) => {
            session.setDraft(e.target.value);
            setVoiceNote(null);
            // Details first; the conversation takes the space once you start asking.
            if (e.target.value.trim()) operating.setDetailsCollapsed(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft, undefined, attachments);
            } else if (e.key === "Escape" && streaming) {
              e.preventDefault();
              stop();
            }
          }}
        />
        {reading && (
          <p className="agent-composer__note" role="status">
            {a.readingFiles}
          </p>
        )}
        {problems.length > 0 && (
          <div className="agent-composer__alert" role="alert">
            {problems.map((p) => (
              <p key={`${p.name}:${p.code}`}>{a.attachProblem[p.code](p.name)}</p>
            ))}
          </div>
        )}
        {voice.problem && (
          <p className="agent-composer__alert" role="alert">
            {a.voiceProblem[voice.problem.code]} {voice.problem.detail}
          </p>
        )}
        {voiceNote && (
          <p id={voiceNoteId} className="agent-composer__note" role="status">
            {voiceNote}
          </p>
        )}
        {(voice.phase === "starting" || voice.phase === "recording" || voice.phase === "transcribing") && (
          <div className="agent-voice" data-voice={voice.phase}>
            <span className="agent-voice__state" role="status">
              {voice.phase === "recording" ? (
                <>
                  <span className="agent-voice__dot" aria-hidden="true" />
                  {a.voiceRecording} <span className="num">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>
                </>
              ) : (
                <>
                  <LoaderCircle size={14} aria-hidden="true" className="agent-tool__spin" />
                  {voice.phase === "starting" ? a.voiceStarting : a.voiceTranscribing}
                </>
              )}
            </span>
            {voice.phase === "recording" && (
              <span className="agent-voice__actions">
                <button type="button" className="button button--small" onClick={voice.finish}>
                  <Square size={12} aria-hidden="true" />
                  {a.voiceStop}
                </button>
                <button type="button" className="button button--small button--quiet" onClick={voice.discard}>
                  {a.voiceDiscard}
                </button>
              </span>
            )}
          </div>
        )}
        <div className="agent-composer__bar">
          <span className="agent-composer__inputs">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={EXTENSIONS.join(",")}
              hidden
              data-attach-input
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = ""; // the same file can be chosen again after removing it
                void attach(files);
              }}
            />
            <button
              type="button"
              className="icon-button agent-composer__input"
              aria-label={a.attach}
              aria-describedby={attachHintId}
              title={a.attachHint}
              data-attach
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={15} aria-hidden="true" />
            </button>
            <span id={attachHintId} className="visually-hidden">
              {a.attachHint}
            </span>
            {voice.phase === "off" || voice.phase === "checking" ? (
              <button
                type="button"
                className="icon-button agent-composer__input agent-composer__input--off"
                aria-label={voice.phase === "off" ? a.voiceOff : a.voiceChecking}
                aria-disabled="true"
                aria-describedby={voiceNote ? voiceNoteId : undefined}
                title={voice.phase === "off" ? a.voiceOffNote(voice.reason) : a.voiceChecking}
                data-voice-input={voice.phase}
                onClick={() => voice.phase === "off" && setVoiceNote(a.voiceOffNote(voice.reason))}
              >
                <Mic size={15} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="icon-button agent-composer__input"
                aria-label={voice.phase === "recording" ? a.voiceStop : a.voiceStart}
                aria-pressed={voice.phase === "recording"}
                aria-disabled={voice.phase === "starting" || voice.phase === "transcribing" || undefined}
                title={voice.phase === "recording" ? a.voiceStop : a.voiceStart}
                data-voice-input={voice.phase}
                onClick={() => (voice.phase === "recording" ? voice.finish() : voice.phase === "ready" && void voice.start())}
              >
                <Mic size={15} aria-hidden="true" />
              </button>
            )}
          </span>
          {streaming ? (
            <button
              type="button"
              className="button button--small agent-composer__stop"
              onClick={stop}
              aria-disabled={cancelling || undefined}
              aria-keyshortcuts="Escape"
              title={a.cancelTitle}
            >
              <Square size={13} aria-hidden="true" />
              {cancelling ? a.cancelling : a.cancel}
            </button>
          ) : (
            <button type="submit" className="button button--small button--primary" disabled={(!draft.trim() && !attachments.length) || reading}>
              <Send size={13} aria-hidden="true" />
              {a.send}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
