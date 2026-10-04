import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import { useResource } from "../../lib/api/useResource";
import type { SiteBundle } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { useAgentClient } from "../../app/dataClient";

/** Conversation history kept by the harness, newest first. */
export function ConversationList({
  site,
  activeId,
  refreshKey,
  onOpen,
}: {
  site: SiteBundle;
  activeId: string | null;
  refreshKey: string;
  onOpen: (id: string) => void;
}) {
  const s = useStrings();
  const a = s.agent;
  const agent = useAgentClient();
  const list = useResource(`conversations:${refreshKey}`, "agent", (signal) => agent.listConversations({ signal }));
  if (list.error && !list.data) {
    return (
      <Notice tone="warning" action={{ label: s.monitoring.retry, onClick: list.retry }}>
        {list.error.message}
      </Notice>
    );
  }
  if (!list.data) return <div className="skeleton" style={{ height: 120 }} />;
  if (list.data.length === 0) return <p className="inspector__muted">{a.noConversations}</p>;
  return (
    <ul className="agent-history">
      {list.data.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className="agent-history__item"
            aria-current={c.id === activeId ? "true" : undefined}
            onClick={() => onOpen(c.id)}
            data-conversation={c.id}
          >
            <span className="agent-history__title">{c.title}</span>
            <span className="agent-history__meta num">
              {c.context.demoScenario?.label}, {formatTime(c.context.at, site.site.timezone)} {site.site.timezoneLabel},{" "}
              {a.turns(c.turnCount)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
