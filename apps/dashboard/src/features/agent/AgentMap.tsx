/**
 * The conversation's agent map, opened from the composer: one left-to-right branch per user
 * request, stacked in the order they were asked (`agentLayout.ts`). A task card is the request
 * and its execution (the turn's root agent); the tool calls and subagents it reported branch to
 * its right, and theirs from them. It reads the conversation's turns, so the running request's
 * branch grows and updates as events stream in while earlier branches stay as they were stored.
 * Nothing is inferred: a time, a token count, a parent or a caller the harness did not report
 * is shown as not reported.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bot, ChevronLeft, ChevronRight, Maximize, MessageSquareText, Minus, Network, Plus, Wrench, X } from "lucide-react";
import type { AgentRun, Turn } from "../../lib/contracts/agent";
import { useStrings } from "../../lib/i18n";
import { useEscapeLayer } from "../../components/escape";
import { activeSubagents, durationMs, formatDuration, mapTurn } from "./agentTree";
import { CARD, countBelow, initialFolds, layoutForest, mapForest, type MapNode, type Placed, type ToolPart } from "./agentLayout";

type Copy = ReturnType<typeof useStrings>["agent"];
type TaskNode = Extract<MapNode, { kind: "task" }>;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const KIND_ICON = { task: MessageSquareText, agent: Bot, tool: Wrench } as const;
const ZOOM = { min: 0.4, max: 1.5, step: 0.1, readable: 0.6 };

/**
 * The composer's entry point, beside Send, once the conversation has a request. The badge
 * counts the subagents of the current execution (its latest request that reported agents)
 * running now: never the root, never ended ones. A green dot shows while any run, a hollow one
 * while some only wait.
 */
export function AgentMapButton({ turns, title }: { turns: readonly Turn[]; title?: string }) {
  const m = useStrings().agent.agentMap;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!turns.length) return null;
  const { running, queued } = activeSubagents(mapTurn(turns)?.agents);
  const label = m.openLabel(running, queued);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="agent-map-button"
        data-state={running ? "running" : queued ? "queued" : "idle"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        {/* The status dot sits on the icon's corner, so the pill keeps its width as agents start and end. */}
        <span className="agent-map-button__icon" aria-hidden="true">
          <Network size={15} strokeWidth={1.75} />
          {(running > 0 || queued > 0) && <span className="agent-map-button__dot" />}
        </span>
        <span className="agent-map-button__label">{m.open}</span>
        <span className="agent-map-button__count num" aria-hidden="true">{running}</span>
      </button>
      {/* In the body, so it inherits nothing from the composer it opened from. */}
      {open && createPortal(<AgentMapDialog turns={turns} title={title} onClose={() => { setOpen(false); trigger.current?.focus(); }} />, document.body)}
    </>
  );
}

/** Re-renders every second while `active`, for running agents' durations. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : Date.now();
}

const toolLabel = (copy: Copy, part: ToolPart) => {
  const [doing, done] = copy.toolSteps[part.tool] ?? copy.toolStep(part.tool);
  return part.status === "running" ? doing : done;
};
const requestText = (copy: Copy, turn: Turn) => turn.prompt || turn.attachments?.map((f) => f.name).join(", ") || copy.agentMap.kinds.task;
const nodeTitle = (copy: Copy, node: MapNode) =>
  node.kind === "task" ? requestText(copy, node.turn) : node.kind === "agent" ? node.run.name : toolLabel(copy, node.part);
/** A task's execution in a few words: its tool calls and subagents (its number is in the details). */
const taskSummary = (copy: Copy, task: TaskNode) => {
  const tools = task.turn.parts.filter((p) => p.type === "tool").length;
  const subagents = (task.turn.agents ?? []).filter((a) => a.id !== task.run?.id).length;
  return copy.agentMap.taskSummary(tools, subagents);
};

