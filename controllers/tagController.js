const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const Tag = require('../models/Tag');
const Subreddit = require('../models/Subreddit');
const SubredditMembership = require('../models/SubredditMembership');
const Post = require('../models/Post');
const ModLog = require('../models/ModLog');
const mongoose = require('mongoose');

/**
 * @desc    Tag oluştur
 * @route   POST /api/tags (site geneli) veya /api/subreddits/:subredditId/tags (subreddit özelinde)
 * @access  Admin (site geneli) / Moderatör (subreddit özelinde)
 */
const createTag = asyncHandler(async (req, res, next) => {
  const { name, description, color, isActive } = req.body;
  const { subredditId } = req.params;

  // Gerekli alanların kontrolü
  if (!name) {
    return next(new ErrorResponse('Etiket adı zorunludur', 400));
  }

  // Etiket scope'unu belirle
  let scope = 'site';
  let subreddit = null;

  if (subredditId) {
    // Geçerli bir ObjectId mi kontrol et
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
    }

    // Subreddit'in varlığını kontrol et
    subreddit = await Subreddit.findById(subredditId);
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
      return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
    }

    scope = 'subreddit';
  } else {
    // Site geneli için admin kontrolü
    if (req.user.role !== 'admin') {
      return next(
        new ErrorResponse('Site geneli etiket oluşturmak için admin yetkisi gereklidir', 403),
      );
    }
  }

  // Aynı isimde etiket var mı kontrol et
  const existingTag = await Tag.findOne({
    name: { $regex: new RegExp(`^${name}$`, 'i') },
    scope,
    ...(scope === 'subreddit' && { subreddit: subredditId }),
  });

  if (existingTag) {
    return next(new ErrorResponse('Bu isimde bir etiket zaten mevcut', 400));
  }

  // Yeni etiket oluştur
  const tag = await Tag.create({
    name,
    description: description || '',
    color: color || '#6c757d', // Varsayılan gri renk
    scope,
    subreddit: scope === 'subreddit' ? subredditId : null,
    createdBy: req.user._id,
    isActive: isActive !== undefined ? isActive : true,
  });

  // Moderatör log kaydı (subreddit için)
  if (scope === 'subreddit') {
    await ModLog.create({
      subreddit: subredditId,
      action: 'tag_created',
      moderator: req.user._id,
      details: `"${name}" etiketi oluşturuldu`,
      data: { tagId: tag._id },
      timestamp: Date.now(),
    });
  }

  res.status(201).json({
    success: true,
    data: tag,
  });
});

/**
 * @desc    Etiketleri listele
 * @route   GET /api/tags (site geneli) veya /api/subreddits/:subredditId/tags (subreddit özelinde)
 * @access  Herkese Açık
 */
const getTags = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Sorgu parametrelerini oluştur
  const query = {};

  if (subredditId) {
    // Geçerli bir ObjectId mi kontrol et
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
    }

    // Subreddit'in varlığını kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    query.scope = 'subreddit';
    query.subreddit = subredditId;
  } else {
    query.scope = 'site';
  }

  // isActive filtresi (admin ve moderatörler hepsini görebilir)
  let isModerator = false;

  if (subredditId && req.user) {
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

  if (!isModerator && req.user?.role !== 'admin') {
    query.isActive = true;
  }

  // Etiketleri getir
  const tags = await Tag.find(query).sort({ createdAt: -1 }).populate('createdBy', 'username');

  res.status(200).json({
    success: true,
    count: tags.length,
    data: tags,
  });
});

/**
 * @desc    Etiket detayı getir
 * @route   GET /api/tags/:id (site geneli) veya /api/subreddits/:subredditId/tags/:id (subreddit özelinde)
 * @access  Herkese Açık
 */
const getTag = asyncHandler(async (req, res, next) => {
  const { id, subredditId } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz Tag ID formatı', 400));
  }

  // Sorgu parametrelerini oluştur
  const query = { _id: id };

  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
    }

    query.scope = 'subreddit';
    query.subreddit = subredditId;
  } else {
    query.scope = 'site';
  }

  // Etiketi getir
  const tag = await Tag.findOne(query).populate('createdBy', 'username');

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  // isActive kontrolü (admin ve moderatörler dışındakiler pasif etiketleri göremez)
  if (!tag.isActive) {
    let isModerator = false;

    if (subredditId && req.user) {
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

    if (!isModerator && req.user?.role !== 'admin') {
      return next(new ErrorResponse('Etiket bulunamadı', 404));
    }
  }

  // Etiket kullanım istatistiklerini getir
  const postCount = await Post.countDocuments({ tags: tag._id });

  res.status(200).json({
    success: true,
    data: {
      ...tag.toObject(),
      usage: {
        postCount,
      },
    },
  });
});

