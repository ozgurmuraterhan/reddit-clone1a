const ContentFilter = require('../models/ContentFilter');
const Subreddit = require('../models/Subreddit');
const SubredditMembership = require('../models/SubredditMembership');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const ModLog = require('../models/ModLog');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    İçerik filtresi oluştur
 * @route   POST /api/content-filters
 * @route   POST /api/subreddits/:subredditId/content-filters
 * @access  Private (Admin veya Moderatör)
 */
const createContentFilter = asyncHandler(async (req, res, next) => {
  const { type, pattern, action, scope, reason } = req.body;
  const userId = req.user._id;
  let { subredditId } = req.params;

  // Eğer request body'de subredditId varsa, onu kullan
  if (!subredditId && req.body.subreddit) {
    subredditId = req.body.subreddit;
  }

  // Zorunlu alanları kontrol et
  if (!type || !pattern) {
    return next(new ErrorResponse('Filtre tipi ve desen (pattern) alanları zorunludur', 400));
  }

  // Pattern uzunluk kontrolü
  if (pattern.length > 200) {
    return next(new ErrorResponse('Desen (pattern) 200 karakterden uzun olamaz', 400));
  }

  // Reason uzunluk kontrolü
  if (reason && reason.length > 200) {
    return next(new ErrorResponse('Neden (reason) 200 karakterden uzun olamaz', 400));
  }

  // Subreddit scope kontrolü
  if (scope === 'subreddit') {
    if (!subredditId) {
      return next(new ErrorResponse('Subreddit scope için subreddit ID gereklidir', 400));
    }

    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Subreddit'i kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    if (req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
        isModerator: true,
      });

      if (!membership) {
        return next(new ErrorResponse('Bu işlem için moderatör yetkileri gerekiyor', 403));
      }
    }
  } else if (scope === 'site' && req.user.role !== 'admin') {
    // Site kapsamlı filtreler sadece adminler tarafından oluşturulabilir
    return next(new ErrorResponse('Site kapsamlı filtreler için admin yetkileri gerekiyor', 403));
  }

  // RegEx geçerliliğini kontrol et
  if (type === 'regex') {
    try {
      new RegExp(pattern);
    } catch (error) {
      return next(new ErrorResponse('Geçersiz regex deseni', 400));
    }
  }

  // ContentFilter oluştur
  const contentFilter = await ContentFilter.create({
    type,
    pattern,
    action: action || 'flag',
    scope: scope || 'site',
    subreddit: scope === 'subreddit' ? subredditId : null,
    createdBy: userId,
    reason,
    isActive: true,
  });

  // Moderasyon log kaydı oluştur
  if (scope === 'subreddit' && subredditId) {
    await ModLog.create({
      subreddit: subredditId,
      moderator: userId,
      action: 'create_content_filter',
      details: `Filtre oluşturuldu: ${type} - ${pattern}`,
      reason: reason || 'İçerik filtresi oluşturuldu',
    });
  }

  res.status(201).json({
    success: true,
    data: contentFilter,
  });
});

/**
 * @desc    İçerik filtrelerini listele
 * @route   GET /api/content-filters
 * @route   GET /api/subreddits/:subredditId/content-filters
 * @access  Private (Admin veya Moderatör)
 */
