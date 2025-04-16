const Role = require('../models/Role');
const Permission = require('../models/Permission');
const UserRoleAssignment = require('../models/UserRoleAssignment');
const User = require('../models/User');
const Subreddit = require('../models/Subreddit');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Tüm rolleri getir
 * @route   GET /api/roles
 * @access  Private (Admin)
 */
const getAllRoles = asyncHandler(async (req, res, next) => {
  // Sadece site yöneticileri ve yetkilendirilen moderatörler erişebilir
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  const scope = req.query.scope;
  const subredditId = req.query.subreddit;

  // Filtreleme kriterleri
  const filter = {};

  if (scope) {
    filter.scope = scope;
  }

  // Roller ve ilişkili izinleri getir
  const roles = await Role.find(filter)
    .populate('permissions', 'name description category scope')
    .sort('name');

  res.status(200).json({
    success: true,
    count: roles.length,
    data: roles,
  });
});

/**
 * @desc    ID'ye göre rol getir
 * @route   GET /api/roles/:id
 * @access  Private (Admin)
 */
const getRoleById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Sadece site yöneticileri ve yetkilendirilen moderatörler erişebilir
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  const role = await Role.findById(id).populate('permissions', 'name description category scope');

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Kullanıcı sayısını getir
  const assignmentCount = await UserRoleAssignment.countDocuments({ role: id });

  // Cevabı hazırla
  const roleResponse = {
    ...role.toObject(),
    assignmentCount,
  };

  res.status(200).json({
    success: true,
    data: roleResponse,
  });
});

/**
 * @desc    Yeni rol oluştur
 * @route   POST /api/roles
 * @access  Private (Admin)
 */
const createRole = asyncHandler(async (req, res, next) => {
  const { name, description, scope, permissions, isDefault, isSystem } = req.body;

  // Sadece site yöneticileri rol oluşturabilir
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  // İzinlerin geçerliliğini kontrol et
  if (permissions && permissions.length > 0) {
    for (const permId of permissions) {
      if (!mongoose.Types.ObjectId.isValid(permId)) {
        return next(new ErrorResponse(`Geçersiz izin ID formatı: ${permId}`, 400));
      }

      const permExists = await Permission.exists({ _id: permId });
      if (!permExists) {
        return next(new ErrorResponse(`İzin bulunamadı: ${permId}`, 404));
      }
    }
  }

  // Aynı isimle rol var mı kontrol et
  const existingRole = await Role.findOne({
    name,
    scope,
  });

  if (existingRole) {
    return next(new ErrorResponse(`'${name}' isimli bir rol zaten mevcut`, 400));
  }

  // Yeni rol oluştur
  const role = await Role.create({
    name,
    description,
    scope,
    permissions: permissions || [],
    isDefault: isDefault || false,
    isSystem: isSystem || false,
  });

  res.status(201).json({
    success: true,
    data: role,
  });
});

/**
 * @desc    Rolü güncelle
 * @route   PUT /api/roles/:id
 * @access  Private (Admin)
 */
const updateRole = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, description, permissions, isDefault } = req.body;

  // Sadece site yöneticileri rol güncelleyebilir
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // İlgili rolü bul
  let role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Sistem rollerinin bazı alanları değiştirilemez
  if (role.isSystem) {
    if (name && name !== role.name) {
      return next(new ErrorResponse('Sistem rollerinin adı değiştirilemez', 400));
    }
  }

  // İzinlerin geçerliliğini kontrol et
  if (permissions && permissions.length > 0) {
    for (const permId of permissions) {
      if (!mongoose.Types.ObjectId.isValid(permId)) {
        return next(new ErrorResponse(`Geçersiz izin ID formatı: ${permId}`, 400));
      }

      const permExists = await Permission.exists({ _id: permId });
      if (!permExists) {
        return next(new ErrorResponse(`İzin bulunamadı: ${permId}`, 404));
      }
    }
  }

  // Aynı isimle başka rol var mı kontrol et
  if (name && name !== role.name) {
    const existingRole = await Role.findOne({
      name,
      scope: role.scope,
      _id: { $ne: id },
    });

    if (existingRole) {
      return next(new ErrorResponse(`'${name}' isimli bir rol zaten mevcut`, 400));
    }
  }

  // Rolü güncelle
  const updateData = {};
  if (name) updateData.name = name;
  if (description) updateData.description = description;
  if (permissions) updateData.permissions = permissions;
  if (isDefault !== undefined) updateData.isDefault = isDefault;

  role = await Role.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).populate(
    'permissions',
    'name description category scope',
  );

  res.status(200).json({
    success: true,
    data: role,
  });
});

/**
 * @desc    Rolü sil
 * @route   DELETE /api/roles/:id
 * @access  Private (Admin)
 */
const deleteRole = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Sadece site yöneticileri rol silebilir
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Sistem rolleri silinemez
  if (role.isSystem) {
    return next(new ErrorResponse('Sistem rolleri silinemez', 400));
  }

  // Bu role sahip kullanıcılar var mı kontrol et
  const assignments = await UserRoleAssignment.countDocuments({ role: id });
  if (assignments > 0) {
    return next(
      new ErrorResponse('Bu rol kullanıcılara atanmış durumdadır. Önce atamayı kaldırın.', 400),
    );
  }

  // Rolü sil
  await role.remove();

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * @desc    Kullanıcıya rol ata
 * @route   POST /api/roles/:roleId/assign
 * @access  Private (Admin/Moderator)
 */

