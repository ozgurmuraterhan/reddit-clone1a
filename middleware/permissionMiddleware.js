const mongoose = require('mongoose');
const asyncHandler = require('./async');
const ErrorResponse = require('../utils/errorResponse');
const Permission = require('../models/Permission');
const Role = require('../models/Role');
const User = require('../models/User');
const UserRoleAssignment = require('../models/UserRoleAssignment');
const { isModeratorOf, isSiteAdmin } = require('../utils/roleHelpers');

/**
 * Belirli bir izni kontrol eden middleware
 * @param {String} permission - Kontrol edilecek izin (örn: 'post:create', 'comment:delete_any')
 * @param {String} subredditParam - Subreddit ID'sinin bulunduğu req.params key (örn: 'subredditId')
 * @returns {Function} - Express middleware fonksiyonu
 *
 * @example
 * // Router kullanımı
 * router.post('/subreddits/:subredditId/posts',
 *   auth,
 *   checkPermission('post:create', 'subredditId'),
 *   postController.createPost
 * );
 */
const checkPermission = (permission, subredditParam) => {
  return asyncHandler(async (req, res, next) => {
    // Kullanıcı kontrolü
    if (!req.user || !req.user._id) {
      return next(new ErrorResponse('Bu işlem için giriş yapmalısınız', 401));
    }

    const userId = req.user._id;
    const subredditId = subredditParam ? req.params[subredditParam] : null;

    // Admin kullanıcısı tüm izinlere sahiptir
    if (await isSiteAdmin(userId)) {
      return next();
    }

    // İzin bilgisini al
    const permissionObj = await Permission.findOne({ name: permission });

    if (!permissionObj) {
      // Sistem hatası - tanımlanmamış izin kontrolü
      console.error(`Tanımlanmamış izin kontrolü: ${permission}`);
      return next(new ErrorResponse('Sistem hatası: Tanımlanmamış izin', 500));
    }

    // Subreddit kapsamlı izin için subreddit ID gerekli
    if ((permissionObj.scope === 'subreddit' || permissionObj.scope === 'both') && !subredditId) {
      return next(
        new ErrorResponse('Subreddit kapsamlı izin kontrolü için subreddit ID gereklidir', 400),
      );
    }

    // ID formatı kontrolü
    if (subredditId && !mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Kullanıcının rollerini getir
    let userRoles;

    if (subredditId) {
      // Subreddit kapsamlı roller
      userRoles = await UserRoleAssignment.find({
        user: userId,
        entityType: 'subreddit',
        entity: subredditId,
        isActive: true,
      }).populate({
        path: 'role',
        populate: {
          path: 'permissions',
        },
      });

      // Eğer izin scope'u 'both' ise, site kapsamlı rolleri de kontrol et
      if (permissionObj.scope === 'both') {
        const siteRoles = await UserRoleAssignment.find({
          user: userId,
          entityType: 'site',
          isActive: true,
        }).populate({
          path: 'role',
          populate: {
            path: 'permissions',
          },
        });

        userRoles = [...userRoles, ...siteRoles];
      }
    } else {
      // Site kapsamlı roller
      userRoles = await UserRoleAssignment.find({
        user: userId,
        entityType: 'site',
        isActive: true,
      }).populate({
        path: 'role',
        populate: {
          path: 'permissions',
        },
      });
    }

    // İzinleri kontrol et
    let hasPermission = false;

    for (const roleAssignment of userRoles) {
      const role = roleAssignment.role;

      // Rol aktif değilse atla
      if (!roleAssignment.isActive) {
        continue;
      }

      // Rol izinlerini kontrol et
      for (const perm of role.permissions) {
        if (perm.name === permission) {
          hasPermission = true;
          break;
        }
      }

      if (hasPermission) {
        break;
      }
    }

    // Özel durum: Moderatörler için bazı izinleri otomatik ver
    if (
      !hasPermission &&
      subredditId &&
      (permission.startsWith('moderation:') || permission.includes('_any'))
    ) {
      hasPermission = await isModeratorOf(userId, subredditId);
    }

    if (!hasPermission) {
      return next(new ErrorResponse('Bu işlem için gerekli yetkiniz yok', 403));
    }

    next();
  });
};

/**
 * Controller içinde doğrudan kullanım için helper fonksiyon
 * @param {String} permission - Kontrol edilecek izin
 * @param {String} userId - Kullanıcı ID
 * @param {String} subredditId - Subreddit ID (opsiyonel)
 * @returns {Promise<Boolean>} - Kullanıcının izne sahip olup olmadığı
 */
const checkPermissionHelper = async (permission, userId, subredditId = null) => {
  // ID kontrolü
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return false;
  }

  // Admin kontrolü
  if (await isSiteAdmin(userId)) {
    return true;
  }

  // İzin bilgisini al
  const permissionObj = await Permission.findOne({ name: permission });
  if (!permissionObj) {
    return false;
  }

  // Subreddit kapsamlı izin için subreddit ID gerekli
  if ((permissionObj.scope === 'subreddit' || permissionObj.scope === 'both') && !subredditId) {
    return false;
  }

  // ID formatı kontrolü
  if (subredditId && !mongoose.Types.ObjectId.isValid(subredditId)) {
    return false;
  }

  // Kullanıcının rollerini getir
  let userRoles;

  if (subredditId) {
    // Subreddit kapsamlı roller
    userRoles = await UserRoleAssignment.find({
      user: userId,
      entityType: 'subreddit',
      entity: subredditId,
      isActive: true,
    }).populate({
      path: 'role',
      populate: {
        path: 'permissions',
      },
    });

    // Eğer izin scope'u 'both' ise, site kapsamlı rolleri de kontrol et
    if (permissionObj.scope === 'both') {
      const siteRoles = await UserRoleAssignment.find({
        user: userId,
        entityType: 'site',
        isActive: true,
      }).populate({
        path: 'role',
        populate: {
          path: 'permissions',
        },
      });

      userRoles = [...userRoles, ...siteRoles];
    }
  } else {
    // Site kapsamlı roller
    userRoles = await UserRoleAssignment.find({
      user: userId,
      entityType: 'site',
      isActive: true,
    }).populate({
      path: 'role',
      populate: {
        path: 'permissions',
      },
    });
  }

  // İzinleri kontrol et
  for (const roleAssignment of userRoles) {
    const role = roleAssignment.role;

    // Rol aktif değilse atla
    if (!roleAssignment.isActive) {
      continue;
    }

    // Rol izinlerini kontrol et
    for (const perm of role.permissions) {
      if (perm.name === permission) {
        return true;
      }
    }
  }

  // Özel durum: Moderatörler için bazı izinleri otomatik ver
  if (subredditId && (permission.startsWith('moderation:') || permission.includes('_any'))) {
    return await isModeratorOf(userId, subredditId);
  }

  return false;
};

