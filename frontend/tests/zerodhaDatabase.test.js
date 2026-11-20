import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("broker inbox isolates secrets, imports once, and atomically journals only owned complete positions", async () => {
  const pg = new PGlite();
  const alice = "11111111-1111-4111-8111-111111111111",
    bob = "22222222-2222-4222-8222-222222222222";
  try {
    await pg.exec(`create schema auth; create role authenticated; create role anon; create role service_role bypassrls;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon,service_role;
      insert into auth.users values ('${alice}'),('${bob}');`);
    await pg.exec(
      await readFile(
        new URL("../../supabase/migrations/001_journal.sql", import.meta.url),
        "utf8",
      ),
    );
    await pg.exec(
      await readFile(
        new URL("../../supabase/migrations/003_zerodha.sql", import.meta.url),
        "utf8",
      ),
    );
    const {
      rows: [account],
    } = await pg.query(
      "insert into accounts(user_id,name,currency) values ($1,'INR','INR') returning id",
      [alice],
    );
    const {
      rows: [usd],
    } = await pg.query(
      "insert into accounts(user_id,name,currency) values ($1,'USD','USD') returning id",
      [alice],
    );
    async function insert(
      key,
      side,
      quantity,
      time = "2026-10-29T04:00:00Z",
      instrument = "TEST",
    ) {
      const {
        rows: [row],
      } = await pg.query(
        `insert into broker_executions(user_id,client_id,execution_key,trade_id,order_id,exchange,instrument,product,side,quantity,price,executed_at)
        values ($1,'TEST01',$2,$2,'order','NSE',$3,'MIS',$4,$5,100,$6) returning id`,
        [alice, key, instrument, side, quantity, time],
      );
      return row.id;
    }
    const entry = await insert("1", "BUY", 2),
      exit = await insert("2", "SELL", 2, "2026-10-29T05:00:00Z");
    await pg.query(
      "insert into zerodha_sessions values ($1,'TEST01','encrypted',now(),now()+interval '1 day')",
      [alice],
    );
    await pg.exec("set role authenticated");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      alice,
    ]);
    await assert.rejects(() => pg.query("select * from zerodha_sessions"));
    await assert.rejects(() => pg.query("select * from zerodha_auth_states"));
    await assert.rejects(() =>
      pg.query("update broker_executions set price=1"),
    );
    await assert.rejects(() => pg.query("delete from broker_executions"));
    assert.equal(
      (await pg.query("select * from broker_executions")).rows.length,
      2,
    );
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      bob,
    ]);
    assert.equal(
      (await pg.query("select * from broker_executions")).rows.length,
      0,
    );
    const journal = (ids, accountId = account.id, pnl = "0") =>
      pg.query(
        "select journal_zerodha_executions($1::uuid[],$2::uuid,$3::numeric,null) as id",
        [ids, accountId, pnl],
      );
    await assert.rejects(() => journal([entry, exit]));
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      alice,
    ]);
    await assert.rejects(() => journal([entry, exit], usd.id));
    await assert.rejects(() => journal([entry, entry]));
    await assert.rejects(() => journal([entry]));
    await assert.rejects(() => journal([entry, exit], account.id, "NaN"));
    const {
      rows: [trade],
    } = await journal([entry, exit]);
    const {
      rows: [saved],
    } = await pg.query("select * from trades where id=$1", [trade.id]);
    assert.equal(Number(saved.net_pnl), 0);
    assert.equal(saved.direction, "Long");
    assert.equal(saved.details.importSource, "Zerodha");
    assert.equal(saved.details.entryPrice, 100);
    await assert.rejects(() => journal([entry, exit]));
    await pg.query("update trades set deleted_at=now() where id=$1", [
      trade.id,
    ]);
    await assert.rejects(() => journal([entry, exit]));
    await pg.exec("reset role");
    const short = await insert("3", "SELL", 3),
      cover = await insert("4", "BUY", 3, "2026-10-29T05:00:00Z");
    const partial = await insert("5", "BUY", 1),
      other = await insert("6", "SELL", 1, "2026-10-29T05:00:00Z", "OTHER");
    await assert.rejects(() => insert("1", "BUY", 2));
    await pg.exec("set role authenticated");
    await assert.rejects(() => journal([partial, other]));
    await assert.rejects(() => journal([short, partial]));
    const {
      rows: [shortTrade],
    } = await journal([short, cover]);
    assert.equal(
      (
        await pg.query("select direction from trades where id=$1", [
          shortTrade.id,
        ])
      ).rows[0].direction,
      "Short",
    );
    await pg.exec("reset role; set role anon");
    await assert.rejects(() => pg.query("select * from broker_executions"));
    await assert.rejects(() => journal([entry, exit]));
  } finally {
    await pg.close();
  }
});
