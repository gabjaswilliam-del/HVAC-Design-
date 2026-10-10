import { describe, expect, it } from "vitest";
import { createFixtureClient } from "../../fixtures/fixtureClient";
import { vocabularyOf } from "../../fixtures/agentScripts";
import { describeAttachment, MAX_BYTES, readAttachments } from "./attachments";

const vocab = vocabularyOf(await createFixtureClient("normal", { latencyMs: 0 }).getSite());
const file = (name: string, content: BlobPart, type = "text/plain") => new File([content], name, { type });
const input = (name: string, text: string) => ({ name, type: "text/plain", size: text.length, text });

describe("attachments", () => {
  it("reads text files and refuses the rest with a reason", async () => {
    const { added, problems } = await readAttachments(
      [
        file("notes.md", "# Shift notes\nChiller 2 tripped at 14:05."),
        file("photo.png", "x", "image/png"),
        file("big.log", new Uint8Array(MAX_BYTES + 1)),
        file("bin.txt", "a\u0000b"),
        file("data.csv", "t,v\n1,2"),
        file("more.txt", "four"),
      ],
      [],
    );
    expect(added.map((a) => a.name)).toEqual(["notes.md", "data.csv", "more.txt"]);
    expect(added[0].text).toBe("# Shift notes\nChiller 2 tripped at 14:05.");
    expect(problems).toEqual([
      { name: "photo.png", code: "type" },
      { name: "big.log", code: "size" },
      { name: "bin.txt", code: "binary" },
    ]);
    // The limit counts files already attached.
    expect((await readAttachments([file("a.txt", "a")], added)).problems).toEqual([{ name: "a.txt", code: "too_many" }]);
    expect((await readAttachments([file("data.csv", "t,v\n1,2")], added.slice(0, 2))).problems).toEqual([{ name: "data.csv", code: "duplicate" }]);
  });

  it("describes a table from its own figures", () => {
    const text = describeAttachment(input("log.csv", "time,cop,power_kw,note\n10:00,4.5,300,ok\n10:15,4.7,310,\n10:30,4.9,320,Chiller 2 tripped"), vocab);
    expect(text).toBe(
      "log.csv (86 B): It is a table of 3 rows and 4 columns: time, cop, power_kw and note. Numeric columns: cop from 4.50 to 4.90 (mean 4.70); power_kw from 300.0 to 320.0 (mean 310.0). It names Chiller 2, System COP and Plant electrical power.",
    );
  });

  it("describes JSON, text and logs, and says when a file is not what it claims", () => {
    expect(describeAttachment(input("a.json", '[{"id":1,"cop":4.2},{"id":2}]'), vocab)).toContain("It is a JSON array of 2 items; the first has the keys id and cop.");
    expect(describeAttachment(input("b.json", "{ nope"), vocab)).toMatch(/It is not valid JSON/);
    expect(describeAttachment(input("c.md", "# Plan\n## Pumps\nRaise approach."), vocab)).toContain("Its headings: Plan and Pumps.");
    expect(describeAttachment(input("d.log", "ok\nERROR tower 4 fan fault\nok"), vocab)).toContain('1 line mentions an error, fault, alarm, trip or warning; the first reads “ERROR tower 4 fan fault”.');
    expect(describeAttachment(input("e.txt", "   "), vocab)).toBe("e.txt (3 B): it is empty.");
  });
});
