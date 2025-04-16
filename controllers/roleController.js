const Role = require('../models/Role');
const Permission = require('../models/Permission');
const UserRoleAssignment = require('../models/UserRoleAssignment');
const User = require('../models/User');
const Subreddit = require('../models/Subreddit');
const ModLog = require('../models/ModLog');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Tüm rolleri getir
 * @route   GET /api/roles
 * @access  Private (Admin)
 */
const getRoles = asyncHandler(async (req, res, next) => {
  const { scope, search, isDefault, isSystem } = req.query;

  // Filtreleme sorgusu oluştur
  const query = {};

  // Scope filtresi
  if (scope && ['site', 'subreddit'].includes(scope)) {
    query.scope = scope;
  }

  // isDefault filtresi
  if (isDefault !== undefined) {
    query.isDefault = isDefault === 'true';
  }

  // isSystem filtresi
  if (isSystem !== undefined) {
    query.isSystem = isSystem === 'true';
  }

  // Arama filtresi
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  // Sayfalama
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  const total = await Role.countDocuments(query);

  const roles = await Role.find(query)
    .sort({ isSystem: -1, isDefault: -1, name: 1 })
    .skip(startIndex)
    .limit(limit)
    .populate('permissions', 'name description');

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalDocs: total,
  };

  res.status(200).json({
    success: true,
    count: roles.length,
    pagination,
    data: roles,
  });
});

/**
 * @desc    Belirli bir rolü getir
 * @route   GET /api/roles/:id
 * @access  Private (Admin)
 */
const getRoleById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  const role = await Role.findById(id).populate('permissions', 'name description');

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  res.status(200).json({
    success: true,
    data: role,
  });
});

/**
 * @desc    Yeni rol oluştur
 * @route   POST /api/roles
 * @access  Private (Admin)
 */
const createRole = asyncHandler(async (req, res, next) => {
  const { name, description, scope, permissions, isDefault } = req.body;

  // Zorunlu alan kontrolü
  if (!name || !scope) {
    return next(new ErrorResponse('İsim ve kapsam alanları zorunludur', 400));
  }

  // Scope kontrolü
  if (!['site', 'subreddit'].includes(scope)) {
    return next(new ErrorResponse('Geçersiz kapsam değeri', 400));
  }

  // İzinlerin varlığını kontrol et
  if (permissions && permissions.length > 0) {
    const permissionIds = permissions.filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (permissionIds.length !== permissions.length) {
      return next(new ErrorResponse('Geçersiz izin ID formatı', 400));
    }

    const existingPermissions = await Permission.find({
      _id: { $in: permissionIds },
    });

    if (existingPermissions.length !== permissionIds.length) {
      return next(new ErrorResponse('Bazı izinler bulunamadı', 404));
    }
  }

  // Aynı isme ve kapsama sahip rol var mı kontrol et
  const existingRole = await Role.findOne({
    name: name.trim(),
    scope,
  });

  if (existingRole) {
    return next(
      new ErrorResponse(`${scope} kapsamında "${name}" adında bir rol zaten mevcut`, 400),
    );
  }

  // Yeni rolü oluştur
  const role = await Role.create({
    name: name.trim(),
    description: description || '',
    scope,
    permissions: permissions || [],
    isDefault: isDefault || false,
    isSystem: false, // Sistem rolleri sadece uygulama tarafından oluşturulabilir
  });

  // Başarılı yanıt döndür
  res.status(201).json({
    success: true,
    data: role,
    message: 'Rol başarıyla oluşturuldu',
  });

  // Admin eylemini kaydet
  await ModLog.create({
    user: req.user._id,
    action: 'create_role',
    targetType: 'role',
    targetId: role._id,
    details: `"${role.name}" rolü oluşturuldu, kapsam: ${role.scope}`,
  });
});

/**
 * @desc    Rol güncelle
 * @route   PUT /api/roles/:id
 * @access  Private (Admin)
 */
