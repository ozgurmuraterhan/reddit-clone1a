const Post = require('../models/Post');
const User = require('../models/User');
const Subreddit = require('../models/Subreddit');
const SubredditMembership = require('../models/SubredditMembership');
const Poll = require('../models/Poll');
const Vote = require('../models/Vote');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Yeni bir gönderi oluştur
 * @route   POST /api/posts
 * @access  Private
 */
const createPost = asyncHandler(async (req, res, next) => {
  const { title, content, type, url, mediaUrl, subredditId, isNSFW, isSpoiler, flair } = req.body;

  // Subreddit kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının subreddit'e üye olup olmadığını kontrol et
  const membership = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: subredditId,
    status: { $in: ['member', 'moderator', 'admin'] },
  });

  // Kapalı subreddit ise üyelik kontrolü
  if (subreddit.type === 'private' && !membership) {
    return next(new ErrorResponse("Bu subreddit'e gönderi yapma izniniz yok", 403));
  }

  // Gönderinin türüne göre gerekli alanları kontrol et
  if (type === 'link' && !url) {
    return next(new ErrorResponse('Link tipi gönderiler için URL gereklidir', 400));
  }

  if (['image', 'video'].includes(type) && !mediaUrl) {
    return next(new ErrorResponse(`${type} tipi gönderiler için medya URL'si gereklidir`, 400));
  }

  // Yeni gönderi oluştur
  const newPost = await Post.create({
    title,
    content,
    type,
    url,
    mediaUrl,
    author: req.user._id,
    subreddit: subredditId,
    isNSFW: isNSFW || false,
    isSpoiler: isSpoiler || false,
    flair: flair || undefined,
  });

  // Poll tipi gönderiyse Poll oluşturulacak (Ayrı controller'da ele alınmalı)

  // Popüle edilmiş gönderiyi dön
  const populatedPost = await Post.findById(newPost._id)
    .populate('author', 'username profilePicture')
    .populate('subreddit', 'name title icon bannerImage')
    .populate('flair', 'text backgroundColor textColor');

  res.status(201).json({
    success: true,
    data: populatedPost,
    message: 'Gönderi başarıyla oluşturuldu',
  });
});

/**
 * @desc    Tüm gönderileri listele (Ana sayfa için, filtreleme ve sıralama ile)
 * @route   GET /api/posts
 * @access  Public
 */
const getPosts = asyncHandler(async (req, res, next) => {
  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Filtreleme ve sıralama seçenekleri
  const sort = req.query.sort || 'new'; // 'new', 'hot', 'top', 'controversial'
  const time = req.query.time || 'all'; // 'all', 'day', 'week', 'month', 'year'
  const type = req.query.type; // 'text', 'link', 'image', 'video', 'poll'

  // Filtreleme koşulları
  let query = { isDeleted: false };

  // Gönderi tipine göre filtreleme
  if (type) {
    query.type = type;
  }

  // Zaman aralığına göre filtreleme
  if (time !== 'all') {
    let timeFilter = new Date();
    switch (time) {
      case 'day':
        timeFilter.setDate(timeFilter.getDate() - 1);
        break;
      case 'week':
        timeFilter.setDate(timeFilter.getDate() - 7);
        break;
      case 'month':
        timeFilter.setMonth(timeFilter.getMonth() - 1);
        break;
      case 'year':
        timeFilter.setFullYear(timeFilter.getFullYear() - 1);
        break;
    }
    query.createdAt = { $gte: timeFilter };
  }

  // Sıralama koşulları
  let sortOption = {};
  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'hot':
      sortOption = { voteScore: -1, commentCount: -1, createdAt: -1 };
      break;
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'controversial':
      // Controversial sıralaması için upvotes ve downvotes değerleri yakın olan
      sortOption = { commentCount: -1, createdAt: -1 };
      break;
    default:
      sortOption = { createdAt: -1 };
  }

  // Sorgulama ve sayfalama
  const total = await Post.countDocuments(query);

  const posts = await Post.find(query)
    .sort(sortOption)
    .skip(startIndex)
    .limit(limit)
    .populate('author', 'username profilePicture')
    .populate('subreddit', 'name title icon')
    .populate('flair', 'text backgroundColor textColor');

  // Kullanıcı giriş yapmışsa, kullanıcının oylama durumunu getir
  if (req.user) {
    const postIds = posts.map((post) => post._id);
    const userVotes = await Vote.find({
      user: req.user._id,
      post: { $in: postIds },
    });

    // Her gönderiye kullanıcının oyunu ekle
    const votesMap = {};
    userVotes.forEach((vote) => {
      votesMap[vote.post.toString()] = vote.value;
    });

    posts.forEach((post) => {
      post._doc.userVote = votesMap[post._id.toString()] || 0;
    });
  }

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalDocs: total,
    totalPages: Math.ceil(total / limit),
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
    count: posts.length,
    pagination,
    data: posts,
  });
});

