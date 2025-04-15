const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const SubredditMembership = require('../models/SubredditMembership');
const Subreddit = require('../models/Subreddit');
const User = require('../models/User');
const Notification = require('../models/Notification');
const AdminLog = require('../models/AdminLog');
const ModLog = require('../models/ModLog');

/**
 * @desc    Subreddit'e üye ol
 * @route   POST /api/subreddits/:subredditId/memberships
 * @access  Üye (private subreddit) / Public
 */
const joinSubreddit = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının zaten üye olup olmadığını kontrol et
  const existingMembership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (existingMembership) {
    // Daha önce banlanmış bir üye mi kontrol et
    if (existingMembership.status === 'banned') {
      return next(new ErrorResponse('Bu topluluğa katılmanız engellendi', 403));
    }

    // Zaten üye ise hata döndür
    if (
      existingMembership.status === 'member' ||
      existingMembership.status === 'moderator' ||
      existingMembership.status === 'admin'
    ) {
      return next(new ErrorResponse('Bu topluluğa zaten üyesiniz', 400));
    }

    // Onay bekleyen bir istek varsa hata döndür
    if (existingMembership.status === 'pending') {
      return next(new ErrorResponse('Üyelik isteğiniz zaten onay bekliyor', 400));
    }

    // Diğer durumlarda üyeliği güncelle
    existingMembership.status = subreddit.type === 'private' ? 'pending' : 'member';
    existingMembership.joinedAt = Date.now();
    await existingMembership.save();

    // Özel subreddit ise moderatörlere bildirim gönder
    if (subreddit.type === 'private') {
      // Moderatörleri bul
      const moderators = await SubredditMembership.find({
        subreddit: subredditId,
        type: { $in: ['moderator', 'admin'] },
        status: 'active',
      }).select('user');

      // Her moderatöre bildirim gönder
      if (moderators.length > 0) {
        const notifications = moderators.map((mod) => ({
          recipient: mod.user,
          type: 'subreddit_join_request',
          message: `${req.user.username} kullanıcısı r/${subreddit.name} topluluğuna katılmak istiyor`,
          reference: {
            type: 'Subreddit',
            id: subredditId,
          },
          data: {
            subredditName: subreddit.name,
            requestingUser: userId,
          },
          isRead: false,
        }));

        await Notification.insertMany(notifications);
      }

      return res.status(200).json({
        success: true,
        message: 'Üyelik isteğiniz moderatörlere iletildi',
        data: {
          status: 'pending',
          subreddit: {
            id: subreddit._id,
            name: subreddit.name,
            type: subreddit.type,
          },
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: `r/${subreddit.name} topluluğuna başarıyla katıldınız`,
      data: {
        status: 'member',
        subreddit: {
          id: subreddit._id,
          name: subreddit.name,
          type: subreddit.type,
        },
      },
    });
  }

  // Yeni üyelik oluştur
  const membershipStatus = subreddit.type === 'private' ? 'pending' : 'member';

  const membership = await SubredditMembership.create({
    user: userId,
    subreddit: subredditId,
    type: 'regular',
    status: membershipStatus,
    joinedAt: Date.now(),
  });

  // Üye sayısını güncelle
  if (membershipStatus === 'member') {
    await Subreddit.findByIdAndUpdate(subredditId, { $inc: { memberCount: 1 } });
  }

  // Özel subreddit ise moderatörlere bildirim gönder
  if (subreddit.type === 'private') {
    // Moderatörleri bul
    const moderators = await SubredditMembership.find({
      subreddit: subredditId,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    }).select('user');

    // Her moderatöre bildirim gönder
    if (moderators.length > 0) {
      const notifications = moderators.map((mod) => ({
        recipient: mod.user,
        type: 'subreddit_join_request',
        message: `${req.user.username} kullanıcısı r/${subreddit.name} topluluğuna katılmak istiyor`,
        reference: {
          type: 'Subreddit',
          id: subredditId,
        },
        data: {
          subredditName: subreddit.name,
          requestingUser: userId,
        },
        isRead: false,
      }));

      await Notification.insertMany(notifications);
    }

    return res.status(200).json({
      success: true,
      message: 'Üyelik isteğiniz moderatörlere iletildi',
      data: {
        status: 'pending',
        subreddit: {
          id: subreddit._id,
          name: subreddit.name,
          type: subreddit.type,
        },
      },
    });
  }

  res.status(201).json({
    success: true,
    message: `r/${subreddit.name} topluluğuna başarıyla katıldınız`,
    data: membership,
  });
});

/**
 * @desc    Subreddit'ten ayrıl
 * @route   DELETE /api/subreddits/:subredditId/memberships
 * @access  Üye
 */
const leaveSubreddit = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının üyeliğini kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (!membership) {
    return next(new ErrorResponse('Bu topluluğa üye değilsiniz', 400));
  }

  // Topluluk sahibi (admin) topluluktan ayrılamaz
  if (membership.type === 'admin') {
    return next(
      new ErrorResponse(
        'Topluluk sahibi olarak topluluktan ayrılamazsınız. Önce başka bir kullanıcıyı topluluk sahibi olarak atamalısınız.',
        400,
      ),
    );
  }

  // Üye durumunu güncelle
  await SubredditMembership.findByIdAndUpdate(membership._id, {
    status: 'left',
    leftAt: Date.now(),
  });

  // Üye sayısını güncelle (sadece aktif üyelikler için)
  if (membership.status === 'member' || membership.status === 'moderator') {
    await Subreddit.findByIdAndUpdate(subredditId, { $inc: { memberCount: -1 } });
  }

  // Moderatör ise moderatör logunu kaydet
  if (membership.type === 'moderator') {
    await ModLog.create({
      subreddit: subredditId,
      action: 'moderator_left',
      moderator: userId,
      target: userId,
      details: `${req.user.username} moderatör olarak topluluktan ayrıldı`,
      timestamp: Date.now(),
    });
  }

  res.status(200).json({
    success: true,
    message: `r/${subreddit.name} topluluğundan başarıyla ayrıldınız`,
    data: {
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
    },
  });
});

