const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ArchivePolicySchema = new Schema({
  scope: {
    type: String,
    enum: ['site', 'subreddit'],
    required: true
  },
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit'
  },
  contentType: {
    type: String,
    enum: ['post', 'comment', 'all'],
    default: 'all'
  },
  archiveAfterDays: {
    type: Number,
    required: true,
    min: 1,
    max: 365 * 10 // Max 10 years
  },
  actions: {
    lockVoting: {
      type: Boolean,
      default: true
    },
    lockComments: {
      type: Boolean,
      default: true
    },
    hideFromFeeds: {
      type: Boolean,
      default: false
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
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
ArchivePolicySchema.pre('validate', function(next) {
  if (this.scope === 'subreddit' && !this.subreddit) {
    return next(new Error('Subreddit is required when scope is subreddit'));
  }
  next();
});

// Middleware to update timestamps
ArchivePolicySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compound index for uniqueness
ArchivePolicySchema.index(
  { scope: 1, subreddit: 1, contentType: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('ArchivePolicy', ArchivePolicySchema);
