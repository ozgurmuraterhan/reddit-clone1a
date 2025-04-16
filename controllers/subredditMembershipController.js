const SubredditMembership = require('../models/SubredditMembership');
const Subreddit = require('../models/Subreddit');
const User = require('../models/User');
const ModLog = require('../models/ModLog');
const AdminLog = require('../models/AdminLog');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Kullanıcının topluluk üyeliklerini getir
 * @route   GET /api/memberships
 * @access  Private
 */
const getUserMemberships = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { type, status, favorite } = req.query;

  // Filtreleme sorgusu oluştur
  let query = { user: userId };

  // Üyelik tipi filtresi
  if (type && ['member', 'moderator', 'banned'].includes(type)) {
    query.type = type;
  }

  // Üyelik durumu filtresi
  if (status && ['active', 'pending', 'banned'].includes(status)) {
    query.status = status;
  }

  // Favori filtresi
  if (favorite !== undefined) {
    query.isFavorite = favorite === 'true';
  }

  // Üyelikleri getir
  const memberships = await SubredditMembership.find(query)
    .populate({
      path: 'subreddit',
      select: 'name title icon banner memberCount type nsfw',
    })
    .sort({ isFavorite: -1, joinedAt: -1 });

  // Üyelikleri kategorize et
  const moderating = [];
  const joined = [];
  const pending = [];
  const banned = [];

  memberships.forEach((membership) => {
    if (!membership.subreddit) return; // Silinmiş subredditler için kontrol

    const membershipData = {
      _id: membership._id,
      subreddit: {
        _id: membership.subreddit._id,
        name: membership.subreddit.name,
        title: membership.subreddit.title,
        icon: membership.subreddit.icon,
        banner: membership.subreddit.banner,
        memberCount: membership.subreddit.memberCount,
        type: membership.subreddit.type,
        nsfw: membership.subreddit.nsfw,
      },
      type: membership.type,
      status: membership.status,
      joinedAt: membership.joinedAt,
      isFavorite: membership.isFavorite,
    };

    if (membership.status === 'banned') {
      membershipData.bannedAt = membership.bannedAt;
      membershipData.banReason = membership.banReason;
      membershipData.banExpiration = membership.banExpiration;
      banned.push(membershipData);
    } else if (membership.status === 'pending') {
      pending.push(membershipData);
    } else if (membership.type === 'moderator' || membership.type === 'admin') {
      moderating.push(membershipData);
    } else {
      joined.push(membershipData);
    }
  });

  res.status(200).json({
    success: true,
    count: memberships.length,
    data: {
      moderating,
      joined,
      pending,
      banned,
    },
  });
});

/**
 * @desc    Bir topluluğa katıl
 * @route   POST /api/subreddits/:subredditId/join
 * @access  Private
 */
const joinSubreddit = asyncHandler(async (req, res, next) => {
  const subredditId = req.params.subredditId;
  const userId = req.user._id;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Zaten üye mi kontrol et
  const existingMembership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (existingMembership) {
    // Banlanmış kullanıcı kontrolü
    if (existingMembership.status === 'banned') {
      return next(new ErrorResponse('Bu topluluğa katılmanız engellendi', 403));
    }

    // Zaten üye ise hata döndür
    if (existingMembership.status === 'active') {
      return next(new ErrorResponse('Bu topluluğa zaten üyesiniz', 400));
    }

    // Onay bekleyen bir istek varsa hata döndür
    if (existingMembership.status === 'pending') {
      return next(new ErrorResponse('Üyelik isteğiniz zaten onay bekliyor', 400));
    }

    // Diğer durumlarda üyeliği güncelle
    existingMembership.status = subreddit.type === 'private' ? 'pending' : 'active';
    existingMembership.joinedAt = Date.now();
    await existingMembership.save();
  } else {
    // Yeni üyelik oluştur
    await SubredditMembership.create({
      user: userId,
      subreddit: subredditId,
      type: 'member',
      status: subreddit.type === 'private' ? 'pending' : 'active',
      joinedAt: Date.now(),
    });
  }

  // Üye sayısını güncelle (private için onay bekliyorsa güncelleme)
  if (subreddit.type !== 'private' || existingMembership?.status === 'active') {
    subreddit.memberCount += 1;
    await subreddit.save();
  }

  res.status(200).json({
    success: true,
    message:
      subreddit.type === 'private'
        ? 'Üyelik isteğiniz gönderildi, onay bekleniyor'
        : 'Topluluğa başarıyla katıldınız',
    data: {
      subreddit: {
        _id: subreddit._id,
        name: subreddit.name,
        memberCount: subreddit.memberCount,
      },
      status: subreddit.type === 'private' ? 'pending' : 'active',
    },
  });
});

