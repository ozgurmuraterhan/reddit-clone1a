const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PermissionSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Please provide a permission name'],
    unique: true,
    trim: true,
    maxlength: [100, 'Permission name cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Please provide a description'],
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  category: {
    type: String,
    enum: ['post', 'comment', 'user', 'subreddit', 'moderation', 'admin', 'other'],
    required: [true, 'Please specify permission category']
  },
  scope: {
    type: String,
    enum: ['site', 'subreddit', 'both'],
    required: [true, 'Please specify permission scope']
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
PermissionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for faster queries
PermissionSchema.index({ name: 1 }, { unique: true });
PermissionSchema.index({ category: 1 });
PermissionSchema.index({ scope: 1 });

module.exports = mongoose.model('Permission', PermissionSchema);
