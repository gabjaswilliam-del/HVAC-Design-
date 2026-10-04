import { useState } from "react";
import { Link } from "react-router";
import { Maximize2, Plus, X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { useResource } from "../../lib/api/useResource";
import { useAgentClient } from "../../app/dataClient";
import { operating, useOperating } from "../../app/operatingContext";
import { useSite } from "../../app/site";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import "./agent.css";

/** Suggested questions, led by the selected equipment when there is one. */
export function useSuggestions() {
  const agent = useAgentClient();
  const site = useSite();
  const selectedId = useOperating((x) => x.selectedId);
  const caps = useResource("agent-capabilities", "agent", (signal) => agent.getCapabilities({ signal }));
  const selected = site.data?.topology.devices.find((d) => d.id === selectedId);
  const base = caps.data?.suggestedPrompts ?? [];
  return { caps, suggestions: selected ? [`Investigate ${selected.label}`, ...base.filter((p) => !p.startsWith("Investigate"))] : base };
}

/** The assistant beside any screen; the shell gives it its own column. */
export function AssistantDrawer() {
  const s = useStrings();
  const a = s.agent;
  const site = useSite();
  const { conversationId, request } = useOperating((x) => x.assistant);
  const { suggestions } = useSuggestions();
  const [refresh, setRefresh] = useState(0);

  return (
    <aside id="assistant-drawer" className="assistant-drawer" aria-label={a.drawerLabel}>
      <div className="assistant-drawer__head">
        <h2>
          {a.heading} <span className="agent-badge">{a.scripted}</span>
        </h2>
        <div className="assistant-drawer__actions">
          <button type="button" className="icon-button" onClick={() => operating.showConversation(null)} aria-label={a.newConversation} title={a.newConversation}>
            <Plus size={18} />
          </button>
          <Link
            className="icon-button"
            to={conversationId ? `/agent?conversation=${encodeURIComponent(conversationId)}` : "/agent"}
            aria-label={a.openPage}
            title={a.openPage}
          >
            <Maximize2 size={16} />
          </Link>
          <button type="button" className="icon-button" onClick={() => operating.openAssistant(false)} aria-label={a.close} title={a.close}>
            <X size={18} />
          </button>
        </div>
      </div>
      {site.data && (
        <>
          <details className="assistant-drawer__history">
            <summary>{a.history}</summary>
            <ConversationList
              site={site.data}
              activeId={conversationId}
              refreshKey={`${conversationId}:${refresh}`}
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
            onTurnEnd={() => setRefresh((n) => n + 1)}
          />
        </>
      )}
    </aside>
  );
}
