import { db, unwrap } from "../lib/supabase";

async function invoke(action, values = {}) {
  const { data, error } = await db().functions.invoke("zerodha", {
    body: { action, ...values },
  });
  if (error) {
    let detail;
    try {
      detail = await error.context?.json();
    } catch {
      /* Network or undeployed function. */
    }
    const failure = new Error(
      detail?.error ||
        "Zerodha connection is unavailable. Complete the server setup or retry.",
    );
    failure.code = detail?.code || "unavailable";
    throw failure;
  }
  return data;
}
export const zerodhaService = {
  status: () => invoke("status"),
  connect: () => invoke("connect"),
  exchange: (requestToken, state) =>
    invoke("exchange", { requestToken, state }),
  disconnect: () => invoke("disconnect"),
  preview: () => invoke("preview"),
  import: (keys) => invoke("import", { keys }),
  async inbox() {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const result = await db()
        .from("broker_executions")
        .select("*")
        .order("executed_at", { ascending: false })
        .order("id")
        .range(offset, offset + 499);
      if (result.error)
        throw new Error(
          "The import inbox is unavailable. Apply Supabase migration 003 if this is your first setup.",
        );
      rows.push(...result.data);
      if (result.data.length < 500) return rows;
    }
  },
  journal: ({ ids, accountId, netPnl, initialRisk }) =>
    db()
      .rpc("journal_zerodha_executions", {
        p_execution_ids: ids,
        p_account_id: accountId,
        p_net_pnl: netPnl,
        p_initial_risk: initialRisk || null,
      })
      .then(unwrap),
};
