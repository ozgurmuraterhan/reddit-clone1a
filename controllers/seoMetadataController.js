const SEOMetadata = require('../models/SEOMetadata');
const Post = require('../models/Post');
const Subreddit = require('../models/Subreddit');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
statisticsController.js;
/**
 * @desc    SEO metadatasını getir
 * @route   GET /api/seo-metadata/:id
 * @access  Private (Admin/Mod)
 */
const getSEOMetadataById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz metadata ID formatı', 400));
  }

  const metadata = await SEOMetadata.findById(id);

  if (!metadata) {
    return next(new ErrorResponse('SEO metadata bulunamadı', 404));
  }

  res.status(200).json({
    success: true,
    data: metadata,
  });
});

/**
 * @desc    İçerik tipine ve ID'ye göre SEO metadatasını getir
 * @route   GET /api/seo-metadata/:targetType/:targetId
 * @access  Private (Admin/Mod)
 */
const getSEOMetadataByTarget = asyncHandler(async (req, res, next) => {
  const { targetType, targetId } = req.params;

  // Geçerli içerik tipi kontrolü
  if (!['post', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz içerik tipi. "post" veya "subreddit" olmalıdır', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse('Geçersiz hedef ID formatı', 400));
  }

  // Hedefin var olup olmadığını kontrol et
  let targetExists = false;
  if (targetType === 'post') {
    targetExists = await Post.exists({ _id: targetId, isDeleted: false });
  } else if (targetType === 'subreddit') {
    targetExists = await Subreddit.exists({ _id: targetId, isDeleted: false });
  }

  if (!targetExists) {
    return next(new ErrorResponse(`Belirtilen ${targetType} bulunamadı`, 404));
  }

  // SEO metadatasını bul
  const query = { targetType };
  query[targetType] = targetId;

  const metadata = await SEOMetadata.findOne(query);

  if (!metadata) {
    return next(new ErrorResponse('Bu içerik için SEO metadata bulunamadı', 404));
  }

  res.status(200).json({
    success: true,
    data: metadata,
  });
});

/**
 * @desc    Yeni SEO metadata oluştur
 * @route   POST /api/seo-metadata
 * @access  Private (Admin/Mod)
 */
const createSEOMetadata = asyncHandler(async (req, res, next) => {
  const {
    targetType,
    post,
    subreddit,
    title,
    description,
    keywords,
    ogImage,
    ogTitle,
    ogDescription,
    twitterCard,
    canonicalUrl,
    robots,
  } = req.body;

  // Geçerli içerik tipi kontrolü
  if (!['post', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz içerik tipi. "post" veya "subreddit" olmalıdır', 400));
  }

  // İçerik tipine göre hedef ID'yi kontrol et
  const targetId = targetType === 'post' ? post : subreddit;

  if (!targetId) {
    return next(new ErrorResponse(`${targetType} ID'si gereklidir`, 400));
  }

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse('Geçersiz hedef ID formatı', 400));
  }

  // Hedefin var olup olmadığını kontrol et
  let targetExists = false;
  let targetData = null;

  if (targetType === 'post') {
    targetData = await Post.findOne({ _id: targetId, isDeleted: false })
      .select('title content subreddit')
      .populate('subreddit', 'name');

    targetExists = !!targetData;
  } else if (targetType === 'subreddit') {
    targetData = await Subreddit.findOne({ _id: targetId, isDeleted: false }).select(
      'name title description',
    );

    targetExists = !!targetData;
  }

  if (!targetExists) {
    return next(new ErrorResponse(`Belirtilen ${targetType} bulunamadı`, 404));
  }

  // Mevcut metadata kontrolü
  const existingQuery = { targetType };
  existingQuery[targetType] = targetId;

  const existingMetadata = await SEOMetadata.findOne(existingQuery);

  if (existingMetadata) {
    return next(
      new ErrorResponse(
        'Bu içerik için zaten SEO metadata var. Güncellemek için PUT isteği kullanın',
        400,
      ),
    );
  }

  // Metadata oluştur
  const metadataData = {
    targetType,
    [targetType]: targetId,
    title: title || generateDefaultTitle(targetType, targetData),
    description: description || generateDefaultDescription(targetType, targetData),
    keywords: keywords || [],
    ogImage,
    ogTitle: ogTitle || title || generateDefaultTitle(targetType, targetData),
    ogDescription:
      ogDescription || description || generateDefaultDescription(targetType, targetData),
    twitterCard: twitterCard || 'summary_large_image',
    canonicalUrl,
    robots: robots || 'index, follow',
  };

  const metadata = await SEOMetadata.create(metadataData);

  res.status(201).json({
    success: true,
    data: metadata,
    message: 'SEO metadata başarıyla oluşturuldu',
  });
});

