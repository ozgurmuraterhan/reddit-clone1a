const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PollSchema = new Schema({
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
    unique: true
  },
  options: [{
    type: Schema.Types.ObjectId,
    ref: 'PollOption'
  }],
  totalVotes: {
    type: Number,
    default: 0
  },
  endDate: {
    type: Date,
    required: true
  },
  allowMultipleVotes: {
    type: Boolean,
    default: false
  },
  maxSelections: {
    type: Number,
    default: 1,
    min: 1,
    max: 6
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
PollSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for poll votes
PollSchema.virtual('votes', {
  ref: 'PollVote',
  localField: '_id',
  foreignField: 'poll',
  justOne: false
});

// Virtual to check if poll is active
PollSchema.virtual('isActive').get(function() {
  return new Date() < this.endDate;
});

module.exports = mongoose.model('Poll', PollSchema);
