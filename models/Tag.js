const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TagSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Tag name is required'],
    trim: true,
    maxlength: [50, 'Tag name cannot exceed 50 characters']
  },
  color: {
    type: String,
    default: '#6e6e6e',
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please provide a valid hex color']
  },
  description: {
    type: String,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  scope: {
    type: String,
    enum: ['site', 'subreddit'],
    default: 'site'
  },
  subreddit: {
    type: Schema.Types.ObjectId,
    ref: 'Subreddit'
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
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
TagSchema.pre('validate', function(next) {
  if (this.scope === 'subreddit' && !this.subreddit) {
    return next(new Error('Subreddit is required when scope is subreddit'));
  }
  next();
});

// Middleware to update timestamps
TagSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for tagged items
TagSchema.virtual('taggedItems', {
  ref: 'TaggedItem',
  localField: '_id',
  foreignField: 'tag',
  justOne: false
});

// Compound index for uniqueness
TagSchema.index(
  { name: 1, scope: 1, subreddit: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('Tag', TagSchema);