const updateRole = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, description, permissions, isDefault } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // Rolü bul
  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Sistem rollerini değiştirmeyi engelle
  if (role.isSystem) {
    return next(new ErrorResponse('Sistem rolleri değiştirilemez', 403));
  }

  // Güncellenecek alanları hazırla
  const updateData = {};

  if (name) {
    // Aynı isme ve kapsama sahip başka bir rol var mı kontrol et
    if (name !== role.name) {
      const existingRole = await Role.findOne({
        name: name.trim(),
        scope: role.scope,
        _id: { $ne: id },
      });

      if (existingRole) {
        return next(
          new ErrorResponse(`${role.scope} kapsamında "${name}" adında bir rol zaten mevcut`, 400),
        );
      }

      updateData.name = name.trim();
    }
  }

  if (description !== undefined) {
    updateData.description = description;
  }

  if (isDefault !== undefined) {
    updateData.isDefault = isDefault;

    // Eğer bu rol varsayılan yapılıyorsa, aynı kapsamdaki diğer varsayılan rolleri güncelle
    if (isDefault) {
      await Role.updateMany(
        { scope: role.scope, isDefault: true, _id: { $ne: id } },
        { isDefault: false },
      );
    }
  }

  // İzinlerin varlığını kontrol et
  if (permissions && Array.isArray(permissions)) {
    const permissionIds = permissions.filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (permissionIds.length !== permissions.length) {
      return next(new ErrorResponse('Geçersiz izin ID formatı', 400));
    }

    const existingPermissions = await Permission.find({
      _id: { $in: permissionIds },
    });

    if (existingPermissions.length !== permissionIds.length) {
      return next(new ErrorResponse('Bazı izinler bulunamadı', 404));
    }

    updateData.permissions = permissionIds;
  }

  // Rolü güncelle
  const updatedRole = await Role.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  }).populate('permissions', 'name description');

  res.status(200).json({
    success: true,
    data: updatedRole,
    message: 'Rol başarıyla güncellendi',
  });

  // Admin eylemini kaydet
  await ModLog.create({
    user: req.user._id,
    action: 'update_role',
    targetType: 'role',
    targetId: updatedRole._id,
    details: `"${updatedRole.name}" rolü güncellendi`,
  });
});

/**
 * @desc    Rol sil
 * @route   DELETE /api/roles/:id
 * @access  Private (Admin)
 */
