-- Announcements the school can address to somebody.
--
-- The bell already carries tenant-wide notices, but it has no audience, no draft
-- state and no read receipt the compose screen can see. `announcements` is the
-- notice itself; publishing one fans it out into the `notifications` rows each
-- recipient's bell already reads, and optionally into `email_deliveries` rows
-- that the send-announcement-email Edge Function pushes through Resend.
--
-- Fan-out is per recipient on purpose: a notice addressed to parents must not
-- appear in a student's bell, and the only way the bell can know who it belongs
-- to is the recipient_id column 0010 added.

---------------------------------------------------------------------------
-- Who a notice is for
---------------------------------------------------------------------------
-- The audience is one column rather than an array so the policy below is a
-- comparison instead of a set test, and so the compose screen can offer exactly
-- the five choices a school actually means.
create or replace function public.announcement_audience_matches(p_audience text, p_role text)
returns boolean
language sql
immutable
as $$
  select case p_audience
    when 'ALL'      then true
    when 'STUDENTS' then p_role = 'STUDENT'
    when 'TEACHERS' then p_role = 'TEACHER'
    when 'PARENTS'  then p_role = 'PARENT'
    -- Staff covers everybody who works here, including a teacher who is also
    -- an administrator; the school writes one notice rather than two.
    when 'STAFF'    then p_role in ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'NON_ACADEMIC_STAFF')
    else false
  end;
$$;

---------------------------------------------------------------------------
-- The notice
---------------------------------------------------------------------------
create table if not exists public.announcements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,
  title        text not null check (btrim(title) <> ''),
  body         text not null check (btrim(body) <> ''),
  audience     text not null default 'ALL'
    check (audience in ('ALL', 'STUDENTS', 'TEACHERS', 'PARENTS', 'STAFF')),
  status       text not null default 'DRAFT'
    check (status in ('DRAFT', 'PUBLISHED')),
  pinned       boolean not null default false,
  -- The release time, stamped by publish_announcement. A future value can only be
  -- set by hand, and the read policy below treats it as not yet due.
  published_at timestamptz,
  -- A notice about a bus strike has a natural shelf life; this one stops showing
  -- up once it has passed rather than waiting to be withdrawn.
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The list a student opens is newest-first inside one tenant, pinned first.
create index if not exists announcements_tenant_published_idx
  on public.announcements (tenant_id, published_at desc nulls last);
create index if not exists announcements_tenant_status_idx
  on public.announcements (tenant_id, status);

drop trigger if exists touch_updated_at on public.announcements;
create trigger touch_updated_at
  before update on public.announcements
  for each row execute function public.touch_updated_at();

-- The compose screen writes a draft straight from the browser, so the row has to
-- be able to name its own school: this is the same default 0002 gave the tables
-- that already existed and 0006 gave the ones it created after that.
alter table public.announcements alter column tenant_id set default public.auth_tenant_id();

---------------------------------------------------------------------------
-- Per-user read state, exactly the shape notification_reads set
---------------------------------------------------------------------------
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists announcement_reads_user_idx
  on public.announcement_reads (user_id, read_at desc);