/**
 * @desc    Kullanıcının topluluk üyeliğini kontrol et
 * @route   GET /api/subreddits/:subredditId/membership/check
 * @access  Üye
 */
const checkMembership = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının üyeliğini kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (!membership) {
    return res.status(200).json({
      success: true,
      isMember: false,
      data: {
        subreddit: {
          id: subreddit._id,
          name: subreddit.name,
          type: subreddit.type,
        },
      },
    });
  }

  res.status(200).json({
    success: true,
    isMember:
      membership.status === 'member' ||
      membership.status === 'moderator' ||
      membership.status === 'admin',
    isPending: membership.status === 'pending',
    isBanned: membership.status === 'banned',
    isModerator: membership.type === 'moderator' || membership.type === 'admin',
    isAdmin: membership.type === 'admin',
    data: {
      membership: {
        id: membership._id,
        type: membership.type,
        status: membership.status,
        joinedAt: membership.joinedAt,
      },
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
        type: subreddit.type,
      },
    },
  });
});

/**
 * @desc    Kullanıcının üye olduğu toplulukları getir
 * @route   GET /api/users/:userId/memberships
 * @access  Üye (kendi profili) / Admin (tüm profiller)
 */
const getUserMemberships = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz Kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Yetki kontrolü (sadece kendi profilini veya admin görüntüleyebilir)
  if (userId !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için yetkiniz yok', 403));
  }

  // Sayfalama için parametreleri al
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Filtreleme parametrelerini al
  const { status, type } = req.query;

  // Sorgu parametrelerini oluştur
  const query = { user: userId };

  if (status) {
    query.status = status;
  } else {
    // Varsayılan olarak sadece aktif üyelikleri getir
    query.status = { $in: ['member', 'moderator', 'admin'] };
  }

  if (type) {
    query.type = type;
  }

  // Toplam üyelik sayısını al
  const total = await SubredditMembership.countDocuments(query);

  // Üyelikleri getir ve subreddit bilgilerini popüle et
  const memberships = await SubredditMembership.find(query)
    .sort({ joinedAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate('subreddit', 'name title description type memberCount createdAt icon banner');

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
    count: memberships.length,
    total,
    pagination,
    data: memberships,
  });
});

/**
 * @desc    Topluluk üyelerini getir
 * @route   GET /api/subreddits/:subredditId/memberships
 * @access  Herkese Açık (basic) / Moderatör (detaylı)
 */
const getSubredditMembers = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  let isModerator = false;
  if (req.user) {
    const modMembership = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (modMembership) {
      isModerator = true;
    }
  }

  // Sayfalama için parametreleri al
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Filtreleme ve sıralama parametrelerini al
  const { search, type, status, sortBy, order } = req.query;

  // Sorgu parametrelerini oluştur
  const query = { subreddit: subredditId };

  // Moderatör değilse, sadece aktif üyeleri görebilir
  if (!isModerator) {
    query.status = 'active';
    query.type = { $in: ['regular', 'moderator', 'admin'] };
  } else {
    // Moderatör ise filtreleme yapabilir
    if (status) {
      query.status = status;
    }

    if (type) {
      query.type = type;
    }
  }

  // Arama sorgusu
  if (search && isModerator) {
    const users = await User.find({
      $or: [
        { username: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
      ],
    }).select('_id');

    query.user = { $in: users.map((u) => u._id) };
  }

  // Sıralama seçenekleri
  const sortOptions = {};

  if (sortBy && ['joinedAt', 'lastActiveAt', 'type'].includes(sortBy)) {
    sortOptions[sortBy] = order === 'asc' ? 1 : -1;
  } else {
    // Varsayılan sıralama
    sortOptions.joinedAt = -1;
  }

  // Toplam üye sayısını al
  const total = await SubredditMembership.countDocuments(query);

  // Üyeleri getir ve kullanıcı bilgilerini popüle et
  const memberships = await SubredditMembership.find(query)
    .sort(sortOptions)
    .skip(startIndex)
    .limit(limit)
    .populate('user', 'username displayName avatar createdAt lastActive');

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
    count: memberships.length,
    total,
    pagination,
    data: {
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
        memberCount: subreddit.memberCount,
      },
      members: memberships,
    },
  });
});

/**
 * @desc    Üyelik isteğini onayla/reddet
 * @route   PUT /api/subreddits/:subredditId/memberships/:membershipId
 * @access  Moderatör
 */
