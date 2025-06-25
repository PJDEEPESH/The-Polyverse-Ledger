import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  userWallet: String,
  amount: Number,
  dueDate: Date,
  status: String
});

export default mongoose.model('Invoice', invoiceSchema);
