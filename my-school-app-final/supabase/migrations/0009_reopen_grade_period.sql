-- Reopening a grade book. review_grade_period() only reaches SUBMITTED work, so
-- an approved or published book used to be frozen for good: a score typed after
-- publication could never be corrected. The status guard in 0008 already lets an
-- administrator move a book back to DRAFT, so this exposes that path.

create or replace function public.reopen_grade_period(p_grade_period_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.grade_periods;
  v_count  integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can reopen a grade book'
      using hint = 'Ask the school office to return the results to draft.';
  end if;

  select * into v_period from public.grade_periods where id = p_grade_period_id;
  if not found or v_period.tenant_id is distinct from public.auth_tenant_id() then
    raise exception 'Grade period not found';
  end if;

  update public.grade_entries
     set status          = 'DRAFT',
         submitted_at    = null, submitted_by_id = null,
         approved_at     = null, approved_by_id  = null,
         published_at    = null, published_by_id = null
   where grade_period_id = v_period.id and status <> 'DRAFT';
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'Nothing needs to be reopened in %', v_period.name;
  end if;

  return v_count;
end;
$$;

grant execute on function public.reopen_grade_period(uuid) to authenticated;