/**
 * @desc    Bir topluluktan ayrıl
 * @route   DELETE /api/subreddits/:subredditId/leave
 * @access  Private
 */
const leaveSubreddit = asyncHandler(async (req, res, next) => {
  const subredditId = req.params.subredditId;
  const userId = req.user._id;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Üyelik durumunu kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (!membership || membership.status !== 'active') {
    return next(new ErrorResponse('Bu topluluğa üye değilsiniz', 400));
  }

  // Kurucu kontrolü - kurucu ayrılamaz
  if (subreddit.creator.toString() === userId.toString()) {
    return next(new ErrorResponse('Topluluk kurucusu topluluğu terk edemez', 400));
  }

  // Üyeliği kaldır
  await SubredditMembership.findByIdAndDelete(membership._id);

  // Üye sayısını güncelle
  subreddit.memberCount = Math.max(0, subreddit.memberCount - 1);
  await subreddit.save();

  res.status(200).json({
    success: true,
    message: 'Topluluktan başarıyla ayrıldınız',
    data: {},
  });
});

/**
 * @desc    Bir topluluğu favorilere ekle/çıkar
 * @route   PUT /api/memberships/:membershipId/favorite
 * @access  Private
 */
const toggleFavorite = asyncHandler(async (req, res, next) => {
  const membershipId = req.params.membershipId;
  const { isFavorite } = req.body;

  // Üyeliğin varlığını ve kullanıcıya ait olduğunu kontrol et
  const membership = await SubredditMembership.findOne({
    _id: membershipId,
    user: req.user._id,
  });

  if (!membership) {
    return next(new ErrorResponse('Üyelik bulunamadı', 404));
  }

  // Favori durumunu güncelle
  membership.isFavorite = isFavorite === undefined ? !membership.isFavorite : isFavorite;
  await membership.save();

  res.status(200).json({
    success: true,
    message: membership.isFavorite
      ? 'Topluluk favorilere eklendi'
      : 'Topluluk favorilerden çıkarıldı',
    data: membership,
  });
});

/**
 * @desc    Kullanıcının bir toplulukta üyelik durumunu kontrol et
 * @route   GET /api/subreddits/:subredditId/membership-status
 * @access  Private
 */
const checkMembershipStatus = asyncHandler(async (req, res, next) => {
  const subredditId = req.params.subredditId;
  const userId = req.user._id;

  // Üyelik bilgisini sorgula
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (!membership) {
    return res.status(200).json({
      success: true,
      data: {
        isMember: false,
        status: null,
        type: null,
      },
    });
  }

  res.status(200).json({
    success: true,
    data: {
      isMember: membership.status === 'active',
      status: membership.status,
      type: membership.type,
      joinedAt: membership.joinedAt,
      isFavorite: membership.isFavorite,
      isBanned: membership.status === 'banned',
      banInfo:
        membership.status === 'banned'
          ? {
              reason: membership.banReason,
              expiresAt: membership.banExpiration,
              bannedAt: membership.bannedAt,
            }
          : null,
    },
  });
});

/**
 * @desc    Bir kullanıcıyı topluluktan yasakla
 * @route   POST /api/subreddits/:subredditId/ban/:userId
 * @access  Private (Moderatör/Admin)
 */
