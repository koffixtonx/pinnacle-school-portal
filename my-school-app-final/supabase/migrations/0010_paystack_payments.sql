-- Paystack payments. An invoice is paid through a checkout session that the
-- browser opens with the `paystack-initiate` Edge Function; the money is only
-- ever recorded by the `paystack-webhook` Edge Function, which verifies
-- Paystack's signature and calls the RPCs below. Nothing in the browser can
-- mark an invoice paid, so the payment ledger stays append-only.

---------------------------------------------------------------------------
-- Columns on tables that already exist
---------------------------------------------------------------------------
-- The overdue-fee reminder must be rate limited, and a reminder is only
-- useful to the student who owes the money, so notifications gain a recipient.
alter table public.invoices     add column if not exists last_reminder_at timestamptz;
alter table public.notifications add column if not exists recipient_id uuid
  references public.profiles (id) on delete cascade;

create index if not exists notifications_recipient_idx
  on public.notifications (tenant_id, recipient_id, created_at);

---------------------------------------------------------------------------
-- Checkout sessions
---------------------------------------------------------------------------
create table if not exists public.payment_attempts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  invoice_id         uuid not null references public.invoices (id) on delete cascade,
  student_id         uuid not null references public.profiles (id) on delete cascade,
  -- Globally unique because Paystack echoes only the reference back to the
  -- webhook, which arrives with no tenant context to scope the lookup by.
  reference          text not null unique,
  email              text not null,
  amount             numeric(14, 2) not null check (amount > 0),
  currency           text not null default 'NGN',
  status             text not null default 'PENDING',
  paystack_tx_id     text,
  authorization_url  text,
  failure_reason     text,
  initiated_by_id    uuid references public.profiles (id) on delete set null,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint payment_attempts_status_check
    check (status in ('PENDING', 'STARTED', 'SUCCESS', 'FAILED', 'EXPIRED'))
);

create index if not exists payment_attempts_invoice_idx
  on public.payment_attempts (invoice_id, status);
create index if not exists payment_attempts_student_idx
  on public.payment_attempts (student_id, created_at);
create index if not exists payment_attempts_tenant_status_idx
  on public.payment_attempts (tenant_id, status);

---------------------------------------------------------------------------
-- Webhook audit trail
---------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  -- Paystack retries the same delivery, and its event id is stable across
  -- retries, so it is the natural deduplication key.
  event_id     text not null unique,
  reference    text,
  event        text,
  payload      jsonb,
  result       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists webhook_events_tenant_idx
  on public.webhook_events (tenant_id, created_at);

---------------------------------------------------------------------------
-- Triggers shared by the new tables
---------------------------------------------------------------------------
drop trigger if exists set_updated_at on public.payment_attempts;
create trigger set_updated_at before update on public.payment_attempts
  for each row execute function public.touch_updated_at();

drop trigger if exists set_updated_at on public.webhook_events;
create trigger set_updated_at before update on public.webhook_events
  for each row execute function public.touch_updated_at();

drop trigger if exists audit_changes on public.payment_attempts;
create trigger audit_changes after insert or update or delete on public.payment_attempts
  for each row execute function public.write_audit_log();

---------------------------------------------------------------------------
-- begin_payment: open (or reuse) a checkout session for an invoice
---------------------------------------------------------------------------
create or replace function public.begin_payment(
  p_invoice_id uuid,
  p_email      text    default null,
  p_amount     numeric default null
)
returns jsonb
language plpgsql
security definer
-- gen_random_bytes() lives in `extensions`, exactly like the invoice
-- reference trigger.
set search_path = public, extensions
as $$
declare
  v_caller  uuid := auth.uid();
  v_invoice public.invoices;
  v_student public.profiles;
  v_attempt public.payment_attempts;
  v_balance numeric(14, 2);
  v_amount  numeric(14, 2);
  v_ref     text;
  v_email   text;
  v_try     integer := 0;
