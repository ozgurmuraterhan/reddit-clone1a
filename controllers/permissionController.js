
const Permission = require('../models/Permission');
const Role = require('../models/Role');
const User = require('../models/User');
const UserRoleAssignment = require('../models/UserRoleAssignment');
const Subreddit = require('../models/Subreddit');
const SubredditMembership = require('../models/SubredditMembership');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');
const { isModeratorOf } = require('../utils/roleHelpers');
/**
 * @desc    Tüm izinleri listele
 * @route   GET /api/permissions
 * @access  Private (Admin)
 */
const getPermissions = asyncHandler(async (req, res, next) => {
  const { category, scope, isSystem, search } = req.query;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // Sorgu filtresi oluştur
  const filter = {};

  if (category) {
    filter.category = category;
  }

  if (scope) {
    filter.scope = scope;
  }

  if (isSystem !== undefined) {
    filter.isSystem = isSystem === 'true';
  }

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  // Toplam izin sayısı
  const total = await Permission.countDocuments(filter);

  // İzinleri getir
  const permissions = await Permission.find(filter)
    .sort({ category: 1, name: 1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({
    success: true,
    count: permissions.length,
    total,
    pagination: {
      page,
      limit,
      pages: Math.ceil(total / limit)
    },
    data: permissions
  });
});

/**
 * @desc    Tek bir izni getir
 * @route   GET /api/permissions/:id
 * @access  Private (Admin)
 */
const getPermission = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz izin ID formatı', 400));
  }

  // İzni bul
  const permission = await Permission.findById(id);

  if (!permission) {
    return next(new ErrorResponse('İzin bulunamadı', 404));
  }

  // İzne sahip rolleri bul
  const roles = await Role.find({ permissions: id }).select('name description scope');

  res.status(200).json({
    success: true,
    data: {
      permission,
      roles
    }
  });
});

/**
 * @desc    Yeni bir izin oluştur
 * @route   POST /api/permissions
 * @access  Private (Admin)
 */
const createPermission = asyncHandler(async (req, res, next) => {
  const { name, description, category, scope, isSystem } = req.body;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // Zorunlu alanları kontrol et
  if (!name || !description || !category || !scope) {
    return next(new ErrorResponse('Lütfen tüm zorunlu alanları doldurun', 400));
  }

  // İzin adı benzersiz mi kontrol et
  const existingPermission = await Permission.findOne({ name });

  if (existingPermission) {
    return next(new ErrorResponse('Bu isimde bir izin zaten mevcut', 400));
  }

  // İzni oluştur
  const permission = await Permission.create({
    name,
    description,
    category,
    scope,
    isSystem: isSystem || false
  });

  res.status(201).json({
    success: true,
    data: permission
  });
});

/**
 * @desc    İzni güncelle
 * @route   PUT /api/permissions/:id
 * @access  Private (Admin)
 */
const updatePermission = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, description, category, scope, isSystem } = req.body;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz izin ID formatı', 400));
  }

  // İzni bul
  let permission = await Permission.findById(id);

  if (!permission) {
    return next(new ErrorResponse('İzin bulunamadı', 404));
  }

  // Sistem izinlerinin bazı alanlarını korumak için kontrol
  if (permission.isSystem) {
    // Sistem izni adını değiştirmeye izin verme
    if (name && name !== permission.name) {
      return next(new ErrorResponse('Sistem izinlerinin adı değiştirilemez', 400));
    }

    // Sistem izni kategorisini değiştirmeye izin verme
    if (category && category !== permission.category) {
      return next(new ErrorResponse('Sistem izinlerinin kategorisi değiştirilemez', 400));
    }

    // Sistem izni kapsamını değiştirmeye izin verme
    if (scope && scope !== permission.scope) {
      return next(new ErrorResponse('Sistem izinlerinin kapsamı değiştirilemez', 400));
    }
  }

  // İsim değiştiriliyorsa benzersizliği kontrol et
  if (name && name !== permission.name) {
    const existingPermission = await Permission.findOne({ name });

    if (existingPermission) {
      return next(new ErrorResponse('Bu isimde bir izin zaten mevcut', 400));
    }
  }

  // İzni güncelle
  permission = await Permission.findByIdAndUpdate(
    id,
    {
      name: name || permission.name,
      description: description || permission.description,
      category: category || permission.category,
      scope: scope || permission.scope,
      isSystem: isSystem !== undefined ? isSystem : permission.isSystem
    },
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    data: permission
  });
});

