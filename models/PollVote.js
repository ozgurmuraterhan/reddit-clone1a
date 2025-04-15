const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PollVoteSchema = new Schema({
  poll: {
    type: Schema.Types.ObjectId,
    ref: 'Poll',
    required: true
  },
  option: {
    type: Schema.Types.ObjectId,
    ref: 'PollOption',
    required: true
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index for uniqueness (one vote per user per option)
PollVoteSchema.index(
  { poll: 1, option: 1, user: 1 },
  { unique: true }
);

// Index for faster queries
PollVoteSchema.index({ poll: 1, user: 1 });
PollVoteSchema.index({ option: 1 });

module.exports = mongoose.model('PollVote', PollVoteSchema);
