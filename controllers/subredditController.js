const Subreddit = require('../models/Subreddit');
const Post = require('../models/Post');
const User = require('../models/User');
const SubredditMembership = require('../models/SubredditMembership');
const SubredditRule = require('../models/SubredditRule');
const SubredditSettings = require('../models/SubredditSettings');
const ModLog = require('../models/ModLog');
const AdminLog = require('../models/AdminLog');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const { uploadToCloudinary, removeFromCloudinary } = require('../utils/cloudinary');
const slugify = require('slugify');

/**
 * @desc    Tüm subredditleri getir
 * @route   GET /api/subreddits
 * @access  Public
 */
const getSubreddits = asyncHandler(async (req, res, next) => {
  // Filtreleme seçenekleri
  const {
    type,
    nsfw,
    sort = 'memberCount',
    search,
    createdAfter,
    createdBefore,
    minMembers,
    category,
  } = req.query;

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Filtreleme sorgusu oluştur
  let query = {};

  // Tür filtresi
  if (type && ['public', 'restricted', 'private'].includes(type)) {
    query.type = type;
  }

  // NSFW filtresi
  if (nsfw !== undefined) {
    query.nsfw = nsfw === 'true';
  } else if (!req.user || !req.user.showNsfw) {
    // Kullanıcı ayarları veya oturum açmamış kullanıcılar için varsayılan olarak NSFW içerikleri filtrele
    query.nsfw = false;
  }

  // Arama filtresi
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  // Oluşturulma tarihi filtresi
  if (createdAfter || createdBefore) {
    query.createdAt = {};
    if (createdAfter) {
      query.createdAt.$gte = new Date(createdAfter);
    }
    if (createdBefore) {
      query.createdAt.$lte = new Date(createdBefore);
    }
  }

  // Minimum üye sayısı filtresi
  if (minMembers) {
    query.memberCount = { $gte: parseInt(minMembers, 10) };
  }

  // Kategori filtresi (eğer uygulamada kategori sistemi varsa)
  if (category) {
    // Örnek: kategori yapısına göre filtreleme
    // query.category = category;
  }

  // Sıralama seçenekleri
  let sortOption = {};
  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'old':
      sortOption = { createdAt: 1 };
      break;
    case 'name':
      sortOption = { name: 1 };
      break;
    case 'memberCount':
    default:
      sortOption = { memberCount: -1 };
      break;
  }

  // Toplam subreddit sayısını al
  const total = await Subreddit.countDocuments(query);

  // Subredditleri getir
  const subreddits = await Subreddit.find(query)
    .sort(sortOption)
    .skip(startIndex)
    .limit(limit)
    .select('name title description icon banner memberCount type nsfw createdAt');

  // Sayfalama bilgileri
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalResults: total,
  };

  // Sonraki ve önceki sayfa bilgilerini ekle
  if (startIndex + limit < total) {
    pagination.nextPage = page + 1;
  }

  if (startIndex > 0) {
    pagination.prevPage = page - 1;
  }

  res.status(200).json({
    success: true,
    count: subreddits.length,
    pagination,
    data: subreddits,
  });
});

/**
 * @desc    Tek bir subreddit getir
 * @route   GET /api/subreddits/:id
 * @access  Public
 */
const getSubreddit = asyncHandler(async (req, res, next) => {
  // ID veya slug ile arama yapabilmek için
  let query = {};

  if (mongoose.Types.ObjectId.isValid(req.params.id)) {
    query._id = req.params.id;
  } else {
    // Slug ile ara
    query.slug = req.params.id;
  }

  const subreddit = await Subreddit.findOne(query)
    .populate('creator', 'username profilePicture')
    .populate('rules')
    .populate('settings');

  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcı için üyelik durumunu kontrol et
  let membershipStatus = null;

  if (req.user) {
    const membership = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subreddit._id,
    });

    if (membership) {
      membershipStatus = {
        status: membership.status,
        type: membership.type,
        joinedAt: membership.joinedAt,
      };
    }
  }

  // Özel subreddit kontrolü
  if (subreddit.type === 'private') {
    // Kullanıcı giriş yapmamış veya üye değilse içeriği kısıtla
    if (!req.user || (membershipStatus?.status !== 'active' && req.user.role !== 'admin')) {
      // Sadece temel bilgileri gönder
      return res.status(200).json({
        success: true,
        data: {
          _id: subreddit._id,
          name: subreddit.name,
          title: subreddit.title,
          type: subreddit.type,
          memberCount: subreddit.memberCount,
          icon: subreddit.icon,
          banner: subreddit.banner,
          isPrivate: true,
          creator: subreddit.creator,
        },
        membershipStatus,
      });
    }
  }

  // Post sayısını getir
  const postCount = await Post.countDocuments({
    subreddit: subreddit._id,
    isDeleted: false,
  });

  // Moderatör listesini getir
  const moderators = await SubredditMembership.find({
    subreddit: subreddit._id,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  })
    .populate('user', 'username profilePicture')
    .select('user type joinedAt permissions');

  // Yanıta detaylı bilgileri ekle
  res.status(200).json({
    success: true,
    data: {
      ...subreddit.toObject(),
      postCount,
      moderators,
    },
    membershipStatus,
  });
});

