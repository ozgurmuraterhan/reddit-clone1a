const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FlairSchema = new Schema({
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit',
    required: true
  },
  type: {
    type: String,
    enum: ['post', 'user'],
    required: true
  },
  text: {
    type: String,
    required: [true, 'Flair text is required'],
    trim: true,
    maxlength: [64, 'Flair text cannot exceed 64 characters']
  },
  backgroundColor: {
    type: String,
    default: '#edeff1',
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please provide a valid hex color']
  },
  textColor: {
    type: String,
    default: '#1a1a1b',
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please provide a valid hex color']
  },
  emoji: {
    type: String,
    maxlength: [36, 'Emoji identifier cannot exceed 36 characters']
  },
  position: {
    type: Number,
    default: 0
  },
  allowUserEditable: {
    type: Boolean,
    default: false
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
FlairSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew && !this.updatedBy) {
    return next(new Error('updatedBy is required when updating a flair'));
  }

  this.updatedAt = Date.now();
  next();
});

// Compound index for uniqueness
FlairSchema.index(
  { subreddit: 1, type: 1, text: 1 },
  { unique: true }
);

// Index for faster queries
FlairSchema.index({ subreddit: 1, type: 1, position: 1 });

module.exports = mongoose.model('Flair', FlairSchema);