const getContentFilters = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user._id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  let query = {};
  let isModerator = false;

  // Subreddit ID varsa, o subreddit'e özel filtreleri getir
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Subreddit'i kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    query.subreddit = subredditId;

    // Kullanıcının moderatör olup olmadığını kontrol et
    if (req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
        isModerator: true,
      });

      if (!membership) {
        return next(new ErrorResponse('Bu işlem için moderatör yetkileri gerekiyor', 403));
      }
      isModerator = true;
    }
  } else {
    // Site genelinde filtreleri sadece adminler görebilir
    if (req.user.role !== 'admin') {
      return next(
        new ErrorResponse(
          'Site genelindeki filtreleri görüntülemek için admin yetkileri gerekiyor',
          403,
        ),
      );
    }

    // Admin tüm filtreleri görebilir veya querystring ile scope filtreleyebilir
    if (req.query.scope) {
      query.scope = req.query.scope;
    }
  }

  // Aktif filtreleme
  if (req.query.isActive !== undefined) {
    query.isActive = req.query.isActive === 'true';
  }

  // Filtre tipine göre filtreleme
  if (req.query.type) {
    query.type = req.query.type;
  }

  // Filtreleri getir
  const contentFilters = await ContentFilter.find(query)
    .populate('createdBy', 'username avatar')
    .populate('subreddit', 'name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  // Toplam filtre sayısı
  const total = await ContentFilter.countDocuments(query);

  res.status(200).json({
    success: true,
    count: contentFilters.length,
    data: contentFilters,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    İçerik filtresini ID'ye göre getir
 * @route   GET /api/content-filters/:id
 * @access  Private (Admin veya Moderatör)
 */
const getContentFilterById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz filtre ID formatı', 400));
  }

  const contentFilter = await ContentFilter.findById(id)
    .populate('createdBy', 'username avatar')
    .populate('subreddit', 'name');

  if (!contentFilter) {
    return next(new ErrorResponse('İçerik filtresi bulunamadı', 404));
  }

  // Yetki kontrolü
  if (contentFilter.scope === 'subreddit') {
    if (req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: contentFilter.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return next(
          new ErrorResponse('Bu filtreyi görüntülemek için moderatör yetkileri gerekiyor', 403),
        );
      }
    }
  } else if (contentFilter.scope === 'site' && req.user.role !== 'admin') {
    return next(
      new ErrorResponse(
        'Site kapsamlı filtreleri görüntülemek için admin yetkileri gerekiyor',
        403,
      ),
    );
  }

  res.status(200).json({
    success: true,
    data: contentFilter,
  });
});

/**
 * @desc    İçerik filtresini güncelle
 * @route   PUT /api/content-filters/:id
 * @access  Private (Admin veya Moderatör)
 */
const updateContentFilter = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { type, pattern, action, isActive, reason } = req.body;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz filtre ID formatı', 400));
  }

  const contentFilter = await ContentFilter.findById(id);

  if (!contentFilter) {
    return next(new ErrorResponse('İçerik filtresi bulunamadı', 404));
  }

  // Yetki kontrolü
  if (contentFilter.scope === 'subreddit') {
    if (req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: contentFilter.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return next(
          new ErrorResponse('Bu filtreyi güncellemek için moderatör yetkileri gerekiyor', 403),
        );
      }
    }
  } else if (contentFilter.scope === 'site' && req.user.role !== 'admin') {
    return next(
      new ErrorResponse('Site kapsamlı filtreleri güncellemek için admin yetkileri gerekiyor', 403),
    );
  }

  // Validasyon kontrolleri
  if (pattern && pattern.length > 200) {
    return next(new ErrorResponse('Desen (pattern) 200 karakterden uzun olamaz', 400));
  }

  if (reason && reason.length > 200) {
    return next(new ErrorResponse('Neden (reason) 200 karakterden uzun olamaz', 400));
  }

  // RegEx geçerliliğini kontrol et
  if (type === 'regex' && pattern) {
    try {
      new RegExp(pattern);
    } catch (error) {
      return next(new ErrorResponse('Geçersiz regex deseni', 400));
    }
  }

  // Filtreyi güncelle
  contentFilter.type = type || contentFilter.type;
  contentFilter.pattern = pattern || contentFilter.pattern;
  contentFilter.action = action || contentFilter.action;
  contentFilter.isActive = isActive !== undefined ? isActive : contentFilter.isActive;
  contentFilter.reason = reason !== undefined ? reason : contentFilter.reason;
  contentFilter.updatedAt = Date.now();

  await contentFilter.save();

  // Moderasyon log kaydı oluştur
  if (contentFilter.scope === 'subreddit' && contentFilter.subreddit) {
    await ModLog.create({
      subreddit: contentFilter.subreddit,
      moderator: userId,
      action: 'update_content_filter',
      details: `Filtre güncellendi: ${contentFilter.type} - ${contentFilter.pattern}`,
      reason: reason || 'İçerik filtresi güncellendi',
    });
  }

  res.status(200).json({
    success: true,
    data: contentFilter,
  });
});

/**
 * @desc    İçerik filtresini sil
 * @route   DELETE /api/content-filters/:id
 * @access  Private (Admin veya Moderatör)
 */
