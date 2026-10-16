/**
 * Knowledge: two separate systems on one page. The RAG Graph (the default) holds technical
 * documents, their passages and the relationships their text supports, as a graph filling
 * the page; Graph Memory holds what happened at the plant and what was decided, over time.
 * Separate services, contracts and stores; neither reads the other. One slim header: the
 * two systems, the RAG Graph's count, and where its data comes from. Typed address:
 * `/knowledge?kn=rag|memory`.
 */
import { use, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { BookOpenText, History } from "lucide-react";
import { useSearchParams } from "react-router";
import { useKnowledgeStrings } from "../../lib/i18n/knowledge";
import { motion } from "../../lib/motion";
import { loadKnowledgeClients } from "../../app/dataClient";
import { KNOWLEDGE_PARAMS } from "../../app/navigation";
import { RagWorkspace } from "./rag/RagWorkspace";
import { MemoryWorkspace } from "./memory/MemoryWorkspace";
import { SourceTag } from "./shared";
import "./knowledge.css";

const TABS = [
  { key: "rag", icon: BookOpenText },
  { key: "memory", icon: History },
] as const;
type Tab = (typeof TABS)[number]["key"];

export function KnowledgePage() {
  const s = useKnowledgeStrings();
  const clients = use(loadKnowledgeClients());
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("kn") === "memory" ? "memory" : "rag";
  const panel = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState<string | null>(null);

  const show = (t: Tab) => {
    if (t === tab) return;
    setParams(
      (p) => {
        const next = new URLSearchParams();
        // A tab opens fresh: only the data context (scenario, mode, failures) carries over.
        for (const [k, v] of p) if (!KNOWLEDGE_PARAMS.includes(k)) next.set(k, v);
        if (t === "memory") next.set("kn", "memory");
        return next;
      },
      { replace: false },
    );
  };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.key === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length].key;
    show(t);
    requestAnimationFrame(() => document.getElementById(`kn-tab-${t}`)?.focus());
  };
  // A tab's content settles in when the tab changes.
  const shown = useRef<Tab | null>(null);
  useLayoutEffect(() => {
    if (shown.current && shown.current !== tab) motion.arrive(panel.current ? Array.from(panel.current.children) : []);
    shown.current = tab;
  }, [tab]);

  return (
    <div className={`page knowledge knowledge--${tab}`}>
      <div className="knowledge__head">
        <div className="kn-tabs" role="tablist" aria-label={s.tabs.label} onKeyDown={onKey}>
          {TABS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`kn-tab-${key}`}
              className="kn-tabs__tab"
              aria-selected={tab === key}
              aria-controls="kn-panel"
              tabIndex={tab === key ? 0 : -1}
              onClick={() => show(key)}
            >
              <Icon size={16} aria-hidden="true" />
              {s.tabs[key]}
            </button>
          ))}
        </div>
        {tab === "rag" && count && (
          <span className="kn-count" role="status">
            {count}
          </span>
        )}
        <SourceTag system={tab === "rag" ? "knowledge" : "memory"} />
      </div>
      {tab === "memory" && <p className="page__sub knowledge__lead">{s.lead.memory}</p>}
      <div ref={panel} id="kn-panel" role="tabpanel" aria-labelledby={`kn-tab-${tab}`} className="knowledge__panel">
        {tab === "rag" ? <RagWorkspace key="rag" client={clients.knowledge} onCount={setCount} /> : <MemoryWorkspace key="memory" client={clients.memory} />}
      </div>
    </div>
  );
}
