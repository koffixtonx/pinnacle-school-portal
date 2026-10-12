import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { academicService, resultsService } from '../services/api.service';
import type { ResultSlip, Semester, Transcript } from '../services/api.service';
import { documentService } from '../services/pdf';
import { useCurrentUser } from '../hooks/useCurrentUser';

const pointTone = (gpa: number) => (gpa >= 4.5 ? 'success' : gpa >= 3.5 ? 'info' : gpa >= 2.4 ? 'warning' : 'error');

const Results: React.FC = () => {
  const user = useCurrentUser();

  const [transcript, setTranscript] = React.useState<Transcript | null>(null);
  const [slip, setSlip] = React.useState<ResultSlip | null>(null);
  const [selectedSemester, setSelectedSemester] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const semesterOptions = transcript?.semesters ?? [];

  const loadSlip = async (semesterId: string) => {
    try {
      setLoading(true);
      setError('');
      const response = await resultsService.slip(semesterId || undefined);
      setSlip(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Your results could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [transcriptRes, activeRes] = await Promise.all([
          resultsService.transcript(),
          academicService.getActiveSemester(),
        ]);
        setTranscript(transcriptRes.data.data);
        const published = transcriptRes.data.data?.semesters ?? [];
        const activeId = activeRes.data.data?.id;
        const initial = published.find((row) => row.semesterId === activeId)?.semesterId ?? published[0]?.semesterId ?? '';
        const semesterId = initial || activeId || '';
        setSelectedSemester(semesterId);
        if (semesterId) {
          const response = await resultsService.slip(semesterId);
          setSlip(response.data.data);
        } else {
          setSlip(null);
        }
      } catch (err: any) {
        setError(err.response?.data?.message || 'Your results could not be loaded.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSemester = (semesterId: string) => {
    setSelectedSemester(semesterId);
    loadSlip(semesterId);
  };

  const downloadSlip = () => {
    if (!slip) return;
    documentService.printResultSlip({
      student: { firstName: user?.firstName, lastName: user?.lastName, email: user?.email },
      semester: slip.semester as Semester | null,
      slip,
    });
  };

  const downloadTranscript = () => {
    if (!transcript) return;
    documentService.printTranscript(transcript);
  };

  const gpa = Number(slip?.gpa ?? 0);

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Results
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Only results your school has published appear here.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={downloadSlip} disabled={!slip || slip.gradeCount === 0}>
            Result slip
          </Button>
          <Button
            variant="contained"
            startIcon={<PictureAsPdfIcon />}
            onClick={downloadTranscript}
            disabled={!transcript || transcript.semesters.length === 0}
          >
            Transcript
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Semester GPA', value: gpa.toFixed(2), hint: slip?.semester?.name ?? '' },
          { label: 'CGPA', value: (transcript?.cgpa ?? 0).toFixed(2), hint: transcript?.classOfDegree ?? '' },
          { label: 'Credit units', value: String(slip?.creditUnits ?? 0), hint: 'this semester' },
          { label: 'Total units', value: String(transcript?.totalCreditUnits ?? 0), hint: 'so far' },
        ].map((card) => (
          <Grid key={card.label} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>{card.value}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{card.hint}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {semesterOptions.length > 0 && (
        <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            label="Semester"
            value={selectedSemester}
            onChange={(e) => handleSemester(e.target.value)}
            sx={{ minWidth: 240 }}
          >
            {semesterOptions.map((row) => (
              <MenuItem key={row.semesterId} value={row.semesterId}>
                {row.semester} · {row.session}
              </MenuItem>
            ))}
          </TextField>
          <Chip size="small" color={pointTone(gpa)} label={`GPA ${gpa.toFixed(2)}`} />
        </Stack>
      )}

      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Course</TableCell>
                <TableCell>Assessment</TableCell>
                <TableCell align="right">Units</TableCell>
                <TableCell align="right">Score</TableCell>
                <TableCell>Grade</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(slip?.courses ?? []).map((course) => (
                <TableRow key={`${course.code}-${course.period}`}>
                  <TableCell>{course.code}</TableCell>
                  <TableCell>{course.title}</TableCell>
                  <TableCell>{course.period}</TableCell>
                  <TableCell align="right">{course.creditUnits}</TableCell>
                  <TableCell align="right">{Number(course.score).toFixed(1)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={`${course.letterGrade} · ${Number(course.gradePoints).toFixed(2)}`} />
                  </TableCell>
                </TableRow>
              ))}
              {(slip?.courses ?? []).length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary">
                      No published results for this semester yet. Your school releases them once the grade book is approved.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
};

export default Results;
