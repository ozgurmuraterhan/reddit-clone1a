const Tag = require('../models/Tag');
const TaggedItem = require('../models/TaggedItem'); // Assuming this model exists
const SubredditMembership = require('../models/SubredditMembership'); // Assuming this model exists
const Subreddit = require('../models/Subreddit');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Tüm etiketleri getir
 * @route   GET /api/tags
 * @route   GET /api/subreddits/:subredditId/tags
 * @access  Public
 */
const getTags = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Filtreleme seçenekleri
  let filter = { isActive: true };

  // Subreddit belirtilmişse, o subreddit'e özel etiketleri getir
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Scope: subreddit olan ve belirtilen subreddit'e ait etiketler
    filter.scope = 'subreddit';
    filter.subreddit = subredditId;
  } else {
    // Belirli bir subreddit belirtilmemişse, site geneli etiketleri getir
    filter.scope = 'site';
  }

  // Arama özelliği
  if (req.query.search) {
    filter.name = { $regex: req.query.search, $options: 'i' };
  }

  // Sadece aktif etiketleri mi yoksa tümünü mü?
  if (req.query.includeInactive === 'true' && req.user) {
    // Admin veya moderatör ise, aktif olmayan etiketleri de gösterebilir
    const isAdmin = req.user.role === 'admin';
    const isModerator = subredditId
      ? await checkModeratorPermission(req.user._id, subredditId)
      : false;

    if (isAdmin || isModerator) {
      delete filter.isActive;
    }
  }

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Etiketleri getir
  const total = await Tag.countDocuments(filter);
  const tags = await Tag.find(filter)
    .skip(startIndex)
    .limit(limit)
    .sort({ name: 1 })
    .populate('createdBy', 'username')
    .populate('subreddit', 'name title');

  // Eğer talep edilirse, etiketli öğelerin sayısını getir
  if (req.query.withItemCount === 'true') {
    // Her etiket için etiketli öğe sayısını getir
    const tagsWithCount = await Promise.all(
      tags.map(async (tag) => {
        const count = await TaggedItem.countDocuments({ tag: tag._id });
        const tagObj = tag.toObject();
        tagObj.itemCount = count;
        return tagObj;
      }),
    );

    res.status(200).json({
      success: true,
      count: total,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      data: tagsWithCount,
    });
  } else {
    res.status(200).json({
      success: true,
      count: total,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      data: tags,
    });
  }
});

/**
 * @desc    Tek bir etiketi getir
 * @route   GET /api/tags/:id
 * @access  Public
 */
const getTag = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz etiket ID formatı', 400));
  }

  const tag = await Tag.findById(id)
    .populate('createdBy', 'username')
    .populate('subreddit', 'name title');

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  // Etiket aktif değilse, sadece admin veya moderatör görebilir
  if (!tag.isActive) {
    if (!req.user) {
      return next(new ErrorResponse('Bu kaynağa erişim için yetkiniz yok', 403));
    }

    const isAdmin = req.user.role === 'admin';
    const isModerator =
      tag.scope === 'subreddit' && tag.subreddit
        ? await checkModeratorPermission(req.user._id, tag.subreddit)
        : false;

    if (!isAdmin && !isModerator) {
      return next(new ErrorResponse('Bu kaynağa erişim için yetkiniz yok', 403));
    }
  }

  // Etiketli öğelerin sayısını getir
  const itemCount = await TaggedItem.countDocuments({ tag: id });

  // Cevabı hazırla
  const tagResponse = tag.toObject();
  tagResponse.itemCount = itemCount;

  res.status(200).json({
    success: true,
    data: tagResponse,
  });
});

/**
 * @desc    Yeni etiket oluştur
 * @route   POST /api/tags
 * @route   POST /api/subreddits/:subredditId/tags
 * @access  Private (Admin for site, Moderator for subreddit)
 */
const createTag = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;

  // İstek gövdesini hazırla
  const tagData = {
    ...req.body,
    createdBy: userId,
  };

  // Subreddit belirtilmişse
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Subreddit'in var olduğunu kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Moderatör yetkisini kontrol et
    const isModerator = await checkModeratorPermission(userId, subredditId);
    if (!isModerator) {
      return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
    }

    // Scope'u ve subreddit'i ayarla
    tagData.scope = 'subreddit';
    tagData.subreddit = subredditId;
  } else {
    // Site geneli etiket oluşturuluyor, admin yetkisi gerekli
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
    }

    // Scope'u ayarla
    tagData.scope = 'site';
  }

  // Etiketin benzersiz olup olmadığını kontrol et
  const existingTag = await Tag.findOne({
    name: tagData.name,
    scope: tagData.scope,
    subreddit: tagData.subreddit || null,
  });

  if (existingTag) {
    return next(new ErrorResponse('Bu isimde bir etiket zaten mevcut', 400));
  }

  // Etiketi oluştur
  const tag = await Tag.create(tagData);

  res.status(201).json({
    success: true,
    data: tag,
  });
});

