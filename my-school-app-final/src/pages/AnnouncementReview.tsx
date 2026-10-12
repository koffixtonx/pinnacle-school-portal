import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { announcementService } from '../services/api.service';
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementStatus,
  DeliverySummary,
} from '../services/api.service';

const AUDIENCES: AnnouncementAudience[] = ['ALL', 'STUDENTS', 'TEACHERS', 'PARENTS', 'STAFF'];
const STATUSES: Array<AnnouncementStatus | ''> = ['', 'DRAFT', 'PUBLISHED'];

const audienceLabel: Record<AnnouncementAudience, string> = {
  ALL: 'Everyone in the school',
  STUDENTS: 'Students',
  TEACHERS: 'Teachers',
  PARENTS: 'Parents',
  STAFF: 'Staff (teachers and office)',
};

const formatDay = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** datetime-local wants a wall-clock string; the database wants an instant. */
const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

const emptyDraft = {
  title: '',
  body: '',
  audience: 'ALL' as AnnouncementAudience,
  pinned: false,
  expiresAt: '',
};

const AnnouncementReview: React.FC = () => {
  const [items, setItems] = React.useState<Announcement[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<AnnouncementStatus | ''>('');
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [editor, setEditor] = React.useState<{ id: string | null } & typeof emptyDraft | null>(null);
  const [publishTarget, setPublishTarget] = React.useState<Announcement | null>(null);
  const [sendEmail, setSendEmail] = React.useState(false);
  const [audienceCount, setAudienceCount] = React.useState<number | null>(null);
  const [report, setReport] = React.useState<{ announcement: Announcement; summary: DeliverySummary } | null>(null);

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 5000);
  };

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await announcementService.listForSchool({ status: statusFilter });
      setItems(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'The announcements could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  React.useEffect(() => {
    load();
  }, [load]);

  const openEditor = (announcement?: Announcement) => {
    setEditor({
      id: announcement?.id ?? null,
      title: announcement?.title ?? emptyDraft.title,
      body: announcement?.body ?? emptyDraft.body,
      audience: announcement?.audience ?? emptyDraft.audience,
      pinned: announcement?.pinned ?? false,
      expiresAt: toLocalInput(announcement?.expiresAt),
    });
  };

  const saveDraft = async () => {
    if (!editor) return;
    try {
      setBusy(true);
      setError('');
      const payload = {
        title: editor.title,
        body: editor.body,
        audience: editor.audience,
        pinned: editor.pinned,
        expiresAt: fromLocalInput(editor.expiresAt),
      };
      if (editor.id) await announcementService.edit(editor.id, payload);
      else await announcementService.compose(payload);
      setEditor(null);
      showSuccess(editor.id ? 'The draft is saved.' : 'The draft is written. Publish it when you are ready.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The notice could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const openPublish = async (announcement: Announcement) => {
    setPublishTarget(announcement);
    setSendEmail(false);
    setAudienceCount(null);
    try {
      const response = await announcementService.recipients(announcement.id);
      setAudienceCount(response.data.data.length);
    } catch (err: any) {
      setError(err.response?.data?.message || 'The audience could not be counted.');
      setAudienceCount(0);
    }
  };

  const confirmPublish = async () => {
    if (!publishTarget) return;
    try {
      setBusy(true);
      setError('');
      const response = await announcementService.publish(publishTarget.id, sendEmail);
      const result = response.data.data;
      showSuccess(
        `Sent to ${result.notified} ${result.notified === 1 ? 'person' : 'people'}.`
        + (result.emailsQueued ? ` ${result.emailsQueued} message(s) queued for delivery.` : ' No emails were queued.')
      );
      setPublishTarget(null);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The announcement could not be published.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (announcement: Announcement) => {
    try {
      setBusy(true);
      setError('');
      await announcementService.withdraw(announcement.id);
      showSuccess('The notice is back on the draft shelf. Nobody outside the office can read it.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The notice could not be withdrawn.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (announcement: Announcement) => {
    if (!window.confirm(`Delete “${announcement.title}”? Its read receipts and mail log go with it.`)) return;
    try {
      setBusy(true);
      setError('');
      await announcementService.remove(announcement.id);
      showSuccess('The notice has been deleted.');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'The notice could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const openReport = async (announcement: Announcement) => {
    try {
      setBusy(true);
      setError('');
      const response = await announcementService.deliverySummary(announcement.id);
      setReport({ announcement, summary: response.data.data });
    } catch (err: any) {
      setError(err.response?.data?.message || 'The delivery report could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const draft = !!editor && !editor.id;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Announcements
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Write a notice, choose who reads it, then publish. Publishing sends it to the portal bell, and by email too if you ask.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          select
          label="Status"
          size="small"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AnnouncementStatus | '')}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          {STATUSES.filter(Boolean).map((status) => (
            <MenuItem key={status} value={status}>{status}</MenuItem>
          ))}
        </TextField>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" onClick={() => openEditor()}>
          New notice
        </Button>
      </Stack>

      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Audience</TableCell>
                <TableCell>Status</TableCell>
                {/* The two dates are the least actionable columns, and dropping
                    them at xs is what keeps Actions on screen without a
                    horizontal scroll. */}
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Published</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Expires</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((announcement) => (
                <TableRow key={announcement.id} hover>
                  <TableCell sx={{ maxWidth: 300 }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {announcement.title}
                      </Typography>
                      {announcement.pinned && <Chip size="small" variant="outlined" label="Pinned" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {announcement.body.length > 90 ? `${announcement.body.slice(0, 90)}…` : announcement.body}
                    </Typography>
                  </TableCell>
                  <TableCell>{audienceLabel[announcement.audience]}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={announcement.status === 'PUBLISHED' ? 'success' : 'default'}
                      label={announcement.status}
                    />
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{formatDay(announcement.publishedAt)}</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    {announcement.expiresAt ? formatDay(announcement.expiresAt) : '—'}
                    {announcement.expiresAt && new Date(announcement.expiresAt) < new Date() && announcement.status === 'PUBLISHED' && (
                      <Chip size="small" sx={{ ml: 0.5 }} label="past" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {announcement.status === 'DRAFT' ? (
                        <>
                          <Button size="small" onClick={() => openEditor(announcement)}>Edit</Button>
                          <Button size="small" variant="contained" onClick={() => void openPublish(announcement)}>
                            Publish
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="small" onClick={() => void openReport(announcement)}>Report</Button>
                          <Button size="small" onClick={() => void withdraw(announcement)}>Withdraw</Button>
                        </>
                      )}
                      <Button size="small" color="error" onClick={() => void remove(announcement)}>
                        Delete
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary">
                      Nothing here yet. Write the first notice and it will reach the people you choose.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={!!editor} onClose={() => setEditor(null)} fullWidth maxWidth="sm">
        <DialogTitle>{draft ? 'New notice' : 'Edit notice'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Title"
            fullWidth
            margin="normal"
            value={editor?.title ?? ''}
            onChange={(e) => setEditor((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
            helperText="Families see this in their bell and in the email subject."
          />
          <TextField
            label="Message"
            fullWidth
            margin="normal"
            multiline
            rows={6}
            value={editor?.body ?? ''}
            onChange={(e) => setEditor((prev) => (prev ? { ...prev, body: e.target.value } : prev))}
            helperText="Leave a blank line between paragraphs; the bell shows only the first one."
          />
          <TextField
            select
            label="Who reads it"
            fullWidth
            margin="normal"
            value={editor?.audience ?? 'ALL'}
            onChange={(e) => setEditor((prev) => (prev ? { ...prev, audience: e.target.value as AnnouncementAudience } : prev))}
          >
            {AUDIENCES.map((audience) => (
              <MenuItem key={audience} value={audience}>{audienceLabel[audience]}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Stops showing after"
            fullWidth
            margin="normal"
            type="datetime-local"
            slotProps={{ inputLabel: { shrink: true } }}
            value={editor?.expiresAt ?? ''}
            onChange={(e) => setEditor((prev) => (prev ? { ...prev, expiresAt: e.target.value } : prev))}
            helperText="Optional. A notice past its expiry disappears from the portal by itself."
          />
          <FormControlLabel
            control={
              <Switch
                checked={editor?.pinned ?? false}
                onChange={(e) => setEditor((prev) => (prev ? { ...prev, pinned: e.target.checked } : prev))}
              />
            }
            label="Keep it at the top of the list"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveDraft} disabled={busy}>
            Save draft
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!publishTarget} onClose={() => setPublishTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Publish notice</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {publishTarget?.title}
          </Typography>
          <Typography variant="body2">
            {audienceCount === null
              ? 'Counting the audience…'
              : audienceCount === 0
                ? 'Nobody in your school matches this audience yet. Publishing would send it to no one.'
                : `This will reach ${audienceCount} ${audienceCount === 1 ? 'person' : 'people'}.`}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <FormControlLabel
            control={<Switch checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />}
            label="Also send it by email"
          />
          <Typography variant="caption" color="text.secondary" component="div">
            Emails go out from the delivery worker, not from this screen, so they may arrive a little after the notice does.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPublishTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={confirmPublish} disabled={busy || audienceCount === 0}>
            Publish now
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!report} onClose={() => setReport(null)} fullWidth maxWidth="xs">
        <DialogTitle>Delivery report</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {report?.announcement.title}
          </Typography>
          <Typography variant="body2">
            {report?.summary.audience ?? 0} in the audience · {report?.summary.readBy ?? 0} have opened it
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          {report && Object.keys(report.summary.emails).length ? (
            <Stack spacing={0.5}>
              {Object.entries(report.summary.emails).map(([status, count]) => (
                <Stack key={status} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip size="small" label={status} />
                  <Typography variant="body2">{count} message{count === 1 ? '' : 's'}</Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No emails were queued for this notice.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReport(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AnnouncementReview;
