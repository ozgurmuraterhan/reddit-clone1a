const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const RoleSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Please provide a role name'],
    trim: true,
    maxlength: [50, 'Role name cannot exceed 50 characters']
  },
  description: {
    type: String,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  scope: {
    type: String,
    enum: ['site', 'subreddit'],
    required: [true, 'Please specify role scope']
  },
  permissions: [{
    type: Schema.Types.ObjectId,
    ref: 'Permission'
  }],
  isDefault: {
    type: Boolean,
    default: false
  },
  isSystem: {
    type: Boolean,
    default: false
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
RoleSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for role assignments
RoleSchema.virtual('assignments', {
  ref: 'UserRoleAssignment',
  localField: '_id',
  foreignField: 'role',
  justOne: false
});

// Index for faster queries
RoleSchema.index({ name: 1, scope: 1 }, { unique: true });
RoleSchema.index({ isDefault: 1 });
RoleSchema.index({ isSystem: 1 });

module.exports = mongoose.model('Role', RoleSchema);