const banUser = asyncHandler(async (req, res, next) => {
  const { subredditId, userId } = req.params;
  const { reason, duration } = req.body;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Yetki kontrolü
  const modStatus = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modStatus && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Topluluk kurucusunu banlama kontrolü
  if (subreddit.creator.toString() === userId) {
    return next(new ErrorResponse('Topluluk kurucusu banlanamaz', 400));
  }

  // Moderatör banlama yetkisi kontrolü
  if (modStatus?.type !== 'admin') {
    const targetModStatus = await SubredditMembership.findOne({
      user: userId,
      subreddit: subredditId,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (targetModStatus) {
      return next(new ErrorResponse('Moderatörleri sadece topluluk admini banlayabilir', 403));
    }
  }

  // Kullanıcının üyelik durumunu bul veya oluştur
  let membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  // Ban süresi hesapla
  const banExpiration = duration
    ? new Date(Date.now() + parseInt(duration) * 24 * 60 * 60 * 1000)
    : null;

  if (membership) {
    // Aktif bir üye ise sayıyı azalt
    if (membership.status === 'active') {
      subreddit.memberCount = Math.max(0, subreddit.memberCount - 1);
      await subreddit.save();
    }

    // Üyeliği güncelle
    membership.type = 'banned';
    membership.status = 'banned';
    membership.banReason = reason || 'Moderatör kararıyla';
    membership.banExpiration = banExpiration;
    membership.bannedBy = req.user._id;
    membership.bannedAt = Date.now();

    await membership.save();
  } else {
    // Yeni üyelik kaydı oluştur
    membership = await SubredditMembership.create({
      user: userId,
      subreddit: subredditId,
      type: 'banned',
      status: 'banned',
      banReason: reason || 'Moderatör kararıyla',
      banExpiration: banExpiration,
      bannedBy: req.user._id,
      bannedAt: Date.now(),
    });
  }

  // Moderasyon logu oluştur
  await ModLog.create({
    user: req.user._id,
    subreddit: subredditId,
    action: 'ban_user',
    targetType: 'user',
    targetId: userId,
    details: `Kullanıcı yasaklandı: ${user.username}, Sebep: ${reason || 'Belirtilmedi'}, Süre: ${duration ? `${duration} gün` : 'Süresiz'}`,
  });

  res.status(200).json({
    success: true,
    message: `${user.username} kullanıcısı başarıyla yasaklandı`,
    data: {
      user: {
        _id: user._id,
        username: user.username,
      },
      banReason: membership.banReason,
      banExpiration: membership.banExpiration,
      bannedAt: membership.bannedAt,
    },
  });
});

/**
 * @desc    Bir kullanıcının yasağını kaldır
 * @route   DELETE /api/subreddits/:subredditId/ban/:userId
 * @access  Private (Moderatör/Admin)
 */
const unbanUser = asyncHandler(async (req, res, next) => {
  const { subredditId, userId } = req.params;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Yetki kontrolü
  const modStatus = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modStatus && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının banlanmış olup olmadığını kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    status: 'banned',
  });

  if (!membership) {
    return next(new ErrorResponse('Bu kullanıcı zaten yasaklanmamış', 400));
  }

  // Ban kaldır
  membership.type = 'member';
  membership.status = 'active';
  membership.banReason = null;
  membership.banExpiration = null;
  membership.bannedBy = null;
  membership.bannedAt = null;

  await membership.save();

  // Üye sayısını güncelle
  subreddit.memberCount += 1;
  await subreddit.save();

  // Moderasyon logu oluştur
  await ModLog.create({
    user: req.user._id,
    subreddit: subredditId,
    action: 'unban_user',
    targetType: 'user',
    targetId: userId,
    details: `Kullanıcının yasağı kaldırıldı: ${user.username}`,
  });

  res.status(200).json({
    success: true,
    message: `${user.username} kullanıcısının yasağı başarıyla kaldırıldı`,
    data: {
      user: {
        _id: user._id,
        username: user.username,
      },
    },
  });
});

/**
 * @desc    Bir topluluğun yasaklanmış kullanıcılarını listele
 * @route   GET /api/subreddits/:subredditId/banned-users
 * @access  Private (Moderatör/Admin)
 */
const getBannedUsers = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Yetki kontrolü
  const modStatus = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modStatus && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // Yasaklanmış kullanıcıları say
  const total = await SubredditMembership.countDocuments({
    subreddit: subredditId,
    status: 'banned',
  });

  // Yasaklanmış kullanıcıları getir
  const bannedUsers = await SubredditMembership.find({
    subreddit: subredditId,
    status: 'banned',
  })
    .populate('user', 'username profilePicture')
    .populate('bannedBy', 'username')
    .sort({ bannedAt: -1 })
    .skip(startIndex)
    .limit(limit);

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalDocs: total,
  };

  res.status(200).json({
    success: true,
    count: bannedUsers.length,
    pagination,
    data: bannedUsers,
  });
});

