const User = require('../models/User');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const SubredditMembership = require('../models/SubredditMembership');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

/**
 * @desc    Tüm kullanıcıları getir
 * @route   GET /api/users
 * @access  Private/Admin
 */
const getUsers = asyncHandler(async (req, res, next) => {
  res.status(200).json(res.advancedResults);
});

/**
 * @desc    Tek bir kullanıcıyı getir
 * @route   GET /api/users/:id
 * @access  Public
 */
const getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).select(
    '-resetPasswordToken -resetPasswordExpire -verificationToken -verificationTokenExpire',
  );

  if (!user) {
    return next(new ErrorResponse(`${req.params.id} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Bazı bilgiler sadece kullanıcının kendisi veya admin tarafından görülebilir
  let filteredUser = { ...user.toObject() };

  // Kullanıcı kendisi veya admin değilse email gibi hassas bilgileri çıkar
  if (req.user && req.user.id !== user._id.toString() && req.user.role !== 'admin') {
    delete filteredUser.email;
    delete filteredUser.lastLogin;
    delete filteredUser.authProvider;
  }

  res.status(200).json({
    success: true,
    data: filteredUser,
  });
});

/**
 * @desc    Kullanıcı oluştur (sadece admin için)
 * @route   POST /api/users
 * @access  Private/Admin
 */
const createUser = asyncHandler(async (req, res, next) => {
  const { username, email, password, bio, accountStatus } = req.body;

  // Kullanıcı oluştur
  const user = await User.create({
    username,
    email,
    password,
    bio,
    accountStatus: accountStatus || 'active',
    emailVerified: true, // Admin tarafından oluşturulduğu için direkt doğrulanmış kabul et
  });

  res.status(201).json({
    success: true,
    data: user,
  });
});

/**
 * @desc    Kullanıcıyı güncelle (admin için)
 * @route   PUT /api/users/:id
 * @access  Private/Admin
 */
const updateUser = asyncHandler(async (req, res, next) => {
  const fieldsToUpdate = {
    username: req.body.username,
    email: req.body.email,
    bio: req.body.bio,
    accountStatus: req.body.accountStatus,
  };

  // Boş alanları temizle
  Object.keys(fieldsToUpdate).forEach((key) => {
    if (fieldsToUpdate[key] === undefined) {
      delete fieldsToUpdate[key];
    }
  });

  const user = await User.findByIdAndUpdate(req.params.id, fieldsToUpdate, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    return next(new ErrorResponse(`${req.params.id} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * @desc    Kullanıcıyı sil (soft delete)
 * @route   DELETE /api/users/:id
 * @access  Private/Admin
 */
const deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`${req.params.id} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Soft delete işlemi
  user.isDeleted = true;
  user.deletedAt = Date.now();
  user.accountStatus = 'deleted';
  await user.save();

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * @desc    Profil bilgilerini güncelle (kullanıcının kendisi için)
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res, next) => {
  const { bio } = req.body;

  // Sadece izin verilen alanları güncelle
  const fieldsToUpdate = {
    bio,
  };

  // Boş alanları temizle
  Object.keys(fieldsToUpdate).forEach((key) => {
    if (fieldsToUpdate[key] === undefined) {
      delete fieldsToUpdate[key];
    }
  });

  const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * @desc    Profil fotoğrafını güncelle
 * @route   PUT /api/users/profile/picture
 * @access  Private
 */
const updateProfilePicture = asyncHandler(async (req, res, next) => {
  if (!req.files || !req.files.profilePicture) {
    return next(new ErrorResponse('Lütfen bir dosya yükleyin', 400));
  }

  const file = req.files.profilePicture;

  // Dosya boyutu kontrolü
  if (file.size > process.env.MAX_FILE_UPLOAD) {
    return next(
      new ErrorResponse(
        `Lütfen ${process.env.MAX_FILE_UPLOAD / 1000000} MB'dan küçük bir dosya yükleyin`,
        400,
      ),
    );
  }

  // Dosya tipini kontrol et
  if (!file.mimetype.startsWith('image')) {
    return next(new ErrorResponse('Lütfen bir resim dosyası yükleyin', 400));
  }

  // Özel dosya adı oluştur
  file.name = `photo_${req.user.id}_${Date.now()}${path.parse(file.name).ext}`;

  // Dosyayı kaydet
  file.mv(`${process.env.FILE_UPLOAD_PATH}/profile/${file.name}`, async (err) => {
    if (err) {
      console.error(err);
      return next(new ErrorResponse('Dosya yükleme hatası', 500));
    }

    // Kullanıcının eski profil fotoğrafını sil (varsayılan hariç)
    const user = await User.findById(req.user.id);
    if (user.profilePicture !== 'default-profile.png') {
      const oldFilePath = `${process.env.FILE_UPLOAD_PATH}/profile/${user.profilePicture}`;
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    // Veritabanını güncelle
    await User.findByIdAndUpdate(req.user.id, { profilePicture: file.name });

    res.status(200).json({
      success: true,
      data: file.name,
    });
  });
});

