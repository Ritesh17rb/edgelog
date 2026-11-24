import { useEffect, useRef, useState } from "react";
import {
  FiBookmark,
  FiHeart,
  FiShare2,
  FiSearch,
  FiRefreshCw,
  FiGlobe,
  FiZap,
  FiFileText,
  FiClock,
  FiCheck,
  FiX,
} from "react-icons/fi";
import { newsService } from "../services/newsService";
import { briefingParts } from "../lib/newsCitations";
import "./news.css";

const topics = [
  ["All stories", ""],
  ["Gold & metals", "gold | silver"],
  ["Forex", "forex | currencies | dollar"],
  ["Crypto", "bitcoin | ethereum | cryptocurrency"],
  ["Economy", "inflation | central bank | interest rates"],
  ["Equities", "stocks | earnings | equity"],
];
const prompts = [
  "What are the latest developments affecting gold?",
  "What changed in the US dollar today?",
  "Give me a concise Bitcoin briefing.",
];
function date(value) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function safeLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function Briefing({ result }) {
  return (
    <div className="news-briefing">
      <span className="news-kicker">
        {result.kind === "excerpt_summary" ? "EXCERPT SUMMARY" : "WEB RESEARCH"}{" "}
        · {date(result.researchedAt)}
      </span>
      <p className="news-answer">
        {briefingParts(result.answer, result.citations).map((part, index) =>
          part.url ? (
            <a
              key={index}
              href={part.url}
              title={part.title}
              target="_blank"
              rel="noopener noreferrer"
            >
              {part.text}
            </a>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
      <div className="news-sources" aria-label="Research sources">
        {result.sources
          ?.filter((s) => safeLink(s.url))
          .map((source, i) => (
            <a
              key={source.url + i}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              [{i + 1}] {source.title || "Original source"}{" "}
              <FiGlobe aria-hidden="true" />
            </a>
          ))}
      </div>
      <p className="news-disclosure">
        {result.kind === "excerpt_summary"
          ? "Based on the publisher excerpt; the full article was not read."
          : "AI research may miss updates. Check the linked sources and their dates."}
      </p>
    </div>
  );
}
export default function News() {
  const [tab, setTab] = useState("discover"),
    [topic, setTopic] = useState(""),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [hours, setHours] = useState(24);
  const [feed, setFeed] = useState(null),
    [library, setLibrary] = useState([]),
    [status, setStatus] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [libraryError, setLibraryError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState({}),
    [summaries, setSummaries] = useState({});
  const [question, setQuestion] = useState(""),
    [research, setResearch] = useState(null),
    [researchError, setResearchError] = useState(""),
    [researching, setResearching] = useState(false);
  const researchInput = useRef(null);
  useEffect(() => {
    let active = true;
    newsService
      .status()
      .then((v) => {
        if (active) setStatus(v);
      })
      .catch(() => {});
    newsService
      .library()
      .then((v) => {
        if (active) {
          setLibrary(v.items);
          setLibraryError("");
        }
      })
      .catch((e) => {
        if (active) setLibraryError(e.message);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    newsService
      .feed({ query: search || topic, hours })
      .then((v) => {
        if (active) setFeed(v);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setFeed(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, topic, hours, refresh]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(id);
  }, [message]);
  async function preference(article, field) {
    const key = article.id + field;
    const current = library.find((l) => l.article_id === article.id);
    const value = !current?.[field];
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await newsService[field === "saved" ? "save" : "like"](article.id, value);
      setLibrary((rows) => {
        const existing = rows.find((l) => l.article_id === article.id);
        return existing
          ? rows.map((l) =>
              l.article_id === article.id ? { ...l, [field]: value } : l,
            )
          : [
              {
                article_id: article.id,
                article,
                saved: false,
                liked: false,
                [field]: value,
              },
              ...rows,
            ];
      });
      setMessage(
        field === "saved"
          ? value
            ? "Added to your reading list."
            : "Removed from your reading list."
          : value
            ? "Story liked."
            : "Like removed.",
      );
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }
  async function summarize(article) {
    setBusy((b) => ({ ...b, [article.id + "summary"]: true }));
    try {
      const result = await newsService.summarize(article.id);
      setSummaries((s) => ({ ...s, [article.id]: result }));
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy((b) => ({ ...b, [article.id + "summary"]: false }));
    }
  }
  async function share(article) {
    if (!safeLink(article.url)) return;
    try {
      if (navigator.share)
        await navigator.share({ title: article.title, url: article.url });
      else {
        await navigator.clipboard.writeText(article.url);
        setMessage("Article link copied.");
      }
    } catch (e) {
      if (e.name !== "AbortError")
        setMessage(
          "Sharing is unavailable. Open the original article to copy its link.",
        );
    }
  }
  async function ask(event) {
    event.preventDefault();
    if (question.trim().length < 5) return;
    setResearching(true);
    setResearchError("");
    setResearch(null);
    try {
      setResearch(await newsService.research(question.trim()));
    } catch (e) {
      setResearchError(e.message);
    } finally {
      setResearching(false);
    }
  }
  const articles =
    tab === "discover"
      ? feed?.articles || []
      : library
          .filter((l) => (tab === "saved" ? l.saved : l.liked))
          .map((l) => l.article)
          .filter(Boolean);
  function card(article, index) {
    const pref = library.find((l) => l.article_id === article.id);
    const lead = index === 0 && tab === "discover";
    return (
      <article
        className={"news-card" + (lead ? " news-card-lead" : "")}
        key={article.id}
      >
        {lead && (
          <div className="news-card-visual">
            <div className="news-visual-art" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            {safeLink(article.image_url) && (
              <img
                src={article.image_url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            <span className="news-lead-label">
              <FiFileText aria-hidden="true" /> IN FOCUS
            </span>
          </div>
        )}
        <div className="news-card-body">
          <div className="news-card-meta">
            <span>{article.source}</span>
            <time dateTime={article.published_at || article.indexed_at}>
              {!article.published_at && article.indexed_at ? "Indexed " : ""}
              {date(article.published_at || article.indexed_at)}
            </time>
          </div>
          <h2>
            <a
              href={safeLink(article.url) || undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              {article.title}
            </a>
          </h2>
          {article.description && (
            <p className="news-card-description">{article.description}</p>
          )}
          <div className="news-card-actions">
            <button
              type="button"
              className="news-summary-button"
              disabled={busy[article.id + "summary"] || status?.ai === false}
              onClick={() => {
                if (article.description?.trim()) return summarize(article);
                setQuestion(
                  (
                    "Research the latest context for this headline: " +
                    article.title +
                    ". Publisher: " +
                    article.source +
                    ". Original URL: " +
                    article.url
                  ).slice(0, 1200),
                );
                researchInput.current?.focus();
                researchInput.current?.scrollIntoView({ block: "center" });
              }}
            >
              <FiZap aria-hidden="true" />
              {busy[article.id + "summary"]
                ? "Summarising…"
                : article.description?.trim()
                  ? "AI summary"
                  : "Research story"}
            </button>
            <div>
              <button
                type="button"
                aria-label={"Save " + article.title}
                aria-pressed={!!pref?.saved}
                disabled={busy[article.id + "saved"]}
                onClick={() => preference(article, "saved")}
                title="Save story"
              >
                <FiBookmark />
              </button>
              <button
                type="button"
                aria-label={"Like " + article.title}
                aria-pressed={!!pref?.liked}
                disabled={busy[article.id + "liked"]}
                onClick={() => preference(article, "liked")}
                title="Like story"
              >
                <FiHeart />
              </button>
              <button
                type="button"
                aria-label={"Share " + article.title}
                onClick={() => share(article)}
                title="Share story"
              >
                <FiShare2 />
              </button>
            </div>
          </div>
          {summaries[article.id] && (
            <section
              className="news-inline-summary"
              aria-label={"Summary of " + article.title}
            >
              <button
                className="news-close-summary"
                aria-label="Close summary"
                onClick={() =>
                  setSummaries((s) => ({ ...s, [article.id]: null }))
                }
              >
                <FiX />
              </button>
              <Briefing result={summaries[article.id]} />
            </section>
          )}
        </div>
      </article>
    );
  }
  return (
    <div className="news-page">
      <header className="news-heading">
        <div>
          <p className="news-kicker">THE EDGELOG BRIEF</p>
          <h1>
            A wider perspective.
            <br />
            <span>A sharper edge.</span>
          </h1>
          <p>
            The stories behind the markets. Read, research, and keep what
            matters.
          </p>
        </div>
        <div className="news-edition">
          <FiGlobe aria-hidden="true" />
          <span>
            YOUR MARKET READING ROOM
            <time>
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </time>
          </span>
        </div>
      </header>
      <div className="news-topics" aria-label="News topics">
        {topics.map(([label, value]) => (
          <button
            key={label}
            aria-pressed={topic === value && !search}
            onClick={() => {
              setTopic(value);
              setSearch("");
              setQuery("");
              setTab("discover");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="news-layout">
        <section className="news-feed" aria-label="News stories">
          <div className="news-toolbar">
            <div className="news-tabs" role="group" aria-label="Reading view">
              {[
                ["discover", "Discover"],
                ["saved", "Saved"],
                ["liked", "Liked"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={tab === value}
                  onClick={() => setTab(value)}
                >
                  {label}
                  {value === "saved" && (
                    <span>{library.filter((l) => l.saved).length}</span>
                  )}
                </button>
              ))}
            </div>
            <button
              className="news-refresh"
              aria-label="Refresh news"
              disabled={loading}
              onClick={() => setRefresh((v) => v + 1)}
            >
              <FiRefreshCw />
            </button>
          </div>
          {tab === "discover" && (
            <form
              className="news-search"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(query.trim());
              }}
            >
              <FiSearch aria-hidden="true" />
              <input
                aria-label="Search news"
                placeholder="Search an asset, topic, or headline…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={200}
              />
              <select
                aria-label="News time range"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                <option value={24}>Past 24 hours</option>
                <option value={72}>Past 3 days</option>
                <option value={168}>Past week</option>
              </select>
              <button type="submit">Search</button>
            </form>
          )}
          {tab === "discover" && feed && !loading && (
            <p className="news-freshness">
              <FiClock aria-hidden="true" /> Retrieved {date(feed.fetchedAt)}
              {feed.cached ? " · Shared feed cached for up to 10 minutes" : ""}
            </p>
          )}
          {libraryError && (
            <div className="news-state news-state-error" role="alert">
              <h2>Your reading list couldn’t load</h2>
              <p>{libraryError}</p>
              <button
                className="button"
                onClick={() => setRefresh((v) => v + 1)}
              >
                Retry reading list
              </button>
            </div>
          )}
          {tab === "discover" && loading ? (
            <div
              className="news-skeleton"
              role="status"
              aria-label="Loading news"
            >
              <span />
              <span />
              <span />
              <p>Finding your next perspective…</p>
            </div>
          ) : tab === "discover" && error ? (
            <div className="news-state news-state-error" role="alert">
              <FiGlobe />
              <h2>Your news desk is getting ready</h2>
              <p>{error}</p>
              <button
                className="button"
                onClick={() => setRefresh((v) => v + 1)}
              >
                Try again
              </button>
            </div>
          ) : articles.length ? (
            <div className="news-card-grid">{articles.map(card)}</div>
          ) : (
            <div className="news-state">
              <FiBookmark />
              <h2>
                {tab === "saved"
                  ? "A little less noise. A reading list of your own."
                  : tab === "liked"
                    ? "Your favourite perspectives belong here."
                    : "No stories in this view yet."}
              </h2>
              <p>
                {tab === "discover"
                  ? "Try a broader search or a longer time range."
                  : "Explore the feed and mark the stories you want to return to."}
              </p>
              {tab !== "discover" && (
                <button className="button" onClick={() => setTab("discover")}>
                  Explore stories
                </button>
              )}
            </div>
          )}
          <p className="news-feed-footnote">
            Stories link to their original publishers. Times use your device
            timezone. GDELT times show when a story was indexed. News discovery
            by{" "}
            <a
              href="https://www.gdeltproject.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              GDELT
            </a>
            .
          </p>
        </section>
        <aside className="news-research" aria-label="AI research desk">
          <div className="news-research-heading">
            <span className="news-ai-icon">
              <FiZap />
            </span>
            <span className="news-kicker">GO BEYOND THE HEADLINE</span>
          </div>
          <h2>Your research desk.</h2>
          <p>
            Ask a question. Get a fresh perspective, grounded in web sources.
          </p>
          <form onSubmit={ask}>
            <label htmlFor="news-research-question">
              What’s on your radar?
            </label>
            <textarea
              id="news-research-question"
              ref={researchInput}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What’s happening with gold today?"
              maxLength={1200}
              rows={4}
              required
              minLength={5}
            />
            <button
              className="news-research-submit"
              disabled={
                researching ||
                question.trim().length < 5 ||
                status?.ai === false
              }
            >
              <FiGlobe />
              {researching ? "Researching sources…" : "Research the web"}
            </button>
          </form>
          {!research && !researching && (
            <div className="news-prompts">
              <span>START WITH A QUESTION</span>
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setQuestion(prompt);
                    researchInput.current?.focus();
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          {status?.ai === false && (
            <p className="news-research-note">
              AI research will be available once OpenAI is configured on the
              server.
            </p>
          )}
          {researching && (
            <p role="status" className="news-research-note">
              Searching the web and checking sources. This may take a moment.
            </p>
          )}
          {researchError && (
            <p role="alert" className="news-research-note">
              {researchError}
            </p>
          )}
          {research && (
            <>
              <Briefing result={research} />
              <button
                className="news-copy-brief"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      research.answer +
                        "\n\nSources:\n" +
                        research.sources
                          .map((s) => s.title + ": " + s.url)
                          .join("\n"),
                    );
                    setMessage("Briefing and source links copied.");
                  } catch {
                    setMessage(
                      "Clipboard unavailable. Select the briefing text to copy it.",
                    );
                  }
                }}
              >
                <FiShare2 /> Copy sourced briefing
              </button>
            </>
          )}
          <div className="news-research-footer">
            <FiCheck aria-hidden="true" /> Sources first. Perspective second.
          </div>
        </aside>
      </div>
      {message && (
        <div className="news-toast" role="status">
          {message}
          <button aria-label="Dismiss message" onClick={() => setMessage("")}>
            <FiX />
          </button>
        </div>
      )}
    </div>
  );
}
