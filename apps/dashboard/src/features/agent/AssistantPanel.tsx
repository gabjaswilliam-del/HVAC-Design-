import { Plus } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { useResource, type Resource } from "../../lib/api/useResource";
import type { AgentCapabilities } from "../../lib/contracts/agent";
import { useAgentClient } from "../../app/dataClient";
import { operating, useOperating } from "../../app/operatingContext";
import { useIssues, useSite } from "../../app/site";
import { openIssues } from "../../lib/issues";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import { useSession } from "./conversationSession";
import "./agent.css";

/** Suggested questions. Equipment is suggested only when it is selected or has an
 *  open issue, never a healthy machine from another scenario. */
export function useSuggestions() {
  const agent = useAgentClient();
  const site = useSite();
  const issues = useIssues();
  const selectedId = useOperating((x) => x.selectedId);
  const caps = useResource("agent-capabilities", "agent", (signal) => agent.getCapabilities({ signal }));
  const devices = site.data?.topology.devices ?? [];
  const flagged = openIssues(issues.data?.issues).find((i) => i.equipmentIds.length)?.equipmentIds[0];
  const target = devices.find((d) => d.id === selectedId) ?? devices.find((d) => d.id === flagged);
  const general = (caps.data?.suggestedPrompts ?? []).filter((p) => !p.startsWith("Investigate"));
  return { caps, suggestions: target ? [`Investigate ${target.label}`, ...general] : general };
}

/**
 * What answers: a local model, offline rules with no language model connected, or no
 * assistant at all. Said in words, never implied by the absence of a badge.
 */
export function EngineBadge({ caps }: { caps: Resource<AgentCapabilities> }) {
  const a = useStrings().agent;
  const c = caps.data;
  if (!c) return caps.error ? <span className="agent-badge agent-badge--off">{a.engine.unavailable}</span> : null;
  const label = c.connection.state === "connected" ? a.engine.connected(c.model?.id ?? "") : c.connection.state === "offline" ? a.engine.offline : a.engine.unavailable;
  return (
    <span className={`agent-badge${c.connection.state === "unavailable" ? " agent-badge--off" : ""}`} title={c.connection.detail} data-engine={c.connection.state}>
      {label}
    </span>
  );
}

/** The assistant in the workspace, beside every screen. Hidden, not unmounted, while
 *  the Pilot tab is shown. */
export function AssistantPanel({ hidden = false }: { hidden?: boolean }) {
  const s = useStrings();
  const a = s.agent;
  const site = useSite();
  const { conversationId, request } = useOperating((x) => x.assistant);
  const { caps, suggestions } = useSuggestions();
  const version = useSession().version;

  return (
    <aside id="assistant-panel" className="assistant-panel" aria-label={a.drawerLabel} data-escape-ignore hidden={hidden}>
      <div className="assistant-panel__bar">
        <EngineBadge caps={caps} />
        <button
          type="button"
          className="button button--small button--quiet assistant-panel__new"
          onClick={() => operating.showConversation(null)}
          aria-label={a.newConversation}
          title={a.newConversation}
        >
          <Plus size={15} aria-hidden="true" />
          <span className="assistant-panel__new-text">{a.newConversation}</span>
        </button>
      </div>
      {site.data && (
        <>
          <details className="assistant-panel__history">
            <summary>{a.history}</summary>
            <ConversationList
              site={site.data}
              activeId={conversationId}
              refreshKey={`${conversationId}:${version}`}
              onOpen={(id) => operating.showConversation(id)}
            />
          </details>
          <ConversationView
            site={site.data}
            conversationId={conversationId}
            onConversationChange={(id) => operating.showConversation(id)}
            suggestions={suggestions}
            request={request}
            onRequestHandled={() => operating.clearAssistantRequest()}
          />
        </>
      )}
    </aside>
  );
}