/**
 * @desc    Yeni bir subreddit oluştur
 * @route   POST /api/subreddits
 * @access  Private
 */
const createSubreddit = asyncHandler(async (req, res, next) => {
  const { name, title, description, type, nsfw } = req.body;

  // İsim kontrolü
  if (!name || name.trim().length < 3) {
    return next(new ErrorResponse('Subreddit adı en az 3 karakter olmalıdır', 400));
  }

  // İsim formatı kontrolü
  const nameRegex = /^[a-zA-Z0-9_]+$/;
  if (!nameRegex.test(name)) {
    return next(new ErrorResponse('Subreddit adı sadece harf, rakam ve alt çizgi içerebilir', 400));
  }

  // Başka bir isim kontrolü (20 karakter max)
  if (name.length > 21) {
    return next(new ErrorResponse('Subreddit adı 21 karakterden uzun olamaz', 400));
  }

  // Başlık kontrolü
  if (!title) {
    return next(new ErrorResponse('Subreddit başlığı gereklidir', 400));
  }

  // İsim benzersizliği kontrolü
  const existingSubreddit = await Subreddit.findOne({
    name: { $regex: new RegExp(`^${name}$`, 'i') },
  });

  if (existingSubreddit) {
    return next(new ErrorResponse('Bu isimde bir subreddit zaten var', 400));
  }

  // Yasaklı isimleri kontrol et
  const reservedNames = ['admin', 'settings', 'mod', 'moderator', 'popular', 'all', 'home'];
  if (reservedNames.includes(name.toLowerCase())) {
    return next(new ErrorResponse('Bu isim kullanılamaz', 400));
  }

  // Resim yükleme (eğer varsa)
  let iconUrl = 'default-subreddit-icon.png';
  let bannerUrl = 'default-subreddit-banner.png';

  if (req.files && req.files.icon) {
    const result = await uploadToCloudinary(req.files.icon.tempFilePath, {
      folder: 'subreddit_icons',
      width: 256,
      height: 256,
      crop: 'fill',
    });
    iconUrl = result.secure_url;
  }

  if (req.files && req.files.banner) {
    const result = await uploadToCloudinary(req.files.banner.tempFilePath, {
      folder: 'subreddit_banners',
      width: 1920,
      height: 384,
      crop: 'fill',
    });
    bannerUrl = result.secure_url;
  }

  // Subreddit oluştur
  const subreddit = await Subreddit.create({
    name,
    title,
    description,
    type: type || 'public',
    nsfw: nsfw === 'true',
    icon: iconUrl,
    banner: bannerUrl,
    creator: req.user._id,
    memberCount: 1, // Oluşturan kişi otomatik olarak üye olur
    slug: slugify(name, { lower: true }),
  });

  // Kurucuyu moderatör olarak ekle
  await SubredditMembership.create({
    user: req.user._id,
    subreddit: subreddit._id,
    type: 'admin', // Kurucu admin olarak eklenir
    status: 'active',
    joinedAt: Date.now(),
  });

  // Varsayılan kuralları oluştur
  await SubredditRule.create({
    subreddit: subreddit._id,
    title: 'Saygılı Olun',
    description: 'Diğer kullanıcılara saygılı davranın, zorbalık ve taciz yasaktır.',
    position: 1,
    createdBy: req.user._id,
  });

  // Varsayılan ayarları oluştur
  await SubredditSettings.create({
    subreddit: subreddit._id,
    postTypes: ['text', 'link', 'image', 'video', 'poll'],
    allowPolls: true,
    allowImages: true,
    allowVideos: true,
    allowLinks: true,
    showInAll: true,
    allowCrosspost: true,
  });

  // Log kaydı oluştur
  await AdminLog.create({
    user: req.user._id,
    action: 'create_subreddit',
    details: `Subreddit oluşturuldu: r/${name}`,
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    data: subreddit,
  });
});

