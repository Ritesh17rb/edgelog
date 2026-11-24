import ReactMarkdown from "react-markdown";
import { FiClock, FiGlobe, FiShield } from "react-icons/fi";
import { remarkBriefingCitations } from "../lib/newsCitations";

function safeSource(source) {
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return {
      ...source,
      url: url.href,
      domain: url.hostname.replace(/^www\./, ""),
    };
  } catch {
    return null;
  }
}
export default function NewsBriefing({ result }) {
  const sources = [
    ...new Map(
      (result.sources || [])
        .map(safeSource)
        .filter(Boolean)
        .map((source) => [source.url, source]),
    ).values(),
  ];
  const researchedAt = new Date(result.researchedAt);
  const summary = result.kind === "excerpt_summary";
  return (
    <div className="news-briefing">
      <div className="news-briefing-meta">
        <span className="news-briefing-type">
          <FiGlobe aria-hidden="true" />
          {summary ? "Excerpt summary" : "Web research"}
        </span>
        <time dateTime={result.researchedAt}>
          <FiClock aria-hidden="true" />
          {researchedAt.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        {result.cached && <span>Previously researched</span>}
      </div>
      <div className="news-answer">
        <ReactMarkdown
          skipHtml
          remarkPlugins={[
            [
              remarkBriefingCitations,
              { answer: result.answer, citations: result.citations },
            ],
          ]}
          components={{
            img: () => null,
            h1: ({ children }) => <h3>{children}</h3>,
            h2: ({ children }) => <h3>{children}</h3>,
            h3: ({ children }) => <h4>{children}</h4>,
            a: ({ href, children, node }) => {
              const source = safeSource({ url: href });
              if (!source) return <span>{children}</span>;
              const index = sources.findIndex(
                (item) => item.url === source.url,
              );
              const label = index >= 0 ? String(index + 1) : source.domain;
              const title = sources[index]?.title || source.domain;
              if (node?.properties?.["data-verified-citation"])
                return (
                  <>
                    {children}
                    <a
                      className="news-citation"
                      href={source.url}
                      title={title}
                      aria-label={`Source ${label}: ${title}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {label}
                    </a>
                  </>
                );
              return (
                <a
                  className="news-citation news-citation-publisher"
                  href={source.url}
                  title={title}
                  aria-label={title}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {index >= 0 && <span>{index + 1}</span>}
                  {source.domain}
                </a>
              );
            },
          }}
        >
          {result.answer}
        </ReactMarkdown>
      </div>
      {sources.length > 0 && (
        <details className="news-source-details" open>
          <summary>
            <span>Sources & further reading</span>
            <span className="news-source-count">{sources.length}</span>
          </summary>
          <div className="news-sources" aria-label="Research sources">
            {sources.map((source, index) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                title={source.title}
              >
                <span className="news-source-index" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="news-source-copy">
                  <span className="news-source-domain">{source.domain}</span>
                  <span className="news-source-title">
                    {source.title || "Read the original source"}
                  </span>
                </span>
                <FiGlobe aria-hidden="true" />
              </a>
            ))}
          </div>
        </details>
      )}
      <p className="news-disclosure">
        <FiShield aria-hidden="true" />
        <span>
          {summary
            ? "Based on the publisher excerpt; the full article was not read."
            : "An AI-generated perspective. Check source dates and verify details before making decisions."}
        </span>
      </p>
    </div>
  );
}