/**
 * @desc    Bekleyen üyelik isteklerini listele
 * @route   GET /api/subreddits/:subredditId/pending
 * @access  Private (Moderatör/Admin)
 */
const getPendingRequests = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Yetki kontrolü
  const modStatus = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modStatus && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // Bekleyen istekleri say
  const total = await SubredditMembership.countDocuments({
    subreddit: subredditId,
    status: 'pending',
  });

  // Bekleyen istekleri getir
  const pendingRequests = await SubredditMembership.find({
    subreddit: subredditId,
    status: 'pending',
  })
    .populate('user', 'username profilePicture karma')
    .sort({ joinedAt: 1 })
    .skip(startIndex)
    .limit(limit);

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalDocs: total,
  };

  res.status(200).json({
    success: true,
    count: pendingRequests.length,
    pagination,
    data: pendingRequests,
  });
});

/**
 * @desc    Bekleyen üyelik isteğini kabul et veya reddet
 * @route   PUT /api/memberships/:membershipId/respond
 * @access  Private (Moderatör/Admin)
 */
const respondToPendingRequest = asyncHandler(async (req, res, next) => {
  const { membershipId } = req.params;
  const { action } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return next(new ErrorResponse('Geçersiz işlem, approve veya reject olmalı', 400));
  }

  // Bekleyen üyelik isteğini kontrol et
  const membership = await SubredditMembership.findById(membershipId);

  if (!membership) {
    return next(new ErrorResponse('Üyelik isteği bulunamadı', 404));
  }

  if (membership.status !== 'pending') {
    return next(new ErrorResponse('Bu üyelik isteği zaten işlenmiş', 400));
  }

  // Yetki kontrolü
  const modStatus = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: membership.subreddit,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modStatus && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // Subreddit'i bul
  const subreddit = await Subreddit.findById(membership.subreddit);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  if (action === 'approve') {
    // İsteği onayla
    membership.status = 'active';
    await membership.save();

    // Üye sayısını güncelle
    subreddit.memberCount += 1;
    await subreddit.save();

    // Moderasyon logu oluştur
    await ModLog.create({
      user: req.user._id,
      subreddit: membership.subreddit,
      action: 'approve_membership',
      targetType: 'user',
      targetId: membership.user,
      details: `Üyelik isteği onaylandı`,
    });

    res.status(200).json({
      success: true,
      message: 'Üyelik isteği başarıyla onaylandı',
      data: membership,
    });
  } else {
    // İsteği reddet
    await SubredditMembership.findByIdAndDelete(membershipId);

    // Moderasyon logu oluştur
    await ModLog.create({
      user: req.user._id,
      subreddit: membership.subreddit,
      action: 'reject_membership',
      targetType: 'user',
      targetId: membership.user,
      details: `Üyelik isteği reddedildi`,
    });

    res.status(200).json({
      success: true,
      message: 'Üyelik isteği başarıyla reddedildi',
      data: {},
    });
  }
});

/**
 * @desc    Moderatör ekle
 * @route   POST /api/subreddits/:subredditId/moderators
 * @access  Private (Admin)
 */
const addModerator = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { userId, permissions } = req.body;

  if (!userId) {
    return next(new ErrorResponse('Kullanıcı ID gereklidir', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Yetki kontrolü - sadece topluluk admini veya site admini
  const isSubredditAdmin = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: 'admin',
    status: 'active',
  });

  if (!isSubredditAdmin && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının üyelik durumunu kontrol et
  let membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (membership) {
    // Zaten moderatör mü kontrol et
    if (membership.type === 'moderator' || membership.type === 'admin') {
      return next(new ErrorResponse('Bu kullanıcı zaten moderatör', 400));
    }

    // Banlanmış kullanıcı kontrolü
    if (membership.status === 'banned') {
      return next(new ErrorResponse('Banlanmış kullanıcı moderatör yapılamaz', 400));
    }

    // Normal üyeyi moderatör yap
    membership.type = 'moderator';
    membership.permissions = permissions || ['manage_posts', 'manage_comments', 'manage_users'];
    await membership.save();
  } else {
    // Yeni moderatör ekle
    membership = await SubredditMembership.create({
      user: userId,
      subreddit: subredditId,
      type: 'moderator',
      status: 'active',
      joinedAt: Date.now(),
      permissions: permissions || ['manage_posts', 'manage_comments', 'manage_users'],
    });

    // Üye sayısını güncelle
    subreddit.memberCount += 1;
    await subreddit.save();
  }

  // Moderasyon logu oluştur
  await ModLog.create({
    user: req.user._id,
    subreddit: subredditId,
    action: 'add_moderator',
    targetType: 'user',
    targetId: userId,
    details: `Moderatör eklendi: ${user.username}`,
  });

  // Moderatör bilgisini user detayları ile getir
  const populatedMembership = await SubredditMembership.findById(membership._id).populate(
    'user',
    'username profilePicture',
  );

  res.status(200).json({
    success: true,
    message: `${user.username} moderatör olarak eklendi`,
    data: populatedMembership,
  });
});

