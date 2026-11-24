import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("news database isolates reading lists and protects cache, budgets and provider records", async () => {
  const pg = new PGlite();
  const alice = "11111111-1111-4111-8111-111111111111",
    bob = "22222222-2222-4222-8222-222222222222";
  try {
    await pg.exec(`create schema auth;create role authenticated;create role anon;create role service_role bypassrls;
      create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
    await pg.exec(
      await readFile(
        new URL("../../supabase/migrations/004_news.sql", import.meta.url),
        "utf8",
      ),
    );
    await pg.exec(
      await readFile(
        new URL("../../supabase/migrations/005_gdelt.sql", import.meta.url),
        "utf8",
      ),
    );
    const slots = await Promise.all(
      Array.from({ length: 5 }, () =>
        pg.query("select news_acquire_gdelt_slot() as allowed"),
      ),
    );
    assert.equal(slots.filter((result) => result.rows[0].allowed).length, 1);
    await pg.exec(
      "update news_cache set expires_at=now()-interval '1 second' where key='gdelt:request-lease'",
    );
    assert.equal(
      (await pg.query("select news_acquire_gdelt_slot() as allowed")).rows[0]
        .allowed,
      true,
    );
    await pg.exec(
      "insert into news_articles(id,title,url,source,published_at,indexed_at) values('gdelt-test','Indexed headline','https://example.com/indexed','Example',null,now())",
    );
    await pg.query("insert into auth.users values($1),($2)", [alice, bob]);
    await pg.exec(
      "insert into news_articles(id,title,url,source,published_at) values('story','Title','https://example.com/story','Example',now())",
    );
    await pg.query("select news_set_preference($1,'story','saved',true)", [
      alice,
    ]);
    await pg.query("select news_set_preference($1,'story','liked',true)", [
      alice,
    ]);
    await pg.exec("set role authenticated");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      bob,
    ]);
    assert.equal((await pg.query("select * from news_library")).rows.length, 0);
    await assert.rejects(() =>
      pg.query(
        "insert into news_library(user_id,article_id) values($1,'story')",
        [alice],
      ),
    );
    await assert.rejects(() => pg.query("select * from news_cache"));
    await assert.rejects(() => pg.query("select * from news_budgets"));
    await assert.rejects(() => pg.query("select news_acquire_gdelt_slot()"));
    await assert.rejects(() =>
      pg.query("select news_consume_budget('ai:global',100)"),
    );
    await assert.rejects(() =>
      pg.query("select news_set_preference($1,'story','liked',false)", [alice]),
    );
    await assert.rejects(() =>
      pg.query("update news_articles set title='Changed'"),
    );
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      alice,
    ]);
    const row = (await pg.query("select * from news_library")).rows[0];
    assert.equal(row.saved, true);
    assert.equal(row.liked, true);
    await pg.exec("reset role");
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        pg.query("select news_consume_budget('concurrent',3) as allowed"),
      ),
    );
    assert.equal(results.filter((r) => r.rows[0].allowed).length, 3);
    await pg.exec("set role anon");
    await assert.rejects(() => pg.query("select * from news_articles"));
    await assert.rejects(() => pg.query("select * from news_library"));
  } finally {
    await pg.close();
  }
});
