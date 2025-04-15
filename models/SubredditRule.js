const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubredditRuleSchema = new Schema({
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit',
    required: true
  },
  title: {
    type: String,
    required: [true, 'Rule title is required'],
    trim: true,
    maxlength: [100, 'Rule title cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Rule description cannot exceed 500 characters']
  },
  appliesTo: {
    type: String,
    enum: ['posts', 'comments', 'both'],
    default: 'both'
  },
  reportReason: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  position: {
    type: Number,
    default: 0
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
SubredditRuleSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew && !this.updatedBy) {
    return next(new Error('updatedBy is required when updating a rule'));
  }

  this.updatedAt = Date.now();
  next();
});

// Compound index for uniqueness and ordering
SubredditRuleSchema.index(
  { subreddit: 1, position: 1 },
  { unique: true }
);

SubredditRuleSchema.index(
  { subreddit: 1, title: 1 },
  { unique: true }
);

module.exports = mongoose.model('SubredditRule', SubredditRuleSchema);
