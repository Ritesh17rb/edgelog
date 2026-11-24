// Preserve literal text and render only verified, non-overlapping citation spans.
export function briefingParts(answer = "", citations = []) {
  const parts = [];
  let cursor = 0;
  for (const citation of [...citations].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )) {
    let url;
    try {
      url = new URL(citation.url);
    } catch {
      continue;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !Number.isInteger(citation.start) ||
      !Number.isInteger(citation.end) ||
      citation.start < cursor ||
      citation.end <= citation.start ||
      citation.end > answer.length
    )
      continue;
    if (citation.start > cursor)
      parts.push({ text: answer.slice(cursor, citation.start) });
    parts.push({
      text: answer.slice(citation.start, citation.end),
      url: url.href,
      title: citation.title || "Source",
    });
    cursor = citation.end;
  }
  if (cursor < answer.length) parts.push({ text: answer.slice(cursor) });
  return parts;
}

// Attach verified citations to Markdown text using original character offsets.
// Existing Markdown links stay intact; raw HTML is never introduced.
export function remarkBriefingCitations({ answer = "", citations = [] } = {}) {
  let offset = 0;
  const ranges = briefingParts(answer, citations).flatMap((part) => {
    const start = offset;
    offset += part.text.length;
    return part.url ? [{ ...part, start, end: offset }] : [];
  });
  return (tree, file) => {
    const original = String(file.value);
    function visit(parent) {
      if (
        !parent.children ||
        ["link", "linkReference", "code", "inlineCode", "html"].includes(
          parent.type,
        )
      )
        return;
      parent.children = parent.children.flatMap((node) => {
        if (node.type !== "text") {
          visit(node);
          return [node];
        }
        const start = node.position?.start?.offset,
          end = node.position?.end?.offset;
        // Entity escapes can change text length: avoid guessing at citation positions.
        if (
          !Number.isInteger(start) ||
          original.slice(start, end) !== node.value
        )
          return [node];
        const output = [];
        let cursor = start;
        for (const range of ranges) {
          const from = Math.max(start, range.start),
            to = Math.min(end, range.end);
          if (from >= to || from < cursor) continue;
          if (from > cursor)
            output.push({ type: "text", value: original.slice(cursor, from) });
          output.push({
            type: "link",
            url: range.url,
            title: range.title,
            data: { hProperties: { "data-verified-citation": true } },
            children: [{ type: "text", value: original.slice(from, to) }],
          });
          cursor = to;
        }
        if (cursor === start) return [node];
        if (cursor < end)
          output.push({ type: "text", value: original.slice(cursor, end) });
        return output;
      });
    }
    visit(tree);
  };
}