/**
 * @desc    İzni sil
 * @route   DELETE /api/permissions/:id
 * @access  Private (Admin)
 */
const deletePermission = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz izin ID formatı', 400));
  }

  // İzni bul
  const permission = await Permission.findById(id);

  if (!permission) {
    return next(new ErrorResponse('İzin bulunamadı', 404));
  }

  // Sistem izinlerini silmeye izin verme
  if (permission.isSystem) {
    return next(new ErrorResponse('Sistem izinleri silinemez', 400));
  }

  // İlişkili rolleri kontrol et
  const usedInRoles = await Role.findOne({ permissions: id });

  if (usedInRoles) {
    return next(new ErrorResponse('Bu izin bir veya daha fazla rol tarafından kullanılmaktadır ve silinemez', 400));
  }

  // İzni sil
  await permission.remove();

  res.status(200).json({
    success: true,
    data: {},
    message: 'İzin başarıyla silindi'
  });
});

/**
 * @desc    İzni bir role ata
 * @route   POST /api/permissions/:id/roles
 * @access  Private (Admin)
 */
const assignPermissionToRole = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { roleId } = req.body;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(roleId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // İzni ve rolü bul
  const permission = await Permission.findById(id);
  const role = await Role.findById(roleId);

  if (!permission) {
    return next(new ErrorResponse('İzin bulunamadı', 404));
  }

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Kapsam uyumluluğunu kontrol et
  if (permission.scope === 'site' && role.scope === 'subreddit') {
    return next(new ErrorResponse('Site kapsamlı izin, subreddit rolüne atanamaz', 400));
  }

  if (permission.scope === 'subreddit' && role.scope === 'site') {
    return next(new ErrorResponse('Subreddit kapsamlı izin, site rolüne atanamaz', 400));
  }

  // Rol izni zaten içeriyor mu kontrol et
  if (role.permissions.includes(id)) {
    return next(new ErrorResponse('Bu izin zaten role atanmış', 400));
  }

  // İzni role ekle
  role.permissions.push(id);
  await role.save();

  res.status(200).json({
    success: true,
    data: role,
    message: 'İzin başarıyla role atandı'
  });
});

/**
 * @desc    İzni bir rolden kaldır
 * @route   DELETE /api/permissions/:id/roles/:roleId
 * @access  Private (Admin)
 */