/**
 * @desc    Bir subreddit'in gönderilerini listele
 * @route   GET /api/subreddits/:subredditId/posts
 * @access  Public
 */
const getSubredditPosts = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Subreddit kontrolü
  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Özel subreddit ise üyelik kontrolü
  if (subreddit.type === 'private') {
    if (!req.user) {
      return next(
        new ErrorResponse(
          'Bu özel topluluğun gönderilerini görüntülemek için giriş yapmalısınız',
          401,
        ),
      );
    }

    const membership = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      status: { $in: ['member', 'moderator', 'admin'] },
    });

    if (!membership) {
      return next(
        new ErrorResponse('Bu özel topluluğun gönderilerini görüntüleme izniniz yok', 403),
      );
    }
  }

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Filtreleme ve sıralama seçenekleri
  const sort = req.query.sort || 'new';
  const time = req.query.time || 'all';
  const type = req.query.type;

  // Filtreleme koşulları
  let query = {
    subreddit: subredditId,
    isDeleted: false,
  };

  // Gönderi tipine göre filtreleme
  if (type) {
    query.type = type;
  }

  // Zaman aralığına göre filtreleme
  if (time !== 'all') {
    let timeFilter = new Date();
    switch (time) {
      case 'day':
        timeFilter.setDate(timeFilter.getDate() - 1);
        break;
      case 'week':
        timeFilter.setDate(timeFilter.getDate() - 7);
        break;
      case 'month':
        timeFilter.setMonth(timeFilter.getMonth() - 1);
        break;
      case 'year':
        timeFilter.setFullYear(timeFilter.getFullYear() - 1);
        break;
    }
    query.createdAt = { $gte: timeFilter };
  }

  // Sıralama koşulları
  let sortOption = {};
  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'hot':
      sortOption = { voteScore: -1, commentCount: -1, createdAt: -1 };
      break;
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'controversial':
      sortOption = { commentCount: -1, createdAt: -1 };
      break;
    default:
      sortOption = { createdAt: -1 };
  }

  // Sorgulama ve sayfalama
  const total = await Post.countDocuments(query);

  const posts = await Post.find(query)
    .sort(sortOption)
    .skip(startIndex)
    .limit(limit)
    .populate('author', 'username profilePicture')
    .populate('flair', 'text backgroundColor textColor');

  // Kullanıcı giriş yapmışsa, kullanıcının oylama durumunu getir
  if (req.user) {
    const postIds = posts.map((post) => post._id);
    const userVotes = await Vote.find({
      user: req.user._id,
      post: { $in: postIds },
    });

    // Her gönderiye kullanıcının oyunu ekle
    const votesMap = {};
    userVotes.forEach((vote) => {
      votesMap[vote.post.toString()] = vote.value;
    });

    posts.forEach((post) => {
      post._doc.userVote = votesMap[post._id.toString()] || 0;
    });
  }

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalDocs: total,
    totalPages: Math.ceil(total / limit),
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
    count: posts.length,
    pagination,
    data: posts,
  });
});

/**
 * @desc    Bir kullanıcının gönderilerini listele
 * @route   GET /api/users/:userId/posts
 * @access  Public
 */
