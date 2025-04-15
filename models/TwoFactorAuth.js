const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TwoFactorAuthSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  secret: {
    type: String,
    required: true
  },
  isEnabled: {
    type: Boolean,
    default: false
  },
  backupCodes: [{
    code: {
      type: String
    },
    isUsed: {
      type: Boolean,
      default: false
    }
  }],
  lastUsed: {
    type: Date
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
TwoFactorAuthSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('TwoFactorAuth', TwoFactorAuthSchema);