/**
 * @desc    Şifreyi güncelle
 * @route   PUT /api/users/password
 * @access  Private
 */
const updatePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return next(new ErrorResponse('Mevcut şifre ve yeni şifre gereklidir', 400));
  }

  // Şifre ile birlikte kullanıcıyı getir
  const user = await User.findById(req.user.id).select('+password');

  // Mevcut şifreyi doğrula
  const isMatch = await user.matchPassword(currentPassword);

  if (!isMatch) {
    return next(new ErrorResponse('Geçersiz mevcut şifre', 401));
  }

  // Yeni şifreyi ayarla
  user.password = newPassword;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Şifre başarıyla güncellendi',
  });
});

/**
 * @desc    E-posta doğrulama işlemi
 * @route   GET /api/users/verify-email/:token
 * @access  Public
 */
const verifyEmail = asyncHandler(async (req, res, next) => {
  // Doğrulama token'ını al
  const { token } = req.params;

  if (!token) {
    return next(new ErrorResponse("Doğrulama token'ı geçersiz", 400));
  }

  // Token'a sahip kullanıcıyı bul
  const user = await User.findOne({
    verificationToken: token,
    verificationTokenExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorResponse('Geçersiz token veya süresi dolmuş', 400));
  }

  // Kullanıcı e-postasını doğrulanmış olarak işaretle
  user.emailVerified = true;
  user.accountStatus = 'active';
  user.verificationToken = undefined;
  user.verificationTokenExpire = undefined;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'E-posta başarıyla doğrulandı, artık giriş yapabilirsiniz',
  });
});

/**
 * @desc    Kullanıcı adını değiştir
 * @route   PUT /api/users/username
 * @access  Private
 */
const updateUsername = asyncHandler(async (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return next(new ErrorResponse('Kullanıcı adı ve şifre gereklidir', 400));
  }

  // Şifre ile birlikte kullanıcıyı getir
  const user = await User.findById(req.user.id).select('+password');

  // Şifreyi doğrula
  const isMatch = await user.matchPassword(password);

  if (!isMatch) {
    return next(new ErrorResponse('Geçersiz şifre', 401));
  }

  // Kullanıcı adının kullanılabilir olduğunu kontrol et
  const existingUser = await User.findOne({ username });
  if (existingUser && existingUser._id.toString() !== req.user.id) {
    return next(new ErrorResponse('Bu kullanıcı adı zaten kullanılıyor', 400));
  }

  // Kullanıcı adını güncelle
  user.username = username;
  await user.save();

  res.status(200).json({
    success: true,
    data: {
      username: user.username,
    },
    message: 'Kullanıcı adı başarıyla güncellendi',
  });
});

/**
 * @desc    Kullanıcı karma puanlarını getir
 * @route   GET /api/users/:id/karma
 * @access  Public
 */
