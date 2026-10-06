import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { parseBlocks, Prose } from "./Prose";

const answer = [
  "Cooling tower 4 is in fault.",
  "",
  "### Readings",
  "",
  "| Reading | Value |",
  "| --- | --: |",
  "| Fan frequency | 0.0 Hz |",
  "| Water out | 30.3 °C |",
  "",
  "- First issue",
  "- Second issue",
  "",
  "1. One",
  "2. Two",
].join("\n");

describe("answer text", () => {
  it("reads paragraphs, headings, lists and tables, right-aligning columns marked --:", () => {
    expect(parseBlocks(answer).map((b) => b.type)).toEqual(["p", "h", "table", "ul", "ol"]);
    const table = parseBlocks(answer)[2];
    expect(table).toMatchObject({ head: ["Reading", "Value"], right: [false, true], rows: [["Fan frequency", "0.0 Hz"], ["Water out", "30.3 °C"]] });
  });

  it("mid-stream, shows a table row only once its line is complete and waits for a marker's first word", () => {
    const partialRow = parseBlocks(answer.slice(0, answer.indexOf("| Water out") + 8), true);
    expect(partialRow[2]).toMatchObject({ rows: [["Fan frequency", "0.0 Hz"]] });
    expect(parseBlocks("Intro.\n-", true).map((b) => b.type)).toEqual(["p"]);
    expect(parseBlocks("Intro.\n##", true).map((b) => b.type)).toEqual(["p"]);
    // Finished, the same text is read as written.
    expect(parseBlocks("Intro.\n-").map((b) => b.type)).toEqual(["p", "p"]);
  });

  it("renders the line being written word by word behind a caret, and plain text once finished", () => {
    const { container, rerender } = render(<Prose text="Cooling tower 4 is in fault." streaming />);
    expect(container.querySelectorAll(".agent-word")).toHaveLength(6);
    expect(container.querySelector(".agent-caret")).not.toBeNull();
    rerender(<Prose text="Cooling tower 4 is in fault." streaming={false} />);
    expect(container.querySelector(".agent-word, .agent-caret")).toBeNull();
    expect(container.textContent).toBe("Cooling tower 4 is in fault.");
  });

  it("leaves what is already shown in place as the answer grows", () => {
    const { container, rerender } = render(<Prose text={"First paragraph.\n\nCooling tow"} streaming />);
    const paragraph = container.querySelector("p")!;
    const word = container.querySelectorAll(".agent-word")[0];
    rerender(<Prose text={"First paragraph.\n\nCooling tower 4 is in fault"} streaming />);
    expect(container.querySelector("p")).toBe(paragraph);
    expect(container.querySelectorAll(".agent-word")[0]).toBe(word);
    expect(word.textContent).toBe("Cooling ");
    expect(container.querySelectorAll(".agent-caret")).toHaveLength(1);
  });

  it("shows markup in an answer as text, never as HTML", () => {
    const { container } = render(<Prose text={'<img src=x onerror="alert(1)"> and <b>bold</b>'} streaming={false} />);
    expect(container.querySelector("img, b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
