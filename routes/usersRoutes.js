const express = require('express');
const {
  isAuthenticated,
  hasRole,
  isAdmin,
  hasPermission,
  rateLimit,
} = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  updateProfile,
  updateProfilePicture,
  updatePassword,
  verifyEmail,
  updateUsername,
  getUserKarma,
  getUserPosts,
  getUserComments,
  getUserSavedItems,
  getUserSubreddits,
  getUserModeratedSubreddits,
  getUserStatistics,
  getUserAwards,
  getUserStorageStats,
  permanentlyDeleteAccount,
  // Rol ve izin yönetimi için eklenmesi gereken controller fonksiyonları
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  getUserPermissions,
} = require('../controllers/userController');

const router = express.Router();

/**
 * Rate limiting configuration
 * - Standard limit: 50 requests per hour for general endpoints
 * - Profile update limit: 10 requests per hour
 * - Role management limit: 20 requests per hour
 */
const standardLimit = rateLimit('/api/users', 50, 60 * 60 * 1000);
const updateLimit = rateLimit('/api/users/profile', 10, 60 * 60 * 1000);
const roleManagementLimit = rateLimit('/api/users/roles', 20, 60 * 60 * 1000);

// Admin routes
router
  .route('/')
  .get(isAuthenticated, isAdmin, standardLimit, getUsers) // Get all users (admin only)
  .post(isAuthenticated, isAdmin, standardLimit, createUser); // Create user (admin only)

router
  .route('/:id')
  .get(standardLimit, getUser) // Get user by ID (public)
  .put(isAuthenticated, isAdmin, standardLimit, updateUser) // Update user (admin only)
  .delete(isAuthenticated, isAdmin, standardLimit, deleteUser); // Delete user (admin only)

// User profile management
router.route('/profile').put(isAuthenticated, updateLimit, updateProfile); // Update current user's profile

router.route('/profile/picture').put(isAuthenticated, updateLimit, updateProfilePicture); // Update profile picture

router.route('/password').put(isAuthenticated, updateLimit, updatePassword); // Update password

router.route('/username').put(isAuthenticated, updateLimit, updateUsername); // Update username

router.route('/account').delete(isAuthenticated, standardLimit, permanentlyDeleteAccount); // Permanently delete account

// Email verification
router.get('/verify-email/:token', standardLimit, verifyEmail);

// User data retrieval
router.get('/:id/karma', standardLimit, getUserKarma); // Get user karma
router.get('/:id/posts', standardLimit, getUserPosts); // Get user posts
router.get('/:id/comments', standardLimit, getUserComments); // Get user comments
router.get('/:id/saved', isAuthenticated, standardLimit, getUserSavedItems); // Get saved items (private)
router.get('/:id/subreddits', standardLimit, getUserSubreddits); // Get subscribed subreddits
router.get('/:id/moderating', standardLimit, getUserModeratedSubreddits); // Get moderated subreddits
router.get('/:id/statistics', standardLimit, getUserStatistics); // Get user statistics
router.get('/:id/awards', standardLimit, getUserAwards); // Get user awards

// Storage statistics (only visible to self or admin)
router.get(
  '/:id/storage',
  isAuthenticated,
  standardLimit,
  (req, res, next) => {
    // Custom middleware to verify user is requesting their own data or is admin
    if (req.user.id === req.params.id || req.user.role === 'admin') {
      next();
    } else {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view this information',
      });
    }
  },
  getUserStorageStats,
);

// Follow/unfollow users
router.post('/:id/follow', isAuthenticated, standardLimit, (req, res) => {
  // This is a placeholder for user following functionality
  res.status(501).json({
    success: false,
    message: 'Follow functionality not implemented yet',
  });
});

router.delete('/:id/follow', isAuthenticated, standardLimit, (req, res) => {
  // This is a placeholder for user unfollowing functionality
  res.status(501).json({
    success: false,
    message: 'Unfollow functionality not implemented yet',
  });
});

// Moderation endpoints for user handling
router.put('/:id/ban', isAuthenticated, hasPermission('banUser'), standardLimit, (req, res) => {
  // This is a placeholder for banning users from subreddits
  res.status(501).json({
    success: false,
    message: 'Ban functionality not implemented yet',
  });
});