const assignRoleToUser = asyncHandler(async (req, res, next) => {
  const { roleId } = req.params;
  const { userId, subredditId, expiresAt } = req.body;
  const adminId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(roleId) || !mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz rol veya kullanıcı ID formatı', 400));
  }

  // Rolün var olduğunu kontrol et
  const role = await Role.findById(roleId);
  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Kullanıcının var olduğunu kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Yetki kontrolü
  const isAdmin = req.user.role === 'admin';

  // Subreddit'e özgü roller için kontrol
  if (role.scope === 'subreddit') {
    if (!subredditId) {
      return next(new ErrorResponse('Subreddit kapsamlı roller için subreddit ID gereklidir', 400));
    }

    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Subreddit'in var olduğunu kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Atama yetkisi kontrolü
    if (!isAdmin) {
      // Moderatörlerin yetki kontrolü
      const isModerator = await SubredditMembership.findOne({
        user: adminId,
        subreddit: subredditId,
        type: 'moderator',
        status: 'active',
      });

      if (!isModerator) {
        return next(new ErrorResponse('Bu subreddit için rol atama yetkiniz bulunmamaktadır', 403));
      }
    }
  } else {
    // Site geneli roller için admin kontrolü
    if (!isAdmin) {
      return next(new ErrorResponse('Site geneli roller için admin yetkisi gereklidir', 403));
    }
  }

  // Aynı rolün zaten atanmış olup olmadığını kontrol et
  const existingAssignment = await UserRoleAssignment.findOne({
    user: userId,
    role: roleId,
    subreddit: subredditId || null,
  });

  if (existingAssignment) {
    return next(new ErrorResponse('Bu rol zaten kullanıcıya atanmış', 400));
  }

  // Rol atamasını oluştur
  const assignment = await UserRoleAssignment.create({
    user: userId,
    role: roleId,
    subreddit: subredditId || null,
    assignedBy: adminId,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });

  res.status(201).json({
    success: true,
    data: assignment,
  });
});

/**
 * @desc    Kullanıcıdan rol atamasını kaldır
 * @route   DELETE /api/roles/:roleId/assignments/:assignmentId
 * @access  Private (Admin/Moderator)
 */
const removeRoleFromUser = asyncHandler(async (req, res, next) => {
  const { assignmentId } = req.params;
  const adminId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
    return next(new ErrorResponse('Geçersiz atama ID formatı', 400));
  }

  // Rol atamasını bul
  const assignment = await UserRoleAssignment.findById(assignmentId)
    .populate('role', 'name scope')
    .populate('subreddit', 'name');

  if (!assignment) {
    return next(new ErrorResponse('Rol ataması bulunamadı', 404));
  }

  // Yetki kontrolü
  const isAdmin = req.user.role === 'admin';

  if (assignment.role.scope === 'subreddit' && assignment.subreddit) {
    // Subreddit'e özgü roller için moderatör kontrolü
    if (!isAdmin) {
      const isModerator = await SubredditMembership.findOne({
        user: adminId,
        subreddit: assignment.subreddit._id,
        type: 'moderator',
        status: 'active',
      });

      if (!isModerator) {
        return next(
          new ErrorResponse('Bu subreddit için rol kaldırma yetkiniz bulunmamaktadır', 403),
        );
      }
    }
  } else {
    // Site geneli roller için admin kontrolü
    if (!isAdmin) {
      return next(new ErrorResponse('Site geneli roller için admin yetkisi gereklidir', 403));
    }
  }

  // Rol atamasını kaldır
  await UserRoleAssignment.findByIdAndDelete(assignmentId);

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * @desc    Kullanıcının rollerini getir
 * @route   GET /api/users/:userId/roles
 * @access  Private (Admin/Moderator/Self)
 */
const getUserRoles = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { scope, subreddit } = req.query;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const userExists = await User.exists({ _id: userId });
  if (!userExists) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Yetki kontrolü (kendi profili veya yetkili)
  const isSelf = req.user._id.toString() === userId;
  const isAdmin = req.user.role === 'admin';

  if (!isSelf && !isAdmin) {
    // Subreddit belirtilmişse moderatör yetkisi kontrolü
    let hasPermission = false;

    if (subreddit) {
      const isModerator = await SubredditMembership.findOne({
        user: req.user._id,
        subreddit,
        type: 'moderator',
        status: 'active',
      });

      hasPermission = !!isModerator;
    }

    if (!hasPermission) {
      return next(new ErrorResponse('Bu kullanıcının rollerini görme yetkiniz yok', 403));
    }
  }

  // Filtreleme kriterleri
  const filter = { user: userId };

  if (scope) {
    // Rol kapsamına göre filtrele
    const roleIds = await Role.find({ scope }).distinct('_id');
    filter.role = { $in: roleIds };
  }

  if (subreddit) {
    // Subreddit'e göre filtrele
    if (subreddit === 'site') {
      filter.subreddit = null;
    } else if (mongoose.Types.ObjectId.isValid(subreddit)) {
      filter.subreddit = subreddit;
    }
  }

  // Rol atamalarını getir
  const roleAssignments = await UserRoleAssignment.find(filter)
    .populate('role', 'name description scope permissions')
    .populate('subreddit', 'name title')
    .populate('assignedBy', 'username');

  res.status(200).json({
    success: true,
    count: roleAssignments.length,
    data: roleAssignments,
  });
});

