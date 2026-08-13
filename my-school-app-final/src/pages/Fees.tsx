import React from 'react';
import {
  Box,
  Card,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  MenuItem,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PaymentIcon from '@mui/icons-material/Payment';
import DeleteIcon from '@mui/icons-material/Delete';
import { adminService, feesService } from '../services/api.service';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}
interface InvoiceLine {
  id: string;
  description: string;
  amount: string;
}
interface Payment {
  id: string;
  amount: string;
  method: string;
  paidAt: string;
}
interface Invoice {
  id: string;
  reference: string;
  status: string;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  lines: InvoiceLine[];
  payments: Payment[];
  student: Student;
}

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'default'> = {
  PAID: 'success',
  PARTIAL: 'warning',
  DRAFT: 'default',
};

const emptyInvoiceForm = {
  studentId: '',
  dueDate: '',
  lines: [{ description: '', amount: '' }],
};

const Fees: React.FC = () => {
  const user = useCurrentUser();
  const isAdmin = isAdminRole(user?.role);

  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const [invoiceDialogOpen, setInvoiceDialogOpen] = React.useState(false);
  const [invoiceForm, setInvoiceForm] = React.useState(emptyInvoiceForm);

  const [paymentInvoiceId, setPaymentInvoiceId] = React.useState<string | null>(null);
  const [paymentForm, setPaymentForm] = React.useState({ amount: '', method: 'CARD' });

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await feesService.listInvoices();
      setInvoices(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchInvoices();
    if (isAdmin) {
      adminService.listStudents({ limit: 100 }).then((res) => setStudents(res.data.data)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLine = (index: number, field: 'description' | 'amount', value: string) => {
    const lines = [...invoiceForm.lines];
    lines[index] = { ...lines[index], [field]: value };
    setInvoiceForm({ ...invoiceForm, lines });
  };

  const addLine = () => setInvoiceForm({ ...invoiceForm, lines: [...invoiceForm.lines, { description: '', amount: '' }] });
  const removeLine = (index: number) =>
    setInvoiceForm({ ...invoiceForm, lines: invoiceForm.lines.filter((_, i) => i !== index) });

  const handleCreateInvoice = async () => {
    try {
      setLoading(true);
      setError('');
      await feesService.createInvoice(
        invoiceForm.studentId,
        invoiceForm.dueDate,
        invoiceForm.lines
          .filter((line) => line.description && line.amount)
          .map((line) => ({ description: line.description, amount: Number(line.amount) }))
      );
      showSuccess('Invoice created');
      setInvoiceDialogOpen(false);
      setInvoiceForm(emptyInvoiceForm);
      fetchInvoices();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create invoice');
    } finally {
      setLoading(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!paymentInvoiceId) return;
    try {
      setLoading(true);
      setError('');
      await feesService.recordPayment(paymentInvoiceId, Number(paymentForm.amount), paymentForm.method);
      showSuccess('Payment recorded');
      setPaymentInvoiceId(null);
      setPaymentForm({ amount: '', method: 'CARD' });
      fetchInvoices();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Fees &amp; Invoicing
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {isAdmin ? 'Manage invoices and record payments.' : 'Your invoices and payment history.'}
          </Typography>
        </Box>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setInvoiceDialogOpen(true)}>
            New Invoice
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Reference</TableCell>
                {isAdmin && <TableCell sx={{ fontWeight: 600 }}>Student</TableCell>}
                <TableCell sx={{ fontWeight: 600 }}>Due Date</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Total</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Paid</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                {isAdmin && <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.reference}</TableCell>
                  {isAdmin && (
                    <TableCell>
                      {invoice.student.firstName} {invoice.student.lastName}
                    </TableCell>
                  )}
                  <TableCell>{new Date(invoice.dueDate).toLocaleDateString()}</TableCell>
                  <TableCell align="right">${Number(invoice.totalAmount).toFixed(2)}</TableCell>
                  <TableCell align="right">${Number(invoice.paidAmount).toFixed(2)}</TableCell>
                  <TableCell>
                    <Chip label={invoice.status} size="small" color={STATUS_COLOR[invoice.status] || 'default'} />
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setPaymentInvoiceId(invoice.id);
                          setPaymentForm({ amount: '', method: 'CARD' });
                        }}
                        disabled={invoice.status === 'PAID'}
                      >
                        <PaymentIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {invoices.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 7 : 5}>
                    <Typography variant="body2" color="text.secondary">
                      No invoices yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={invoiceDialogOpen} onClose={() => setInvoiceDialogOpen(false)} fullWidth>
        <DialogTitle>New Invoice</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="Student"
            fullWidth
            margin="normal"
            value={invoiceForm.studentId}
            onChange={(e) => setInvoiceForm({ ...invoiceForm, studentId: e.target.value })}
          >
            {students.map((student) => (
              <MenuItem key={student.id} value={student.id}>
                {student.firstName} {student.lastName} ({student.email})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Due Date"
            type="date"
            fullWidth
            margin="normal"
            InputLabelProps={{ shrink: true }}
            value={invoiceForm.dueDate}
            onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })}
          />
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Line Items
          </Typography>
          {invoiceForm.lines.map((line, index) => (
            <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
              <TextField
                label="Description"
                size="small"
                fullWidth
                value={line.description}
                onChange={(e) => updateLine(index, 'description', e.target.value)}
              />
              <TextField
                label="Amount"
                type="number"
                size="small"
                sx={{ width: 140 }}
                value={line.amount}
                onChange={(e) => updateLine(index, 'amount', e.target.value)}
              />
              <IconButton size="small" onClick={() => removeLine(index)} disabled={invoiceForm.lines.length === 1}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          <Button size="small" onClick={addLine}>
            + Add Line
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInvoiceDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateInvoice}
            disabled={!invoiceForm.studentId || !invoiceForm.dueDate}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!paymentInvoiceId} onClose={() => setPaymentInvoiceId(null)} fullWidth>
        <DialogTitle>Record Payment</DialogTitle>
        <DialogContent>
          <TextField
            label="Amount"
            type="number"
            fullWidth
            margin="normal"
            value={paymentForm.amount}
            onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
          />
          <TextField
            select
            label="Method"
            fullWidth
            margin="normal"
            value={paymentForm.method}
            onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
          >
            <MenuItem value="CARD">Card</MenuItem>
            <MenuItem value="BANK_TRANSFER">Bank Transfer</MenuItem>
            <MenuItem value="CASH">Cash</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentInvoiceId(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleRecordPayment} disabled={!paymentForm.amount}>
            Record
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Fees;