/**
 * @desc    Bir subreddit güncelle
 * @route   PUT /api/subreddits/:id
 * @access  Private (Admin veya Moderatör)
 */
const updateSubreddit = asyncHandler(async (req, res, next) => {
  // Güncellenebilir alanlar
  const { title, description, sidebar, type, nsfw } = req.body;

  let subreddit = await Subreddit.findById(req.params.id);

  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü - Admin veya moderatör olmalı
  const isModerator = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subreddit._id,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu subredditi düzenleme yetkiniz yok', 403));
  }

  // Güncellenecek alanları hazırla
  const updateData = {};

  if (title) updateData.title = title;
  if (description !== undefined) updateData.description = description;
  if (sidebar !== undefined) updateData.sidebar = sidebar;
  if (type && ['public', 'restricted', 'private'].includes(type)) updateData.type = type;
  if (nsfw !== undefined) updateData.nsfw = nsfw === 'true';

  // Resim güncelleme işlemleri
  if (req.files) {
    // İkon güncelleme
    if (req.files.icon) {
      // Eski ikonu cloudinary'den sil (varsayılan değilse)
      if (subreddit.icon && !subreddit.icon.includes('default-subreddit-icon')) {
        await removeFromCloudinary(subreddit.icon);
      }

      // Yeni ikonu yükle
      const result = await uploadToCloudinary(req.files.icon.tempFilePath, {
        folder: 'subreddit_icons',
        width: 256,
        height: 256,
        crop: 'fill',
      });
      updateData.icon = result.secure_url;
    }

    // Banner güncelleme
    if (req.files.banner) {
      // Eski banneri cloudinary'den sil (varsayılan değilse)
      if (subreddit.banner && !subreddit.banner.includes('default-subreddit-banner')) {
        await removeFromCloudinary(subreddit.banner);
      }

      // Yeni banneri yükle
      const result = await uploadToCloudinary(req.files.banner.tempFilePath, {
        folder: 'subreddit_banners',
        width: 1920,
        height: 384,
        crop: 'fill',
      });
      updateData.banner = result.secure_url;
    }
  }

  // Güncelleme zamanını ayarla
  updateData.updatedAt = Date.now();

  // Subredditi güncelle
  subreddit = await Subreddit.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });

  // Moderasyon logu oluştur
  await ModLog.create({
    user: req.user._id,
    subreddit: subreddit._id,
    action: 'update_settings',
    details: `Subreddit ayarları güncellendi: ${Object.keys(updateData).join(', ')}`,
  });

  res.status(200).json({
    success: true,
    data: subreddit,
  });
});

/**
 * @desc    Bir subredditi sil
 * @route   DELETE /api/subreddits/:id
 * @access  Private (Admin veya Subreddit kurucusu)
 */
const deleteSubreddit = asyncHandler(async (req, res, next) => {
  const subreddit = await Subreddit.findById(req.params.id);

  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü - Admin veya kurucu olmalı
  const isCreator = subreddit.creator.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';

  if (!isCreator && !isAdmin) {
    return next(new ErrorResponse('Bu subredditi silme yetkiniz yok', 403));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Subredditi soft delete yap
    subreddit.isDeleted = true;
    subreddit.deletedAt = Date.now();
    await subreddit.save({ session });

    // Admin log kaydı oluştur
    await AdminLog.create(
      [
        {
          user: req.user._id,
          action: 'delete_subreddit',
          details: `Subreddit silindi: r/${subreddit.name}`,
          ip: req.ip,
        },
      ],
      { session },
    );

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {},
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Subreddit silinirken bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Bir subreddite katıl
 * @route   POST /api/subreddits/:id/join
 * @access  Private
 */
const joinSubreddit = asyncHandler(async (req, res, next) => {
  const subredditId = req.params.id;
  const userId = req.user._id;

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

  // Yanıt döndür
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
      membershipStatus: subreddit.type === 'private' ? 'pending' : 'active',
    },
  });
});

