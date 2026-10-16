import type { ResultCourse, ResultSlip, Semester, Transcript } from './api.service';

/**
 * There is no PDF library in this bundle, and adding one for two documents is
 * not worth the weight. Both downloads render a print-quality sheet in an
 * off-screen iframe, so the browser's own "Save as PDF" produces the file - the
 * same output on every platform and nothing new to audit.
 */

const escape = (value: unknown): string =>
  String(value ?? '')
    .replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

// NUMERIC columns arrive from Postgres as strings, so both forms are accepted here.
const money = (value: number | string | null | undefined, digits = 2) =>
  value == null || value === '' || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(digits);

const day = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const PAGE_STYLE = `
  :root { color-scheme: light; }
  body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #12283f; margin: 0; padding: 28px; }
  .sheet { max-width: 820px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
           border-bottom: 3px solid #12355b; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: 0.4px; }
  h2 { font-size: 13px; margin: 0; text-transform: uppercase; letter-spacing: 1.2px; color: #4a6a80; }
  .muted { color: #5c7186; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin-bottom: 18px; }
  .field { font-size: 13px; }
  .field span { display: block; color: #5c7186; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #d7e0ea; font-size: 13px; }
  th { background: #eef3f8; text-transform: uppercase; font-size: 11px; letter-spacing: 0.6px; }
  td.numeric, th.numeric { text-align: right; }
  .summary { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
  .stat { flex: 1 1 150px; border: 1px solid #d7e0ea; border-radius: 8px; padding: 10px 12px; }
  .stat strong { display: block; font-size: 18px; }
  .stat span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #5c7186; }
  footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #d7e0ea; font-size: 11px; color: #5c7186; }

  /* CR80 is 85.6 x 54 mm; the sheet prints one card centred on the page so it can
     be cut and laminated without a template. */
  .idcard { width: 85.6mm; height: 54mm; border: 1px solid #b9c8d6; border-radius: 2.5mm;
            padding: 2.5mm 3mm; box-sizing: border-box; display: flex; flex-direction: column;
            margin: 0 auto; background: #fff; }
  .idcard-head { display: flex; justify-content: space-between; align-items: baseline;
                 border-bottom: 1.5pt solid #12355b; padding-bottom: 1mm; margin-bottom: 1.5mm; }
  .idcard-head h1 { font-size: 11pt; margin: 0; letter-spacing: 0.2px; }
  .idcard-head h2 { font-size: 7.5pt; margin: 0; }
  .idcard-body { display: flex; gap: 3mm; flex: 1; min-height: 0; }
  .idcard-photo { width: 16mm; height: 20mm; object-fit: cover; border: 1px solid #d7e0ea;
                  background: #eef3f8; display: block; }
  .idcard-photo-empty { width: 16mm; height: 20mm; border: 1px dashed #b9c8d6; display: flex;
                        align-items: center; justify-content: center; color: #7c93a6; font-size: 14pt; }
  .idcard-fields { flex: 1; min-width: 0; font-size: 8pt; }
  .idcard-fields .field { margin-bottom: 0.6mm; }
  .idcard-fields .field span { font-size: 6pt; }
  .idcard-name { font-size: 10.5pt; font-weight: 700; margin-bottom: 1mm; }
  .idcard-foot { display: flex; justify-content: space-between; align-items: center;
                 font-size: 7pt; color: #5c7186; border-top: 1px solid #d7e0ea; padding-top: 1mm; }
  .idcard-code { font-family: 'Courier New', monospace; font-size: 9pt; font-weight: 700; letter-spacing: 1pt; color: #12283f; }
  .idcard.revoked { border-color: #b3261e; }
  .idcard.revoked .idcard-name { color: #b3261e; }
  @page { margin: 16mm; }
`;

const courseRows = (courses: ResultCourse[]) =>
  courses
    .map(
      (course) => `<tr>
        <td>${escape(course.code)}</td>
        <td>${escape(course.title)}</td>
        <td>${escape(course.period)}</td>
        <td class="numeric">${escape(course.creditUnits)}</td>
        <td class="numeric">${money(course.score, 1)}</td>
        <td>${escape(course.letterGrade)}</td>
        <td class="numeric">${money(course.gradePoints)}</td>
      </tr>`,
    )
    .join('');

const TABLE_HEAD = `<thead><tr>
  <th>Code</th><th>Course</th><th>Assessment</th>
  <th class="numeric">Units</th><th class="numeric">Score</th><th>Grade</th><th class="numeric">Points</th>
</tr></thead>`;

const EMPTY_COURSES = `<tbody><tr><td colspan="7">No published results for this semester yet.</td></tr></tbody>`;