const getUserKarma = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).select('karma');

  if (!user) {
    return next(new ErrorResponse(`${req.params.id} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  res.status(200).json({
    success: true,
    data: {
      post: user.karma.post,
      comment: user.karma.comment,
      awardee: user.karma.awardee,
      awarder: user.karma.awarder,
      total: user.karma.post + user.karma.comment + user.karma.awardee + user.karma.awarder,
    },
  });
});

/**
 * @desc    Kullanıcının gönderilerini getir
 * @route   GET /api/users/:id/posts
 * @access  Public
 */
const getUserPosts = asyncHandler(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Sıralama
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

  const sortOptions = {};
  sortOptions[sortBy] = sortOrder;

  // Kullanıcıyı kontrol et
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`${req.params.id} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Kullanıcının gönderilerini getir
  const totalPosts = await Post.countDocuments({
    author: req.params.id,
    isDeleted: false,
  });

  const posts = await Post.find({
    author: req.params.id,
    isDeleted: false,
  })
    .sort(sortOptions)
    .skip(startIndex)
    .limit(limit)
    .populate([
      { path: 'subreddit', select: 'name title icon' },
      { path: 'author', select: 'username profilePicture' },
    ]);

  // Pagination sonuçları
  const pagination = {};

  if (endIndex < totalPosts) {
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

  pagination.totalPages = Math.ceil(totalPosts / limit);
  pagination.totalCount = totalPosts;

  res.status(200).json({
    success: true,
    count: posts.length,
    pagination,
    data: posts,
  });
});

/**
 * @desc    Kullanıcının yorumlarını getir
 * @route   GET /api/users/:id/comments
 * @access  Public
 */
const getUserComments = asyncHandler(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Sıralama
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

  const sortOptions = {};
  sortOptions[sortBy] = sortOrder;

  // Kullanıcıyı kontrol et
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`${req.params.id} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Kullanıcının yorumlarını getir
  const totalComments = await Comment.countDocuments({
    author: req.params.id,
    isDeleted: false,
  });

  const comments = await Comment.find({
    author: req.params.id,
    isDeleted: false,
  })
    .sort(sortOptions)
    .skip(startIndex)
    .limit(limit)
    .populate([
      { path: 'post', select: 'title slug subreddit' },
      { path: 'author', select: 'username profilePicture' },
    ])
    .populate({
      path: 'post',
      populate: {
        path: 'subreddit',
        select: 'name title icon',
      },
    });

  // Pagination sonuçları
  const pagination = {};

  if (endIndex < totalComments) {
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

  pagination.totalPages = Math.ceil(totalComments / limit);
  pagination.totalCount = totalComments;

  res.status(200).json({
    success: true,
    count: comments.length,
    pagination,
    data: comments,
  });
});

/**
 * @desc    Kullanıcının kaydedilmiş gönderilerini getir
 * @route   GET /api/users/:id/saved
 * @access  Private
 */
const getUserSavedItems = asyncHandler(async (req, res, next) => {
  // Kullanıcı sadece kendi kaydedilmiş gönderilerini görebilir
  if (req.user.id !== req.params.id && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için yetkiniz bulunmamaktadır', 403));
  }

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Sıralama
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sortOptions = {};
  sortOptions[sortBy] = sortOrder;

  // Filtreleme
  const itemType = req.query.type || 'all'; // 'post', 'comment', 'all'

  // Kullanıcıyı kontrol et
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`${req.params.id} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Saved items modeli üzerinden sorgulama
  let query = { user: req.params.id };
  if (itemType === 'post') {
    query.post = { $exists: true };
  } else if (itemType === 'comment') {
    query.comment = { $exists: true };
  }

  const savedItems = await mongoose
    .model('SavedItem')
    .find(query)
    .sort(sortOptions)
    .skip(startIndex)
    .limit(limit)
    .populate([
      { path: 'post', populate: { path: 'subreddit', select: 'name title icon' } },
      { path: 'post', populate: { path: 'author', select: 'username profilePicture' } },
      { path: 'comment', populate: { path: 'post', select: 'title slug subreddit' } },
      { path: 'comment', populate: { path: 'author', select: 'username profilePicture' } },
    ]);

  // Toplam öğe sayısını al
  const total = await mongoose.model('SavedItem').countDocuments(query);

  // Pagination sonuçları
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

  pagination.totalPages = Math.ceil(total / limit);
  pagination.totalCount = total;

  res.status(200).json({
    success: true,
    count: savedItems.length,
    pagination,
    data: savedItems,
  });
});

/**
 * @desc    Kullanıcının üye olduğu subreddit'leri getir
 * @route   GET /api/users/:id/subreddits
 * @access  Public
 */
const getUserSubreddits = asyncHandler(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Kullanıcıyı kontrol et
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`${req.params.id} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Kullanıcının üyeliklerini getir
  const memberships = await SubredditMembership.find({
    user: req.params.id,
    status: 'member',
  })
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate({
      path: 'subreddit',
      select: 'name title description icon memberCount type nsfw createdAt',
    });

  // Toplam üyelik sayısını al
  const totalMemberships = await SubredditMembership.countDocuments({
    user: req.params.id,
    status: 'member',
  });

  // Pagination sonuçları
  const pagination = {};

  if (endIndex < totalMemberships) {
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

  pagination.totalPages = Math.ceil(totalMemberships / limit);
  pagination.totalCount = totalMemberships;

  res.status(200).json({
    success: true,
    count: memberships.length,
    pagination,
    data: memberships,
  });
});

/**
 * @desc    Kullanıcının moderatörlük yaptığı subreddit'leri getir
 * @route   GET /api/users/:id/moderating
 * @access  Public
 */
const getUserModeratedSubreddits = asyncHandler(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Kullanıcıyı kontrol et
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`${req.params.id} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Kullanıcının moderatör olduğu subreddit'leri getir
  const moderatorRoles = await mongoose
    .model('UserRoleAssignment')
    .find({
      user: req.params.id,
      role: { $in: ['moderator', 'admin'] },
      entityType: 'subreddit',
    })
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate({
      path: 'entity',
      select: 'name title description icon memberCount type nsfw createdAt',
    });

  // Toplam moderatörlük sayısını al
  const totalModeratorRoles = await mongoose.model('UserRoleAssignment').countDocuments({
    user: req.params.id,
    role: { $in: ['moderator', 'admin'] },
    entityType: 'subreddit',
  });

  // Pagination sonuçları
  const pagination = {};

  if (endIndex < totalModeratorRoles) {
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

  pagination.totalPages = Math.ceil(totalModeratorRoles / limit);
  pagination.totalCount = totalModeratorRoles;

  res.status(200).json({
    success: true,
    count: moderatorRoles.length,
    pagination,
    data: moderatorRoles,
  });
});

/**
 * @desc    Kullanıcı istatistiklerini getir
 * @route   GET /api/users/:id/statistics
 * @access  Public
 */
const getUserStatistics = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;

  // Kullanıcı kontrolü
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse(`${userId} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Post istatistikleri
  const postCount = await Post.countDocuments({ author: userId, isDeleted: false });
  const postUpvotes = await Post.aggregate([
    { $match: { author: mongoose.Types.ObjectId(userId), isDeleted: false } },
    { $group: { _id: null, total: { $sum: '$voteScore' } } },
  ]);

  // Yorum istatistikleri
  const commentCount = await Comment.countDocuments({ author: userId, isDeleted: false });
  const commentUpvotes = await Comment.aggregate([
    { $match: { author: mongoose.Types.ObjectId(userId), isDeleted: false } },
    { $group: { _id: null, total: { $sum: '$voteScore' } } },
  ]);

  // Üye olunan subreddit sayısı
  const membershipCount = await SubredditMembership.countDocuments({
    user: userId,
    status: 'member',
  });

  // Moderatörlük yapılan subreddit sayısı
  const moderatorCount = await mongoose.model('UserRoleAssignment').countDocuments({
    user: userId,
    role: { $in: ['moderator', 'admin'] },
    entityType: 'subreddit',
  });

  // En aktif olduğu subredditler
  const topSubreddits = await Post.aggregate([
    { $match: { author: mongoose.Types.ObjectId(userId), isDeleted: false } },
    { $group: { _id: '$subreddit', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: 'subreddits',
        localField: '_id',
        foreignField: '_id',
        as: 'subredditInfo',
      },
    },
    { $unwind: '$subredditInfo' },
    {
      $project: {
        _id: 1,
        count: 1,
        name: '$subredditInfo.name',
        title: '$subredditInfo.title',
        icon: '$subredditInfo.icon',
      },
    },
  ]);

  // Hesap yaşı
  const accountAge = Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24));

  res.status(200).json({
    success: true,
    data: {
      username: user.username,
      profilePicture: user.profilePicture,
      karma: {
        post: user.karma.post,
        comment: user.karma.comment,
        awardee: user.karma.awardee,
        awarder: user.karma.awarder,
        total: user.karma.post + user.karma.comment + user.karma.awardee + user.karma.awarder,
      },
      activity: {
        postCount,
        postUpvotes: postUpvotes.length > 0 ? postUpvotes[0].total : 0,
        commentCount,
        commentUpvotes: commentUpvotes.length > 0 ? commentUpvotes[0].total : 0,
        membershipCount,
        moderatorCount,
      },
      topSubreddits,
      accountAge,
      createdAt: user.createdAt,
    },
  });
});

/**
 * @desc    Kullanıcının aldığı ödülleri getir
 * @route   GET /api/users/:id/awards
 * @access  Public
 */
const getUserAwards = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Kullanıcı kontrolü
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse(`${userId} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Kullanıcının aldığı ödülleri getir
  const awards = await mongoose
    .model('Award')
    .find({
      recipient: userId,
      entityType: { $in: ['post', 'comment'] },
    })
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate([
      { path: 'awardType', select: 'name icon description value' },
      { path: 'giver', select: 'username profilePicture' },
      { path: 'post', select: 'title slug subreddit' },
      { path: 'comment', select: 'content post' },
    ]);

  // Toplam ödül sayısını al
  const totalAwards = await mongoose.model('Award').countDocuments({
    recipient: userId,
    entityType: { $in: ['post', 'comment'] },
  });

  // Pagination sonuçları
  const pagination = {};

  if (endIndex < totalAwards) {
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

  pagination.totalPages = Math.ceil(totalAwards / limit);
  pagination.totalCount = totalAwards;

  res.status(200).json({
    success: true,
    count: awards.length,
    pagination,
    data: awards,
  });
});

/**
 * @desc    Kullanıcının dosya kullanım istatistiklerini getir
 * @route   GET /api/users/:id/storage
 * @access  Private (Kullanıcının kendisi ve admin)
 */
const getUserStorageStats = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;

  // Yetki kontrolü
  if (req.user.id !== userId && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için yetkiniz bulunmamaktadır', 403));
  }

  // Kullanıcı kontrolü
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse(`${userId} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Kullanıcının yüklediği dosyaları getir
  const uploadedFiles = await mongoose.model('Upload').find({
    uploader: userId,
  });

  // Toplam kullanılan alanı hesapla
  let totalSize = 0;
  let fileTypeStats = {};

  uploadedFiles.forEach((file) => {
    totalSize += file.size;

    // Dosya tipi istatistikleri
    const fileType = file.fileType || 'other';
    if (!fileTypeStats[fileType]) {
      fileTypeStats[fileType] = {
        count: 0,
        size: 0,
      };
    }

    fileTypeStats[fileType].count += 1;
    fileTypeStats[fileType].size += file.size;
  });

  res.status(200).json({
    success: true,
    data: {
      totalFiles: uploadedFiles.length,
      totalSize,
      usedStoragePercentage: (totalSize / process.env.MAX_USER_STORAGE) * 100,
      maxStorage: process.env.MAX_USER_STORAGE,
      fileTypes: fileTypeStats,
    },
  });
});

/**
 * @desc    Hesabı kalıcı olarak sil
 * @route   DELETE /api/users/account
 * @access  Private
 */
const permanentlyDeleteAccount = asyncHandler(async (req, res, next) => {
  const { password, confirmation } = req.body;

  if (!password) {
    return next(new ErrorResponse('Hesabınızı silmek için şifrenizi girmelisiniz', 400));
  }

  if (confirmation !== 'DELETE_MY_ACCOUNT') {
    return next(new ErrorResponse('Hesap silme işlemini onaylamanız gerekiyor', 400));
  }

  // Şifre ile birlikte kullanıcıyı getir
  const user = await User.findById(req.user.id).select('+password');

  // Şifreyi doğrula
  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    return next(new ErrorResponse('Geçersiz şifre', 401));
  }

  // Transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Kullanıcının içeriklerini anonim yap
    await Post.updateMany(
      { author: req.user.id },
      {
        author: null,
        authorUsername: '[deleted]',
        isAnonymized: true,
      },
      { session },
    );

    await Comment.updateMany(
      { author: req.user.id },
      {
        author: null,
        authorUsername: '[deleted]',
        isAnonymized: true,
      },
      { session },
    );

    // Kullanıcının üyeliklerini sil
    await SubredditMembership.deleteMany({ user: req.user.id }, { session });

    // Kullanıcının rol atamalarını sil
    await mongoose.model('UserRoleAssignment').deleteMany({ user: req.user.id }, { session });

    // Kullanıcının oylama geçmişini sil
    await mongoose.model('Vote').deleteMany({ user: req.user.id }, { session });

    // Kullanıcıyı sil (hard delete)
    await User.findByIdAndDelete(req.user.id, { session });

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {},
      message: 'Hesabınız başarıyla kalıcı olarak silindi',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Hesap silme işlemi sırasında bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});
// Diğer mevcut controller fonksiyonlarının sonuna eklenecek

/**
 * @desc    Kullanıcının rollerini getir
 * @route   GET /api/users/:id/roles
 * @access  Private (Self or Admin)
 */
const getUserRoles = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;

  // Kullanıcı varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse(`${userId} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Kullanıcının rol atamalarını getir
  const roleAssignments = await UserRoleAssignment.find({ user: userId })
    .populate({
      path: 'role',
      select: 'name description scope permissions',
      populate: {
        path: 'permissions',
        select: 'name description category',
      },
    })
    .populate('subreddit', 'name title icon');

  // Rolleri site kapsamlı ve subreddit kapsamlı olarak ayır
  const siteRoles = roleAssignments.filter((ra) => !ra.subreddit);
  const subredditRoles = roleAssignments.filter((ra) => ra.subreddit);

  res.status(200).json({
    success: true,
    data: {
      siteRoles,
      subredditRoles,
    },
  });
});

