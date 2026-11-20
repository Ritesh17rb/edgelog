import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiLink, FiRefreshCw, FiDownload, FiCheckCircle } from "react-icons/fi";
import { PageTitle, Notice, Field, Loading } from "../components/WorkspaceUI";
import { zerodhaService } from "../services/zerodhaService";
import { journalService } from "../services/journalService";
import { money } from "../lib/analytics";

const time = (value) =>
  new Date(value).toLocaleString(undefined, {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  });
function FillList({
  rows,
  selected,
  onToggle,
  disabled,
  preview = false,
  imported = new Set(),
}) {
  return (
    <div className="broker-fill-list">
      {rows.map((row) => {
        const key = preview ? row.execution_key : row.id;
        const recorded = preview
          ? imported.has(row.client_id + ":" + row.execution_key)
          : Boolean(row.linked_trade_id);
        return (
          <label
            className={"broker-fill " + (recorded ? "recorded" : "")}
            key={key}
          >
            <input
              type="checkbox"
              aria-label={"Select execution " + row.trade_id}
              checked={selected.includes(key)}
              disabled={disabled || recorded}
              onChange={() => onToggle(key)}
            />
            <span className="broker-fill-symbol">
              <strong>{row.instrument}</strong>
              <small>
                {row.exchange} · {row.product} · {time(row.executed_at)} IST
              </small>
              <small>
                Execution {row.trade_id} · Order {row.order_id}
              </small>
            </span>
            <span className={row.side === "BUY" ? "positive" : "negative"}>
              {row.side}
            </span>
            <span>
              {row.quantity} × {money(row.price, "INR")}
              <small>
                {recorded
                  ? preview
                    ? "Imported"
                    : "Journaled"
                  : "Execution fill"}
              </small>
            </span>
          </label>
        );
      })}
    </div>
  );
}
function toggle(values, value) {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

export default function Integrations() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null),
    [accounts, setAccounts] = useState([]),
    [inbox, setInbox] = useState([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null),
    [selected, setSelected] = useState([]),
    [chosen, setChosen] = useState([]);
  const [accountId, setAccountId] = useState(""),
    [netPnl, setNetPnl] = useState(""),
    [risk, setRisk] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [filter, setFilter] = useState("Pending");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      zerodhaService.status(),
      journalService.accounts(),
      zerodhaService.inbox(),
    ]);
    if (results[0].status === "fulfilled") setStatus(results[0].value);
    if (results[1].status === "fulfilled") setAccounts(results[1].value);
    if (results[2].status === "fulfilled") setInbox(results[2].value);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) setError(failed.map((r) => r.reason.message).join(" "));
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function task(work) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(e.message);
      if (e.code === "session_expired") {
        setStatus((s) => ({ ...s, connected: false }));
        setPreview(null);
      }
    } finally {
      setBusy(false);
    }
  }
  const imported = new Set(
    inbox.map((r) => r.client_id + ":" + r.execution_key),
  );
  async function fetchPreview() {
    const result = await zerodhaService.preview();
    setPreview(result);
    setSelected(
      result.executions
        .filter((r) => !imported.has(r.client_id + ":" + r.execution_key))
        .slice(0, 500)
        .map((r) => r.execution_key),
    );
  }
  async function importFills() {
    const result = await zerodhaService.import(selected);
    setInbox(await zerodhaService.inbox());
    setSelected([]);
    setMessage(
      `${result.imported} executions imported; ${result.skipped} duplicates skipped. Select matching entry and exit fills below to create a journal trade.`,
    );
  }
  const pending = inbox.filter((r) => !r.linked_trade_id);
  const chosenRows = pending.filter((r) => chosen.includes(r.id));
  const buy = chosenRows
    .filter((r) => r.side === "BUY")
    .reduce((n, r) => n + Number(r.quantity), 0);
  const sell = chosenRows
    .filter((r) => r.side === "SELL")
    .reduce((n, r) => n + Number(r.quantity), 0);
  const oneInstrument =
    new Set(
      chosenRows.map((r) =>
        [r.client_id, r.exchange, r.instrument, r.product].join(":"),
      ),
    ).size === 1;
  const balanced =
    chosenRows.length >= 2 &&
    oneInstrument &&
    Math.abs(buy - sell) < 1e-8 &&
    buy > 0;
  const inrAccounts = accounts.filter((a) => a.currency === "INR");
  if (loading) return <Loading />;
  return (
    <div className="page-stack broker-page">
      <PageTitle
        title="Connect your trading account."
        description="Import executions, review the details, and keep your journal in sync."
        eyebrow="INTEGRATIONS"
      >
        <button className="button" disabled={busy} onClick={load}>
          <FiRefreshCw /> Refresh
        </button>
      </PageTitle>
      {error && <Notice error={error} />}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <section
        className="panel broker-connection"
        aria-labelledby="zerodha-heading"
      >
        <div className="broker-identity">
          <span className="broker-logo">
            <FiLink />
          </span>
          <div>
            <h2 id="zerodha-heading">Zerodha</h2>
            <p className="muted">Personal API · Trade import</p>
          </div>
          <span className="tag">
            {status?.connected
              ? "Connected"
              : status?.configured
                ? "Not connected"
                : "Setup required"}
          </span>
        </div>
        <p>
          Connect through Kite to preview today’s executed trades. Your Zerodha
          password is entered only on Kite.
        </p>
        {status?.connected && (
          <p className="muted">
            Client {status.clientId} · Session expires {time(status.expiresAt)}{" "}
            IST. Reconnect daily.
          </p>
        )}
        {!status?.configured && (
          <p className="muted">
            {status?.reason === "not_enabled"
              ? "A Personal app connects one Zerodha client ID. This journal account is not enabled for the configured connection."
              : "Apply migration 003, configure the server secrets, and deploy the Zerodha function. Setup instructions are in docs/zerodha-setup.md. No credentials belong in the frontend."}
          </p>
        )}
        <div className="actions">
          <button
            className="button primary"
            disabled={busy || !status?.configured}
            onClick={() =>
              task(async () => {
                const result = await zerodhaService.connect();
                const url = new URL(result.url);
                if (
                  url.origin !== "https://kite.zerodha.com" ||
                  url.pathname !== "/connect/login"
                )
                  throw new Error("Unexpected broker login URL.");
                window.location.assign(url.href);
              })
            }
          >
            <FiLink />
            {status?.connected ? "Reconnect Zerodha" : "Connect Zerodha"}
          </button>
          {status?.connected && (
            <>
              <button
                className="button"
                disabled={busy}
                onClick={() => task(fetchPreview)}
              >
                <FiDownload /> Preview today’s trades
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  task(async () => {
                    const result = await zerodhaService.disconnect();
                    setStatus((s) => ({ ...s, connected: false }));
                    setPreview(null);
                    setSelected([]);
                    setMessage(
                      result.revoked
                        ? "Zerodha disconnected. Imported records are preserved."
                        : "Connection removed from this journal. Broker revocation could not be confirmed; revoke the API session in Kite if needed.",
                    );
                  })
                }
              >
                Disconnect
              </button>
            </>
          )}
        </div>
        <p className="muted broker-footnote">
          Import only: this integration does not place orders. Live quotes and
          historical candles are not included in Zerodha’s free Personal plan.
        </p>
      </section>
      {preview && (
        <section className="panel" aria-labelledby="broker-preview-heading">
          <div className="section-heading">
            <div>
              <h2 id="broker-preview-heading">Today’s executions</h2>
              <p className="muted">
                {preview.day} · Exchange timezone: Asia/Kolkata ·{" "}
                {preview.executions.length} fills
              </p>
            </div>
            <button
              className="button primary"
              disabled={busy || !selected.length}
              onClick={() => task(importFills)}
            >
              Import selected ({selected.length})
            </button>
          </div>
          <p className="muted">
            Executions enter your import inbox first. They affect analytics only
            after you create a journal trade. Up to 500 fills can be imported at
            once.
          </p>
          <FillList
            rows={preview.executions}
            selected={selected}
            onToggle={(v) => setSelected((s) => toggle(s, v))}
            disabled={busy}
            imported={imported}
            preview
          />
          {!preview.executions.length && (
            <p className="muted">
              No executions in today’s Zerodha trade book.
            </p>
          )}
        </section>
      )}
      <section className="panel" aria-labelledby="broker-inbox-heading">
        <div className="section-heading">
          <div>
            <h2 id="broker-inbox-heading">Import inbox</h2>
            <p className="muted">
              {pending.length} pending executions · Saved in Supabase
            </p>
          </div>
          <div className="actions">
            {["Pending", "All"].map((v) => (
              <button
                key={v}
                className="button small"
                aria-pressed={filter === v}
                onClick={() => setFilter(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <p className="muted">
          Select entry and exit fills for one complete position. Keep partial or
          overnight positions here until you have matching fills. Journaled
          fills stay linked even if the trade is moved to the bin.
        </p>
        <FillList
          rows={filter === "Pending" ? pending : inbox}
          selected={chosen}
          onToggle={(v) => {
            setChosen((s) => toggle(s, v));
            setConfirmed(false);
          }}
          disabled={busy}
        />
        {!(filter === "Pending" ? pending : inbox).length && (
          <p className="muted">
            {filter === "Pending"
              ? "No pending executions. Preview today’s trades to begin."
              : "Your imported executions will appear here."}
          </p>
        )}
      </section>
      {chosenRows.length > 0 && (
        <section className="panel" aria-labelledby="broker-journal-heading">
          <h2 id="broker-journal-heading">Review journal trade</h2>
          <p>
            {chosenRows.length} fills selected · Buy quantity {buy} · Sell
            quantity {sell}
          </p>
          {!balanced && (
            <p role="status" className="muted">
              Choose matching buy and sell quantities for the same client,
              exchange, instrument, and product.
            </p>
          )}
          {!inrAccounts.length && (
            <div className="actions">
              <p className="muted">
                Zerodha imports need an INR journal account.
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  task(async () => {
                    const account = await journalService.createAccount({
                      name: "Zerodha",
                      currency: "INR",
                      kind: "Live",
                      starting_balance: 0,
                    });
                    setAccounts((a) => [...a, account]);
                    setAccountId(account.id);
                  })
                }
              >
                Create INR account
              </button>
            </div>
          )}
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              task(async () => {
                if (
                  !balanced ||
                  !confirmed ||
                  !accountId ||
                  netPnl.trim() === "" ||
                  !Number.isFinite(Number(netPnl))
                )
                  throw new Error(
                    "Confirm a complete position, an INR account, and its net result.",
                  );
                const id = await zerodhaService.journal({
                  ids: chosen,
                  accountId,
                  netPnl,
                  initialRisk: risk,
                });
                navigate("/dashboard/trade/" + id);
              });
            }}
          >
            <div className="form-grid">
              <Field label="INR journal account">
                <select
                  required
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Choose an account</option>
                  {inrAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Broker-reported net P&L (INR)"
                hint="Include brokerage, taxes, and all charges. The fills API does not provide the final net result."
              >
                <input
                  required
                  type="number"
                  step="0.01"
                  value={netPnl}
                  onChange={(e) => setNetPnl(e.target.value)}
                />
              </Field>
              <Field label="Initial risk (INR, optional)">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={risk}
                  onChange={(e) => setRisk(e.target.value)}
                />
              </Field>
            </div>
            <label className="broker-confirm">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I confirm these fills form one complete position and the net
              result includes all trading costs.
            </label>
            <div className="actions">
              <button
                className="button primary"
                disabled={busy || !balanced || !confirmed || !accountId}
              >
                <FiCheckCircle /> Create journal trade
              </button>
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => setChosen([])}
              >
                Clear selection
              </button>
            </div>
            <p className="muted">
              Weighted entry and exit prices are saved with the trade. Add
              screenshots, strategy, and reflections using Edit trade afterward.
            </p>
          </form>
        </section>
      )}
      <p className="muted">
        Already logged these trades manually? Leave those fills in the inbox to
        avoid counting them twice.{" "}
        <Link to="/dashboard/journal">Open journal</Link>
      </p>
    </div>
  );
}
