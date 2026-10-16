/**
 * RAG Graph: the knowledge graph filling the workspace, with what it is browsed and read
 * through beside it in one column: the document library or the passages a search found,
 * and over them the inspection of what was chosen (a document, a passage, a node or a
 * relationship), with the way back to the list. Everything chosen is in the address, so a
 * citation opens the exact passage: `/knowledge?passage=chk_…`, `?node=ent_…`, `?doc=doc_…`,
 * `?kv=library`, `?kv=search&q=…`.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useSearchParams } from "react-router";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { useResource } from "../../../lib/api/useResource";
import type { KnowledgeClient } from "../../../lib/api/knowledge";
import { Library } from "./Library";
import { SearchResults } from "./SearchView";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import { DocumentPanel } from "./DocumentPanel";
import { PassagePanel } from "./PassagePanel";
import { NodePanel, EdgePanel } from "./GraphPanels";

export type Drawer = "library" | "search";
const INSPECT = ["doc", "passage", "node", "edge"] as const;
export type Inspect = { kind: (typeof INSPECT)[number]; id: string } | null;

export interface RagNav {
  /** Show one thing in the inspection column (or nothing). */
  inspect: (target: Inspect) => void;
  /** Search the indexed passages for this question; the results open beside the graph. */
  search: (q: string) => void;
  /** Open or close the document library beside the graph. */
  library: (open: boolean) => void;
  /** Add a node's neighbours to the graph (bounded) and show it there. */
  expand: (id: string) => void;
}

const MAX_EXPANDED = 12;

export function RagWorkspace({ client, onCount }: { client: KnowledgeClient; onCount: (text: string | null) => void }) {
  const s = useKnowledgeStrings().rag;
  const [params, setParams] = useSearchParams();
  const kv = params.get("kv");
  const drawer: Drawer | null = kv === "library" || kv === "search" ? kv : null;
  const inspected: Inspect = INSPECT.map((k) => (params.get(k) ? { kind: k, id: params.get(k)! } : null)).find(Boolean) ?? null;
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [inGraph, setInGraph] = useState<ReadonlySet<string>>(() => new Set());
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
  // The graph is read again when indexing ends or a document goes, not on every poll.
  const indexed = docs.data?.documents.filter((d) => d.status !== "queued" && d.status !== "processing").map((d) => `${d.id}@${d.indexedAt}`).join();
  const [graphRevision, setGraphRevision] = useState(0);
  const lastIndexed = useRef(indexed);
  useEffect(() => {
    if (indexed !== undefined && lastIndexed.current !== undefined && indexed !== lastIndexed.current) setGraphRevision((r) => r + 1);
    if (indexed !== undefined) lastIndexed.current = indexed;
  }, [indexed]);

  const change = (edit: (next: URLSearchParams) => void) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      edit(next);
      return next;
    });
  const nav: RagNav = {
    inspect: (target) =>
      change((next) => {
        for (const k of INSPECT) next.delete(k);
        if (target) next.set(target.kind, target.id);
      }),
    // A list opened beside the graph takes the column: what was being inspected closes.
    search: (q) =>
      change((next) => {
        for (const k of INSPECT) next.delete(k);
        next.set("kv", "search");
        next.set("q", q);
      }),
    library: (open) =>
      change((next) => {
        if (open) {
          for (const k of INSPECT) next.delete(k);
          next.delete("q");
          next.set("kv", "library");
        } else if (next.get("kv") === "library") next.delete("kv");
      }),
    expand: (id) => {
      setExpanded((list) => [...list.filter((x) => x !== id), id].slice(-MAX_EXPANDED));
      nav.inspect({ kind: "node", id });
    },
  };
  const closeList = () =>
    change((next) => {
      next.delete("kv");
      next.delete("q");
    });
  const close = () => nav.inspect(null);

  // The list keeps its place under an inspection: the column scrolls the inspection from its
  // top, and the list where it was when the inspection closes.
  const column = useRef<HTMLDivElement>(null);
  const list = `${drawer}:${params.get("q") ?? ""}`;
  const listTop = useRef({ list, top: 0 });
  const over = Boolean(drawer && inspected);
  useLayoutEffect(() => {
    if (column.current) column.current.scrollTop = over || listTop.current.list !== list ? 0 : listTop.current.top;
  }, [over, list]);
  // "Back" leaves as Escape does, from inside the inspection, so focus returns to what opened
  // it in the list (or to the list).
  const back = () => {
    column.current?.querySelector<HTMLElement>(".kn-panel__head h3")?.focus({ preventScroll: true });
    close();
  };

  return (
    <div className="kn-rag">
      <div className="kn-rag__stage">
        <KnowledgeGraphView
          client={client}
          nav={nav}
          selected={inspected}
          revision={graphRevision}
          expanded={expanded}
          onReset={() => setExpanded([])}
          drawer={drawer}
          query={drawer === "search" ? (params.get("q") ?? "") : ""}
          onNodes={setInGraph}
          onCount={onCount}
        />
      </div>
      {(drawer || inspected) && (
        <div ref={column} className="kn-column" onScroll={(e) => !over && (listTop.current = { list, top: e.currentTarget.scrollTop })}>
          {/* The list stays mounted under an inspection (its place and any form in progress
              keep), and comes back when the inspection closes. */}
          {drawer && (
            <div className="kn-column__list" hidden={Boolean(inspected)}>
              {drawer === "library" ? (
                <Library client={client} docs={docs} status={status} nav={nav} refresh={refresh} onClose={closeList} />
              ) : (
                <SearchResults client={client} query={params.get("q") ?? ""} nav={nav} inGraph={inGraph} onClose={closeList} />
              )}
            </div>
          )}
          {inspected && (
            <>
              {drawer && (
                <button type="button" className="text-button kn-back" onClick={back}>
                  <ChevronLeft size={14} aria-hidden="true" />
                  {s.back[drawer]}
                </button>
              )}
              {inspected.kind === "doc" && <DocumentPanel key={inspected.id} client={client} id={inspected.id} nav={nav} refresh={refresh} revision={revision} onClose={close} />}
              {inspected.kind === "passage" && <PassagePanel client={client} id={inspected.id} nav={nav} onClose={close} />}
              {inspected.kind === "node" && <NodePanel client={client} id={inspected.id} nav={nav} onClose={close} />}
              {inspected.kind === "edge" && <EdgePanel client={client} id={inspected.id} nav={nav} onClose={close} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