---------------------------------------------------------------------------
-- The email outbox
---------------------------------------------------------------------------
-- Rows live here so a send can fail, be retried and be explained to the
-- administrator who asked for it. The browser never reads or writes this table:
-- publish_announcement fills it, and only the service-role Edge Function drains
-- it, which is the same split 0010 set up for payments.
create table if not exists public.email_deliveries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  announcement_id uuid references public.announcements (id) on delete cascade,
  recipient_id    uuid references public.profiles (id) on delete set null,
  to_address      text not null,
  subject         text not null,
  body            text not null,
  status          text not null default 'QUEUED'
    check (status in ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
  attempts        int not null default 0,
  provider_id     text,
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The worker's whole job is this index: queued rows, oldest first.
create index if not exists email_deliveries_queue_idx
  on public.email_deliveries (created_at)
  where status in ('QUEUED', 'SENDING');
create index if not exists email_deliveries_announcement_idx
  on public.email_deliveries (announcement_id);

drop trigger if exists touch_updated_at on public.email_deliveries;
create trigger touch_updated_at
  before update on public.email_deliveries
  for each row execute function public.touch_updated_at();

---------------------------------------------------------------------------
-- Publishing
---------------------------------------------------------------------------
-- Returns the audience as profile rows. SECURITY DEFINER because a parent's own
-- read of profiles is fenced to their children by 0012, and this has to walk the
-- whole tenant on the school's behalf -- which is exactly why it re-checks by
-- hand that the caller is an administrator of that same tenant.
create or replace function public.announcement_recipients(p_announcement_id uuid)
returns table (id uuid, email text, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select pr.id, pr.email, pr.first_name || ' ' || pr.last_name
    from public.announcements a
    join public.profiles pr on pr.tenant_id = a.tenant_id
   where a.id = p_announcement_id
     and a.tenant_id = public.auth_tenant_id()
     and public.is_admin()
     and pr.active
     and public.announcement_audience_matches(a.audience, pr.role);
$$;

create or replace function public.publish_announcement(
  p_announcement_id uuid,
  p_send_email      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement public.announcements;
  v_recipient    record;
  v_notified     int := 0;
  v_queued       int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can publish an announcement'
      using hint = 'Ask the school office to post it.';
  end if;

  select * into v_announcement from public.announcements where id = p_announcement_id;
  if not found or v_announcement.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Announcement not found';
  end if;

  if v_announcement.status = 'PUBLISHED' then
    raise exception 'That announcement has already been sent'
      using hint = 'Withdraw it and post a new one if the wording has to change.';
  end if;

  update public.announcements
     set status = 'PUBLISHED',
         -- Publishing means it goes out now, so the release time is stamped here
         -- rather than kept from the draft: the bell rows written below carry the
         -- notice text, and a scheduled notice must not be readable that way.
         published_at = now()
   where id = p_announcement_id
  returning * into v_announcement;

  -- One bell entry per recipient, so a notice addressed to parents cannot be
  -- read by a student. A school with thousands of families pays for this in
  -- rows; the alternative is an audience column on notifications, which is the
  -- same problem one table further down.
  for v_recipient in
    select r.id, r.email, r.full_name from public.announcement_recipients(p_announcement_id) r
  loop
    insert into public.notifications (tenant_id, level, category, title, message, sender_id, recipient_id)
    values (
      v_announcement.tenant_id, 'info', 'announcement',
      v_announcement.title,
      -- The bell shows a few lines, so the notice is cut to its first paragraph
      -- and the full text stays one tap away on the announcements page.
      left(split_part(v_announcement.body, E'\n\n', 1), 280),
      v_announcement.author_id,
      v_recipient.id
    );
    v_notified := v_notified + 1;

    if p_send_email then
      insert into public.email_deliveries (tenant_id, announcement_id, recipient_id, to_address, subject, body)
      values (
        v_announcement.tenant_id, v_announcement.id, v_recipient.id, v_recipient.email,
        v_announcement.title,
        'Dear ' || v_recipient.full_name || ',' || E'\n\n' || v_announcement.body
          || E'\n\n-- ' || (select name from public.tenants where id = v_announcement.tenant_id)
      );
      v_queued := v_queued + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'id', v_announcement.id,
    'status', v_announcement.status,
    'publishedAt', v_announcement.published_at,
    'notified', v_notified,
    'emailsQueued', v_queued
  );
end;
$$;

create or replace function public.mark_announcements_read(p_announcement_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  insert into public.announcement_reads (announcement_id, user_id)
  select a.id, auth.uid()
    from public.announcements a
   where a.tenant_id = public.auth_tenant_id()
     and a.status = 'PUBLISHED'
     and (p_announcement_id is null or a.id = p_announcement_id)
     and a.published_at <= now()
     and (a.expires_at is null or a.expires_at > now())
     -- The same audience rule the read policy uses, so marking everything read
     -- cannot write state for notices this person is not allowed to see.
     and public.announcement_audience_matches(a.audience, public.auth_role())
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

---------------------------------------------------------------------------
-- The outbox, from the worker's side
---------------------------------------------------------------------------
-- Both of these are sealed the way 0010 seals its payment RPCs: a browser holds
-- a user JWT, and a user JWT must not be able to move mail.
create or replace function public.claim_email_deliveries(p_limit int default 20)
returns setof public.email_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.email_deliveries;
begin
  if auth.uid() is not null then
    raise exception 'Only the delivery worker may claim email';
  end if;

  for v_row in
    select * from public.email_deliveries
     where status in ('QUEUED', 'SENDING')
       and attempts < 5
     order by created_at
     -- Skip Locked keeps two ticks of the same cron from handing out one row.
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  loop
    update public.email_deliveries
       set status = 'SENDING', attempts = attempts + 1
     where id = v_row.id;
    return query select * from public.email_deliveries where id = v_row.id;
  end loop;
end;
$$;

create or replace function public.record_email_delivery(
  p_id          uuid,
  p_status      text,
  p_provider_id text default null,
  p_error       text default null
)
returns public.email_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.email_deliveries;
begin
  if auth.uid() is not null then
    raise exception 'Only the delivery worker may record email results';
  end if;
  if p_status not in ('SENT', 'FAILED', 'QUEUED') then
    raise exception 'Record a delivery as SENT, FAILED or back to QUEUED';
  end if;

  update public.email_deliveries
     set status = p_status,
         provider_id = coalesce(p_provider_id, provider_id),
         error = case when p_status = 'SENT' then null else coalesce(p_error, error) end,
         sent_at = case when p_status = 'SENT' then now() else sent_at end
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Delivery not found';
  end if;

  return v_row;
end;
$$;

-- What the compose screen shows after publishing, and what the administrator
-- reads when a family says no email arrived. Same reason as above to re-check
-- the caller: the table it counts over has no policy that admits a client.
create or replace function public.announcement_delivery_summary(p_announcement_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'emails', coalesce((
      select jsonb_object_agg(status, n)
        from (select status, count(*) n from public.email_deliveries
               where announcement_id = p_announcement_id group by status) s
    ), '{}'::jsonb),
    'readBy', (select count(*) from public.announcement_reads
                where announcement_id = p_announcement_id),
    'audience', (select count(*) from public.announcement_recipients(p_announcement_id))
  )
  from public.announcements a
  where a.id = p_announcement_id
    and a.tenant_id = public.auth_tenant_id()
    and public.is_admin();
$$;

---------------------------------------------------------------------------
-- Row level security
---------------------------------------------------------------------------
alter table public.announcements      enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.email_deliveries   enable row level security;

-- A published notice is for its audience and nobody else. Drafts, and anything
-- whose release time has not come or whose expiry has passed, are school-office
-- only, so a notice can be written and dated without leaking it.
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      public.is_admin()
      or (
        status = 'PUBLISHED'
        and published_at <= now()
        and (expires_at is null or expires_at > now())
        and public.announcement_audience_matches(audience, public.auth_role())
      )
    )
  );

drop policy if exists announcements_write on public.announcements;
create policy announcements_write on public.announcements
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin())
  with check (tenant_id = public.auth_tenant_id() and public.is_admin());

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements
  for delete to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin());