function AgentMapDialog({ turns, title, onClose }: { turns: readonly Turn[]; title?: string; onClose: () => void }) {
  const a = useStrings().agent;
  const m = a.agentMap;
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const roots = useMemo(() => mapForest(turns), [turns]);
  const allAgents = turns.flatMap((t) => t.agents ?? []);
  const sub = activeSubagents(mapTurn(turns)?.agents);
  const now = useNow(allAgents.some((r) => r.status === "running"));
  const [folded, setFolded] = useState<Set<string>>(() => initialFolds(roots));
  const layout = useMemo(() => layoutForest(roots, folded), [roots, folded]);
  // The latest request is selected first; a new one arriving while the map is open does not
  // take the selection away.
  const [selected, setSelected] = useState(() => roots.at(-1)?.key ?? "");
  const current = layout.placed.find((p) => p.node.key === selected) ?? layout.placed.find((p) => p.node.key === roots.at(-1)?.key);
  const usageReported = allAgents.some((r) => r.usage);
  const [scale, setScale] = useState(1);
  const scrollTo = useRef<string | null>(null);

  // Leave the modal state first: while it is open the page behind is inert, so focus could
  // not return to the composer's button.
  const close = () => {
    if (dialog.current?.open && typeof dialog.current.close === "function") dialog.current.close();
    onClose();
  };
  useEscapeLayer(true, close);

  const ratios = () => {
    const box = canvas.current;
    return box && box.clientWidth ? { w: box.clientWidth / layout.width, h: box.clientHeight / layout.height } : null;
  };
  /** Fit: the whole map in view, never enlarged past 100 %. */
  const fit = () => {
    const r = ratios();
    if (r) setScale(Math.max(ZOOM.min, Math.min(1, r.w, r.h)));
  };
  // Open; show the whole map if it stays readable, else fit its width (not below 60 %) and
  // scroll to the latest request. The canvas has no size until the dialog shows.
  useLayoutEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    const r = ratios();
    if (!r) return;
    const whole = Math.min(1, r.w, r.h);
    if (whole >= ZOOM.readable) setScale(whole);
    else {
      setScale(Math.max(ZOOM.readable, Math.min(1, r.w)));
      scrollTo.current = roots.at(-1)?.key ?? null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const key = scrollTo.current;
    if (!key || !canvas.current) return;
    scrollTo.current = null;
    const top = Math.min(...layout.placed.filter((p) => p.task === key).map((p) => p.y));
    canvas.current.scrollTop = Math.max(0, (top - CARD.pad) * scale);
  }, [scale, layout]);
  const zoom = (by: number) => setScale((s) => Math.round(Math.max(ZOOM.min, Math.min(ZOOM.max, s + by)) * 10) / 10);

  const toggle = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // Up and Down move through the cards in map order; Right and Left open and fold a branch.
  const onTreeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const cards = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".agent-map__card"));
    const i = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const key = cards[i].dataset.nodeKey!;
    const place = layout.placed.find((p) => p.node.key === key);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      cards[Math.max(0, Math.min(cards.length - 1, i + (event.key === "ArrowDown" ? 1 : -1)))].focus();
    } else if (place?.branch && ((event.key === "ArrowRight" && place.folded) || (event.key === "ArrowLeft" && !place.folded))) {
      event.preventDefault();
      toggle(key);
    }
  };

  const taskOf = (place: Placed) => roots.find((r) => r.key === place.task) as TaskNode;

  return (
    // The dialog's own cancel (Escape) is handled by the escape layer, so close stays in React.
    <dialog ref={dialog} className="agent-map" aria-labelledby="agent-map-title" onCancel={(event) => event.preventDefault()}>
      <header className="agent-map__head">
        <div className="agent-map__heading">
          <h2 id="agent-map-title">{m.title}</h2>
          {title && <p className="agent-map__prompt" title={title}>{title}</p>}
        </div>
        <p className="agent-map__counts">
          <span>{m.tasks(roots.length)}</span>
          {sub.running > 0 && <span className="agent-map__live">{m.running(sub.running)}</span>}
          {sub.queued > 0 && <span>{m.queued(sub.queued)}</span>}
          {!usageReported && <span className="agent-map__muted">{m.noUsage}</span>}
        </p>
        <button type="button" className="icon-button agent-map__close" onClick={close} aria-label={m.close} title={m.close}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="agent-map__body">
        <div className="agent-map__stage">
          <div ref={canvas} className="agent-map__canvas" role="group" aria-label={m.tree} onKeyDown={onTreeKey}>
            <div className="agent-map__space" style={{ width: layout.width * scale, height: layout.height * scale }}>
              <div className="agent-map__plane" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
                <svg className="agent-map__edges" width={layout.width} height={layout.height} aria-hidden="true">
                  {layout.edges.map((d) => <path key={d} d={d} />)}
                </svg>
                {layout.placed.map((place) => (
                  <NodeCard key={place.node.key} place={place} copy={a} now={now} selected={current?.node.key === place.node.key} onSelect={setSelected} onToggle={toggle} />
                ))}
              </div>
            </div>
          </div>
          <div className="agent-map__zoom" role="group" aria-label={m.zoom}>
            <button type="button" className="icon-button" onClick={() => zoom(-ZOOM.step)} aria-label={m.zoomOut} title={m.zoomOut} disabled={scale <= ZOOM.min}><Minus size={15} aria-hidden="true" /></button>
            <span className="num" role="status" aria-label={m.zoomLevel}>{Math.round(scale * 100)}%</span>
            <button type="button" className="icon-button" onClick={() => zoom(ZOOM.step)} aria-label={m.zoomIn} title={m.zoomIn} disabled={scale >= ZOOM.max}><Plus size={15} aria-hidden="true" /></button>
            <button type="button" className="icon-button" onClick={fit} aria-label={m.fit} title={m.fit}><Maximize size={14} aria-hidden="true" /></button>
          </div>
        </div>
        {current && <Details node={current.node} task={taskOf(current)} copy={a} now={now} onSelect={setSelected} />}
      </div>
    </dialog>
  );
}

