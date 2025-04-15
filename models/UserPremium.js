const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserPremiumSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  },
  source: {
    type: String,
    enum: ['purchase', 'award', 'gift', 'promotion'],
    required: true
  },
  sourceReference: {
    // Could be a transaction ID, award instance ID, etc.
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual to check if premium is current
UserPremiumSchema.virtual('isCurrent').get(function() {
  return this.isActive && new Date() >= this.startDate && new Date() <= this.endDate;
});

// Indexes for faster queries
UserPremiumSchema.index({ user: 1 });
UserPremiumSchema.index({ endDate: 1 });
UserPremiumSchema.index({ isActive: 1 });

module.exports = mongoose.model('UserPremium', UserPremiumSchema);
