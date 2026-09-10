import React from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { academicsService } from '../services/api.service';

type Course = { id: string; code: string; title: string; creditUnits: number | null; level: string; semester: number | null };
type Department = { id: string; name: string; confidence: string; source: string | null; courses: Course[] };
type Faculty = { id: string; name: string; departments: Department[] };

const CourseCatalog: React.FC = () => {
  const [faculties, setFaculties] = React.useState<Faculty[]>([]);
  const [error, setError] = React.useState('');
  React.useEffect(() => { academicsService.getCourseHierarchy().then((res) => setFaculties(res.data.data)).catch((err) => setError(err.response?.data?.message || 'Unable to load the course catalogue.')); }, []);
  return <Box>
    <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>Course catalogue</Typography>
    <Typography color="text.secondary" sx={{ mb: 3 }}>Expand a faculty, then a department, to browse its available courses.</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {!error && faculties.length === 0 && <CircularProgress />}
    {faculties.map((faculty) => <Accordion key={faculty.id} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography fontWeight={700}>{faculty.name}</Typography><Chip size="small" sx={{ ml: 1 }} label={`${faculty.departments.length} departments`} /></AccordionSummary>
      <AccordionDetails><Stack spacing={1}>
        {faculty.departments.map((department) => <Accordion key={department.id} disableGutters variant="outlined">
          <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography>{department.name}</Typography><Chip size="small" sx={{ ml: 1 }} label={department.confidence} color={department.confidence === 'confirmed' ? 'success' : department.confidence === 'reference' ? 'warning' : 'default'} /></AccordionSummary>
          <AccordionDetails>{department.courses.length === 0 ? <Typography variant="body2" color="text.secondary">Course information has not been researched for this department yet.</Typography> : <Stack spacing={1}>{department.courses.map((course) => <Box key={course.id} sx={{ borderLeft: 3, borderColor: 'primary.main', pl: 1.5 }}><Typography fontWeight={600}>{course.code} — {course.title}</Typography><Typography variant="caption" color="text.secondary">{course.creditUnits ?? '—'} credit units · Level {course.level} · Semester {course.semester ?? '—'}</Typography></Box>)}</Stack>}</AccordionDetails>
        </Accordion>)}
      </Stack></AccordionDetails>
    </Accordion>)}
  </Box>;
};

export default CourseCatalog;