const updateMembershipRequest = asyncHandler(async (req, res, next) => {
  const { subredditId, membershipId } = req.params;
  const { action } = req.body;

  // Parametreleri doğrula
  if (!action || !['approve', 'reject'].includes(action)) {
    return next(new ErrorResponse('Geçersiz işlem. "approve" veya "reject" olmalıdır', 400));
  }

  // Geçerli ObjectId'ler mi kontrol et
  if (
    !mongoose.Types.ObjectId.isValid(subredditId) ||
    !mongoose.Types.ObjectId.isValid(membershipId)
  ) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const modMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modMembership) {
    return next(new ErrorResponse('Bu işlem için yetkiniz yok', 403));
  }

  // Üyelik isteğini bul
  const membership = await SubredditMembership.findOne({
    _id: membershipId,
    subreddit: subredditId,
    status: 'pending',
  }).populate('user', 'username displayName');

  if (!membership) {
    return next(new ErrorResponse('Geçerli bir üyelik isteği bulunamadı', 404));
  }

  // İşleme göre üyeliği güncelle
  if (action === 'approve') {
    membership.status = 'active';
    membership.approvedBy = req.user._id;
    membership.approvedAt = Date.now();
    await membership.save();

    // Üye sayısını güncelle
    await Subreddit.findByIdAndUpdate(subredditId, { $inc: { memberCount: 1 } });

    // Moderatör logunu kaydet
    await ModLog.create({
      subreddit: subredditId,
      action: 'membership_approved',
      moderator: req.user._id,
      target: membership.user._id,
      details: `${membership.user.username} kullanıcısının üyelik isteği onaylandı`,
      timestamp: Date.now(),
    });

    // Kullanıcıya bildirim gönder
    await Notification.create({
      recipient: membership.user._id,
      type: 'membership_approved',
      message: `r/${subreddit.name} topluluğuna üyelik isteğiniz onaylandı`,
      reference: {
        type: 'Subreddit',
        id: subredditId,
      },
      isRead: false,
    });

    res.status(200).json({
      success: true,
      message: 'Üyelik isteği onaylandı',
      data: membership,
    });
  } else {
    // İsteği reddet
    membership.status = 'rejected';
    membership.rejectedBy = req.user._id;
    membership.rejectedAt = Date.now();
    await membership.save();

    // Moderatör logunu kaydet
    await ModLog.create({
      subreddit: subredditId,
      action: 'membership_rejected',
      moderator: req.user._id,
      target: membership.user._id,
      details: `${membership.user.username} kullanıcısının üyelik isteği reddedildi`,
      timestamp: Date.now(),
    });

    // Kullanıcıya bildirim gönder
    await Notification.create({
      recipient: membership.user._id,
      type: 'membership_rejected',
      message: `r/${subreddit.name} topluluğuna üyelik isteğiniz reddedildi`,
      reference: {
        type: 'Subreddit',
        id: subredditId,
      },
      isRead: false,
    });

    res.status(200).json({
      success: true,
      message: 'Üyelik isteği reddedildi',
      data: membership,
    });
  }
});

/**
 * @desc    Kullanıcıyı topluluktan yasakla
 * @route   POST /api/subreddits/:subredditId/bans
 * @access  Moderatör
 */
const banUser = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { userId, reason, duration, modNote, sendMessage } = req.body;

  // Parametreleri doğrula
  if (!userId) {
    return next(new ErrorResponse("Kullanıcı ID'si zorunludur", 400));
  }

  // Geçerli ObjectId'ler mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId) || !mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const modMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modMembership) {
    return next(new ErrorResponse('Bu işlem için yetkiniz yok', 403));
  }

  // Hedef kullanıcının topluluk sahibi (admin) olup olmadığını kontrol et
  const targetMembership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (targetMembership && targetMembership.type === 'admin') {
    return next(new ErrorResponse('Topluluk sahibini yasaklayamazsınız', 403));
  }

  // Daha üst yetkili bir moderatörü yasaklamaya çalışıyor mu kontrol et
  if (targetMembership && targetMembership.type === 'moderator' && modMembership.type !== 'admin') {
    return next(
      new ErrorResponse('Diğer moderatörleri sadece topluluk sahibi yasaklayabilir', 403),
    );
  }

  // Ban süresi hesapla (varsa)
  let banExpiresAt = null;
  if (duration) {
    const durationDays = parseInt(duration, 10);
    if (isNaN(durationDays) || durationDays < 1) {
      return next(new ErrorResponse('Ban süresi geçerli bir sayı olmalıdır', 400));
    }

    banExpiresAt = new Date();
    banExpiresAt.setDate(banExpiresAt.getDate() + durationDays);
  }

  // Kullanıcının üyeliğini güncelle veya yeni üyelik oluştur
  if (targetMembership) {
    targetMembership.status = 'banned';
    targetMembership.bannedBy = req.user._id;
    targetMembership.bannedAt = Date.now();
    targetMembership.banReason = reason || 'Topluluk kurallarını ihlal';
    targetMembership.banExpiresAt = banExpiresAt;
    targetMembership.modNote = modNote;

    await targetMembership.save();
  } else {
    // Kullanıcının üyeliği yoksa, banned durumunda yeni üyelik oluştur
    await SubredditMembership.create({
      user: userId,
      subreddit: subredditId,
      type: 'regular',
      status: 'banned',
      bannedBy: req.user._id,
      bannedAt: Date.now(),
      banReason: reason || 'Topluluk kurallarını ihlal',
      banExpiresAt: banExpiresAt,
      modNote: modNote,
    });
  }

  // Üye sayısını güncelle (eğer aktif bir üye yasaklandıysa)
  if (
    targetMembership &&
    (targetMembership.status === 'active' || targetMembership.status === 'moderator')
  ) {
    await Subreddit.findByIdAndUpdate(subredditId, { $inc: { memberCount: -1 } });
  }

  // Moderatör logunu kaydet
  await ModLog.create({
    subreddit: subredditId,
    action: 'user_banned',
    moderator: req.user._id,
    target: userId,
    details: reason || 'Topluluk kurallarını ihlal',
    data: {
      banExpiresAt,
      modNote,
    },
    timestamp: Date.now(),
  });

  // Kullanıcıya bildirim gönder
  await Notification.create({
    recipient: userId,
    type: 'subreddit_ban',
    message: `r/${subreddit.name} topluluğundan yasaklandınız${banExpiresAt ? ` (${duration} gün)` : ''}`,
    reference: {
      type: 'Subreddit',
      id: subredditId,
    },
    data: {
      reason: reason || 'Topluluk kurallarını ihlal',
      banExpiresAt,
      permanent: !banExpiresAt,
    },
    isRead: false,
  });

  // Kullanıcıya mesaj gönder (eğer istenirse)
  if (sendMessage && sendMessage.trim() !== '') {
    // Sistemden gelen mesaj olarak işaretle
    await Message.create({
      sender: req.user._id,
      recipient: userId,
      subject: `r/${subreddit.name} topluluğundan yasaklandınız`,
      body: sendMessage,
      isSystemMessage: true,
      metadata: {
        type: 'ban_notification',
        subreddit: subredditId,
      },
    });
  }

  res.status(200).json({
    success: true,
    message: `${user.username} kullanıcısı başarıyla topluluktan yasaklandı`,
    data: {
      userId,
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
      reason,
      banExpiresAt,
      permanent: !banExpiresAt,
    },
  });
});