const deleteContentFilter = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorResponse('Geçersiz filtre ID formatı', 400));
  }

  const contentFilter = await ContentFilter.findById(id);

  if (!contentFilter) {
    return next(new ErrorResponse('İçerik filtresi bulunamadı', 404));
  }

  // Yetki kontrolü
  if (contentFilter.scope === 'subreddit') {
    if (req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: contentFilter.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return next(
          new ErrorResponse('Bu filtreyi silmek için moderatör yetkileri gerekiyor', 403),
        );
      }
    }
  } else if (contentFilter.scope === 'site' && req.user.role !== 'admin') {
    return next(
      new ErrorResponse('Site kapsamlı filtreleri silmek için admin yetkileri gerekiyor', 403),
    );
  }

  // Subreddit bilgisini sakla (silmeden önce)
  const subreddit = contentFilter.subreddit;
  const filterType = contentFilter.type;
  const filterPattern = contentFilter.pattern;

  // Filtreyi sil
  await contentFilter.remove();

  // Moderasyon log kaydı oluştur
  if (contentFilter.scope === 'subreddit' && subreddit) {
    await ModLog.create({
      subreddit: subreddit,
      moderator: userId,
      action: 'delete_content_filter',
      details: `Filtre silindi: ${filterType} - ${filterPattern}`,
      reason: req.body.reason || 'İçerik filtresi silindi',
    });
  }

  res.status(200).json({
    success: true,
    data: {},
    message: 'İçerik filtresi başarıyla silindi',
  });
});

/**
 * @desc    İçerik filtresi test et
 * @route   POST /api/content-filters/test
 * @access  Private (Admin veya Moderatör)
 */
const testContentFilter = asyncHandler(async (req, res, next) => {
  const { content, subredditId, contentType } = req.body;
  const userId = req.user._id;

  if (!content) {
    return next(new ErrorResponse('Test için içerik gereklidir', 400));
  }

  // Yetki kontrolü
  if (subredditId) {
    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
    }

    // Subreddit'i kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return next(new ErrorResponse('Subreddit bulunamadı', 404));
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    if (req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
        isModerator: true,
      });

      if (!membership) {
        return next(new ErrorResponse('Bu işlem için moderatör yetkileri gerekiyor', 403));
      }
    }
  } else if (req.user.role !== 'admin') {
    return next(
      new ErrorResponse('Site kapsamlı filtre testi için admin yetkileri gerekiyor', 403),
    );
  }

  // Filtreleri getir
  let filters = [];

  if (subredditId) {
    // Subreddit filtreleri
    const subredditFilters = await ContentFilter.find({
      subreddit: subredditId,
      isActive: true,
    });

    filters = [...subredditFilters];
  }

  // Site genelindeki filtreleri ekle
  const siteFilters = await ContentFilter.find({
    scope: 'site',
    isActive: true,
  });

  filters = [...filters, ...siteFilters];

  // İçeriği filtrele
  const matches = [];

  for (let filter of filters) {
    let isMatch = false;

    switch (filter.type) {
      case 'keyword':
        isMatch = content.toLowerCase().includes(filter.pattern.toLowerCase());
        break;

      case 'regex':
        try {
          const regex = new RegExp(filter.pattern, 'i');
          isMatch = regex.test(content);
        } catch (error) {
          console.error(`Invalid regex pattern: ${filter.pattern}`, error);
        }
        break;

      case 'domain':
        // URL'leri bul
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = content.match(urlRegex) || [];

        // Domain eşleşmesi ara
        isMatch = urls.some((url) => {
          try {
            const domain = new URL(url).hostname.toLowerCase();
            return (
              domain.includes(filter.pattern.toLowerCase()) ||
              domain === filter.pattern.toLowerCase()
            );
          } catch (error) {
            return false;
          }
        });
        break;
    }

    if (isMatch) {
      matches.push({
        filter: filter,
        action: filter.action,
      });
    }
  }

  res.status(200).json({
    success: true,
    data: {
      content,
      matches,
      hasMatches: matches.length > 0,
      recommendedAction: getHighestPriorityAction(matches),
    },
  });
});

/**
 * @desc    İçeriği filtrele (internal kullanım)
 * @access  Private
 */