/**
 * @desc    Etiketi güncelle
 * @route   PUT /api/tags/:id
 * @access  Private (Admin for site, Moderator for subreddit)
 */
const updateTag = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz etiket ID formatı', 400));
  }

  // Etiketi bul
  const tag = await Tag.findById(id);

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  // Yetki kontrolü
  if (tag.scope === 'site') {
    // Site geneli etiket, admin yetkisi gerekli
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
    }
  } else {
    // Subreddit etiketi, moderatör yetkisi gerekli
    const isModerator = await checkModeratorPermission(userId, tag.subreddit);
    if (!isModerator) {
      return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
    }
  }

  // Güncelleme verilerini hazırla
  const updateData = {};

  // İzin verilen alanlar
  const allowedFields = ['name', 'color', 'description', 'isActive'];

  // Scope ve subreddit değiştirilemez, koruma
  if (req.body.scope) delete req.body.scope;
  if (req.body.subreddit) delete req.body.subreddit;

  // Veriyi temizle
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  // İsim değişiyorsa, benzersizliği kontrol et
  if (updateData.name && updateData.name !== tag.name) {
    const existingTag = await Tag.findOne({
      name: updateData.name,
      scope: tag.scope,
      subreddit: tag.subreddit || null,
    });

    if (existingTag) {
      return next(new ErrorResponse('Bu isimde bir etiket zaten mevcut', 400));
    }
  }

  // Güncelle
  const updatedTag = await Tag.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    data: updatedTag,
  });
});

/**
 * @desc    Etiketi sil
 * @route   DELETE /api/tags/:id
 * @access  Private (Admin for site, Moderator for subreddit)
 */
const deleteTag = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz etiket ID formatı', 400));
  }

  // Etiketi bul
  const tag = await Tag.findById(id);

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  // Yetki kontrolü
  if (tag.scope === 'site') {
    // Site geneli etiket, admin yetkisi gerekli
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
    }
  } else {
    // Subreddit etiketi, moderatör yetkisi gerekli
    const isModerator = await checkModeratorPermission(userId, tag.subreddit);
    if (!isModerator) {
      return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
    }
  }

  // Etiket ile ilişkili etiketlenmiş öğeleri kontrol et
  const taggedItemCount = await TaggedItem.countDocuments({ tag: id });

  // Eğer etiketlenmiş öğeler varsa, hard delete yerine soft delete yap
  if (taggedItemCount > 0) {
    tag.isActive = false;
    await tag.save();

    return res.status(200).json({
      success: true,
      message: `Etiket pasifleştirildi. ${taggedItemCount} öğe ile ilişkili olduğu için tamamen silinmedi.`,
      data: {},
    });
  }

  // İlişkili öğe yoksa tamamen sil
  await tag.remove();

  res.status(200).json({
    success: true,
    message: 'Etiket başarıyla silindi',
    data: {},
  });
});

/**
 * @desc    Etikete ait etiketlenmiş öğeleri getir
 * @route   GET /api/tags/:id/items
 * @access  Public
 */
