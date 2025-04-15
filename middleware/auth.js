const passport = require('passport');
const jwt = require('jsonwebtoken');
const { userHasRole, userHasPermission } = require('../helpers/authHelpers');

// JWT token oluştur
const generateToken = (user) => {
  const payload = {
    id: user._id,
    username: user.username,
    email: user.email
  };

  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '1d' }
  );
};

// Kullanıcı giriş yapmış mı kontrol et
const isAuthenticated = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Yetkilendirme başarısız. Lütfen giriş yapın.'
      });
    }

    // Kullanıcıyı req nesnesine ekle
    req.user = user;
    next();
  })(req, res, next);
};

// Kullanıcının belirli rollere sahip olup olmadığını kontrol et
const hasRole = (roles) => {
  return async (req, res, next) => {
    try {
      // Kullanıcı giriş yapmış mı kontrol et
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Yetkilendirme başarısız. Lütfen giriş yapın.'
        });
      }

      // Subreddit ID'si varsa al
      const subredditId = req.params.subredditId || req.body.subredditId || null;

      // Kullanıcının rollerini kontrol et
      const hasRequiredRole = await userHasRole(req.user._id, roles, subredditId);

      if (!hasRequiredRole) {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için gerekli yetkiniz yok.'
        });
      }

          next();
        } catch (error) {
          next(error);
        }
      };
};

// Kullanıcının içerik sahibi olup olmadığını kontrol et
const isContentOwner = (modelName, idParam) => {
      return async (req, res, next) => {
        try {
          // Kullanıcı giriş yapmış mı kontrol et
          if (!req.user) {
            return res.status(401).json({
              success: false,
              message: 'Yetkilendirme başarısız. Lütfen giriş yapın.'
            });
          }

          const id = req.params[idParam];

          if (!id) {
            return res.status(400).json({
              success: false,
              message: `${idParam} parametresi bulunamadı.`
            });
          }

          // Modeli dinamik olarak seç
          const Model = require(`../models`)[modelName];

          if (!Model) {
            return res.status(500).json({
              success: false,
              message: `Model bulunamadı: ${modelName}`
            });
          }

          // İçeriği bul
          const content = await Model.findById(id);

          if (!content) {
            return res.status(404).json({
              success: false,
              message: 'İçerik bulunamadı.'
            });
          }

          // Kullanıcının içerik sahibi olup olmadığını kontrol et
          const isOwner = content.author &&
                         content.author.toString() === req.user._id.toString();

          if (!isOwner) {
            return res.status(403).json({
              success: false,
              message: 'Bu içeriğin sahibi değilsiniz.'
            });
          }

          // İçeriği req nesnesine ekle
          req.content = content;
          next();
        } catch (error) {
          next(error);
        }
      };
};

// Admin kontrolü
const isAdmin = async (req, res, next) => {
      try {
        // Kullanıcı giriş yapmış mı kontrol et
        if (!req.user) {
          return res.status(401).json({
            success: false,
            message: 'Yetkilendirme başarısız. Lütfen giriş yapın.'
          });
        }

        // Kullanıcının admin rolünü kontrol et
        const isUserAdmin = await userHasRole(req.user._id, 'admin');

        if (!isUserAdmin) {
          return res.status(403).json({
            success: false,
            message: 'Bu işlem için admin yetkisi gerekiyor.'
          });
        }

        next();
      } catch (error) {
        next(error);
      }
};

// İki faktörlü doğrulama kontrolü (TwoFactorAuth modeli varsa)
const require2FA = async (req, res, next) => {
      try {
        // Kullanıcı giriş yapmış mı kontrol et
        if (!req.user) {
          return res.status(401).json({
            success: false,
            message: 'Yetkilendirme başarısız. Lütfen giriş yapın.'
          });
        }

        // TwoFactorAuth modeli mevcut mu kontrol et
        let TwoFactorAuth;
        try {
          TwoFactorAuth = require('../models/TwoFactorAuth');
        } catch (err) {
          // Model yoksa, kontrolü atla
          return next();
        }

        // Kullanıcı için 2FA durumunu kontrol et
        const twoFactorAuth = await TwoFactorAuth.findOne({ user: req.user._id });

        if (twoFactorAuth && twoFactorAuth.isEnabled) {
          // 2FA aktif ama doğrulanmamış
          if (!req.session.twoFactorVerified) {
            return res.status(403).json({
              success: false,
              message: 'İki faktörlü doğrulama gerekli.',
              require2FA: true
            });
          }
        }

        next();
      } catch (error) {
        next(error);
      }
};