/**
 * @desc    Kullanıcıya rol ata (site kapsamlı)
 * @route   POST /api/users/:id/roles
 * @access  Private (Admin)
 */
const assignRoleToUser = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;
  const { roleId, expiresAt } = req.body;

  // Kullanıcı ve rol varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse(`${userId} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  const role = await Role.findById(roleId);
  if (!role) {
    return next(new ErrorResponse(`${roleId} ID'sine sahip rol bulunamadı`, 404));
  }

  // Rol atama kontrolü
  const existingAssignment = await UserRoleAssignment.findOne({
    user: userId,
    role: roleId,
    subreddit: null, // Site kapsamlı rol için
  });

  if (existingAssignment) {
    return next(new ErrorResponse(`Bu kullanıcıya zaten bu rol atanmış`, 400));
  }

  // Rol atamasını oluştur
  const roleAssignment = await UserRoleAssignment.create({
    user: userId,
    role: roleId,
    assignedBy: req.user.id,
    expiresAt: expiresAt || null,
  });

  // Detaylı bilgilerle birlikte rol atamasını getir
  const populatedAssignment = await UserRoleAssignment.findById(roleAssignment._id)
    .populate('role', 'name description')
    .populate('user', 'username email')
    .populate('assignedBy', 'username');

  res.status(201).json({
    success: true,
    data: populatedAssignment,
  });
});