function printHtml(title: string, body: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error('Printing is blocked in this browser.');
  }

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`);
  doc.close();

  const run = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Removing the frame too early cancels the dialog in Safari and Firefox.
    window.setTimeout(() => frame.remove(), 2000);
  };
  if (frame.contentWindow?.document.readyState === 'complete') run();
  else frame.onload = run;
}

export interface SlipStudent {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export const documentService = {
  printResultSlip(options: {
    student: SlipStudent;
    semester: Semester | Record<string, any> | null;
    slip: ResultSlip;
    issuedAt?: Date;
  }) {
    const { student, slip } = options;
    const semester: Record<string, any> = (options.semester ?? {}) as Record<string, any>;
    const session: Record<string, any> = (slip.session ?? {}) as Record<string, any>;
    const name = `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Registered student';

    printHtml(
      `Result slip - ${name}`,
      `<div class="sheet">
        <header>
          <div>
            <h1>Pinnacle University</h1>
            <div class="muted">Where Ambition Meets Achievement</div>
          </div>
          <div style="text-align: right">
            <h2>Result Slip</h2>
            <div class="muted">${escape(session.name ?? '')}${session.name ? ' · ' : ''}${escape(semester.name ?? '')}</div>
          </div>
        </header>
        <div class="grid">
          <div class="field"><span>Student</span>${escape(name)}</div>
          <div class="field"><span>Email</span>${escape(student.email ?? '')}</div>
          <div class="field"><span>Semester window</span>${day(semester.start_date ?? semester.startDate)} to ${day(semester.end_date ?? semester.endDate)}</div>
          <div class="field"><span>Issued</span>${day((options.issuedAt ?? new Date()).toISOString())}</div>
        </div>
        <div class="summary">
          <div class="stat"><span>Semester GPA</span><strong>${money(slip.gpa)}</strong></div>
          <div class="stat"><span>Credit units</span><strong>${escape(slip.creditUnits ?? 0)}</strong></div>
          <div class="stat"><span>Results published</span><strong>${escape(slip.gradeCount)}</strong></div>
        </div>
        <table>
          ${TABLE_HEAD}
          <tbody>${slip.courses.length ? courseRows(slip.courses) : ''}</tbody>
          ${slip.courses.length ? '' : EMPTY_COURSES}
        </table>
        <footer>This slip is only valid once the results appear on the student portal. Generated ${new Date().toLocaleString()}.</footer>
      </div>`,
    );
  },

  printReceipt(options: {
    student: SlipStudent & { matricNumber?: string | null };
    invoice: {
      reference?: string | null;
      status?: string | null;
      dueDate?: string | null;
      totalAmount?: number | string | null;
      paidAmount?: number | string | null;
      lines?: Array<{ description?: string | null; amount?: number | string | null }>;
      payments?: Array<{ amount?: number | string | null; method?: string | null; paidAt?: string | null; transactionId?: string | null }>;
    };
  }) {
    const { student, invoice } = options;
    const name = `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Registered student';
    const total = Number(invoice.totalAmount ?? 0);
    const paid = Number(invoice.paidAmount ?? 0);

    const lineRows = (invoice.lines ?? [])
      .map((line) => `<tr><td>${escape(line.description)}</td><td class="numeric">${money(line.amount)}</td></tr>`)
      .join('');

    const paymentRows = (invoice.payments ?? [])
      .map(
        (payment) => `<tr>
          <td>${day(payment.paidAt)}</td>
          <td>${escape(payment.method)}</td>
          <td>${escape(payment.transactionId ?? '')}</td>
          <td class="numeric">${money(payment.amount)}</td>
        </tr>`,
      )
      .join('');

    printHtml(
      `Receipt - ${invoice.reference ?? name}`,
      `<div class="sheet">
        <header>
          <div>
            <h1>Pinnacle University</h1>
            <div class="muted">Where Ambition Meets Achievement</div>
          </div>
          <div style="text-align: right">
            <h2>Fee Receipt</h2>
            <div class="muted">${escape(invoice.reference ?? '')}</div>
          </div>
        </header>
        <div class="grid">
          <div class="field"><span>Student</span>${escape(name)}</div>
          <div class="field"><span>Matric number</span>${escape(student.matricNumber ?? 'Not yet issued')}</div>
          <div class="field"><span>Email</span>${escape(student.email ?? '')}</div>
          <div class="field"><span>Due date</span>${day(invoice.dueDate)}</div>
        </div>
        <table>
          <thead><tr><th>Charge</th><th class="numeric">Amount (₦)</th></tr></thead>
          <tbody>${lineRows || '<tr><td colspan="2">No line items on this invoice.</td></tr>'}</tbody>
        </table>
        <table>
          <thead><tr><th>Paid on</th><th>Method</th><th>Reference</th><th class="numeric">Amount (₦)</th></tr></thead>
          <tbody>${paymentRows || '<tr><td colspan="4">Nothing has been received against this invoice.</td></tr>'}</tbody>
        </table>
        <div class="summary">
          <div class="stat"><span>Invoice total</span><strong>${money(total)}</strong></div>
          <div class="stat"><span>Received</span><strong>${money(paid)}</strong></div>
          <div class="stat"><span>Balance</span><strong>${money(Math.max(total - paid, 0))}</strong></div>
        </div>
        <footer>
          This receipt lists what the portal has recorded as received. Card payments appear here once
          Paystack confirms them. Generated ${new Date().toLocaleString()}.
        </footer>
      </div>`,
    );
  },

  printTranscript(transcript: Transcript) {
    const student = (transcript.student ?? {}) as Record<string, any>;
    const name = `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Registered student';
    const department = student.department?.name ?? '';
    const faculty = student.faculty?.name ?? '';

    const semesters = (transcript.semesters ?? [])
      .map(
        (row) => `<tr>
          <td colspan="4" style="background:#f7fafc;font-weight:600">${escape(row.semester)} · ${escape(row.session)}</td>
          <td class="numeric">${escape(row.creditUnits ?? 0)}</td>
          <td colspan="2"></td>
          <td class="numeric">${money(row.gpa)}</td>
        </tr>
        ${courseRows(row.courses)}`,
      )
      .join('');

    printHtml(
      `Academic transcript - ${name}`,
      `<div class="sheet">
        <header>
          <div>
            <h1>Pinnacle University</h1>
            <div class="muted">Where Ambition Meets Achievement</div>
          </div>
          <div style="text-align: right">
            <h2>Academic Transcript</h2>
            <div class="muted">${new Date().toLocaleDateString()}</div>
          </div>
        </header>
        <div class="grid">
          <div class="field"><span>Student</span>${escape(name)}</div>
          <div class="field"><span>Email</span>${escape(student.email ?? '')}</div>
          <div class="field"><span>Faculty</span>${escape(faculty)}</div>
          <div class="field"><span>Department</span>${escape(department)}</div>
          <div class="field"><span>Level</span>${escape(student.level ?? '')}</div>
          <div class="field"><span>Admitted</span>${escape(student.admittedYear ?? '')}</div>
        </div>
        <div class="summary">
          <div class="stat"><span>CGPA</span><strong>${money(transcript.cgpa)}</strong></div>
          <div class="stat"><span>Class of degree</span><strong style="font-size:14px">${escape(transcript.classOfDegree)}</strong></div>
          <div class="stat"><span>Credit units earned</span><strong>${escape(transcript.totalCreditUnits)}</strong></div>
        </div>
        <table>
          ${TABLE_HEAD}
          <tbody>${semesters || '<tr><td colspan="7">No published results yet.</td></tr>'}</tbody>
        </table>
        <footer>Grades are weighted by credit units on the school's published 5.0 scale. Generated ${new Date().toLocaleString()}.</footer>
      </div>`,
    );
  },

  printIdCard(options: {
    school: string;
    holder: Record<string, any>;
    card: Record<string, any> | null;
    photoUrl?: string | null;
  }) {
    const { holder, card } = options;
    const name = `${holder.firstName ?? ''} ${holder.lastName ?? ''}`.trim() || 'Registered student';
    const department = holder.department ?? '';
    const faculty = holder.faculty ?? '';
    const withdrawn = card?.status === 'REVOKED';
    const initials = name
      .split(/\s+/)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();

    printHtml(
      `Student ID card - ${name}`,
      `<div class="sheet">
        <div class="idcard${withdrawn ? ' revoked' : ''}">
          <div class="idcard-head">
            <h1>${escape(options.school || 'Pinnacle University')}</h1>
            <h2>${withdrawn ? 'Withdrawn card' : 'Student'}</h2>
          </div>
          <div class="idcard-body">
            ${card?.photoPath && options.photoUrl
              ? `<img class="idcard-photo" src="${escape(options.photoUrl)}" alt="">`
              : `<div class="idcard-photo-empty">${escape(initials)}</div>`}
            <div class="idcard-fields">
              <div class="idcard-name">${escape(name)}</div>
              <div class="field"><span>Matric no.</span>${escape(holder.matricNumber ?? 'Not yet issued')}</div>
              <div class="field"><span>Department</span>${escape(department)}</div>
              <div class="field"><span>Faculty</span>${escape(faculty)}</div>
              <div class="field"><span>Level</span>${escape(holder.level ?? '')}</div>
            </div>
          </div>
          <div class="idcard-foot">
            <span>${card ? `Valid till ${day(card.validUntil)}` : 'No card issued yet'}</span>
            <span class="idcard-code">${escape(card?.verificationCode ?? '')}</span>
          </div>
        </div>
        <footer>${card
          ? `Cut on the dotted line. The eight-character number is what the gate reads; it is checked against this school's records. Generated ${new Date().toLocaleString()}.`
          : `This sheet is a placeholder: the school has not issued a card to ${escape(name)} yet. Generated ${new Date().toLocaleString()}.`}</footer>
      </div>`,
    );
  },
};
