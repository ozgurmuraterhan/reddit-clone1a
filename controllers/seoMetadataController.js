const mongoose = require('mongoose');
const { SEOMetadata, Post, Subreddit } = require('../models');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    SEO meta verisi oluştur
 * @route   POST /api/seo-metadata
 * @access  Private (Admin/Moderator)
 */
const createSEOMetadata = asyncHandler(async (req, res, next) => {
  const {
    targetType,
    postId,
    subredditId,
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

  // Hedef tipi kontrol et
  if (!['post', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz hedef tipi. "post" veya "subreddit" olmalıdır', 400));
  }

  // Post veya Subreddit ID kontrolü
  if (targetType === 'post') {
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      return next(new ErrorResponse("Geçerli bir gönderi ID'si gereklidir", 400));
    }

    // Post'un varlığını kontrol et
    const post = await Post.findById(postId);
    if (!post) {
      return next(new ErrorResponse('Gönderi bulunamadı', 404));
    }

    // Kullanıcının post üzerinde yetkisi var mı kontrol et
    if (post.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      const isModerator = await SubredditMembership.exists({
        user: req.user._id,
        subreddit: post.subreddit,
        status: { $in: ['moderator', 'admin'] },
      });

      if (!isModerator) {
        return next(
          new ErrorResponse('Bu gönderi için SEO meta verisi oluşturma yetkiniz yok', 403),
        );
      }
    }
  } else if (targetType === 'subreddit') {
    if (!subredditId || !mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse("Geçerli bir subreddit ID'si gereklidir", 400));
    }

    // Subreddit'in varlığını kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Kullanıcının subreddit üzerinde yetkisi var mı kontrol et
    if (req.user.role !== 'admin') {
      const isModerator = await SubredditMembership.exists({
        user: req.user._id,
        subreddit: subredditId,
        status: { $in: ['moderator', 'admin'] },
      });

      if (!isModerator) {
        return next(
          new ErrorResponse('Bu subreddit için SEO meta verisi oluşturma yetkiniz yok', 403),
        );
      }
    }
  }

  // Mevcut meta verisi var mı kontrol et
  const existingMetadata = await SEOMetadata.findOne({
    targetType,
    [targetType === 'post' ? 'post' : 'subreddit']: targetType === 'post' ? postId : subredditId,
  });

  if (existingMetadata) {
    return next(
      new ErrorResponse(
        `Bu ${targetType === 'post' ? 'gönderi' : 'subreddit'} için zaten SEO meta verisi bulunmaktadır. Güncelleme yapabilirsiniz.`,
        400,
      ),
    );
  }

  // Meta veri verilerini oluştur
  const seoMetadataData = {
    targetType,
    title: title || '',
    description: description || '',
    keywords: keywords
      ? Array.isArray(keywords)
        ? keywords
        : keywords.split(',').map((k) => k.trim())
      : [],
    ogImage: ogImage || '',
    ogTitle: ogTitle || title || '',
    ogDescription: ogDescription || description || '',
    twitterCard: twitterCard || 'summary_large_image',
    canonicalUrl: canonicalUrl || '',
    robots: robots || 'index, follow',
  };

  // Hedef referansını ekle
  if (targetType === 'post') {
    seoMetadataData.post = postId;
  } else {
    seoMetadataData.subreddit = subredditId;
  }

  // Meta veriyi oluştur
  const seoMetadata = await SEOMetadata.create(seoMetadataData);

  res.status(201).json({
    success: true,
    data: seoMetadata,
  });
});

/**
 * @desc    SEO meta verisini ID'ye göre getir
 * @route   GET /api/seo-metadata/:id
 * @access  Private (Admin/Moderator)
 */
