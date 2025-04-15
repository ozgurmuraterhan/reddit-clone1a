const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PollOptionSchema = new Schema({
  poll: {
    type: Schema.Types.ObjectId,
    ref: 'Poll',
    required: true
  },
  text: {
    type: String,
    required: [true, 'Option text is required'],
    trim: true,
    maxlength: [100, 'Option text cannot exceed 100 characters']
  },
  voteCount: {
    type: Number,
    default: 0
  },
  position: {
    type: Number,
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

// Virtual for votes
PollOptionSchema.virtual('votes', {
  ref: 'PollVote',
  localField: '_id',
  foreignField: 'option',
  justOne: false
});

// Compound index for uniqueness
PollOptionSchema.index(
  { poll: 1, position: 1 },
  { unique: true }
);

module.exports = mongoose.model('PollOption', PollOptionSchema);