/**
 * @desc    Etiket güncelle
 * @route   PUT /api/tags/:id (site geneli) veya /api/subreddits/:subredditId/tags/:id (subreddit özelinde)
 * @access  Admin (site geneli) / Moderatör (subreddit özelinde)
 */
const updateTag = asyncHandler(async (req, res, next) => {
  const { id, subredditId } = req.params;
  const { name, description, color, isActive } = req.body;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz Tag ID formatı', 400));
  }

  // Sorgu parametrelerini oluştur
  const query = { _id: id };

  if (subredditId) {
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
      return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
    }

    query.scope = 'subreddit';
    query.subreddit = subredditId;
  } else {
    // Site geneli için admin kontrolü
    if (req.user.role !== 'admin') {
      return next(
        new ErrorResponse('Site geneli etiket güncellemek için admin yetkisi gereklidir', 403),
      );
    }

    query.scope = 'site';
  }

  // Etiketi bul
  const tag = await Tag.findOne(query);

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  // İsim değişikliği varsa, aynı isimde başka etiket var mı kontrol et
  if (name && name !== tag.name) {
    const existingTag = await Tag.findOne({
      _id: { $ne: id }, // Kendisi hariç
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      scope: tag.scope,
      ...(tag.scope === 'subreddit' && { subreddit: tag.subreddit }),
    });

    if (existingTag) {
      return next(new ErrorResponse('Bu isimde bir etiket zaten mevcut', 400));
    }

    tag.name = name;
  }

  // Diğer alanları güncelle
  if (description !== undefined) tag.description = description;
  if (color !== undefined) tag.color = color;
  if (isActive !== undefined) tag.isActive = isActive;

  tag.updatedAt = Date.now();
  await tag.save();

  // Moderatör log kaydı (subreddit için)
  if (tag.scope === 'subreddit') {
    await ModLog.create({
      subreddit: tag.subreddit,
      action: 'tag_updated',
      moderator: req.user._id,
      details: `"${tag.name}" etiketi güncellendi`,
      data: { tagId: tag._id },
      timestamp: Date.now(),
    });
  }

  res.status(200).json({
    success: true,
    data: tag,
  });
});

/**
 * @desc    Etiket sil
 * @route   DELETE /api/tags/:id (site geneli) veya /api/subreddits/:subredditId/tags/:id (subreddit özelinde)
 * @access  Admin (site geneli) / Moderatör (subreddit özelinde)
 */
const deleteTag = asyncHandler(async (req, res, next) => {
  const { id, subredditId } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz Tag ID formatı', 400));
  }

  // Sorgu parametrelerini oluştur
  const query = { _id: id };

  if (subredditId) {
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
      return next(new ErrorResponse('Bu işlem için moderatör yetkiniz yok', 403));
    }

    query.scope = 'subreddit';
    query.subreddit = subredditId;
  } else {
    // Site geneli için admin kontrolü
    if (req.user.role !== 'admin') {
      return next(
        new ErrorResponse('Site geneli etiket silmek için admin yetkisi gereklidir', 403),
      );
    }

    query.scope = 'site';
  }

  // Etiketi bul
  const tag = await Tag.findOne(query);

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  // Etiketin kullanımda olup olmadığını kontrol et
  const postCount = await Post.countDocuments({ tags: tag._id });

  if (postCount > 0) {
    // Etiketi silmek yerine pasif yap
    tag.isActive = false;
    tag.updatedAt = Date.now();
    await tag.save();

    // Moderatör log kaydı (subreddit için)
    if (tag.scope === 'subreddit') {
      await ModLog.create({
        subreddit: tag.subreddit,
        action: 'tag_deactivated',
        moderator: req.user._id,
        details: `"${tag.name}" etiketi kullanımda olduğu için pasif yapıldı`,
        data: { tagId: tag._id },
        timestamp: Date.now(),
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Etiket kullanımda olduğu için silinmek yerine pasif yapıldı',
      data: tag,
    });
  }

  // Etiketi sil
  await tag.remove();

  // Moderatör log kaydı (subreddit için)
  if (tag.scope === 'subreddit') {
    await ModLog.create({
      subreddit: tag.subreddit,
      action: 'tag_deleted',
      moderator: req.user._id,
      details: `"${tag.name}" etiketi silindi`,
      timestamp: Date.now(),
    });
  }

  res.status(200).json({
    success: true,
    message: 'Etiket başarıyla silindi',
    data: {},
  });
});

/**
 * @desc    Popüler etiketleri getir
 * @route   GET /api/tags/popular (site geneli) veya /api/subreddits/:subredditId/tags/popular (subreddit özelinde)
 * @access  Herkese Açık
 */
