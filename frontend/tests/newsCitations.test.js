import test from "node:test";
import assert from "node:assert/strict";
import { briefingParts } from "../src/lib/newsCitations.js";
test("inline citations preserve prose and reject unsafe, overlapping and invalid spans", () => {
  const answer = "Rates held. Official source.";
  const parts = briefingParts(answer, [
    { start: 12, end: 27, url: "https://source.example", title: "Source" },
    { start: 0, end: 5, url: "javascript:alert(1)" },
    { start: 15, end: 20, url: "https://other.example" },
    { start: 0, end: 100, url: "https://source.example" },
  ]);
  assert.equal(parts.map((p) => p.text).join(""), answer);
  assert.equal(parts.filter((p) => p.url).length, 1);
  assert.equal(parts[1].text, "Official source");
  assert.equal(parts[1].url, "https://source.example/");
  assert.deepEqual(briefingParts("No citations"), [{ text: "No citations" }]);
});