/**
 * @desc    Bir subredditten ayrıl
 * @route   DELETE /api/subreddits/:id/leave
 * @access  Private
 */
const leaveSubreddit = asyncHandler(async (req, res, next) => {
  const subredditId = req.params.id;
  const userId = req.user._id;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Üyelik durumunu kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
  });

  if (!membership || membership.status !== 'active') {
    return next(new ErrorResponse('Bu topluluğa üye değilsiniz', 400));
  }

  // Topluluk kurucusu çıkamaz
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
 * @desc    Popüler/trend subredditleri getir
 * @route   GET /api/subreddits/trending
 * @access  Public
 */
const getTrendingSubreddits = asyncHandler(async (req, res, next) => {
  const timeRange = req.query.timeRange || 'week';
  const limit = parseInt(req.query.limit, 10) || 5;

  // Zaman filtresini belirle
  let dateFilter = {};
  const now = new Date();

  switch (timeRange) {
    case 'day':
      dateFilter = { createdAt: { $gte: new Date(now.setDate(now.getDate() - 1)) } };
      break;
    case 'week':
      dateFilter = { createdAt: { $gte: new Date(now.setDate(now.getDate() - 7)) } };
      break;
    case 'month':
      dateFilter = { createdAt: { $gte: new Date(now.setMonth(now.getMonth() - 1)) } };
      break;
    default:
      dateFilter = { createdAt: { $gte: new Date(now.setDate(now.getDate() - 7)) } };
  }

  // Trend subredditleri hesapla
  // Bu örnekte, son zamandaki popüler postların olduğu subredditler trend olarak kabul edilir
  const trendingSubreddits = await Post.aggregate([
    { $match: { isDeleted: false, ...dateFilter } },
    {
      $group: {
        _id: '$subreddit',
        postCount: { $sum: 1 },
        totalVotes: { $sum: '$voteScore' },
        totalComments: { $sum: '$commentCount' },
      },
    },
    // Trendi hesapla: post + yorum + oy sayısı ile ağırlıklı skor
    {
      $addFields: {
        trendScore: {
          $add: [
            '$postCount',
            { $multiply: ['$totalComments', 0.5] },
            { $multiply: ['$totalVotes', 0.3] },
          ],
        },
      },
    },
    { $sort: { trendScore: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'subreddits',
        localField: '_id',
        foreignField: '_id',
        as: 'subredditDetails',
      },
    },
    { $unwind: '$subredditDetails' },
    {
      $project: {
        _id: 1,
        name: '$subredditDetails.name',
        title: '$subredditDetails.title',
        description: '$subredditDetails.description',
        icon: '$subredditDetails.icon',
        memberCount: '$subredditDetails.memberCount',
        postCount: 1,
        totalVotes: 1,
        totalComments: 1,
        trendScore: 1,
      },
    },
  ]);

  res.status(200).json({
    success: true,
    timeRange,
    count: trendingSubreddits.length,
    data: trendingSubreddits,
  });
});

/**
 * @desc    Kullanıcının üye olduğu subredditleri getir
 * @route   GET /api/subreddits/my
 * @access  Private
 */
const getUserSubreddits = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Kullanıcının üyeliklerini bul
  const memberships = await SubredditMembership.find({
    user: userId,
    status: 'active',
  })
    .populate({
      path: 'subreddit',
      select: 'name title icon memberCount type nsfw',
    })
    .sort({ joinedAt: -1 });

  // Üyelikleri kategorize et
  const moderating = [];
  const joined = [];

  memberships.forEach((membership) => {
    if (!membership.subreddit) return; // Silinmiş subredditler için kontrol

    const subredditData = {
      _id: membership.subreddit._id,
      name: membership.subreddit.name,
      title: membership.subreddit.title,
      icon: membership.subreddit.icon,
      memberCount: membership.subreddit.memberCount,
      type: membership.subreddit.type,
      nsfw: membership.subreddit.nsfw,
      joinedAt: membership.joinedAt,
      membershipType: membership.type,
    };

    if (membership.type === 'moderator' || membership.type === 'admin') {
      moderating.push(subredditData);
    } else {
      joined.push(subredditData);
    }
  });

  res.status(200).json({
    success: true,
    count: memberships.length,
    data: {
      moderating,
      joined,
    },
  });
});

