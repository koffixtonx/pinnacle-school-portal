-- Student ID cards: the office issues them, the student prints them.
--
-- A card is a claim about a person - "this face, this matric number, valid this
-- session" - so it is stored as an issued record rather than rendered on demand.
-- Printing the current date onto a blank card would let a card from last session
-- pass as this one, and there would be nothing to check it against. Hence the
-- verification code: printed on the card, and readable back by an administrator
-- through verify_id_card(), which is also the only thing that says a card has
-- been revoked.
--
-- Issuing is an administrator's RPC and never a client write, because the row
-- carries the validity window and the code. A student may read and print their
-- own card and nothing else about it.

---------------------------------------------------------------------------
-- Two small lookups the issuer needs
---------------------------------------------------------------------------
-- 0015's course_tenant_id does the same job for a course; a card is keyed on a
-- person, and the photo bucket is keyed on a person too.
create or replace function public.profile_tenant_id(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = p_profile_id;
$$;

-- The card says which session it belongs to and expires when that session ends,
-- both taken from 0006 rather than typed in - a hand-kept expiry is the field
-- every card scheme gets wrong eventually. Returns null when the school has not
-- marked a session active, and the caller falls back to a twelve-month card.
create or replace function public.current_academic_session()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('label', s.name, 'endsAt', s.end_date)
    from public.academic_sessions s
   where s.tenant_id = public.auth_tenant_id() and s.is_active
   order by s.start_date desc
   limit 1;
$$;

---------------------------------------------------------------------------
-- The card
---------------------------------------------------------------------------
create table if not exists public.student_id_cards (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  student_id         uuid not null references public.profiles (id) on delete cascade,
  -- Eight upper-case hex digits, which is what fits under a name on a card and
  -- what a gate guard can read back over a phone. Unambiguous by alphabet: no
  -- O/0 or I/1 pairs to dictate down the line.
  verification_code  text not null unique check (verification_code ~ '^[0-9A-F]{8}$'),
  photo_path         text,
  session_label      text not null default '',
  valid_from         date not null default current_date,
  valid_until        date not null,
  status             text not null default 'ISSUED'
    check (status in ('ISSUED', 'REVOKED')),
  issued_by_id       uuid references public.profiles (id) on delete set null,
  issued_at          timestamptz not null default now(),
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint student_id_cards_window_check check (valid_until > valid_from)
);

create index if not exists student_id_cards_student_idx
  on public.student_id_cards (student_id, issued_at desc);
create index if not exists student_id_cards_tenant_status_idx
  on public.student_id_cards (tenant_id, status);

-- One live card per student. Replacing a damaged card is allowed - it revokes the
-- previous one in the same call - but two cards carrying different codes for one
-- person is how a gate stops meaning anything.
create unique index if not exists student_id_cards_one_live_idx
  on public.student_id_cards (student_id)
  where status = 'ISSUED';

drop trigger if exists touch_updated_at on public.student_id_cards;
create trigger touch_updated_at
  before update on public.student_id_cards
  for each row execute function public.touch_updated_at();

alter table public.student_id_cards alter column tenant_id set default public.auth_tenant_id();

---------------------------------------------------------------------------
-- Issuing
---------------------------------------------------------------------------
create or replace function public.issue_student_id_card(
  p_student_id    uuid,
  p_photo_path    text  default null,
  p_valid_until   date  default null,
  p_session_label text  default null
)
returns public.student_id_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile   public.profiles;
  v_session   jsonb;
  v_row       public.student_id_cards;
  v_from      date := current_date;
  v_until     date;
  v_label     text;
  v_code      text;
  v_attempt   int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  if not public.is_admin() then
    raise exception 'Only a school administrator can issue an ID card'
      using hint = 'The card office prints them; the portal only shows what was issued.';
  end if;

  select * into v_profile from public.profiles where id = p_student_id;
  if not found or v_profile.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Student not found';
  end if;

  if v_profile.role not in ('STUDENT', 'NON_ACADEMIC_STAFF') then
    raise exception '% is not a student, so there is no student card to issue',
      initcap(replace(lower(v_profile.role), '_', ' '));
  end if;
  if v_profile.active is false then
    raise exception 'This account has been deactivated, so its card cannot be issued';
  end if;
  if v_profile.student_status = 'INACTIVE' then
    raise exception 'Their record is inactive, so no card should be printed'
      using hint = 'Reactivate the student first if they have returned.';
  end if;

  -- A photo is optional - a school that has never collected one still needs cards
  -- today - but when one is named it must be this student's own object, already
  -- uploaded. Same rule 0015 sets for a submission's file.
  if p_photo_path is not null then
    if split_part(p_photo_path, '/', 1) <> p_student_id::text then
      raise exception 'That photo does not belong to this student';
    end if;
    if not exists (
      select 1 from storage.objects
       where bucket_id = 'id-card-photos' and name = p_photo_path
    ) then
      raise exception 'The photo did not finish uploading. Attach it again.';
    end if;
  end if;

  v_session := public.current_academic_session();
  v_label := coalesce(
    nullif(btrim(coalesce(p_session_label, '')), ''),
    v_session ->> 'label',
    to_char(v_from, 'YYYY') || '/' || to_char(v_from + interval '1 year', 'YYYY')
  );
  v_until := coalesce(
    p_valid_until,
    (v_session ->> 'endsAt')::date,
    (v_from + interval '1 year')::date
  );

  -- The old card stops working the moment the new one is written, so a replaced
  -- card cannot be used at the gate after the complaint about it.
  update public.student_id_cards
     set status = 'REVOKED', revoked_at = now()
   where student_id = p_student_id and status = 'ISSUED';

  -- The code is unique-indexed, so a one-in-four-billion clash retries rather
  -- than surfacing as a database error the office cannot act on.
  v_code := null;
  for v_attempt in 1 .. 5 loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.student_id_cards (
        tenant_id, student_id, verification_code, photo_path, session_label,
        valid_from, valid_until, issued_by_id, issued_at
      )
      values (
        v_profile.tenant_id, p_student_id, v_code, p_photo_path, v_label,
        v_from, v_until, auth.uid(), now()
      )
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_attempt = 5 then
        raise exception 'Could not allocate a card number. Try again in a moment.';
      end if;
    end;
  end loop;

  insert into public.notifications (tenant_id, level, category, title, message, sender_id, recipient_id)
  values (
    v_profile.tenant_id, 'info', 'system',
    'Your student ID card is ready',
    'It is valid until ' || to_char(v_until, 'FM9 Month YYYY') || '. Open the ID card page to print it.',
    auth.uid(),
    p_student_id
  );

  return v_row;
end;
$$;

---------------------------------------------------------------------------
-- Revoking
---------------------------------------------------------------------------
create or replace function public.revoke_student_id_card(
  p_card_id uuid,
  p_reason  text default null
)
returns public.student_id_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       public.student_id_cards;
  v_profile   public.profiles;
  v_explanation text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if not public.is_admin() then
    raise exception 'Only a school administrator can revoke an ID card';
  end if;

  select * into v_row from public.student_id_cards where id = p_card_id;
  if not found or v_row.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Card not found';
  end if;

  if v_row.status = 'REVOKED' then
    raise exception 'That card is already revoked';
  end if;

  update public.student_id_cards
     set status = 'REVOKED', revoked_at = now()
   where id = p_card_id
  returning * into v_row;

  select * into v_profile from public.profiles where id = v_row.student_id;

  insert into public.notifications (tenant_id, level, category, title, message, sender_id, recipient_id)
  values (
    v_row.tenant_id, 'warning', 'system',
    'Your student ID card has been withdrawn',
    'Card ' || v_row.verification_code || ' no longer works.' ||
      case when v_explanation is null then '' else ' ' || v_explanation end,
    auth.uid(),
    v_row.student_id
  );

  return v_row;
end;
$$;

---------------------------------------------------------------------------
-- Checking a card at the gate
---------------------------------------------------------------------------
-- The question a bouncer asks is not "which card is this" but "does this card
-- still mean what it says", so this returns the holder and the state of the
-- card together. RLS would not let an administrator query another school's card,
-- and the code alone is not a credential, which is why this is an RPC behind
-- is_admin() rather than a readable view.
create or replace function public.verify_id_card(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row     public.student_id_cards;
  v_profile public.profiles;
  v_school  text;
  v_result  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if not public.is_admin() then
    raise exception 'Only a school administrator can check a card';
  end if;

  select * into v_row from public.student_id_cards
   where verification_code = upper(btrim(coalesce(p_code, '')));
  if not found or v_row.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'No card from this school carries that number'
      using hint = 'Check the eight characters printed under the holder''s name.';
  end if;

  select * into v_profile from public.profiles where id = v_row.student_id;
  select name into v_school from public.tenants where id = v_row.tenant_id;

  select jsonb_build_object(
    'cardId', v_row.id,
    'code', v_row.verification_code,
    'status', v_row.status,
    'sessionLabel', v_row.session_label,
    'validFrom', v_row.valid_from,
    'validUntil', v_row.valid_until,
    'issuedAt', v_row.issued_at,
    'revokedAt', v_row.revoked_at,
    'photoPath', v_row.photo_path,
    'isExpired', v_row.valid_until < current_date,
    'holder', jsonb_build_object(
      'studentId', v_profile.id,
      'firstName', v_profile.first_name,
      'lastName', v_profile.last_name,
      'matricNumber', v_profile.matric_number,
      'role', v_profile.role,
      'level', v_profile.student_level,
      'studentStatus', v_profile.student_status,
      'active', v_profile.active,
      'department', (select d.name from public.departments d where d.id = v_profile.department_id),
      'faculty', (select f.name from public.faculties f
                   join public.departments d on d.id = v_profile.department_id
                  where f.id = d.faculty_id)
    ),
    'school', jsonb_build_object(
      'name', v_school,
      'issuedByName', (select p.first_name || ' ' || p.last_name from public.profiles p where p.id = v_row.issued_by_id)
    )
  ) into v_result;

  return v_result;
end;
$$;

---------------------------------------------------------------------------
-- Row level security
---------------------------------------------------------------------------
alter table public.student_id_cards enable row level security;

-- A student reads their own card - that is the whole point of putting it in the
-- portal - and the office reads every card in the school. Nobody else, including
-- a lecturer: a card is not a mark sheet, and teaching a course does not make the
-- class's identity documents yours to browse.
drop policy if exists student_id_cards_read on public.student_id_cards;
create policy student_id_cards_read on public.student_id_cards
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or student_id = auth.uid())
  );

