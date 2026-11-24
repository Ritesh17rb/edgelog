begin;
-- GDELT supplies an indexing time, not a publisher-confirmed publication time.
alter table public.news_articles alter column published_at drop not null;
alter table public.news_articles add column indexed_at timestamptz;
alter table public.news_articles add constraint news_article_has_time check(published_at is not null or indexed_at is not null);
create index news_articles_indexed on public.news_articles(indexed_at desc) where indexed_at is not null;
-- One shared lease paces cache misses across users and Edge Function instances.
create function public.news_acquire_gdelt_slot()
returns boolean language plpgsql security definer set search_path='' as $$
declare v_key text;
begin
 insert into public.news_cache as c(key,payload,expires_at)
 values('gdelt:request-lease','{}'::jsonb,clock_timestamp()+interval '5 seconds')
 on conflict(key) do update set expires_at=clock_timestamp()+interval '5 seconds'
 where c.expires_at<=clock_timestamp()
 returning key into v_key;
 return v_key is not null;
end $$;
revoke all on function public.news_acquire_gdelt_slot() from public,anon,authenticated;
grant execute on function public.news_acquire_gdelt_slot() to service_role;
commit;
