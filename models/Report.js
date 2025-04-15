const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ReportSchema = new Schema({
  reporter: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentType: {
    type: String,
    enum: ['post', 'comment', 'user', 'subreddit'],
    required: true
  },
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post'
  },
  comment: {
    type: Schema.Types.ObjectId,
    ref: 'Comment'
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit'
  },
  reason: {
    type: String,
    required: [true, 'Report reason is required'],
    maxlength: [500, 'Report reason cannot exceed 500 characters']
  },
  subredditRule: {
    type: Schema.Types.ObjectId,
    ref: 'SubredditRule'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'spam'],
    default: 'pending'
  },
  actionTaken: {
    type: String,
    enum: ['none', 'removed', 'banned', 'warned', 'other'],
    default: 'none'
  },
  actionDetails: {
    type: String,
    maxlength: [500, 'Action details cannot exceed 500 characters']
  },
  handledBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  handledAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Validation to ensure the correct reference field is provided based on contentType
ReportSchema.pre('validate', function(next) {
  const contentTypeFieldMap = {
    'post': 'post',
    'comment': 'comment',
    'user': 'user',
    'subreddit': 'subreddit'
  };

  const requiredField = contentTypeFieldMap[this.contentType];

  if (!this[requiredField]) {
    return next(new Error(`${requiredField} is required when contentType is ${this.contentType}`));
  }

  // Ensure only the correct field is set
  Object.keys(contentTypeFieldMap).forEach(type => {
    const field = contentTypeFieldMap[type];
    if (field !== requiredField && this[field]) {
      this[field] = undefined;
    }
  });

  next();
});

// Middleware to update handledAt when status changes from pending
ReportSchema.pre('save', function(next) {
  if (this.isModified('status') && this.status !== 'pending' && !this.handledAt) {
    this.handledAt = Date.now();
  }
  next();
});

// Compound index to prevent duplicate reports
ReportSchema.index(
  { reporter: 1, contentType: 1, post: 1, comment: 1, user: 1, subreddit: 1 },
  { unique: true, sparse: true }
);

// Indexes for faster queries
ReportSchema.index({ subreddit: 1, status: 1, createdAt: -1 });
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ reporter: 1 });
ReportSchema.index({ handledBy: 1 });

module.exports = mongoose.model('Report', ReportSchema);
