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
