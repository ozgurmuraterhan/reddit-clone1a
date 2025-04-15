const mongoose = require('mongoose');
const Role = require('../models/Role');
const User = require('../models/User');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const AdminLog = require('../models/AdminLog');
const permissionCheck = require('../middleware/permissionCheck');

/**
 * @desc    Tüm rolleri getir
 * @route   GET /api/roles
 * @access  Admin
 */
const getRoles = asyncHandler(async (req, res, next) => {
  // Sayfalama için parametreleri al
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Filtreleme ve sıralama için parametreleri al
  const { name, sortBy, order } = req.query;

  // Filtreleme sorgusu oluştur
  const filterQuery = {};
  if (name) {
    filterQuery.name = { $regex: name, $options: 'i' };
  }

  // Sıralama seçenekleri
  const sortOptions = {};
  sortOptions[sortBy || 'name'] = order === 'desc' ? -1 : 1;

  // Toplam rol sayısını al
  const total = await Role.countDocuments(filterQuery);

  // Rolleri getir
  const roles = await Role.find(filterQuery)
    .sort(sortOptions)
    .skip(startIndex)
    .limit(limit)
    .select('name description permissions isBuiltIn createdAt updatedAt');

  // Sayfalama bilgisi
  const pagination = {};

  if (endIndex < total) {
    pagination.next = {
      page: page + 1,
      limit,
    };
  }

  if (startIndex > 0) {
    pagination.prev = {
      page: page - 1,
      limit,
    };
  }

  // Her rol için kullanıcı sayılarını getir
  const rolesWithUserCount = await Promise.all(
    roles.map(async (role) => {
      const userCount = await User.countDocuments({ role: role._id });

      return {
        ...role.toObject(),
        userCount,
      };
    }),
  );

  res.status(200).json({
    success: true,
    count: roles.length,
    total,
    pagination,
    data: rolesWithUserCount,
  });
});

/**
 * @desc    Belirli bir rolü getir
 * @route   GET /api/roles/:id
 * @access  Admin
 */
const getRole = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // Rolü bul
  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Bu role sahip kullanıcı sayısını getir
  const userCount = await User.countDocuments({ role: id });

  // Bu role sahip kullanıcıların bir kısmını getir (örn. ilk 10)
  const users = await User.find({ role: id }).select('username avatar email createdAt').limit(10);

  res.status(200).json({
    success: true,
    data: {
      ...role.toObject(),
      userCount,
      users,
    },
  });
});

/**
 * @desc    Yeni rol oluştur
 * @route   POST /api/roles
 * @access  Admin
 */
const createRole = asyncHandler(async (req, res, next) => {
  const { name, description, permissions } = req.body;

  // İsim zorunlu
  if (!name || name.trim() === '') {
    return next(new ErrorResponse('Rol adı zorunludur', 400));
  }

  // İzinler bir dizi olmalı
  if (!permissions || !Array.isArray(permissions)) {
    return next(new ErrorResponse('İzinler bir dizi formatında olmalıdır', 400));
  }

  // İzinlerin geçerliliğini kontrol et
  const validPermissions = [
    'post_manage_own',
    'post_manage_any',
    'post_vote',
    'post_create',
    'comment_manage_own',
    'comment_manage_any',
    'comment_vote',
    'comment_create',
    'user_manage',
    'user_ban',
    'user_message',
    'subreddit_create',
    'subreddit_manage',
    'subreddit_assign_mod',
    'settings_manage',
    'reports_view',
    'reports_action',
    'moderator_invite',
    'moderator_remove',
    'poll_create',
    'poll_vote',
    'poll_manage_own',
    'poll_manage_any',
    'flair_manage',
    'system_settings',
  ];

  // İzinlerin geçerliliğini kontrol et
  const invalidPermissions = permissions.filter((p) => !validPermissions.includes(p));
  if (invalidPermissions.length > 0) {
    return next(new ErrorResponse(`Geçersiz izinler: ${invalidPermissions.join(', ')}`, 400));
  }

  // Aynı isimde rol var mı kontrol et
  const existingRole = await Role.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
  if (existingRole) {
    return next(new ErrorResponse('Bu isimde bir rol zaten mevcut', 400));
  }

  // Yeni rolü oluştur
  const role = await Role.create({
    name,
    description,
    permissions,
    isBuiltIn: false,
    createdBy: req.user._id,
  });

  // Admin log oluştur
  await AdminLog.create({
    user: req.user._id,
    action: 'role_created',
    details: `"${name}" adlı yeni rol oluşturuldu`,
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    message: 'Rol başarıyla oluşturuldu',
    data: role,
  });
});

