import { PageHeading } from "../../components/PageHeading";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { Notice } from "../../components/Notice";
import { operating } from "../../app/operatingContext";
import { useSite } from "../../app/site";
import { useSuggestions } from "./AssistantDrawer";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import "./agent.css";

/** Full-page assistant: history, the conversation and the simulated tools. */
export function AgentPage() {
  const s = useStrings();
  const a = s.agent;
  const site = useSite();
  const [params, setParams] = useSearchParams();
  const conversationId = params.get("conversation");
  const { caps, suggestions } = useSuggestions();
  const [refresh, setRefresh] = useState(0);

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("conversation", id);
    else next.delete("conversation");
    setParams(next, { replace: !id });
    operating.showConversation(id);
  };

  return (
    <div className="page agent-page">
      <div className="page__head">
        <PageHeading>
          {a.heading} <span className="agent-badge">{a.scripted}</span>
        </PageHeading>
      </div>
      {site.error && !site.data && (
        <Notice tone="critical" action={{ label: s.monitoring.retry, onClick: site.retry }}>
          {s.monitoring.siteFailed} {site.error.message}
        </Notice>
      )}
      {site.data && (
        <div className="agent-page__layout">
          <nav className="panel agent-page__history" aria-label={a.history}>
            <div className="panel__head">
              <h2>{a.history}</h2>
              <button type="button" className="button button--small" onClick={() => open(null)}>
                <Plus size={14} aria-hidden="true" />
                {a.newConversation}
              </button>
            </div>
            <div className="panel__body">
              <ConversationList site={site.data} activeId={conversationId} refreshKey={`${conversationId}:${refresh}`} onOpen={open} />
            </div>
          </nav>
          <section className="panel agent-page__conversation" aria-label={a.heading}>
            <ConversationView
              site={site.data}
              conversationId={conversationId}
              onConversationChange={open}
              suggestions={suggestions}
              onTurnEnd={() => setRefresh((n) => n + 1)}
            />
          </section>
          <section className="panel agent-page__tools" aria-labelledby="agent-tools-heading">
            <div className="panel__head">
              <h2 id="agent-tools-heading">{a.tools}</h2>
            </div>
            <div className="panel__body">
              {!caps.data ? (
                <div className="skeleton" style={{ height: 120 }} />
              ) : (
                <ul className="agent-tools">
                  {caps.data.tools.map((t) => (
                    <li key={t.name} data-tool-name={t.name}>
                      <code>{t.name}</code>
                      <span className={t.available ? "agent-tools__ok" : "agent-tools__no"}>{t.available ? a.toolAvailable : a.toolUnavailable}</span>
                      <span className="agent-tools__desc">{t.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