const getUserPosts = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Kullanıcı kontrolü
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Filtreleme ve sıralama seçenekleri
  const sort = req.query.sort || 'new';
  const time = req.query.time || 'all';
  const type = req.query.type;

  // Filtreleme koşulları
  let query = {
    author: userId,
    isDeleted: false,
  };

  // Gönderi tipine göre filtreleme
  if (type) {
    query.type = type;
  }

  // Zaman aralığına göre filtreleme
  if (time !== 'all') {
    let timeFilter = new Date();
    switch (time) {
      case 'day':
        timeFilter.setDate(timeFilter.getDate() - 1);
        break;
      case 'week':
        timeFilter.setDate(timeFilter.getDate() - 7);
        break;
      case 'month':
        timeFilter.setMonth(timeFilter.getMonth() - 1);
        break;
      case 'year':
        timeFilter.setFullYear(timeFilter.getFullYear() - 1);
        break;
    }
    query.createdAt = { $gte: timeFilter };
  }

  // Sıralama koşulları
  let sortOption = {};
  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'hot':
      sortOption = { voteScore: -1, commentCount: -1, createdAt: -1 };
      break;
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'controversial':
      sortOption = { commentCount: -1, createdAt: -1 };
      break;
    default:
      sortOption = { createdAt: -1 };
  }

  // Sorgulama ve sayfalama
  const total = await Post.countDocuments(query);

  const posts = await Post.find(query)
    .sort(sortOption)
    .skip(startIndex)
    .limit(limit)
    .populate('subreddit', 'name title icon')
    .populate('flair', 'text backgroundColor textColor');

  // Kullanıcı giriş yapmışsa, kullanıcının oylama durumunu getir
  if (req.user) {
    const postIds = posts.map((post) => post._id);
    const userVotes = await Vote.find({
      user: req.user._id,
      post: { $in: postIds },
    });

    // Her gönderiye kullanıcının oyunu ekle
    const votesMap = {};
    userVotes.forEach((vote) => {
      votesMap[vote.post.toString()] = vote.value;
    });

    posts.forEach((post) => {
      post._doc.userVote = votesMap[post._id.toString()] || 0;
    });
  }

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalDocs: total,
    totalPages: Math.ceil(total / limit),
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
    count: posts.length,
    pagination,
    data: posts,
  });
});

/**
 * @desc    Bir gönderiyi ID'ye göre getir
 * @route   GET /api/posts/:id
 * @access  Public
 */
const getPostById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id)
    .populate('author', 'username profilePicture createdAt karma')
    .populate('subreddit', 'name title icon bannerImage description rules type')
    .populate('flair', 'text backgroundColor textColor')
    .populate({
      path: 'poll',
      populate: {
        path: 'options',
        options: { sort: { position: 1 } },
      },
    });

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Eğer gönderi özel bir subreddit'e aitse ve kullanıcı üye değilse erişimi engelleyelim
  if (post.subreddit.type === 'private') {
    if (!req.user) {
      return next(new ErrorResponse('Bu gönderiyi görüntülemek için giriş yapmalısınız', 401));
    }

    const membership = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: post.subreddit._id,
      status: { $in: ['member', 'moderator', 'admin'] },
    });

    if (!membership) {
      return next(new ErrorResponse('Bu gönderiyi görüntüleme izniniz yok', 403));
    }
  }

  // Kullanıcı giriş yapmışsa, kullanıcının oy durumunu getir
  if (req.user) {
    const userVote = await Vote.findOne({
      user: req.user._id,
      post: id,
    });

    post._doc.userVote = userVote ? userVote.value : 0;
  }

  // Gönderi görüntüleme sayısını artırabilir (analytics için)

  res.status(200).json({
    success: true,
    data: post,
  });
});

/**
 * @desc    Gönderiyi güncelle
 * @route   PUT /api/posts/:id
 * @access  Private
 */