/**
 * @desc    Kullanıcının topluluk yasağını kaldır
 * @route   DELETE /api/subreddits/:subredditId/bans/:userId
 * @access  Moderatör
 */
const unbanUser = asyncHandler(async (req, res, next) => {
  const { subredditId, userId } = req.params;
  const { sendMessage } = req.body;

  // Geçerli ObjectId'ler mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId) || !mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const modMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modMembership) {
    return next(new ErrorResponse('Bu işlem için yetkiniz yok', 403));
  }

  // Kullanıcının yasaklı olup olmadığını kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    status: 'banned',
  });

  if (!membership) {
    return next(new ErrorResponse('Bu kullanıcı topluluktan yasaklı değil', 404));
  }

  // Üyeliği güncelle
  membership.status = 'left'; // Önceki durumuna değil, left durumuna geçir (yeniden katılması gerekecek)
  membership.unbannedBy = req.user._id;
  membership.unbannedAt = Date.now();
  await membership.save();

  // Moderatör logunu kaydet
  await ModLog.create({
    subreddit: subredditId,
    action: 'user_unbanned',
    moderator: req.user._id,
    target: userId,
    details: 'Kullanıcının topluluk yasağı kaldırıldı',
    timestamp: Date.now(),
  });

  // Kullanıcıya bildirim gönder
  await Notification.create({
    recipient: userId,
    type: 'subreddit_unban',
    message: `r/${subreddit.name} topluluğundan yasağınız kaldırıldı`,
    reference: {
      type: 'Subreddit',
      id: subredditId,
    },
    isRead: false,
  });

  // Kullanıcıya mesaj gönder (eğer istenirse)
  if (sendMessage && sendMessage.trim() !== '') {
    await Message.create({
      sender: req.user._id,
      recipient: userId,
      subject: `r/${subreddit.name} topluluğundan yasağınız kaldırıldı`,
      body: sendMessage,
      isSystemMessage: true,
      metadata: {
        type: 'unban_notification',
        subreddit: subredditId,
      },
    });
  }

  res.status(200).json({
    success: true,
    message: `${user.username} kullanıcısının topluluk yasağı başarıyla kaldırıldı`,
    data: {
      userId,
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
    },
  });
});

/**
 * @desc    Kullanıcıyı moderatör olarak ata
 * @route   POST /api/subreddits/:subredditId/moderators
 * @access  Admin
 */
const addModerator = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { userId, permissions } = req.body;

  // Parametreleri doğrula
  if (!userId) {
    return next(new ErrorResponse("Kullanıcı ID'si zorunludur", 400));
  }

  // Geçerli ObjectId'ler mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId) || !mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının admin olup olmadığını kontrol et
  const requesterMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: 'admin',
    status: 'active',
  });

  if (!requesterMembership) {
    return next(new ErrorResponse('Bu işlem için topluluk sahibi olmalısınız', 403));
  }

  // Kullanıcının mevcut üyeliğini kontrol et
  let membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  // Yasaklı kullanıcı kontrolü
  if (membership && membership.status === 'banned') {
    return next(new ErrorResponse('Yasaklı bir kullanıcıyı moderatör olarak atamazsınız', 400));
  }

  // Zaten moderatör mü kontrolü
  if (membership && (membership.type === 'moderator' || membership.type === 'admin')) {
    return next(new ErrorResponse('Bu kullanıcı zaten moderatör veya topluluk sahibi', 400));
  }

  // Moderatör izinlerini kontrol et
  const validPermissions = [
    'all',
    'manage_settings',
    'manage_flair',
    'manage_posts',
    'manage_comments',
    'manage_users',
    'manage_automod',
    'view_traffic',
    'mail',
    'access',
    'wiki',
  ];

  const modPermissions =
    permissions && Array.isArray(permissions)
      ? permissions.filter((p) => validPermissions.includes(p))
      : ['access', 'posts', 'mail']; // Varsayılan izinler

  if (membership) {
    // Mevcut üyeliği güncelle
    membership.type = 'moderator';
    membership.status = 'active';
    membership.permissions = modPermissions;
    membership.updatedAt = Date.now();
    await membership.save();
  } else {
    // Yeni moderatör üyeliği oluştur
    membership = await SubredditMembership.create({
      user: userId,
      subreddit: subredditId,
      type: 'moderator',
      status: 'active',
      permissions: modPermissions,
      joinedAt: Date.now(),
    });

    // Üye sayısını güncelle
    await Subreddit.findByIdAndUpdate(subredditId, { $inc: { memberCount: 1 } });
  }

  // Moderatör logunu kaydet
  await ModLog.create({
    subreddit: subredditId,
    action: 'moderator_added',
    moderator: req.user._id,
    target: userId,
    details: `${user.username} kullanıcısı moderatör olarak atandı`,
    data: {
      permissions: modPermissions,
    },
    timestamp: Date.now(),
  });

  // Kullanıcıya bildirim gönder
  await Notification.create({
    recipient: userId,
    type: 'moderator_added',
    message: `r/${subreddit.name} topluluğuna moderatör olarak atandınız`,
    reference: {
      type: 'Subreddit',
      id: subredditId,
    },
    isRead: false,
  });

  res.status(200).json({
    success: true,
    message: `${user.username} kullanıcısı başarıyla moderatör olarak atandı`,
    data: {
      membership,
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
    },
  });
});