const getTaggedItems = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz etiket ID formatı', 400));
  }

  // Etiketi bul
  const tag = await Tag.findById(id);

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  // Etiket aktif değilse, sadece admin veya moderatör görebilir
  if (!tag.isActive) {
    if (!req.user) {
      return next(new ErrorResponse('Bu kaynağa erişim için yetkiniz yok', 403));
    }

    const isAdmin = req.user.role === 'admin';
    const isModerator =
      tag.scope === 'subreddit' && tag.subreddit
        ? await checkModeratorPermission(req.user._id, tag.subreddit)
        : false;

    if (!isAdmin && !isModerator) {
      return next(new ErrorResponse('Bu kaynağa erişim için yetkiniz yok', 403));
    }
  }

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Filtreleme seçenekleri
  const filter = { tag: id };

  // İçerik tipine göre filtreleme
  if (req.query.itemType) {
    filter.itemType = req.query.itemType;
  }

  // Tarih aralığına göre filtreleme
  if (req.query.startDate) {
    filter.createdAt = { $gte: new Date(req.query.startDate) };
  }

  if (req.query.endDate) {
    if (!filter.createdAt) filter.createdAt = {};
    filter.createdAt.$lte = new Date(req.query.endDate);
  }

  // Toplam sayı
  const total = await TaggedItem.countDocuments(filter);

  // Etiketli öğeleri getir
  const taggedItems = await TaggedItem.find(filter)
    .skip(startIndex)
    .limit(limit)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'username')
    .populate({
      path: 'item',
      select: 'title content createdAt',
      populate: {
        path: 'author',
        select: 'username',
      },
    });

  res.status(200).json({
    success: true,
    count: total,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    data: taggedItems,
  });
});

/**
 * @desc    Popüler etiketleri getir
 * @route   GET /api/tags/popular
 * @route   GET /api/subreddits/:subredditId/tags/popular
 * @access  Public
 */
const getPopularTags = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const limit = parseInt(req.query.limit, 10) || 10;

  // Pipeline oluştur
  const lookupStage = {
    $lookup: {
      from: 'taggeditems',
      localField: '_id',
      foreignField: 'tag',
      as: 'items',
    },
  };

  const matchStage = {
    $match: {
      isActive: true,
    },
  };

  // Subreddit belirtilmişse, o subreddit'e özel etiketleri getir
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    matchStage.$match.scope = 'subreddit';
    matchStage.$match.subreddit = mongoose.Types.ObjectId(subredditId);
  } else {
    matchStage.$match.scope = 'site';
  }

  // Son X gün içindeki popülerliği hesapla
  const daysAgo = parseInt(req.query.days, 10) || 30;
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - daysAgo);

  // Pipeline'ı oluştur
  const pipeline = [
    matchStage,
    lookupStage,
    {
      $addFields: {
        recentItems: {
          $filter: {
            input: '$items',
            as: 'item',
            cond: { $gte: ['$$item.createdAt', dateLimit] },
          },
        },
        totalItems: { $size: '$items' },
      },
    },
    {
      $addFields: {
        recentItemCount: { $size: '$recentItems' },
      },
    },
    {
      $project: {
        _id: 1,
        name: 1,
        color: 1,
        description: 1,
        scope: 1,
        subreddit: 1,
        totalItems: 1,
        recentItemCount: 1,
      },
    },
    {
      $sort: { recentItemCount: -1, totalItems: -1, name: 1 },
    },
    {
      $limit: limit,
    },
  ];

  // Aggregation çalıştır
  const popularTags = await Tag.aggregate(pipeline);

  // Subreddit bilgilerini getir (varsa)
  if (subredditId) {
    const subreddit = await Subreddit.findById(subredditId, 'name title');

    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    res.status(200).json({
      success: true,
      count: popularTags.length,
      subreddit: {
        _id: subreddit._id,
        name: subreddit.name,
        title: subreddit.title,
      },
      data: popularTags,
    });
  } else {
    res.status(200).json({
      success: true,
      count: popularTags.length,
      data: popularTags,
    });
  }
});

/**
 * @desc    Bir öğeyi etiketle
 * @route   POST /api/tags/:id/items
 * @access  Private
 */