const getSEOMetadataById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz SEO meta verisi ID formatı', 400));
  }

  const seoMetadata = await SEOMetadata.findById(id)
    .populate('post', 'title content slug')
    .populate('subreddit', 'name title description');

  if (!seoMetadata) {
    return next(new ErrorResponse('SEO meta verisi bulunamadı', 404));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    let hasPermission = false;

    if (seoMetadata.targetType === 'post' && seoMetadata.post) {
      const post = await Post.findById(seoMetadata.post._id).populate('subreddit');

      hasPermission = await SubredditMembership.exists({
        user: req.user._id,
        subreddit: post.subreddit._id,
        status: { $in: ['moderator', 'admin'] },
      });
    } else if (seoMetadata.targetType === 'subreddit' && seoMetadata.subreddit) {
      hasPermission = await SubredditMembership.exists({
        user: req.user._id,
        subreddit: seoMetadata.subreddit._id,
        status: { $in: ['moderator', 'admin'] },
      });
    }

    if (!hasPermission) {
      return next(new ErrorResponse('Bu SEO meta verisini görüntüleme yetkiniz yok', 403));
    }
  }

  res.status(200).json({
    success: true,
    data: seoMetadata,
  });
});

/**
 * @desc    Hedef içeriğin SEO meta verisini getir (post veya subreddit)
 * @route   GET /api/seo-metadata/target/:targetType/:targetId
 * @access  Public/Private
 */
