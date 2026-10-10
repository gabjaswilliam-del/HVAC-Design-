import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { Notice } from "../../components/Notice";
import { operating } from "../../app/operatingContext";
import { useSite } from "../../app/site";
import { EngineBadge, useSuggestions } from "./AssistantPanel";
import { ConversationList } from "./ConversationList";
import { ConversationView } from "./ConversationView";
import { session, useSession } from "./conversationSession";
import "./agent.css";

/**
 * The workspace's assistant, expanded to the full page: history, the conversation and
 * the simulated tools. It shows the same session as the workspace, so an answer that
 * is streaming keeps streaming here.
 */
export function AgentPage() {
  const s = useStrings();
  const a = s.agent;
  const site = useSite();
  const [params, setParams] = useSearchParams();
  const { caps, suggestions } = useSuggestions();
  const st = useSession();
  const version = st.version;
  // Expanded while a question asked in the workspace is in flight: the page shows that
  // question's conversation, also when it is created only after the page opened.
  const [adopting, setAdopting] = useState(() => !params.get("conversation") && session.current().busy);
  const conversationId = params.get("conversation") ?? (adopting ? st.id : null);
  useEffect(() => {
    if (!adopting || !st.id) return;
    setAdopting(false);
    if (!params.get("conversation")) setParams((p) => (p.set("conversation", st.id!), p), { replace: true });
  }, [adopting, st.id]);

  // The page's conversation is also the workspace's, so docking again shows it.
  useEffect(() => operating.showConversation(conversationId), [conversationId]);

  const open = (id: string | null) => {
    setAdopting(false);
    const next = new URLSearchParams(params);
    if (id) next.set("conversation", id);
    else next.delete("conversation");
    setParams(next, { replace: !id });
  };

  return (
    <div className="page agent-page">
      <div className="page__head">
        <EngineBadge caps={caps} />
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
              <button type="button" className="button button--small button--tonal" onClick={() => open(null)}>
                <Plus size={14} aria-hidden="true" />
                {a.newConversation}
              </button>
            </div>
            <div className="panel__body">
              <ConversationList site={site.data} activeId={conversationId} refreshKey={`${conversationId}:${version}`} onOpen={open} />
            </div>
          </nav>
          <section className="panel agent-page__conversation" aria-label={a.heading} data-escape-ignore>
            <ConversationView site={site.data} conversationId={conversationId} onConversationChange={open} suggestions={suggestions} />
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