/**
 * @desc    Rolü güncelle
 * @route   PUT /api/roles/:id
 * @access  Admin
 */
const updateRole = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, description, permissions } = req.body;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // Rolü bul
  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Yerleşik roller değiştirilemez
  if (role.isBuiltIn) {
    return next(new ErrorResponse('Yerleşik roller değiştirilemez', 403));
  }

  // Güncellenecek veriler
  const updateData = {};

  // İsim güncelleme
  if (name && name.trim() !== '') {
    // Aynı isimde başka bir rol var mı kontrol et (kendisi hariç)
    const existingRole = await Role.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      _id: { $ne: id },
    });

    if (existingRole) {
      return next(new ErrorResponse('Bu isimde bir rol zaten mevcut', 400));
    }

    updateData.name = name;
  }

  // Açıklama güncelleme
  if (description !== undefined) {
    updateData.description = description;
  }

  // İzinler güncelleme
  if (permissions !== undefined) {
    // İzinler bir dizi olmalı
    if (!Array.isArray(permissions)) {
      return next(new ErrorResponse('İzinler bir dizi formatında olmalıdır', 400));
    }

    // İzinlerin geçerliliğini kontrol et
    const validPermissions = [
      'post_manage_own',
      'post_manage_any',
      'post_vote',
      'post_create',
      'comment_manage_own',
      'comment_manage_any',
      'comment_vote',
      'comment_create',
      'user_manage',
      'user_ban',
      'user_message',
      'subreddit_create',
      'subreddit_manage',
      'subreddit_assign_mod',
      'settings_manage',
      'reports_view',
      'reports_action',
      'moderator_invite',
      'moderator_remove',
      'poll_create',
      'poll_vote',
      'poll_manage_own',
      'poll_manage_any',
      'flair_manage',
      'system_settings',
    ];

    const invalidPermissions = permissions.filter((p) => !validPermissions.includes(p));
    if (invalidPermissions.length > 0) {
      return next(new ErrorResponse(`Geçersiz izinler: ${invalidPermissions.join(', ')}`, 400));
    }

    updateData.permissions = permissions;
  }

  // Güncelleme tarihi
  updateData.updatedAt = Date.now();
  updateData.updatedBy = req.user._id;

  // Rolü güncelle
  const updatedRole = await Role.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });

  // Admin log oluştur
  await AdminLog.create({
    user: req.user._id,
    action: 'role_updated',
    details: `"${role.name}" adlı rol güncellendi`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: 'Rol başarıyla güncellendi',
    data: updatedRole,
  });
});

/**
 * @desc    Rolü sil
 * @route   DELETE /api/roles/:id
 * @access  Admin
 */
const deleteRole = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // Rolü bul
  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Yerleşik roller silinemez
  if (role.isBuiltIn) {
    return next(new ErrorResponse('Yerleşik roller silinemez', 403));
  }

  // Bu role sahip kullanıcı sayısını kontrol et
  const userCount = await User.countDocuments({ role: id });

  if (userCount > 0) {
    return next(
      new ErrorResponse(
        `Bu rol ${userCount} kullanıcı tarafından kullanılıyor. Silmeden önce kullanıcılara başka bir rol atayın.`,
        400,
      ),
    );
  }

  // Rolü sil
  await role.remove();

  // Admin log oluştur
  await AdminLog.create({
    user: req.user._id,
    action: 'role_deleted',
    details: `"${role.name}" adlı rol silindi`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: 'Rol başarıyla silindi',
  });
});

/**
 * @desc    Kullanıcılara rol ata
 * @route   POST /api/roles/:id/assign
 * @access  Admin
 */