/**
 * @desc    Moderatör olarak kullanıcıyı kaldır
 * @route   DELETE /api/subreddits/:subredditId/moderators/:userId
 * @access  Admin
 */
const removeModerator = asyncHandler(async (req, res, next) => {
  const { subredditId, userId } = req.params;

  // Geçerli ObjectId'ler mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId) || !mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının admin olup olmadığını kontrol et
  const requesterMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: 'admin',
    status: 'active',
  });

  if (!requesterMembership) {
    return next(new ErrorResponse('Bu işlem için topluluk sahibi olmalısınız', 403));
  }

  // Hedef kullanıcının moderatör olup olmadığını kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    type: 'moderator',
    status: 'active',
  });

  if (!membership) {
    return next(new ErrorResponse('Bu kullanıcı topluluğun moderatörü değil', 404));
  }

  // Topluluk sahibini (admin) kaldırmaya çalışıyor mu kontrol et
  if (membership.type === 'admin') {
    return next(new ErrorResponse('Topluluk sahibi moderatörlükten çıkarılamaz', 403));
  }

  // Moderatörlüğü kaldır, normal üye yap
  membership.type = 'regular';
  membership.permissions = [];
  membership.updatedAt = Date.now();
  await membership.save();

  // Moderatör logunu kaydet
  await ModLog.create({
    subreddit: subredditId,
    action: 'moderator_removed',
    moderator: req.user._id,
    target: userId,
    details: `${user.username} kullanıcısının moderatörlüğü kaldırıldı`,
    timestamp: Date.now(),
  });

  // Kullanıcıya bildirim gönder
  await Notification.create({
    recipient: userId,
    type: 'moderator_removed',
    message: `r/${subreddit.name} topluluğundaki moderatörlüğünüz kaldırıldı`,
    reference: {
      type: 'Subreddit',
      id: subredditId,
    },
    isRead: false,
  });

  res.status(200).json({
    success: true,
    message: `${user.username} kullanıcısının moderatörlüğü başarıyla kaldırıldı`,
    data: {
      userId,
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
    },
  });
});

/**
 * @desc    Moderatör izinlerini güncelle
 * @route   PUT /api/subreddits/:subredditId/moderators/:userId
 * @access  Admin
 */
const updateModeratorPermissions = asyncHandler(async (req, res, next) => {
  const { subredditId, userId } = req.params;
  const { permissions } = req.body;

  // Parametreleri doğrula
  if (!permissions || !Array.isArray(permissions)) {
    return next(new ErrorResponse('İzinler bir dizi olarak belirtilmelidir', 400));
  }

  // Geçerli ObjectId'ler mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId) || !mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının admin olup olmadığını kontrol et
  const requesterMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: 'admin',
    status: 'active',
  });

  if (!requesterMembership) {
    return next(new ErrorResponse('Bu işlem için topluluk sahibi olmalısınız', 403));
  }

  // Hedef kullanıcının moderatör olup olmadığını kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    type: 'moderator',
    status: 'active',
  });

  if (!membership) {
    return next(new ErrorResponse('Bu kullanıcı topluluğun moderatörü değil', 404));
  }

  // Moderatör izinlerini kontrol et ve geçerli olanları filtrele
  const validPermissions = [
    'all',
    'manage_settings',
    'manage_flair',
    'manage_posts',
    'manage_comments',
    'manage_users',
    'manage_automod',
    'view_traffic',
    'mail',
    'access',
    'wiki',
  ];

  const modPermissions = permissions.filter((p) => validPermissions.includes(p));

  // İzinleri güncelle
  membership.permissions = modPermissions;
  membership.updatedAt = Date.now();
  await membership.save();

  // Moderatör logunu kaydet
  await ModLog.create({
    subreddit: subredditId,
    action: 'moderator_permissions_updated',
    moderator: req.user._id,
    target: userId,
    details: `${user.username} kullanıcısının moderatör izinleri güncellendi`,
    data: {
      permissions: modPermissions,
    },
    timestamp: Date.now(),
  });

  res.status(200).json({
    success: true,
    message: `${user.username} kullanıcısının moderatör izinleri başarıyla güncellendi`,
    data: {
      membership,
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
    },
  });
});

/**
 * @desc    Topluluk sahibini değiştir
 * @route   PUT /api/subreddits/:subredditId/transfer-ownership
 * @access  Admin
 */
