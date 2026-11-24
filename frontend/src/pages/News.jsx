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
  FiCompass,
  FiCopy,
  FiTrendingUp,
  FiDollarSign,
  FiActivity,
} from "react-icons/fi";
import { newsService } from "../services/newsService";
import Briefing from "../components/NewsBriefing";
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
  {
    label: "Gold & metals",
    detail: "The forces behind the latest moves",
    question: "What are the latest developments affecting gold?",
    icon: FiTrendingUp,
  },
  {
    label: "Dollar watch",
    detail: "Policy, currencies, and the bigger picture",
    question: "What changed in the US dollar today?",
    icon: FiDollarSign,
  },
  {
    label: "Bitcoin brief",
    detail: "A focused look at the crypto conversation",
    question: "Give me a concise Bitcoin briefing.",
    icon: FiActivity,
  },
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
  const researchResult = useRef(null);
  useEffect(() => {
    if (research) {
      researchResult.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      researchResult.current?.focus({ preventScroll: true });
    }
  }, [research]);
  async function copyResearch() {
    try {
      await navigator.clipboard.writeText(
        research.answer +
          "\n\nSources:\n" +
          (research.sources || [])
            .map((source) => source.title + ": " + source.url)
            .join("\n"),
      );
      setMessage("Briefing and source links copied.");
    } catch {
      setMessage("Clipboard unavailable. Select the briefing text to copy it.");
    }
  }
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
      const submitted = question.trim();
      setResearch({
        ...(await newsService.research(submitted)),
        question: submitted,
      });
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
          {research && (
            <section
              className="news-research-result"
              aria-label="Research briefing"
              ref={researchResult}
              tabIndex={-1}
            >
              <header className="news-result-heading">
                <div>
                  <span className="news-kicker">THE RESEARCH NOTE</span>
                  <h2>Your market briefing.</h2>
                </div>
                <div className="news-result-actions">
                  <button
                    type="button"
                    aria-label="Copy sourced briefing"
                    title="Copy briefing with sources"
                    onClick={copyResearch}
                  >
                    <FiCopy />
                  </button>
                  <button
                    type="button"
                    aria-label="Close research briefing"
                    title="Close briefing"
                    onClick={() => {
                      setResearch(null);
                      researchInput.current?.focus();
                    }}
                  >
                    <FiX />
                  </button>
                </div>
              </header>
              <p className="news-result-question">{research.question}</p>
              <Briefing result={research} />
            </section>
          )}
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
            timezone. News discovery by{" "}
            <a
              href="https://www.thenewsapi.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              The News API
            </a>
            .
            {articles.some(
              (article) => article.indexed_at && !article.published_at,
            ) && (
              <>
                {" "}
                Older indexed stories were discovered by{" "}
                <a
                  href="https://www.gdeltproject.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GDELT
                </a>
                ; their dates show indexing time.
              </>
            )}
          </p>
        </section>
        <aside className="news-research" aria-label="AI research desk">
          <div className="news-research-heading">
            <span className="news-ai-icon">
              <FiCompass aria-hidden="true" />
            </span>
            <span className="news-kicker">BEYOND THE HEADLINE</span>
          </div>
          <h2>Your research desk.</h2>
          <p className="news-research-intro">
            A question. A few credible sources.
            <br />A clearer view of the market.
          </p>
          <form className="news-research-form" onSubmit={ask}>
            <label htmlFor="news-research-question">
              What’s on your radar?
            </label>
            <div className="news-question-field">
              <textarea
                id="news-research-question"
                ref={researchInput}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Follow a market move, explore a story, or connect the dots…"
                maxLength={1200}
                rows={3}
                required
                minLength={5}
              />
              <div className="news-question-hint">
                <span>Search the web, with sources</span>
                <span>{question.length}/1200</span>
              </div>
            </div>
            <button
              className="news-research-submit"
              disabled={
                researching ||
                question.trim().length < 5 ||
                status?.ai === false
              }
            >
              <FiGlobe aria-hidden="true" />
              {researching ? "Researching sources…" : "Research the web"}
            </button>
          </form>
          {!research && !researching && (
            <div className="news-prompts">
              <span>FIND YOUR STARTING POINT</span>
              {prompts.map(
                ({ label, detail, question: prompt, icon: Icon }) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => {
                      setQuestion(prompt);
                      researchInput.current?.focus();
                    }}
                  >
                    <span className="news-prompt-icon">
                      <Icon aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{label}</strong>
                      <small>{detail}</small>
                    </span>
                    <span className="news-prompt-plus" aria-hidden="true">
                      +
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
          {status?.ai === false && (
            <p className="news-research-note">
              AI research is currently unavailable. Please try again later.
            </p>
          )}
          {researching && (
            <div role="status" className="news-research-progress">
              <span className="news-progress-icon">
                <FiGlobe aria-hidden="true" />
              </span>
              <strong>Following the story</strong>
              <p>
                Finding relevant reporting and bringing the context together.
              </p>
              <span className="news-progress-line" />
              <span className="news-progress-line" />
              <span className="news-progress-line" />
            </div>
          )}
          {researchError && (
            <div role="alert" className="news-research-note">
              <strong>We couldn’t finish this briefing.</strong>
              <p>{researchError}</p>
            </div>
          )}
          {research && !researching && (
            <button
              type="button"
              className="news-view-briefing"
              onClick={() => {
                researchResult.current?.scrollIntoView({
                  block: "start",
                  behavior: "smooth",
                });
                researchResult.current?.focus({ preventScroll: true });
              }}
            >
              <FiFileText aria-hidden="true" />
              <span>
                <strong>Your briefing is ready</strong>
                <small>Read the research and explore its sources</small>
              </span>
            </button>
          )}
          <div className="news-research-footer">
            <FiCheck aria-hidden="true" /> A little context goes a long way.
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