-- No insert, update or delete policy: issue_student_id_card() and
-- revoke_student_id_card() are the only doors, so a code, a validity window and a
-- revocation cannot be written by a crafted client.

---------------------------------------------------------------------------
-- Where the card photos live
---------------------------------------------------------------------------
-- Private, unlike branding: a face on a school's storage is not a public asset,
-- and the card renders the photo through a signed URL for the person allowed to
-- see the card.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'id-card-photos', 'id-card-photos', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- <student_id>/photo.<ext>
drop policy if exists id_card_photos_read_object on storage.objects;
create policy id_card_photos_read_object on storage.objects
  for select to authenticated
  using (
    bucket_id = 'id-card-photos'
    and public.profile_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (public.is_admin() or public.path_uuid(name, 1) = auth.uid())
  );

-- The student may upload their own picture; the office may do it for them, which
-- is what happens with a print-shop headshot. The tenant gate above already holds
-- an administrator to their own school's folder.
drop policy if exists id_card_photos_insert_object on storage.objects;
create policy id_card_photos_insert_object on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'id-card-photos'
    and public.profile_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (public.is_admin() or public.path_uuid(name, 1) = auth.uid())
  );

drop policy if exists id_card_photos_modify_object on storage.objects;
create policy id_card_photos_modify_object on storage.objects
  for update to authenticated
  using (
    bucket_id = 'id-card-photos'
    and public.profile_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (public.is_admin() or public.path_uuid(name, 1) = auth.uid())
  )
  with check (
    bucket_id = 'id-card-photos'
    and public.profile_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
  );

