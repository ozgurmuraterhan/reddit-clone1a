const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Role = require('../models/Role');
const UserRoleAssignment = require('../models/UserRoleAssignment');
const Permission = require('../models/Permission');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const sendEmail = require('../utils/sendEmail');

// JWT token oluşturma yardımcısı
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// Token yanıtı gönderme yardımcısı
const sendTokenResponse = (user, statusCode, res) => {
  const token = generateToken(user._id);

  const options = {
    expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRE * 24 * 60 * 60 * 1000),
    httpOnly: true,
  };

  if (process.env.NODE_ENV === 'production') {
    options.secure = true;
  }

  res.status(statusCode).cookie('token', token, options).json({
    success: true,
    token,
  });
};

// İzin kontrolü yardımcısı
const checkPermission = async (userId, permissionName, subredditId = null) => {
  const query = {
    user: userId,
  };

  if (subredditId) {
    query.$or = [{ subreddit: subredditId }, { scope: 'site' }];
  } else {
    query.scope = 'site';
  }

  const userRoles = await UserRoleAssignment.find(query).populate({
    path: 'role',
    populate: {
      path: 'permissions',
      match: { name: permissionName },
    },
  });

  return userRoles.some(
    (assignment) => assignment.role.permissions && assignment.role.permissions.length > 0,
  );
};
// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res, next) => {
  const { username, email, password } = req.body;

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create user
  const user = await User.create({
    username,
    email,
    password: hashedPassword,
  });

  // Assign default user role
  const defaultRole = await Role.findOne({
    scope: 'site',
    isDefault: true,
  });

  if (defaultRole) {
    await UserRoleAssignment.create({
      user: user._id,
      role: defaultRole._id,
      scope: 'site',
    });
  }

  // Create verification token
  const verificationToken = crypto.randomBytes(20).toString('hex');

  // Hash token and set to verificationToken field
  const hashedToken = crypto.createHash('sha256').update(verificationToken).digest('hex');

  // Set verification token fields
  user.verificationToken = hashedToken;
  user.verificationTokenExpire = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  await user.save();

  // Create verification URL
  const verificationUrl = `${req.protocol}://${req.get(
    'host',
  )}/api/v1/auth/verify-email/${verificationToken}`;

  const message = `You are receiving this email because you need to confirm your email address. Please visit: \n\n ${verificationUrl}`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Email verification',
      message,
    });

    sendTokenResponse(user, 200, res);
  } catch (err) {
    user.verificationToken = undefined;
    user.verificationTokenExpire = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new ErrorResponse('Email could not be sent', 500));
  }
});

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Validate email & password
  if (!email || !password) {
    return next(new ErrorResponse('Please provide an email and password', 400));
  }

  // Check for user
  const user = await User.findOne({ email, isDeleted: false }).select('+password');

  if (!user) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Check if password matches
  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Check if email is verified
  if (!user.emailVerified && process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
    return next(new ErrorResponse('Please verify your email address', 401));
  }

  // Check if account is suspended
  if (user.accountStatus === 'suspended') {
    return next(new ErrorResponse(`This account has been suspended.`, 403));
  }

  // Update last login time
  user.lastLogin = Date.now();
  user.lastActive = Date.now();
  await user.save({ validateBeforeSave: false });

  sendTokenResponse(user, 200, res);
});

// @desc    Log user out / clear cookie
// @route   GET /api/v1/auth/logout
// @access  Private
exports.logout = asyncHandler(async (req, res, next) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    data: {},
  });
});

// @desc    Get current logged in user
// @route   GET /api/v1/auth/me
// @access  Private
exports.getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  // Update last active time
  user.lastActive = Date.now();
  await user.save({ validateBeforeSave: false });

  // Get user's roles and permissions
  const userRoleAssignments = await UserRoleAssignment.find({
    user: user._id,
  }).populate({
    path: 'role',
    populate: {
      path: 'permissions',
    },
  });

  // Extract permissions from roles
  const permissions = new Set();
  const roles = {};

  userRoleAssignments.forEach((assignment) => {
    // Group roles by scope
    const scope = assignment.scope;
    const subreddit = assignment.subreddit ? assignment.subreddit.toString() : null;
    const scopeKey = subreddit ? `subreddit:${subreddit}` : 'site';

    if (!roles[scopeKey]) {
      roles[scopeKey] = [];
    }

    roles[scopeKey].push({
      id: assignment.role._id,
      name: assignment.role.name,
      description: assignment.role.description,
    });

    // Add permissions
    if (assignment.role.permissions) {
      assignment.role.permissions.forEach((permission) => {
        permissions.add(permission.name);
      });
    }
  });

  res.status(200).json({
    success: true,
    data: {
      user,
      roles,
      permissions: Array.from(permissions),
    },
  });
});