/**
 * @desc    Moderatörü kaldır
 * @route   DELETE /api/subreddits/:subredditId/moderators/:userId
 * @access  Private (Admin)
 */
const removeModerator = asyncHandler(async (req, res, next) => {
  const { subredditId, userId } = req.params;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Yetki kontrolü - sadece topluluk admini veya site admini
  const isSubredditAdmin = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: 'admin',
    status: 'active',
  });

  if (!isSubredditAdmin && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    type: 'moderator',
  });

  if (!membership) {
    return next(new ErrorResponse('Bu kullanıcı zaten moderatör değil', 400));
  }

  // Moderatör yetkisini normal üyeliğe düşür
  membership.type = 'member';
  membership.permissions = [];
  await membership.save();

  // Moderasyon logu oluştur
  await ModLog.create({
    user: req.user._id,
    subreddit: subredditId,
    action: 'remove_moderator',
    targetType: 'user',
    targetId: userId,
    details: `Moderatör çıkarıldı: ${user.username}`,
  });

  res.status(200).json({
    success: true,
    message: `${user.username} moderatörlükten çıkarıldı`,
    data: {
      user: {
        _id: user._id,
        username: user.username,
      },
    },
  });
});

/**
 * @desc    Moderatör izinlerini güncelle
 * @route   PUT /api/subreddits/:subredditId/moderators/:userId
 * @access  Private (Admin)
 */
const updateModeratorPermissions = asyncHandler(async (req, res, next) => {
  const { subredditId, userId } = req.params;
  const { permissions } = req.body;

  if (!permissions || !Array.isArray(permissions)) {
    return next(new ErrorResponse('Geçerli izinler dizisi gereklidir', 400));
  }

  // İzinlerin geçerliliğini kontrol et
  const validPermissions = [
    'manage_posts',
    'manage_comments',
    'manage_users',
    'manage_settings',
    'manage_flair',
    'manage_rules',
  ];
  const isValidPermissions = permissions.every((perm) => validPermissions.includes(perm));

  if (!isValidPermissions) {
    return next(new ErrorResponse('Geçersiz izinler bulunmaktadır', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Yetki kontrolü - sadece topluluk admini veya site admini
  const isSubredditAdmin = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: 'admin',
    status: 'active',
  });

  if (!isSubredditAdmin && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkiniz yok', 403));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    type: 'moderator',
  });

  if (!membership) {
    return next(new ErrorResponse('Bu kullanıcı moderatör değil', 400));
  }

  // İzinleri güncelle
  membership.permissions = permissions;
  await membership.save();

  // Moderasyon logu oluştur
  await ModLog.create({
    user: req.user._id,
    subreddit: subredditId,
    action: 'update_moderator_permissions',
    targetType: 'user',
    targetId: userId,
    details: `Moderatör izinleri güncellendi: ${permissions.join(', ')}`,
  });

  // Kullanıcı bilgisi ile getir
  const user = await User.findById(userId).select('username profilePicture');

  res.status(200).json({
    success: true,
    message: 'Moderatör izinleri başarıyla güncellendi',
    data: {
      _id: membership._id,
      user: {
        _id: user._id,
        username: user.username,
        profilePicture: user.profilePicture,
      },
      permissions: membership.permissions,
      type: membership.type,
      status: membership.status,
      joinedAt: membership.joinedAt,
    },
  });
});

