-- Shared provider metadata; private per-user reading lists; server-only budgets.
begin;
create table public.news_articles (
 id text primary key check(length(id) between 1 and 100),
 title text not null check(length(title) between 1 and 1000),
 url text not null check(url ~ '^https://'),
 source text not null, description text not null default '',
 image_url text, published_at timestamptz not null,
 fetched_at timestamptz not null default now()
);
create index news_articles_published on public.news_articles(published_at desc);
create table public.news_library (
 user_id uuid not null default auth.uid() references auth.users on delete cascade,
 article_id text not null references public.news_articles on delete cascade,
 saved boolean not null default false, liked boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(user_id,article_id)
);
create index news_library_owner_time on public.news_library(user_id,updated_at desc);
create table public.news_cache (
 key text primary key, payload jsonb not null, expires_at timestamptz not null
);
create table public.news_budgets (
 bucket text not null, day date not null default current_date,
 used integer not null default 1, primary key(bucket,day)
);
alter table public.news_articles enable row level security;
alter table public.news_library enable row level security;
alter table public.news_cache enable row level security;
alter table public.news_budgets enable row level security;
revoke all on public.news_articles,public.news_library,public.news_cache,public.news_budgets from public,anon,authenticated;
grant select on public.news_articles to authenticated;
grant select,insert,update,delete on public.news_library to authenticated;
grant all on public.news_articles,public.news_library,public.news_cache,public.news_budgets to service_role;
create policy news_read on public.news_articles for select to authenticated using(true);
create policy library_owner on public.news_library for all to authenticated
 using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create function public.news_consume_budget(p_bucket text,p_limit integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_used integer;
begin
 if p_limit < 1 or p_limit > 10000 then return false; end if;
 insert into public.news_budgets as b(bucket,day,used) values(p_bucket,current_date,1)
 on conflict(bucket,day) do update set used=b.used+1 where b.used<p_limit
 returning used into v_used;
 return v_used is not null;
end $$;
revoke all on function public.news_consume_budget(text,integer) from public,anon,authenticated;
grant execute on function public.news_consume_budget(text,integer) to service_role;
create function public.news_set_preference(p_user uuid,p_article text,p_field text,p_value boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_field not in ('saved','liked') or p_value is null then raise exception 'Invalid preference'; end if;
 insert into public.news_library as l(user_id,article_id,saved,liked)
 values(p_user,p_article,case when p_field='saved' then p_value else false end,case when p_field='liked' then p_value else false end)
 on conflict(user_id,article_id) do update set
 saved=case when p_field='saved' then p_value else l.saved end,
 liked=case when p_field='liked' then p_value else l.liked end,updated_at=now();
end $$;
revoke all on function public.news_set_preference(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.news_set_preference(uuid,text,text,boolean) to service_role;
commit;