const removePermissionFromRole = asyncHandler(async (req, res, next) => {
  const { id, roleId } = req.params;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(roleId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // İzni ve rolü bul
  const permission = await Permission.findById(id);
  const role = await Role.findById(roleId);

  if (!permission) {
    return next(new ErrorResponse('İzin bulunamadı', 404));
  }

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Sistem rollerin sahip olduğu sistem izinleri kaldırmaya izin verme
  if (role.isSystem && permission.isSystem) {
    return next(new ErrorResponse('Sistem rollerinden sistem izinleri kaldırılamaz', 400));
  }

  // Rolde izin var mı kontrol et
  if (!role.permissions.includes(id)) {
    return next(new ErrorResponse('Bu izin zaten rolde bulunmuyor', 400));
  }

  // İzni rolden kaldır
  role.permissions = role.permissions.filter(p => p.toString() !== id);
  await role.save();

  res.status(200).json({
    success: true,
    data: role,
    message: 'İzin başarıyla rolden kaldırıldı'
  });
});

/**
 * @desc    Kategoriye göre izinleri getir
 * @route   GET /api/permissions/categories/:category
 * @access  Private (Admin)
 */
const getPermissionsByCategory = asyncHandler(async (req, res, next) => {
  const { category } = req.params;
  const { scope } = req.query;

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // Geçerli kategori mi kontrol et
  const validCategories = ['post', 'comment', 'user', 'subreddit', 'moderation', 'admin', 'other'];

  if (!validCategories.includes(category)) {
    return next(new ErrorResponse('Geçersiz kategori', 400));
  }

  // Sorgu filtresi oluştur
  const filter = { category };

  if (scope) {
    filter.scope = scope;
  }

  // İzinleri getir
  const permissions = await Permission.find(filter).sort({ name: 1 });

  res.status(200).json({
    success: true,
    count: permissions.length,
    data: permissions
  });
});

/**
 * @desc    Roller için izin şemasını getir
 * @route   GET /api/permissions/schema
 * @access  Private (Admin)
 */
const getPermissionSchema = asyncHandler(async (req, res, next) => {
  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // Tüm izinleri kategori ve kapsama göre gruplayarak getir
  const permissions = await Permission.find().sort({ category: 1, name: 1 });

  // Kategorilere göre grupla
  const categorizedPermissions = {};
  const validCategories = ['post', 'comment', 'user', 'subreddit', 'moderation', 'admin', 'other'];

  validCategories.forEach(category => {
    categorizedPermissions[category] = {
      site: permissions.filter(p => p.category === category && (p.scope === 'site' || p.scope === 'both')),
      subreddit: permissions.filter(p => p.category === category && (p.scope === 'subreddit' || p.scope === 'both'))
    };
  });

  // Rolleri getir
  const roles = await Role.find().populate('permissions');

  // Site ve subreddit kapsamına göre grupla
  const rolesBySite = roles.filter(role => role.scope === 'site');
  const rolesBySubreddit = roles.filter(role => role.scope === 'subreddit');

  res.status(200).json({
    success: true,
    data: {
      permissions: categorizedPermissions,
      roles: {
        site: rolesBySite,
        subreddit: rolesBySubreddit
      }
    }
  });
});

/**
 * @desc    Kullanıcı izinlerini kontrol et
 * @route   GET /api/permissions/check
 * @access  Private
 */
const checkUserPermissions = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { permission, subredditId } = req.query;

  if (!permission) {
    return next(new ErrorResponse('Kontrol edilecek izin belirtilmelidir', 400));
  }

  // İzin bilgisini al
  const permissionObj = await Permission.findOne({ name: permission });

  if (!permissionObj) {
    return next(new ErrorResponse('Belirtilen izin bulunamadı', 404));
  }

  // Admin kullanıcısı tüm izinlere sahiptir
  if (req.user.role === 'admin') {
    return res.status(200).json({
      success: true,
      hasPermission: true,
      message: 'Admin kullanıcısı tüm izinlere sahiptir'
    });
  }

  // Subreddit kapsamlı izin için subreddit ID gerekli
  if (permissionObj.scope === 'subreddit' && !subredditId) {
    return next(new ErrorResponse('Subreddit kapsamlı izin kontrolü için subreddit ID gereklidir', 400));
  }

  // Subreddit ID formatı kontrolü
  if (subredditId && !mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Kullanıcının rollerini getir
  let userRoles;

  if (subredditId) {
    // Subreddit kapsamlı roller
    userRoles = await UserRoleAssignment.find({
      user: userId,
      scope: 'subreddit',
      subreddit: subredditId
    }).populate({
      path: 'role',
      populate: {
        path: 'permissions'
      }
    });
  } else {
    // Site kapsamlı roller
    userRoles = await UserRoleAssignment.find({
      user: userId,
      scope: 'site'
    }).populate({
      path: 'role',
      populate: {
        path: 'permissions'
      }
    });
  }

  // İzinleri kontrol et
  let hasPermission = false;

  for (const roleAssignment of userRoles) {
    const role = roleAssignment.role;

    // Rol aktif değilse atla
    if (roleAssignment.isActive !== true) {
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

  res.status(200).json({
    success: true,
    hasPermission,
    message: hasPermission ?
        'Kullanıcı bu izne sahip' :
        'Kullanıcı bu izne sahip değil'
  });
});

/**
 * @desc    Subreddit izinlerini ayarla
 * @route   PUT /api/permissions/subreddit/:subredditId
 * @access  Private (Subreddit Sahibi veya Admin)
 */
const setSubredditPermissions = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { roleId, permissions } = req.body;
  const userId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId) || !mongoose.Types.ObjectId.isValid(roleId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);

  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü - Admin veya subreddit kurucusu olmalı
  const isAdmin = req.user.role === 'admin';
  const isCreator = subreddit.creator.toString() === userId.toString();

  if (!isAdmin && !isCreator) {
    // Moderatör kontrolü (sadece kurucu veya üst düzey moderatörler izinleri değiştirebilir)
    const isModerator = await isModeratorOf(userId, subredditId);
    if (!isModerator) {
      return next(new ErrorResponse('Bu işlem için moderatör yetkiniz olmalı', 403));
    }

    // Kullanıcı moderatör ise çalışması gereken diğer kodlar...
  }

  // İleride yapılabilecek bir geliştirme örneği (yoruma alınmalı veya kaldırılmalı):
  // const isFounder = await isModeratorOf(userId, subredditId, { checkFounder: true });
  // if (!isFounder) {
  //   return next(new ErrorResponse('Bu işlem için subreddit sahibi veya kurucu moderatör yetkiniz olmalı', 403));
  // }

  // Rolü kontrol et
  const role = await Role.findById(roleId);
  // Rolün kapsamını kontrol et
  if (role.scope !== 'subreddit') {
    return next(new ErrorResponse('Sadece subreddit kapsamlı roller için izinler ayarlanabilir', 400));
  }

  // Sistem rollerinin izinlerini değiştirmeye izin verme
  if (role.isSystem) {
    return next(new ErrorResponse('Sistem rollerinin izinleri değiştirilemez', 400));
  }

  // İzinleri doğrula
  if (!permissions || !Array.isArray(permissions)) {
    return next(new ErrorResponse('Geçerli bir izin listesi sağlanmalıdır', 400));
  }

  // Her izni kontrol et
  const validPermissions = [];

  for (const permissionId of permissions) {
    if (!mongoose.Types.ObjectId.isValid(permissionId)) {
      continue;
    }

    const permission = await Permission.findById(permissionId);

    if (!permission) {
      continue;
    }

    // Subreddit kapsamlı veya her iki kapsama uygun izinleri ekle
    if (permission.scope === 'subreddit' || permission.scope === 'both') {
      validPermissions.push(permissionId);
    }
  }

  // Rolün izinlerini güncelle
  role.permissions = validPermissions;
  await role.save();

  res.status(200).json({
    success: true,
    data: role,
    message: 'Subreddit rol izinleri başarıyla güncellendi'
  });
});