const deleteRole = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Sistem rollerini silmeyi engelle
  if (role.isSystem) {
    return next(new ErrorResponse('Sistem rolleri silinemez', 403));
  }

  // Bu rolün kullanılıp kullanılmadığını kontrol et
  const assignmentCount = await UserRoleAssignment.countDocuments({ role: id });

  if (assignmentCount > 0) {
    return next(
      new ErrorResponse(
        `Bu rol ${assignmentCount} kullanıcıya atanmış durumda, önce atamalarını kaldırın`,
        400,
      ),
    );
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Rolü sil
    await role.delete({ session });

    // Admin eylemini kaydet
    await ModLog.create(
      [
        {
          user: req.user._id,
          action: 'delete_role',
          targetType: 'role',
          details: `"${role.name}" rolü silindi, kapsam: ${role.scope}`,
        },
      ],
      { session },
    );

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {},
      message: 'Rol başarıyla silindi',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Rol silinirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Kullanıcıya rol ata
 * @route   POST /api/roles/:roleId/assign
 * @access  Private (Admin)
 */
const assignRoleToUser = asyncHandler(async (req, res, next) => {
  const { roleId } = req.params;
  const { userId, subredditId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(roleId)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Rolü ve kullanıcıyı kontrol et
  const role = await Role.findById(roleId);
  const user = await User.findById(userId);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Subreddit kapsamlı roller için subreddit kontrolü
  if (role.scope === 'subreddit') {
    if (!subredditId || !mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(
        new ErrorResponse('Subreddit rolü için geçerli bir subreddit ID gereklidir', 400),
      );
    }

    const subreddit = await Subreddit.findById(subredditId);

    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }
  }

  // Rol zaten atanmış mı kontrol et
  const existingAssignment = await UserRoleAssignment.findOne({
    user: userId,
    role: roleId,
    ...(role.scope === 'subreddit' && { subreddit: subredditId }),
  });

  if (existingAssignment) {
    return next(new ErrorResponse('Bu rol kullanıcıya zaten atanmış', 400));
  }

  // Rol atama
  const assignment = await UserRoleAssignment.create({
    user: userId,
    role: roleId,
    assignedBy: req.user._id,
    ...(role.scope === 'subreddit' && { subreddit: subredditId }),
  });

  // Atamayı popüle ederek getir
  const populatedAssignment = await UserRoleAssignment.findById(assignment._id)
    .populate('user', 'username email profilePicture')
    .populate('role', 'name description scope')
    .populate('assignedBy', 'username')
    .populate('subreddit', 'name title');

  res.status(201).json({
    success: true,
    data: populatedAssignment,
    message: `"${role.name}" rolü ${user.username} kullanıcısına başarıyla atandı`,
  });

  // Admin eylemini kaydet
  await ModLog.create({
    user: req.user._id,
    action: 'assign_role',
    targetType: 'user',
    targetId: userId,
    ...(role.scope === 'subreddit' && { subreddit: subredditId }),
    details: `"${role.name}" rolü ${user.username} kullanıcısına atandı${
      role.scope === 'subreddit'
        ? `, subreddit: ${(await Subreddit.findById(subredditId)).name}`
        : ''
    }`,
  });
});

/**
 * @desc    Kullanıcıdan rol kaldır
 * @route   DELETE /api/roles/assignments/:assignmentId
 * @access  Private (Admin)
 */
const removeRoleFromUser = asyncHandler(async (req, res, next) => {
  const { assignmentId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
    return next(new ErrorResponse('Geçersiz atama ID formatı', 400));
  }

  // Atamayı bul
  const assignment = await UserRoleAssignment.findById(assignmentId)
    .populate('user', 'username')
    .populate('role', 'name scope isSystem')
    .populate('subreddit', 'name');

  if (!assignment) {
    return next(new ErrorResponse('Rol ataması bulunamadı', 404));
  }

  // Sistem rolleri otomatik olarak kaldırılamaz
  if (assignment.role.isSystem) {
    return next(new ErrorResponse('Sistem rol atamaları kaldırılamaz', 403));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Atamayı sil
    await assignment.delete({ session });

    // Admin eylemini kaydet
    await ModLog.create(
      [
        {
          user: req.user._id,
          action: 'remove_role',
          targetType: 'user',
          targetId: assignment.user._id,
          ...(assignment.role.scope === 'subreddit' && { subreddit: assignment.subreddit._id }),
          details: `"${assignment.role.name}" rolü ${assignment.user.username} kullanıcısından kaldırıldı${
            assignment.role.scope === 'subreddit' ? `, subreddit: ${assignment.subreddit.name}` : ''
          }`,
        },
      ],
      { session },
    );

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {},
      message: `"${assignment.role.name}" rolü ${assignment.user.username} kullanıcısından başarıyla kaldırıldı`,
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Rol kaldırılırken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Bir role sahip kullanıcıları listele
 * @route   GET /api/roles/:roleId/users
 * @access  Private (Admin)
 */
const getUsersByRole = asyncHandler(async (req, res, next) => {
  const { roleId } = req.params;
  const { subredditId } = req.query;

  if (!mongoose.Types.ObjectId.isValid(roleId)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // Rolü kontrol et
  const role = await Role.findById(roleId);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Subreddit kapsamlı roller için subreddit kontrolü
  if (role.scope === 'subreddit') {
    if (!subredditId || !mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(
        new ErrorResponse('Subreddit rolü için geçerli bir subreddit ID gereklidir', 400),
      );
    }

    const subreddit = await Subreddit.findById(subredditId);

    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }
  }

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Sorgu oluştur
  const query = {
    role: roleId,
    ...(role.scope === 'subreddit' && { subreddit: subredditId }),
  };

  // Toplam sayı
  const total = await UserRoleAssignment.countDocuments(query);

  // Atamaları getir
  const assignments = await UserRoleAssignment.find(query)
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate('user', 'username email profilePicture')
    .populate('subreddit', 'name title')
    .populate('assignedBy', 'username')
    .populate('role', 'name description');

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalDocs: total,
  };

  res.status(200).json({
    success: true,
    count: assignments.length,
    pagination,
    data: assignments,
  });
});

/**
 * @desc    Bir kullanıcının rollerini listele
 * @route   GET /api/users/:userId/roles
 * @access  Private (Admin)
 */
const getUserRoles = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { scope, subredditId } = req.query;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId);

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Sorgu oluştur
  const query = { user: userId };

  // Kapsama göre filtrele
  if (scope && ['site', 'subreddit'].includes(scope)) {
    const roles = await Role.find({ scope }).select('_id');
    query.role = { $in: roles.map((r) => r._id) };
  }

  // Subreddit'e göre filtrele
  if (scope === 'subreddit' && subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    query.subreddit = subredditId;
  }

  // Rol atamalarını getir
  const roleAssignments = await UserRoleAssignment.find(query)
    .populate('role', 'name description scope permissions isDefault isSystem')
    .populate('subreddit', 'name title')
    .populate('assignedBy', 'username')
    .sort({ 'role.scope': -1, 'role.isSystem': -1, 'role.name': 1 });

  res.status(200).json({
    success: true,
    count: roleAssignments.length,
    data: roleAssignments,
  });
});