router.put('/:id/mute', isAuthenticated, hasPermission('muteUser'), standardLimit, (req, res) => {
  // This is a placeholder for muting users in subreddits
  res.status(501).json({
    success: false,
    message: 'Mute functionality not implemented yet',
  });
});

// ============= ROL VE İZİN YÖNETİMİ ENDPOINT'LERİ =============

/**
 * Kullanıcının rollerini getir
 * Site kapsamlı ve subreddit kapsamlı rolleri içerir
 * @route GET /api/users/:id/roles
 * @access Private (Self or Admin)
 */
router.get(
  '/:id/roles',
  isAuthenticated,
  standardLimit,
  (req, res, next) => {
    // Kullanıcı kendisi veya admin mi kontrol et
    if (req.user.id === req.params.id || req.user.role === 'admin') {
      next();
    } else {
      return res.status(403).json({
        success: false,
        message: 'Bu bilgileri görüntüleme yetkiniz yok',
      });
    }
  },
  getUserRoles,
);

/**
 * Kullanıcıya genel/site kapsamlı rol ata
 * @route POST /api/users/:id/roles
 * @access Private (Admin)
 */
router.post('/:id/roles', isAuthenticated, isAdmin, roleManagementLimit, assignRoleToUser);

/**
 * Kullanıcıdan rol kaldır
 * @route DELETE /api/users/:id/roles/:roleId
 * @access Private (Admin)
 */
router.delete(
  '/:id/roles/:roleId',
  isAuthenticated,
  isAdmin,
  roleManagementLimit,
  removeRoleFromUser,
);

/**
 * Kullanıcının izinlerini getir (rolleri üzerinden)
 * @route GET /api/users/:id/permissions
 * @access Private (Self or Admin)
 */
router.get(
  '/:id/permissions',
  isAuthenticated,
  standardLimit,
  (req, res, next) => {
    // Kullanıcı kendisi veya admin mi kontrol et
    if (req.user.id === req.params.id || req.user.role === 'admin') {
      next();
    } else {
      return res.status(403).json({
        success: false,
        message: 'Bu bilgileri görüntüleme yetkiniz yok',
      });
    }
  },
  getUserPermissions,
);

/**
 * Kullanıcıya özel bir subreddit için rol ata
 * @route POST /api/users/:id/subreddits/:subredditId/roles
 * @access Private (Subreddit Admin or Site Admin)
 */
router.post(
  '/:id/subreddits/:subredditId/roles',
  isAuthenticated,
  roleManagementLimit,
  checkPermission('role:assign', 'subredditId'),
  (req, res) => {
    // Bu endpoint'i subreddit yöneticisi veya site yöneticisi kullanabilir
    // Bir kullanıcıya bir subreddit içinde özel rol atamak için kullanılır
    // (Örn: moderatör, sponsor, onaylı kullanıcı vs)

    res.status(501).json({
      success: false,
      message: 'Subreddit rol atama fonksiyonu henüz uygulanmadı',
    });
  },
);

/**
 * Kullanıcının subreddit rolünü kaldır
 * @route DELETE /api/users/:id/subreddits/:subredditId/roles/:roleId
 * @access Private (Subreddit Admin or Site Admin)
 */
router.delete(
  '/:id/subreddits/:subredditId/roles/:roleId',
  isAuthenticated,
  roleManagementLimit,
  checkPermission('role:remove', 'subredditId'),
  (req, res) => {
    res.status(501).json({
      success: false,
      message: 'Subreddit rol kaldırma fonksiyonu henüz uygulanmadı',
    });
  },
);

/**
 * Kullanıcının rol atama geçmişini görüntüle
 * @route GET /api/users/:id/role-history
 * @access Private (Admin)
 */
router.get('/:id/role-history', isAuthenticated, isAdmin, standardLimit, (req, res) => {
  res.status(501).json({
    success: false,
    message: 'Rol atama geçmişi fonksiyonu henüz uygulanmadı',
  });
});

module.exports = router;