const tagItem = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { itemId, itemType } = req.body;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(itemId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Etiketi bul
  const tag = await Tag.findById(id);

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  if (!tag.isActive) {
    return next(new ErrorResponse('Pasif etiketler kullanılamaz', 400));
  }

  // Öğe tipini doğrula
  const validItemTypes = ['post', 'comment', 'subreddit', 'user'];
  if (!validItemTypes.includes(itemType)) {
    return next(new ErrorResponse('Geçersiz öğe tipi', 400));
  }

  // Öğenin varlığını kontrol et
  let Model;
  switch (itemType) {
    case 'post':
      Model = mongoose.model('Post');
      break;
    case 'comment':
      Model = mongoose.model('Comment');
      break;
    case 'subreddit':
      Model = mongoose.model('Subreddit');
      break;
    case 'user':
      Model = mongoose.model('User');
      break;
  }

  const item = await Model.findById(itemId);
  if (!item) {
    return next(new ErrorResponse(`${itemType} bulunamadı`, 404));
  }

  // Yetki kontrolü - öğe tipine göre değişir
  let hasPermission = false;

  if (itemType === 'post' || itemType === 'comment') {
    // Kendi içeriği veya moderatör ise etiketleyebilir
    if (item.author && item.author.toString() === userId.toString()) {
      hasPermission = true;
    } else if (item.subreddit) {
      hasPermission = await checkModeratorPermission(userId, item.subreddit);
    }
  } else if (itemType === 'subreddit') {
    // Subreddit'i sadece moderatörler etiketleyebilir
    hasPermission = await checkModeratorPermission(userId, item._id);
  } else if (itemType === 'user') {
    // Kullanıcılar sadece kendilerini etiketleyebilir
    hasPermission = item._id.toString() === userId.toString();
  }

  // Admin her zaman etiketleyebilir
  const user = await mongoose.model('User').findById(userId);
  if (user && user.role === 'admin') {
    hasPermission = true;
  }

  if (!hasPermission) {
    return next(new ErrorResponse('Bu öğeyi etiketleme yetkiniz yok', 403));
  }

  // Zaten etiketli mi kontrol et
  const existingTag = await TaggedItem.findOne({
    tag: id,
    item: itemId,
    itemType: itemType,
  });

  if (existingTag) {
    return next(new ErrorResponse('Bu öğe zaten bu etiketle etiketlenmiş', 400));
  }

  // Yeni etiketleme oluştur
  const taggedItem = await TaggedItem.create({
    tag: id,
    item: itemId,
    itemType: itemType,
    createdBy: userId,
  });

  res.status(201).json({
    success: true,
    data: taggedItem,
  });
});

/**
 * @desc    Bir öğeden etiketi kaldır
 * @route   DELETE /api/tags/:id/items/:itemId
 * @access  Private
 */
const removeTag = asyncHandler(async (req, res, next) => {
  const { id, itemId } = req.params;
  const { itemType } = req.query;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(itemId)) {
    return next(new ErrorResponse('Geçersiz ID formatı', 400));
  }

  // Öğe tipini doğrula
  const validItemTypes = ['post', 'comment', 'subreddit', 'user'];
  if (!validItemTypes.includes(itemType)) {
    return next(new ErrorResponse('Geçersiz öğe tipi', 400));
  }

  // Etiketlemeyi bul
  const taggedItem = await TaggedItem.findOne({
    tag: id,
    item: itemId,
    itemType: itemType,
  }).populate('tag');

  if (!taggedItem) {
    return next(new ErrorResponse('Etiketleme bulunamadı', 404));
  }

  // Yetki kontrolü
  let hasPermission = false;

  // Etiketlemeyi yapan kişi kaldırabilir
  if (taggedItem.createdBy && taggedItem.createdBy.toString() === userId.toString()) {
    hasPermission = true;
  } else {
    // Öğe tipine göre yetki kontrolü
    if (itemType === 'post' || itemType === 'comment') {
      const item = await mongoose.model(itemType === 'post' ? 'Post' : 'Comment').findById(itemId);

      if (item && item.author && item.author.toString() === userId.toString()) {
        hasPermission = true;
      } else if (item && item.subreddit) {
        hasPermission = await checkModeratorPermission(userId, item.subreddit);
      }
    } else if (itemType === 'subreddit') {
      hasPermission = await checkModeratorPermission(userId, itemId);
    } else if (itemType === 'user') {
      hasPermission = itemId.toString() === userId.toString();
    }
  }

  // Admin her zaman kaldırabilir
  const user = await mongoose.model('User').findById(userId);
  if (user && user.role === 'admin') {
    hasPermission = true;
  }

  if (!hasPermission) {
    return next(new ErrorResponse('Bu etiketi kaldırma yetkiniz yok', 403));
  }

  // Etiketi kaldır
  await taggedItem.remove();

  res.status(200).json({
    success: true,
    message: 'Etiket başarıyla kaldırıldı',
    data: {},
  });
});

/**
 * @desc    Toplu etiket işlemi (yeni etiketler oluştur)
 * @route   POST /api/tags/bulk
 * @route   POST /api/subreddits/:subredditId/tags/bulk
 * @access  Private (Admin for site, Moderator for subreddit)
 */
