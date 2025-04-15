const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const StatisticsSchema = new Schema({
  targetType: {
    type: String,
    enum: ['site', 'subreddit'],
    required: true
  },
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit'
  },
  date: {
    type: Date,
    required: true
  },
  metrics: {
    pageViews: {
      type: Number,
      default: 0
    },
    uniqueVisitors: {
      type: Number,
      default: 0
    },
    newSubscribers: {
      type: Number,
      default: 0
    },
    activeUsers: {
      type: Number,
      default: 0
    },
    postCount: {
      type: Number,
      default: 0
    },
    commentCount: {
      type: Number,
      default: 0
    },
    upvoteCount: {
      type: Number,
      default: 0
    },
    downvoteCount: {
      type: Number,
      default: 0
    }
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

// Validation to ensure subreddit is provided when targetType is 'subreddit'
StatisticsSchema.pre('validate', function(next) {
  if (this.targetType === 'subreddit' && !this.subreddit) {
    return next(new Error('Subreddit is required when targetType is subreddit'));
  }
  next();
});

// Middleware to update timestamps
StatisticsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compound index for uniqueness and querying
StatisticsSchema.index(
  { targetType: 1, subreddit: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model('Statistics', StatisticsSchema);