begin
  if v_caller is null then
    raise exception 'You must be signed in to make a payment';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found or v_invoice.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Invoice not found';
  end if;

  if v_invoice.student_id <> v_caller and not public.is_admin() then
    raise exception 'You can only pay your own invoices'
      using hint = 'Open your fees page to see the invoices you can pay.';
  end if;

  if v_invoice.status = 'DRAFT' then
    raise exception 'This invoice has not been issued yet'
      using hint = 'Ask an administrator to issue the invoice before paying it.';
  end if;
  if v_invoice.status in ('PAID', 'VOID') then
    raise exception 'This invoice is already %', lower(v_invoice.status);
  end if;

  v_balance := round((v_invoice.total_amount - coalesce(v_invoice.paid_amount, 0))::numeric, 2);
  if v_balance <= 0 then
    raise exception 'This invoice has no balance left to pay';
  end if;

  v_amount := round(coalesce(p_amount, v_balance)::numeric, 2);
  if v_amount <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;
  if v_amount > v_balance then
    raise exception 'That is more than the outstanding balance of %',
      to_char(v_balance, 'FM999,999,999,990.00')
      using hint = 'Paystack charges exactly what you send, so pay no more than the balance.';
  end if;

  select * into v_student from public.profiles where id = v_invoice.student_id;

  -- A blank from the UI means "use the profile address", not "send it there".
  v_email := nullif(btrim(coalesce(p_email, '')), '');
  if v_email is not null and position('@' in v_email) < 2 then
    raise exception 'Enter a valid email address so Paystack can send you the receipt';
  end if;
  v_email := coalesce(v_email, nullif(btrim(coalesce(v_student.email, '')), ''));
  if v_email is null then
    raise exception 'The student has no email address on file'
      using hint = 'Update the profile, or type the email address to use for the receipt.';
  end if;

  -- A session nobody finished going to checkout is stale after an hour; it is
  -- closed rather than reused, because its authorization URL has expired.
  update public.payment_attempts
     set status = 'EXPIRED'
   where invoice_id = v_invoice.id
     and status in ('PENDING', 'STARTED')
     and created_at < now() - interval '1 hour';

  -- Reuse a live session for the same amount so a student who reloads the
  -- checkout page does not stack up references for the same money.
  select * into v_attempt
    from public.payment_attempts
   where invoice_id = v_invoice.id and amount = v_amount and status in ('PENDING', 'STARTED')
   order by created_at desc
   limit 1;

  if not found then
    while v_try < 5 loop
      v_try := v_try + 1;
      v_ref := 'PY-' || upper(to_char(now(), 'YYMMDDHH24MISS')) || '-' ||
               upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4));
      begin
        insert into public.payment_attempts (
          tenant_id, invoice_id, student_id, reference, email, amount, currency,
          status, initiated_by_id
        ) values (
          v_invoice.tenant_id, v_invoice.id, v_invoice.student_id, v_ref,
          lower(v_email), v_amount, 'NGN',
          'PENDING', v_caller
        )
        returning * into v_attempt;
        exit;
      exception
        -- Two students paying in the same second can roll the same suffix; the
        -- reference is the only thing that collided, so try again.
        when unique_violation then
          continue;
      end;
    end loop;
  end if;

  if v_attempt.id is null then
    raise exception 'Could not start the payment, please try again in a moment'
      using hint = 'If it keeps happening, ask an administrator to check the invoice.';
  end if;

  return jsonb_build_object(
    'reference', v_attempt.reference,
    'amount', v_attempt.amount,
    'currency', v_attempt.currency,
    'email', v_attempt.email,
    'status', v_attempt.status,
    'invoiceId', v_attempt.invoice_id,
    'invoiceReference', v_invoice.reference,
    'studentName', trim(coalesce(v_student.first_name, '') || ' ' || coalesce(v_student.last_name, '')),
    'authorizationUrl', v_attempt.authorization_url
  );
end;
$$;

