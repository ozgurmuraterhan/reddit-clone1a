const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubredditMembershipSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit',
    required: true
  },
  type: {
    type: String,
    enum: ['member', 'moderator', 'banned'],
    default: 'member'
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  bannedAt: Date,
  bannedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  banReason: {
    type: String,
    maxlength: [500, 'Ban reason cannot exceed 500 characters']
  },
  banExpiration: Date,
  isFavorite: {
    type: Boolean,
    default: false
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Middleware for validation
SubredditMembershipSchema.pre('validate', function(next) {
  if (this.type === 'banned' && (!this.bannedAt || !this.bannedBy)) {
    next(new Error('Banned memberships must include bannedAt and bannedBy'));
  }
  next();
});

// Compound index for uniqueness
SubredditMembershipSchema.index(
  { user: 1, subreddit: 1 },
  { unique: true }
);

// Index for faster queries
SubredditMembershipSchema.index({ subreddit: 1, type: 1 });
SubredditMembershipSchema.index({ user: 1, isFavorite: 1 });

module.exports = mongoose.model('SubredditMembership', SubredditMembershipSchema);