/**
 * @desc    Varsayılan izinleri kurulum
 * @route   POST /api/permissions/setup
 * @access  Private (Admin)
 */
const setupDefaultPermissions = asyncHandler(async (req, res, next) => {
  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // Temel rolleri bul veya oluştur
  let adminRole = await Role.findOne({ name: 'admin', scope: 'site' });
  let moderatorRole = await Role.findOne({ name: 'moderator', scope: 'subreddit' });
  let userRole = await Role.findOne({ name: 'user', scope: 'site' });

  if (!adminRole) {
    adminRole = await Role.create({
      name: 'admin',
      description: 'Site yöneticisi',
      scope: 'site',
      isDefault: false,
      isSystem: true
    });
  }

  if (!moderatorRole) {
    moderatorRole = await Role.create({
      name: 'moderator',
      description: 'Subreddit moderatörü',
      scope: 'subreddit',
      isDefault: false,
      isSystem: true
    });
  }

  if (!userRole) {
    userRole = await Role.create({
      name: 'user',
      description: 'Standart kullanıcı',
      scope: 'site',
      isDefault: true,
      isSystem: true
    });
  }

  // Varsayılan izin kategorileri
  const defaultPermissionCategories = {
    'post': 'Post işlemleri',
    'comment': 'Yorum işlemleri',
    'user': 'Kullanıcı işlemleri',
    'subreddit': 'Subreddit işlemleri',
    'moderation': 'Moderasyon işlemleri',
    'admin': 'Admin işlemleri',
    'other': 'Diğer işlemler'
  };

  // Temel izinleri tanımla ve oluştur
  const defaultPermissions = [
    // Post izinleri
    {
      name: 'post:create',
      description: 'Gönderi oluşturma',
      category: 'post',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'admin']
    },
    {
      name: 'post:read',
      description: 'Gönderi okuma',
      category: 'post',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'moderator', 'admin']
    },
    {
      name: 'post:update_own',
      description: 'Kendi gönderisini düzenleme',
      category: 'post',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'admin']
    },
    {
      name: 'post:update_any',
      description: 'Herhangi bir gönderiyi düzenleme',
      category: 'post',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'post:delete_own',
      description: 'Kendi gönderisini silme',
      category: 'post',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'admin']
    },
    {
      name: 'post:delete_any',
      description: 'Herhangi bir gönderiyi silme',
      category: 'post',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'post:vote',
      description: 'Gönderi oylaması',
      category: 'post',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'admin']
    },

    // Yorum izinleri
    {
      name: 'comment:create',
      description: 'Yorum oluşturma',
      category: 'comment',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'admin']
    },
    {
      name: 'comment:read',
      description: 'Yorum okuma',
      category: 'comment',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'moderator', 'admin']
    },
    {
      name: 'comment:update_own',
      description: 'Kendi yorumunu düzenleme',
      category: 'comment',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'admin']
    },
    {
      name: 'comment:update_any',
      description: 'Herhangi bir yorumu düzenleme',
      category: 'comment',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'comment:delete_own',
      description: 'Kendi yorumunu silme',
      category: 'comment',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'admin']
    },
    {
      name: 'comment:delete_any',
      description: 'Herhangi bir yorumu silme',
      category: 'comment',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'comment:vote',
      description: 'Yorum oylaması',
      category: 'comment',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'admin']
    },

    // Moderasyon izinleri
    {
      name: 'moderation:approve',
      description: 'İçerik onaylama',
      category: 'moderation',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'moderation:remove',
      description: 'İçerik kaldırma',
      category: 'moderation',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'moderation:ban',
      description: 'Kullanıcı yasaklama',
      category: 'moderation',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'moderation:unban',
      description: 'Kullanıcı yasağı kaldırma',
      category: 'moderation',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'moderation:lock',
      description: 'Gönderi/yorum kilitleme',
      category: 'moderation',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'moderation:config',
      description: 'Subreddit ayarlarını yapılandırma',
      category: 'moderation',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'moderation:flair',
      description: 'Etiket yönetimi',
      category: 'moderation',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'moderation:wiki',
      description: 'Wiki sayfalarını yönetme',
      category: 'moderation',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'moderation:manage_moderators',
      description: 'Moderatörleri yönetme (sadece kurucular)',
      category: 'moderation',
      scope: 'subreddit',
      isSystem: true,
      roles: ['admin']
    },

    // Subreddit izinleri
    {
      name: 'subreddit:create',
      description: 'Subreddit oluşturma',
      category: 'subreddit',
      scope: 'site',
      isSystem: true,
      roles: ['user', 'admin']
    },
    {
      name: 'subreddit:subscribe',
      description: 'Subreddit'e abone olma',
      category: 'subreddit',
      scope: 'both',
      isSystem: true,
      roles: ['user', 'admin']
    },
    {
      name: 'subreddit:update_own',
      description: 'Kendi subreddit\'ini güncelleme',
      category: 'subreddit',
      scope: 'subreddit',
      isSystem: true,
      roles: ['moderator', 'admin']
    },
    {
      name: 'subreddit:delete_own',
      description: 'Kendi subreddit\'ini silme (sadece kurucular)',
      category: 'subreddit',
      scope: 'subreddit',
      isSystem: true,
      roles: ['admin']
    },

    // Kullanıcı izinleri
    {
      name: 'user:update_own',
      description: 'Kendi profilini güncelleme',
      category: 'user',
      scope: 'site',
      isSystem: true,
      roles: ['user', 'admin']
    },
    {
      name: 'user:read',
      description: 'Kullanıcı profillerini görüntüleme',
      category: 'user',
      scope: 'site',
      isSystem: true,
      roles: ['user', 'moderator', 'admin']
    },
    {
      name: 'user:manage_any',
      description: 'Herhangi bir kullanıcıyı yönetme',
      category: 'user',
      scope: 'site',
      isSystem: true,
      roles: ['admin']
    },

    // Admin izinleri
    {
      name: 'admin:manage_roles',
      description: 'Rolleri yönetme',
      category: 'admin',
      scope: 'site',
      isSystem: true,
      roles: ['admin']
    },
    {
      name: 'admin:manage_permissions',
      description: 'İzinleri yönetme',
      category: 'admin',
      scope: 'site',
      isSystem: true,
      roles: ['admin']
    },
    {
      name: 'admin:manage_site',
      description: 'Site ayarlarını yönetme',
      category: 'admin',
      scope: 'site',
      isSystem: true,
      roles: ['admin']
    },
    {
      name: 'admin:view_logs',
      description: 'Sistem kayıtlarını görüntüleme',
      category: 'admin',
      scope: 'site',
      isSystem: true,
      roles: ['admin']
    }
  ];

  // İzinleri oluştur ve rollere ata
  const roleMap = {
    'admin': adminRole,
    'moderator': moderatorRole,
    'user': userRole
  };

  const createdPermissions = [];

  for (const permissionData of defaultPermissions) {
    // İzin zaten var mı kontrol et
    let permission = await Permission.findOne({ name: permissionData.name });

    // Yoksa oluştur
    if (!permission) {
      permission = await Permission.create({
        name: permissionData.name,
        description: permissionData.description,
        category: permissionData.category,
        scope: permissionData.scope,
        isSystem: permissionData.isSystem
      });

      createdPermissions.push(permission);
    }

    // Rollere ata
    for (const roleName of permissionData.roles) {
      const role = roleMap[roleName];

      if (role && !role.permissions.includes(permission._id)) {
        role.permissions.push(permission._id);
        await role.save();
      }
    }
  }

  res.status(200).json({
    success: true,
    message: `${createdPermissions.length} varsayılan izin oluşturuldu ve rollere atandı`,
    data: {
      createdPermissions,
      roles: Object.values(roleMap)
    }
  });
});

