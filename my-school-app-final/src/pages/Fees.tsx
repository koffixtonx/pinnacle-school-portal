import React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
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
import ReceiptIcon from '@mui/icons-material/Receipt';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import { adminService, feesService, paystackService, type PaymentAttempt } from '../services/api.service';
import { documentService } from '../services/pdf';
import { isAdminRole, useCurrentUser } from '../hooks/useCurrentUser';
import { formatCurrency } from '../utils/currency';

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  matricNumber?: string | null;
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
  transactionId?: string | null;
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

const PAYABLE = (invoice: Invoice) => {
  const balance = Number(invoice.totalAmount) - Number(invoice.paidAmount);
  return balance > 0 && invoice.status !== 'DRAFT' && invoice.status !== 'PAID' && invoice.status !== 'VOID';
};

const ATTEMPT_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  SUCCESS: 'success',
  STARTED: 'default',
  PENDING: 'default',
  FAILED: 'error',
  EXPIRED: 'warning',
};

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
  const [searchParams] = useSearchParams();

  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const [invoiceDialogOpen, setInvoiceDialogOpen] = React.useState(false);
  const [invoiceForm, setInvoiceForm] = React.useState(emptyInvoiceForm);

  const [paymentInvoiceId, setPaymentInvoiceId] = React.useState<string | null>(null);
  const [paymentForm, setPaymentForm] = React.useState({ amount: '', method: 'CARD' });

  const [attempts, setAttempts] = React.useState<PaymentAttempt[]>([]);
  const [payingId, setPayingId] = React.useState<string | null>(null);
  const [landedReference, setLandedReference] = React.useState('');

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

  const fetchAttempts = async () => {
    try {
      const response = await paystackService.listSessions();
      setAttempts(response.data.data);
    } catch {
      // Card attempts are supplementary detail; the invoice table above is the
      // record that matters, so a failure here is not shown as an error.
      setAttempts([]);
    }
  };

  React.useEffect(() => {
    fetchInvoices();
    fetchAttempts();
    // Paystack brings the student back to this page with ?reference=..., a few
    // seconds ahead of its own webhook, so the invoice will not have moved yet.
    const reference = searchParams.get('reference');
    if (reference) setLandedReference(reference);
    if (isAdmin) {
      adminService.listStudents({ limit: 100 }).then((res) => setStudents(res.data.data)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePay = async (invoice: Invoice) => {
    setPayingId(invoice.id);
    setError('');
    try {
      const response = await paystackService.begin(invoice.id);
      // Paystack holds the card details, so the student leaves the portal for
      // the checkout page and returns through the webhook.
      window.location.assign(response.data.data.authorizationUrl);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'The payment page could not be opened. Please try again.');
      setPayingId(null);
      fetchAttempts();
    }
  };

  const handleReminders = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await feesService.flagOverdue();
      const count = response.data.data.reminded;
      // The database refuses to chase the same student twice in a week, so zero
      // is the normal answer to a second click - it should not read like a failure.
      showSuccess(
        count === 0
          ? 'No reminders went out: every overdue invoice has already been chased in the last seven days.'
          : count === 1
            ? 'One student has been reminded about their overdue fees.'
            : `${count} students have been reminded about their overdue fees.`,
      );
    } catch (err: any) {
      setError(err?.response?.data?.message || 'The overdue reminders could not be sent.');
    } finally {
      setLoading(false);
    }
  };

  const handleReceipt = (invoice: Invoice) => {
    documentService.printReceipt({
      student: { ...(invoice.student ?? {}), matricNumber: invoice.student?.matricNumber },
      invoice,
    });
  };

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
          <Typography variant="body2" color="text.secondary">
            {isAdmin ? 'Manage invoices and record payments.' : 'Your invoices and payment history.'}
          </Typography>
        </Box>
        {isAdmin && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<MarkEmailReadIcon />} onClick={() => void handleReminders()}>
              Send overdue reminders
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setInvoiceDialogOpen(true)}>
              New Invoice
            </Button>
          </Box>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {landedReference && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          onClose={() => setLandedReference('')}
          action={
            <Button
              size="small"
              color="inherit"
              onClick={() => {
                void fetchInvoices();
                void fetchAttempts();
              }}
            >
              Refresh
            </Button>
          }
        >
          You came back from Paystack after paying {landedReference}. The invoice updates as soon as their
          server confirms the charge with us, which usually takes a few seconds.
        </Alert>
      )}
      {loading && <CircularProgress sx={{ mb: 2 }} />}

      <Card>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Reference</TableCell>
                {isAdmin && <TableCell sx={{ fontWeight: 600 }}>Student</TableCell>}
                <TableCell sx={{ fontWeight: 600 }}>Due Date</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Total</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Paid</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
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
                  <TableCell align="right">{formatCurrency(invoice.totalAmount)}</TableCell>
                  <TableCell align="right">{formatCurrency(invoice.paidAmount)}</TableCell>
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
                        title="Record a payment made outside the portal"
                      >
                        <PaymentIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
                      {!isAdmin && PAYABLE(invoice) && (
                        <Button
                          size="small"
                          variant="contained"
                          disabled={payingId === invoice.id}
                          onClick={() => void handlePay(invoice)}
                          startIcon={
                            payingId === invoice.id ? (
                              <CircularProgress size={16} color="inherit" />
                            ) : (
                              <PaymentIcon fontSize="small" />
                            )
                          }
                        >
                          {payingId === invoice.id
                            ? 'Opening…'
                            : `Pay ${formatCurrency(Number(invoice.totalAmount) - Number(invoice.paidAmount))}`}
                        </Button>
                      )}
                      <IconButton size="small" onClick={() => handleReceipt(invoice)} title="Print a receipt">
                        <ReceiptIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {invoices.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 6}>
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

      {attempts.length > 0 && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              Card payment attempts
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Opening the payment page is recorded here even when a card is never charged. Only Paystack&rsquo;s own
              confirmation can mark an invoice as paid.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {attempts.map((attempt) => (
                <Box
                  key={attempt.id}
                  sx={{
                    display: 'flex',
                    gap: 1.5,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    border: (t) => `1px solid ${t.palette.divider}`,
                    borderRadius: 2,
                    px: 1.5,
                    py: 1,
                  }}
                >
                  <Chip label={attempt.status} size="small" color={ATTEMPT_COLOR[attempt.status] || 'default'} />
                  <Typography variant="body2">{attempt.reference}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatCurrency(attempt.amount)} · {new Date(attempt.createdAt).toLocaleString()}
                  </Typography>
                  {attempt.failureReason && (
                    <Typography variant="body2" color="error.main">
                      {attempt.failureReason}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

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
             slotProps={{ inputLabel: { shrink: true } }}
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
                label="Amount (₦)"
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
            label="Amount (₦)"
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