/**
 * @desc    Subreddit rolleri listele veya oluştur
 * @route   GET /api/subreddits/:subredditId/roles
 * @route   POST /api/subreddits/:subredditId/roles
 * @access  Private (Subreddit Admin veya Site Admin)
 */
const getOrCreateSubredditRoles = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü
  // Subreddit yöneticisi veya site admin olmalı
  if (req.user.role !== 'admin') {
    const isSubredditAdmin = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      type: 'admin',
      status: 'active',
    });

    if (!isSubredditAdmin) {
      return next(new ErrorResponse('Bu subreddit için rol yönetimi yapma yetkiniz yok', 403));
    }
  }

  // HTTP metoduna göre işlemi belirle
  if (req.method === 'GET') {
    // Subreddit rollerini getir
    const roles = await Role.find({
      scope: 'subreddit',
      isSubredditRole: true,
      subreddit: subredditId,
    })
      .populate('permissions', 'name description')
      .sort({ isDefault: -1, name: 1 });

    // Sistem rolleri de ekle (moderatör, admin gibi)
    const systemRoles = await Role.find({
      scope: 'subreddit',
      isSystem: true,
    }).populate('permissions', 'name description');

    res.status(200).json({
      success: true,
      count: roles.length + systemRoles.length,
      data: {
        customRoles: roles,
        systemRoles,
      },
    });
  } else if (req.method === 'POST') {
    // Yeni subreddit rolü oluştur
    const { name, description, permissions, isDefault } = req.body;

    // Zorunlu alan kontrolü
    if (!name) {
      return next(new ErrorResponse('Rol adı zorunludur', 400));
    }

    // Aynı isme sahip rol var mı kontrol et
    const existingRole = await Role.findOne({
      name: name.trim(),
      scope: 'subreddit',
      subreddit: subredditId,
    });

    if (existingRole) {
      return next(
        new ErrorResponse(`"${name}" adında bir rol bu subreddit için zaten mevcut`, 400),
      );
    }

    // İzinlerin varlığını kontrol et
    let permissionIds = [];
    if (permissions && permissions.length > 0) {
      permissionIds = permissions.filter((id) => mongoose.Types.ObjectId.isValid(id));

      if (permissionIds.length !== permissions.length) {
        return next(new ErrorResponse('Geçersiz izin ID formatı', 400));
      }

      const existingPermissions = await Permission.find({
        _id: { $in: permissionIds },
        scope: 'subreddit',
      });

      if (existingPermissions.length !== permissionIds.length) {
        return next(
          new ErrorResponse('Bazı izinler bulunamadı veya subreddit kapsamında değil', 404),
        );
      }
    }

    // Yeni rolü oluştur
    const role = await Role.create({
      name: name.trim(),
      description: description || '',
      scope: 'subreddit',
      permissions: permissionIds,
      isDefault: isDefault || false,
      isSystem: false,
      isSubredditRole: true,
      subreddit: subredditId,
    });

    // Popüle ederek geri döndür
    const populatedRole = await Role.findById(role._id).populate('permissions', 'name description');

    // Başarılı yanıt
    res.status(201).json({
      success: true,
      data: populatedRole,
      message: 'Subreddit rolü başarıyla oluşturuldu',
    });

    // Admin eylemini kaydet
    await ModLog.create({
      user: req.user._id,
      subreddit: subredditId,
      action: 'create_subreddit_role',
      targetType: 'role',
      targetId: role._id,
      details: `"${role.name}" subreddit rolü oluşturuldu`,
    });
  } else {
    return next(new ErrorResponse('Desteklenmeyen HTTP metodu', 405));
  }
});

/**
 * @desc    İzinleri listele
 * @route   GET /api/permissions
 * @access  Private (Admin)
 */
const getPermissions = asyncHandler(async (req, res, next) => {
  const { scope } = req.query;

  // Filtreleme sorgusu
  const query = {};

  // Kapsama göre filtrele
  if (scope && ['site', 'subreddit'].includes(scope)) {
    query.scope = scope;
  }

  // İzinleri getir
  const permissions = await Permission.find(query).sort({ scope: 1, category: 1, name: 1 });

  // İzinleri kategorilere göre grupla
  const groupedPermissions = permissions.reduce((acc, permission) => {
    const category = permission.category || 'Diğer';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(permission);
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    count: permissions.length,
    data: {
      grouped: groupedPermissions,
      all: permissions,
    },
  });
});