const assignRoleToUsers = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { userIds } = req.body;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // UserIds bir dizi olmalı
  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return next(new ErrorResponse("En az bir kullanıcı ID'si belirtilmelidir", 400));
  }

  // UserID'lerin formatını kontrol et
  const invalidIds = userIds.filter((userId) => !mongoose.Types.ObjectId.isValid(userId));
  if (invalidIds.length > 0) {
    return next(
      new ErrorResponse(`Geçersiz kullanıcı ID formatları: ${invalidIds.join(', ')}`, 400),
    );
  }

  // Rolü bul
  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Kullanıcıları güncelle
  const result = await User.updateMany(
    { _id: { $in: userIds } },
    { role: id, updatedAt: Date.now() },
  );

  // Kaç kullanıcının güncellendiğini kontrol et
  if (result.nModified === 0) {
    return next(new ErrorResponse('Hiçbir kullanıcı bulunamadı veya güncellenmedi', 400));
  }

  // Güncellenen kullanıcıları getir
  const updatedUsers = await User.find({ _id: { $in: userIds } }).select('username email');

  // Admin log oluştur
  await AdminLog.create({
    user: req.user._id,
    action: 'role_assigned',
    details: `"${role.name}" rolü ${result.nModified} kullanıcıya atandı`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: `${result.nModified} kullanıcı "${role.name}" rolüne atandı`,
    data: {
      role,
      affectedCount: result.nModified,
      users: updatedUsers,
    },
  });
});

/**
 * @desc    Kullanıcılardan rolü kaldır
 * @route   POST /api/roles/:id/remove
 * @access  Admin
 */
const removeRoleFromUsers = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { userIds, newRoleId } = req.body;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // UserIds bir dizi olmalı
  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return next(new ErrorResponse("En az bir kullanıcı ID'si belirtilmelidir", 400));
  }

  // UserID'lerin formatını kontrol et
  const invalidIds = userIds.filter((userId) => !mongoose.Types.ObjectId.isValid(userId));
  if (invalidIds.length > 0) {
    return next(
      new ErrorResponse(`Geçersiz kullanıcı ID formatları: ${invalidIds.join(', ')}`, 400),
    );
  }

  // Rolü bul
  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Yeni rol belirtilmişse, varlığını kontrol et
  let newRole = null;
  if (newRoleId) {
    if (!mongoose.Types.ObjectId.isValid(newRoleId)) {
      return next(new ErrorResponse('Geçersiz yeni rol ID formatı', 400));
    }

    newRole = await Role.findById(newRoleId);
    if (!newRole) {
      return next(new ErrorResponse('Yeni rol bulunamadı', 404));
    }
  } else {
    // Varsayılan kullanıcı rolünü bul
    newRole = await Role.findOne({ name: 'user' });
    if (!newRole) {
      return next(
        new ErrorResponse(
          'Varsayılan kullanıcı rolü bulunamadı. Sistem yapılandırmasını kontrol edin.',
          500,
        ),
      );
    }
  }

  // Kullanıcıları güncelle
  const result = await User.updateMany(
    { _id: { $in: userIds }, role: id },
    { role: newRole._id, updatedAt: Date.now() },
  );

  // Kaç kullanıcının güncellendiğini kontrol et
  if (result.nModified === 0) {
    return next(new ErrorResponse('Hiçbir kullanıcı bulunamadı veya güncellenmedi', 400));
  }

  // Güncellenen kullanıcıları getir
  const updatedUsers = await User.find({ _id: { $in: userIds }, role: newRole._id }).select(
    'username email',
  );

  // Admin log oluştur
  await AdminLog.create({
    user: req.user._id,
    action: 'role_removed',
    details: `"${role.name}" rolü ${result.nModified} kullanıcıdan kaldırıldı ve "${newRole.name}" rolü atandı`,
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: `${result.nModified} kullanıcıdan "${role.name}" rolü kaldırıldı ve "${newRole.name}" rolü atandı`,
    data: {
      oldRole: role,
      newRole,
      affectedCount: result.nModified,
      users: updatedUsers,
    },
  });
});

/**
 * @desc    Rol izinlerini getir
 * @route   GET /api/roles/permissions
 * @access  Admin
 */