const getPopularTags = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { limit = 10 } = req.query;

  // Pipeline başlangıcı
  const pipeline = [];

  // Match stage
  const matchStage = { isActive: true };

  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
    }

    // Subreddit'in varlığını kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    matchStage.scope = 'subreddit';
    matchStage.subreddit = mongoose.Types.ObjectId(subredditId);
  } else {
    matchStage.scope = 'site';
  }

  pipeline.push({ $match: matchStage });

  // Lookup stage - post sayısını bul
  pipeline.push({
    $lookup: {
      from: 'posts',
      localField: '_id',
      foreignField: 'tags',
      as: 'posts',
    },
  });

  // Etiket kullanım sayısı ekle
  pipeline.push({
    $addFields: {
      postCount: { $size: '$posts' },
    },
  });

  // Posts alanını temizle (memory kullanımı için)
  pipeline.push({
    $project: {
      posts: 0,
    },
  });

  // Kullanım sayısına göre sırala
  pipeline.push({
    $sort: { postCount: -1 },
  });

  // Limit uygula
  pipeline.push({
    $limit: parseInt(limit),
  });

  // Etiket oluşturanı popüle et
  pipeline.push({
    $lookup: {
      from: 'users',
      localField: 'createdBy',
      foreignField: '_id',
      as: 'createdBy',
    },
  });

  pipeline.push({
    $unwind: {
      path: '$createdBy',
      preserveNullAndEmptyArrays: true,
    },
  });

  // createdBy için sadece gerekli alanları seç
  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      description: 1,
      color: 1,
      scope: 1,
      subreddit: 1,
      isActive: 1,
      createdAt: 1,
      updatedAt: 1,
      postCount: 1,
      'createdBy._id': 1,
      'createdBy.username': 1,
    },
  });

  // Aggregation çalıştır
  const tags = await Tag.aggregate(pipeline);

  res.status(200).json({
    success: true,
    count: tags.length,
    data: tags,
  });
});

/**
 * @desc    Etiket arama
 * @route   GET /api/tags/search (site geneli) veya /api/subreddits/:subredditId/tags/search (subreddit özelinde)
 * @access  Herkese Açık
 */
const searchTags = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { query, limit = 10 } = req.query;

  if (!query) {
    return next(new ErrorResponse('Arama sorgusu gereklidir', 400));
  }

  // Sorgu parametrelerini oluştur
  const searchQuery = {
    name: { $regex: query, $options: 'i' },
    isActive: true,
  };

  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
    }

    // Subreddit'in varlığını kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    searchQuery.scope = 'subreddit';
    searchQuery.subreddit = subredditId;
  } else {
    searchQuery.scope = 'site';
  }

  // Etiketleri ara
  const tags = await Tag.find(searchQuery)
    .sort({ name: 1 })
    .limit(parseInt(limit))
    .populate('createdBy', 'username');

  res.status(200).json({
    success: true,
    count: tags.length,
    data: tags,
  });
});

/**
 * @desc    Etikete göre post'ları getir
 * @route   GET /api/tags/:id/posts (site geneli) veya /api/subreddits/:subredditId/tags/:id/posts (subreddit özelinde)
 * @access  Herkese Açık
 */
const getPostsByTag = asyncHandler(async (req, res, next) => {
  const { id, subredditId } = req.params;

  // Geçerli bir ObjectId mi kontrol et
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz Tag ID formatı', 400));
  }

  // Sorgu parametrelerini oluştur
  const query = { _id: id, isActive: true };

  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz Subreddit ID formatı', 400));
    }

    // Subreddit'in varlığını kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    query.scope = 'subreddit';
    query.subreddit = subredditId;
  } else {
    query.scope = 'site';
  }

  // Etiketi kontrol et
  const tag = await Tag.findOne(query);

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  // Sayfalama için parametreleri al
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Sıralama parametrelerini al
  const { sortBy = 'createdAt', order = 'desc' } = req.query;

  // Post sorgusu
  const postQuery = {
    tags: tag._id,
    status: 'approved',
  };

  // Spesifik subreddit sorgusu
  if (subredditId) {
    postQuery.subreddit = subredditId;
  }

  // Toplam kayıt sayısını al
  const total = await Post.countDocuments(postQuery);

  // Sıralama seçenekleri
  const sortOptions = {};
  sortOptions[sortBy] = order === 'asc' ? 1 : -1;

  // Post'ları getir
  const posts = await Post.find(postQuery)
    .sort(sortOptions)
    .skip(startIndex)
    .limit(limit)
    .populate('author', 'username displayName avatar')
    .populate('subreddit', 'name title type');

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
    count: posts.length,
    total,
    pagination,
    data: {
      tag,
      posts,
    },
  });
});

module.exports = {
  createTag,
  getTags,
  getTag,
  updateTag,
  deleteTag,
  getPopularTags,
  searchTags,
  getPostsByTag,
};
