const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AwardSchema = new Schema({
    name: {
        type: String,
        required: [true, 'Award name is required'],
        trim: true,
        maxlength: [50, 'Award name cannot exceed 50 characters']
    },
    description: {
        type: String,
        required: [true, 'Award description is required'],
        trim: true,
        maxlength: [200, 'Award description cannot exceed 200 characters']
    },
    icon: {
        type: String,
        required: [true, 'Award icon is required']
    },
    coinPrice: {
        type: Number,
        required: [true, 'Coin price is required'],
        min: [0, 'Coin price cannot be negative']
    },
    category: {
        type: String,
        enum: ['premium', 'community', 'moderator', 'system'],
        default: 'community'
    },
    effects: {
        givesCoins: {
            type: Number,
            default: 0
        },
        givesPremium: {
            type: Boolean,
            default: false
        },
        premiumDurationDays: {
            type: Number,
            default: 0
        },
        awardeeKarma: {
            type: Number,
            default: 0
        },
        awarderKarma: {
            type: Number,
            default: 0
        },
        trophy: {
            type: Boolean,
            default: false
        }
    },
    subreddit: {
        type: Schema.Types.ObjectId,
        ref: 'Subreddit'
    },
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
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

// Middleware to update timestamps
AwardSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Validation for subreddit-specific awards
AwardSchema.pre('validate', function(next) {
  if (this.category === 'community' && !this.subreddit) {
    return next(new Error('Subreddit is required for community awards'));
  }
  next();
});

// Virtual for award instances
AwardSchema.virtual('instances', {
  ref: 'AwardInstance',
  localField: '_id',
  foreignField: 'award',
  justOne: false
});

// Indexes for faster queries
AwardSchema.index({ category: 1 });
AwardSchema.index({ subreddit: 1 });
AwardSchema.index({ coinPrice: 1 });
AwardSchema.index({ isActive: 1 });

module.exports = mongoose.model('Award', AwardSchema);