// @desc    Update user details
// @route   PUT /api/v1/auth/updatedetails
// @access  Private
exports.updateDetails = asyncHandler(async (req, res, next) => {
  const fieldsToUpdate = {
    username: req.body.username,
    email: req.body.email,
    bio: req.body.bio,
    profilePicture: req.body.profilePicture,
  };

  // Remove undefined fields
  Object.keys(fieldsToUpdate).forEach(
    (key) => fieldsToUpdate[key] === undefined && delete fieldsToUpdate[key],
  );

  // Handle email changes separately
  if (fieldsToUpdate.email && fieldsToUpdate.email !== req.user.email) {
    // Create verification token for the new email
    const verificationToken = crypto.randomBytes(20).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(verificationToken).digest('hex');

    // Find the user and update
    const user = await User.findById(req.user.id);
    user.pendingEmail = fieldsToUpdate.email;
    user.verificationToken = hashedToken;
    user.verificationTokenExpire = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    delete fieldsToUpdate.email; // Don't update email directly

    await user.save();

    // Send verification email
    const verificationUrl = `${req.protocol}://${req.get(
      'host',
    )}/api/v1/auth/verify-email-change/${verificationToken}`;

    const message = `You are receiving this email because you requested an email change. Please visit: \n\n ${verificationUrl}`;

    try {
      await sendEmail({
        email: user.pendingEmail,
        subject: 'Email change verification',
        message,
      });
    } catch (err) {
      user.verificationToken = undefined;
      user.pendingEmail = undefined;
      user.verificationTokenExpire = undefined;
      await user.save({ validateBeforeSave: false });

      return next(new ErrorResponse('Email could not be sent', 500));
    }
  }

  // Update user with any remaining fields
  const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    data: user,
  });
});

// @desc    Update password
// @route   PUT /api/v1/auth/updatepassword
// @access  Private
exports.updatePassword = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('+password');

  // Check current password
  const isMatch = await bcrypt.compare(req.body.currentPassword, user.password);
  if (!isMatch) {
    return next(new ErrorResponse('Password is incorrect', 401));
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(req.body.newPassword, salt);

  await user.save();

  sendTokenResponse(user, 200, res);
});

// @desc    Forgot password
// @route   POST /api/v1/auth/forgotpassword
// @access  Public
exports.forgotPassword = asyncHandler(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    return next(new ErrorResponse('There is no user with that email', 404));
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(20).toString('hex');

  // Hash token and set to resetPasswordToken field
  user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');

  // Set expiration
  user.resetPasswordExpire = Date.now() + 60 * 60 * 1000; // 1 hour

  await user.save({ validateBeforeSave: false });

  // Create reset url
  const resetUrl = `${req.protocol}://${req.get('host')}/api/v1/auth/resetpassword/${resetToken}`;

  const message = `You are receiving this email because you requested the reset of a password. Please visit: \n\n ${resetUrl}`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Password reset token',
      message,
    });

    res.status(200).json({ success: true, data: 'Email sent' });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save({ validateBeforeSave: false });

    return next(new ErrorResponse('Email could not be sent', 500));
  }
});

// @desc    Reset password
// @route   PUT /api/v1/auth/resetpassword/:resettoken
// @access  Public
exports.resetPassword = asyncHandler(async (req, res, next) => {
  // Get hashed token
  const resetPasswordToken = crypto
    .createHash('sha256')
    .update(req.params.resettoken)
    .digest('hex');

  const user = await User.findOne({
    resetPasswordToken,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorResponse('Invalid token', 400));
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(req.body.password, salt);

  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  sendTokenResponse(user, 200, res);
});

// @desc    Verify email
// @route   GET /api/v1/auth/verify-email/:verificationtoken
// @access  Public
exports.verifyEmail = asyncHandler(async (req, res, next) => {
  // Get hashed token
  const verificationToken = crypto
    .createHash('sha256')
    .update(req.params.verificationtoken)
    .digest('hex');

  const user = await User.findOne({
    verificationToken,
    verificationTokenExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorResponse('Invalid token', 400));
  }

  // Set email as verified
  user.emailVerified = true;
  user.accountStatus = 'active';
  user.verificationToken = undefined;
  user.verificationTokenExpire = undefined;
  await user.save();

  sendTokenResponse(user, 200, res);
});

// @desc    Verify email change
// @route   GET /api/v1/auth/verify-email-change/:verificationtoken
// @access  Public
exports.verifyEmailChange = asyncHandler(async (req, res, next) => {
  // Get hashed token
  const verificationToken = crypto
    .createHash('sha256')
    .update(req.params.verificationtoken)
    .digest('hex');

  const user = await User.findOne({
    verificationToken,
    verificationTokenExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorResponse('Invalid token', 400));
  }

  // Update email
  user.email = user.pendingEmail;
  user.emailVerified = true;
  user.pendingEmail = undefined;
  user.verificationToken = undefined;
  user.verificationTokenExpire = undefined;
  await user.save();

  sendTokenResponse(user, 200, res);
});

// @desc    Get all users (admin only)
// @route   GET /api/v1/auth/users
// @access  Private (Admin)
exports.getUsers = asyncHandler(async (req, res, next) => {
  // Check for admin permission
  const hasPermission = await checkPermission(req.user.id, 'view_all_users');
  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to access this resource', 403));
  }

  res.status(200).json(res.advancedResults);
});

