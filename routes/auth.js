const express = require('express');
const passport = require('passport');
const { isAuthenticated, csrfProtection, rateLimit } = require('../middleware/auth');
const {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getMe,
  logout,
  verify2FA
} = require('../controllers/authController');

const router = express.Router();

// Rate limiting uygulaması
const standardLimit = rateLimit('/api/auth', 100, 60 * 60 * 1000); // 100 istek/saat
const loginLimit = rateLimit('/api/auth/login', 10, 10 * 60 * 1000); // 10 istek/10 dakika

// Yerel kimlik doğrulama rotaları
router.post('/register', standardLimit, register);
router.post('/login', loginLimit, login);
router.get('/verify/:token', standardLimit, verifyEmail);
router.post('/forgot-password', standardLimit, forgotPassword);
router.put('/reset-password/:token', standardLimit, resetPassword);
router.get('/me', isAuthenticated, getMe);
router.post('/logout', isAuthenticated, logout);
router.post('/verify-2fa', isAuthenticated, standardLimit, verify2FA);

// Google OAuth rotaları
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

router.get('/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login',
    session: false
  }),
  (req, res) => {
    // Başarılı kimlik doğrulama sonrası JWT token oluştur
    const { generateToken } = require('../middleware/auth');
    const token = generateToken(req.user);

    // Token'ı frontend'e ilet
    // Not: Bu genellikle bir redirect URL ile yapılır
    if (process.env.NODE_ENV === 'production') {
      res.redirect(`${process.env.APP_URL}/auth/social-callback?token=${token}`);
    } else {
      res.json({ success: true, token, user: req.user });
    }
  }
);

// Facebook OAuth rotaları
router.get('/facebook', passport.authenticate('facebook', {
  scope: ['email']
}));

router.get('/facebook/callback',
  passport.authenticate('facebook', {
    failureRedirect: '/login',
    session: false
  }),
  (req, res) => {
    // Başarılı kimlik doğrulama sonrası JWT token oluştur
    const { generateToken } = require('../middleware/auth');
    const token = generateToken(req.user);

    // Token'ı frontend'e ilet
    if (process.env.NODE_ENV === 'production') {
      res.redirect(`${process.env.APP_URL}/auth/social-callback?token=${token}`);
    } else {
      res.json({ success: true, token, user: req.user });
    }
  }
);

// Sosyal hesapların bağlanması (hesap birleştirme)
router.get('/connect/google', isAuthenticated, passport.authorize('google', {
  scope: ['profile', 'email']
}));

router.get('/connect/facebook', isAuthenticated, passport.authorize('facebook', {
  scope: ['email']
}));

module.exports = router;
