const passport = require('passport');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Role = require('../models/Role');
const Permission = require('../models/Permission');
const SubredditMembership = require('../models/SubredditMembership');

/**
 * JWT token oluştur
 * @param {Object} user - Kullanıcı objesi
 * @returns {String} JWT token
 */
const generateToken = (user) => {
  const payload = {
    id: user._id,
    username: user.username,
    email: user.email,
  };

  return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '1d' });
};

/**
 * Kullanıcının belirli bir rolü olup olmadığını kontrol eder
 * @param {String} userId - Kullanıcı ID
 * @param {String|Array} roles - Rol veya roller
 * @param {String} subredditId - Subreddit ID (opsiyonel)
 * @returns {Boolean} Kullanıcının rolü var mı
 */
const userHasRole = async (userId, roles, subredditId = null) => {
  try {
    // Roller diziye dönüştür
    const roleList = Array.isArray(roles) ? roles : [roles];

    // Site geneli rol kontrolü
    if (subredditId === null) {
      // Admin rolü varsa doğrudan kontrol et (performans için)
      if (roleList.includes('admin')) {
        const user = await User.findById(userId);
        if (user && user.role === 'admin') {
          return true;
        }
      }

      // Kullanıcı rol atamaları
      const UserRoleAssignment = mongoose.model('UserRoleAssignment');
      const assignments = await UserRoleAssignment.find({
        user: userId,
        scope: 'site',
      }).populate('role');

      return assignments.some((assignment) => roleList.includes(assignment.role.name));
    }
    // Subreddit kapsamlı rol kontrolü
    else {
      // Admin rolü varsa doğrudan kontrol et (tüm subredditlere erişim)
      if (roleList.includes('admin')) {
        const user = await User.findById(userId);
        if (user && user.role === 'admin') {
          return true;
        }
      }

      // Moderatör kontrolü
      if (roleList.includes('moderator')) {
        const membership = await SubredditMembership.findOne({
          user: userId,
          subreddit: subredditId,
          isModerator: true,
          status: 'active',
        });

        if (membership) {
          return true;
        }
      }

      // Özel subreddit rolleri için kontrol
      const UserRoleAssignment = mongoose.model('UserRoleAssignment');
      const assignments = await UserRoleAssignment.find({
        user: userId,
        subreddit: subredditId,
        scope: 'subreddit',
      }).populate('role');

      return assignments.some((assignment) => roleList.includes(assignment.role.name));
    }
  } catch (error) {
    console.error('Rol kontrolü hatası:', error);
    return false;
  }
};

/**
 * Kullanıcının belirli izinlere sahip olduğunu kontrol eder
 * @param {String} userId - Kullanıcı ID
 * @param {String|Array} permissions - İzin veya izinler
 * @param {String} subredditId - Subreddit ID (opsiyonel)
 * @returns {Boolean} Kullanıcının izni var mı
 */
const userHasPermission = async (userId, permissions, subredditId = null) => {
  try {
    // İzinleri diziye dönüştür
    const permissionList = Array.isArray(permissions) ? permissions : [permissions];

    // Admin kontrolü (adminler tüm izinlere sahiptir)
    const isAdmin = await userHasRole(userId, 'admin');
    if (isAdmin) return true;

    // Belirtilen izin adlarına karşılık gelen izin ID'lerini bul
    const permissionDocs = await Permission.find({
      name: { $in: permissionList },
    });

    const permissionIds = permissionDocs.map((p) => p._id);

    // Kullanıcı rol atamalarını getir
    const UserRoleAssignment = mongoose.model('UserRoleAssignment');
    let roleAssignments;

    if (subredditId) {
      // Subreddit kapsamlı veya her iki kapsama da uygun roller
      roleAssignments = await UserRoleAssignment.find({
        user: userId,
        $or: [{ scope: 'subreddit', subreddit: subredditId }, { scope: 'site' }],
      }).populate({
        path: 'role',
        populate: { path: 'permissions' },
      });

      // Ayrıca moderatör kontrolü
      const isModerator = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
        isModerator: true,
        status: 'active',
      });

      if (isModerator) {
        // Moderatör rolünü bul ve izinlerini kontrol et
        const modRole = await Role.findOne({ name: 'moderator', scope: 'subreddit' }).populate(
          'permissions',
        );

        if (modRole) {
          const hasPermission = modRole.permissions.some((p) => permissionIds.includes(p._id));

          if (hasPermission) return true;
        }
      }
    } else {
      // Sadece site kapsamlı roller
      roleAssignments = await UserRoleAssignment.find({
        user: userId,
        scope: 'site',
      }).populate({
        path: 'role',
        populate: { path: 'permissions' },
      });
    }

    // Rol atamalarına göre izinleri kontrol et
    for (const assignment of roleAssignments) {
      if (assignment.role && assignment.role.permissions) {
        const rolePermissionIds = assignment.role.permissions.map((p) =>
          p._id ? p._id.toString() : p.toString(),
        );

        for (const permId of permissionIds) {
          if (rolePermissionIds.includes(permId.toString())) {
            return true;
          }
        }
      }
    }

    return false;
  } catch (error) {
    console.error('İzin kontrolü hatası:', error);
    return false;
  }
};