---------------------------------------------------------------------------
-- Server-to-server RPCs. Only the Edge Functions hold the service role key, so
-- a student JWT — however it is forged against PostgREST — cannot reach them.
---------------------------------------------------------------------------
create or replace function public.mark_payment_started(
  p_reference         text,
  p_paystack_tx_id    text    default null,
  p_authorization_url text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.payment_attempts;
begin
  if auth.uid() is not null then
    raise exception 'Only the payment service can update a checkout session'
      using hint = 'Payments are confirmed by Paystack, not by the browser.';
  end if;

  select * into v_attempt from public.payment_attempts where reference = p_reference;
  if not found then
    raise exception 'Checkout session % not found', p_reference;
  end if;

  if v_attempt.status = 'SUCCESS' then
    return jsonb_build_object('reference', v_attempt.reference, 'status', v_attempt.status,
                              'unchanged', true);
  end if;
  if v_attempt.status = 'EXPIRED' then
    raise exception 'That checkout session has expired';
  end if;

  update public.payment_attempts
     set status = 'STARTED',
         paystack_tx_id = coalesce(p_paystack_tx_id, paystack_tx_id),
         authorization_url = coalesce(p_authorization_url, authorization_url)
   where id = v_attempt.id
  returning * into v_attempt;

  return jsonb_build_object(
    'reference', v_attempt.reference,
    'status', v_attempt.status,
    'authorizationUrl', v_attempt.authorization_url,
    'paystackTxId', v_attempt.paystack_tx_id
  );
end;
$$;

-- The only path that writes a row into the payment ledger.
create or replace function public.confirm_payment_success(
  p_reference      text,
  p_event_id       text    default null,
  p_event          text    default null,
  p_paystack_tx_id text    default null,
  p_amount         numeric default null,
  p_payload        jsonb   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt  public.payment_attempts;
  v_invoice  public.invoices;
  v_event_pk uuid;
  v_payment  public.payments;
  v_balance  numeric(14, 2);
  v_paid     numeric(14, 2);
  v_status   text;
  v_result   text;
begin
  if auth.uid() is not null then
    raise exception 'Only the payment service can confirm a payment'
      using hint = 'Ask the student to pay through the checkout page.';
  end if;

  select * into v_attempt from public.payment_attempts where reference = p_reference;
  if not found then
    raise exception 'Checkout session % not found', p_reference;
  end if;

  -- Record the delivery first: a duplicate must be provable even when the
  -- original already moved the money.
  if p_event_id is not null then
    insert into public.webhook_events (tenant_id, event_id, reference, event, payload)
    values (v_attempt.tenant_id, p_event_id, p_reference, p_event, p_payload)
    on conflict (event_id) do nothing
    returning id into v_event_pk;

    if v_event_pk is null then
      return jsonb_build_object('reference', p_reference, 'credited', false,
                                 'duplicate', true, 'status', v_attempt.status);
    end if;
  end if;

  if v_attempt.status = 'SUCCESS' then
    -- Paystack retried an event we already banked. Nothing is re-inserted, so
    -- the ledger cannot be paid twice with one transaction.
    update public.webhook_events set result = 'already confirmed' where id = v_event_pk;
    return jsonb_build_object('reference', p_reference, 'credited', false, 'duplicate', true,
                              'status', v_attempt.status, 'invoiceId', v_attempt.invoice_id);
  end if;
  if v_attempt.status in ('FAILED', 'EXPIRED') then
    -- Paystack sometimes retries a success event for a session the portal has
    -- already closed. Crediting it would put money in the ledger that nobody
    -- agreed to collect, so it waits for a human.
    update public.webhook_events set result = 'not credited, session ' || lower(v_attempt.status)
     where id = v_event_pk;
    return jsonb_build_object('reference', p_reference, 'credited', false,
                              'status', v_attempt.status,
                              'problem', 'The checkout session was already ' || lower(v_attempt.status));
  end if;

  select * into v_invoice from public.invoices where id = v_attempt.invoice_id;
  if not found then
    raise exception 'The invoice for checkout session % no longer exists', p_reference;
  end if;

  -- p_amount is the charged amount in naira (the caller converts Paystack's
  -- kobo figures). A session that was tampered with mid-checkout must not
  -- credit the cheaper invoice. Refusing is returned rather than raised so the
  -- delivery keeps its audit row and the caller can log the discrepancy.
  if p_amount is not null and p_amount <> v_attempt.amount then
    update public.payment_attempts
       set status = 'FAILED',
           paystack_tx_id = coalesce(p_paystack_tx_id, paystack_tx_id),
           failure_reason = 'Charged ' || to_char(p_amount, 'FM999,999,999,990.00') ||
                            ' against a session opened for ' ||
                            to_char(v_attempt.amount, 'FM999,999,999,990.00')
     where id = v_attempt.id;
    update public.webhook_events set result = 'not credited, amount mismatch' where id = v_event_pk;
    return jsonb_build_object('reference', p_reference, 'credited', false, 'status', 'FAILED',
                              'problem', 'The charged amount does not match the checkout session');
  end if;

  v_balance := round((v_invoice.total_amount - coalesce(v_invoice.paid_amount, 0))::numeric, 2);
  if v_attempt.amount > v_balance then
    -- The money was taken but the invoice no longer needs all of it, usually
    -- because an administrator recorded a bank payment in the meantime.
    update public.payment_attempts
       set paystack_tx_id = coalesce(p_paystack_tx_id, paystack_tx_id),
           failure_reason = 'Paid ' || v_attempt.amount::text || ' but only ' || v_balance::text || ' was outstanding'
     where id = v_attempt.id;
    update public.webhook_events set result = 'not credited, exceeds balance' where id = v_event_pk;
    return jsonb_build_object('reference', p_reference, 'credited', false,
                              'status', v_attempt.status,
                              'problem', 'The payment is larger than the remaining balance of ' ||
                                to_char(v_balance, 'FM999,999,999,990.00'));
  end if;

  -- The after-insert trigger apply_payment_to_invoice rolls paid_amount and
  -- status forward, so this is the single write the confirmation needs.
  insert into public.payments (
    tenant_id, invoice_id, student_id, amount, method, transaction_id, paid_at
  ) values (
    v_attempt.tenant_id, v_attempt.invoice_id, v_attempt.student_id,
    v_attempt.amount, 'CARD', p_paystack_tx_id, now()
  )
  returning * into v_payment;

  update public.payment_attempts
     set status = 'SUCCESS',
         paystack_tx_id = coalesce(p_paystack_tx_id, paystack_tx_id),
         failure_reason = null,
         confirmed_at = now()
   where id = v_attempt.id
  returning * into v_attempt;

  select paid_amount, status into v_paid, v_status from public.invoices where id = v_invoice.id;

  v_result := 'credited ' || to_char(v_payment.amount, 'FM999,999,999,990.00');
  update public.webhook_events set result = v_result,
         event = coalesce(p_event, event), payload = coalesce(p_payload, payload)
   where id = v_event_pk;

  insert into public.notifications (tenant_id, level, category, title, message, recipient_id)
  values (
    v_attempt.tenant_id, 'success', 'billing',
    'Payment received',
    'We have received ' ||
      to_char(v_payment.amount, 'FM999,999,999,990.00') || ' ' || v_attempt.currency ||
      ' against invoice ' || v_invoice.reference ||
      case when v_status = 'PAID' then '. That invoice is now fully paid.'
           else '. The remaining balance is ' ||
                to_char(v_invoice.total_amount - v_paid, 'FM999,999,999,990.00') || '.' end,
    v_attempt.student_id
  );

  return jsonb_build_object(
    'reference', v_attempt.reference,
    'status', v_attempt.status,
    'credited', true,
    'duplicate', false,
    'invoiceId', v_invoice.id,
    'invoiceReference', v_invoice.reference,
    'invoiceStatus', v_status,
    'paymentId', v_payment.id,
    'paidAmount', v_paid,
    'totalAmount', v_invoice.total_amount,
    'chargedAmount', v_payment.amount,
    'currency', v_attempt.currency,
    'email', v_attempt.email,
    'paidAt', v_payment.paid_at
  );
end;
$$;

create or replace function public.mark_payment_failed(
  p_reference text,
  p_reason    text    default null,
  p_event_id  text    default null,
  p_event     text    default null,
  p_payload   jsonb   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt  public.payment_attempts;
  v_event_pk uuid;
begin
  if auth.uid() is not null then
    raise exception 'Only the payment service can report a failed payment';
  end if;

  select * into v_attempt from public.payment_attempts where reference = p_reference;
  if not found then
    raise exception 'Checkout session % not found', p_reference;
  end if;

  if p_event_id is not null then
    insert into public.webhook_events (tenant_id, event_id, reference, event, payload)
    values (v_attempt.tenant_id, p_event_id, p_reference, p_event, p_payload)
    on conflict (event_id) do nothing
    returning id into v_event_pk;

    if v_event_pk is null then
      return jsonb_build_object('reference', p_reference, 'duplicate', true,
                                'status', v_attempt.status);
    end if;
  end if;

  -- A session already credited outranks a late failure event: the money is in
  -- the ledger and the audit trail must not claim otherwise.
  if v_attempt.status = 'SUCCESS' then
    update public.webhook_events set result = 'ignored, already confirmed' where id = v_event_pk;
    return jsonb_build_object('reference', p_reference, 'status', v_attempt.status,
                              'ignored', true);
  end if;

  update public.payment_attempts
     set status = 'FAILED', failure_reason = coalesce(nullif(btrim(p_reason), ''), 'The payment did not go through')
   where id = v_attempt.id
  returning * into v_attempt;

  update public.webhook_events set result = 'marked failed' where id = v_event_pk;

  insert into public.notifications (tenant_id, level, category, title, message, recipient_id)
  values (
    v_attempt.tenant_id, 'warning', 'billing',
    'Payment did not go through',
    'Your payment of ' ||
      to_char(v_attempt.amount, 'FM999,999,999,990.00') || ' ' || v_attempt.currency ||
      ' did not complete' ||
      case when nullif(btrim(coalesce(p_reason, '')), '') is not null
           then ': ' || rtrim(btrim(p_reason), '. ') else '' end ||
      '. Nothing has been charged — you can try again from your fees page.',
    v_attempt.student_id
  );

  return jsonb_build_object('reference', v_attempt.reference, 'status', v_attempt.status,
                            'failureReason', v_attempt.failure_reason);
end;
$$;

---------------------------------------------------------------------------
-- flag_overdue_invoices: the fee reminder
---------------------------------------------------------------------------
create or replace function public.flag_overdue_invoices()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_tenant  uuid := public.auth_tenant_id();
  v_count   integer := 0;
begin
  if v_tenant is null then
    raise exception 'No school is attached to this session';
  end if;
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an administrator can send fee reminders'
      using hint = 'Reminders go to the students who owe money.';
  end if;

  for v_invoice in
    select i.*
      from public.invoices i
     where i.tenant_id = v_tenant
       and i.status in ('ISSUED', 'PARTIAL')
       and i.due_date < now()
       and i.paid_amount < i.total_amount
       and (i.last_reminder_at is null or i.last_reminder_at < now() - interval '7 days')
     order by i.due_date
  loop
    insert into public.notifications (tenant_id, level, category, title, message, recipient_id)
    values (
      v_invoice.tenant_id, 'warning', 'billing',
      'Fee reminder: invoice overdue',
      'Invoice ' || v_invoice.reference || ' (' ||
        to_char(v_invoice.total_amount - v_invoice.paid_amount, 'FM999,999,999,990.00') ||
        ' outstanding) was due on ' || to_char(v_invoice.due_date, 'FMDD Mon YYYY') ||
        '. Pay it from your fees page to avoid any late charges.',
      v_invoice.student_id
    );

    update public.invoices set last_reminder_at = now() where id = v_invoice.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

---------------------------------------------------------------------------
-- Row Level Security. Both tables are read-only from the browser: every write
-- goes through the definer RPCs above, which run as the owner.
---------------------------------------------------------------------------
alter table public.payment_attempts enable row level security;
alter table public.webhook_events   enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.payment_attempts, public.webhook_events to authenticated;
-- 0003 hands select on every table in the schema to `anon`, and re-applying it
-- after this file would do so again. A checkout session and the webhook log are
-- not public data, so take it back here instead of relying on policy ordering.
revoke all on public.payment_attempts, public.webhook_events from anon;
-- Supabase's own default privileges give `authenticated` every table right on a
-- newly created table. RLS already refuses unlisted writes, but a ledger that is
-- append-only by design should not depend on a single policy list to stay that way.
revoke insert, update, delete, truncate, references, trigger
  on public.payment_attempts, public.webhook_events from authenticated;

drop policy if exists payment_attempts_read on public.payment_attempts;
create policy payment_attempts_read on public.payment_attempts
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.is_admin() or student_id = auth.uid())
  );

-- No insert, update or delete policy: a checkout session is created by
-- begin_payment and closed by the webhook, never by a client.

drop policy if exists webhook_events_read on public.webhook_events;
create policy webhook_events_read on public.webhook_events
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.is_admin());

