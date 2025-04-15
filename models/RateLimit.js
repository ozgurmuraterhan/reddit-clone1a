const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const RateLimitSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  endpoint: {
    type: String,
    required: true
  },
  method: {
    type: String,
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL'],
    default: 'ALL'
  },
  count: {
    type: Number,
    default: 1
  },
  resetAt: {
    type: Date,
    required: true
  },
  ipAddress: {
    type: String
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
RateLimitSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compound index for uniqueness
RateLimitSchema.index(
  { user: 1, endpoint: 1, method: 1 },
  { unique: true }
);

// Time-based index for expiration
RateLimitSchema.index(
  { resetAt: 1 },
  { expireAfterSeconds: 0 }
);

module.exports = mongoose.model('RateLimit', RateLimitSchema);