const transferOwnership = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { userId, confirmationCode } = req.body;

  // Parametreleri doğrula
  if (!userId) {
    return next(new ErrorResponse("Kullanıcı ID'si zorunludur", 400));
  }

  // Onay kodu kontrolü
  if (!confirmationCode || confirmationCode !== 'TRANSFER_CONFIRM') {
    return next(
      new ErrorResponse(
        'Sahiplik transferini onaylamak için "TRANSFER_CONFIRM" kodunu göndermelisiniz',
        400,
      ),
    );
  }

  // Geçerli ObjectId'ler mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId) || !mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının varlığını kontrol et
  const newOwner = await User.findById(userId);
  if (!newOwner) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının admin olup olmadığını kontrol et
  const requesterMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: 'admin',
    status: 'active',
  });

  if (!requesterMembership) {
    return next(new ErrorResponse('Bu işlem için topluluk sahibi olmalısınız', 403));
  }

  // Kendisine transfer etmeye çalışıyor mu kontrol et
  if (userId === req.user._id.toString()) {
    return next(new ErrorResponse('Topluluk sahipliğini kendinize transfer edemezsiniz', 400));
  }

  // Yeni sahibin üyeliğini kontrol et
  let newOwnerMembership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  // Yasaklı kullanıcı kontrolü
  if (newOwnerMembership && newOwnerMembership.status === 'banned') {
    return next(
      new ErrorResponse('Yasaklı bir kullanıcıya topluluk sahipliği transfer edemezsiniz', 400),
    );
  }

  // Yeni sahibin üyeliği yoksa oluştur
  if (!newOwnerMembership) {
    newOwnerMembership = await SubredditMembership.create({
      user: userId,
      subreddit: subredditId,
      type: 'regular',
      status: 'active',
      joinedAt: Date.now(),
    });

    // Üye sayısını güncelle
    await Subreddit.findByIdAndUpdate(subredditId, { $inc: { memberCount: 1 } });
  }

  // Eski sahibin üyeliğini moderatöre düşür
  requesterMembership.type = 'moderator';
  requesterMembership.updatedAt = Date.now();
  requesterMembership.permissions = ['all']; // Tüm izinleri ver
  await requesterMembership.save();

  // Yeni sahibin üyeliğini admin yap
  newOwnerMembership.type = 'admin';
  newOwnerMembership.status = 'active';
  newOwnerMembership.updatedAt = Date.now();
  await newOwnerMembership.save();

  // Subreddit'i güncelle
  subreddit.owner = userId;
  subreddit.updatedAt = Date.now();
  await subreddit.save();

  // Moderatör logunu kaydet
  await ModLog.create({
    subreddit: subredditId,
    action: 'ownership_transferred',
    moderator: req.user._id,
    target: userId,
    details: `Topluluk sahipliği ${req.user.username} kullanıcısından ${newOwner.username} kullanıcısına transfer edildi`,
    timestamp: Date.now(),
  });

  // Admin logunu kaydet (site genelinde)
  await AdminLog.create({
    user: req.user._id,
    action: 'subreddit_ownership_transferred',
    details: `r/${subreddit.name} topluluğunun sahipliği ${newOwner.username} kullanıcısına transfer edildi`,
    ip: req.ip,
  });

  // Eski ve yeni sahibe bildirim gönder
  await Notification.create({
    recipient: userId,
    type: 'ownership_received',
    message: `r/${subreddit.name} topluluğunun sahipliği size transfer edildi`,
    reference: {
      type: 'Subreddit',
      id: subredditId,
    },
    isRead: false,
  });

  await Notification.create({
    recipient: req.user._id,
    type: 'ownership_transferred',
    message: `r/${subreddit.name} topluluğunun sahipliğini ${newOwner.username} kullanıcısına transfer ettiniz`,
    reference: {
      type: 'Subreddit',
      id: subredditId,
    },
    isRead: false,
  });

  res.status(200).json({
    success: true,
    message: `Topluluk sahipliği başarıyla ${newOwner.username} kullanıcısına transfer edildi`,
    data: {
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
        owner: userId,
      },
      newOwner: {
        id: newOwner._id,
        username: newOwner.username,
      },
    },
  });
});

/**
 * @desc    Topluluktaki yasaklı kullanıcıları listele
 * @route   GET /api/subreddits/:subredditId/bans
 * @access  Moderatör
 */
const getBannedUsers = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const modMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modMembership) {
    return next(new ErrorResponse('Bu işlem için yetkiniz yok', 403));
  }

  // Sayfalama için parametreleri al
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Filtreleme ve sıralama parametrelerini al
  const { search, sortBy, order } = req.query;

  // Sorgu parametrelerini oluştur
  const query = {
    subreddit: subredditId,
    status: 'banned',
  };

  // Arama sorgusu
  if (search) {
    const users = await User.find({
      $or: [
        { username: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
      ],
    }).select('_id');

    query.user = { $in: users.map((u) => u._id) };
  }

  if (sortBy === 'username') {
    // Kullanıcı adına göre sıralama için özel işlem yapılması gerekir
    // Bu durumda mongodb'nin $lookup özelliğini kullanabiliriz
    // Ama şimdilik bannedAt tarihine göre sıralayalım
    sortOptions.bannedAt = order === 'asc' ? 1 : -1;
  } else if (sortBy === 'bannedAt') {
    sortOptions.bannedAt = order === 'asc' ? 1 : -1;
  } else {
    // Varsayılan sıralama
    sortOptions.bannedAt = -1;
  }

  // Toplam yasaklı kullanıcı sayısını al
  const total = await SubredditMembership.countDocuments(query);

  // Yasaklı kullanıcıları getir ve kullanıcı bilgilerini popüle et
  const memberships = await SubredditMembership.find(query)
    .sort(sortOptions)
    .skip(startIndex)
    .limit(limit)
    .populate('user', 'username displayName avatar')
    .populate('bannedBy', 'username');

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
    count: memberships.length,
    total,
    pagination,
    data: {
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
      bannedUsers: memberships,
    },
  });
});

/**
 * @desc    Topluluktaki moderatörleri listele
 * @route   GET /api/subreddits/:subredditId/moderators
 * @access  Herkese Açık
 */
const getModerators = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Moderatörleri getir
  const moderators = await SubredditMembership.find({
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  })
    .sort({ type: -1, joinedAt: 1 }) // Önce admin, sonra moderatörler, kıdem sırasına göre
    .populate('user', 'username displayName avatar createdAt lastActive');

  res.status(200).json({
    success: true,
    count: moderators.length,
    data: {
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
      moderators: moderators.map((mod) => ({
        id: mod._id,
        user: mod.user,
        type: mod.type,
        permissions: mod.permissions,
        joinedAt: mod.joinedAt,
        isSelf: req.user && mod.user._id.toString() === req.user._id.toString(),
      })),
    },
  });
});