/**
 * @desc    Rol atanmış kullanıcıları getir
 * @route   GET /api/roles/:roleId/users
 * @access  Private (Admin/Moderator)
 */
const getRoleUsers = asyncHandler(async (req, res, next) => {
  const { roleId } = req.params;
  const { subreddit, page = 1, limit = 20 } = req.query;

  if (!mongoose.Types.ObjectId.isValid(roleId)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // Rolün varlığını kontrol et
  const role = await Role.findById(roleId);
  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Yetki kontrolü
  const isAdmin = req.user.role === 'admin';

  if (role.scope === 'subreddit') {
    if (!isAdmin && subreddit) {
      // Subreddit moderatör kontrolü
      const isModerator = await SubredditMembership.findOne({
        user: req.user._id,
        subreddit,
        type: 'moderator',
        status: 'active',
      });

      if (!isModerator) {
        return next(
          new ErrorResponse('Bu subreddit için rol kullanıcılarını görme yetkiniz yok', 403),
        );
      }
    } else if (!isAdmin) {
      return next(new ErrorResponse('Rol kullanıcılarını görme yetkiniz yok', 403));
    }
  } else if (!isAdmin) {
    // Site geneli roller için admin kontrolü
    return next(new ErrorResponse('Site geneli roller için admin yetkisi gereklidir', 403));
  }

  // Filtreleme kriterleri
  const filter = { role: roleId };

  if (subreddit) {
    // Subreddit'e göre filtrele
    if (subreddit === 'site') {
      filter.subreddit = null;
    } else if (mongoose.Types.ObjectId.isValid(subreddit)) {
      filter.subreddit = subreddit;
    }
  }

  // Sayfalama
  const startIndex = (page - 1) * limit;
  const total = await UserRoleAssignment.countDocuments(filter);

  // Rol atamalarını getir
  const roleAssignments = await UserRoleAssignment.find(filter)
    .skip(startIndex)
    .limit(Number(limit))
    .populate({
      path: 'user',
      select: 'username profilePicture email',
    })
    .populate('subreddit', 'name title')
    .populate('assignedBy', 'username')
    .sort({ createdAt: -1 });

  // Sayfalama
  const pagination = {
    page: Number(page),
    limit: Number(limit),
    total,
    pages: Math.ceil(total / limit),
  };

  res.status(200).json({
    success: true,
    count: roleAssignments.length,
    pagination,
    data: roleAssignments,
  });
});

/**
 * @desc    Rol atamasını güncelle (süre uzatma/kısaltma)
 * @route   PUT /api/roles/assignments/:assignmentId
 * @access  Private (Admin/Moderator)
 */
const updateRoleAssignment = asyncHandler(async (req, res, next) => {
  const { assignmentId } = req.params;
  const { expiresAt } = req.body;
  const adminId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
    return next(new ErrorResponse('Geçersiz atama ID formatı', 400));
  }

  // Rol atamasını bul
  const assignment = await UserRoleAssignment.findById(assignmentId)
    .populate('role', 'name scope')
    .populate('subreddit', 'name');

  if (!assignment) {
    return next(new ErrorResponse('Rol ataması bulunamadı', 404));
  }

  // Yetki kontrolü
  const isAdmin = req.user.role === 'admin';

  if (assignment.role.scope === 'subreddit' && assignment.subreddit) {
    // Subreddit'e özgü roller için moderatör kontrolü
    if (!isAdmin) {
      const isModerator = await SubredditMembership.findOne({
        user: adminId,
        subreddit: assignment.subreddit._id,
        type: 'moderator',
        status: 'active',
      });

      if (!isModerator) {
        return next(new ErrorResponse('Bu rol atamasını güncelleme yetkiniz bulunmamaktadır', 403));
      }
    }
  } else {
    // Site geneli roller için admin kontrolü
    if (!isAdmin) {
      return next(new ErrorResponse('Site geneli roller için admin yetkisi gereklidir', 403));
    }
  }

  // Rol atamasını güncelle
  const updatedAssignment = await UserRoleAssignment.findByIdAndUpdate(
    assignmentId,
    {
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      updatedAt: Date.now(),
    },
    { new: true, runValidators: true },
  )
    .populate('role', 'name description')
    .populate('user', 'username')
    .populate('subreddit', 'name title');

  res.status(200).json({
    success: true,
    data: updatedAssignment,
  });
});

module.exports = {
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  assignRoleToUser,
  removeRoleFromUser,
  getUserRoles,
  getRoleUsers,
  updateRoleAssignment,
};
