import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isAbort } from "../../lib/api/client";
import { agentEvent, applyEvent, type AgentContext, type Conversation, type Turn } from "../../lib/contracts/agent";
import { useAgentClient } from "../../app/dataClient";

/**
 * One conversation: loads it, streams new turns into it and confirms cancellation.
 * Every streamed event is validated at the boundary; a malformed event ends the turn
 * as an error instead of being rendered.
 */
export function useConversation(conversationId: string | null, onCreated: (id: string) => void) {
  const agent = useAgentClient();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [live, setLive] = useState<Turn | null>(null);
  const [sendError, setSendError] = useState<ApiError | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // True from the moment a question is sent until its turn has ended.
  const [busy, setBusy] = useState(false);
  const current = useRef(conversationId);
  current.current = conversationId;

  useEffect(() => {
    setLoadError(null);
    setSendError(null);
    if (!conversationId) {
      setConversation(null);
      return;
    }
    const controller = new AbortController();
    agent.getConversation(conversationId, { signal: controller.signal }).then(
      (c) => setConversation(c),
      (e) => !isAbort(e) && setLoadError(e instanceof ApiError ? e : new ApiError("UNAVAILABLE", String(e), true)),
    );
    return () => controller.abort();
  }, [agent, conversationId]);

  /** Send a question; creates a conversation with `context` first if none is open. */
  const send = useCallback(
    async (prompt: string, context: AgentContext): Promise<boolean> => {
      setSendError(null);
      setBusy(true);
      let id = current.current;
      try {
        if (!id) {
          const created = await agent.createConversation(context);
          id = created.id;
          current.current = id;
          setConversation(created);
          onCreated(id);
        }
        let turn: Turn | null = null;
        for await (const raw of agent.sendMessage(id, prompt)) {
          const parsed = agentEvent.safeParse(raw);
          if (!parsed.success) throw new ApiError("MALFORMED_RESPONSE", "The assistant sent an event this dashboard cannot read.", false);
          const e = parsed.data;
          if (e.type === "turn_start") turn = { id: e.turnId, prompt: e.prompt, at: e.at, parts: [], status: "running" };
          else if (turn) turn = applyEvent(turn, e);
          if (current.current === id) setLive(turn);
        }
        if (current.current === id) {
          setConversation(await agent.getConversation(id));
          setLive(null);
        }
        return true;
      } catch (e) {
        setLive(null);
        setSendError(e instanceof ApiError ? e : new ApiError("UNAVAILABLE", String(e), true));
        return false;
      } finally {
        setCancelling(false);
        setBusy(false);
      }
    },
    [agent, onCreated],
  );

  const cancel = useCallback(async () => {
    if (!live || !current.current) return;
    setCancelling(true);
    await agent.cancelTurn(current.current, live.id);
  }, [agent, live]);

  const turns = conversation ? [...conversation.turns.filter((t) => t.id !== live?.id), ...(live ? [live] : [])] : live ? [live] : [];
  return { conversation, turns, loadError, sendError, streaming: busy, cancelling, send, cancel };
}
