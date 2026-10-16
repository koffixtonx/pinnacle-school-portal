import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import BadgeIcon from '@mui/icons-material/Badge';
import SearchIcon from '@mui/icons-material/Search';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import { adminService, idCardService } from '../services/api.service';
import type { IdCard } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';
import { documentService } from '../services/pdf';

const day = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** The three lines the printed card needs, from whichever row shape is at hand. */
const printFields = (holder: Record<string, any>) => ({
  firstName: holder.firstName,
  lastName: holder.lastName,
  matricNumber: holder.matricNumber ?? holder.matric_number,
  level: holder.level ?? holder.studentLevel,
  department: holder.department?.name ?? holder.department ?? '',
  faculty: holder.department?.faculty?.name ?? holder.faculty ?? '',
});

const StudentCard: React.FC<{
  school: string;
  holder: Record<string, any>;
  card: IdCard | null;
  photoUrl?: string | null;
}> = ({ school, holder, card, photoUrl }) => {
  const fields = printFields(holder);
  const name = `${fields.firstName ?? ''} ${fields.lastName ?? ''}`.trim() || 'Registered student';
  const initials = name.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();
  const revoked = card?.status === 'REVOKED';

  return (
    <Box
      sx={{
        width: { xs: '100%', sm: 340 },
        maxWidth: 340,
        border: '1px solid',
        borderColor: revoked ? 'error.main' : 'divider',
        borderRadius: 2,
        p: 1.5,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'baseline', borderBottom: '2px solid', borderColor: 'primary.main', pb: 0.5 }}>
        <Typography variant="overline" sx={{ fontWeight: 800, flexGrow: 1, minWidth: 0, letterSpacing: 0.5 }}>
          {school || 'Pinnacle University'}
        </Typography>
        <Typography variant="caption" color={revoked ? 'error' : 'text.secondary'} sx={{ fontWeight: 700 }}>
          {revoked ? 'Withdrawn' : 'Student'}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
        {card?.photoPath && photoUrl ? (
          <Box component="img" src={photoUrl} alt="" sx={{ width: 60, height: 76, objectFit: 'cover', border: '1px solid', borderColor: 'divider' }} />
        ) : (
          <Box
            sx={{
              width: 60,
              height: 76,
              border: '1px dashed',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.disabled',
            }}
          >
            {initials}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: revoked ? 'error.main' : 'text.primary' }}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {fields.matricNumber || 'Matric number not yet issued'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {fields.department}
            {fields.faculty ? ` · ${fields.faculty}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {card ? `Level ${fields.level ?? '—'} · ${card.sessionLabel}` : 'No card issued yet'}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" sx={{ alignItems: 'center', mt: 1, pt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          {card ? `Valid till ${day(card.validUntil)}` : 'No card issued yet'}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography sx={{ fontFamily: 'monospace', fontWeight: 800, letterSpacing: 2 }}>
          {card?.verificationCode ?? ''}
        </Typography>
      </Stack>
    </Box>
  );
};

const IdCardPage: React.FC = () => {
  const currentUser = useCurrentUser();
  const canManage = isAdminRole(currentUser?.role);
  const isHolder = currentUser?.role === 'STUDENT' || currentUser?.role === 'NON_ACADEMIC_STAFF';

  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const [payload, setPayload] = React.useState<{ holder: Record<string, any>; card: IdCard | null; session: { label: string; endsAt: string } | null } | null>(null);
  const [history, setHistory] = React.useState<IdCard[]>([]);
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null);

  const [students, setStudents] = React.useState<any[]>([]);
  const [register, setRegister] = React.useState<Array<IdCard & { student?: Record<string, any> | null; tenant?: { name?: string } | null }>>([]);
  const [tab, setTab] = React.useState(0);

  const [form, setForm] = React.useState<{ studentId: string; photo: File | null; validUntil: string; sessionLabel: string }>({
    studentId: '',
    photo: null,
    validUntil: '',
    sessionLabel: '',
  });
  const [code, setCode] = React.useState('');
  const [verified, setVerified] = React.useState<Record<string, any> | null>(null);
  const [withdrawing, setWithdrawing] = React.useState<IdCard | null>(null);
  const [reason, setReason] = React.useState('');

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const loadPhoto = React.useCallback(async (card: IdCard | null) => {
    if (!card?.photoPath) {
      setPhotoUrl(null);
      return;
    }
    try {
      const response = await idCardService.downloadPhoto(card.photoPath);
      setPhotoUrl(response.data.data);
    } catch {
      // A card without its photo still prints; the number underneath it is what matters.
      setPhotoUrl(null);
    }
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (isHolder) {
        const [print, mine] = await Promise.all([idCardService.printData(), idCardService.mine()]);
        setPayload(print.data.data);
        setHistory(mine.data.data.history);
        await loadPhoto(mine.data.data.current);
      }
      if (canManage) {
        const [people, cards] = await Promise.all([
          adminService.listStudents({ limit: 100 }),
          idCardService.forSchool(),
        ]);
        setStudents(people.data.data);
        setRegister(cards.data.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'The ID card page could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [canManage, isHolder, loadPhoto]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const print = async (holder: Record<string, any>, card: IdCard | null, school: string) => {
    setError('');
    let url: string | null = null;
    if (card?.photoPath) {
      try {
        const response = await idCardService.downloadPhoto(card.photoPath);
        url = response.data.data;
        await new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = url!;
        });
      } catch {
        url = null;
      }
    }
    documentService.printIdCard({ school, holder: printFields(holder), card: card as unknown as Record<string, any>, photoUrl: url });
  };

  const issue = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await idCardService.issue({
        studentId: form.studentId,
        photo: form.photo,
        validUntil: form.validUntil || null,
        sessionLabel: form.sessionLabel,
      });
      setForm({ studentId: '', photo: null, validUntil: '', sessionLabel: '' });
      flash(`Card ${response.data.data.verificationCode} has been issued. The student is told it is ready.`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The ID card could not be issued.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!withdrawing) return;
    setBusy(true);
    setError('');
    try {
      await idCardService.revoke(withdrawing.id, reason);
      setWithdrawing(null);
      setReason('');
      flash('The card has been withdrawn and the student told.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The card could not be withdrawn.');
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setError('');
    setVerified(null);
    try {
      const response = await idCardService.verify(code);
      setVerified(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'That card number could not be checked.');
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
        Student ID card
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {canManage
          ? 'Issue cards, keep the register, and check a number at the gate.'
          : 'This is the card the school issued you. Print it, or check it at the gate.'}
      </Typography>
    </Box>
  );

  return (
    <Box>
      {header}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      {!loading && !canManage && !isHolder && (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              ID cards belong to students and to the office that issues them, so there is nothing to show on this
              account.
            </Typography>
          </CardContent>
        </Card>
      )}

      {!loading && isHolder && !canManage && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            {payload?.card ? (
              <Stack spacing={2}>
                <StudentCard
                  school={payload.holder?.tenant?.name ?? ''}
                  holder={payload.holder}
                  card={payload.card}
                  photoUrl={photoUrl}
                />
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    startIcon={<PrintIcon />}
                    onClick={() => void print(payload.holder, payload.card, payload.holder?.tenant?.name ?? '')}
                  >
                    Print my card
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    Prints one card to a page at the standard 85.6 × 54 mm size. Choose &ldquo;Save as PDF&rdquo; for a
                    digital copy.
                  </Typography>
                </Stack>
                {payload.session && (
                  <Typography variant="caption" color="text.secondary">
                    Current session {payload.session.label}, running to {day(payload.session.endsAt)}.
                  </Typography>
                )}
                {history.length > 1 && (
                  <>
                    <Divider />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Earlier cards
                    </Typography>
                    {history.slice(1).map((card) => (
                      <Typography key={card.id} variant="caption" color="text.secondary">
                        {card.verificationCode} · issued {day(card.issuedAt)}
                        {card.revokedAt ? ` · withdrawn ${day(card.revokedAt)}` : ''}
                      </Typography>
                    ))}
                  </>
                )}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                The office has not issued you a card yet. Once they do, it appears here and you are told.
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && canManage && (
        <Card>
          <CardContent>
            <Tabs value={tab} onChange={(_event, value) => setTab(value)} sx={{ mb: 2 }}>
              <Tab label="Issue a card" />
              <Tab label={`Register (${register.length})`} />
              <Tab label="Check a number" />
            </Tabs>

            {tab === 0 && (
              <Stack spacing={2}>
                {!students.length ? (
                  <Typography variant="body2" color="text.secondary">
                    There are no students on the register yet.
                  </Typography>
                ) : (
                  <>
                    <TextField
                      select
                      label="Student"
                      value={form.studentId}
                      onChange={(event) => setForm({ ...form, studentId: event.target.value })}
                      helperText="A card needs an active student. Probation is fine; a withdrawn account is not."
                    >
                      {students.map((student) => (
                        <MenuItem key={student.id} value={student.id}>
                          {student.firstName} {student.lastName}
                          {student.matricNumber ? ` — ${student.matricNumber}` : ' — no matric number yet'}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button variant="outlined" component="label" startIcon={<PhotoCameraIcon />} sx={{ alignSelf: 'flex-start' }}>
                      {form.photo ? form.photo.name : 'Attach a passport photo (optional)'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        hidden
                        onChange={(event) => setForm({ ...form, photo: event.target.files?.[0] ?? null })}
                      />
                    </Button>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField
                        type="date"
                        label="Valid until"
                        value={form.validUntil}
                        onChange={(event) => setForm({ ...form, validUntil: event.target.value })}
                        slotProps={{ inputLabel: { shrink: true } }}
                        helperText="Leave empty for the current session."
                      />
                      <TextField
                        label="Session on the card"
                        value={form.sessionLabel}
                        onChange={(event) => setForm({ ...form, sessionLabel: event.target.value })}
                        helperText="Leave empty to use the active academic session."
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Issuing a card withdraws any card this student already holds, so only one is ever live. Photos
                      are limited to 5 MB and are stored privately.
                    </Typography>
                    <Button
                      variant="contained"
                      startIcon={<BadgeIcon />}
                      disabled={!form.studentId || busy}
                      onClick={() => void issue()}
                    >
                      {busy ? 'Issuing…' : 'Issue card'}
                    </Button>
                  </>
                )}
              </Stack>
            )}

            {tab === 1 && (
              <Stack spacing={1.5}>
                {!register.length && (
                  <Typography variant="body2" color="text.secondary">
                    No card has been issued by this school yet.
                  </Typography>
                )}
                {register.map((card) => (
                  <Card key={card.id} variant="outlined">
                    <CardContent>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <Box sx={{ flexGrow: 1, minWidth: 160 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {card.student?.firstName} {card.student?.lastName}
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                              {card.student?.matricNumber ?? 'no matric number'}
                            </Typography>
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {card.sessionLabel} · {day(card.validFrom)} to {day(card.validUntil)} ·{' '}
                            {new Date(card.validUntil) < new Date() ? 'expired' : 'in date'}
                          </Typography>
                        </Box>
                        <Chip
                          size="small"
                          color={card.status === 'ISSUED' ? 'success' : 'error'}
                          label={card.status === 'ISSUED' ? 'Live' : 'Withdrawn'}
                        />
                        <Typography sx={{ fontFamily: 'monospace', fontWeight: 800 }}>{card.verificationCode}</Typography>
                      </Stack>
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <Button
                          size="small"
                          startIcon={<PrintIcon />}
                          onClick={() => void print(card.student ?? {}, card, card.tenant?.name ?? '')}
                        >
                          Print
                        </Button>
                        {card.status === 'ISSUED' && (
                          <Button size="small" color="error" onClick={() => setWithdrawing(card)}>
                            Withdraw
                          </Button>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}

            {tab === 2 && (
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Type the eight characters printed under the holder&rsquo;s name. The answer comes from the database,
                  so a photographed card cannot pass.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-end' } }}>
                  <TextField
                    label="Card number"
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    slotProps={{ htmlInput: { maxLength: 8 } }}
                    sx={{ fontFamily: 'monospace' }}
                  />
                  <Button variant="contained" startIcon={<SearchIcon />} disabled={code.length < 8 || busy} onClick={() => void check()}>
                    Check
                  </Button>
                </Stack>
                {verified && (
                  <Card variant="outlined">
                    <CardContent>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, flexGrow: 1 }}>
                          {verified.holder?.firstName} {verified.holder?.lastName}
                        </Typography>
                        <Chip
                          size="small"
                          color={verified.status === 'ISSUED' && !verified.isExpired ? 'success' : 'error'}
                          label={verified.status === 'ISSUED' ? (verified.isExpired ? 'Expired' : 'Valid') : 'Withdrawn'}
                        />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {verified.holder?.matricNumber ?? 'No matric number'} · {verified.holder?.department ?? 'No department'} ·{' '}
                        level {verified.holder?.level ?? '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {verified.school?.name} · {verified.sessionLabel} · {day(verified.validFrom)} to{' '}
                        {day(verified.validUntil)}
                        {verified.school?.issuedByName ? ` · issued by ${verified.school.issuedByName}` : ''}
                        {verified.revokedAt ? ` · withdrawn ${day(verified.revokedAt)}` : ''}
                      </Typography>
                    </CardContent>
                  </Card>
                )}
              </Stack>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(withdrawing)} onClose={() => setWithdrawing(null)} fullWidth maxWidth="xs">
        <DialogTitle>Withdraw this card?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {withdrawing?.verificationCode} stops working at the gate straight away, and the student is told.
            </Typography>
            <TextField
              label="Reason for the record"
              multiline
              minRows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWithdrawing(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => void withdraw()}>
            {busy ? 'Withdrawing…' : 'Withdraw'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default IdCardPage;
