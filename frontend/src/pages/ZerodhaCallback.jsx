import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PageTitle, Notice } from "../components/WorkspaceUI";
import { zerodhaService } from "../services/zerodhaService";

export default function ZerodhaCallback() {
  const started = useRef(false);
  const [message, setMessage] = useState("Completing your Zerodha connection…"),
    [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    // Remove the short-lived broker token before any navigation or error display.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    const token = params.get("request_token"),
      state = params.get("state");
    if (
      !token ||
      !state ||
      (params.has("status") && params.get("status") !== "success")
    ) {
      setError(
        "The connection was cancelled or its callback is incomplete. Return to Integrations and connect again.",
      );
      return;
    }
    zerodhaService
      .exchange(token, state)
      .then(() =>
        setMessage(
          "Zerodha connected. You can now preview today's executed trades.",
        ),
      )
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="page-stack">
      <PageTitle
        title="Zerodha connection"
        description="Securely linking your broker account."
      />
      <section className="panel">
        {error ? <Notice error={error} /> : <p role="status">{message}</p>}
        <Link className="button primary" to="/dashboard/integrations">
          Return to Integrations
        </Link>
      </section>
    </div>
  );
}
