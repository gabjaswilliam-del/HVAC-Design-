import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Beaker, Send, Square } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import type { SiteBundle } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { operating, useOperating } from "../../app/operatingContext";
import { useAgentContext } from "../../app/site";
import { TurnView } from "./TurnView";
import { session, sessionTurns, turnKey, useSession } from "./conversationSession";

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
  const { conversation, loadError, sendError, busy: streaming, cancelling, draft } = st;
  const turns = sessionTurns(st);
  const [announcement, setAnnouncement] = useState("");
  const handled = useRef<number | null>(null);

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

  useEffect(() => session.show(conversationId), [conversationId]);
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

  const ask = async (prompt: string, equipmentId?: string | null) => {
    const context = contextFor(equipmentId);
    if (!prompt.trim() || !context || streaming) return;
    session.setDraft("");
    setAnnouncement("");
    follow(true);
    // A follow-up keeps its conversation's recorded context; a new conversation uses
    // the requested one (never a previously shown conversation's context).
    const ok = await session.send(prompt.trim(), conversationId ? conversation?.context ?? context : context, onConversationChange);
    if (ok) setAnnouncement(a.answered);
    else session.setDraft(prompt); // keep the question so it can be retried
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
          onChange={(e) => {
            session.setDraft(e.target.value);
            // Details first; the conversation takes the space once you start asking.
            if (e.target.value.trim()) operating.setDetailsCollapsed(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
        />
        <div className="agent-composer__bar">
          {streaming ? (
            <button type="button" className="button button--small" onClick={() => void session.cancel()} disabled={cancelling}>
              <Square size={13} aria-hidden="true" />
              {cancelling ? a.cancelling : a.cancel}
            </button>
          ) : (
            <button type="submit" className="button button--small button--primary" disabled={!draft.trim()}>
              <Send size={13} aria-hidden="true" />
              {a.send}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