/**
 * @desc    SEO metadatasını güncelle
 * @route   PUT /api/seo-metadata/:id
 * @access  Private (Admin/Mod)
 */
const updateSEOMetadata = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const {
    title,
    description,
    keywords,
    ogImage,
    ogTitle,
    ogDescription,
    twitterCard,
    canonicalUrl,
    robots,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz metadata ID formatı', 400));
  }

  // metadata'nın var olup olmadığını kontrol et
  const metadata = await SEOMetadata.findById(id);

  if (!metadata) {
    return next(new ErrorResponse('SEO metadata bulunamadı', 404));
  }

  // Yetki kontrolü (Admin, mod veya içerik sahibi)
  // Not: Gerçek bir uygulamada burada yetki kontrolü yapılmalıdır

  // Güncellenebilir alanlar
  const updatableFields = {
    title,
    description,
    keywords,
    ogImage,
    ogTitle,
    ogDescription,
    twitterCard,
    canonicalUrl,
    robots,
  };

  // Boş olmayan alanları güncelle
  Object.keys(updatableFields).forEach((key) => {
    if (updatableFields[key] !== undefined) {
      metadata[key] = updatableFields[key];
    }
  });

  // Son güncelleme zamanını ayarla
  metadata.updatedAt = Date.now();

  await metadata.save();

  res.status(200).json({
    success: true,
    data: metadata,
    message: 'SEO metadata başarıyla güncellendi',
  });
});

/**
 * @desc    İçerik tipine ve ID'ye göre SEO metadatasını güncelle
 * @route   PUT /api/seo-metadata/:targetType/:targetId
 * @access  Private (Admin/Mod)
 */