// @desc    Get single user (admin only)
// @route   GET /api/v1/auth/users/:id
// @access  Private (Admin)
exports.getUser = asyncHandler(async (req, res, next) => {
  // Check for admin permission
  const hasPermission = await checkPermission(req.user.id, 'view_all_users');
  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to access this resource', 403));
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  res.status(200).json({
    success: true,
    data: user,
  });
});

// @desc    Create new user (admin only)
// @route   POST /api/v1/auth/users
// @access  Private (Admin)
exports.createUser = asyncHandler(async (req, res, next) => {
  // Check for admin permission
  const hasPermission = await checkPermission(req.user.id, 'create_users');
  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to access this resource', 403));
  }

  // Hash password if provided
  if (req.body.password) {
    const salt = await bcrypt.genSalt(10);
    req.body.password = await bcrypt.hash(req.body.password, salt);
  }

  const user = await User.create(req.body);

  res.status(201).json({
    success: true,
    data: user,
  });
});

// @desc    Update user (admin only)
// @route   PUT /api/v1/auth/users/:id
// @access  Private (Admin)
exports.updateUser = asyncHandler(async (req, res, next) => {
  // Check for admin permission
  const hasPermission = await checkPermission(req.user.id, 'update_users');
  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to access this resource', 403));
  }

  // Don't allow password updates through this route
  if (req.body.password) {
    delete req.body.password;
  }

  const user = await User.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  res.status(200).json({
    success: true,
    data: user,
  });
});

// @desc    Delete user (admin only)
// @route   DELETE /api/v1/auth/users/:id
// @access  Private (Admin)
exports.deleteUser = asyncHandler(async (req, res, next) => {
  // Check for admin permission
  const hasPermission = await checkPermission(req.user.id, 'delete_users');
  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to access this resource', 403));
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  // Perform a soft delete
  user.isDeleted = true;
  user.deletedAt = Date.now();
  user.accountStatus = 'deleted';
  await user.save();

  res.status(200).json({
    success: true,
    data: {},
  });
});

