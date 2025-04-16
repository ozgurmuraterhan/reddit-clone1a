const express = require('express');
const passport = require('passport');
const { isAuthenticated, csrfProtection, rateLimit, generateToken } = require('../middleware/auth');
const {
  register,
  verifyEmail,
  login,
  socialAuth,
  getMe,
  logout,
  updatePassword,
  forgotPassword,
  resetPassword,
  updateProfile,
  deleteAccount,
} = require('../controllers/authController');

const router = express.Router();

/**
 * Rate limiting configuration
 * - Standard limit: 100 requests per hour for most auth endpoints
 * - Login limit: 10 requests per 10 minutes to prevent brute force attacks
 * - Password reset limit: 5 requests per hour to prevent abuse
 */
const standardLimit = rateLimit('/api/auth', 100, 60 * 60 * 1000);
const loginLimit = rateLimit('/api/auth/login', 10, 10 * 60 * 1000);
const passwordResetLimit = rateLimit('/api/auth/reset-password', 5, 60 * 60 * 1000);

// Local authentication routes
router.post('/register', standardLimit, register);
router.post('/login', loginLimit, login);
router.get('/verify-email/:token', standardLimit, verifyEmail);
router.post('/forgot-password', standardLimit, forgotPassword);
router.put('/reset-password/:token', passwordResetLimit, resetPassword);
router.get('/me', isAuthenticated, getMe);
router.post('/logout', isAuthenticated, logout);

// User profile management
router.put('/update-password', isAuthenticated, standardLimit, updatePassword);
router.put('/update-profile', isAuthenticated, standardLimit, updateProfile);
router.delete('/delete-account', isAuthenticated, csrfProtection, deleteAccount);

// Two-factor authentication (if implemented)
router.post('/verify-2fa', isAuthenticated, standardLimit, (req, res) => {
  // This is a placeholder. Implement this route if 2FA is supported
  res.status(501).json({
    success: false,
    message: 'Two-factor authentication not implemented yet',
  });
});

// Social authentication routes - direct provider auth
router.post('/social/:provider', standardLimit, socialAuth);

// Google OAuth routes
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
  }),
);

router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login',
    session: false,
  }),
  (req, res) => {
    // Create JWT token after successful authentication
    const token = generateToken(req.user);

    // Redirect to frontend with token or return token in development
    if (process.env.NODE_ENV === 'production') {
      res.redirect(`${process.env.FRONTEND_URL}/auth/social-callback?token=${token}`);
    } else {
      res.json({ success: true, token, user: req.user });
    }
  },
);

// Facebook OAuth routes
router.get(
  '/facebook',
  passport.authenticate('facebook', {
    scope: ['email'],
  }),
);

router.get(
  '/facebook/callback',
  passport.authenticate('facebook', {
    failureRedirect: '/login',
    session: false,
  }),
  (req, res) => {
    // Create JWT token after successful authentication
    const token = generateToken(req.user);

    // Redirect to frontend with token or return token in development
    if (process.env.NODE_ENV === 'production') {
      res.redirect(`${process.env.FRONTEND_URL}/auth/social-callback?token=${token}`);
    } else {
      res.json({ success: true, token, user: req.user });
    }
  },
);

// Connect social accounts to existing profile
router.get(
  '/connect/google',
  isAuthenticated,
  passport.authorize('google', {
    scope: ['profile', 'email'],
  }),
);

router.get(
  '/connect/facebook',
  isAuthenticated,
  passport.authorize('facebook', {
    scope: ['email'],
  }),
);

// Handle social account connection callbacks
router.get(
  '/connect/:provider/callback',
  isAuthenticated,
  (req, res, next) => {
    const { provider } = req.params;
    if (!['google', 'facebook'].includes(provider)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid provider',
      });
    }

    passport.authorize(provider, {
      failureRedirect: '/settings/profile',
    })(req, res, next);
  },
  (req, res) => {
    res.redirect(`${process.env.FRONTEND_URL}/settings/profile?connected=true`);
  },
);

// Disconnect social accounts
router.post('/disconnect/:provider', isAuthenticated, csrfProtection, standardLimit, (req, res) => {
  const { provider } = req.params;

  // This is a placeholder. Implement actual disconnection logic
  res.status(501).json({
    success: false,
    message: `Disconnecting ${provider} not implemented yet`,
  });
});

// Get CSRF token (for forms that need CSRF protection)
router.get('/csrf-token', (req, res) => {
  res.json({
    success: true,
    csrfToken: req.session.csrfToken,
  });
});

module.exports = router;
