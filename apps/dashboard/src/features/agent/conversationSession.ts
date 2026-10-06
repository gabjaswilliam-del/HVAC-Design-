/**
 * The assistant conversation being shown, kept outside React: a streamed answer, the
 * draft and the confirmed cancellation survive the view being unmounted (collapsing
 * the workspace, expanding to the full page). Every view subscribes to this one
 * session. Every streamed event is validated at the boundary; a malformed event ends
 * the turn as an error instead of being rendered.
 */
import { useSyncExternalStore } from "react";
import { ApiError, isAbort } from "../../lib/api/client";
import { agentEvent, applyEvent, type AgentContext, type Conversation, type Turn } from "../../lib/contracts/agent";
import { agentClient as agent } from "../../app/dataClient";

export interface Session {
  id: string | null;
  conversation: Conversation | null;
  loadError: ApiError | null;
  /** The turn being streamed, until the stored conversation includes it; from the moment
   *  a question is sent, before the harness has started it. */
  live: Turn | null;
  sendError: ApiError | null;
  cancelling: boolean;
  /** From the moment a question is sent until its turn has ended. */
  busy: boolean;
  draft: string;
  /** Increments when a turn ends, so history lists refresh. */
  version: number;
}

let state: Session = {
  id: null,
  conversation: null,
  loadError: null,
  live: null,
  sendError: null,
  cancelling: false,
  busy: false,
  draft: "",
  version: 0,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<Session>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
let loading: AbortController | null = null;

export const useSession = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

/** Stored turns plus the live one, without duplicating it once it is stored. */
export const sessionTurns = (s: Session) =>
  s.conversation ? [...s.conversation.turns.filter((t) => t.id !== s.live?.id), ...(s.live ? [s.live] : [])] : s.live ? [s.live] : [];

// A question shows at once under a local key; its turn keeps that key once the harness
// names it and after it is stored, so nothing remounts while the answer arrives.
const keys = new Map<string, string>();
let asked = 0;
export const turnKey = (t: Turn) => keys.get(t.id) ?? t.id;
/** The harness turn being streamed, wherever it is shown, so Cancel always reaches it. */
let streaming: { conversationId: string; turnId: string } | null = null;

const asError = (e: unknown) => (e instanceof ApiError ? e : new ApiError("UNAVAILABLE", String(e), true));

export const session = {
  /** Show a conversation, or none for a new one. Loads only when the ID changes. An
   *  answer still streaming elsewhere carries on and is stored with its conversation. */
  show(id: string | null) {
    if (id === state.id) return;
    loading?.abort();
    set({ id, conversation: null, loadError: null, sendError: null, live: null });
    if (!id) return;
    const controller = new AbortController();
    loading = controller;
    agent.getConversation(id, { signal: controller.signal }).then(
      (c) => state.id === id && set({ conversation: c }),
      (e) => !isAbort(e) && state.id === id && set({ loadError: asError(e) }),
    );
  },

  setDraft: (draft: string) => set({ draft }),

  /** Send a question; creates a conversation with `context` first if none is open. */
  async send(prompt: string, context: AgentContext, onCreated: (id: string) => void): Promise<boolean> {
    const key = `asked-${++asked}`;
    set({ sendError: null, busy: true, live: { id: key, prompt, at: context.at, parts: [], status: "running" } });
    let id = state.id;
    try {
      if (!id) {
        const created = await agent.createConversation(context);
        id = created.id;
        // Opened elsewhere meanwhile: the answer carries on in its own conversation.
        if (state.id === null) {
          set({ id, conversation: created });
          onCreated(id);
        }
      }
      let turn: Turn | null = null;
      for await (const raw of agent.sendMessage(id, prompt)) {
        const parsed = agentEvent.safeParse(raw);
        if (!parsed.success) throw new ApiError("MALFORMED_RESPONSE", "The assistant sent an event this dashboard cannot read.", false);
        const e = parsed.data;
        if (e.type === "turn_start") {
          keys.set(e.turnId, key);
          streaming = { conversationId: id, turnId: e.turnId };
          // Cancel pressed before the harness started the turn applies now.
          if (state.cancelling) void agent.cancelTurn(id, e.turnId);
          turn = { id: e.turnId, prompt: e.prompt, at: e.at, parts: [], status: "running" };
        } else if (turn) turn = applyEvent(turn, e);
        if (state.id === id) set({ live: turn });
      }
      if (state.id === id) set({ conversation: await agent.getConversation(id), live: null });
      return true;
    } catch (e) {
      set({ live: null, sendError: asError(e) });
      return false;
    } finally {
      streaming = null;
      set({ cancelling: false, busy: false, version: state.version + 1 });
    }
  },

  /** Ask the harness to cancel; the stream's turn_end confirms the outcome. */
  async cancel() {
    if (!state.busy || state.cancelling) return;
    set({ cancelling: true });
    if (streaming) await agent.cancelTurn(streaming.conversationId, streaming.turnId);
  },
};