const getSEOMetadataByTarget = asyncHandler(async (req, res, next) => {
  const { targetType, targetId } = req.params;

  // Hedef tipi kontrolü
  if (!['post', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz hedef tipi. "post" veya "subreddit" olmalıdır', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse(`Geçersiz ${targetType} ID formatı`, 400));
  }

  // İsteğin herkese açık erişimli olup olmadığını kontrol et
  const isPublicAccess = !req.user;

  // Hedef içeriğin varlığını ve erişilebilirliğini kontrol et
  if (targetType === 'post') {
    const post = await Post.findById(targetId).populate('subreddit', 'isPrivate');

    if (!post) {
      return next(new ErrorResponse('Gönderi bulunamadı', 404));
    }

    // Herkese açık erişim için özel kontroller
    if (
      isPublicAccess &&
      (post.isRemoved || post.isPrivate || (post.subreddit && post.subreddit.isPrivate))
    ) {
      return next(new ErrorResponse('Bu içeriğe erişim izniniz yok', 403));
    }
  } else if (targetType === 'subreddit') {
    const subreddit = await Subreddit.findById(targetId);

    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Herkese açık erişim için özel kontroller
    if (isPublicAccess && subreddit.isPrivate) {
      return next(new ErrorResponse('Bu içeriğe erişim izniniz yok', 403));
    }
  }

  // SEO meta verisini bul
  const seoMetadata = await SEOMetadata.findOne({
    targetType,
    [targetType === 'post' ? 'post' : 'subreddit']: targetId,
  });

  if (!seoMetadata) {
    // Meta veri bulunamadığında varsayılan meta veri döndür
    let defaultMetadata = {
      targetType,
      title: '',
      description: '',
      keywords: [],
      ogImage: '',
      ogTitle: '',
      ogDescription: '',
      twitterCard: 'summary_large_image',
      canonicalUrl: '',
      robots: 'index, follow',
    };

    if (targetType === 'post') {
      const post = await Post.findById(targetId).populate('subreddit', 'name');
      if (post) {
        defaultMetadata.title = post.title || '';
        defaultMetadata.description = post.content ? post.content.substring(0, 157) + '...' : '';
        defaultMetadata.canonicalUrl = post.subreddit
          ? `/${post.subreddit.name}/posts/${post._id}`
          : `/posts/${post._id}`;
      }
    } else if (targetType === 'subreddit') {
      const subreddit = await Subreddit.findById(targetId);
      if (subreddit) {
        defaultMetadata.title = subreddit.title || subreddit.name || '';
        defaultMetadata.description = subreddit.description
          ? subreddit.description.substring(0, 157) + '...'
          : '';
        defaultMetadata.canonicalUrl = `/r/${subreddit.name}`;
      }
    }

    return res.status(200).json({
      success: true,
      isDefault: true,
      data: defaultMetadata,
    });
  }

  res.status(200).json({
    success: true,
    isDefault: false,
    data: seoMetadata,
  });
});

/**
 * @desc    SEO meta verisini güncelle
 * @route   PUT /api/seo-metadata/:id
 * @access  Private (Admin/Moderator)
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
    return next(new ErrorResponse('Geçersiz SEO meta verisi ID formatı', 400));
  }

  // Meta veriyi bul
  let seoMetadata = await SEOMetadata.findById(id);

  if (!seoMetadata) {
    return next(new ErrorResponse('SEO meta verisi bulunamadı', 404));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    let hasPermission = false;

    if (seoMetadata.targetType === 'post') {
      const post = await Post.findById(seoMetadata.post).populate('subreddit');
      if (post) {
        hasPermission = await SubredditMembership.exists({
          user: req.user._id,
          subreddit: post.subreddit._id,
          status: { $in: ['moderator', 'admin'] },
        });
      }
    } else if (seoMetadata.targetType === 'subreddit') {
      hasPermission = await SubredditMembership.exists({
        user: req.user._id,
        subreddit: seoMetadata.subreddit,
        status: { $in: ['moderator', 'admin'] },
      });
    }

    if (!hasPermission) {
      return next(new ErrorResponse('Bu SEO meta verisini güncelleme yetkiniz yok', 403));
    }
  }

  // Güncelleme verilerini hazırla
  const updateData = {};

  if (title !== undefined) updateData.title = title;
  if (description !== undefined) updateData.description = description;
  if (keywords !== undefined) {
    updateData.keywords = Array.isArray(keywords)
      ? keywords
      : keywords.split(',').map((k) => k.trim());
  }
  if (ogImage !== undefined) updateData.ogImage = ogImage;
  if (ogTitle !== undefined) updateData.ogTitle = ogTitle;
  if (ogDescription !== undefined) updateData.ogDescription = ogDescription;
  if (twitterCard !== undefined) updateData.twitterCard = twitterCard;
  if (canonicalUrl !== undefined) updateData.canonicalUrl = canonicalUrl;
  if (robots !== undefined) updateData.robots = robots;

  // Meta veriyi güncelle
  seoMetadata = await SEOMetadata.findByIdAndUpdate(
    id,
    { ...updateData, updatedAt: Date.now() },
    { new: true, runValidators: true },
  );

  res.status(200).json({
    success: true,
    data: seoMetadata,
  });
});

/**
 * @desc    SEO meta verisini sil
 * @route   DELETE /api/seo-metadata/:id
 * @access  Private (Admin/Moderator)
 */
const deleteSEOMetadata = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz SEO meta verisi ID formatı', 400));
  }

  // Meta veriyi bul
  const seoMetadata = await SEOMetadata.findById(id);

  if (!seoMetadata) {
    return next(new ErrorResponse('SEO meta verisi bulunamadı', 404));
  }

  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    let hasPermission = false;

    if (seoMetadata.targetType === 'post') {
      const post = await Post.findById(seoMetadata.post).populate('subreddit');
      if (post) {
        hasPermission = await SubredditMembership.exists({
          user: req.user._id,
          subreddit: post.subreddit._id,
          status: { $in: ['moderator', 'admin'] },
        });
      }
    } else if (seoMetadata.targetType === 'subreddit') {
      hasPermission = await SubredditMembership.exists({
        user: req.user._id,
        subreddit: seoMetadata.subreddit,
        status: { $in: ['moderator', 'admin'] },
      });
    }

    if (!hasPermission) {
      return next(new ErrorResponse('Bu SEO meta verisini silme yetkiniz yok', 403));
    }
  }

  // Meta veriyi sil
  await seoMetadata.remove();

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * @desc    İçerikten otomatik SEO meta verisi oluştur
 * @route   POST /api/seo-metadata/generate
 * @access  Private (Admin/Moderator)
 */