/** One card at its place; a branch's fold control sits on its right edge, where its connector leaves. */
function NodeCard({ place, copy, now, selected, onSelect, onToggle }: {
  place: Placed;
  copy: Copy;
  now: number;
  selected: boolean;
  onSelect: (key: string) => void;
  onToggle: (key: string) => void;
}) {
  const m = copy.agentMap;
  const { node, x, y } = place;
  const Icon = KIND_ICON[node.kind];
  const title = nodeTitle(copy, node);
  const run = node.kind === "tool" ? null : node.run;
  const timed = node.kind === "tool" ? node.part : run;
  const ms = timed ? durationMs(timed, now) : null;
  const tokens = run?.usage ? run.usage.input + run.usage.output : null;
  const line =
    node.kind === "task" ? taskSummary(copy, node)
    : node.kind === "agent" ? (node.run.error ?? node.run.task)
    : node.part.summary;
  return (
    <>
      <button
        type="button"
        className="agent-map__card"
        style={{ left: x, top: y, width: CARD.w, height: CARD.h }}
        data-node-key={node.key}
        data-parent-key={place.parent ?? undefined}
        data-task-key={place.task}
        data-kind={node.kind}
        data-tool={node.kind === "tool" ? node.part.tool : undefined}
        data-status={node.status}
        aria-pressed={selected}
        onClick={() => onSelect(node.key)}
      >
        <span className="agent-map__kind" aria-hidden="true">
          <Icon size={14} strokeWidth={1.75} />
          <span className="agent-map__dot" data-status={node.status} />
        </span>
        <span className="agent-map__text">
          <span className="agent-map__name" title={title}>{title}</span>
          {line && <span className="agent-map__line" title={line}>{line}</span>}
        </span>
        <span className="agent-map__meta num">
          {ms !== null && <span>{formatDuration(ms)}</span>}
          {tokens !== null && <span title={m.tokens(whole.format(tokens))}>{m.tokens(compact.format(tokens))}</span>}
        </span>
        <span className="visually-hidden">, {m.kinds[node.kind]}, {m.status[node.status]}</span>
      </button>
      {place.branch && (
        <button
          type="button"
          className="agent-map__toggle"
          style={{ left: x + CARD.w, top: y + CARD.h / 2 }}
          data-toggle-for={node.key}
          aria-expanded={!place.folded}
          aria-label={place.folded ? m.expand(title, countBelow(node)) : m.collapse(title)}
          title={place.folded ? m.expand(title, countBelow(node)) : m.collapse(title)}
          onClick={() => onToggle(node.key)}
        >
          {place.folded ? <><span className="num">{m.hidden(countBelow(node))}</span><ChevronRight size={12} aria-hidden="true" /></> : <ChevronLeft size={12} aria-hidden="true" />}
        </button>
      )}
    </>
  );
}