/**
 * @desc    Bir kullanıcıyı yasakla veya yasağını kaldır
 * @route   PUT /api/subreddits/:id/ban/:userId
 * @access  Private (Moderatör/Admin)
 */
const banUser = asyncHandler(async (req, res, next) => {
  const { id, userId } = req.params;
  const { reason, duration, isBan = true } = req.body;

  // Subreddit'in var olup olmadığını kontrol et
  const subreddit = await Subreddit.findById(id);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü
  const modMembership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: id,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modMembership && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Subreddit kurucusunu banlama kontrolü
  if (subreddit.creator.toString() === userId) {
    return next(new ErrorResponse('Subreddit kurucusu banlanamaz', 400));
  }

  // Başka bir moderatörü banlama kontrolü
  if (isBan) {
    const targetModStatus = await SubredditMembership.findOne({
      user: userId,
      subreddit: id,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (targetModStatus && modMembership.type !== 'admin') {
      return next(new ErrorResponse('Diğer moderatörleri sadece admin banlanabilir', 403));
    }
  }

  // Kullanıcının membership durumunu bul veya oluştur
  let membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: id,
  });

  if (isBan) {
    // Banlama işlemi
    if (!membership) {
      // Kullanıcı toplulukta üye değilse yeni bir membership oluştur
      membership = await SubredditMembership.create({
        user: userId,
        subreddit: id,
        type: 'banned',
        status: 'banned',
        banReason: reason || 'Moderatör kararıyla',
        banExpiration: duration ? new Date(Date.now() + duration * 86400000) : null, // duration gün cinsinden
        bannedBy: req.user._id,
        bannedAt: Date.now(),
      });
    } else {
      // Mevcut membership'i güncelle
      membership.type = 'banned';
      membership.status = 'banned';
      membership.banReason = reason || 'Moderatör kararıyla';
      membership.banExpiration = duration ? new Date(Date.now() + duration * 86400000) : null;
      membership.bannedBy = req.user._id;
      membership.bannedAt = Date.now();

      await membership.save();

      // Eğer aktif bir üye banlandıysa, üye sayısını azalt
      if (membership.status === 'active') {
        subreddit.memberCount = Math.max(0, subreddit.memberCount - 1);
        await subreddit.save();
      }
    }

    // Moderasyon logu oluştur
    await ModLog.create({
      user: req.user._id,
      subreddit: id,
      action: 'ban_user',
      targetType: 'user',
      targetId: userId,
      details: `Kullanıcı banlandı: ${user.username}, Sebep: ${reason || 'Belirtilmedi'}, Süre: ${duration ? `${duration} gün` : 'Süresiz'}`,
    });

    res.status(200).json({
      success: true,
      message: `${user.username} adlı kullanıcı başarıyla banlandı`,
      data: membership,
    });
  } else {
    // Ban kaldırma işlemi
    if (!membership || membership.status !== 'banned') {
      return next(new ErrorResponse('Bu kullanıcı zaten banlanmamış', 400));
    }

    // Banı kaldır ve kullanıcıyı normal üye yap
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
      subreddit: id,
      action: 'unban_user',
      targetType: 'user',
      targetId: userId,
      details: `Kullanıcının banı kaldırıldı: ${user.username}`,
    });

    res.status(200).json({
      success: true,
      message: `${user.username} adlı kullanıcının banı başarıyla kaldırıldı`,
      data: membership,
    });
  }
});

/**
 * @desc    Moderatör ekle veya çıkar
 * @route   PUT /api/subreddits/:id/moderator/:userId
 * @access  Private (Admin)
 */