const getPermissions = asyncHandler(async (req, res, next) => {
  // Tüm geçerli izinleri gruplandırarak listele
  const permissions = {
    posts: [
      {
        id: 'post_create',
        name: 'Gönderi Oluşturma',
        description: 'Kullanıcının gönderi oluşturma izni',
      },
      {
        id: 'post_manage_own',
        name: 'Kendi Gönderilerini Yönetme',
        description: 'Kullanıcının kendi gönderilerini düzenleme ve silme izni',
      },
      {
        id: 'post_manage_any',
        name: 'Tüm Gönderileri Yönetme',
        description: 'Kullanıcının tüm gönderileri düzenleme ve silme izni (moderatör)',
      },
      {
        id: 'post_vote',
        name: 'Gönderilere Oy Verme',
        description: 'Kullanıcının gönderilere yukarı/aşağı oy verme izni',
      },
    ],
    comments: [
      {
        id: 'comment_create',
        name: 'Yorum Oluşturma',
        description: 'Kullanıcının yorum yapma izni',
      },
      {
        id: 'comment_manage_own',
        name: 'Kendi Yorumlarını Yönetme',
        description: 'Kullanıcının kendi yorumlarını düzenleme ve silme izni',
      },
      {
        id: 'comment_manage_any',
        name: 'Tüm Yorumları Yönetme',
        description: 'Kullanıcının tüm yorumları düzenleme ve silme izni (moderatör)',
      },
      {
        id: 'comment_vote',
        name: 'Yorumlara Oy Verme',
        description: 'Kullanıcının yorumlara yukarı/aşağı oy verme izni',
      },
    ],
    users: [
      {
        id: 'user_manage',
        name: 'Kullanıcı Yönetimi',
        description: 'Kullanıcı hesaplarını yönetme izni (admin)',
      },
      {
        id: 'user_ban',
        name: 'Kullanıcı Yasaklama',
        description: 'Kullanıcıları topluluktan veya siteden yasaklama izni (moderatör)',
      },
      {
        id: 'user_message',
        name: 'Kullanıcıya Mesaj Gönderme',
        description: 'Kullanıcılara özel mesaj gönderme izni',
      },
    ],
    subreddits: [
      {
        id: 'subreddit_create',
        name: 'Topluluk Oluşturma',
        description: 'Yeni topluluk oluşturma izni',
      },
      {
        id: 'subreddit_manage',
        name: 'Topluluk Yönetimi',
        description: 'Topluluk ayarlarını yönetme izni (moderatör)',
      },
      {
        id: 'subreddit_assign_mod',
        name: 'Moderatör Atama',
        description: 'Topluluğa moderatör atama ve kaldırma izni (yönetici moderatör)',
      },
    ],
    moderation: [
      {
        id: 'reports_view',
        name: 'Raporları Görüntüleme',
        description: 'Kullanıcı raporlarını görüntüleme izni (moderatör)',
      },
      {
        id: 'reports_action',
        name: 'Rapor İşlemleri',
        description: 'Raporlanan içerikler üzerinde işlem yapma izni (moderatör)',
      },
      {
        id: 'moderator_invite',
        name: 'Moderatör Davet Etme',
        description: 'Topluluğa yeni moderatör davet etme izni',
      },
      {
        id: 'moderator_remove',
        name: 'Moderatör Çıkarma',
        description: 'Topluluktan moderatör çıkarma izni',
      },
    ],
    polls: [
      { id: 'poll_create', name: 'Anket Oluşturma', description: 'Anket oluşturma izni' },
      { id: 'poll_vote', name: 'Ankette Oy Kullanma', description: 'Anketlerde oy kullanma izni' },
      {
        id: 'poll_manage_own',
        name: 'Kendi Anketlerini Yönetme',
        description: 'Kullanıcının kendi anketlerini düzenleme ve silme izni',
      },
      {
        id: 'poll_manage_any',
        name: 'Tüm Anketleri Yönetme',
        description: 'Kullanıcının tüm anketleri düzenleme ve silme izni (moderatör)',
      },
    ],
    settings: [
      {
        id: 'settings_manage',
        name: 'Topluluk Ayarlarını Yönetme',
        description: 'Topluluk ayarlarını değiştirme izni (moderatör)',
      },
      {
        id: 'flair_manage',
        name: 'Etiket Yönetimi',
        description: 'Topluluk etiketlerini (flair) yönetme izni (moderatör)',
      },
      {
        id: 'system_settings',
        name: 'Sistem Ayarları',
        description: 'Tüm site ayarlarını yönetme izni (admin)',
      },
    ],
  };

  res.status(200).json({
    success: true,
    data: permissions,
  });
});

/**
 * @desc    Yerleşik rolleri oluştur (Sistem başlangıcında)
 * @access  System
 */