/**
 * @desc    Kullanıcının moderatörlük yaptığı toplulukları getir
 * @route   GET /api/users/:userId/moderating
 * @access  Üye (kendi profili) / Admin (tüm profiller)
 */
const getUserModeratedSubreddits = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz Kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Yetki kontrolü (sadece kendi profilini veya admin görüntüleyebilir)
  if (userId !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için yetkiniz yok', 403));
  }

  // Kullanıcının moderatörlük yaptığı toplulukları getir
  const memberships = await SubredditMembership.find({
    user: userId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  })
    .sort({ type: -1, joinedAt: 1 }) // Önce admin, sonra moderatörler, kıdem sırasına göre
    .populate('subreddit', 'name title description type memberCount createdAt icon banner');

  res.status(200).json({
    success: true,
    count: memberships.length,
    data: memberships.map((membership) => ({
      id: membership._id,
      subreddit: membership.subreddit,
      type: membership.type,
      permissions: membership.permissions,
      joinedAt: membership.joinedAt,
    })),
  });
});

/**
 * @desc    Üyelik durumunu onayla (toplu işlem)
 * @route   PUT /api/subreddits/:subredditId/memberships/batch-approve
 * @access  Moderatör
 */
const batchApproveMemberships = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { membershipIds } = req.body;

  // Parametreleri doğrula
  if (!membershipIds || !Array.isArray(membershipIds) || membershipIds.length === 0) {
    return next(new ErrorResponse("En az bir üyelik ID'si gereklidir", 400));
  }

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const modMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modMembership) {
    return next(new ErrorResponse('Bu işlem için yetkiniz yok', 403));
  }

  // ID'lerin geçerli olup olmadığını kontrol et
  const validIds = membershipIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

  if (validIds.length === 0) {
    return next(new ErrorResponse("Geçerli üyelik ID'si bulunamadı", 400));
  }

  // Bekleyen üyelikleri bul
  const pendingMemberships = await SubredditMembership.find({
    _id: { $in: validIds },
    subreddit: subredditId,
    status: 'pending',
  }).populate('user', 'username');

  if (pendingMemberships.length === 0) {
    return next(new ErrorResponse('Onaylanacak bekleyen üyelik bulunamadı', 404));
  }

  // Üyelikleri onayla
  const updates = pendingMemberships.map((membership) => ({
    updateOne: {
      filter: { _id: membership._id },
      update: {
        $set: {
          status: 'active',
          approvedBy: req.user._id,
          approvedAt: Date.now(),
        },
      },
    },
  }));

  await SubredditMembership.bulkWrite(updates);

  // Üye sayısını güncelle
  await Subreddit.findByIdAndUpdate(subredditId, {
    $inc: { memberCount: pendingMemberships.length },
  });

  // Moderatör logunu kaydet
  const modLogEntries = pendingMemberships.map((membership) => ({
    subreddit: subredditId,
    action: 'membership_approved',
    moderator: req.user._id,
    target: membership.user._id,
    details: `${membership.user.username} kullanıcısının üyelik isteği onaylandı`,
    timestamp: Date.now(),
  }));

  await ModLog.insertMany(modLogEntries);

  // Kullanıcılara bildirim gönder
  const notifications = pendingMemberships.map((membership) => ({
    recipient: membership.user._id,
    type: 'membership_approved',
    message: `r/${subreddit.name} topluluğuna üyelik isteğiniz onaylandı`,
    reference: {
      type: 'Subreddit',
      id: subredditId,
    },
    isRead: false,
  }));

  await Notification.insertMany(notifications);

  res.status(200).json({
    success: true,
    message: `${pendingMemberships.length} üyelik isteği onaylandı`,
    data: {
      approvedCount: pendingMemberships.length,
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
    },
  });
});

/**
 * @desc    Topluluğa moderatör davet et
 * @route   POST /api/subreddits/:subredditId/moderator-invites
 * @access  Moderatör
 */
const inviteModerator = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { username, permissions, message } = req.body;

  // Parametreleri doğrula
  if (!username) {
    return next(new ErrorResponse('Kullanıcı adı zorunludur', 400));
  }

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör olup olmadığını kontrol et
  const modMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modMembership) {
    return next(new ErrorResponse('Bu işlem için yetkiniz yok', 403));
  }

  // Kullanıcıyı bul
  const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kullanıcının zaten moderatör olup olmadığını kontrol et
  const existingMembership = await SubredditMembership.findOne({
    user: user._id,
    subreddit: subredditId,
  });

  if (
    existingMembership &&
    (existingMembership.type === 'moderator' || existingMembership.type === 'admin')
  ) {
    return next(new ErrorResponse('Bu kullanıcı zaten moderatör veya topluluk sahibi', 400));
  }

  // Kullanıcının yasaklı olup olmadığını kontrol et
  if (existingMembership && existingMembership.status === 'banned') {
    return next(
      new ErrorResponse('Yasaklı bir kullanıcıyı moderatör olarak davet edemezsiniz', 400),
    );
  }

  // Moderatör izinlerini kontrol et
  const validPermissions = [
    'all',
    'manage_settings',
    'manage_flair',
    'manage_posts',
    'manage_comments',
    'manage_users',
    'manage_automod',
    'view_traffic',
    'mail',
    'access',
    'wiki',
  ];

  const modPermissions =
    permissions && Array.isArray(permissions)
      ? permissions.filter((p) => validPermissions.includes(p))
      : ['access', 'posts', 'mail']; // Varsayılan izinler

  // Moderatör davetini oluştur
  await ModeratorInvite.create({
    subreddit: subredditId,
    user: user._id,
    invitedBy: req.user._id,
    permissions: modPermissions,
    message: message || '',
    createdAt: Date.now(),
    status: 'pending',
  });

  // Moderatör logunu kaydet
  await ModLog.create({
    subreddit: subredditId,
    action: 'moderator_invited',
    moderator: req.user._id,
    target: user._id,
    details: `${user.username} kullanıcısı moderatör olarak davet edildi`,
    data: {
      permissions: modPermissions,
    },
    timestamp: Date.now(),
  });

  // Kullanıcıya bildirim gönder
  await Notification.create({
    recipient: user._id,
    type: 'moderator_invite',
    message: `r/${subreddit.name} topluluğuna moderatör olarak davet edildiniz`,
    reference: {
      type: 'Subreddit',
      id: subredditId,
    },
    isRead: false,
  });

  res.status(200).json({
    success: true,
    message: `${user.username} kullanıcısı moderatör olarak davet edildi`,
    data: {
      userId: user._id,
      username: user.username,
      subreddit: {
        id: subreddit._id,
        name: subreddit.name,
      },
      permissions: modPermissions,
    },
  });
});

