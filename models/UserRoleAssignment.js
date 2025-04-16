const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserRoleAssignmentSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Please provide a user ID'],
    },
    role: {
      type: Schema.Types.ObjectId,
      ref: 'Role',
      required: [true, 'Please provide a role ID'],
    },
    subreddit: {
      type: Schema.Types.ObjectId,
      ref: 'Subreddit',
      default: null,
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Middleware to update timestamps
UserRoleAssignmentSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Compound index to ensure a user can't have the same role multiple times in the same context
UserRoleAssignmentSchema.index({ user: 1, role: 1, subreddit: 1 }, { unique: true });
// Index for faster queries
UserRoleAssignmentSchema.index({ user: 1 });
UserRoleAssignmentSchema.index({ role: 1 });
UserRoleAssignmentSchema.index({ subreddit: 1 });
UserRoleAssignmentSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('UserRoleAssignment', UserRoleAssignmentSchema);