const createDefaultRoles = asyncHandler(async () => {
  // Mevcut yerleşik rol sayısını kontrol et
  const builtInRoleCount = await Role.countDocuments({ isBuiltIn: true });

  // Yerleşik roller zaten oluşturulmuşsa bir şey yapma
  if (builtInRoleCount >= 4) {
    console.log('Yerleşik roller zaten mevcut');
    return {
      success: true,
      message: 'Yerleşik roller zaten mevcut',
      created: false,
    };
  }

  // Yerleşik rol tanımları
  const builtInRoles = [
    {
      name: 'admin',
      description: 'Tam sistem yöneticisi. Tüm erişim haklarına sahiptir.',
      permissions: [
        'post_create',
        'post_manage_own',
        'post_manage_any',
        'post_vote',
        'comment_create',
        'comment_manage_own',
        'comment_manage_any',
        'comment_vote',
        'user_manage',
        'user_ban',
        'user_message',
        'subreddit_create',
        'subreddit_manage',
        'subreddit_assign_mod',
        'settings_manage',
        'reports_view',
        'reports_action',
        'moderator_invite',
        'moderator_remove',
        'poll_create',
        'poll_vote',
        'poll_manage_own',
        'poll_manage_any',
        'flair_manage',
        'system_settings',
      ],
      isBuiltIn: true,
    },
    {
      name: 'moderator',
      description: 'Topluluk moderatörü. Topluluk içeriğini yönetme yetkisine sahiptir.',
      permissions: [
        'post_create',
        'post_manage_own',
        'post_manage_any',
        'post_vote',
        'comment_create',
        'comment_manage_own',
        'comment_manage_any',
        'comment_vote',
        'user_ban',
        'user_message',
        'subreddit_manage',
        'settings_manage',
        'reports_view',
        'reports_action',
        'moderator_invite',
        'poll_create',
        'poll_vote',
        'poll_manage_own',
        'poll_manage_any',
        'flair_manage',
      ],
      isBuiltIn: true,
    },
    {
      name: 'user',
      description: 'Standart kullanıcı. Temel erişim haklarına sahiptir.',
      permissions: [
        'post_create',
        'post_manage_own',
        'post_vote',
        'comment_create',
        'comment_manage_own',
        'comment_vote',
        'user_message',
        'subreddit_create',
        'poll_create',
        'poll_vote',
        'poll_manage_own',
      ],
      isBuiltIn: true,
    },
    {
      name: 'restricted',
      description: 'Kısıtlı kullanıcı. Sadece okuma izinlerine sahiptir.',
      permissions: ['post_vote', 'comment_vote', 'poll_vote'],
      isBuiltIn: true,
    },
  ];

  // Yerleşik rolleri oluştur
  await Role.insertMany(builtInRoles);

  console.log('Yerleşik roller başarıyla oluşturuldu');

  return {
    success: true,
    message: 'Yerleşik roller başarıyla oluşturuldu',
    created: true,
    data: builtInRoles,
  };
});

/**
 * @desc    Yeni izin ekle (Sistem güncellemesi)
 * @access  System
 */
const addPermissionToRoles = asyncHandler(async (permissionId, targetRoles = ['admin']) => {
  // İzin ID'sinin geçerliliğini kontrol et
  const validPermissions = [
    'post_manage_own',
    'post_manage_any',
    'post_vote',
    'post_create',
    'comment_manage_own',
    'comment_manage_any',
    'comment_vote',
    'comment_create',
    'user_manage',
    'user_ban',
    'user_message',
    'subreddit_create',
    'subreddit_manage',
    'subreddit_assign_mod',
    'settings_manage',
    'reports_view',
    'reports_action',
    'moderator_invite',
    'moderator_remove',
    'poll_create',
    'poll_vote',
    'poll_manage_own',
    'poll_manage_any',
    'flair_manage',
    'system_settings',
  ];

  if (!validPermissions.includes(permissionId)) {
    throw new Error(`Geçersiz izin ID'si: ${permissionId}`);
  }

  // Hedef rolleri bul
  const roles = await Role.find({ name: { $in: targetRoles } });

  if (roles.length === 0) {
    throw new Error(`Hedef roller bulunamadı: ${targetRoles.join(', ')}`);
  }

  // Her role izni ekle
  let updateCount = 0;

  for (const role of roles) {
    // İzin zaten role ekliyse atla
    if (role.permissions.includes(permissionId)) {
      continue;
    }

    // İzni ekle
    role.permissions.push(permissionId);
    role.updatedAt = Date.now();
    await role.save();
    updateCount++;
  }

  console.log(`${updateCount} role "${permissionId}" izni eklendi`);

  return {
    success: true,
    message: `${updateCount} role "${permissionId}" izni eklendi`,
    updatedCount: updateCount,
    affectedRoles: roles.map((r) => r.name),
  };
});