// CSRF token kontrolü
const csrfProtection = (req, res, next) => {
      // CSRF token başlıkta veya body'de olabilir
      const token = req.headers['x-csrf-token'] || req.body._csrf;

      if (!token || token !== req.session.csrfToken) {
        return res.status(403).json({
          success: false,
          message: 'CSRF doğrulama hatası.'
        });
      }

      next();
};

// Rate limiting kontrolü (RateLimit modeli varsa)
const rateLimit = (endpoint, limit = 100, period = 60 * 60 * 1000) => {
      return async (req, res, next) => {
        try {
          // Kullanıcı giriş yapmış mı kontrol et
          if (!req.user) {
            // Anonim kullanıcılar için IP tabanlı rate limiting
            // Burada IP tabanlı rate limiting uygulanabilir
            return next();
          }

          // RateLimit modeli mevcut mu kontrol et
          let RateLimit;
          try {
            RateLimit = require('../models/RateLimit');
          } catch (err) {
            // Model yoksa, rate limiting'i atla
            return next();
          }

          const now = new Date();

          // Kullanıcı için rate limit kaydını bul veya oluştur
          let rateLimit = await RateLimit.findOne({
            user: req.user._id,
            endpoint,
            method: req.method,
            resetAt: { $gt: now }
          });

          if (!rateLimit) {
            // Yeni rate limit kaydı oluştur
            const resetAt = new Date(now.getTime() + period);

            rateLimit = new RateLimit({
              user: req.user._id,
              endpoint,
              method: req.method,
              count: 1,
              resetAt,
              ipAddress: req.ip
            });

            await rateLimit.save();
            return next();
          }

          // Rate limit kontrolü
          if (rateLimit.count >= limit) {
            return res.status(429).json({
              success: false,
              message: 'Çok fazla istek gönderdiniz. Lütfen daha sonra tekrar deneyin.',
              retryAfter: Math.ceil((rateLimit.resetAt - now) / 1000)
            });
          }

          // Rate limit sayacını arttır
          rateLimit.count += 1;
          await rateLimit.save();

          next();
        } catch (error) {
          next(error);
        }
      };
};

module.exports = {
      generateToken,
      isAuthenticated,
      hasRole,
      hasPermission,
      isModeratorOf,
      isContentOwner,
      isAdmin,
      require2FA,
      csrfProtection,
      rateLimit
};      next(error);
    }
  };
};

// Kullanıcının belirli izinlere sahip olup olmadığını kontrol et
const hasPermission = (permissions) => {
  return async (req, res, next) => {
    try {
      // Kullanıcı giriş yapmış mı kontrol et
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Yetkilendirme başarısız. Lütfen giriş yapın.'
        });
      }

      // Subreddit ID'si varsa al
      const subredditId = req.params.subredditId || req.body.subredditId || null;

      // Kullanıcının izinlerini kontrol et
      const hasRequiredPermission = await userHasPermission(req.user._id, permissions, subredditId);

      if (!hasRequiredPermission) {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için gerekli izniniz yok.'
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Kullanıcının moderatör olup olmadığını kontrol et
const isModeratorOf = (subredditParamName = 'subredditId') => {
  return async (req, res, next) => {
    try {
      // Kullanıcı giriş yapmış mı kontrol et
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Yetkilendirme başarısız. Lütfen giriş yapın.'
        });
      }

      // Subreddit ID'si al
      const subredditId = req.params[subredditParamName] || req.body[subredditParamName];

      if (!subredditId) {
        return res.status(400).json({
          success: false,
          message: 'Subreddit ID bulunamadı.'
        });
      }

      // Kullanıcının moderatör rolünü kontrol et
      const isModerator = await userHasRole(req.user._id, ['moderator', 'admin'], subredditId);

      if (!isModerator) {
        return res.status(403).json({
          success: false,
          message: 'Bu subreddit için moderatör değilsiniz.'
        });
      }

      next();
    } catch (error) {
      next(
