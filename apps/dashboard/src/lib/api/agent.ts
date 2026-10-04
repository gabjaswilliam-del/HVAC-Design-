/**
 * Browser side of the local agent harness. Today the explicitly selected demo mode
 * implements it with scripted conversations; a local-LLM harness (streamed over the
 * local API) will implement the same methods and event stream.
 */
import type { AgentCapabilities, AgentContext, AgentEvent, Conversation, ConversationSummary } from "../contracts/agent";
import type { RequestOptions } from "./client";

export interface AgentClient {
  getCapabilities(o?: RequestOptions): Promise<AgentCapabilities>;
  listConversations(o?: RequestOptions): Promise<ConversationSummary[]>;
  getConversation(id: string, o?: RequestOptions): Promise<Conversation>;
  createConversation(context: AgentContext, o?: RequestOptions): Promise<Conversation>;
  /** Start a turn and stream its events. The stream ends with exactly one turn_end. */
  sendMessage(conversationId: string, prompt: string): AsyncIterable<AgentEvent>;
  /** Ask the harness to cancel; the stream's turn_end confirms the outcome. */
  cancelTurn(conversationId: string, turnId: string): Promise<void>;
}