-- Reminders and receipts are addressed to one student; tenant-wide notices
-- (recipient_id is null) keep the audience they always had, and admins retain
-- the bursar view of every notice their school sent.
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (recipient_id is null or recipient_id = auth.uid() or public.is_admin())
  );

---------------------------------------------------------------------------
-- Function grants
---------------------------------------------------------------------------
-- Supabase's default privileges hand EXECUTE on a new function to public, anon
-- and authenticated all at once, so `from public` alone would leave the two
-- server-side RPCs callable by anyone holding the publishable key. The functions
-- that a signed-in client is allowed to reach are granted again below.
revoke all on function public.mark_payment_started(text, text, text) from public, anon, authenticated;
revoke all on function public.confirm_payment_success(text, text, text, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.mark_payment_failed(text, text, text, text, jsonb) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mark_payment_started(text, text, text) to service_role;
    grant execute on function public.confirm_payment_success(text, text, text, text, numeric, jsonb) to service_role;
    grant execute on function public.mark_payment_failed(text, text, text, text, jsonb) to service_role;
  end if;
end
$$;

grant execute on function public.begin_payment(uuid, text, numeric) to authenticated;
grant execute on function public.flag_overdue_invoices() to authenticated;
-- Default privileges give EXECUTE to the PUBLIC pseudo-role, which every role
-- inherits, so taking it back from `anon` alone would change nothing: name
-- public here, and the signed-in roles are granted again above and below.
revoke all on function public.begin_payment(uuid, text, numeric) from public, anon;
revoke all on function public.flag_overdue_invoices() from public, anon;