/**
 * @desc    Varsayılan rolleri oluştur
 * @route   POST /api/roles/initialize-defaults
 * @access  Private (Admin)
 */
const initializeDefaultRoles = asyncHandler(async (req, res, next) => {
  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Varsayılan izinleri kontrol et - gerekirse oluştur
    const permissionCategories = {
      site: ['users', 'roles', 'settings', 'content', 'moderation'],
      subreddit: ['posts', 'comments', 'users', 'settings', 'styling', 'moderation', 'flair'],
    };

    const defaultPermissions = {
      site: [
        { name: 'manage_users', description: 'Kullanıcıları yönetme izni', category: 'users' },
        {
          name: 'view_site_analytics',
          description: 'Site analizlerini görüntüleme izni',
          category: 'settings',
        },
        { name: 'manage_roles', description: 'Rolleri yönetme izni', category: 'roles' },
        { name: 'manage_permissions', description: 'İzinleri yönetme izni', category: 'roles' },
        {
          name: 'manage_subreddits',
          description: "Subreddit'leri yönetme izni",
          category: 'content',
        },
        { name: 'delete_content', description: 'İçerikleri silme izni', category: 'moderation' },
        { name: 'ban_users', description: 'Kullanıcıları engelleme izni', category: 'moderation' },
        {
          name: 'access_admin_panel',
          description: 'Admin paneline erişim izni',
          category: 'settings',
        },
      ],
      subreddit: [
        { name: 'manage_posts', description: 'Gönderileri yönetme izni', category: 'posts' },
        { name: 'pin_posts', description: 'Gönderileri sabitleme izni', category: 'posts' },
        { name: 'remove_posts', description: 'Gönderileri kaldırma izni', category: 'posts' },
        { name: 'manage_comments', description: 'Yorumları yönetme izni', category: 'comments' },
        { name: 'remove_comments', description: 'Yorumları kaldırma izni', category: 'comments' },
        {
          name: 'ban_users',
          description: "Kullanıcıları subreddit'ten engelleme izni",
          category: 'users',
        },
        { name: 'add_moderators', description: 'Moderatör ekleme izni', category: 'users' },
        { name: 'manage_flair', description: "Flair'leri yönetme izni", category: 'flair' },
        {
          name: 'edit_subreddit',
          description: 'Subreddit bilgilerini düzenleme izni',
          category: 'settings',
        },
        {
          name: 'manage_rules',
          description: 'Subreddit kurallarını yönetme izni',
          category: 'settings',
        },
        {
          name: 'access_traffic_stats',
          description: 'Trafik istatistiklerine erişim izni',
          category: 'settings',
        },
        { name: 'lock_posts', description: 'Gönderileri kilitleme izni', category: 'moderation' },
      ],
    };

    // Her kategori için varsayılan izinleri oluştur
    for (const scope of Object.keys(defaultPermissions)) {
      for (const permInfo of defaultPermissions[scope]) {
        const existing = await Permission.findOne({
          name: permInfo.name,
          scope,
        });

        if (!existing) {
          await Permission.create(
            {
              name: permInfo.name,
              description: permInfo.description,
              category: permInfo.category,
              scope,
            },
            { session },
          );
        }
      }
    }

    // Tüm izinleri getir
    const sitePermissions = await Permission.find({ scope: 'site' }, null, { session });
    const subredditPermissions = await Permission.find({ scope: 'subreddit' }, null, { session });

    const sitePermissionMap = sitePermissions.reduce((acc, perm) => {
      acc[perm.name] = perm._id;
      return acc;
    }, {});

    const subredditPermissionMap = subredditPermissions.reduce((acc, perm) => {
      acc[perm.name] = perm._id;
      return acc;
    }, {});

    // Varsayılan site rolleri
    const defaultSiteRoles = [
      {
        name: 'Admin',
        description: 'Tam yönetici yetkileri',
        scope: 'site',
        isDefault: false,
        isSystem: true,
        permissions: sitePermissions.map((p) => p._id),
      },
      {
        name: 'Moderator',
        description: 'Genel moderasyon yetkileri',
        scope: 'site',
        isDefault: false,
        isSystem: true,
        permissions: [sitePermissionMap.delete_content, sitePermissionMap.ban_users],
      },
      {
        name: 'User',
        description: 'Standart kullanıcı',
        scope: 'site',
        isDefault: true,
        isSystem: true,
        permissions: [],
      },
    ];

    // Varsayılan subreddit rolleri
    const defaultSubredditRoles = [
      {
        name: 'Admin',
        description: 'Subreddit yöneticisi',
        scope: 'subreddit',
        isDefault: false,
        isSystem: true,
        permissions: subredditPermissions.map((p) => p._id),
      },
      {
        name: 'Moderator',
        description: 'Subreddit moderatörü',
        scope: 'subreddit',
        isDefault: false,
        isSystem: true,
        permissions: [
          subredditPermissionMap.manage_posts,
          subredditPermissionMap.pin_posts,
          subredditPermissionMap.remove_posts,
          subredditPermissionMap.manage_comments,
          subredditPermissionMap.remove_comments,
          subredditPermissionMap.ban_users,
          subredditPermissionMap.manage_flair,
          subredditPermissionMap.manage_rules,
          subredditPermissionMap.lock_posts,
        ],
      },
      {
        name: 'Approved User',
        description: 'Onaylanmış kullanıcı',
        scope: 'subreddit',
        isDefault: false,
        isSystem: true,
        permissions: [],
      },
      {
        name: 'Member',
        description: 'Subreddit üyesi',
        scope: 'subreddit',
        isDefault: true,
        isSystem: true,
        permissions: [],
      },
    ];

    // Varsayılan rolleri oluştur
    for (const roleInfo of [...defaultSiteRoles, ...defaultSubredditRoles]) {
      const existing = await Role.findOne({
        name: roleInfo.name,
        scope: roleInfo.scope,
        isSystem: true,
      });

      if (!existing) {
        await Role.create(roleInfo, { session });
      } else {
        // Mevcut rollerin izinlerini güncelle
        existing.permissions = roleInfo.permissions;
        await existing.save({ session });
      }
    }

    await session.commitTransaction();

    // Sonuçları getir
    const roles = await Role.find({ isSystem: true }).populate(
      'permissions',
      'name description category',
    );

    res.status(200).json({
      success: true,
      message: 'Varsayılan roller ve izinler başarıyla oluşturuldu',
      data: {
        roles,
        sitePermissions,
        subredditPermissions,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Varsayılan roller oluşturulurken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Kullanıcı izinlerini kontrol et
 * @route   GET /api/users/:userId/has-permission
 * @access  Private (Admin)
 */
const checkUserPermission = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { permission, subredditId } = req.query;

  if (!userId || !permission) {
    return next(new ErrorResponse('Kullanıcı ID ve izin adı gereklidir', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcıyı kontrol et
  const user = await User.findById(userId);

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Admin kullanıcılar tüm izinlere sahiptir
  if (user.role === 'admin') {
    return res.status(200).json({
      success: true,
      data: {
        hasPermission: true,
        reason: 'admin',
      },
    });
  }

  // İzni bul
  const permissionObj = await Permission.findOne({
    name: permission,
    scope: subredditId ? 'subreddit' : 'site',
  });

  if (!permissionObj) {
    return next(new ErrorResponse('Belirtilen izin bulunamadı', 404));
  }

  // Kullanıcının rollerini bul
  const query = {
    user: userId,
  };

  // Eğer subreddit izni kontrol ediliyorsa
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Subreddit'i kontrol et
    const subreddit = await Subreddit.findById(subredditId);

    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Subreddit rolleri
    query.subreddit = subredditId;
  } else {
    // Site rolleri
    const siteRoles = await Role.find({ scope: 'site' }).select('_id');
    query.role = { $in: siteRoles.map((r) => r._id) };
  }

  const roleAssignments = await UserRoleAssignment.find(query).populate('role');

  // Kullanıcının rollerindeki izinleri kontrol et
  let hasPermission = false;
  let grantingRole = null;

  for (const assignment of roleAssignments) {
    const role = assignment.role;

    // 'all' izni varsa, tüm izinlere sahiptir
    if (role.permissions.includes('all')) {
      hasPermission = true;
      grantingRole = role;
      break;
    }

    // Rolün izinlerini kontrol et
    if (role.permissions.some((p) => p.toString() === permissionObj._id.toString())) {
      hasPermission = true;
      grantingRole = role;
      break;
    }
  }

  res.status(200).json({
    success: true,
    data: {
      hasPermission,
      grantingRole: grantingRole
        ? {
            id: grantingRole._id,
            name: grantingRole.name,
            scope: grantingRole.scope,
          }
        : null,
    },
  });
});

module.exports = {
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  assignRoleToUser,
  removeRoleFromUser,
  getUsersByRole,
  getUserRoles,
  getOrCreateSubredditRoles,
  getPermissions,
  initializeDefaultRoles,
  checkUserPermission,
};
