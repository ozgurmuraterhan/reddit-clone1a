const { ContentFilter, Subreddit, SubredditMembership, ModLog } = require('../models');
const mongoose = require('mongoose');

/**
 * @desc    Tüm içerik filtrelerini getir
 * @route   GET /api/content-filters
 * @access  Private/Admin
 */
const getAllContentFilters = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { type, scope, isActive, action } = req.query;

    // Filtreleme seçenekleri
    const filter = {};

    if (type) {
      filter.type = type;
    }

    if (scope) {
      filter.scope = scope;
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    if (action) {
      filter.action = action;
    }

    const filters = await ContentFilter.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('subreddit', 'name')
      .populate('createdBy', 'username');

    const totalFilters = await ContentFilter.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: filters.length,
      total: totalFilters,
      totalPages: Math.ceil(totalFilters / limit),
      currentPage: page,
      data: filters,
    });
  } catch (error) {
    console.error('Get all content filters error:', error);
    res.status(500).json({
      success: false,
      message: 'İçerik filtreleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Belirli bir subreddit'in içerik filtrelerini getir
 * @route   GET /api/subreddits/:subredditId/content-filters
 * @access  Private/Moderator
 */
const getSubredditContentFilters = async (req, res) => {
  try {
    const { subredditId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz subreddit ID formatı',
      });
    }

    // Subreddit'i kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const membership = await SubredditMembership.findOne({
      user: userId,
      subreddit: subredditId,
      isModerator: true,
    });

    if (!membership && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için moderatör yetkileri gerekiyor',
      });
    }

    // Subreddit için içerik filtrelerini getir
    const filters = await ContentFilter.find({
      subreddit: subredditId,
      scope: 'subreddit',
    })
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: filters.length,
      data: filters,
    });
  } catch (error) {
    console.error('Get subreddit content filters error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit içerik filtreleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Belirli bir içerik filtresini ID'ye göre getir
 * @route   GET /api/content-filters/:id
 * @access  Private/Moderator or Admin
 */
const getContentFilterById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz filtre ID formatı',
      });
    }

    const filter = await ContentFilter.findById(id)
      .populate('subreddit', 'name')
      .populate('createdBy', 'username');

    if (!filter) {
      return res.status(404).json({
        success: false,
        message: 'İçerik filtresi bulunamadı',
      });
    }

    // Eğer subreddit'e özgü bir filtre ise, kullanıcının moderatör olup olmadığını kontrol et
    if (filter.scope === 'subreddit' && req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: filter.subreddit._id,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu içeriği görüntülemek için yetkiniz yok',
        });
      }
    }

    res.status(200).json({
      success: true,
      data: filter,
    });
  } catch (error) {
    console.error('Get content filter by id error:', error);
    res.status(500).json({
      success: false,
      message: 'İçerik filtresi getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yeni bir içerik filtresi oluştur
 * @route   POST /api/content-filters
 * @route   POST /api/subreddits/:subredditId/content-filters
 * @access  Private/Admin or Moderator
 */
const createContentFilter = async (req, res) => {
  try {
    const userId = req.user._id;
    const { type, pattern, action, scope, reason } = req.body;
    let { subredditId } = req.params;

    // Eğer request body'de subredditId varsa, onu kullan (form üzerinden gönderilmiş olabilir)
    if (!subredditId && req.body.subreddit) {
      subredditId = req.body.subreddit;
    }

    // Zorunlu alanları kontrol et
    if (!type || !pattern) {
      return res.status(400).json({
        success: false,
        message: 'Filtre tipi ve desen (pattern) alanları zorunludur',
      });
    }

    // Pattern uzunluk kontrolü
    if (pattern.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Desen (pattern) 200 karakterden uzun olamaz',
      });
    }

    // Reason uzunluk kontrolü
    if (reason && reason.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Neden (reason) 200 karakterden uzun olamaz',
      });
    }

    // Subreddit scope kontrolü
    if (scope === 'subreddit') {
      if (!subredditId) {
        return res.status(400).json({
          success: false,
          message: 'Subreddit scope için subreddit ID gereklidir',
        });
      }

      if (!mongoose.Types.ObjectId.isValid(subredditId)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz subreddit ID formatı',
        });
      }

      // Subreddit'i kontrol et
      const subreddit = await Subreddit.findById(subredditId);
      if (!subreddit) {
        return res.status(404).json({
          success: false,
          message: 'Subreddit bulunamadı',
        });
      }

      // Kullanıcının moderatör olup olmadığını kontrol et (admin değilse)
      if (req.user.role !== 'admin') {
        const membership = await SubredditMembership.findOne({
          user: userId,
          subreddit: subredditId,
          isModerator: true,
        });

        if (!membership) {
          return res.status(403).json({
            success: false,
            message: 'Bu işlem için moderatör yetkileri gerekiyor',
          });
        }
      }
    } else if (scope === 'site' && req.user.role !== 'admin') {
      // Site scope filtreleri sadece admin oluşturabilir
      return res.status(403).json({
        success: false,
        message: 'Site genelinde içerik filtresi oluşturmak için admin yetkileri gerekiyor',
      });
    }

    // Desen (pattern) validasyonu
    if (type === 'regex') {
      try {
        // Regex patternini test et
        new RegExp(pattern);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz regex deseni',
          error: e.message,
        });
      }
    }

    // Yeni filtre oluştur
    const newFilter = await ContentFilter.create({
      type,
      pattern,
      action: action || 'flag',
      scope,
      subreddit: scope === 'subreddit' ? subredditId : undefined,
      reason,
      createdBy: userId,
    });

    // Moderasyon log kaydı oluştur
    if (scope === 'subreddit') {
      await ModLog.create({
        subreddit: subredditId,
        action: 'filter_created',
        targetType: 'content_filter',
        targetId: newFilter._id,
        moderator: userId,
        details: `Yeni içerik filtresi oluşturuldu: ${type} tipi, "${pattern.substring(0, 30)}${pattern.length > 30 ? '...' : ''}" deseni, ${action} aksiyonu`,
      });
    }

    res.status(201).json({
      success: true,
      message: 'İçerik filtresi başarıyla oluşturuldu',
      data: newFilter,
    });
  } catch (error) {
    console.error('Create content filter error:', error);
    res.status(500).json({
      success: false,
      message: 'İçerik filtresi oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    İçerik filtresini güncelle
 * @route   PUT /api/content-filters/:id
 * @access  Private/Admin or Moderator
 */
const updateContentFilter = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz filtre ID formatı',
      });
    }

    // Filtreyi bul
    const filter = await ContentFilter.findById(id);
    if (!filter) {
      return res.status(404).json({
        success: false,
        message: 'İçerik filtresi bulunamadı',
      });
    }

    // Yetki kontrolü
    if (filter.scope === 'subreddit' && req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: filter.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu filtreyi güncellemek için yetkiniz yok',
        });
      }
    } else if (filter.scope === 'site' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Site genelinde içerik filtresini güncellemek için admin yetkileri gerekiyor',
      });
    }

    // Pattern validasyonu
    if (updates.pattern) {
      if (updates.pattern.length > 200) {
        return res.status(400).json({
          success: false,
          message: 'Desen (pattern) 200 karakterden uzun olamaz',
        });
      }

      if ((updates.type || filter.type) === 'regex') {
        try {
          new RegExp(updates.pattern);
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: 'Geçersiz regex deseni',
            error: e.message,
          });
        }
      }
    }

    // Reason validasyonu
    if (updates.reason && updates.reason.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Neden (reason) 200 karakterden uzun olamaz',
      });
    }

    // Bazı alanları koruma
    delete updates.createdBy;
    delete updates.createdAt;
    delete updates.scope; // Scope değiştirilemez
    delete updates.subreddit; // Subreddit değiştirilemez

    // Filtreyi güncelle
    const updatedFilter = await ContentFilter.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: Date.now() },
      { new: true, runValidators: true },
    );

    // Moderasyon log kaydı oluştur
    if (filter.scope === 'subreddit') {
      await ModLog.create({
        subreddit: filter.subreddit,
        action: 'filter_updated',
        targetType: 'content_filter',
        targetId: filter._id,
        moderator: userId,
        details: `İçerik filtresi güncellendi: ${filter.type} tipi, "${filter.pattern.substring(0, 30)}${filter.pattern.length > 30 ? '...' : ''}" deseni`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'İçerik filtresi başarıyla güncellendi',
      data: updatedFilter,
    });
  } catch (error) {
    console.error('Update content filter error:', error);
    res.status(500).json({
      success: false,
      message: 'İçerik filtresi güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    İçerik filtresini etkinleştir/devre dışı bırak
 * @route   PATCH /api/content-filters/:id/toggle
 * @access  Private/Admin or Moderator
 */
const toggleContentFilterStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz filtre ID formatı',
      });
    }

    // Filtreyi bul
    const filter = await ContentFilter.findById(id);
    if (!filter) {
      return res.status(404).json({
        success: false,
        message: 'İçerik filtresi bulunamadı',
      });
    }

    // Yetki kontrolü
    if (filter.scope === 'subreddit' && req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: filter.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu filtreyi güncellemek için yetkiniz yok',
        });
      }
    } else if (filter.scope === 'site' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Site genelinde içerik filtresini güncellemek için admin yetkileri gerekiyor',
      });
    }

    // Filtre durumunu tersine çevir
    filter.isActive = !filter.isActive;
    filter.updatedAt = Date.now();
    await filter.save();

    // Moderasyon log kaydı oluştur
    if (filter.scope === 'subreddit') {
      await ModLog.create({
        subreddit: filter.subreddit,
        action: filter.isActive ? 'filter_activated' : 'filter_deactivated',
        targetType: 'content_filter',
        targetId: filter._id,
        moderator: userId,
        details: `İçerik filtresi ${filter.isActive ? 'etkinleştirildi' : 'devre dışı bırakıldı'}: ${filter.type} tipi, "${filter.pattern.substring(0, 30)}${filter.pattern.length > 30 ? '...' : ''}" deseni`,
      });
    }

    res.status(200).json({
      success: true,
      message: `İçerik filtresi başarıyla ${filter.isActive ? 'etkinleştirildi' : 'devre dışı bırakıldı'}`,
      data: filter,
    });
  } catch (error) {
    console.error('Toggle content filter status error:', error);
    res.status(500).json({
      success: false,
      message: 'İçerik filtresi durumu değiştirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    İçerik filtresini sil
 * @route   DELETE /api/content-filters/:id
 * @access  Private/Admin or Moderator
 */
const deleteContentFilter = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz filtre ID formatı',
      });
    }

    // Filtreyi bul
    const filter = await ContentFilter.findById(id);
    if (!filter) {
      return res.status(404).json({
        success: false,
        message: 'İçerik filtresi bulunamadı',
      });
    }

    // Yetki kontrolü
    if (filter.scope === 'subreddit' && req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: filter.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu filtreyi silmek için yetkiniz yok',
        });
      }
    } else if (filter.scope === 'site' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Site genelinde içerik filtresini silmek için admin yetkileri gerekiyor',
      });
    }

    // Filtreyle ilgili subreddit bilgisini sakla (log için)
    const subredditId = filter.scope === 'subreddit' ? filter.subreddit : null;
    const filterType = filter.type;
    const filterPattern = filter.pattern;

    // Filtreyi sil
    await ContentFilter.findByIdAndDelete(id);

    // Moderasyon log kaydı oluştur
    if (subredditId) {
      await ModLog.create({
        subreddit: subredditId,
        action: 'filter_deleted',
        targetType: 'content_filter',
        targetId: id,
        moderator: userId,
        details: `İçerik filtresi silindi: ${filterType} tipi, "${filterPattern.substring(0, 30)}${filterPattern.length > 30 ? '...' : ''}" deseni`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'İçerik filtresi başarıyla silindi',
    });
  } catch (error) {
    console.error('Delete content filter error:', error);
    res.status(500).json({
      success: false,
      message: 'İçerik filtresi silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    İçeriği filtrelere karşı kontrol et
 * @route   POST /api/content-filters/check-content
 * @access  Private
 */
const checkContentAgainstFilters = async (req, res) => {
  try {
    const { content, subredditId, contentType, authorId } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'İçerik alanı gereklidir',
      });
    }

    // Filtre koleksiyonu
    let filters = [];

    // Site genelindeki aktif filtreleri getir
    const siteFilters = await ContentFilter.find({
      scope: 'site',
      isActive: true,
    });

    filters = [...siteFilters];

    // Eğer subredditId sağlanmışsa, o subreddit'e özel filtreleri de ekle
    if (subredditId && mongoose.Types.ObjectId.isValid(subredditId)) {
      const subredditFilters = await ContentFilter.find({
        scope: 'subreddit',
        subreddit: subredditId,
        isActive: true,
      });

      filters = [...filters, ...subredditFilters];
    }

    // İçeriği filtrelere karşı kontrol et
    const matches = [];

    for (const filter of filters) {
      let isMatch = false;

      // Kullanıcı filtresi kontrolü
      if (filter.type === 'user' && authorId) {
        isMatch = filter.pattern === authorId.toString();
      }
      // Anahtar kelime kontrolü
      else if (filter.type === 'keyword') {
        const keywords = filter.pattern
          .toLowerCase()
          .split(',')
          .map((k) => k.trim());
        const contentLower = content.toLowerCase();
        isMatch = keywords.some((keyword) => contentLower.includes(keyword));
      }
      // Regex kontrolü
      else if (filter.type === 'regex') {
        try {
          const regex = new RegExp(filter.pattern, 'i');
          isMatch = regex.test(content);
        } catch (e) {
          console.error(`Invalid regex pattern in filter ${filter._id}:`, e);
        }
      }
      // Domain kontrolü (URL içeren içerikler için)
      else if (filter.type === 'domain' && contentType === 'post') {
        // URL'leri bul
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = content.match(urlRegex) || [];

        // Domain'leri kontrol et
        const domainPattern = filter.pattern.toLowerCase();
        isMatch = urls.some((url) => {
          try {
            const domain = new URL(url).hostname.toLowerCase();
            return domain.includes(domainPattern) || domain === domainPattern;
          } catch (e) {
            return false;
          }
        });
      }

      // Eşleşme varsa, match listesine ekle
      if (isMatch) {
        matches.push({
          filterId: filter._id,
          type: filter.type,
          action: filter.action,
          pattern: filter.pattern,
          reason: filter.reason || 'Belirtilmemiş',
          scope: filter.scope,
          subreddit: filter.subreddit,
        });
      }
    }

    // Sonuçları döndür
    res.status(200).json({
      success: true,
      matched: matches.length > 0,
      matches,
      recommendedAction:
        matches.length > 0
          ? matches.sort((a, b) => {
              // Aksiyonları önem derecesine göre sırala
              const actionPriority = { ban: 3, remove: 2, require_approval: 1, flag: 0 };
              return actionPriority[b.action] - actionPriority[a.action];
            })[0].action
          : null,
    });
  } catch (error) {
    console.error('Check content against filters error:', error);
    res.status(500).json({
      success: false,
      message: 'İçerik filtrelere karşı kontrol edilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Filtrelerin özetini getir
 * @route   GET /api/content-filters/summary
 * @access  Private/Admin
 */
const getContentFiltersSummary = async (req, res) => {
  try {
    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkileri gerekiyor',
      });
    }

    // Filtre tipine göre istatistikler
    const typeStats = await ContentFilter.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Scope'a göre istatistikler
    const scopeStats = await ContentFilter.aggregate([
      { $group: { _id: '$scope', count: { $sum: 1 } } },
    ]);

    // Aksiyon tipine göre istatistikler
    const actionStats = await ContentFilter.aggregate([
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // En çok filtreye sahip subreddit'ler
    const topSubreddits = await ContentFilter.aggregate([
      { $match: { scope: 'subreddit' } },
      { $group: { _id: '$subreddit', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Subreddit detaylarını ekle
    const subredditIds = topSubreddits.map((s) => s._id);
    const subredditDetails = await Subreddit.find(
      { _id: { $in: subredditIds } },
      { name: 1, subscriberCount: 1 },
    );

    const subredditMap = {};
    subredditDetails.forEach((s) => {
      subredditMap[s._id.toString()] = {
        name: s.name,
        subscriberCount: s.subscriberCount,
      };
    });

    const topSubredditsWithDetails = topSubreddits.map((s) => ({
      subredditId: s._id,
      filterCount: s.count,
      name: subredditMap[s._id.toString()]?.name || 'Bilinmeyen Subreddit',
      subscriberCount: subredditMap[s._id.toString()]?.subscriberCount || 0,
    }));

    // Aktif ve pasif filtre sayıları
    const activeCount = await ContentFilter.countDocuments({ isActive: true });
    const inactiveCount = await ContentFilter.countDocuments({ isActive: false });

    // Son eklenen filtreler
    const recentFilters = await ContentFilter.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('subreddit', 'name')
      .populate('createdBy', 'username');

    res.status(200).json({
      success: true,
      data: {
        totalFilters: activeCount + inactiveCount,
        activeFilters: activeCount,
        inactiveFilters: inactiveCount,
        typeStats,
        scopeStats,
        actionStats,
        topSubreddits: topSubredditsWithDetails,
        recentFilters,
      },
    });
  } catch (error) {
    console.error('Get content filters summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Filtre özeti getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Belirli bir filter tipinin kullanılabilir aksiyonlarını getir
 * @route   GET /api/content-filters/actions/:filterType
 * @access  Private/Moderator
 */
const getFilterTypeActions = async (req, res) => {
  try {
    const { filterType } = req.params;

    // Geçerli filter tiplerini kontrol et
    const validTypes = ['keyword', 'regex', 'domain', 'user'];
    if (!validTypes.includes(filterType)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz filtre tipi',
      });
    }

    // Tüm filtre tipleri için geçerli aksiyonlar
    const commonActions = [
      { value: 'flag', label: 'İşaretle', description: 'İçeriği işaretle ama kaldırma' },
      {
        value: 'require_approval',
        label: 'Onay Gerektir',
        description: 'İçeriği otomatik olarak moderatör onayına gönder',
      },
      { value: 'remove', label: 'Kaldır', description: 'İçeriği otomatik olarak kaldır' },
    ];

    // Filtre tipine özgü ek aksiyonlar
    let typeSpecificActions = [];

    if (filterType === 'user') {
      typeSpecificActions = [
        { value: 'ban', label: 'Yasakla', description: "Kullanıcıyı subreddit'ten yasakla" },
      ];
    }

    res.status(200).json({
      success: true,
      data: {
        filterType,
        availableActions: [...commonActions, ...typeSpecificActions],
      },
    });
  } catch (error) {
    console.error('Get filter type actions error:', error);
    res.status(500).json({
      success: false,
      message: 'Filtre tipi aksiyonları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Desen önerilerini getir (subreddit veya site genelinde sık kullanılan terimler)
 * @route   GET /api/content-filters/pattern-suggestions
 * @access  Private/Moderator
 */
const getPatternSuggestions = async (req, res) => {
  try {
    const { type, subredditId } = req.query;
    const userId = req.user._id;

    // Subreddit mevcut ve geçerli ise, moderatör kontrolü yap
    if (subredditId && mongoose.Types.ObjectId.isValid(subredditId)) {
      if (req.user.role !== 'admin') {
        const membership = await SubredditMembership.findOne({
          user: userId,
          subreddit: subredditId,
          isModerator: true,
        });

        if (!membership) {
          return res.status(403).json({
            success: false,
            message: 'Bu işlem için moderatör yetkileri gerekiyor',
          });
        }
      }
    }

    let suggestions = [];

    // Filtre tipine göre öneriler
    if (type === 'keyword') {
      suggestions = [
        'spam',
        'reklam',
        'promosyon',
        'ücretli',
        'satılık',
        'affiliate',
        'kumar',
        'bahis',
        'nsfw',
        '+18',
        'yetişkin',
        'küfür',
        'hakaret',
      ];
    } else if (type === 'regex') {
      suggestions = [
        '\\b(https?:\\/\\/)?[\\w\\.-]+\\.[a-z]{2,}\\b', // URL eşleme
        '\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b', // Email eşleme
        '\\b\\d{3}[\\s.-]?\\d{3}[\\s.-]?\\d{4}\\b', // Telefon numarası eşleme
        '\\b(nsfw|\\+18|yetişkin|adult)\\b', // NSFW içerik işaretleri
        '\\b(kredi kartı|visa|mastercard|banking)\\b', // Finansal terimler
      ];
    } else if (type === 'domain') {
      suggestions = [
        'example.com',
        'spam-site.com',
        'affiliate-link.net',
        'sketchy-domain.org',
        'competitor.com',
      ];
    }

    // Subreddit spesifik filtreler varsa, onlardan pattern örnekleri de ekle
    if (subredditId && mongoose.Types.ObjectId.isValid(subredditId)) {
      const existingFilters = await ContentFilter.find({
        scope: 'subreddit',
        subreddit: subredditId,
        type,
      })
        .limit(5)
        .sort({ createdAt: -1 });

      const existingPatterns = existingFilters.map((filter) => filter.pattern);

      // Öneriler listesini güncelle (tekrarlamayacak şekilde)
      suggestions = [...new Set([...existingPatterns, ...suggestions])];
    }

    res.status(200).json({
      success: true,
      data: {
        type,
        suggestions: suggestions.slice(0, 10), // En fazla 10 öneri gönder
      },
    });
  } catch (error) {
    console.error('Get pattern suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'Desen önerileri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Belirli bir subreddit için popular filtre istatistikleri
 * @route   GET /api/subreddits/:subredditId/content-filters/stats
 * @access  Private/Moderator
 */
const getSubredditFilterStats = async (req, res) => {
  try {
    const { subredditId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(subredditId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz subreddit ID formatı',
      });
    }

    // Subreddit'i kontrol et
    const subreddit = await Subreddit.findById(subredditId);
    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    if (req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için moderatör yetkileri gerekiyor',
        });
      }
    }

    // Filtre tipine göre istatistikler
    const typeStats = await ContentFilter.aggregate([
      { $match: { subreddit: mongoose.Types.ObjectId(subredditId) } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Aksiyon tipine göre istatistikler
    const actionStats = await ContentFilter.aggregate([
      { $match: { subreddit: mongoose.Types.ObjectId(subredditId) } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Aktif ve pasif filtre sayıları
    const activeCount = await ContentFilter.countDocuments({
      subreddit: subredditId,
      isActive: true,
    });

    const inactiveCount = await ContentFilter.countDocuments({
      subreddit: subredditId,
      isActive: false,
    });

    // Son eklenen filtreler
    const recentFilters = await ContentFilter.find({
      subreddit: subredditId,
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('createdBy', 'username');

    res.status(200).json({
      success: true,
      data: {
        totalFilters: activeCount + inactiveCount,
        activeFilters: activeCount,
        inactiveFilters: inactiveCount,
        typeStats,
        actionStats,
        recentFilters,
      },
    });
  } catch (error) {
    console.error('Get subreddit filter stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit filtre istatistikleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getAllContentFilters,
  getSubredditContentFilters,
  getContentFilterById,
  createContentFilter,
  updateContentFilter,
  toggleContentFilterStatus,
  deleteContentFilter,
  checkContentAgainstFilters,
  getContentFiltersSummary,
  getFilterTypeActions,
  getPatternSuggestions,
  getSubredditFilterStats,
};