/**
 * Birden fazla izni kontrol eden middleware
 * @param {Array<String>} permissions - Kontrol edilecek izinler dizisi
 * @param {String} subredditParam - Subreddit ID'sinin bulunduğu req.params key
 * @param {Boolean} requireAll - Tüm izinlerin gerekli olup olmadığı (default: false)
 * @returns {Function} - Express middleware fonksiyonu
 */
const checkPermissions = (permissions, subredditParam, requireAll = false) => {
  return asyncHandler(async (req, res, next) => {
    if (!Array.isArray(permissions) || permissions.length === 0) {
      return next(new ErrorResponse('Geçersiz izin listesi', 500));
    }

    const userId = req.user?._id;
    if (!userId) {
      return next(new ErrorResponse('Bu işlem için giriş yapmalısınız', 401));
    }

    const subredditId = subredditParam ? req.params[subredditParam] : null;

    // Admin kullanıcısı tüm izinlere sahiptir
    if (await isSiteAdmin(userId)) {
      return next();
    }

    // Her izin için kontrol et
    const permissionResults = await Promise.all(
      permissions.map((permission) => checkPermissionHelper(permission, userId, subredditId)),
    );

    // requireAll true ise tüm izinler gerekli, false ise en az biri yeterli
    const hasPermission = requireAll
      ? permissionResults.every((result) => result === true)
      : permissionResults.some((result) => result === true);

    if (!hasPermission) {
      return next(
        new ErrorResponse(
          requireAll
            ? 'Bu işlem için tüm gerekli yetkilere sahip olmalısınız'
            : 'Bu işlem için gerekli yetkilerden en az birine sahip olmalısınız',
          403,
        ),
      );
    }

    next();
  });
};

/**
 * İçerik sahibi veya gerekli izne sahip olup olmadığını kontrol eden middleware
 * @param {String} ownerField - İçerik sahibinin ID'sinin tutulduğu alan adı
 * @param {String} permission - Eğer içerik sahibi değilse kontrol edilecek izin
 * @param {String} subredditParam - Subreddit ID'sinin bulunduğu req.params key
 * @returns {Function} - Express middleware fonksiyonu
 */
const checkOwnershipOr = (ownerField, permission, subredditParam) => {
  return asyncHandler(async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
      return next(new ErrorResponse('Bu işlem için giriş yapmalısınız', 401));
    }

    // İçerik sahibi mi?
    const ownerId = req.body[ownerField] || req[ownerField];
    const isOwner = ownerId && ownerId.toString() === userId.toString();

    if (isOwner) {
      return next();
    }

    // Admin kontrolü
    if (await isSiteAdmin(userId)) {
      return next();
    }

    // İzin kontrolü
    const subredditId = subredditParam ? req.params[subredditParam] : null;
    const hasPermission = await checkPermissionHelper(permission, userId, subredditId);

    if (!hasPermission) {
      return next(new ErrorResponse('Bu içerik için düzenleme yetkiniz yok', 403));
    }

    next();
  });
};

module.exports = {
  checkPermission,
  checkPermissionHelper,
  checkPermissions,
  checkOwnershipOr,
};
