import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdownToTerminal } from "./markdown.js";

test("renderMarkdownToTerminal formats headings and emphasis", () => {
  const rendered = renderMarkdownToTerminal("### Exported Files\n**France** wins");
  assert.match(rendered, /Exported Files/);
  assert.match(rendered, /France/);
  assert.doesNotMatch(rendered, /\*\*/);
});

test("renderMarkdownToTerminal converts markdown tables into box-like rows", () => {
  const rendered = renderMarkdownToTerminal([
    "| File | Format |",
    "|---|---|",
    "| report.md | Markdown |"
  ].join("\n"));

  assert.match(rendered, /\+[-+]+\+/);
  assert.match(rendered, /\| File/);
  assert.match(rendered, /report\.md/);
});