/**
 * @desc    Kullanıcıdan rol kaldır
 * @route   DELETE /api/users/:id/roles/:roleId
 * @access  Private (Admin)
 */
const removeRoleFromUser = asyncHandler(async (req, res, next) => {
  const { id: userId, roleId } = req.params;
  const { subredditId } = req.query; // Subreddit kapsamlı rolü kaldırmak için opsiyonel

  // Rol atamasını bul
  const query = {
    user: userId,
    role: roleId,
  };

  // Subreddit belirtilmişse ekle, değilse site kapsamlı rol
  if (subredditId) {
    query.subreddit = subredditId;
  } else {
    query.subreddit = null;
  }

  const roleAssignment = await UserRoleAssignment.findOne(query);

  if (!roleAssignment) {
    return next(new ErrorResponse(`Bu kullanıcı için belirtilen rol ataması bulunamadı`, 404));
  }

  // Atamanın silinmesini logla ve sil
  await roleAssignment.remove();

  res.status(200).json({
    success: true,
    data: {},
    message: 'Rol ataması başarıyla kaldırıldı',
  });
});

/**
 * @desc    Kullanıcının izinlerini getir
 * @route   GET /api/users/:id/permissions
 * @access  Private (Self or Admin)
 */
const getUserPermissions = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;
  const { scope, subredditId } = req.query;

  // Kullanıcı varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse(`${userId} ID'sine sahip kullanıcı bulunamadı`, 404));
  }

  // Kullanıcının rol atamalarını getir
  let roleAssignments;

  if (scope === 'site') {
    // Sadece site kapsamlı rol atamaları
    roleAssignments = await UserRoleAssignment.find({
      user: userId,
      subreddit: null,
    }).populate({
      path: 'role',
      select: 'name permissions scope',
      populate: {
        path: 'permissions',
        select: 'name description category scope',
      },
    });
  } else if (scope === 'subreddit' && subredditId) {
    // Belirli bir subreddit için rol atamaları
    roleAssignments = await UserRoleAssignment.find({
      user: userId,
      subreddit: subredditId,
    })
      .populate({
        path: 'role',
        select: 'name permissions scope',
        populate: {
          path: 'permissions',
          select: 'name description category scope',
        },
      })
      .populate('subreddit', 'name title');
  } else {
    // Tüm rol atamaları
    roleAssignments = await UserRoleAssignment.find({
      user: userId,
    })
      .populate({
        path: 'role',
        select: 'name permissions scope',
        populate: {
          path: 'permissions',
          select: 'name description category scope',
        },
      })
      .populate('subreddit', 'name title');
  }

  // İzinleri birleştir ve tekrarları kaldır
  const permissionsSet = new Set();
  const permissionDetails = [];

  roleAssignments.forEach((assignment) => {
    if (assignment.role && assignment.role.permissions) {
      assignment.role.permissions.forEach((permission) => {
        const permissionKey = `${permission.name}-${assignment.subreddit ? assignment.subreddit._id : 'site'}`;

        if (!permissionsSet.has(permissionKey)) {
          permissionsSet.add(permissionKey);

          permissionDetails.push({
            name: permission.name,
            description: permission.description,
            category: permission.category,
            scope: permission.scope,
            subreddit: assignment.subreddit,
            grantedVia: {
              role: {
                id: assignment.role._id,
                name: assignment.role.name,
              },
              scope: assignment.role.scope,
            },
          });
        }
      });
    }
  });

  // İzinleri kategorilere göre grupla
  const categorizedPermissions = {};

  permissionDetails.forEach((permission) => {
    if (!categorizedPermissions[permission.category]) {
      categorizedPermissions[permission.category] = [];
    }

    categorizedPermissions[permission.category].push(permission);
  });

  res.status(200).json({
    success: true,
    data: {
      permissions: permissionDetails,
      categorized: categorizedPermissions,
      roleAssignments,
    },
  });
});

// Module exports kısmına da bu fonksiyonları ekleyin
module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  updateProfile,
  updateProfilePicture,
  updatePassword,
  verifyEmail,
  updateUsername,
  getUserKarma,
  getUserPosts,
  getUserComments,
  getUserSavedItems,
  getUserSubreddits,
  getUserModeratedSubreddits,
  getUserStatistics,
  getUserAwards,
  getUserStorageStats,
  permanentlyDeleteAccount,
  // Yeni eklenen fonksiyonlar
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  getUserPermissions,
};
