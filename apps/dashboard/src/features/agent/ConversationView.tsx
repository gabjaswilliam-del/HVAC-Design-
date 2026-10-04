import { useEffect, useId, useRef, useState } from "react";
import { Beaker, Send, Square } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import type { SiteBundle } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { useOperating } from "../../app/operatingContext";
import { useAgentContext } from "../../app/site";
import { TurnView } from "./TurnView";
import { useConversation } from "./useConversation";

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

/** One conversation with its composer; shared by the drawer and the full page. */
export function ConversationView({ site, conversationId, onConversationChange, suggestions, request, onRequestHandled, onTurnEnd }: ConversationViewProps) {
  const s = useStrings();
  const a = s.agent;
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  const composerId = useId();
  const contextFor = useAgentContext();
  const scenarioId = useOperating((x) => x.scenarioId);
  const { conversation, turns, loadError, sendError, streaming, cancelling, send, cancel } = useConversation(
    conversationId,
    onConversationChange,
  );
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const handled = useRef<number | null>(null);

  const ask = async (prompt: string, equipmentId?: string | null) => {
    const context = contextFor(equipmentId);
    if (!prompt.trim() || !context || streaming) return;
    setDraft("");
    setAnnouncement("");
    // A follow-up keeps its conversation's recorded context; a new conversation uses
    // the requested one (never a previously shown conversation's context).
    const ok = await send(prompt.trim(), conversationId ? conversation?.context ?? context : context);
    if (ok) setAnnouncement(a.answered);
    else setDraft(prompt); // keep the question so it can be retried
    onTurnEnd?.();
  };

  useEffect(() => {
    if (!request || handled.current === request.nonce) return;
    handled.current = request.nonce;
    onRequestHandled?.();
    void ask(request.prompt, request.equipmentId);
  }, [request?.nonce]); // a request is handled once, identified by its nonce

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, turns.at(-1)?.parts.length]);

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

      <div className="agent-turns" aria-live="off">
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} site={site} context={ctx ?? contextFor()!} />
        ))}
        {turns.length === 0 && !streaming && (
          <div className="agent-suggestions">
            <h3>{a.suggestions}</h3>
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
        <div ref={endRef} />
      </div>

      {sendError && (
        <Notice tone="warning" action={{ label: a.tryAgain, onClick: () => void ask(draft) }}>
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
          void ask(draft);
        }}
      >
        <label htmlFor={composerId} className="visually-hidden">
          {a.composerLabel}
        </label>
        <textarea
          id={composerId}
          rows={2}
          value={draft}
          placeholder={a.composerPlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
        />
        {streaming ? (
          <button type="button" className="button" onClick={() => void cancel()} disabled={cancelling}>
            <Square size={14} aria-hidden="true" />
            {cancelling ? a.cancelling : a.cancel}
          </button>
        ) : (
          <button type="submit" className="button" disabled={!draft.trim()}>
            <Send size={14} aria-hidden="true" />
            {a.send}
          </button>
        )}
      </form>
    </div>
  );
}