const createTagsBulk = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;
  const { tags } = req.body;

  if (!Array.isArray(tags) || tags.length === 0) {
    return next(new ErrorResponse('Geçerli bir etiket dizisi gereklidir', 400));
  }

  if (tags.length > 50) {
    return next(new ErrorResponse('Bir seferde en fazla 50 etiket oluşturulabilir', 400));
  }

  // Yetki kontrolü
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Subreddit'in var olduğunu kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Moderatör yetkisini kontrol et
    const isModerator = await checkModeratorPermission(userId, subredditId);
    if (!isModerator) {
      return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
    }
  } else {
    // Site geneli etiket oluşturuluyor, admin yetkisi gerekli
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
    }
  }

  // Etiketleri hazırla
  const tagsToCreate = tags.map((tag) => ({
    name: tag.name,
    color: tag.color || '#6e6e6e',
    description: tag.description || '',
    scope: subredditId ? 'subreddit' : 'site',
    subreddit: subredditId || null,
    createdBy: userId,
  }));

  // Mevcut etiketleri kontrol et
  const existingTags = await Tag.find({
    name: { $in: tagsToCreate.map((t) => t.name) },
    scope: subredditId ? 'subreddit' : 'site',
    subreddit: subredditId || null,
  });

  // Zaten var olan etiketleri filtrele
  const existingTagNames = existingTags.map((t) => t.name);
  const newTags = tagsToCreate.filter((t) => !existingTagNames.includes(t.name));

  // Yeni etiketleri oluştur
  const createdTags = await Tag.insertMany(newTags);

  res.status(201).json({
    success: true,
    message: `${createdTags.length} yeni etiket oluşturuldu. ${existingTagNames.length} etiket zaten mevcut.`,
    created: createdTags,
    existing: existingTags,
  });
});

/**
 * @desc    Toplu etiket silme işlemi
 * @route   DELETE /api/tags/bulk
 * @access  Private (Admin only)
 */
const deleteTagsBulk = asyncHandler(async (req, res, next) => {
  const { ids } = req.body;
  const userId = req.user._id;

  // Admin yetkisi kontrolü
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin) {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return next(new ErrorResponse('Geçerli bir etiket ID dizisi gereklidir', 400));
  }

  if (ids.length > 50) {
    return next(new ErrorResponse('Bir seferde en fazla 50 etiket silinebilir', 400));
  }

  // ID formatlarını kontrol et
  const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length !== ids.length) {
    return next(new ErrorResponse("Bir veya daha fazla geçersiz etiket ID'si", 400));
  }

  // Etiketleri bul
  const tags = await Tag.find({ _id: { $in: validIds } });

  if (tags.length === 0) {
    return next(new ErrorResponse('Hiçbir etiket bulunamadı', 404));
  }

  // Her etiket için etiketli öğe sayısını kontrol et
  const tagItemCounts = await Promise.all(
    tags.map(async (tag) => {
      const count = await TaggedItem.countDocuments({ tag: tag._id });
      return { tag: tag._id, count };
    }),
  );

  // Etiketleri ayır: tamamen silinecekler ve pasifleştirilecekler
  const tagsToDelete = [];
  const tagsToDeactivate = [];

  tagItemCounts.forEach(({ tag, count }) => {
    if (count === 0) {
      tagsToDelete.push(tag);
    } else {
      tagsToDeactivate.push({ tag, count });
    }
  });

  // Hiç etiketli öğesi olmayanları tamamen sil
  if (tagsToDelete.length > 0) {
    await Tag.deleteMany({ _id: { $in: tagsToDelete } });
  }

  // Etiketli öğeleri olanları pasifleştir
  if (tagsToDeactivate.length > 0) {
    await Tag.updateMany({ _id: { $in: tagsToDeactivate.map((t) => t.tag) } }, { isActive: false });
  }

  res.status(200).json({
    success: true,
    message: `${tagsToDelete.length} etiket silindi, ${tagsToDeactivate.length} etiket pasifleştirildi.`,
    deleted: tagsToDelete,
    deactivated: tagsToDeactivate,
  });
});

/**
 * @desc    Etiket rengini güncelle
 * @route   PATCH /api/tags/:id/color
 * @access  Private (Admin for site, Moderator for subreddit)
 */
