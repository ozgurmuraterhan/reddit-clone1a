const { ArchivePolicy, Subreddit, SubredditMembership, ModLog } = require('../models');
const mongoose = require('mongoose');

/**
 * @desc    Tüm arşiv politikalarını getir
 * @route   GET /api/archive-policies
 * @access  Private/Admin
 */
const getAllArchivePolicies = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { scope, contentType, isActive } = req.query;
    // Filtreleme seçenekleri
    const filter = {};

    if (scope) {
      filter.scope = scope;
    }

    if (contentType) {
      filter.contentType = contentType;
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    const policies = await ArchivePolicy.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('subreddit', 'name')
      .populate('createdBy', 'username');

    const totalPolicies = await ArchivePolicy.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: policies.length,
      total: totalPolicies,
      totalPages: Math.ceil(totalPolicies / limit),
      currentPage: page,
      data: policies,
    });
  } catch (error) {
    console.error('Get all archive policies error:', error);
    res.status(500).json({
      success: false,
      message: 'Arşiv politikaları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Belirli bir subreddit'in arşiv politikalarını getir
 * @route   GET /api/subreddits/:subredditId/archive-policies
 * @access  Private/Moderator
 */
const getSubredditArchivePolicies = async (req, res) => {
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

    // Subreddit için arşiv politikalarını getir
    const policies = await ArchivePolicy.find({
      subreddit: subredditId,
      scope: 'subreddit',
    })
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: policies.length,
      data: policies,
    });
  } catch (error) {
    console.error('Get subreddit archive policies error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit arşiv politikaları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Belirli bir arşiv politikasını ID'ye göre getir
 * @route   GET /api/archive-policies/:id
 * @access  Private/Moderator or Admin
 */
const getArchivePolicyById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz politika ID formatı',
      });
    }

    const policy = await ArchivePolicy.findById(id)
      .populate('subreddit', 'name')
      .populate('createdBy', 'username');

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: 'Arşiv politikası bulunamadı',
      });
    }

    // Eğer subreddit'e özgü bir politika ise, kullanıcının moderatör olup olmadığını kontrol et
    if (policy.scope === 'subreddit' && req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: policy.subreddit._id,
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
      data: policy,
    });
  } catch (error) {
    console.error('Get archive policy by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Arşiv politikası getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yeni bir arşiv politikası oluştur
 * @route   POST /api/archive-policies
 * @route   POST /api/subreddits/:subredditId/archive-policies
 * @access  Private/Admin or Moderator
 */
const createArchivePolicy = async (req, res) => {
  try {
    const userId = req.user._id;
    const { scope, contentType, archiveAfterDays, actions } = req.body;
    let { subredditId } = req.params;

    // Eğer request body'de subredditId varsa, onu kullan (form üzerinden gönderilmiş olabilir)
    if (!subredditId && req.body.subreddit) {
      subredditId = req.body.subreddit;
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
      // Site scope politikaları sadece admin oluşturabilir
      return res.status(403).json({
        success: false,
        message: 'Site genelinde arşiv politikası oluşturmak için admin yetkileri gerekiyor',
      });
    }

    // Aynı scope, subreddit ve contentType için mevcut politika var mı kontrol et
    const existingPolicy = await ArchivePolicy.findOne({
      scope,
      subreddit: scope === 'subreddit' ? subredditId : undefined,
      contentType,
    });

    if (existingPolicy) {
      return res.status(400).json({
        success: false,
        message: 'Bu scope, subreddit ve içerik tipi için zaten bir arşiv politikası mevcut',
      });
    }

    // Yeni politika oluştur
    const newPolicy = await ArchivePolicy.create({
      scope,
      subreddit: scope === 'subreddit' ? subredditId : undefined,
      contentType: contentType || 'all',
      archiveAfterDays,
      actions: actions || {
        lockVoting: true,
        lockComments: true,
        hideFromFeeds: false,
      },
      createdBy: userId,
    });

    // Moderasyon log kaydı oluştur
    if (scope === 'subreddit') {
      await ModLog.create({
        subreddit: subredditId,
        action: 'policy_created',
        targetType: 'archive_policy',
        targetId: newPolicy._id,
        moderator: userId,
        details: `Yeni arşiv politikası oluşturuldu: ${contentType || 'all'} içerik tipi için ${archiveAfterDays} gün sonra`,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Arşiv politikası başarıyla oluşturuldu',
      data: newPolicy,
    });
  } catch (error) {
    console.error('Create archive policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Arşiv politikası oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Arşiv politikasını güncelle
 * @route   PUT /api/archive-policies/:id
 * @access  Private/Admin or Moderator
 */
const updateArchivePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz politika ID formatı',
      });
    }

    // Politikayı bul
    const policy = await ArchivePolicy.findById(id);
    if (!policy) {
      return res.status(404).json({
        success: false,
        message: 'Arşiv politikası bulunamadı',
      });
    }

    // Yetki kontrolü
    if (policy.scope === 'subreddit' && req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: policy.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu politikayı güncellemek için yetkiniz yok',
        });
      }
    } else if (policy.scope === 'site' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Site genelinde arşiv politikasını güncellemek için admin yetkileri gerekiyor',
      });
    }

    // Bazı alanları koruma
    delete updates.createdBy;
    delete updates.createdAt;
    delete updates.scope; // Scope değiştirilemez
    delete updates.subreddit; // Subreddit değiştirilemez

    // Politikayı güncelle
    const updatedPolicy = await ArchivePolicy.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: Date.now() },
      { new: true, runValidators: true },
    );

    // Moderasyon log kaydı oluştur
    if (policy.scope === 'subreddit') {
      await ModLog.create({
        subreddit: policy.subreddit,
        action: 'policy_updated',
        targetType: 'archive_policy',
        targetId: policy._id,
        moderator: userId,
        details: `Arşiv politikası güncellendi: ${policy.contentType} içerik tipi için`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Arşiv politikası başarıyla güncellendi',
      data: updatedPolicy,
    });
  } catch (error) {
    console.error('Update archive policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Arşiv politikası güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Arşiv politikasını etkinleştir/devre dışı bırak
 * @route   PATCH /api/archive-policies/:id/toggle
 * @access  Private/Admin or Moderator
 */
const toggleArchivePolicyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz politika ID formatı',
      });
    }

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: 'Arşiv politikası bulunamadı',
      });
    }

    // Yetki kontrolü
    if (policy.scope === 'subreddit' && req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: policy.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu politikayı güncellemek için yetkiniz yok',
        });
      }
    } else if (policy.scope === 'site' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Site genelinde arşiv politikasını güncellemek için admin yetkileri gerekiyor',
      });
    }

    // Politika durumunu tersine çevir
    policy.isActive = !policy.isActive;
    policy.updatedAt = Date.now();
    await policy.save();

    // Moderasyon log kaydı oluştur
    if (policy.scope === 'subreddit') {
      await ModLog.create({
        subreddit: policy.subreddit,
        action: policy.isActive ? 'policy_activated' : 'policy_deactivated',
        targetType: 'archive_policy',
        targetId: policy._id,
        moderator: userId,
        details: `Arşiv politikası ${policy.isActive ? 'etkinleştirildi' : 'devre dışı bırakıldı'}: ${policy.contentType} içerik tipi için`,
      });
    }

    res.status(200).json({
      success: true,
      message: `Arşiv politikası başarıyla ${policy.isActive ? 'etkinleştirildi' : 'devre dışı bırakıldı'}`,
      data: policy,
    });
  } catch (error) {
    console.error('Toggle archive policy status error:', error);
    res.status(500).json({
      success: false,
      message: 'Arşiv politikası durumu değiştirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Arşiv politikasını sil
 * @route   DELETE /api/archive-policies/:id
 * @access  Private/Admin or Moderator
 */
const deleteArchivePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz politika ID formatı',
      });
    }

    // Politikayı bul
    const policy = await ArchivePolicy.findById(id);
    if (!policy) {
      return res.status(404).json({
        success: false,
        message: 'Arşiv politikası bulunamadı',
      });
    }

    // Yetki kontrolü
    if (policy.scope === 'subreddit' && req.user.role !== 'admin') {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: policy.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu politikayı silmek için yetkiniz yok',
        });
      }
    } else if (policy.scope === 'site' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Site genelinde arşiv politikasını silmek için admin yetkileri gerekiyor',
      });
    }

    // Politikayla ilgili subreddit bilgisini sakla (log için)
    const subredditId = policy.scope === 'subreddit' ? policy.subreddit : null;
    const policyContentType = policy.contentType;

    // Politikayı sil
    await ArchivePolicy.findByIdAndDelete(id);

    // Moderasyon log kaydı oluştur
    if (subredditId) {
      await ModLog.create({
        subreddit: subredditId,
        action: 'policy_deleted',
        targetType: 'archive_policy',
        targetId: id,
        moderator: userId,
        details: `Arşiv politikası silindi: ${policyContentType} içerik tipi için`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Arşiv politikası başarıyla silindi',
    });
  } catch (error) {
    console.error('Delete archive policy error:', error);
    res.status(500).json({
      success: false,
      message: 'Arşiv politikası silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    İçeriğin arşivlenmeye uygun olup olmadığını kontrol et
 * @route   POST /api/archive-policies/check-eligibility
 * @access  Private
 */
const checkArchiveEligibility = async (req, res) => {
  try {
    const { contentType, subredditId, contentCreatedAt } = req.body;

    if (!contentType || !contentCreatedAt) {
      return res.status(400).json({
        success: false,
        message: 'İçerik tipi ve oluşturulma tarihi gereklidir',
      });
    }

    // Tarih kontrolü
    const contentDate = new Date(contentCreatedAt);
    if (isNaN(contentDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz tarih formatı',
      });
    }

    // İçerik yaşını hesapla (gün olarak)
    const now = new Date();
    const contentAgeInDays = Math.floor((now - contentDate) / (1000 * 60 * 60 * 24));

    let policy = null;

    // Önce subreddit'e özgü politikayı kontrol et (eğer subredditId sağlanmışsa)
    if (subredditId && mongoose.Types.ObjectId.isValid(subredditId)) {
      policy = await ArchivePolicy.findOne({
        scope: 'subreddit',
        subreddit: subredditId,
        isActive: true,
        $or: [{ contentType: 'all' }, { contentType }],
      }).sort({ contentType: -1 }); // İçerik tipine özgü politikayı önceliklendir
    }

    // Eğer subreddit politikası yoksa, site genelindeki politikayı kontrol et
    if (!policy) {
      policy = await ArchivePolicy.findOne({
        scope: 'site',
        isActive: true,
        $or: [{ contentType: 'all' }, { contentType }],
      }).sort({ contentType: -1 }); // İçerik tipine özgü politikayı önceliklendir
    }

    // Uygulanabilir bir politika yoksa
    if (!policy) {
      return res.status(200).json({
        success: true,
        eligible: false,
        message: 'Bu içerik tipi için aktif bir arşiv politikası bulunamadı',
        data: {
          contentAge: contentAgeInDays,
          policy: null,
        },
      });
    }

    // İçerik arşivlenmeye uygun mu kontrol et
    const isEligible = contentAgeInDays >= policy.archiveAfterDays;

    res.status(200).json({
      success: true,
      eligible: isEligible,
      message: isEligible
        ? `İçerik arşivlenmeye uygun (${contentAgeInDays} gün geçmiş, limit: ${policy.archiveAfterDays} gün)`
        : `İçerik henüz arşivlenmeye uygun değil (${contentAgeInDays} gün geçmiş, limit: ${policy.archiveAfterDays} gün)`,
      data: {
        contentAge: contentAgeInDays,
        policy: policy,
      },
    });
  } catch (error) {
    console.error('Check archive eligibility error:', error);
    res.status(500).json({
      success: false,
      message: 'Arşiv uygunluğu kontrol edilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Arşivleme kurallarının özetini getir
 * @route   GET /api/archive-policies/summary
 * @access  Public
 */
const getArchivePolicySummary = async (req, res) => {
  try {
    // Site genelindeki politikaları getir
    const sitePolicies = await ArchivePolicy.find({
      scope: 'site',
      isActive: true,
    }).sort({ contentType: 1 });

    // En popüler subreddit politikalarını getir
    const topSubredditPolicies = await ArchivePolicy.find({
      scope: 'subreddit',
      isActive: true,
    })
      .populate('subreddit', 'name subscriberCount')
      .sort({ 'subreddit.subscriberCount': -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      data: {
        sitePolicies,
        topSubredditPolicies,
      },
    });
  } catch (error) {
    console.error('Get archive policy summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Arşiv politikaları özeti getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getAllArchivePolicies,
  getSubredditArchivePolicies,
  getArchivePolicyById,
  createArchivePolicy,
  updateArchivePolicy,
  toggleArchivePolicyStatus,
  deleteArchivePolicy,
  checkArchiveEligibility,
  getArchivePolicySummary,
};