function Details({ node, task, copy, now, onSelect }: { node: MapNode; task: TaskNode; copy: Copy; now: number; onSelect: (key: string) => void }) {
  const m = copy.agentMap;
  const turn = task.turn;
  const agents = turn.agents ?? [];
  const toolMs = node.kind === "tool" ? durationMs(node.part, now) : null;
  /** An agent of this request, as a link to its card (the root agent's card is the task). */
  const agentLink = (id: string) => {
    const found = agents.find((r) => r.id === id);
    if (!found) return null;
    const isTask = id === task.run?.id;
    return <button type="button" className="text-button" onClick={() => onSelect(isTask ? task.key : `agent:${turn.id}:${id}`)}>{isTask ? requestText(copy, turn) : found.name}</button>;
  };
  return (
    <aside className="agent-map__details" aria-label={m.details}>
      <p className="agent-map__details-kind">{node.kind === "task" ? m.taskLabel(task.index + 1) : m.kinds[node.kind]}</p>
      <h3 className="agent-map__details-name">{nodeTitle(copy, node)}</h3>
      <p className="agent-map__details-status" data-status={node.status}>
        <span className="agent-map__dot" data-status={node.status} aria-hidden="true" />
        {m.status[node.status]}
      </p>
      {node.kind === "task" && (
        <>
          {(node.run?.error ?? turn.error?.message) && <p className="agent-map__error"><strong>{m.error}:</strong> {node.run?.error ?? turn.error?.message}</p>}
          <dl className="agent-map__facts">
            <dt>{m.executedBy}</dt>
            <dd>{node.run?.name ?? m.notReported}</dd>
            {node.run ? <RunTimes run={node.run} copy={copy} now={now} /> : null}
            <dt>{m.subagents}</dt>
            <dd className="num">{agents.filter((r) => r.id !== node.run?.id).length}</dd>
            <dt>{m.tools}</dt>
            <dd className="num">{turn.parts.filter((p) => p.type === "tool").length}</dd>
          </dl>
        </>
      )}
      {node.kind === "agent" && (
        <>
          {node.run.error && <p className="agent-map__error"><strong>{m.error}:</strong> {node.run.error}</p>}
          <dl className="agent-map__facts">
            {node.run.task && (<><dt>{m.task}</dt><dd>{node.run.task}</dd></>)}
            <dt>{m.startedBy}</dt>
            <dd>{node.run.parentId === null ? m.startedTurn : agentLink(node.run.parentId) ?? m.parentNotReported(node.run.parentId)}</dd>
            <RunTimes run={node.run} copy={copy} now={now} />
            <dt>{m.agentsStarted}</dt>
            <dd className="num">{agents.filter((r) => r.parentId === node.run.id).length}</dd>
            <dt>{m.tools}</dt>
            <dd className="num">{turn.parts.filter((p) => p.type === "tool" && p.agentId === node.run.id).length}</dd>
          </dl>
        </>
      )}
      {node.kind === "tool" && (
        <dl className="agent-map__facts">
          <dt>{copy.toolName}</dt>
          <dd><code>{node.part.tool}</code>{node.part.simulated && <span className="agent-map__muted"> · {m.simulated}</span>}</dd>
          <dt>{m.calledBy}</dt>
          <dd>{(node.part.agentId && agentLink(node.part.agentId)) || m.notReported}</dd>
          <dt>{node.part.status === "error" ? m.error : copy.result}</dt>
          <dd>{node.part.summary || m.status[node.status]}</dd>
          <dt>{m.started}</dt>
          <dd className="num">{node.part.startedAt ? clock(node.part.startedAt) : m.notReported}</dd>
          <dt>{m.ended}</dt>
          <dd className="num">{node.part.endedAt ? clock(node.part.endedAt) : node.part.status === "running" ? m.status.running : m.notReported}</dd>
          <dt>{m.duration}</dt>
          <dd className="num">{toolMs !== null ? formatDuration(toolMs) : m.notReported}</dd>
          {Object.keys(node.part.args).length > 0 && (
            <>
              <dt>{copy.arguments}</dt>
              <dd>{Object.entries(node.part.args).map(([k, v]) => <div key={k}><span className="agent-map__muted">{k}</span> {String(v)}</div>)}</dd>
            </>
          )}
        </dl>
      )}
    </aside>
  );
}

/** An agent's reported times and tokens, or "Not reported". */
function RunTimes({ run, copy, now }: { run: AgentRun; copy: Copy; now: number }): ReactNode {
  const m = copy.agentMap;
  const ms = durationMs(run, now);
  return (
    <>
      <dt>{m.started}</dt>
      <dd className="num">{clock(run.startedAt)}</dd>
      <dt>{m.ended}</dt>
      <dd className="num">{run.endedAt ? clock(run.endedAt) : run.status === "running" || run.status === "queued" ? m.status[run.status] : m.notReported}</dd>
      <dt>{m.duration}</dt>
      <dd className="num">{ms !== null ? formatDuration(ms) : run.status === "queued" ? m.status.queued : m.notReported}</dd>
      <dt>{m.tokensIn}</dt>
      <dd className="num">{run.usage ? whole.format(run.usage.input) : m.notReported}</dd>
      <dt>{m.tokensOut}</dt>
      <dd className="num">{run.usage ? whole.format(run.usage.output) : m.notReported}</dd>
    </>
  );
}