const updateTagColor = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { color } = req.body;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz etiket ID formatı', 400));
  }

  // Renk formatını doğrula
  if (!color || !isValidHexColor(color)) {
    return next(new ErrorResponse('Geçerli bir hex renk kodu gereklidir (örn. #FF5733)', 400));
  }

  // Etiketi bul
  const tag = await Tag.findById(id);

  if (!tag) {
    return next(new ErrorResponse('Etiket bulunamadı', 404));
  }

  // Yetki kontrolü
  if (tag.scope === 'site') {
    // Site geneli etiket, admin yetkisi gerekli
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      return next(new ErrorResponse('Bu işlem için admin yetkisi gerekiyor', 403));
    }
  } else {
    // Subreddit etiketi, moderatör yetkisi gerekli
    const isModerator = await checkModeratorPermission(userId, tag.subreddit);
    if (!isModerator) {
      return next(new ErrorResponse('Bu işlem için moderatör yetkisi gerekiyor', 403));
    }
  }

  // Rengi güncelle
  tag.color = color;
  await tag.save();

  res.status(200).json({
    success: true,
    data: tag,
  });
});

/**
 * @desc    Etiket istatistiklerini getir
 * @route   GET /api/tags/stats
 * @route   GET /api/subreddits/:subredditId/tags/stats
 * @access  Public
 */
const getTagStats = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  // Match koşulları
  const matchStage = { isActive: true };

  // Subreddit belirtilmişse
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Subreddit'in var olduğunu kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    matchStage.scope = 'subreddit';
    matchStage.subreddit = mongoose.Types.ObjectId(subredditId);
  } else {
    matchStage.scope = 'site';
  }

  // Aggregation pipeline
  const stats = await Tag.aggregate([
    {
      $match: matchStage,
    },
    {
      $lookup: {
        from: 'taggeditems',
        localField: '_id',
        foreignField: 'tag',
        as: 'items',
      },
    },
    {
      $addFields: {
        itemCount: { $size: '$items' },
        postCount: {
          $size: {
            $filter: {
              input: '$items',
              as: 'item',
              cond: { $eq: ['$$item.itemType', 'post'] },
            },
          },
        },
        commentCount: {
          $size: {
            $filter: {
              input: '$items',
              as: 'item',
              cond: { $eq: ['$$item.itemType', 'comment'] },
            },
          },
        },
        subredditCount: {
          $size: {
            $filter: {
              input: '$items',
              as: 'item',
              cond: { $eq: ['$$item.itemType', 'subreddit'] },
            },
          },
        },
        userCount: {
          $size: {
            $filter: {
              input: '$items',
              as: 'item',
              cond: { $eq: ['$$item.itemType', 'user'] },
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        name: 1,
        color: 1,
        description: 1,
        scope: 1,
        subreddit: 1,
        itemCount: 1,
        postCount: 1,
        commentCount: 1,
        subredditCount: 1,
        userCount: 1,
      },
    },
    {
      $sort: { itemCount: -1, name: 1 },
    },
  ]);

  // Toplam istatistikleri hesapla
  const totalTags = stats.length;
  const totalTaggedItems = stats.reduce((sum, tag) => sum + tag.itemCount, 0);
  const totalPostTags = stats.reduce((sum, tag) => sum + tag.postCount, 0);
  const totalCommentTags = stats.reduce((sum, tag) => sum + tag.commentCount, 0);

  res.status(200).json({
    success: true,
    summary: {
      totalTags,
      totalTaggedItems,
      totalPostTags,
      totalCommentTags,
    },
    data: stats,
  });
});

// ==================== YARDIMCI FONKSİYONLAR ====================

/**
 * Moderatör yetkisini kontrol et
 * @param {ObjectId} userId - Kullanıcı ID
 * @param {ObjectId} subredditId - Subreddit ID
 * @returns {Promise<Boolean>} Moderatör yetkisi varsa true
 */
const checkModeratorPermission = async (userId, subredditId) => {
  // Admin her zaman yetkilidir
  const user = await mongoose.model('User').findById(userId);
  if (user && user.role === 'admin') {
    return true;
  }

  // Subreddit moderatörü mü kontrol et
  const membership = await SubredditMembership.findOne({
    user: userId,
    subreddit: subredditId,
    type: { $in: ['moderator', 'admin'] },
    status: 'active',
  });

  return !!membership;
};

/**
 * Geçerli bir hex renk kodu mu kontrol et
 * @param {String} color - Renk kodu
 * @returns {Boolean} Geçerli ise true
 */
const isValidHexColor = (color) => {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
};

module.exports = {
  getTags,
  getTag,
  createTag,
  updateTag,
  deleteTag,
  getTaggedItems,
  getPopularTags,
  tagItem,
  removeTag,
  createTagsBulk,
  deleteTagsBulk,
  updateTagColor,
  getTagStats,
};
