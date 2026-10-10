/**
 * Search over the indexed passages. Each result is a stored passage with its source,
 * section and page, how it was found (keyword rank, the graph path from an entity the
 * question names, vector rank when configured) and the entities it mentions. Ranks and
 * the fusion score order results; they are not probabilities. No answer is written: no
 * language model is configured, and the screen says so.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { motion } from "../../../lib/motion";
import { useResource } from "../../../lib/api/useResource";
import type { KnowledgeClient } from "../../../lib/api/knowledge";
import type { SearchHit, SearchResult } from "../../../lib/contracts/knowledge";
import { Notice } from "../../../components/Notice";
import { Highlighted } from "../shared";
import type { RagNav } from "./RagWorkspace";

export function SearchView({ client, query, nav }: { client: KnowledgeClient; query: string; nav: RagNav }) {
  const t = useKnowledgeStrings();
  const s = t.rag.search;
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  const result = useResource(query ? `search:${query}` : null, "search", (signal) => client.searchKnowledge({ query, limit: 8 }, { signal }));
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (result.data) motion.added(list.current ? Array.from(list.current.children).slice(0, 8) : []);
  }, [result.data]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim()) nav.search(draft.trim());
  };
  return (
    <section className="kn-section" aria-labelledby="kn-search-title">
      <div className="kn-section__head">
        <h2 id="kn-search-title">{s.title}</h2>
      </div>
      <form className="kn-search" role="search" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="kn-search-input">
          {s.label}
        </label>
        <input
          id="kn-search-input"
          className="kn-search__input"
          type="search"
          value={draft}
          maxLength={500}
          placeholder={s.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="button button--primary">
          <Search size={15} aria-hidden="true" />
          {s.submit}
        </button>
      </form>
      <div className="kn-examples">
        <span className="kn-meta">{s.examples}</span>
        {s.exampleQueries.map((q) => (
          <button key={q} type="button" className="chip kn-chip-button" onClick={() => nav.search(q)}>
            {q}
          </button>
        ))}
      </div>
      {!query && <p className="kn-empty">{s.intro}</p>}
      {query && result.loading && !result.data && (
        <p className="kn-loading" role="status">
          {s.searching}
        </p>
      )}
      {result.error && <Notice tone={result.error.code === "INVALID_REQUEST" ? "info" : "critical"}>{result.error.message}</Notice>}
      {result.data && <Results result={result.data} list={list} nav={nav} />}
    </section>
  );
}

function Results({ result, list, nav }: { result: SearchResult; list: React.RefObject<HTMLOListElement | null>; nav: RagNav }) {
  const t = useKnowledgeStrings();
  const s = t.rag.search;
  const m = result.methods;
  return (
    <>
      <div className="kn-methods" role="status">
        <p>
          <strong>{s.methodsTitle}</strong> {s.keyword(m.keyword.candidates)}
          {" · "}
          {m.graph.used ? s.graphFrom(m.graph.seeds.map((x) => `${x.name} (${t.types[x.type as keyof typeof t.types] ?? x.type})`).join(", ")) : s.graphNone}
          {" · "}
          {m.vector.used ? s.vectors(m.vector.model ?? "") : s.vectorsOff}
        </p>
        <p className="kn-meta">{s.noAnswer}</p>
        {m.graph.unknownTerms.length > 0 && <p className="kn-meta">{s.unknown(m.graph.unknownTerms.join(", "))}</p>}
      </div>
      {result.results.length === 0 ? (
        <p className="kn-empty">{s.none(result.query)}</p>
      ) : (
        <>
          <div className="kn-docs-found">
            <span className="kn-meta">{s.documents}</span>
            {result.documents.map((d) => (
              <button key={d.id} type="button" className="chip kn-chip-button" onClick={() => nav.inspect({ kind: "doc", id: d.id })}>
                {d.title}
                <span className="kn-chip-count">{d.passages}</span>
              </button>
            ))}
          </div>
          <ol ref={list} className="kn-results" aria-label={s.resultsLabel(result.results.length)}>
            {result.results.map((r) => (
              <Hit key={r.chunkId} hit={r} names={result.names} nav={nav} />
            ))}
          </ol>
          <p className="kn-meta">{s.fusionNote(result.fusion.k)}</p>
        </>
      )}
    </>
  );
}

function Hit({ hit, names, nav }: { hit: SearchHit; names: SearchResult["names"]; nav: RagNav }) {
  const t = useKnowledgeStrings();
  const s = t.rag.search;
  const name = (id: string | null) => (id ? (names[id]?.name ?? id) : "");
  return (
    <li className="kn-hit">
      <div className="kn-hit__head">
        <span className="kn-hit__rank" aria-label={s.rank(hit.rank)}>
          {hit.rank}
        </span>
        <button type="button" className="kn-rowlink kn-hit__source" onClick={() => nav.inspect({ kind: "passage", id: hit.chunkId })}>
          {hit.documentTitle}
        </button>
        <span className="kn-meta">
          {hit.sectionPath.split(" › ").slice(1).join(" › ") || hit.sectionPath}
          {hit.page !== null && ` · ${t.rag.page(hit.page)}`}
        </span>
        {hit.procedure && <span className="tag-chip kn-chip-sm">{t.types.procedure}</span>}
      </div>
      <p className="kn-hit__text">
        <Highlighted text={hit.text} ranges={hit.highlights} />
      </p>
      <ul className="kn-found-by" aria-label={s.foundBy}>
        {hit.methods.map((m) => (
          <li key={m.method}>
            <span className="kn-method">{s.method[m.method](m.rank)}</span>
            {m.paths?.slice(0, 3).map((p, i) => (
              <span key={i} className="kn-path">
                {name(p.start)}{" "}
                <span className="kn-path__rel">
                  {(p.direction === "in" ? t.inverse : t.relations)[p.relation as keyof typeof t.relations] ?? p.relation}
                </span>{" "}
                {name(p.end)}
              </span>
            ))}
          </li>
        ))}
      </ul>
      <div className="kn-hit__actions">
        <button type="button" className="button button--small" onClick={() => nav.inspect({ kind: "passage", id: hit.chunkId })}>
          {s.read}
        </button>
        {hit.entities.slice(0, 5).map((e) => (
          <button key={e.id} type="button" className="chip kn-chip-button" onClick={() => nav.inspect({ kind: "node", id: e.id }, "graph")}>
            <span className="kn-chip-type">{t.types[e.type as keyof typeof t.types] ?? e.type}</span>
            {e.name}
          </button>
        ))}
      </div>
    </li>
  );
}