const manageModerator = asyncHandler(async (req, res, next) => {
  const { id, userId } = req.params;
  const { action, permissions } = req.body;

  if (!['add', 'remove', 'update'].includes(action)) {
    return next(new ErrorResponse('Geçersiz işlem', 400));
  }

  // Subreddit'in var olup olmadığını kontrol et
  const subreddit = await Subreddit.findById(id);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü - Sadece subreddit admin'i veya site admin'i
  const isSubredditAdmin = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: id,
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

  // Moderatör ekle
  if (action === 'add') {
    // Kullanıcının durumunu kontrol et
    let membership = await SubredditMembership.findOne({
      user: userId,
      subreddit: id,
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
      membership.permissions = permissions || ['posts', 'comments', 'users', 'settings'];
      await membership.save();
    } else {
      // Yeni moderatör ekle
      membership = await SubredditMembership.create({
        user: userId,
        subreddit: id,
        type: 'moderator',
        status: 'active',
        joinedAt: Date.now(),
        permissions: permissions || ['posts', 'comments', 'users', 'settings'],
      });

      // Üye sayısını güncelle
      subreddit.memberCount += 1;
      await subreddit.save();
    }

    // Moderasyon logu oluştur
    await ModLog.create({
      user: req.user._id,
      subreddit: id,
      action: 'add_moderator',
      targetType: 'user',
      targetId: userId,
      details: `Yeni moderatör eklendi: ${user.username}`,
    });

    res.status(200).json({
      success: true,
      message: `${user.username} moderatör olarak eklendi`,
      data: membership,
    });
  }
  // Moderatör çıkar
  else if (action === 'remove') {
    // Kullanıcının moderatör olup olmadığını kontrol et
    const membership = await SubredditMembership.findOne({
      user: userId,
      subreddit: id,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!membership) {
      return next(new ErrorResponse('Bu kullanıcı moderatör değil', 400));
    }

    // Subreddit kurucusunu çıkarma kontrolü
    if (subreddit.creator.toString() === userId) {
      return next(new ErrorResponse('Subreddit kurucusu moderatörlükten çıkarılamaz', 400));
    }

    // Moderatör yetkisini normal üyeliğe düşür
    membership.type = 'member';
    membership.permissions = [];
    await membership.save();

    // Moderasyon logu oluştur
    await ModLog.create({
      user: req.user._id,
      subreddit: id,
      action: 'remove_moderator',
      targetType: 'user',
      targetId: userId,
      details: `Moderatör çıkarıldı: ${user.username}`,
    });

    res.status(200).json({
      success: true,
      message: `${user.username} moderatörlükten çıkarıldı`,
      data: membership,
    });
  }
  // Moderatör izinlerini güncelle
  else if (action === 'update') {
    // Kullanıcının moderatör olup olmadığını kontrol et
    const membership = await SubredditMembership.findOne({
      user: userId,
      subreddit: id,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!membership) {
      return next(new ErrorResponse('Bu kullanıcı moderatör değil', 400));
    }

    // İzinleri güncelle
    if (permissions && Array.isArray(permissions)) {
      membership.permissions = permissions;
      await membership.save();
    }

    // Moderasyon logu oluştur
    await ModLog.create({
      user: req.user._id,
      subreddit: id,
      action: 'update_moderator',
      targetType: 'user',
      targetId: userId,
      details: `Moderatör izinleri güncellendi: ${user.username}`,
    });

    res.status(200).json({
      success: true,
      message: `${user.username} moderatör izinleri güncellendi`,
      data: membership,
    });
  }
});

/**
 * @desc    Subreddit kurallarını getir
 * @route   GET /api/subreddits/:id/rules
 * @access  Public
 */
const getSubredditRules = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Subreddit'in var olup olmadığını kontrol et
  const subreddit = await Subreddit.findById(id);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Subreddit kurallarını getir
  const rules = await SubredditRule.find({
    subreddit: id,
    isDeleted: false,
  })
    .sort({ position: 1 })
    .select('title description position isReportable');

  res.status(200).json({
    success: true,
    count: rules.length,
    data: rules,
  });
});

/**
 * @desc    Topluluk istatistiklerini getir
 * @route   GET /api/subreddits/:id/stats
 * @access  Public (Detaylı istatistikler moderatörler için)
 */
const getSubredditStats = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const timeRange = req.query.timeRange || 'month';

  // Subreddit'in var olup olmadığını kontrol et
  const subreddit = await Subreddit.findById(id).select('name title memberCount createdAt');

  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Zaman filtresini belirle
  let timeFilter = {};
  const now = new Date();

  switch (timeRange) {
    case 'day':
      timeFilter = { createdAt: { $gte: new Date(now.setDate(now.getDate() - 1)) } };
      break;
    case 'week':
      timeFilter = { createdAt: { $gte: new Date(now.setDate(now.getDate() - 7)) } };
      break;
    case 'month':
      timeFilter = { createdAt: { $gte: new Date(now.setMonth(now.getMonth() - 1)) } };
      break;
    case 'year':
      timeFilter = { createdAt: { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) } };
      break;
    case 'all':
    default:
      timeFilter = {};
  }

  // Temel topluluk istatistiklerini hesapla
  const postCount = await Post.countDocuments({
    subreddit: id,
    isDeleted: false,
  });

  const recentPostCount = await Post.countDocuments({
    subreddit: id,
    isDeleted: false,
    ...timeFilter,
  });

  // Post türlerine göre dağılım
  const postTypeDistribution = await Post.aggregate([
    { $match: { subreddit: mongoose.Types.ObjectId(id), isDeleted: false } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  // En çok oy alan postlar
  const topPosts = await Post.find({
    subreddit: id,
    isDeleted: false,
  })
    .sort({ voteScore: -1 })
    .limit(5)
    .select('title type voteScore commentCount createdAt author')
    .populate('author', 'username');

  // En çok yorum alan postlar
  const mostCommentedPosts = await Post.find({
    subreddit: id,
    isDeleted: false,
  })
    .sort({ commentCount: -1 })
    .limit(5)
    .select('title type voteScore commentCount createdAt author')
    .populate('author', 'username');

  // Üye artış trendi (bu kısım gerçek uygulamada daha gelişmiş olabilir)
  const memberTrend = {
    currentMembers: subreddit.memberCount,
    growthRate: 'N/A', // Gerçek uygulamada hesaplanabilir
  };

  // İlgili diğer topluluklar
  const relatedSubreddits = [];

  // Temel istatistikler
  const basicStats = {
    subreddit: {
      _id: subreddit._id,
      name: subreddit.name,
      title: subreddit.title,
      memberCount: subreddit.memberCount,
      createdAt: subreddit.createdAt,
    },
    posts: {
      total: postCount,
      recent: recentPostCount,
      typeDistribution: postTypeDistribution,
    },
    topContent: {
      topPosts,
      mostCommentedPosts,
    },
    memberTrend,
    relatedSubreddits,
    timeRange,
  };

  // Kullanıcı moderatör veya admin ise, daha detaylı istatistikler ekle
  let isModOrAdmin = false;
  let detailedStats = null;

  if (req.user) {
    const modStatus = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: id,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    isModOrAdmin = !!(modStatus || req.user.role === 'admin');
  }

  if (isModOrAdmin) {
    // Aktif kullanıcılar
    const activeUsers = await Post.aggregate([
      { $match: { subreddit: mongoose.Types.ObjectId(id), isDeleted: false, ...timeFilter } },
      { $group: { _id: '$author', postCount: { $sum: 1 } } },
      { $sort: { postCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'authorDetails',
        },
      },
      { $unwind: '$authorDetails' },
      {
        $project: {
          _id: 1,
          postCount: 1,
          username: '$authorDetails.username',
        },
      },
    ]);

    // Trafik kaynakları (örnek veriler, gerçek uygulamada analitik sisteminden alınabilir)
    const trafficSources = [
      { source: 'direct', count: 450 },
      { source: 'internal', count: 320 },
      { source: 'google', count: 180 },
      { source: 'social', count: 150 },
    ];

    // Günlük ziyaretçi sayısı (örnek veriler)
    const dailyVisitors = [
      { date: '2023-10-01', count: 120 },
      { date: '2023-10-02', count: 145 },
      { date: '2023-10-03', count: 132 },
      { date: '2023-10-04', count: 168 },
      { date: '2023-10-05', count: 157 },
    ];

    // Moderatör aksiyonları
    const moderationActions = await ModLog.find({
      subreddit: id,
      ...timeFilter,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user', 'username');

    // Detaylı istatistikleri ekle
    detailedStats = {
      activeUsers,
      trafficSources,
      dailyVisitors,
      moderationActions,
    };
  }

  res.status(200).json({
    success: true,
    data: {
      ...basicStats,
      ...(detailedStats && { detailedStats }),
    },
  });
});

/**
 * @desc    Bekleyen üyelik isteklerini getir veya yönet
 * @route   GET/PUT /api/subreddits/:id/pending-requests
 * @access  Private (Moderatör/Admin)
 */
const managePendingRequests = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { action, userId } = req.body;

  // Subreddit'in var olup olmadığını kontrol et
  const subreddit = await Subreddit.findById(id);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü
  const modStatus = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: id,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modStatus && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // GET isteği - Bekleyen istekleri listele
  if (req.method === 'GET') {
    const pendingRequests = await SubredditMembership.find({
      subreddit: id,
      status: 'pending',
    })
      .populate('user', 'username profilePicture')
      .sort({ joinedAt: 1 });

    return res.status(200).json({
      success: true,
      count: pendingRequests.length,
      data: pendingRequests,
    });
  }

  // PUT isteği - Bir isteği kabul et veya reddet
  if (!userId || !['approve', 'reject'].includes(action)) {
    return next(new ErrorResponse('Geçersiz istek, kullanıcı ID ve aksiyonu belirtin', 400));
  }

  // İsteği bul
  const request = await SubredditMembership.findOne({
    user: userId,
    subreddit: id,
    status: 'pending',
  });

  if (!request) {
    return next(new ErrorResponse('Bekleyen istek bulunamadı', 404));
  }

  // İsteği işle
  if (action === 'approve') {
    // İsteği onayla
    request.status = 'active';
    await request.save();

    // Üye sayısını güncelle
    subreddit.memberCount += 1;
    await subreddit.save();

    // Moderasyon logu oluştur
    await ModLog.create({
      user: req.user._id,
      subreddit: id,
      action: 'approve_membership',
      targetType: 'user',
      targetId: userId,
      details: `Üyelik isteği onaylandı: ${userId}`,
    });

    res.status(200).json({
      success: true,
      message: 'Üyelik isteği onaylandı',
      data: request,
    });
  } else {
    // İsteği reddet
    await SubredditMembership.findByIdAndDelete(request._id);

    // Moderasyon logu oluştur
    await ModLog.create({
      user: req.user._id,
      subreddit: id,
      action: 'reject_membership',
      targetType: 'user',
      targetId: userId,
      details: `Üyelik isteği reddedildi: ${userId}`,
    });

    res.status(200).json({
      success: true,
      message: 'Üyelik isteği reddedildi',
      data: {},
    });
  }
});

/**
 * @desc    Subreddit'ten yasaklanmış kullanıcıları getir
 * @route   GET /api/subreddits/:id/banned-users
 * @access  Private (Moderatör/Admin)
 */
const getBannedUsers = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Subreddit'in var olup olmadığını kontrol et
  const subreddit = await Subreddit.findById(id);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Yetki kontrolü
  const modStatus = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: id,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!modStatus && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
  }

  // Yasaklanmış kullanıcıları getir
  const bannedUsers = await SubredditMembership.find({
    subreddit: id,
    status: 'banned',
  })
    .populate('user', 'username profilePicture')
    .populate('bannedBy', 'username')
    .sort({ bannedAt: -1 });

  res.status(200).json({
    success: true,
    count: bannedUsers.length,
    data: bannedUsers,
  });
});

