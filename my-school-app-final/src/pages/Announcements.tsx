import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import EmojiPeopleIcon from '@mui/icons-material/EmojiPeople';
import PushPinIcon from '@mui/icons-material/PushPin';
import { announcementService, guardianService } from '../services/api.service';
import type { Announcement, GuardianLink } from '../services/api.service';
import { useCurrentUser } from '../hooks/useCurrentUser';

const PAGE_SIZE = 20;

const audienceLabel: Record<Announcement['audience'], string> = {
  ALL: 'Everyone',
  STUDENTS: 'Students',
  TEACHERS: 'Teachers',
  PARENTS: 'Parents',
  STAFF: 'Staff',
};

const formatDay = (value: string) => new Date(value).toLocaleDateString(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const Announcements: React.FC = () => {
  const currentUser = useCurrentUser();
  const [items, setItems] = React.useState<Announcement[]>([]);
  const [children, setChildren] = React.useState<GuardianLink[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasNext, setHasNext] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const showNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 3000);
  };

  const load = React.useCallback(async (offset = 0) => {
    try {
      if (offset) setLoadingMore(true);
      else setLoading(true);
      setError('');
      const response = await announcementService.list({ offset, limit: PAGE_SIZE });
      const page = response.data.data;
      setItems((prev) => (offset ? [...prev, ...page.items] : page.items));
      setHasNext(page.hasNext);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Announcements could not be loaded.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    if (currentUser?.role === 'PARENT') {
      guardianService
        .myChildren()
        .then((response) => setChildren(response.data.data))
        .catch(() => setChildren([]));
    }
  }, [currentUser?.role, load]);

  const markRead = async (announcement: Announcement) => {
    if (announcement.readAt) return;
    try {
      await announcementService.markRead(announcement.id);
      setItems((prev) => prev.map((item) =>
        item.id === announcement.id ? { ...item, readAt: new Date().toISOString() } : item
      ));
    } catch (err: any) {
      setError(err.response?.data?.message || 'The notice could not be marked as read.');
    }
  };

  const markAll = async () => {
    try {
      setError('');
      const response = await announcementService.markRead();
      const stamped = new Date().toISOString();
      setItems((prev) => prev.map((item) => ({ ...item, readAt: stamped })));
      showNotice(response.data.data ? `${response.data.data} notice(s) marked as read.` : 'Nothing new to mark.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'The notices could not be marked as read.');
    }
  };

  const unread = items.filter((item) => !item.readAt).length;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
          Announcements
        </Typography>
        <Typography variant="body2" color="text.secondary">
          What the school has sent you. Opening a notice marks it read.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

      {currentUser?.role === 'PARENT' && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <EmojiPeopleIcon fontSize="small" color="primary" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Your children
              </Typography>
            </Stack>
            {children.length ? (
              <Stack spacing={0.5}>
                {children.map((link) => (
                  <Typography key={link.id} variant="body2">
                    {link.student?.firstName} {link.student?.lastName}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {link.relationship} · {link.student?.matricNumber ?? 'no matric number yet'}
                    </Typography>
                  </Typography>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No student is linked to your account yet, so the school has nobody to address you as a parent of.
                Ask the office to link your child.
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {items.length} notice{items.length === 1 ? '' : 's'}{unread ? ` · ${unread} unread` : ''}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" onClick={markAll} disabled={!unread}>
          Mark all read
        </Button>
      </Stack>

      {loading && <CircularProgress sx={{ mb: 2 }} />}

      {!loading && items.length === 0 && (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Nothing has been sent to you yet. Notices appear here as soon as the school publishes one.
            </Typography>
          </CardContent>
        </Card>
      )}

      <Stack spacing={2}>
        {items.map((announcement) => (
          <Card
            key={announcement.id}
            variant={announcement.readAt ? 'outlined' : 'elevation'}
            sx={{ cursor: announcement.readAt ? 'default' : 'pointer' }}
            onClick={() => void markRead(announcement)}
          >
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75, flexWrap: 'wrap' }}>
                <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1, minWidth: 0 }}>
                  {announcement.title}
                </Typography>
                {!announcement.readAt && <Chip size="small" color="error" label="New" />}
                {announcement.pinned && (
                  <Chip size="small" variant="outlined" icon={<PushPinIcon />} label="Pinned" />
                )}
                <Chip size="small" label={audienceLabel[announcement.audience]} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {announcement.publishedAt ? formatDay(announcement.publishedAt) : 'Unpublished'}
                {announcement.author
                  ? ` · ${announcement.author.firstName ?? ''} ${announcement.author.lastName ?? ''}`.trim()
                  : ''}
                {announcement.expiresAt ? ` · until ${formatDay(announcement.expiresAt)}` : ''}
              </Typography>
              <Divider sx={{ my: 1.25 }} />
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                {announcement.body}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {hasNext && !loading && (
        <Button
          sx={{ mt: 2 }}
          variant="outlined"
          disabled={loadingMore}
          onClick={() => load(items.length)}
        >
          {loadingMore ? 'Loading…' : 'Load earlier notices'}
        </Button>
      )}
    </Box>
  );
};

export default Announcements;
