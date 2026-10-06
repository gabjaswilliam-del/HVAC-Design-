/**
 * Answer text from a small, safe subset of Markdown, read line by line: paragraphs, "#"
 * headings, "-" and "1." lists and pipe tables. Text only: nothing in an answer is ever
 * read as HTML, a link or a script. It renders mid-stream too: the line being written
 * fades in word by word behind a caret, a table shows once its header is complete and
 * grows a row at a time, and a bare list or heading marker waits for its first word.
 */
import type { ReactNode } from "react";

interface Line {
  text: string;
  /** Where the line starts in the answer; it does not move as the answer grows. */
  at: number;
}

export type Block =
  | { type: "p" | "h"; line: Line }
  | { type: "ul" | "ol"; items: Line[] }
  | { type: "table"; head: string[]; right: boolean[]; rows: string[][] };

export function parseBlocks(text: string, streaming = false): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let at = 0;
  lines.forEach((raw, i) => {
    const start = at;
    at += raw.length + 1;
    const line = raw.trim();
    const partial = streaming && i === lines.length - 1;
    const last = blocks.at(-1);
    if (!line) return;
    if (line.startsWith("|")) {
      if (partial) return; // a row shows once its line is complete
      const cells = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (last?.type !== "table") blocks.push({ type: "table", head: cells, right: [], rows: [] });
      else if (cells.every((c) => /^:?-+:?$/.test(c))) last.right = cells.map((c) => c.endsWith(":"));
      else last.rows.push(cells);
      return;
    }
    if (partial && /^(#+|[-*]|\d+\.?)$/.test(line)) return;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^(?:([-*])|\d+\.)\s+(.*)$/.exec(line);
    if (heading) blocks.push({ type: "h", line: { text: heading[1], at: start } });
    else if (item) {
      const type = item[1] ? "ul" : "ol";
      const entry = { text: item[2], at: start };
      if (last?.type === type) last.items.push(entry);
      else blocks.push({ type, items: [entry] });
    } else blocks.push({ type: "p", line: { text: line, at: start } });
  });
  return blocks;
}

const Caret = () => <span className="agent-caret" aria-hidden="true" />;

/** The line being written: each word fades in once, keyed by its place in the line so
 *  the words before it are left alone, followed by the caret. */
function Writing({ text }: { text: string }) {
  let at = 0;
  return (
    <>
      {text.split(/(?<=\s)(?=\S)/).map((word) => {
        const key = at;
        at += word.length;
        return (
          <span key={key} className="agent-word">
            {word}
          </span>
        );
      })}
      <Caret />
    </>
  );
}

export function Prose({ text, streaming }: { text: string; streaming: boolean }) {
  const blocks = parseBlocks(text, streaming);
  const tail = blocks.at(-1);
  const live = streaming && tail && tail.type !== "table" ? ("line" in tail ? tail.line : tail.items.at(-1)!) : null;
  const show = (l: Line): ReactNode => (l === live ? <Writing text={l.text} /> : l.text);

  return (
    <div className={streaming ? "agent-prose is-writing" : "agent-prose"}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "p":
            return <p key={i}>{show(b.line)}</p>;
          case "h":
            return <h3 key={i}>{show(b.line)}</h3>;
          case "ul":
          case "ol": {
            const List = b.type;
            return (
              <List key={i}>
                {b.items.map((l) => (
                  <li key={l.at}>{show(l)}</li>
                ))}
              </List>
            );
          }
          case "table":
            // Mid-stream, a table waits for the line under its header.
            if (streaming && !b.right.length && !b.rows.length) return null;
            return (
              <table key={i} className="data-table">
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j} scope="col" className={b.right[j] ? "num" : undefined}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, k) => (
                    <tr key={k}>
                      {r.map((c, j) =>
                        j === 0 ? (
                          <th key={j} scope="row">
                            {c}
                          </th>
                        ) : (
                          <td key={j} className={b.right[j] ? "num" : undefined}>
                            {c}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
        }
      })}
      {streaming && !blocks.length && <Caret />}
    </div>
  );
}