/**
 * @desc    Subreddit moderatörlerini listele
 * @route   GET /api/subreddits/:id/moderators
 * @access  Public
 */
const getModerators = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Subreddit'in var olup olmadığını kontrol et
  const subreddit = await Subreddit.findById(id);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Moderatörleri getir
  const moderators = await SubredditMembership.find({
    subreddit: id,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  })
    .populate('user', 'username profilePicture createdAt')
    .sort({ type: -1, joinedAt: 1 }); // Admin'ler önce, sonra eski moderatörler

  // Moderatörleri düzenle
  const formattedModerators = moderators.map((mod) => ({
    _id: mod.user._id,
    username: mod.user.username,
    profilePicture: mod.user.profilePicture,
    joinedAt: mod.joinedAt,
    role: mod.type === 'admin' ? 'Kurucu' : 'Moderatör',
    permissions: mod.permissions || [],
  }));

  res.status(200).json({
    success: true,
    count: moderators.length,
    data: formattedModerators,
  });
});

module.exports = {
  getSubreddits,
  getSubreddit,
  createSubreddit,
  updateSubreddit,
  deleteSubreddit,
  joinSubreddit,
  leaveSubreddit,
  getTrendingSubreddits,
  getUserSubreddits,
  banUser,
  manageModerator,
  getSubredditRules,
  getSubredditStats,
  managePendingRequests,
  getBannedUsers,
  getModerators,
};