const filterContent = async (content, subredditId, userId) => {
  // Filtreleri getir
  let filters = [];

  if (subredditId) {
    // Subreddit filtreleri
    const subredditFilters = await ContentFilter.find({
      subreddit: subredditId,
      isActive: true,
    });

    filters = [...subredditFilters];
  }

  // Site genelindeki filtreleri ekle
  const siteFilters = await ContentFilter.find({
    scope: 'site',
    isActive: true,
  });

  filters = [...filters, ...siteFilters];

  // Kullanıcı filtresi kontrol et
  const userFilters = filters.filter((filter) => filter.type === 'user');
  const userFilterMatches = userFilters.filter(
    (filter) => filter.pattern === userId.toString() || filter.pattern === userId,
  );

  // Eğer kullanıcı filtresi eşleşirse, hemen döndür
  if (userFilterMatches.length > 0) {
    const matches = userFilterMatches.map((filter) => ({
      filter,
      action: filter.action,
    }));

    return {
      hasMatches: true,
      matches,
      recommendedAction: getHighestPriorityAction(matches),
    };
  }

  // Diğer filtreleri kontrol et
  const contentFilters = filters.filter((filter) => filter.type !== 'user');
  const matches = [];

  for (let filter of contentFilters) {
    let isMatch = false;

    switch (filter.type) {
      case 'keyword':
        isMatch = content.toLowerCase().includes(filter.pattern.toLowerCase());
        break;

      case 'regex':
        try {
          const regex = new RegExp(filter.pattern, 'i');
          isMatch = regex.test(content);
        } catch (error) {
          console.error(`Invalid regex pattern: ${filter.pattern}`, error);
        }
        break;

      case 'domain':
        // URL'leri bul
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = content.match(urlRegex) || [];

        // Domain eşleşmesi ara
        isMatch = urls.some((url) => {
          try {
            const domain = new URL(url).hostname.toLowerCase();
            return (
              domain.includes(filter.pattern.toLowerCase()) ||
              domain === filter.pattern.toLowerCase()
            );
          } catch (error) {
            return false;
          }
        });
        break;
    }

    if (isMatch) {
      matches.push({
        filter: filter,
        action: filter.action,
      });
    }
  }

  return {
    hasMatches: matches.length > 0,
    matches,
    recommendedAction: getHighestPriorityAction(matches),
  };
};

/**
 * @desc    Eşleşen filtrelerden en yüksek öncelikli eylemi belirle
 * @access  Private
 */
const getHighestPriorityAction = (matches) => {
  if (!matches || matches.length === 0) {
    return null;
  }

  // Eylem öncelik sırası: ban > remove > require_approval > flag
  const priorityMap = {
    ban: 4,
    remove: 3,
    require_approval: 2,
    flag: 1,
  };

  // En yüksek öncelikli eylemi bul
  return matches.reduce((highest, current) => {
    if (!highest || priorityMap[current.action] > priorityMap[highest]) {
      return current.action;
    }
    return highest;
  }, null);
};

/**
 * @desc    İçerik filtrelerini bir içeriğe uygula
 * @route   POST /api/content-filters/apply
 * @access  Private
 */
const applyContentFilters = asyncHandler(async (req, res, next) => {
  const { content, contentId, contentType, subredditId } = req.body;
  const userId = req.user._id;

  if (!content || !contentType) {
    return next(new ErrorResponse('İçerik ve içerik türü gereklidir', 400));
  }

  if (contentType !== 'post' && contentType !== 'comment') {
    return next(new ErrorResponse('Geçersiz içerik türü. "post" veya "comment" olmalıdır', 400));
  }

  // Subreddit kontrolü
  let finalSubredditId = subredditId;

  if (!finalSubredditId && contentId) {
    // İçerik ID'den subreddit'i bul
    if (contentType === 'post' && mongoose.Types.ObjectId.isValid(contentId)) {
      const post = await Post.findById(contentId).select('subreddit');
      if (post) {
        finalSubredditId = post.subreddit;
      }
    } else if (contentType === 'comment' && mongoose.Types.ObjectId.isValid(contentId)) {
      const comment = await Comment.findById(contentId).populate('post', 'subreddit');
      if (comment && comment.post) {
        finalSubredditId = comment.post.subreddit;
      }
    }
  }

  // Filtreleme işlemini gerçekleştir
  const filterResult = await filterContent(content, finalSubredditId, userId);

  res.status(200).json({
    success: true,
    data: filterResult,
  });
});

module.exports = {
  createContentFilter,
  getContentFilters,
  getContentFilterById,
  updateContentFilter,
  deleteContentFilter,
  testContentFilter,
  applyContentFilters,
  filterContent, // İç kullanım için export ediyoruz
};