const generateSEOMetadata = asyncHandler(async (req, res, next) => {
  const { targetType, targetId } = req.body;

  // Hedef tipi kontrolü
  if (!['post', 'subreddit'].includes(targetType)) {
    return next(new ErrorResponse('Geçersiz hedef tipi. "post" veya "subreddit" olmalıdır', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return next(new ErrorResponse(`Geçersiz ${targetType} ID formatı`, 400));
  }

  // Mevcut meta veri kontrolü
  const existingMetadata = await SEOMetadata.findOne({
    targetType,
    [targetType === 'post' ? 'post' : 'subreddit']: targetId,
  });

  if (existingMetadata) {
    return next(
      new ErrorResponse(
        `Bu ${targetType === 'post' ? 'gönderi' : 'subreddit'} için zaten SEO meta verisi bulunmaktadır.`,
        400,
      ),
    );
  }

  // Hedef içeriği al
  let targetContent;
  let generatedMetadata = {
    targetType,
    title: '',
    description: '',
    keywords: [],
    ogImage: '',
    ogTitle: '',
    ogDescription: '',
    twitterCard: 'summary_large_image',
    canonicalUrl: '',
    robots: 'index, follow',
  };

  if (targetType === 'post') {
    const post = await Post.findById(targetId)
      .populate('subreddit', 'name')
      .populate('author', 'username');

    if (!post) {
      return next(new ErrorResponse('Gönderi bulunamadı', 404));
    }

    // Yetki kontrolü
    if (post.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      const isModerator = await SubredditMembership.exists({
        user: req.user._id,
        subreddit: post.subreddit._id,
        status: { $in: ['moderator', 'admin'] },
      });

      if (!isModerator) {
        return next(
          new ErrorResponse('Bu gönderi için SEO meta verisi oluşturma yetkiniz yok', 403),
        );
      }
    }

    // Meta verileri oluştur
    generatedMetadata.post = targetId;
    generatedMetadata.title = post.title || '';
    generatedMetadata.description = post.content ? post.content.substring(0, 157) + '...' : '';
    generatedMetadata.ogTitle = post.title || '';
    generatedMetadata.ogDescription = post.content ? post.content.substring(0, 197) + '...' : '';

    // Anahtar kelimeleri belirle
    if (post.title && post.content) {
      const allText = (post.title + ' ' + post.content).toLowerCase();
      const words = allText.split(/\s+/);
      const wordCount = {};

      words.forEach((word) => {
        if (word.length > 3 && !['this', 'that', 'with', 'from', 'have', 'more'].includes(word)) {
          wordCount[word] = (wordCount[word] || 0) + 1;
        }
      });

      // En sık kullanılan kelimeleri al
      generatedMetadata.keywords = Object.entries(wordCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map((entry) => entry[0]);
    }

    // Canonical URL oluştur
    if (post.subreddit) {
      generatedMetadata.canonicalUrl = `/r/${post.subreddit.name}/comments/${post._id}/${post.slug || ''}`;
    } else {
      generatedMetadata.canonicalUrl = `/posts/${post._id}/${post.slug || ''}`;
    }

    // İlk görseli Open Graph görseli olarak ayarla
    if (post.media && post.media.length > 0) {
      const firstImage = post.media.find((m) => m.type.startsWith('image/'));
      if (firstImage) {
        generatedMetadata.ogImage = firstImage.url;
      }
    }
  } else if (targetType === 'subreddit') {
    const subreddit = await Subreddit.findById(targetId);

    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      const isModerator = await SubredditMembership.exists({
        user: req.user._id,
        subreddit: targetId,
        status: { $in: ['moderator', 'admin'] },
      });

      if (!isModerator) {
        return next(
          new ErrorResponse('Bu subreddit için SEO meta verisi oluşturma yetkiniz yok', 403),
        );
      }
    }

    // Meta verileri oluştur
    generatedMetadata.subreddit = targetId;
    generatedMetadata.title = subreddit.title || subreddit.name || '';
    generatedMetadata.description = subreddit.description
      ? subreddit.description.substring(0, 157) + '...'
      : '';
    generatedMetadata.ogTitle = subreddit.title || subreddit.name || '';
    generatedMetadata.ogDescription = subreddit.description
      ? subreddit.description.substring(0, 197) + '...'
      : '';

    // Canonical URL oluştur
    generatedMetadata.canonicalUrl = `/r/${subreddit.name}`;

    // Subreddit bannerını Open Graph görseli olarak ayarla
    if (subreddit.bannerImage) {
      generatedMetadata.ogImage = subreddit.bannerImage;
    } else if (subreddit.icon) {
      generatedMetadata.ogImage = subreddit.icon;
    }

    // Anahtar kelimeleri belirle
    if (subreddit.description) {
      const descWords = subreddit.description.toLowerCase().split(/\s+/);
      const wordCount = {};

      descWords.forEach((word) => {
        if (word.length > 3 && !['this', 'that', 'with', 'from', 'have', 'more'].includes(word)) {
          wordCount[word] = (wordCount[word] || 0) + 1;
        }
      });

      // En sık kullanılan kelimeleri al
      const keywords = Object.entries(wordCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map((entry) => entry[0]);

      // Subreddit adını ve kategorilerini ekle
      generatedMetadata.keywords = [
        subreddit.name,
        ...(subreddit.categories || []),
        ...keywords,
      ].slice(0, 10);
    } else {
      generatedMetadata.keywords = [subreddit.name, ...(subreddit.categories || [])].slice(0, 5);
    }
  }

  // Meta veriyi oluştur
  const seoMetadata = await SEOMetadata.create(generatedMetadata);

  res.status(201).json({
    success: true,
    data: seoMetadata,
  });
});

/**
 * @desc    Toplu SEO meta verilerini güncelle
 * @route   PUT /api/seo-metadata/batch
 * @access  Private (Admin)
 */
const batchUpdateSEOMetadata = asyncHandler(async (req, res, next) => {
  const { updates } = req.body;

  // Admin yetkisi kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gereklidir', 403));
  }

  if (!Array.isArray(updates) || updates.length === 0) {
    return next(new ErrorResponse('Geçerli bir güncellemeler dizisi sağlanmalıdır', 400));
  }

  const results = {
    success: [],
    failed: [],
  };

  // Her bir güncellemeyi işle
  for (const update of updates) {
    try {
      const { id, ...updateData } = update;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        results.failed.push({
          id,
          error: 'Geçersiz ID formatı',
        });
        continue;
      }

      const seoMetadata = await SEOMetadata.findByIdAndUpdate(
        id,
        { ...updateData, updatedAt: Date.now() },
        { new: true, runValidators: true },
      );

      if (!seoMetadata) {
        results.failed.push({
          id,
          error: 'SEO meta verisi bulunamadı',
        });
      } else {
        results.success.push({
          id,
          data: seoMetadata,
        });
      }
    } catch (error) {
      results.failed.push({
        id: update.id,
        error: error.message,
      });
    }
  }

  res.status(200).json({
    success: true,
    results,
  });
});

/**
 * @desc    Tüm SEO meta verilerini getir (sadece admin için)
 * @route   GET /api/seo-metadata
 * @access  Private (Admin)
 */
const getAllSEOMetadata = asyncHandler(async (req, res, next) => {
  // Admin yetkisi kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkisi gereklidir', 403));
  }

  // Sayfalama için parametreleri al
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Filtreleme seçenekleri
  const { targetType, searchTerm } = req.query;
  const filter = {};

  if (targetType && ['post', 'subreddit'].includes(targetType)) {
    filter.targetType = targetType;
  }

  if (searchTerm) {
    filter.$or = [
      { title: { $regex: searchTerm, $options: 'i' } },
      { description: { $regex: searchTerm, $options: 'i' } },
      { keywords: { $in: [new RegExp(searchTerm, 'i')] } },
    ];
  }

  // Toplam kayıt sayısını al
  const total = await SEOMetadata.countDocuments(filter);

  // Meta verileri getir
  const seoMetadata = await SEOMetadata.find(filter)
    .populate('post', 'title slug')
    .populate('subreddit', 'name title')
    .sort({ updatedAt: -1 })
    .skip(startIndex)
    .limit(limit);

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
    count: seoMetadata.length,
    pagination,
    data: seoMetadata,
    total,
  });
});

module.exports = {
  createSEOMetadata,
  getSEOMetadataById,
  getSEOMetadataByTarget,
  updateSEOMetadata,
  deleteSEOMetadata,
  generateSEOMetadata,
  batchUpdateSEOMetadata,
  getAllSEOMetadata,
};
