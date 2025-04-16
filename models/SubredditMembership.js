const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubredditMembershipSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    subreddit: {
      type: Schema.Types.ObjectId,
      ref: 'Subreddit',
      required: true,
    },
    status: {
      type: String,
      enum: ['member', 'pending', 'banned'],
      default: 'member',
    },
    isFavorite: {
      type: Boolean,
      default: false,
    },
    banReason: String,
    banExpiration: Date,
    bannedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    bannedAt: Date,
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Index for faster queries
SubredditMembershipSchema.index({ subreddit: 1, user: 1 }, { unique: true });
SubredditMembershipSchema.index({ user: 1, isFavorite: 1 });

module.exports = mongoose.model('SubredditMembership', SubredditMembershipSchema);
