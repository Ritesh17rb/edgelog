-- Additive migration. Secrets/session tokens are inaccessible to browser roles.
begin;
create table public.zerodha_sessions (
 user_id uuid primary key references auth.users on delete cascade,
 client_id text not null, encrypted_token text not null,
 connected_at timestamptz not null default now(), expires_at timestamptz not null
);
create table public.zerodha_auth_states (
 user_id uuid primary key references auth.users on delete cascade,
 state_hash text not null, expires_at timestamptz not null
);
alter table public.zerodha_sessions enable row level security;
alter table public.zerodha_auth_states enable row level security;
revoke all on public.zerodha_sessions, public.zerodha_auth_states from public, anon, authenticated;
grant all on public.zerodha_sessions, public.zerodha_auth_states to service_role;

alter table public.trades add constraint trades_id_owner_unique unique(id,user_id);
create table public.broker_executions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users on delete cascade,
 client_id text not null, execution_key text not null,
 trade_id text not null, order_id text not null,
 exchange text not null, instrument text not null, product text not null,
 side text not null check(side in ('BUY','SELL')),
 quantity numeric(20,8) not null check(quantity>0),
 price numeric(20,8) not null check(price>0),
 executed_at timestamptz not null,
 linked_trade_id uuid,
 imported_at timestamptz not null default now(),
 foreign key(linked_trade_id,user_id) references public.trades(id,user_id),
 unique(user_id,client_id,execution_key)
);
create index broker_executions_owner_time on public.broker_executions(user_id,executed_at desc);
alter table public.broker_executions enable row level security;
create policy owner_read on public.broker_executions for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.broker_executions from public, anon, authenticated;
grant select on public.broker_executions to authenticated;
grant all on public.broker_executions to service_role;

create function public.journal_zerodha_executions(p_execution_ids uuid[], p_account_id uuid, p_net_pnl numeric, p_initial_risk numeric default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_user uuid := auth.uid(); v_count integer; v_trade uuid; v_first public.broker_executions;
 v_row public.broker_executions; v_balance numeric := 0; v_entry_qty numeric := 0;
 v_exit_qty numeric := 0; v_entry_value numeric := 0; v_exit_value numeric := 0;
 v_closed timestamptz; v_processed integer := 0;
begin
 if v_user is null then raise exception 'Sign in to import trades.'; end if;
 if coalesce(cardinality(p_execution_ids),0)<2 or cardinality(p_execution_ids)>500 then
  raise exception 'Select between 2 and 500 matching entry and exit fills.';
 end if;
 if p_net_pnl is null or p_net_pnl::text in ('NaN','Infinity','-Infinity') or
  (p_initial_risk is not null and (p_initial_risk<=0 or p_initial_risk::text in ('NaN','Infinity','-Infinity'))) then
  raise exception 'Enter a valid broker-reported net result and positive risk if supplied.';
 end if;
 if not exists(select 1 from public.accounts where id=p_account_id and user_id=v_user and currency='INR') then
  raise exception 'Choose one of your INR journal accounts.';
 end if;
 -- Lock the complete selection before checking links, preventing concurrent duplicate journaling.
 perform id from public.broker_executions where user_id=v_user and id=any(p_execution_ids) order by id for update;
 select count(*) into v_count from public.broker_executions where user_id=v_user and id=any(p_execution_ids) and linked_trade_id is null;
 if v_count<>cardinality(p_execution_ids) then raise exception 'Some fills are missing or already journaled. Refresh the inbox.'; end if;
 select * into v_first from public.broker_executions where user_id=v_user and id=any(p_execution_ids) order by executed_at,length(trade_id),trade_id,id limit 1;
 for v_row in select * from public.broker_executions where user_id=v_user and id=any(p_execution_ids) order by executed_at,length(trade_id),trade_id,id loop
  if (v_row.client_id,v_row.exchange,v_row.instrument,v_row.product) is distinct from
   (v_first.client_id,v_first.exchange,v_first.instrument,v_first.product) then
   raise exception 'Select fills from the same client, exchange, instrument and product.';
  end if;
  if v_row.side=v_first.side then
   v_balance:=v_balance+v_row.quantity; v_entry_qty:=v_entry_qty+v_row.quantity;
   v_entry_value:=v_entry_value+v_row.quantity*v_row.price;
  else
   v_balance:=v_balance-v_row.quantity; v_exit_qty:=v_exit_qty+v_row.quantity;
   v_exit_value:=v_exit_value+v_row.quantity*v_row.price;
  end if;
  if v_balance<0 then raise exception 'These fills reverse direction. Select one complete position at a time.'; end if;
  v_processed:=v_processed+1;
  if v_balance=0 and v_processed<v_count then raise exception 'Select one complete position at a time, not multiple round trips.'; end if;
  v_closed:=v_row.executed_at;
 end loop;
 if v_balance<>0 or v_exit_qty=0 then raise exception 'Entry and exit quantities must balance. Keep incomplete or overnight positions in the inbox.'; end if;
 insert into public.trades(user_id,account_id,instrument,direction,status,traded_at,closed_at,net_pnl,initial_risk,details)
 values(v_user,p_account_id,v_first.exchange||':'||v_first.instrument,case when v_first.side='BUY' then 'Long' else 'Short' end,
 'Closed',v_first.executed_at,v_closed,p_net_pnl,p_initial_risk,
 jsonb_build_object('importSource','Zerodha','brokerClientId',v_first.client_id,'brokerExecutionIds',to_jsonb(p_execution_ids),
 'quantity',v_entry_qty,'entryPrice',v_entry_value/v_entry_qty,'exitPrice',v_exit_value/v_exit_qty,'images','[]'::jsonb)) returning id into v_trade;
 update public.broker_executions set linked_trade_id=v_trade where user_id=v_user and id=any(p_execution_ids);
 return v_trade;
end;
$$;
revoke all on function public.journal_zerodha_executions(uuid[],uuid,numeric,numeric) from public,anon;
grant execute on function public.journal_zerodha_executions(uuid[],uuid,numeric,numeric) to authenticated;
commit;
