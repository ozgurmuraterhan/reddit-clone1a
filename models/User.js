const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema(
  {
    username: {
      type: String,
      required: [true, 'Please provide a username'],
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [20, 'Username cannot exceed 20 characters'],
      match: [
        /^[a-zA-Z0-9_-]+$/,
        'Username can only contain letters, numbers, underscores and hyphens',
      ],
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    profilePicture: {
      type: String,
      default: 'default-profile.png',
    },
    bio: {
      type: String,
      maxlength: [500, 'Bio cannot exceed 500 characters'],
    },
    karma: {
      post: {
        type: Number,
        default: 0,
      },
      comment: {
        type: Number,
        default: 0,
      },
      awardee: {
        type: Number,
        default: 0,
      },
      awarder: {
        type: Number,
        default: 0,
      },
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    accountStatus: {
      type: String,
      enum: ['active', 'pending_verification', 'suspended', 'deleted'],
      default: 'pending_verification',
    },
    verificationToken: String,
    verificationTokenExpire: Date,
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    lastLogin: Date,
    lastActive: {
      type: Date,
      default: Date.now,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    deletedAt: Date,
    isDeleted: {
      type: Boolean,
      default: false,
    },
    authProvider: {
      type: String,
      enum: ['local', 'google', 'facebook', 'twitter', 'github'],
      default: 'local',
    },
    authProviderId: {
      type: String,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);
// Virtual for total karma
UserSchema.virtual('totalKarma').get(function () {
  return this.karma.post + this.karma.comment + this.karma.awardee + this.karma.awarder;
});

// Virtual for user's posts
UserSchema.virtual('posts', {
  ref: 'Post',
  localField: '_id',
  foreignField: 'author',
  justOne: false,
});

// Virtual for user's comments
UserSchema.virtual('comments', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'author',
  justOne: false,
});

// Virtual for user's subreddits (created)
UserSchema.virtual('createdSubreddits', {
  ref: 'Subreddit',
  localField: '_id',
  foreignField: 'creator',
  justOne: false,
});

// Virtual for user's subreddit memberships
UserSchema.virtual('subredditMemberships', {
  ref: 'SubredditMembership',
  localField: '_id',
  foreignField: 'user',
  justOne: false,
});

// Virtual for user's role assignments
UserSchema.virtual('roleAssignments', {
  ref: 'UserRoleAssignment',
  localField: '_id',
  foreignField: 'user',
  justOne: false,
});

// Middleware to update timestamps
UserSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Middleware to handle soft delete
UserSchema.pre('find', function () {
  this.where({ isDeleted: false });
});

UserSchema.pre('findOne', function () {
  this.where({ isDeleted: false });
});

// Index for faster queries
UserSchema.index({ username: 1 }, { unique: true });

module.exports = mongoose.model('User', UserSchema);
