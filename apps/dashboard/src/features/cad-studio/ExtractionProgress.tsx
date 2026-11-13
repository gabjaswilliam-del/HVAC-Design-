/** The prepared sample's extraction replay (a replay of its steps, not parsing), shown the first time it opens. */
import { Check, LoaderCircle } from "lucide-react";
import { useStrings } from "../../lib/i18n";

export function ExtractionProgress({ progress, onSkip }: { progress: number; onSkip: () => void }) {
  const copy = useStrings().cad;
  return (
    <section className="cad-entry cad-entry--progress" aria-labelledby="extract-title">
      <span className="tag-chip">{copy.preparedSample}</span>
      <h2 id="extract-title">{copy.preparing}</h2>
      <ol className="cad-progress">
        {copy.extraction.map((label, index) => (
          <li key={label} className={index < progress ? "is-done" : index === progress ? "is-running" : ""}>
            {index < progress ? <Check size={16} aria-hidden="true" /> : <LoaderCircle size={16} aria-hidden="true" />}
            {label}
          </li>
        ))}
      </ol>
      <button type="button" className="button" onClick={onSkip}>{copy.skip}</button>
    </section>
  );
}