const updatePost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { title, content, url, mediaUrl, isNSFW, isSpoiler, flair } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  let post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Gönderi sahibi veya moderatör kontrolü
  const isAuthor = post.author.toString() === req.user._id.toString();
  let isModerator = false;

  if (!isAuthor) {
    isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: post.subreddit,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!isModerator && req.user.role !== 'admin') {
      return next(new ErrorResponse('Bu gönderiyi düzenleme yetkiniz yok', 403));
    }
  }

  // Arşivlenmiş gönderiler düzenlenemez
  if (post.isArchived) {
    return next(new ErrorResponse('Arşivlenmiş gönderiler düzenlenemez', 400));
  }

  // Güncellenecek alanları belirle
  const updateData = {};

  // Sadece gönderi sahibi içeriği değiştirebilir
  if (isAuthor) {
    if (title) updateData.title = title;

    // Gönderi tipine göre alan kontrolü
    if (post.type === 'text' && content !== undefined) {
      updateData.content = content;
    }

    if (post.type === 'link' && url) {
      updateData.url = url;
    }

    if (['image', 'video'].includes(post.type) && mediaUrl) {
      updateData.mediaUrl = mediaUrl;
    }
  }

  // Mod ayarları (flair, NSFW, Spoiler) moderatörler tarafından da değiştirilebilir
  if (isNSFW !== undefined) updateData.isNSFW = isNSFW;
  if (isSpoiler !== undefined) updateData.isSpoiler = isSpoiler;
  if (flair) updateData.flair = flair;

  // Düzenleme geçmişi ekle
  // Burada edit history modeli ile entegrasyon yapılabilir

  // Gönderiyi güncelle
  post = await Post.findByIdAndUpdate(
    id,
    {
      ...updateData,
      editedAt: Date.now(),
    },
    {
      new: true,
      runValidators: true,
    },
  )
    .populate('author', 'username profilePicture')
    .populate('subreddit', 'name title icon')
    .populate('flair', 'text backgroundColor textColor');

  res.status(200).json({
    success: true,
    data: post,
    message: 'Gönderi başarıyla güncellendi',
  });
});

/**
 * @desc    Gönderiyi sil (soft delete)
 * @route   DELETE /api/posts/:id
 * @access  Private
 */
const deletePost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Gönderi sahibi veya moderatör kontrolü
  const isAuthor = post.author.toString() === req.user._id.toString();
  let isModerator = false;

  if (!isAuthor) {
    isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: post.subreddit,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!isModerator && req.user.role !== 'admin') {
      return next(new ErrorResponse('Bu gönderiyi silme yetkiniz yok', 403));
    }
  }

  // Soft delete işlemi
  await Post.findByIdAndUpdate(id, {
    isDeleted: true,
    deletedAt: Date.now(),
    deletedBy: req.user._id,
  });

  // Silme işlemiyle ilgili log kaydı tutulabilir

  res.status(200).json({
    success: true,
    data: {},
    message: 'Gönderi başarıyla silindi',
  });
});

/**
 * @desc    Gönderiye oy ver (upvote/downvote)
 * @route   POST /api/posts/:id/vote
 * @access  Private
 */