/**
 * @desc    Rol için izin durumunu kontrol et
 * @route   GET /api/roles/:id/check-permission/:permissionId
 * @access  Admin
 */
const checkRolePermission = asyncHandler(async (req, res, next) => {
  const { id, permissionId } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // İzin ID'sinin geçerliliğini kontrol et
  const validPermissions = [
    'post_manage_own',
    'post_manage_any',
    'post_vote',
    'post_create',
    'comment_manage_own',
    'comment_manage_any',
    'comment_vote',
    'comment_create',
    'user_manage',
    'user_ban',
    'user_message',
    'subreddit_create',
    'subreddit_manage',
    'subreddit_assign_mod',
    'settings_manage',
    'reports_view',
    'reports_action',
    'moderator_invite',
    'moderator_remove',
    'poll_create',
    'poll_vote',
    'poll_manage_own',
    'poll_manage_any',
    'flair_manage',
    'system_settings',
  ];

  if (!validPermissions.includes(permissionId)) {
    return next(new ErrorResponse(`Geçersiz izin ID'si: ${permissionId}`, 400));
  }

  // Rolü bul
  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // İznin rolde olup olmadığını kontrol et
  const hasPermission = role.permissions.includes(permissionId);

  res.status(200).json({
    success: true,
    data: {
      role: {
        id: role._id,
        name: role.name,
      },
      permission: permissionId,
      hasPermission,
    },
  });
});

/**
 * @desc    Bir role sahip kullanıcıları listele
 * @route   GET /api/roles/:id/users
 * @access  Admin
 */
const getRoleUsers = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Sayfalama için parametreleri al
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Filtreleme ve sıralama için parametreleri al
  const { search, sortBy, order } = req.query;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz rol ID formatı', 400));
  }

  // Rolü bul
  const role = await Role.findById(id);

  if (!role) {
    return next(new ErrorResponse('Rol bulunamadı', 404));
  }

  // Filtreleme sorgusu oluştur
  const filterQuery = { role: id };

  if (search) {
    filterQuery.$or = [
      { username: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  // Sıralama seçenekleri
  const sortOptions = {};
  sortOptions[sortBy || 'createdAt'] = order === 'asc' ? 1 : -1;

  // Toplam kullanıcı sayısını al
  const total = await User.countDocuments(filterQuery);

  // Kullanıcıları getir
  const users = await User.find(filterQuery)
    .sort(sortOptions)
    .skip(startIndex)
    .limit(limit)
    .select('username email avatar createdAt lastActive');

  // Sayfalama bilgisi
  const pagination = {};

  if (endIndex < total) {
    pagination.next = {
      page: page + 1,
      limit,
    };
  }

  if (startIndex > 0) {
    pagination.prev = {
      page: page - 1,
      limit,
    };
  }

  res.status(200).json({
    success: true,
    count: users.length,
    total,
    pagination,
    data: {
      role,
      users,
    },
  });
});

/**
 * @desc    Rol istatistiklerini getir
 * @route   GET /api/roles/stats
 * @access  Admin
 */
const getRoleStats = asyncHandler(async (req, res, next) => {
  // Tüm rolleri getir
  const roles = await Role.find().select('name permissions isBuiltIn');

  // Her rol için kullanıcı sayısını bul
  const roleStats = await Promise.all(
    roles.map(async (role) => {
      const userCount = await User.countDocuments({ role: role._id });

      return {
        id: role._id,
        name: role.name,
        permissionCount: role.permissions.length,
        userCount,
        isBuiltIn: role.isBuiltIn,
      };
    }),
  );

  // Toplam izin kullanım istatistikleri
  const permissionCounts = {};

  roles.forEach((role) => {
    role.permissions.forEach((permission) => {
      if (!permissionCounts[permission]) {
        permissionCounts[permission] = 0;
      }
      permissionCounts[permission]++;
    });
  });

  // İzinleri kullanım sayısına göre sırala
  const sortedPermissions = Object.entries(permissionCounts)
    .map(([permission, count]) => ({ permission, count }))
    .sort((a, b) => b.count - a.count);

  res.status(200).json({
    success: true,
    data: {
      totalRoles: roles.length,
      roles: roleStats,
      permissionUsage: sortedPermissions,
    },
  });
});

module.exports = {
  getRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  assignRoleToUsers,
  removeRoleFromUsers,
  getPermissions,
  checkRolePermission,
  getRoleUsers,
  getRoleStats,
  createDefaultRoles,
  addPermissionToRoles,
};