// @desc    Assign role to user
// @route   POST /api/v1/auth/users/:userId/roles
// @access  Private (Admin only)
exports.assignRole = asyncHandler(async (req, res, next) => {
  const { roleId, subredditId } = req.body;

  // Verify the user exists
  const user = await User.findById(req.params.userId);
  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.userId}`, 404));
  }

  // Verify the role exists
  const role = await Role.findById(roleId);
  if (!role) {
    return next(new ErrorResponse(`Role not found with id of ${roleId}`, 404));
  }

  // Check if user has permission to assign roles
  const hasPermission = await checkPermission(req.user.id, 'assign_roles', subredditId);
  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to assign roles', 403));
  }

  // Check for existing assignment to avoid duplicates
  const existingAssignment = await UserRoleAssignment.findOne({
    user: req.params.userId,
    role: roleId,
    subreddit: subredditId || undefined,
  });

  if (existingAssignment) {
    return next(new ErrorResponse('User already has this role assignment', 400));
  }

  // Create new role assignment
  const assignment = await UserRoleAssignment.create({
    user: req.params.userId,
    role: roleId,
    scope: role.scope,
    subreddit: subredditId || undefined,
  });

  res.status(201).json({
    success: true,
    data: assignment,
  });
});

// @desc    Remove role from user
// @route   DELETE /api/v1/auth/users/:userId/roles/:assignmentId
// @access  Private (Admin only)
exports.removeRole = asyncHandler(async (req, res, next) => {
  const assignment = await UserRoleAssignment.findById(req.params.assignmentId).populate('role');

  if (!assignment) {
    return next(new ErrorResponse(`Role assignment not found`, 404));
  }

  // Check if assignment belongs to the user
  if (assignment.user.toString() !== req.params.userId) {
    return next(new ErrorResponse(`Role assignment does not belong to this user`, 400));
  }

  // Check if user has permission to remove roles
  const hasPermission = await checkPermission(
    req.user.id,
    'assign_roles',
    assignment.subreddit ? assignment.subreddit.toString() : null,
  );

  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to remove roles', 403));
  }

  // Prevent removal of system roles if they're marked as required
  if (assignment.role.isSystem && assignment.role.isDefault) {
    return next(new ErrorResponse('Cannot remove required system role', 400));
  }

  await assignment.remove();

  res.status(200).json({
    success: true,
    data: {},
  });
});

// @desc    Suspend user
// @route   PUT /api/v1/auth/users/:id/suspend
// @access  Private (Admin or Moderator)
exports.suspendUser = asyncHandler(async (req, res, next) => {
  const { reason } = req.body;

  // Check for suspend permission
  const hasPermission = await checkPermission(req.user.id, 'suspend_users');
  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to suspend users', 403));
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  // Update user status
  user.accountStatus = 'suspended';
  user.suspensionReason = reason || 'Violated terms of service';
  await user.save();

  res.status(200).json({
    success: true,
    data: user,
  });
});

// @desc    Unsuspend user
// @route   PUT /api/v1/auth/users/:id/unsuspend
// @access  Private (Admin or Moderator)
exports.unsuspendUser = asyncHandler(async (req, res, next) => {
  // Check for suspend permission
  const hasPermission = await checkPermission(req.user.id, 'suspend_users');
  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to manage user suspensions', 403));
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  // Only update if user is suspended
  if (user.accountStatus !== 'suspended') {
    return next(new ErrorResponse(`User is not suspended`, 400));
  }

  // Update user status
  user.accountStatus = 'active';
  user.suspensionReason = undefined;
  await user.save();

  res.status(200).json({
    success: true,
    data: user,
  });
});

// @desc    Get user activity (posts and comments)
// @route   GET /api/v1/auth/users/:id/activity
// @access  Public
exports.getUserActivity = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  // Get user's posts
  const posts = await Post.find({
    author: user._id,
    isDeleted: { $ne: true },
  })
    .sort('-createdAt')
    .limit(10)
    .populate('subreddit', 'name');

  // Get user's comments
  const comments = await Comment.find({
    author: user._id,
    isDeleted: { $ne: true },
  })
    .sort('-createdAt')
    .limit(10)
    .populate({
      path: 'post',
      select: 'title subreddit',
      populate: {
        path: 'subreddit',
        select: 'name',
      },
    });

  res.status(200).json({
    success: true,
    data: {
      posts,
      comments,
    },
  });
});

// @desc    Get user's karma breakdown
// @route   GET /api/v1/auth/users/:id/karma
// @access  Public
exports.getUserKarma = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  res.status(200).json({
    success: true,
    data: {
      totalKarma: user.totalKarma,
      breakdown: user.karma,
    },
  });
});

// @desc    Get user's role assignments
// @route   GET /api/v1/auth/users/:id/roles
// @access  Private (Admin or Self)
exports.getUserRoles = asyncHandler(async (req, res, next) => {
  // Check if user is requesting their own roles or has permission
  if (req.params.id !== req.user.id) {
    const hasPermission = await checkPermission(req.user.id, 'view_all_users');
    if (!hasPermission) {
      return next(new ErrorResponse("Not authorized to view other users' roles", 403));
    }
  }

  const assignments = await UserRoleAssignment.find({ user: req.params.id })
    .populate('role')
    .populate('subreddit', 'name');

  res.status(200).json({
    success: true,
    count: assignments.length,
    data: assignments,
  });
});

// @desc    Get all available permissions
// @route   GET /api/v1/auth/permissions
// @access  Private (Admin)
exports.getPermissions = asyncHandler(async (req, res, next) => {
  // Check for admin permission
  const hasPermission = await checkPermission(req.user.id, 'manage_roles');
  if (!hasPermission) {
    return next(new ErrorResponse('Not authorized to view permissions', 403));
  }

  const permissions = await Permission.find();

  res.status(200).json({
    success: true,
    count: permissions.length,
    data: permissions,
  });
});

// @desc    Check if user has specific permission
// @route   GET /api/v1/auth/check-permission/:permissionName
// @access  Private
exports.checkUserPermission = asyncHandler(async (req, res, next) => {
  const { permissionName } = req.params;
  const { subredditId } = req.query;

  const hasPermission = await checkPermission(req.user.id, permissionName, subredditId);

  res.status(200).json({
    success: true,
    data: {
      hasPermission,
    },
  });
});

module.exports = exports;