/**
 * Kullanıcının bir subreddit'in moderatörü olup olmadığını kontrol eder
 * @param {String} userId - Kullanıcı ID
 * @param {String} subredditId - Subreddit ID
 * @returns {Promise<Boolean>} Moderatör mü
 */
const isModeratorOf = async (userId, subredditId) => {
  // Admin her zaman moderatör yetkilerine sahiptir
  const isAdmin = await userHasRole(userId, 'admin');
  if (isAdmin) return true;

  // Moderatör üyeliği kontrolü
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    isModerator: true,
    status: 'active',
  });

  return !!membership;
};

/**
 * Kullanıcı giriş yapmış mı kontrol et
 * @param {Object} req - Request objesi
 * @param {Object} res - Response objesi
 * @param {Function} next - Next fonksiyonu
 */
const isAuthenticated = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Yetkilendirme başarısız. Lütfen giriş yapın.',
      });
    }

    // Kullanıcıyı req nesnesine ekle
    req.user = user;
    next();
  })(req, res, next);
};

/**
 * Kullanıcının belirli rollere sahip olup olmadığını kontrol et
 * @param {String|Array} roles - Rol veya roller
 * @returns {Function} Middleware
 */
const hasRole = (roles) => {
  return async (req, res, next) => {
    try {
      // Kullanıcı giriş yapmış mı kontrol et
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Yetkilendirme başarısız. Lütfen giriş yapın.',
        });
      }

      // Subreddit ID'si varsa al
      const subredditId = req.params.subredditId || req.body.subredditId || null;

      // Kullanıcının rollerini kontrol et
      const hasRequiredRole = await userHasRole(req.user._id, roles, subredditId);

      if (!hasRequiredRole) {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için gerekli yetkiniz yok.',
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Kullanıcının belirli izinlere sahip olup olmadığını kontrol et
 * @param {String|Array} permissions - İzin veya izinler
 * @returns {Function} Middleware
 */
const hasPermission = (permissions) => {
  return async (req, res, next) => {
    try {
      // Kullanıcı giriş yapmış mı kontrol et
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Yetkilendirme başarısız. Lütfen giriş yapın.',
        });
      }

      // Subreddit ID'si varsa al
      const subredditId = req.params.subredditId || req.body.subredditId || null;

      // Kullanıcının izinlerini kontrol et
      const hasRequiredPermission = await userHasPermission(req.user._id, permissions, subredditId);

      if (!hasRequiredPermission) {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için gerekli izniniz yok.',
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Kullanıcının içerik sahibi olup olmadığını kontrol et
 * @param {String} modelName - Model adı (Post, Comment vb.)
 * @param {String} idParam - Parametre adı (postId, commentId vb.)
 * @returns {Function} Middleware
 */
const isContentOwner = (modelName, idParam) => {
  return async (req, res, next) => {
    try {
      // Kullanıcı giriş yapmış mı kontrol et
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Yetkilendirme başarısız. Lütfen giriş yapın.',
        });
      }

      const id = req.params[idParam];

      if (!id) {
        return res.status(400).json({
          success: false,
          message: `${idParam} parametresi bulunamadı.`,
        });
      }

      // Modeli dinamik olarak seç
      const Model = require(`../models`)[modelName];

      if (!Model) {
        return res.status(500).json({
          success: false,
          message: `Model bulunamadı: ${modelName}`,
        });
      }

      // İçeriği bul
      const content = await Model.findById(id);

      if (!content) {
        return res.status(404).json({
          success: false,
          message: 'İçerik bulunamadı.',
        });
      }

      // Kullanıcının içerik sahibi olup olmadığını kontrol et
      const isOwner = content.author && content.author.toString() === req.user._id.toString();

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Bu içeriğin sahibi değilsiniz.',
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

/**
 * Admin kontrolü
 * @param {Object} req - Request objesi
 * @param {Object} res - Response objesi
 * @param {Function} next - Next fonksiyonu
 */
const isAdmin = async (req, res, next) => {
  try {
    // Kullanıcı giriş yapmış mı kontrol et
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Yetkilendirme başarısız. Lütfen giriş yapın.',
      });
    }

    // Kullanıcının admin rolünü kontrol et
    const isUserAdmin = await userHasRole(req.user._id, 'admin');

    if (!isUserAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gerekiyor.',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Kullanıcının bir subreddit'in moderatörü olup olmadığını kontrol et
 * @param {String} subredditParamName - Subreddit parametre adı
 * @returns {Function} Middleware
 */
const isModeratorOfMiddleware = (subredditParamName = 'subredditId') => {
  return async (req, res, next) => {
    try {
      // Kullanıcı giriş yapmış mı kontrol et
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Yetkilendirme başarısız. Lütfen giriş yapın.',
        });
      }

      // Subreddit ID'si al
      const subredditId = req.params[subredditParamName] || req.body[subredditParamName];

      if (!subredditId) {
        return res.status(400).json({
          success: false,
          message: 'Subreddit ID bulunamadı.',
        });
      }

      // Kullanıcının moderatör olup olmadığını kontrol et
      const isModerator = await isModeratorOf(req.user._id, subredditId);

      if (!isModerator) {
        return res.status(403).json({
          success: false,
          message: 'Bu subreddit için moderatör değilsiniz.',
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * İki faktörlü doğrulama kontrolü (TwoFactorAuth modeli varsa)
 * @param {Object} req - Request objesi
 * @param {Object} res - Response objesi
 * @param {Function} next - Next fonksiyonu
 */
const require2FA = async (req, res, next) => {
  try {
    // Kullanıcı giriş yapmış mı kontrol et
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Yetkilendirme başarısız. Lütfen giriş yapın.',
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
          require2FA: true,
        });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * CSRF token kontrolü
 * @param {Object} req - Request objesi
 * @param {Object} res - Response objesi
 * @param {Function} next - Next fonksiyonu
 */
const csrfProtection = (req, res, next) => {
  // CSRF token başlıkta veya body'de olabilir
  const token = req.headers['x-csrf-token'] || req.body._csrf;

  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({
      success: false,
      message: 'CSRF doğrulama hatası.',
    });
  }

  next();
};

/**
 * Rate limiting kontrolü
 * @param {String} endpoint - Endpoint adı
 * @param {Number} limit - Maksimum istek sayısı
 * @param {Number} period - Periyot (ms)
 * @returns {Function} Middleware
 */
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
      let rateLimitRecord = await RateLimit.findOne({
        user: req.user._id,
        endpoint,
        method: req.method,
        resetAt: { $gt: now },
      });

      if (!rateLimitRecord) {
        // Yeni rate limit kaydı oluştur
        const resetAt = new Date(now.getTime() + period);

        rateLimitRecord = new RateLimit({
          user: req.user._id,
          endpoint,
          method: req.method,
          count: 1,
          resetAt,
          ipAddress: req.ip,
        });

        await rateLimitRecord.save();
        return next();
      }

      // Rate limit kontrolü
      if (rateLimitRecord.count >= limit) {
        return res.status(429).json({
          success: false,
          message: 'Çok fazla istek gönderdiniz. Lütfen daha sonra tekrar deneyin.',
          retryAfter: Math.ceil((rateLimitRecord.resetAt - now) / 1000),
        });
      }

      // Rate limit sayacını arttır
      rateLimitRecord.count += 1;
      await rateLimitRecord.save();

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Opsiyonel kimlik doğrulama - kullanıcı giriş yapmışsa req.user'a ekler
 * @param {Object} req - Request objesi
 * @param {Object} res - Response objesi
 * @param {Function} next - Next fonksiyonu
 */
const optionalAuth = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user) => {
    if (err) {
      return next(err);
    }

    if (user) {
      req.user = user;
    }

    next();
  })(req, res, next);
};

module.exports = {
  generateToken,
  userHasRole,
  userHasPermission,
  isModeratorOf,
  isAuthenticated,
  hasRole,
  hasPermission,
  isContentOwner,
  isAdmin,
  isModeratorOfMiddleware,
  require2FA,
  csrfProtection,
  rateLimit,
  optionalAuth,
};