/**
 * @desc    Kullanıcı izinlerini getir
 * @route   GET /api/permissions/user/:userId
 * @access  Private
 */
const getUserPermissions = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const requestingUserId = req.user._id;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Yetki kontrolü (kendi izinlerini herkes görebilir, başkalarınınkini sadece admin)
  if (userId !== requestingUserId.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Başka kullanıcıların izinlerini görüntüleme yetkiniz yok', 403));
  }

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId);

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının site kapsamlı rollerini getir
  const siteRoleAssignments = await UserRoleAssignment.find({
    user: userId,
    scope: 'site'
  }).populate({
    path: 'role',
    populate: {
      path: 'permissions'
    }
  });

  // Site kapsamlı izinleri çıkart
  const sitePermissions = new Set();

  for (const assignment of siteRoleAssignments) {
    if (assignment.isActive && assignment.role) {
      for (const permission of assignment.role.permissions) {
        sitePermissions.add({
          id: permission._id,
          name: permission.name,
          description: permission.description,
          category: permission.category,
          role: assignment.role.name
        });
      }
    }
  }

  // Kullanıcının subreddit kapsamlı rollerini getir
  const subredditRoleAssignments = await UserRoleAssignment.find({
    user: userId,
    scope: 'subreddit'
  }).populate({
    path: 'role',
    populate: {
      path: 'permissions'
    }
  }).populate('subreddit', 'name');

  // Subreddit kapsamlı izinleri çıkart
  const subredditPermissions = {};

  for (const assignment of subredditRoleAssignments) {
    if (assignment.isActive && assignment.role && assignment.subreddit) {
      const subredditName = assignment.subreddit.name;

      if (!subredditPermissions[subredditName]) {
        subredditPermissions[subredditName] = {
          subredditId: assignment.subreddit._id,
          subredditName,
          permissions: [],
          roles: []
        };
      }

      // Role ekle
      if (!subredditPermissions[subredditName].roles.some(r => r.id.toString() === assignment.role._id.toString())) {
        subredditPermissions[subredditName].roles.push({
          id: assignment.role._id,
          name: assignment.role.name,
          description: assignment.role.description
        });
      }

      // İzinleri ekle
      for (const permission of assignment.role.permissions) {
        // Zaten eklenmiş mi kontrol et
        const exists = subredditPermissions[subredditName].permissions.some(
            p => p.id.toString() === permission._id.toString()
        );

        if (!exists) {
          subredditPermissions[subredditName].permissions.push({
            id: permission._id,
            name: permission.name,
            description: permission.description,
            category: permission.category,
            role: assignment.role.name
          });
        }
      }
    }
  }

  res.status(200).json({
    success: true,
    data: {
      site: {
        permissions: Array.from(sitePermissions),
        roles: siteRoleAssignments.filter(a => a.isActive).map(a => ({
          id: a.role._id,
          name: a.role.name,
          description: a.role.description
        }))
      },
      subreddits: Object.values(subredditPermissions)
    }
  });
});