const updateSEOMetadataByTarget = asyncHandler(async (req, res, next) => {
  const { targetType, targetId } = req.params;
  const {
    title,
    description,
    keywords,
    ogImage,
    ogTitle,
    ogDescription,
    twitterCard,
    canonicalUrl,
    robots,
  } = req.body;

  // Geçerli içerik tipi kontrolü
  if (!['post', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz içerik tipi. "post" veya "subreddit" olmalıdır', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse('Geçersiz hedef ID formatı', 400));
  }

  // Hedefin var olup olmadığını kontrol et
  let targetExists = false;
  let targetData = null;

  if (targetType === 'post') {
    targetData = await Post.findOne({ _id: targetId, isDeleted: false })
      .select('title content subreddit')
      .populate('subreddit', 'name');

    targetExists = !!targetData;
  } else if (targetType === 'subreddit') {
    targetData = await Subreddit.findOne({ _id: targetId, isDeleted: false }).select(
      'name title description',
    );

    targetExists = !!targetData;
  }

  if (!targetExists) {
    return next(new ErrorResponse(`Belirtilen ${targetType} bulunamadı`, 404));
  }

  // Metadata'yı bul
  const query = { targetType };
  query[targetType] = targetId;

  let metadata = await SEOMetadata.findOne(query);

  // Eğer metadata yoksa oluştur
  if (!metadata) {
    const metadataData = {
      targetType,
      [targetType]: targetId,
      title: title || generateDefaultTitle(targetType, targetData),
      description: description || generateDefaultDescription(targetType, targetData),
      keywords: keywords || [],
      ogImage,
      ogTitle: ogTitle || title || generateDefaultTitle(targetType, targetData),
      ogDescription:
        ogDescription || description || generateDefaultDescription(targetType, targetData),
      twitterCard: twitterCard || 'summary_large_image',
      canonicalUrl,
      robots: robots || 'index, follow',
    };

    metadata = await SEOMetadata.create(metadataData);

    return res.status(201).json({
      success: true,
      data: metadata,
      message: 'SEO metadata başarıyla oluşturuldu',
    });
  }

  // Güncellenebilir alanlar
  const updatableFields = {
    title,
    description,
    keywords,
    ogImage,
    ogTitle,
    ogDescription,
    twitterCard,
    canonicalUrl,
    robots,
  };

  // Boş olmayan alanları güncelle
  Object.keys(updatableFields).forEach((key) => {
    if (updatableFields[key] !== undefined) {
      metadata[key] = updatableFields[key];
    }
  });

  // Son güncelleme zamanını ayarla
  metadata.updatedAt = Date.now();

  await metadata.save();

  res.status(200).json({
    success: true,
    data: metadata,
    message: 'SEO metadata başarıyla güncellendi',
  });
});

/**
 * @desc    SEO metadatasını sil
 * @route   DELETE /api/seo-metadata/:id
 * @access  Private (Admin/Mod)
 */
const deleteSEOMetadata = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz metadata ID formatı', 400));
  }

  const metadata = await SEOMetadata.findById(id);

  if (!metadata) {
    return next(new ErrorResponse('SEO metadata bulunamadı', 404));
  }

  await metadata.remove();

  res.status(200).json({
    success: true,
    data: {},
    message: 'SEO metadata başarıyla silindi',
  });
});

/**
 * @desc    Otomatik SEO metadata oluştur veya güncelle
 * @route   POST /api/seo-metadata/generate/:targetType/:targetId
 * @access  Private (Admin/Mod)
 */
const generateSEOMetadata = asyncHandler(async (req, res, next) => {
  const { targetType, targetId } = req.params;
  const { overwrite = false } = req.body;

  // Geçerli içerik tipi kontrolü
  if (!['post', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz içerik tipi. "post" veya "subreddit" olmalıdır', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse('Geçersiz hedef ID formatı', 400));
  }

  // Hedefin var olup olmadığını kontrol et
  let targetData = null;

  if (targetType === 'post') {
    targetData = await Post.findOne({ _id: targetId, isDeleted: false })
      .select('title content type url mediaUrl subreddit author createdAt')
      .populate('subreddit', 'name title')
      .populate('author', 'username');

    if (!targetData) {
      return next(new ErrorResponse('Post bulunamadı', 404));
    }
  } else if (targetType === 'subreddit') {
    targetData = await Subreddit.findOne({ _id: targetId, isDeleted: false }).select(
      'name title description sidebar icon banner memberCount createdAt',
    );

    if (!targetData) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }
  }

  // Mevcut metadata kontrolü
  const query = { targetType };
  query[targetType] = targetId;

  let metadata = await SEOMetadata.findOne(query);
  let isNewMetadata = false;

  if (!metadata) {
    isNewMetadata = true;
    metadata = new SEOMetadata({
      targetType,
      [targetType]: targetId,
    });
  }

  // Otomatik oluşturulan meta verileri
  const generatedMetadata = {
    title: generateDefaultTitle(targetType, targetData),
    description: generateDefaultDescription(targetType, targetData),
    keywords: generateKeywords(targetType, targetData),
    ogTitle: generateDefaultTitle(targetType, targetData),
    ogDescription: generateDefaultDescription(targetType, targetData),
    twitterCard: 'summary_large_image',
  };

  // Varsayılan URL ve resim ayarları
  if (targetType === 'post') {
    // OG image için post tipine göre farklı davran
    if (targetData.type === 'image') {
      generatedMetadata.ogImage = targetData.mediaUrl;
    } else if (targetData.type === 'link' && targetData.url) {
      // Link gönderileri için küçük resim çekme mantığı (gerçek uygulamada API'lerle genişletilebilir)
      generatedMetadata.ogImage = 'default-link-thumbnail.png';
    } else {
      generatedMetadata.ogImage = 'default-post-thumbnail.png';
    }

    // Canonical URL için post slugını kullan
    generatedMetadata.canonicalUrl = `${process.env.SITE_URL}/r/${targetData.subreddit.name}/comments/${targetData._id}/${targetData.slug || ''}`;
  } else if (targetType === 'subreddit') {
    // Subreddit için varsayılan OG image
    generatedMetadata.ogImage =
      targetData.banner || targetData.icon || 'default-subreddit-thumbnail.png';

    // Canonical URL için subreddit adını kullan
    generatedMetadata.canonicalUrl = `${process.env.SITE_URL}/r/${targetData.name}`;
  }

  // Eğer overwrite true ise veya alan boşsa güncelle
  Object.keys(generatedMetadata).forEach((key) => {
    if (overwrite || !metadata[key] || metadata[key].length === 0) {
      metadata[key] = generatedMetadata[key];
    }
  });

  // Son güncelleme zamanını ayarla
  metadata.updatedAt = Date.now();

  await metadata.save();

  res.status(isNewMetadata ? 201 : 200).json({
    success: true,
    data: metadata,
    message: isNewMetadata
      ? 'SEO metadata başarıyla oluşturuldu'
      : 'SEO metadata başarıyla güncellendi',
  });
});