const votePost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { value } = req.body;
  const userId = req.user._id;

  // Oy değeri kontrolü: 1 (upvote), 0 (vote kaldırma), -1 (downvote)
  if (![1, 0, -1].includes(value)) {
    return next(new ErrorResponse('Geçersiz oy değeri, 1, 0 veya -1 olmalıdır', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Kilitli veya arşivlenmiş gönderiler oylanamaz
  if (post.isLocked || post.isArchived) {
    return next(new ErrorResponse('Bu gönderi kilitli veya arşivlenmiş, oylanamaz', 400));
  }

  // Kullanıcının mevcut oyunu kontrol et
  const existingVote = await Vote.findOne({
    user: userId,
    post: id,
  });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Mevcut oy durumuna göre işlem yap
    if (existingVote) {
      if (value === 0) {
        // Oyu kaldır
        await Vote.findByIdAndDelete(existingVote._id, { session });

        // Post'un oy sayılarını güncelle
        if (existingVote.value === 1) {
          await Post.findByIdAndUpdate(id, { $inc: { upvotes: -1, voteScore: -1 } }, { session });
        } else if (existingVote.value === -1) {
          await Post.findByIdAndUpdate(id, { $inc: { downvotes: -1, voteScore: 1 } }, { session });
        }
      } else if (existingVote.value !== value) {
        // Oy değiştir
        await Vote.findByIdAndUpdate(existingVote._id, { value }, { session });

        // Post'un oy sayılarını güncelle
        if (existingVote.value === 1 && value === -1) {
          await Post.findByIdAndUpdate(
            id,
            { $inc: { upvotes: -1, downvotes: 1, voteScore: -2 } },
            { session },
          );
        } else if (existingVote.value === -1 && value === 1) {
          await Post.findByIdAndUpdate(
            id,
            { $inc: { upvotes: 1, downvotes: -1, voteScore: 2 } },
            { session },
          );
        }
      }
      // Değer aynı ise bir şey yapma
    } else if (value !== 0) {
      // Yeni oy oluştur
      await Vote.create(
        [
          {
            user: userId,
            post: id,
            value,
          },
        ],
        { session },
      );

      // Post'un oy sayılarını güncelle
      if (value === 1) {
        await Post.findByIdAndUpdate(id, { $inc: { upvotes: 1, voteScore: 1 } }, { session });
      } else if (value === -1) {
        await Post.findByIdAndUpdate(id, { $inc: { downvotes: 1, voteScore: -1 } }, { session });
      }
    }

    await session.commitTransaction();

    // Güncellenmiş gönderiyi getir
    const updatedPost = await Post.findById(id);

    res.status(200).json({
      success: true,
      data: {
        userVote: value,
        upvotes: updatedPost.upvotes,
        downvotes: updatedPost.downvotes,
        voteScore: updatedPost.voteScore,
      },
      message: value === 0 ? 'Oy başarıyla kaldırıldı' : 'Oy başarıyla kaydedildi',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse('Oylama işlemi sırasında bir hata oluştu', 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Gönderiyi sabitle/sabitlemesini kaldır
 * @route   PUT /api/posts/:id/pin
 * @access  Private (Moderatör/Admin)
 */
const togglePinPost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { isPinned } = req.body;

  if (isPinned === undefined) {
    return next(new ErrorResponse('isPinned değeri gereklidir', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Moderatör kontrolü
  const isModerator = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: post.subreddit,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu gönderiyi sabitleme/kaldırma yetkiniz yok', 403));
  }

  // Gönderiyi güncelle
  const updatedPost = await Post.findByIdAndUpdate(id, { isPinned }, { new: true });

  res.status(200).json({
    success: true,
    data: {
      isPinned: updatedPost.isPinned,
    },
    message: isPinned ? 'Gönderi başarıyla sabitlendi' : 'Gönderi sabitlemesi kaldırıldı',
  });
});

/**
 * @desc    Gönderiyi kilitle/kilidini aç
 * @route   PUT /api/posts/:id/lock
 * @access  Private (Moderatör/Admin)
 */
const toggleLockPost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { isLocked } = req.body;

  if (isLocked === undefined) {
    return next(new ErrorResponse('isLocked değeri gereklidir', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Moderatör kontrolü
  const isModerator = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: post.subreddit,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu gönderiyi kilitleme/kilidini açma yetkiniz yok', 403));
  }

  // Gönderiyi güncelle
  const updatedPost = await Post.findByIdAndUpdate(id, { isLocked }, { new: true });

  res.status(200).json({
    success: true,
    data: {
      isLocked: updatedPost.isLocked,
    },
    message: isLocked ? 'Gönderi başarıyla kilitlendi' : 'Gönderi kilidi kaldırıldı',
  });
});

/**
 * @desc    Gönderiyi NSFW olarak işaretle/işareti kaldır
 * @route   PUT /api/posts/:id/nsfw
 * @access  Private (Yazar/Moderatör/Admin)
 */
const toggleNSFWPost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { isNSFW } = req.body;

  if (isNSFW === undefined) {
    return next(new ErrorResponse('isNSFW değeri gereklidir', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Yetki kontrolü (yazar veya moderatör)
  const isAuthor = post.author.toString() === req.user._id.toString();
  let isModerator = false;

  if (!isAuthor) {
    isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: post.subreddit,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!isModerator && req.user.role !== 'admin') {
      return next(
        new ErrorResponse('Bu gönderiyi NSFW olarak işaretleme/kaldırma yetkiniz yok', 403),
      );
    }
  }

  // Gönderiyi güncelle
  const updatedPost = await Post.findByIdAndUpdate(id, { isNSFW }, { new: true });

  res.status(200).json({
    success: true,
    data: {
      isNSFW: updatedPost.isNSFW,
    },
    message: isNSFW ? 'Gönderi NSFW olarak işaretlendi' : 'Gönderinin NSFW işareti kaldırıldı',
  });
});

/**
 * @desc    Gönderiyi spoiler olarak işaretle/işareti kaldır
 * @route   PUT /api/posts/:id/spoiler
 * @access  Private (Yazar/Moderatör/Admin)
 */
const toggleSpoilerPost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { isSpoiler } = req.body;

  if (isSpoiler === undefined) {
    return next(new ErrorResponse('isSpoiler değeri gereklidir', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Yetki kontrolü (yazar veya moderatör)
  const isAuthor = post.author.toString() === req.user._id.toString();
  let isModerator = false;

  if (!isAuthor) {
    isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: post.subreddit,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!isModerator && req.user.role !== 'admin') {
      return next(
        new ErrorResponse('Bu gönderiyi spoiler olarak işaretleme/kaldırma yetkiniz yok', 403),
      );
    }
  }

  // Gönderiyi güncelle
  const updatedPost = await Post.findByIdAndUpdate(id, { isSpoiler }, { new: true });

  res.status(200).json({
    success: true,
    data: {
      isSpoiler: updatedPost.isSpoiler,
    },
    message: isSpoiler
      ? 'Gönderi spoiler olarak işaretlendi'
      : 'Gönderinin spoiler işareti kaldırıldı',
  });
});

/**
 * @desc    Gönderilerde arama yap
 * @route   GET /api/posts/search
 * @access  Public
 */
const searchPosts = asyncHandler(async (req, res, next) => {
  const { q, subreddit, author, type, flair, sort, time } = req.query;

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Arama sorgusu oluştur
  let query = { isDeleted: false };

  // Metin araması
  if (q) {
    query.$text = { $search: q };
  }

  // Subreddit filtreleme
  if (subreddit) {
    // Subreddit adına göre filtreleme
    const subredditObj = await Subreddit.findOne({ name: subreddit.toLowerCase() });
    if (subredditObj) {
      query.subreddit = subredditObj._id;
    } else {
      // Geçersiz subreddit adı, boş sonuç döndür
      return res.status(200).json({
        success: true,
        count: 0,
        pagination: {
          page,
          limit,
          totalDocs: 0,
          totalPages: 0,
        },
        data: [],
      });
    }
  }

  // Yazar filtreleme
  if (author) {
    // Kullanıcı adına göre filtreleme
    const authorObj = await User.findOne({ username: author });
    if (authorObj) {
      query.author = authorObj._id;
    } else {
      // Geçersiz kullanıcı adı, boş sonuç döndür
      return res.status(200).json({
        success: true,
        count: 0,
        pagination: {
          page,
          limit,
          totalDocs: 0,
          totalPages: 0,
        },
        data: [],
      });
    }
  }

  // Tip filtreleme
  if (type && ['text', 'link', 'image', 'video', 'poll'].includes(type)) {
    query.type = type;
  }

  // Flair filtreleme
  if (flair) {
    query.flair = flair;
  }

  // Zaman filtreleme
  if (time && time !== 'all') {
    let timeFilter = new Date();
    switch (time) {
      case 'day':
        timeFilter.setDate(timeFilter.getDate() - 1);
        break;
      case 'week':
        timeFilter.setDate(timeFilter.getDate() - 7);
        break;
      case 'month':
        timeFilter.setMonth(timeFilter.getMonth() - 1);
        break;
      case 'year':
        timeFilter.setFullYear(timeFilter.getFullYear() - 1);
        break;
    }
    query.createdAt = { $gte: timeFilter };
  }

  // Sıralama koşulları
  let sortOption = {};
  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'hot':
      sortOption = { voteScore: -1, commentCount: -1, createdAt: -1 };
      break;
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'controversial':
      sortOption = { commentCount: -1, createdAt: -1 };
      break;
    case 'relevance':
      if (q) {
        sortOption = { score: { $meta: 'textScore' } };
      } else {
        sortOption = { createdAt: -1 };
      }
      break;
    default:
      sortOption = { createdAt: -1 };
  }

  // Metin araması için skor alanı ekle
  const projection = q ? { score: { $meta: 'textScore' } } : {};

  // Toplam belge sayısını al
  const total = await Post.countDocuments(query);

  // Arama sorgusu yap
  let posts;
  if (q) {
    posts = await Post.find(query, projection)
      .sort(sortOption)
      .skip(startIndex)
      .limit(limit)
      .populate('author', 'username profilePicture')
      .populate('subreddit', 'name title icon')
      .populate('flair', 'text backgroundColor textColor');
  } else {
    posts = await Post.find(query)
      .sort(sortOption)
      .skip(startIndex)
      .limit(limit)
      .populate('author', 'username profilePicture')
      .populate('subreddit', 'name title icon')
      .populate('flair', 'text backgroundColor textColor');
  }

  // Kullanıcı giriş yapmışsa, kullanıcının oy durumunu getir
  if (req.user) {
    const postIds = posts.map((post) => post._id);
    const userVotes = await Vote.find({
      user: req.user._id,
      post: { $in: postIds },
    });

    // Her gönderiye kullanıcının oyunu ekle
    const votesMap = {};
    userVotes.forEach((vote) => {
      votesMap[vote.post.toString()] = vote.value;
    });

    posts.forEach((post) => {
      post._doc.userVote = votesMap[post._id.toString()] || 0;
    });
  }

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalDocs: total,
    totalPages: Math.ceil(total / limit),
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
    count: posts.length,
    pagination,
    data: posts,
  });
});

/**
 * @desc    Kullanıcının kaydettiği gönderileri listele
 * @route   GET /api/users/:userId/saved-posts
 * @access  Private
 */
const getSavedPosts = asyncHandler(async (req, res, next) => {
  // Kullanıcı kendi kaydettiği gönderileri görebilir
  if (req.params.userId !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(
      new ErrorResponse(
        'Başka bir kullanıcının kaydettiği gönderileri görüntüleme yetkiniz yok',
        403,
      ),
    );
  }

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Kaydettiği gönderileri bul
  const savedPostIds = await SavedPost.find({ user: req.user._id })
    .sort({ savedAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .select('post');

  const postIds = savedPostIds.map((saved) => saved.post);

  // Gönderi detaylarını getir
  const posts = await Post.find({
    _id: { $in: postIds },
    isDeleted: false,
  })
    .populate('author', 'username profilePicture')
    .populate('subreddit', 'name title icon')
    .populate('flair', 'text backgroundColor textColor');

  // Kullanıcının oylarını getir
  const userVotes = await Vote.find({
    user: req.user._id,
    post: { $in: postIds },
  });

  // Her gönderiye kullanıcının oyunu ekle
  const votesMap = {};
  userVotes.forEach((vote) => {
    votesMap[vote.post.toString()] = vote.value;
  });

  posts.forEach((post) => {
    post._doc.userVote = votesMap[post._id.toString()] || 0;
  });

  // Toplam kayıtlı gönderi sayısı
  const total = await SavedPost.countDocuments({ user: req.user._id });

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalDocs: total,
    totalPages: Math.ceil(total / limit),
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
    count: posts.length,
    pagination,
    data: posts,
  });
});

/**
 * @desc    Gönderiyi kaydet/kaydetme işlemini kaldır
 * @route   POST /api/posts/:id/save
 * @access  Private
 */
const toggleSavePost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { save } = req.body; // true: kaydet, false: kaydetme işlemini kaldır

  if (save === undefined) {
    return next(new ErrorResponse('save değeri gereklidir', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Mevcut kayıt durumunu kontrol et
  const savedPost = await SavedPost.findOne({
    user: req.user._id,
    post: id,
  });

  if (save) {
    // Kaydet
    if (!savedPost) {
      await SavedPost.create({
        user: req.user._id,
        post: id,
        savedAt: Date.now(),
      });
    }

    res.status(200).json({
      success: true,
      message: 'Gönderi başarıyla kaydedildi',
    });
  } else {
    // Kaydetme işlemini kaldır
    if (savedPost) {
      await SavedPost.findByIdAndDelete(savedPost._id);
    }

    res.status(200).json({
      success: true,
      message: 'Gönderi kaydetme işlemi kaldırıldı',
    });
  }
});

/**
 * @desc    Gönderi istatistiklerini getir
 * @route   GET /api/posts/:id/analytics
 * @access  Private (Yazar/Moderatör/Admin)
 */
const getPostAnalytics = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Yetki kontrolü (yazar, moderatör veya admin)
  const isAuthor = post.author.toString() === req.user._id.toString();
  let isModerator = false;

  if (!isAuthor) {
    isModerator = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: post.subreddit,
      type: { $in: ['moderator', 'admin'] },
      status: 'active',
    });

    if (!isModerator && req.user.role !== 'admin') {
      return next(
        new ErrorResponse('Bu gönderinin istatistiklerini görüntüleme yetkiniz yok', 403),
      );
    }
  }

  // Gönderi istatistikleri
  const viewsByDate = await PostView.aggregate([
    { $match: { post: mongoose.Types.ObjectId(id) } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$viewedAt' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const votesByDate = await Vote.aggregate([
    { $match: { post: mongoose.Types.ObjectId(id) } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        upvotes: {
          $sum: { $cond: [{ $eq: ['$value', 1] }, 1, 0] },
        },
        downvotes: {
          $sum: { $cond: [{ $eq: ['$value', -1] }, 1, 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const commentsByDate = await Comment.aggregate([
    { $match: { post: mongoose.Types.ObjectId(id) } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Referans kaynakları (nereden gelindi)
  const referrers = await PostView.aggregate([
    { $match: { post: mongoose.Types.ObjectId(id) } },
    {
      $group: {
        _id: '$referrer',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Coğrafi konum bazlı görüntülemeler
  const viewsByCountry = await PostView.aggregate([
    { $match: { post: mongoose.Types.ObjectId(id) } },
    {
      $group: {
        _id: '$country',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  res.status(200).json({
    success: true,
    data: {
      postDetails: {
        title: post.title,
        type: post.type,
        created: post.createdAt,
        upvotes: post.upvotes,
        downvotes: post.downvotes,
        voteScore: post.voteScore,
        commentCount: post.commentCount,
      },
      viewStats: {
        byDate: viewsByDate,
        byCountry: viewsByCountry,
        referrers,
      },
      interactionStats: {
        votesByDate,
        commentsByDate,
      },
    },
  });
});

/**
 * @desc    Gönderiyi arşivle/arşivden çıkar
 * @route   PUT /api/posts/:id/archive
 * @access  Private (Moderatör/Admin)
 */
const toggleArchivePost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { isArchived, reason } = req.body;

  if (isArchived === undefined) {
    return next(new ErrorResponse('isArchived değeri gereklidir', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz gönderi ID formatı', 400));
  }

  const post = await Post.findById(id);

  if (!post) {
    return next(new ErrorResponse('Gönderi bulunamadı', 404));
  }

  // Moderatör kontrolü
  const isModerator = await SubredditMembership.findOne({
    user: req.user._id,
    subreddit: post.subreddit,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  if (!isModerator && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu gönderiyi arşivleme/arşivden çıkarma yetkiniz yok', 403));
  }

  // Arşiv bilgilerini hazırla
  const archiveData = {
    isArchived,
  };

  if (isArchived) {
    archiveData.archivedAt = Date.now();
    archiveData.archivedBy = req.user._id;
    archiveData.archivedReason = reason || 'Moderatör kararı';
  } else {
    archiveData.archivedAt = null;
    archiveData.archivedBy = null;
    archiveData.archivedReason = null;
  }

  // Gönderiyi güncelle
  const updatedPost = await Post.findByIdAndUpdate(id, archiveData, { new: true });

  // Moderasyon logu kaydet
  await ModLog.create({
    user: req.user._id,
    subreddit: post.subreddit,
    targetType: 'post',
    targetId: id,
    action: isArchived ? 'archive_post' : 'unarchive_post',
    details: reason || '',
  });

  res.status(200).json({
    success: true,
    data: {
      isArchived: updatedPost.isArchived,
      archivedAt: updatedPost.archivedAt,
      archivedBy: updatedPost.archivedBy,
      archivedReason: updatedPost.archivedReason,
    },
    message: isArchived ? 'Gönderi başarıyla arşivlendi' : 'Gönderi arşivden çıkarıldı',
  });
});

module.exports = {
  createPost,
  getPosts,
  getSubredditPosts,
  getUserPosts,
  getPostById,
  updatePost,
  deletePost,
  votePost,
  togglePinPost,
  toggleLockPost,
  toggleNSFWPost,
  toggleSpoilerPost,
  searchPosts,
  getSavedPosts,
  toggleSavePost,
  getPostAnalytics,
  toggleArchivePost,
};
