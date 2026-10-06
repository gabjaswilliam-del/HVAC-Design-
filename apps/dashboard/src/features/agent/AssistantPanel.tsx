import { Plus } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { useResource } from "../../lib/api/useResource";
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

/** The assistant in the workspace, beside every screen. Hidden, not unmounted, while
 *  the Pilot tab is shown. */
export function AssistantPanel({ hidden = false }: { hidden?: boolean }) {
  const s = useStrings();
  const a = s.agent;
  const site = useSite();
  const { conversationId, request } = useOperating((x) => x.assistant);
  const { suggestions } = useSuggestions();
  const version = useSession().version;

  return (
    <aside id="assistant-panel" className="assistant-panel" aria-label={a.drawerLabel} data-escape-ignore hidden={hidden}>
      <div className="assistant-panel__bar">
        <span className="agent-badge">{a.scripted}</span>
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