/**
 * @desc    Subreddit izinlerini getir
 * @route   GET /api/permissions/subreddit/:subredditId
 * @access  Private
 */
const getSubredditPermissions = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // ID formatı kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);

  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Subreddit'in rollerini getir
  const roles = await Role.find({
    scope: 'subreddit',
    _id: { $in: await UserRoleAssignment.distinct('role', { subreddit: subredditId }) }
  }).populate('permissions');

  // Rol bazlı izin haritası oluştur
  const rolePermissions = {};

  for (const role of roles) {
    rolePermissions[role._id] = {
      role: {
        id: role._id,
        name: role.name,
        description: role.description,
        isDefault: role.isDefault,
        isSystem: role.isSystem
      },
      permissions: role.permissions.map(p => ({
        id: p._id,
        name: p.name,
        description: p.description,
        category: p.category
      }))
    };
  }

  res.status(200).json({
    success: true,
    data: {
      subreddit: {
        id: subreddit._id,
        name: subreddit.name
      },
      roles: rolePermissions
    }
  });
});

module.exports = {
  getPermissions,
  getPermission,
  createPermission,
  updatePermission,
  deletePermission,
  assignPermissionToRole,
  removePermissionFromRole,
  getPermissionsByCategory,
  getPermissionSchema,
  checkUserPermissions,
  setSubredditPermissions,
  setupDefaultPermissions,
  getUserPermissions,
  getSubredditPermissions
};