/**
 * @desc    Toplu SEO metadata kontrolü ve güncellemesi
 * @route   POST /api/seo-metadata/bulk-update
 * @access  Private (Admin)
 */
const bulkUpdateSEOMetadata = asyncHandler(async (req, res, next) => {
  const { targetType, overwrite = false, limit = 50 } = req.body;

  // Geçerli içerik tipi kontrolü
  if (!['post', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz içerik tipi. "post" veya "subreddit" olmalıdır', 400));
  }

  // İçerik tipine göre eksik metadata olan öğeleri bul
  let targetItems = [];
  let existingMetadataIds = [];

  // Mevcut metadata ID'lerini bul
  const existingMetadata = await SEOMetadata.find({ targetType }).select(`${targetType}`);
  existingMetadataIds = existingMetadata.map((meta) => meta[targetType].toString());

  if (targetType === 'post') {
    // SEO metadata olmayan gönderileri bul
    targetItems = await Post.find({
      _id: { $nin: existingMetadataIds },
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('_id title content type url mediaUrl subreddit author createdAt')
      .populate('subreddit', 'name title')
      .populate('author', 'username');
  } else if (targetType === 'subreddit') {
    // SEO metadata olmayan subredditleri bul
    targetItems = await Subreddit.find({
      _id: { $nin: existingMetadataIds },
      isDeleted: false,
    })
      .sort({ memberCount: -1 })
      .limit(limit)
      .select('_id name title description sidebar icon banner memberCount createdAt');
  }

  if (targetItems.length === 0) {
    return res.status(200).json({
      success: true,
      message: `Tüm ${targetType} öğeleri için SEO metadata zaten var`,
      data: {
        processedCount: 0,
        createdCount: 0,
      },
    });
  }

  // Yeni metadata'ları oluştur
  const metadataToCreate = targetItems.map((item) => {
    const generatedMetadata = {
      targetType,
      [targetType]: item._id,
      title: generateDefaultTitle(targetType, item),
      description: generateDefaultDescription(targetType, item),
      keywords: generateKeywords(targetType, item),
      ogTitle: generateDefaultTitle(targetType, item),
      ogDescription: generateDefaultDescription(targetType, item),
    };

    // URL ve resim ayarları
    if (targetType === 'post') {
      // OG image için post tipine göre farklı davran
      if (item.type === 'image') {
        generatedMetadata.ogImage = item.mediaUrl;
      } else if (item.type === 'link' && item.url) {
        generatedMetadata.ogImage = 'default-link-thumbnail.png';
      } else {
        generatedMetadata.ogImage = 'default-post-thumbnail.png';
      }

      // Canonical URL için post slugını kullan
      generatedMetadata.canonicalUrl = `${process.env.SITE_URL}/r/${item.subreddit.name}/comments/${item._id}/${item.slug || ''}`;
    } else if (targetType === 'subreddit') {
      // Subreddit için varsayılan OG image
      generatedMetadata.ogImage = item.banner || item.icon || 'default-subreddit-thumbnail.png';

      // Canonical URL için subreddit adını kullan
      generatedMetadata.canonicalUrl = `${process.env.SITE_URL}/r/${item.name}`;
    }

    generatedMetadata.twitterCard = 'summary_large_image';
    generatedMetadata.robots = 'index, follow';
    generatedMetadata.createdAt = Date.now();
    generatedMetadata.updatedAt = Date.now();

    return generatedMetadata;
  });

  // Metadata'ları toplu olarak oluştur
  const createdMetadata = await SEOMetadata.insertMany(metadataToCreate);

  res.status(200).json({
    success: true,
    message: `${createdMetadata.length} adet SEO metadata başarıyla oluşturuldu`,
    data: {
      processedCount: targetItems.length,
      createdCount: createdMetadata.length,
    },
  });
});

/**
 * @desc    SEO durumunu analiz et
 * @route   GET /api/seo-metadata/analysis/:targetType/:targetId
 * @access  Private (Admin/Mod)
 */
const analyzeSEOStatus = asyncHandler(async (req, res, next) => {
  const { targetType, targetId } = req.params;

  // Geçerli içerik tipi kontrolü
  if (!['post', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz içerik tipi. "post" veya "subreddit" olmalıdır', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse('Geçersiz hedef ID formatı', 400));
  }

  // Hedefin var olup olmadığını kontrol et
  let targetData = null;

  if (targetType === 'post') {
    targetData = await Post.findOne({ _id: targetId, isDeleted: false })
      .select('title content type url mediaUrl subreddit author createdAt')
      .populate('subreddit', 'name title')
      .populate('author', 'username');

    if (!targetData) {
      return next(new ErrorResponse('Post bulunamadı', 404));
    }
  } else if (targetType === 'subreddit') {
    targetData = await Subreddit.findOne({ _id: targetId, isDeleted: false }).select(
      'name title description sidebar icon banner memberCount createdAt',
    );

    if (!targetData) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }
  }

  // Metadata'yı bul
  const query = { targetType };
  query[targetType] = targetId;

  const metadata = await SEOMetadata.findOne(query);

  // SEO değerlendirmesini yap
  const analysis = {
    hasMetadata: !!metadata,
    score: 0,
    issues: [],
    recommendations: [],
  };

  if (metadata) {
    // Title değerlendirmesi
    if (!metadata.title) {
      analysis.issues.push('SEO başlığı eksik');
      analysis.recommendations.push('SEO başlığı ekleyin');
    } else if (metadata.title.length < 30) {
      analysis.issues.push('SEO başlığı çok kısa');
      analysis.recommendations.push('Başlık en az 30 karakter olmalıdır');
    } else if (metadata.title.length > 60) {
      analysis.issues.push('SEO başlığı çok uzun');
      analysis.recommendations.push('Başlık 60 karakterden az olmalıdır');
    } else {
      analysis.score += 25;
    }

    // Description değerlendirmesi
    if (!metadata.description) {
      analysis.issues.push('SEO açıklaması eksik');
      analysis.recommendations.push('SEO açıklaması ekleyin');
    } else if (metadata.description.length < 70) {
      analysis.issues.push('SEO açıklaması çok kısa');
      analysis.recommendations.push('Açıklama en az 70 karakter olmalıdır');
    } else if (metadata.description.length > 155) {
      analysis.issues.push('SEO açıklaması çok uzun');
      analysis.recommendations.push('Açıklama 155 karakterden az olmalıdır');
    } else {
      analysis.score += 25;
    }

    // Keywords değerlendirmesi
    if (!metadata.keywords || metadata.keywords.length === 0) {
      analysis.issues.push('Anahtar kelimeler eksik');
      analysis.recommendations.push('Alakalı anahtar kelimeler ekleyin');
    } else if (metadata.keywords.length < 3) {
      analysis.issues.push('Çok az anahtar kelime');
      analysis.recommendations.push('En az 3-5 anahtar kelime ekleyin');
    } else {
      analysis.score += 15;
    }

    // OG Image değerlendirmesi
    if (!metadata.ogImage) {
      analysis.issues.push('Open Graph resmi eksik');
      analysis.recommendations.push('Sosyal medya paylaşımları için bir Open Graph resmi ekleyin');
    } else {
      analysis.score += 15;
    }

    // Canonical URL değerlendirmesi
    if (!metadata.canonicalUrl) {
      analysis.issues.push('Canonical URL eksik');
      analysis.recommendations.push(
        'İçerik çoğaltma sorunlarını önlemek için canonical URL ekleyin',
      );
    } else {
      analysis.score += 20;
    }
  } else {
    analysis.issues.push('SEO metadata mevcut değil');
    analysis.recommendations.push(`Bu ${targetType} için SEO metadata oluşturun`);
  }

  res.status(200).json({
    success: true,
    data: {
      metadata: metadata || null,
      analysis,
      targetData: {
        id: targetData._id,
        type: targetType,
        title: targetType === 'post' ? targetData.title : targetData.name,
        url:
          targetType === 'post'
            ? `/r/${targetData.subreddit.name}/comments/${targetData._id}`
            : `/r/${targetData.name}`,
      },
    },
  });
});

/**
 * @desc    Tüm SEO metadataları listele
 * @route   GET /api/seo-metadata
 * @access  Private (Admin)
 */
const getAllSEOMetadata = asyncHandler(async (req, res, next) => {
  const { targetType, search } = req.query;

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Filtreleme
  let query = {};

  if (targetType && ['post', 'subreddit'].includes(targetType)) {
    query.targetType = targetType;
  }

  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { keywords: { $regex: search, $options: 'i' } },
    ];
  }

  // Toplam metadata sayısını al
  const total = await SEOMetadata.countDocuments(query);

  // Metadataları getir
  const metadata = await SEOMetadata.find(query)
    .sort({ updatedAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate({
      path: 'post',
      select: 'title subreddit',
      populate: {
        path: 'subreddit',
        select: 'name',
      },
    })
    .populate('subreddit', 'name title');

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalResults: total,
  };

  if (startIndex + limit < total) {
    pagination.nextPage = page + 1;
  }

  if (startIndex > 0) {
    pagination.prevPage = page - 1;
  }

  res.status(200).json({
    success: true,
    data: metadata,
    pagination,
  });
});

// Yardımcı fonksiyonlar
/**
 * İçerik tipine göre varsayılan SEO başlığı oluşturur
 * @param {string} targetType - İçerik tipi ('post' veya 'subreddit')
 * @param {Object} data - Hedef içerik verisi
 * @returns {string} Oluşturulan başlık
 */
function generateDefaultTitle(targetType, data) {
  if (!data) return '';

  if (targetType === 'post') {
    return data.title
      ? `${data.title} | r/${data.subreddit.name}`
      : `Post on r/${data.subreddit.name}`;
  } else if (targetType === 'subreddit') {
    return data.title ? `${data.title} (r/${data.name})` : `r/${data.name}`;
  }

  return '';
}

/**
 * İçerik tipine göre varsayılan SEO açıklaması oluşturur
 * @param {string} targetType - İçerik tipi ('post' veya 'subreddit')
 * @param {Object} data - Hedef içerik verisi
 * @returns {string} Oluşturulan açıklama
 */
function generateDefaultDescription(targetType, data) {
  if (!data) return '';

  if (targetType === 'post') {
    if (data.content && data.content.length > 0) {
      // İçeriği temizle ve kısalt
      const cleanContent = data.content
        .replace(/[*#_~>]/g, '') // Markdown işaretlerini temizle
        .replace(/\n+/g, ' ') // Satır sonlarını boşluklarla değiştir
        .trim();

      return cleanContent.length > 150 ? `${cleanContent.substring(0, 147)}...` : cleanContent;
    } else if (data.type === 'link') {
      return `${data.title || 'A link'} shared on r/${data.subreddit.name} by u/${data.author.username}`;
    } else if (data.type === 'image') {
      return `${data.title || 'An image'} shared on r/${data.subreddit.name} by u/${data.author.username}`;
    } else if (data.type === 'video') {
      return `${data.title || 'A video'} shared on r/${data.subreddit.name} by u/${data.author.username}`;
    }

    return `${data.title || 'A post'} on r/${data.subreddit.name}`;
  } else if (targetType === 'subreddit') {
    if (data.description && data.description.length > 0) {
      const cleanDescription = data.description
        .replace(/[*#_~>]/g, '')
        .replace(/\n+/g, ' ')
        .trim();

      return cleanDescription.length > 150
        ? `${cleanDescription.substring(0, 147)}...`
        : cleanDescription;
    }

    return `r/${data.name} - a community on Reddit Clone with ${data.memberCount || 0} members`;
  }

  return '';
}

/**
 * İçerik tipine göre anahtar kelimeler oluşturur
 * @param {string} targetType - İçerik tipi ('post' veya 'subreddit')
 * @param {Object} data - Hedef içerik verisi
 * @returns {string[]} Anahtar kelimeler dizisi
 */
function generateKeywords(targetType, data) {
  if (!data) return [];

  const keywords = ['reddit', 'reddit clone'];

  if (targetType === 'post') {
    // Başlıktan anahtar kelimeler çıkart
    if (data.title) {
      // Başlığı kelimelere böl
      const titleWords = data.title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((word) => word.length > 3) // Kısa kelimeleri filtrele
        .filter(
          (word) => !['this', 'that', 'what', 'when', 'where', 'which', 'with'].includes(word),
        ); // Stop words filtrele

      keywords.push(...titleWords.slice(0, 5)); // En fazla 5 kelime al
    }

    // Subreddit adını ekle
    if (data.subreddit && data.subreddit.name) {
      keywords.push(data.subreddit.name);
      keywords.push(`r/${data.subreddit.name}`);
    }

    // Post tipini ekle
    if (data.type) {
      keywords.push(data.type);
    }
  } else if (targetType === 'subreddit') {
    // Subreddit adını ekle
    keywords.push(data.name);
    keywords.push(`r/${data.name}`);

    // Başlıktan anahtar kelimeler çıkart
    if (data.title) {
      const titleWords = data.title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .filter(
          (word) => !['this', 'that', 'what', 'when', 'where', 'which', 'with'].includes(word),
        );

      keywords.push(...titleWords.slice(0, 5));
    }

    // Üye sayısını kategoriye dönüştür
    if (data.memberCount) {
      if (data.memberCount > 1000000) {
        keywords.push('popular subreddit', 'large community');
      } else if (data.memberCount > 100000) {
        keywords.push('big subreddit', 'active community');
      } else if (data.memberCount > 10000) {
        keywords.push('growing subreddit', 'medium community');
      } else {
        keywords.push('small subreddit', 'niche community');
      }
    }
  }

  // Tekrarlanan kelimeleri kaldır
  return [...new Set(keywords)];
}

module.exports = {
  getSEOMetadataById,
  getSEOMetadataByTarget,
  createSEOMetadata,
  updateSEOMetadata,
  updateSEOMetadataByTarget,
  deleteSEOMetadata,
  generateSEOMetadata,
  bulkUpdateSEOMetadata,
  analyzeSEOStatus,
  getAllSEOMetadata,
};