/**
 * @desc    Bir topluluğun moderatörlerini listele
 * @route   GET /api/subreddits/:subredditId/moderators
 * @access  Public
 */
const getModerators = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Moderatörleri getir
  const moderators = await SubredditMembership.find({
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  })
    .populate('user', 'username profilePicture createdAt')
    .sort({ type: -1, joinedAt: 1 }); // Admin'ler önce, sonra eski moderatörler

  // Moderatör listesini düzenle
  const formattedModerators = moderators.map((mod) => ({
    _id: mod._id,
    user: {
      _id: mod.user._id,
      username: mod.user.username,
      profilePicture: mod.user.profilePicture,
    },
    role: mod.type === 'admin' ? 'Kurucu' : 'Moderatör',
    permissions: mod.permissions || [],
    joinedAt: mod.joinedAt,
  }));

  res.status(200).json({
    success: true,
    count: moderators.length,
    data: formattedModerators,
  });
});

/**
 * @desc    Bir topluluğun üyelerini listele
 * @route   GET /api/subreddits/:subredditId/members
 * @access  Public (Sayfalama ile)
 */
const getMembers = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Sıralama seçeneği
  const sortBy = req.query.sortBy || 'joinedAt';
  const sortOrder = req.query.sortOrder || 'desc';

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Topluluk bulunamadı', 404));
  }

  // Üye sayısını say (sadece aktif üyeler)
  const total = await SubredditMembership.countDocuments({
    subreddit: subredditId,
    status: 'active',
  });

  // Sıralama seçeneklerini ayarla
  let sort = {};
  if (sortBy === 'joinedAt') {
    sort.joinedAt = sortOrder === 'asc' ? 1 : -1;
  } else if (sortBy === 'username') {
    // Kullanıcı adına göre sıralama için özel işlem gerekir
    // Bu sorgu örnek değildir, kullanıcı adı bilgisine göre sıralama için populate edilen veriler üzerinde JS sıralama yapılabilir
    sort = { joinedAt: -1 }; // Varsayılan sıralama
  }

  // Üyeleri getir
  let members = await SubredditMembership.find({
    subreddit: subredditId,
    status: 'active',
  })
    .populate('user', 'username profilePicture karma createdAt')
    .sort(sort)
    .skip(startIndex)
    .limit(limit);

  // Kullanıcı adına göre sıralama yapılacaksa
  if (sortBy === 'username') {
    members = members.sort((a, b) => {
      if (!a.user || !b.user) return 0;
      return sortOrder === 'asc'
        ? a.user.username.localeCompare(b.user.username)
        : b.user.username.localeCompare(a.user.username);
    });
  }

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalDocs: total,
  };

  if (startIndex + limit < total) {
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
    count: members.length,
    pagination,
    data: members,
  });
});

/**
 * @desc    Üyelik detaylarını getir
 * @route   GET /api/memberships/:membershipId
 * @access  Private
 */
const getMembership = asyncHandler(async (req, res, next) => {
  const { membershipId } = req.params;

  // Üyeliğin var olup olmadığını kontrol et
  const membership = await SubredditMembership.findById(membershipId)
    .populate('user', 'username profilePicture')
    .populate('subreddit', 'name title icon banner memberCount type')
    .populate('bannedBy', 'username');

  if (!membership) {
    return next(new ErrorResponse('Üyelik bulunamadı', 404));
  }

  // Yetki kontrolü - sadece kendi üyeliği veya mod/admin
  const isOwnMembership = membership.user._id.toString() === req.user._id.toString();

  if (!isOwnMembership && req.user.role !== 'admin') {
    const modStatus = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: membership.subreddit._id,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!modStatus) {
      return next(new ErrorResponse('Bu üyeliği görüntüleme yetkiniz yok', 403));
    }
  }

  res.status(200).json({
    success: true,
    data: membership,
  });
});

module.exports = {
  getUserMemberships,
  joinSubreddit,
  leaveSubreddit,
  toggleFavorite,
  checkMembershipStatus,
  banUser,
  unbanUser,
  getBannedUsers,
  getPendingRequests,
  respondToPendingRequest,
  addModerator,
  removeModerator,
  updateModeratorPermissions,
  getModerators,
  getMembers,
  getMembership,
};