/**
 * @desc    Moderatör davetini kabul et veya reddet
 * @route   PUT /api/subreddits/:subredditId/moderator-invites/:inviteId
 * @access  Davet edilen kullanıcı
 */
const respondToModeratorInvite = asyncHandler(async (req, res, next) => {
  const { subredditId, inviteId } = req.params;
  const { action } = req.body;

  // Parametreleri doğrula
  if (!action || !['accept', 'decline'].includes(action)) {
    return next(new ErrorResponse('Geçersiz işlem. "accept" veya "decline" olmalıdır', 400));
  }

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(subredditId) || !mongoose.Types.ObjectId.isValid(inviteId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Daveti bul
  const invite = await ModeratorInvite.findOne({
    _id: inviteId,
    subreddit: subredditId,
    user: req.user._id,
    status: 'pending',
  });

  if (!invite) {
    return next(new ErrorResponse('Geçerli bir moderatör daveti bulunamadı', 404));
  }

  if (action === 'accept') {
    // Kullanıcının mevcut üyeliğini kontrol et
    let membership = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
    });

    if (membership) {
      // Mevcut üyeliği güncelle
      membership.type = 'moderator';
      membership.status = 'active';
      membership.permissions = invite.permissions;
      membership.updatedAt = Date.now();
      await membership.save();
    } else {
      // Yeni moderatör üyeliği oluştur
      membership = await SubredditMembership.create({
        user: req.user._id,
        subreddit: subredditId,
        type: 'moderator',
        status: 'active',
        permissions: invite.permissions,
        joinedAt: Date.now(),
      });

      // Üye sayısını güncelle
      await Subreddit.findByIdAndUpdate(subredditId, { $inc: { memberCount: 1 } });
    }

    // Daveti güncelle
    invite.status = 'accepted';
    invite.respondedAt = Date.now();
    await invite.save();

    // Moderatör logunu kaydet
    await ModLog.create({
      subreddit: subredditId,
      action: 'moderator_invite_accepted',
      moderator: invite.invitedBy,
      target: req.user._id,
      details: `${req.user.username} kullanıcısı moderatör davetini kabul etti`,
      timestamp: Date.now(),
    });

    // Davet eden kişiye bildirim gönder
    await Notification.create({
      recipient: invite.invitedBy,
      type: 'moderator_invite_accepted',
      message: `${req.user.username}, r/${subreddit.name} topluluğu için moderatör davetinizi kabul etti`,
      reference: {
        type: 'Subreddit',
        id: subredditId,
      },
      isRead: false,
    });

    res.status(200).json({
      success: true,
      message: `r/${subreddit.name} topluluğu için moderatör davetini kabul ettiniz`,
      data: {
        membership,
        subreddit: {
          id: subreddit._id,
          name: subreddit.name,
        },
      },
    });
  } else {
    // Daveti reddet
    invite.status = 'declined';
    invite.respondedAt = Date.now();
    await invite.save();

    // Moderatör logunu kaydet
    await ModLog.create({
      subreddit: subredditId,
      action: 'moderator_invite_declined',
      moderator: invite.invitedBy,
      target: req.user._id,
      details: `${req.user.username} kullanıcısı moderatör davetini reddetti`,
      timestamp: Date.now(),
    });

    // Davet eden kişiye bildirim gönder
    await Notification.create({
      recipient: invite.invitedBy,
      type: 'moderator_invite_declined',
      message: `${req.user.username}, r/${subreddit.name} topluluğu için moderatör davetinizi reddetti`,
      reference: {
        type: 'Subreddit',
        id: subredditId,
      },
      isRead: false,
    });

    res.status(200).json({
      success: true,
      message: `r/${subreddit.name} topluluğu için moderatör davetini reddettiniz`,
      data: {
        inviteId: invite._id,
        subreddit: {
          id: subreddit._id,
          name: subreddit.name,
        },
      },
    });
  }
});

module.exports = {
  joinSubreddit,
  leaveSubreddit,
  updateMembership,
  getMembershipDetails,
  getUserMemberships,
  getSubredditMembers,
  updateMembershipRequest,
  banUser,
  unbanUser,
  addModerator,
  removeModerator,
  updateModeratorPermissions,
  transferOwnership,
  getBannedUsers,
  getModerators,
  getUserModeratedSubreddits,
  batchApproveMemberships,
  inviteModerator,
  respondToModeratorInvite,
};