-- Read state is nobody's business but the reader's, and it is written only
-- through mark_announcements_read: giving clients an insert policy here would let
-- a crafted client fake a receipt for a notice it cannot even see, so there is
-- none, and the RPC (which is definer and filters by audience and date) is the
-- only door.
drop policy if exists announcement_reads_select on public.announcement_reads;
create policy announcement_reads_select on public.announcement_reads
  for select to authenticated using (user_id = auth.uid());
-- No update or delete policy either: marking a notice read is not something to undo.

-- The outbox is not a client table at all. It is written by publish_announcement
-- and drained by the worker, both of which run as definer, so no policy grants
-- anything to authenticated.

---------------------------------------------------------------------------
-- Grants
---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.announcements to authenticated;
grant select on public.announcement_reads to authenticated;
-- 0003 hands select on every table in the schema to `anon`, and re-applying it
-- after this file would do so again; none of these three are public data.
revoke all on public.announcements, public.announcement_reads, public.email_deliveries from anon;
-- Supabase's default privileges give `authenticated` every table right on a new
-- table, and RLS is what refuses the writes here. The outbox has no client
-- policy at all, so take the rights back rather than depend on that alone: the
-- only writers are publish_announcement and the worker, both SECURITY DEFINER.
revoke all on public.email_deliveries from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.announcement_reads from authenticated;

grant execute on function public.announcement_audience_matches(text, text) to authenticated;
grant execute on function public.announcement_recipients(uuid) to authenticated;
grant execute on function public.publish_announcement(uuid, boolean) to authenticated;
grant execute on function public.mark_announcements_read(uuid) to authenticated;
grant execute on function public.announcement_delivery_summary(uuid) to authenticated;

revoke all on function public.announcement_audience_matches(text, text) from anon;
revoke all on function public.announcement_recipients(uuid) from public, anon;
revoke all on function public.publish_announcement(uuid, boolean) from public, anon;
revoke all on function public.mark_announcements_read(uuid) from public, anon;
revoke all on function public.announcement_delivery_summary(uuid) from public, anon;

-- Sealed against any caller holding a user JWT.
revoke all on function public.claim_email_deliveries(int) from public, anon, authenticated;
revoke all on function public.record_email_delivery(uuid, text, text, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_email_deliveries(int) to service_role;
    grant execute on function public.record_email_delivery(uuid, text, text, text) to service_role;
  end if;
end
$$;