drop policy if exists id_card_photos_delete_object on storage.objects;
create policy id_card_photos_delete_object on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'id-card-photos'
    and public.profile_tenant_id(public.path_uuid(name, 1)) = public.auth_tenant_id()
    and (public.is_admin() or public.path_uuid(name, 1) = auth.uid())
  );

---------------------------------------------------------------------------
-- Grants
---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.student_id_cards to authenticated;

revoke all on public.student_id_cards from anon;

-- Supabase's default privileges hand `authenticated` every table right on a new
-- table. Nothing here is writable directly: the card is a record of a decision the
-- office made, and it changes only through the two RPCs.
revoke insert, update, delete, truncate, references, trigger
  on public.student_id_cards from authenticated;

grant execute on function public.profile_tenant_id(uuid),
  public.current_academic_session(), public.issue_student_id_card(uuid, text, date, text),
  public.revoke_student_id_card(uuid, text), public.verify_id_card(text) to authenticated;

revoke all on function public.profile_tenant_id(uuid) from public, anon;
revoke all on function public.current_academic_session() from public, anon;
revoke all on function public.issue_student_id_card(uuid, text, date, text) from public, anon;
revoke all on function public.revoke_student_id_card(uuid, text) from public, anon;
revoke all on function public.verify_id_card(text) from public, anon;
