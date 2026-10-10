/**
 * Recording, correcting and linking memory (the local memory service only). The forms
 * check what they can before sending (required fields, lengths, a time not in the
 * future, what each provenance needs); the service enforces every rule and its message
 * is shown as it comes. Times are entered and shown in UTC.
 */
import { useId, useState, type FormEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import type { MemoryClient } from "../../../lib/api/memory";
import { LINK_TYPES, MEMORY_KINDS, type LinkType, type MemoryDetail, type MemoryKind, type MemoryRecord, type MemoryStatus, type Provenance } from "../../../lib/contracts/memory";
import { equipmentName } from "../shared";

const EQUIPMENT_ID = /^[a-z][a-z0-9_]{0,63}$/;
const utcInput = (iso: string) => iso.slice(0, 16);
const fromInput = (v: string) => (v ? `${v}:00Z` : "");
const nowInput = () => new Date().toISOString().slice(0, 16);
const ids = (v: string) => v.split(/[\s,]+/).filter(Boolean);

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="kn-error" role="alert">
      <TriangleAlert size={15} aria-hidden="true" />
      {message}
    </p>
  );
}

function EquipmentField({ name, defaultValue, equipment, disabled }: { name: string; defaultValue?: string; equipment: string[]; disabled: boolean }) {
  const s = useKnowledgeStrings().memory.form;
  const list = useId();
  return (
    <label className="kn-field">
      <span>{s.equipment}</span>
      <input name={name} type="text" defaultValue={defaultValue} list={list} placeholder="chiller_plant_2" disabled={disabled} />
      <datalist id={list}>
        {equipment.map((id) => (
          <option key={id} value={id}>
            {equipmentName(id)}
          </option>
        ))}
      </datalist>
    </label>
  );
}

