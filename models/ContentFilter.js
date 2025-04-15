const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ContentFilterSchema = new Schema({
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit'
  },
  type: {
    type: String,
    enum: ['keyword', 'regex', 'domain', 'user'],
    required: true
  },
  pattern: {
    type: String,
    required: true,
    trim: true,
    maxlength: [200, 'Pattern cannot exceed 200 characters']
  },
  action: {
    type: String,
    enum: ['remove', 'flag', 'require_approval', 'ban'],
    default: 'flag'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  scope: {
    type: String,
    enum: ['site', 'subreddit'],
    required: true
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: {
    type: String,
    maxlength: [200, 'Reason cannot exceed 200 characters']
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

// Validation to ensure subreddit is provided when scope is 'subreddit'
ContentFilterSchema.pre('validate', function(next) {
  if (this.scope === 'subreddit' && !this.subreddit) {
    return next(new Error('Subreddit is required when scope is subreddit'));
  }
  next();
});

// Middleware to update timestamps
ContentFilterSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for faster queries
ContentFilterSchema.index({ subreddit: 1, type: 1 });
ContentFilterSchema.index({ scope: 1, isActive: 1 });
ContentFilterSchema.index({ pattern: 1 });

module.exports = mongoose.model('ContentFilter', ContentFilterSchema);
