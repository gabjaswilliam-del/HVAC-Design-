/**
 * Graph RAG: the document library, search over the indexed passages, and the knowledge
 * graph, with one inspection panel beside them (a document, a passage, a node or a
 * relationship). Everything chosen is in the address, so a citation opens the exact
 * passage: `/knowledge?passage=chk_…`, `?kv=graph&node=ent_…`, `?doc=doc_…`.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { useResource } from "../../../lib/api/useResource";
import type { KnowledgeClient } from "../../../lib/api/knowledge";
import { RadioGroup } from "../../../components/RadioGroup";
import { Library } from "./Library";
import { SearchView } from "./SearchView";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import { DocumentPanel } from "./DocumentPanel";
import { PassagePanel } from "./PassagePanel";
import { NodePanel, EdgePanel } from "./GraphPanels";

type View = "library" | "search" | "graph";
const INSPECT = ["doc", "passage", "node", "edge"] as const;
export type Inspect = { kind: (typeof INSPECT)[number]; id: string } | null;

export interface RagNav {
  /** Show one thing in the inspection panel (or nothing), optionally in another view. */
  inspect: (target: Inspect, view?: View) => void;
  /** Search for this question in the Search view. */
  search: (q: string) => void;
  /** Add a node's neighbours to the graph view (bounded) and show it there. */
  expand: (id: string) => void;
}

const MAX_EXPANDED = 12;

export function RagWorkspace({ client }: { client: KnowledgeClient }) {
  const s = useKnowledgeStrings().rag;
  const [params, setParams] = useSearchParams();
  const view: View = (["search", "graph"] as const).find((v) => v === params.get("kv")) ?? "library";
  const inspected: Inspect = INSPECT.map((k) => (params.get(k) ? { kind: k, id: params.get(k)! } : null)).find(Boolean) ?? null;
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  const docs = useResource(`docs:${revision}`, "knowledge", (signal) => client.listDocuments({ signal }));
  const status = useResource("status", "knowledge", (signal) => client.status({ signal }));

  // While a document is queued or processing, read the library again every second.
  const working = docs.data?.documents.some((d) => d.status === "queued" || d.status === "processing");
  useEffect(() => {
    if (!working) return;
    const t = window.setTimeout(refresh, 1000);
    return () => window.clearTimeout(t);
  }, [working, docs.data, refresh]);

  const nav: RagNav = {
    inspect: (target, to) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        for (const k of INSPECT) next.delete(k);
        if (target) next.set(target.kind, target.id);
        if (to) to === "library" ? next.delete("kv") : next.set("kv", to);
        return next;
      }),
    search: (q) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        for (const k of INSPECT) next.delete(k);
        next.set("kv", "search");
        next.set("q", q);
        return next;
      }),
    expand: (id) => {
      setExpanded((list) => [...list.filter((x) => x !== id), id].slice(-MAX_EXPANDED));
      nav.inspect({ kind: "node", id }, "graph");
    },
  };
  const setView = (v: View) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (v === "library") next.delete("kv");
      else next.set("kv", v);
      // A node or relationship belongs to the graph; leaving it closes their panel.
      if (v !== "graph") (next.delete("node"), next.delete("edge"));
      return next;
    });
  const close = () => nav.inspect(null);

  return (
    <div className="kn-rag">
      <div className="kn-viewbar">
        <RadioGroup
          label={s.views.label}
          value={view}
          onChange={setView}
          options={[
            { value: "library", label: s.views.library },
            { value: "search", label: s.views.search },
            { value: "graph", label: s.views.graph },
          ]}
        />
      </div>
      <div className={`kn-split${inspected ? " kn-split--open" : ""}`}>
        <div className="kn-main">
          {view === "library" && <Library client={client} docs={docs} status={status} nav={nav} refresh={refresh} selected={inspected?.kind === "doc" ? inspected.id : null} />}
          {view === "search" && <SearchView client={client} query={params.get("q") ?? ""} nav={nav} />}
          {view === "graph" && <KnowledgeGraphView client={client} nav={nav} selected={inspected} revision={revision} expanded={expanded} onReset={() => setExpanded([])} />}
        </div>
        {inspected && (
          <div className="kn-side">
            {inspected.kind === "doc" && <DocumentPanel key={inspected.id} client={client} id={inspected.id} nav={nav} refresh={refresh} revision={revision} onClose={close} />}
            {inspected.kind === "passage" && <PassagePanel client={client} id={inspected.id} nav={nav} onClose={close} />}
            {inspected.kind === "node" && <NodePanel client={client} id={inspected.id} nav={nav} onClose={close} />}
            {inspected.kind === "edge" && <EdgePanel client={client} id={inspected.id} nav={nav} onClose={close} />}
          </div>
        )}
      </div>
    </div>
  );
}
