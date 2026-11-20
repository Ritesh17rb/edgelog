// Shared with Node tests; no broker credentials or Supabase dependencies here.
export const CALLBACK_PATH = "/dashboard/integrations/zerodha/callback";
export function indiaDay(now = Date.now()) {
  return new Date(now + 330 * 60000).toISOString().slice(0, 10);
}
export function sessionExpiry(now = Date.now()) {
  return new Date(
    Date.parse(indiaDay(now) + "T06:00:00+05:30") + 86400000,
  ).toISOString();
}
export async function digest(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function bytes(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function base64(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}
async function encryptionKey(secret) {
  const raw = bytes(secret);
  if (raw.length !== 32)
    throw new Error("Invalid server encryption configuration.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(token, userId, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) },
    await encryptionKey(secret),
    new TextEncoder().encode(token),
  );
  return base64(iv) + "." + base64(encrypted);
}
export async function unseal(value, userId, secret) {
  const [iv, encrypted] = value.split(".");
  const data = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes(iv),
      additionalData: new TextEncoder().encode(userId),
    },
    await encryptionKey(secret),
    bytes(encrypted),
  );
  return new TextDecoder().decode(data);
}
export function normalizeExecutions(rows, userId, clientId, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length > 5000)
    throw new Error("Unexpected broker trade response.");
  const seen = new Set();
  return rows
    .map((row) => {
      const id = String(row.trade_id ?? ""),
        orderId = String(row.order_id ?? "");
      const exchange = String(row.exchange ?? ""),
        instrument = String(row.tradingsymbol ?? ""),
        product = String(row.product ?? "");
      // Kite timestamps without an offset are exchange-local IST, never the browser's timezone.
      const timestamp = String(
        row.fill_timestamp || row.exchange_timestamp || "",
      );
      const at = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(
        timestamp,
      )
        ? timestamp.replace(" ", "T") + "+05:30"
        : timestamp;
      const time = Date.parse(at),
        quantity = Number(row.quantity),
        price = Number(row.average_price);
      if (
        !id ||
        !orderId ||
        id.length > 100 ||
        orderId.length > 100 ||
        !/^[A-Z0-9_]{1,20}$/.test(exchange) ||
        !instrument ||
        instrument.length > 100 ||
        !/^[A-Z0-9_]{1,20}$/.test(product) ||
        !["BUY", "SELL"].includes(row.transaction_type) ||
        !Number.isFinite(time) ||
        indiaDay(time) !== indiaDay(now) ||
        time > now + 60000 ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(price) ||
        price <= 0
      )
        throw new Error(
          "Broker returned an invalid or non-current-day execution. No fills were imported.",
        );
      const executionKey = [indiaDay(time), exchange, orderId, id].join(":");
      if (seen.has(executionKey))
        throw new Error("Broker returned duplicate execution identifiers.");
      seen.add(executionKey);
      return {
        user_id: userId,
        client_id: clientId,
        execution_key: executionKey,
        trade_id: id,
        order_id: orderId,
        exchange,
        instrument,
        product,
        side: row.transaction_type,
        quantity,
        price,
        executed_at: new Date(time).toISOString(),
      };
    })
    .sort(
      (a, b) =>
        a.executed_at.localeCompare(b.executed_at) ||
        a.trade_id.localeCompare(b.trade_id),
    );
}
