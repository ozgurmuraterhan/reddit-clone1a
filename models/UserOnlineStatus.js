const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserOnlineStatusSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastActiveAt: {
    type: Date,
    default: Date.now
  },
  lastSeenUrl: String,
  ipAddress: String,
  userAgent: String,
  device: {
    type: String,
    enum: ['desktop', 'mobile', 'tablet', 'unknown'],
    default: 'unknown'
  },
  connectionId: String, // For WebSocket connections
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Middleware to update timestamps
UserOnlineStatusSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual to determine if user is considered recently active (within last 5 minutes)
UserOnlineStatusSchema.virtual('isRecentlyActive').get(function() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
  return this.lastActiveAt > fiveMinutesAgo;
});

// Indexes for faster queries
UserOnlineStatusSchema.index({ user: 1 }, { unique: true });
UserOnlineStatusSchema.index({ isOnline: 1 });
UserOnlineStatusSchema.index({ lastActiveAt: -1 });

module.exports = mongoose.model('UserOnlineStatus', UserOnlineStatusSchema);