export function MemoryForm({
  client,
  status,
  equipment,
  records,
  onDone,
}: {
  client: MemoryClient;
  status: MemoryStatus;
  equipment: string[];
  records: MemoryRecord[];
  onDone: (id: string | null) => void;
}) {
  const t = useKnowledgeStrings().memory;
  const s = t.form;
  const allowed = status.provenance.filter((p) => p.allowed).map((p) => p.id);
  const [provenance, setProvenance] = useState<Provenance>(allowed.includes("user_entered") ? "user_entered" : allowed[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const title = String(f.get("title") ?? "").trim();
    const occurredAt = fromInput(String(f.get("occurredAt") ?? ""));
    const eq = ids(String(f.get("equipment") ?? ""));
    const linkTo = String(f.get("linkTo") ?? "");
    const [linkType, direction] = String(f.get("linkType") ?? "").split(":") as [LinkType | "", "out" | "in" | undefined];
    if (!title) return setError(s.titleRequired);
    if (!occurredAt) return setError(s.timeRequired);
    if (Date.parse(occurredAt) > Date.now() + 5 * 60_000) return setError(s.future);
    if (eq.length > 10 || eq.some((x) => !EQUIPMENT_ID.test(x))) return setError(s.badEquipment);
    if (provenance === "simulation" && !String(f.get("runId") ?? "").trim()) return setError(s.runRequired);
    if (provenance === "imported_record" && !String(f.get("sourceRef") ?? "").trim()) return setError(s.sourceRequired);
    setBusy(true);
    setError(null);
    try {
      const created = await client.createMemory({
        kind: String(f.get("kind")) as MemoryKind,
        title,
        body: String(f.get("body") ?? ""),
        provenance,
        occurredAt,
        equipment: eq,
        runId: provenance === "simulation" ? String(f.get("runId")).trim() : undefined,
        sourceRef: String(f.get("sourceRef") ?? "").trim() || undefined,
        links: linkType && linkTo ? [direction === "in" ? { type: linkType, source: linkTo } : { type: linkType, target: linkTo }] : undefined,
      });
      onDone(created.memory.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <form noValidate className="kn-form" onSubmit={submit} aria-labelledby="kn-mform-title" aria-busy={busy || undefined}>
      <h3 id="kn-mform-title">{s.title}</h3>
      <p className="kn-hint">{s.hint}</p>
      <div className="kn-form__grid">
        <label className="kn-field">
          <span>{s.kind}</span>
          <select name="kind" className="select" defaultValue="observation" disabled={busy}>
            {MEMORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.kinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="kn-field">
          <span>{s.occurredAt}</span>
          <input name="occurredAt" type="datetime-local" defaultValue={nowInput()} required disabled={busy} />
        </label>
        <label className="kn-field kn-field--wide">
          <span>{s.recordTitle}</span>
          <input name="title" type="text" maxLength={160} required disabled={busy} />
        </label>
        <label className="kn-field kn-field--wide">
          <span>{s.body}</span>
          <textarea name="body" maxLength={4000} rows={3} disabled={busy} />
        </label>
        <label className="kn-field">
          <span>{s.provenance}</span>
          <select name="provenance" className="select" value={provenance} onChange={(e) => setProvenance(e.target.value as Provenance)} disabled={busy}>
            {allowed.map((p) => (
              <option key={p} value={p}>
                {t.provenance.labels[p]}
              </option>
            ))}
          </select>
        </label>
        {provenance === "simulation" && (
          <label className="kn-field">
            <span>{s.runId}</span>
            <input name="runId" type="text" maxLength={64} placeholder="RUN-0003" disabled={busy} />
          </label>
        )}
        {(provenance === "imported_record" || provenance === "user_entered") && (
          <label className="kn-field">
            <span>{provenance === "imported_record" ? s.sourceRefRequired : s.sourceRef}</span>
            <input name="sourceRef" type="text" maxLength={200} disabled={busy} />
          </label>
        )}
        <EquipmentField name="equipment" equipment={equipment} disabled={busy} />
        {records.length > 0 && (
          <>
            <label className="kn-field">
              <span>{s.linkType}</span>
              <select name="linkType" className="select" defaultValue="" disabled={busy}>
                <option value="">{s.noLink}</option>
                {LINK_TYPES.flatMap((type) =>
                  (["out", "in"] as const).map((d) => (
                    <option key={`${type}:${d}`} value={`${type}:${d}`}>
                      {s.thisRecord(t.linkPhrases[d][type])}
                    </option>
                  )),
                )}
              </select>
            </label>
            <label className="kn-field">
              <span>{s.linkTo}</span>
              <select name="linkTo" className="select" defaultValue="" disabled={busy}>
                <option value="">—</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t.kinds[r.kind]}: {r.title}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <FormError message={error} />
      <div className="kn-form__actions">
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? s.saving : s.save}
        </button>
        <button type="button" className="button" onClick={() => onDone(null)} disabled={busy}>
          {s.cancel}
        </button>
      </div>
    </form>
  );
}

export function CorrectionForm({ client, record, equipment, onDone }: { client: MemoryClient; record: MemoryRecord; equipment: string[]; onDone: (next: MemoryDetail | null) => void }) {
  const s = useKnowledgeStrings().memory.form;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const reason = String(f.get("reason") ?? "").trim();
    const title = String(f.get("title") ?? "").trim();
    const occurredAt = fromInput(String(f.get("occurredAt") ?? ""));
    const eq = ids(String(f.get("equipment") ?? ""));
    if (!reason) return setError(s.reasonRequired);
    if (!title) return setError(s.titleRequired);
    if (Date.parse(occurredAt) > Date.now() + 5 * 60_000) return setError(s.future);
    if (eq.some((x) => !EQUIPMENT_ID.test(x))) return setError(s.badEquipment);
    setBusy(true);
    setError(null);
    try {
      onDone(await client.supersedeMemory(record.id, { reason, title, body: String(f.get("body") ?? ""), occurredAt, equipment: eq }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <form noValidate className="kn-form kn-form--inset" onSubmit={submit} aria-labelledby="kn-correct-title" aria-busy={busy || undefined}>
      <h4 id="kn-correct-title">{s.correctTitle}</h4>
      <p className="kn-hint">{s.correctHint}</p>
      <label className="kn-field">
        <span>{s.reason}</span>
        <input name="reason" type="text" maxLength={300} required disabled={busy} autoFocus />
      </label>
      <label className="kn-field">
        <span>{s.recordTitle}</span>
        <input name="title" type="text" maxLength={160} defaultValue={record.title} required disabled={busy} />
      </label>
      <label className="kn-field">
        <span>{s.body}</span>
        <textarea name="body" maxLength={4000} rows={3} defaultValue={record.body} disabled={busy} />
      </label>
      <label className="kn-field">
        <span>{s.occurredAt}</span>
        <input name="occurredAt" type="datetime-local" defaultValue={utcInput(record.occurredAt)} required disabled={busy} />
      </label>
      <EquipmentField name="equipment" defaultValue={record.equipment.join(", ")} equipment={equipment} disabled={busy} />
      <FormError message={error} />
      <div className="kn-form__actions">
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? s.saving : s.saveCorrection}
        </button>
        <button type="button" className="button" onClick={() => onDone(null)} disabled={busy}>
          {s.cancel}
        </button>
      </div>
    </form>
  );
}

export function LinkForm({ client, record, records, onDone }: { client: MemoryClient; record: MemoryRecord; records: MemoryRecord[]; onDone: (changed: boolean) => void }) {
  const t = useKnowledgeStrings().memory;
  const s = t.form;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const [type, direction] = String(f.get("linkType") ?? "").split(":") as [LinkType, "out" | "in"];
    const other = String(f.get("linkTo") ?? "");
    if (!type || !other) return setError(s.linkRequired);
    setBusy(true);
    setError(null);
    try {
      await client.linkMemories(record.id, direction === "in" ? { type, source: other } : { type, target: other });
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <form noValidate className="kn-form kn-form--inset" onSubmit={submit} aria-labelledby="kn-link-title" aria-busy={busy || undefined}>
      <h4 id="kn-link-title">{s.linkTitle}</h4>
      <label className="kn-field">
        <span>{s.linkType}</span>
        <select name="linkType" className="select" defaultValue="SUPPORTED_BY:out" disabled={busy}>
          {LINK_TYPES.flatMap((type) =>
            (["out", "in"] as const).map((d) => (
              <option key={`${type}:${d}`} value={`${type}:${d}`}>
                {s.thisRecord(t.linkPhrases[d][type])}
              </option>
            )),
          )}
        </select>
      </label>
      <label className="kn-field">
        <span>{s.linkTo}</span>
        <select name="linkTo" className="select" defaultValue="" required disabled={busy}>
          <option value="">—</option>
          {records.map((r) => (
            <option key={r.id} value={r.id}>
              {t.kinds[r.kind]}: {r.title}
            </option>
          ))}
        </select>
      </label>
      <FormError message={error} />
      <div className="kn-form__actions">
        <button type="submit" className="button button--primary" disabled={busy}>
          {s.saveLink}
        </button>
        <button type="button" className="button" onClick={() => onDone(false)} disabled={busy}>
          {s.cancel}
        </button>
      </div>
    </form>
  );
}
