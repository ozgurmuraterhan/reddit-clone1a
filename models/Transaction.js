const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TransactionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['purchase', 'award_given', 'award_received', 'premium_purchase', 'premium_gift', 'refund', 'other'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['USD', 'EUR', 'GBP', 'coins'],
    required: true
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['credit_card', 'paypal', 'apple_pay', 'google_pay', 'coins', 'other'],
    required: function() {
      return this.currency !== 'coins';
    }
  },
  paymentReference: {
    // External payment ID or reference
    type: String
  },
  relatedTransaction: {
    type: Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  relatedAward: {
    type: Schema.Types.ObjectId,
    ref: 'AwardInstance'
  },
  relatedPremium: {
    type: Schema.Types.ObjectId,
    ref: 'UserPremium'
  },
  metadata: {
    type: Map,
    of: Schema.Types.Mixed
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Middleware to update timestamps
TransactionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for faster queries
TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ type: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ paymentReference: 1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
