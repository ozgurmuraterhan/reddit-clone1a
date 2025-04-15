const { MediaAsset, Post, Comment, Subreddit, SubredditMembership, ModLog } = require('../models');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);

/**
 * @desc    Medya varlığını ID'ye göre getir
 * @route   GET /api/media/:mediaId
 * @access  Public/Private (içeriğin gizlilik durumuna bağlı)
 */
const getMediaAssetById = async (req, res) => {
  try {
    const { mediaId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz medya ID formatı',
      });
    }

    const media = await MediaAsset.findById(mediaId)
      .populate('uploadedBy', 'username avatar')
      .populate('subreddit', 'name isPrivate');

    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Medya bulunamadı',
      });
    }

    // Gizlilik kontrolü - eğer subreddit özel ise veya içerik gizli ise,
    // kullanıcının erişim yetkisi kontrol edilmeli
    if (media.isPrivate || (media.subreddit && media.subreddit.isPrivate)) {
      // Kullanıcı giriş yapmamışsa erişime izin verme
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Bu medyaya erişmek için giriş yapmanız gerekiyor',
        });
      }

      // Subreddit'e üye mi kontrol et
      if (media.subreddit && media.subreddit.isPrivate) {
        const membership = await SubredditMembership.findOne({
          user: req.user._id,
          subreddit: media.subreddit._id,
        });

        // Admin değilse ve üye değilse erişime izin verme
        if (!membership && req.user.role !== 'admin') {
          return res.status(403).json({
            success: false,
            message: "Bu medyaya erişmek için subreddit'e üye olmanız gerekiyor",
          });
        }
      }

      // Özel içerik sadece yükleyen kişi tarafından görüntülenebilir
      if (
        media.isPrivate &&
        !media.uploadedBy._id.equals(req.user._id) &&
        req.user.role !== 'admin'
      ) {
        return res.status(403).json({
          success: false,
          message: 'Bu özel medyaya erişim izniniz yok',
        });
      }
    }

    // Görüntülenme sayısını artır
    media.viewCount = (media.viewCount || 0) + 1;
    await media.save();

    res.status(200).json({
      success: true,
      data: media,
    });
  } catch (error) {
    console.error('Get media asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Medya getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yeni medya yükle
 * @route   POST /api/media
 * @route   POST /api/subreddits/:subredditId/media
 * @access  Private
 */
const uploadMediaAsset = async (req, res) => {
  try {
    // multer middleware tarafından işlenen dosyayı kontrol et
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Lütfen bir dosya yükleyin',
      });
    }

    const { title, description, altText, isPrivate } = req.body;
    const { subredditId } = req.params;
    const userId = req.user._id;

    // Dosya bilgilerini al
    const { filename, mimetype, size, path: filePath } = req.file;

    // İçerik türünü belirle
    let type = 'unknown';
    if (mimetype.startsWith('image/')) {
      type = 'image';
    } else if (mimetype.startsWith('video/')) {
      type = 'video';
    } else if (mimetype.startsWith('audio/')) {
      type = 'audio';
    } else if (mimetype === 'application/pdf') {
      type = 'document';
    }

    // Eğer subreddit ID varsa ve geçerliyse, kontrollerini yap
    let subreddit = null;
    if (subredditId && mongoose.Types.ObjectId.isValid(subredditId)) {
      subreddit = await Subreddit.findById(subredditId);

      if (!subreddit) {
        // Dosyayı sil ve hata döndür
        await unlinkAsync(filePath);

        return res.status(404).json({
          success: false,
          message: 'Subreddit bulunamadı',
        });
      }

      // Subreddit'in medya yüklemeye izin verip vermediğini kontrol et
      if (!subreddit.allowMediaPosts) {
        // Dosyayı sil ve hata döndür
        await unlinkAsync(filePath);

        return res.status(403).json({
          success: false,
          message: "Bu subreddit'e medya yüklenmesine izin verilmiyor",
        });
      }

      // Kullanıcının subreddit'e üye olup olmadığını kontrol et
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subredditId,
      });

      if (!membership && subreddit.isPrivate) {
        // Dosyayı sil ve hata döndür
        await unlinkAsync(filePath);

        return res.status(403).json({
          success: false,
          message: "Özel subreddit'e medya yüklemek için üye olmanız gerekiyor",
        });
      }
    }

    // Dosya boyutu kontrolü - örneğin 15MB üzerindeki dosyaları reddet
    const maxSize = 15 * 1024 * 1024; // 15MB
    if (size > maxSize) {
      // Dosyayı sil ve hata döndür
      await unlinkAsync(filePath);

      return res.status(400).json({
        success: false,
        message: "Dosya boyutu 15MB'tan büyük olamaz",
      });
    }

    // İçerik türü kontrolü - eğer izin verilmeyen bir türse reddet
    const allowedTypes = ['image', 'video', 'audio', 'document'];
    if (!allowedTypes.includes(type)) {
      // Dosyayı sil ve hata döndür
      await unlinkAsync(filePath);

      return res.status(400).json({
        success: false,
        message: 'Bu dosya türü desteklenmiyor',
      });
    }

    // Medya varlığını oluştur
    const mediaAsset = await MediaAsset.create({
      filename,
      originalFilename: req.file.originalname,
      mimetype,
      size,
      type,
      filePath: req.file.path,
      url: `/uploads/${filename}`, // Bu URL yapılandırmaya göre değişebilir
      subreddit: subredditId,
      uploadedBy: userId,
      title: title || req.file.originalname,
      description,
      altText,
      isPrivate: isPrivate === 'true',
      dimensions: req.dimensions, // Eğer boyut işleme middleware kullanılıyorsa
      duration: req.duration, // Eğer video/ses süresi middleware kullanılıyorsa
    });

    // Subreddit moderasyon kaydı oluştur (eğer subreddit'e yüklendiyse)
    if (subredditId) {
      await ModLog.create({
        subreddit: subredditId,
        action: 'media_uploaded',
        targetType: 'media',
        targetId: mediaAsset._id,
        moderator: subreddit.moderators.includes(userId) ? userId : null,
        user: userId,
        details: `Medya yüklendi: ${type}, ${title || req.file.originalname}`,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Medya başarıyla yüklendi',
      data: mediaAsset,
    });
  } catch (error) {
    console.error('Upload media asset error:', error);

    // Hata durumunda dosyayı silmeye çalış
    if (req.file && req.file.path) {
      try {
        await unlinkAsync(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file after upload failure:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Medya yüklenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Medya varlığını güncelle
 * @route   PUT /api/media/:mediaId
 * @access  Private
 */
const updateMediaAsset = async (req, res) => {
  try {
    const { mediaId } = req.params;
    const { title, description, altText, isPrivate } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz medya ID formatı',
      });
    }

    // Medyayı bul
    const media = await MediaAsset.findById(mediaId);

    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Medya bulunamadı',
      });
    }

    // Yetki kontrolü
    if (!media.uploadedBy.equals(userId) && req.user.role !== 'admin') {
      // Kullanıcı moderatör mü kontrol et (eğer subreddit varsa)
      if (media.subreddit) {
        const membership = await SubredditMembership.findOne({
          user: userId,
          subreddit: media.subreddit,
          isModerator: true,
        });

        if (!membership) {
          return res.status(403).json({
            success: false,
            message: 'Bu medyayı güncelleme yetkiniz yok',
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          message: 'Bu medyayı güncelleme yetkiniz yok',
        });
      }
    }

    // Güncelleme alanlarını hazırla
    const updateFields = {
      updatedAt: Date.now(),
    };

    if (title) updateFields.title = title;
    if (description !== undefined) updateFields.description = description;
    if (altText !== undefined) updateFields.altText = altText;
    if (isPrivate !== undefined) updateFields.isPrivate = isPrivate === 'true';

    // Medyayı güncelle
    const updatedMedia = await MediaAsset.findByIdAndUpdate(mediaId, updateFields, {
      new: true,
      runValidators: true,
    });

    // Subreddit moderasyon kaydı oluştur (eğer subreddit'e aitse ve moderatör güncellediyse)
    if (media.subreddit && !media.uploadedBy.equals(userId)) {
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: media.subreddit,
        isModerator: true,
      });

      if (membership) {
        await ModLog.create({
          subreddit: media.subreddit,
          action: 'media_updated',
          targetType: 'media',
          targetId: media._id,
          moderator: userId,
          user: media.uploadedBy,
          details: `Medya güncellendi: ${media.type}, ${media.title}`,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Medya başarıyla güncellendi',
      data: updatedMedia,
    });
  } catch (error) {
    console.error('Update media asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Medya güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Medya varlığını sil
 * @route   DELETE /api/media/:mediaId
 * @access  Private
 */
const deleteMediaAsset = async (req, res) => {
  try {
    const { mediaId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz medya ID formatı',
      });
    }

    // Medyayı bul
    const media = await MediaAsset.findById(mediaId);

    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Medya bulunamadı',
      });
    }

    // Yetki kontrolü
    if (!media.uploadedBy.equals(userId) && req.user.role !== 'admin') {
      // Kullanıcı moderatör mü kontrol et (eğer subreddit varsa)
      if (media.subreddit) {
        const membership = await SubredditMembership.findOne({
          user: userId,
          subreddit: media.subreddit,
          isModerator: true,
        });

        if (!membership) {
          return res.status(403).json({
            success: false,
            message: 'Bu medyayı silme yetkiniz yok',
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          message: 'Bu medyayı silme yetkiniz yok',
        });
      }
    }

    // Medya kullanım kontrolü
    // Eğer medya hala aktif bir post veya yorum içinde kullanılıyorsa, silinmesine izin verme
    const isUsedInPost = await Post.exists({ media: mediaId, isDeleted: false });
    const isUsedInComment = await Comment.exists({ media: mediaId, isDeleted: false });

    if (isUsedInPost || isUsedInComment) {
      return res.status(400).json({
        success: false,
        message: 'Bu medya aktif bir paylaşımda kullanıldığı için silinemiyor',
      });
    }

    // Subreddit ve moderatör bilgilerini sakla (silme sonrası için)
    const subredditId = media.subreddit;
    const uploaderId = media.uploadedBy;
    const mediaType = media.type;
    const mediaTitle = media.title;
    const mediaPath = media.filePath;

    // Medyayı veritabanından sil
    await MediaAsset.findByIdAndDelete(mediaId);

    // Dosyayı disk/depolama alanından sil
    if (mediaPath && fs.existsSync(mediaPath)) {
      await unlinkAsync(mediaPath);
    }

    // Subreddit moderasyon kaydı oluştur (eğer subreddit'e aitse)
    if (subredditId && !uploaderId.equals(userId)) {
      await ModLog.create({
        subreddit: subredditId,
        action: 'media_removed',
        targetType: 'media',
        targetId: mediaId,
        moderator: userId,
        user: uploaderId,
        details: `Medya silindi: ${mediaType}, ${mediaTitle}`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Medya başarıyla silindi',
    });
  } catch (error) {
    console.error('Delete media asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Medya silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Kullanıcının yüklediği medyaları getir
 * @route   GET /api/users/:userId/media
 * @access  Private/Public (kullanıcı ayarlarına bağlı)
 */
const getUserMediaAssets = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const type = req.query.type; // Filtreleme için opsiyonel

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz kullanıcı ID formatı',
      });
    }

    // Kullanıcıyı bul ve media görüntüleme tercihini kontrol et
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Sorgu filtresi oluştur
    let filter = { uploadedBy: userId };

    // Özel medyalar sadece ilgili kullanıcı veya admin tarafından görüntülenebilir
    if (!req.user || (!req.user._id.equals(userId) && req.user.role !== 'admin')) {
      filter.isPrivate = false;

      // Kullanıcının medya gizlilik ayarları varsa kontrol et
      if (user.settings && !user.settings.showMediaToPublic) {
        return res.status(403).json({
          success: false,
          message: 'Bu kullanıcı medyalarını gizli tutmayı tercih ediyor',
        });
      }
    }

    // Media türüne göre filtreleme
    if (type && ['image', 'video', 'audio', 'document'].includes(type)) {
      filter.type = type;
    }

    // Medyaları getir
    const mediaAssets = await MediaAsset.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('subreddit', 'name')
      .lean();

    const totalMedia = await MediaAsset.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: mediaAssets.length,
      total: totalMedia,
      totalPages: Math.ceil(totalMedia / limit),
      currentPage: page,
      data: mediaAssets,
    });
  } catch (error) {
    console.error('Get user media assets error:', error);
    res.status(500).json({
      success: false,
      message: 'Kullanıcı medyaları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit'e yüklenen medyaları getir
 * @route   GET /api/subreddits/:subredditId/media
 * @access  Private/Public (subreddit ayarlarına bağlı)
 */
const getSubredditMediaAssets = async (req, res) => {
  try {
    const { subredditId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const type = req.query.type; // Filtreleme için opsiyonel

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

    // Eğer subreddit özel ise, kullanıcının üyeliğini kontrol et
    if (subreddit.isPrivate) {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Bu özel subreddit'in medyalarına erişmek için giriş yapmanız gerekiyor",
        });
      }

      const membership = await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
      });

      if (!membership && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: "Bu özel subreddit'in medyalarına erişmek için üye olmanız gerekiyor",
        });
      }
    }

    // Sorgu filtresi oluştur
    let filter = { subreddit: subredditId };

    // Özel medyalar sadece yükleyen, moderatör veya admin tarafından görüntülenebilir
    if (!req.user || req.user.role !== 'admin') {
      const isModerator = req.user
        ? await SubredditMembership.exists({
            user: req.user._id,
            subreddit: subredditId,
            isModerator: true,
          })
        : false;

      if (!isModerator) {
        filter.isPrivate = false;

        // Eğer kullanıcı giriş yapmışsa, kendi özel medyalarını görebilir
        if (req.user) {
          filter.$or = [{ isPrivate: false }, { isPrivate: true, uploadedBy: req.user._id }];
        }
      }
    }

    // Media türüne göre filtreleme
    if (type && ['image', 'video', 'audio', 'document'].includes(type)) {
      filter.type = type;
    }

    // Medyaları getir
    const mediaAssets = await MediaAsset.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('uploadedBy', 'username avatar')
      .lean();

    const totalMedia = await MediaAsset.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: mediaAssets.length,
      total: totalMedia,
      totalPages: Math.ceil(totalMedia / limit),
      currentPage: page,
      data: mediaAssets,
    });
  } catch (error) {
    console.error('Get subreddit media assets error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit medyaları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Medya varlığını moderasyon için işaretle
 * @route   POST /api/media/:mediaId/report
 * @access  Private
 */
const reportMediaAsset = async (req, res) => {
  try {
    const { mediaId } = req.params;
    const { reason, details } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz medya ID formatı',
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Bildirim nedeni gereklidir',
      });
    }

    // Medyayı bul
    const media = await MediaAsset.findById(mediaId);
    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Medya bulunamadı',
      });
    }

    // Kullanıcı kendi medyasını bildiremez
    if (media.uploadedBy.equals(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Kendi yüklediğiniz medyayı bildiremezsiniz',
      });
    }

    // Medyayı işaretle ve raporları güncelle
    const report = {
      user: userId,
      reason,
      details: details || '',
      createdAt: Date.now(),
    };

    media.reports = media.reports || [];
    media.reports.push(report);
    media.isReported = true;
    media.reportCount = (media.reportCount || 0) + 1;

    await media.save();

    // Subreddit'e ait medya ise moderasyon kaydı oluştur
    if (media.subreddit) {
      await ModLog.create({
        subreddit: media.subreddit,
        action: 'media_reported',
        targetType: 'media',
        targetId: media._id,
        user: userId,
        details: `Medya bildirildi: ${reason} - ${details || 'Detay belirtilmedi'}`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Medya başarıyla bildirildi',
    });
  } catch (error) {
    console.error('Report media asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Medya bildirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Medya istatistiklerini getir (admin)
 * @route   GET /api/media/stats
 * @access  Private/Admin
 */
const getMediaStats = async (req, res) => {
  try {
    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkileri gerekiyor',
      });
    }

    // Toplam medya sayısı
    const totalMedia = await MediaAsset.countDocuments();

    // Türlere göre dağılım
    const typeDistribution = await MediaAsset.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 }, totalSize: { $sum: '$size' } } },
      { $sort: { count: -1 } },
    ]);

    // En çok görüntülenen medyalar
    const topViewedMedia = await MediaAsset.find()
      .sort({ viewCount: -1 })
      .limit(5)
      .populate('uploadedBy', 'username')
      .populate('subreddit', 'name')
      .select('title type viewCount url createdAt subreddit uploadedBy');

    // Son 7 günde yüklenen medya sayısı
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentMediaCount = await MediaAsset.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    // En çok medya yükleyen kullanıcılar
    const topUploaders = await MediaAsset.aggregate([
      { $group: { _id: '$uploadedBy', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    // Kullanıcı bilgilerini ekle
    const uploaderIds = topUploaders.map((item) => item._id);
    const uploaderDetails = await User.find(
      { _id: { $in: uploaderIds } },
      { username: 1, avatar: 1 },
    );

    const uploadersMap = {};
    uploaderDetails.forEach((user) => {
      uploadersMap[user._id.toString()] = {
        username: user.username,
        avatar: user.avatar,
      };
    });

    const topUploadersWithDetails = topUploaders.map((uploader) => ({
      userId: uploader._id,
      username: uploadersMap[uploader._id.toString()]?.username || 'Silinmiş Kullanıcı',
      avatar: uploadersMap[uploader._id.toString()]?.avatar,
      uploadCount: uploader.count,
    }));

    // Toplam disk kullanımı
    const storageUsage = await MediaAsset.aggregate([
      { $group: { _id: null, totalSize: { $sum: '$size' } } },
    ]);

    const totalSizeInBytes = storageUsage.length > 0 ? storageUsage[0].totalSize : 0;
    const totalSizeInMB = (totalSizeInBytes / (1024 * 1024)).toFixed(2);

    res.status(200).json({
      success: true,
      data: {
        totalMedia,
        recentMediaCount,
        typeDistribution,
        topViewedMedia,
        topUploaders: topUploadersWithDetails,
        storageUsage: {
          totalSizeInBytes,
          totalSizeInMB: parseFloat(totalSizeInMB),
          readableSize: formatBytes(totalSizeInBytes),
        },
      },
    });
  } catch (error) {
    console.error('Get media stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Medya istatistikleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Bildirilmiş medyaları getir (moderatör/admin)
 * @route   GET /api/media/reported
 * @route   GET /api/subreddits/:subredditId/media/reported
 * @access  Private/Moderator
 */
const getReportedMedia = async (req, res) => {
  try {
    const { subredditId } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Filtre için başlangıç değeri
    let filter = {
      isReported: true,
      reportCount: { $gt: 0 },
    };

    // Eğer subreddit ID varsa, o subreddit için kontrol yap
    if (subredditId) {
      if (!mongoose.Types.ObjectId.isValid(subredditId)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz subreddit ID formatı',
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

      filter.subreddit = subredditId;
    }
    // Eğer subreddit ID yoksa, admin olmalı
    else if (req.user.role !== 'admin') {
      // Kullanıcının moderatör olduğu subreddit'leri bul
      const moderatedSubreddits = await SubredditMembership.find(
        {
          user: userId,
          isModerator: true,
        },
        'subreddit',
      );

      const subredditIds = moderatedSubreddits.map((membership) => membership.subreddit);

      if (subredditIds.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için admin yetkileri gerekiyor',
        });
      }

      filter.subreddit = { $in: subredditIds };
    }

    // Bildirilmiş medyaları getir
    const reportedMedia = await MediaAsset.find(filter)
      .sort({ reportCount: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('uploadedBy', 'username avatar')
      .populate('subreddit', 'name')
      .select(
        'title type mimetype url reports reportCount createdAt updatedAt subreddit uploadedBy',
      );

    const totalReported = await MediaAsset.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: reportedMedia.length,
      total: totalReported,
      totalPages: Math.ceil(totalReported / limit),
      currentPage: page,
      data: reportedMedia,
    });
  } catch (error) {
    console.error('Get reported media error:', error);
    res.status(500).json({
      success: false,
      message: 'Bildirilmiş medyalar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Moderasyon işlemi: Bildirimi temizle veya medyayı kaldır
 * @route   POST /api/media/:mediaId/moderate
 * @access  Private/Moderator
 */
const moderateMediaAsset = async (req, res) => {
  try {
    const { mediaId } = req.params;
    const { action, reason } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz medya ID formatı',
      });
    }

    if (!action || !['clear_reports', 'remove', 'restore'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz moderasyon işlemi',
      });
    }

    // Medyayı bul
    const media = await MediaAsset.findById(mediaId);
    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Medya bulunamadı',
      });
    }

    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      // Eğer subreddit yoksa, sadece admin işlem yapabilir
      if (!media.subreddit) {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için admin yetkileri gerekiyor',
        });
      }

      // Kullanıcının moderatör olup olmadığını kontrol et
      const membership = await SubredditMembership.findOne({
        user: userId,
        subreddit: media.subreddit,
        isModerator: true,
      });

      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'Bu işlem için moderatör yetkileri gerekiyor',
        });
      }
    }

    let modLogAction;
    let modLogDetails;
    let actionPerformed = false;

    // Moderasyon işlemini gerçekleştir
    if (action === 'clear_reports') {
      // Bildirim raporlarını temizle
      media.isReported = false;
      media.reports = [];
      media.reportCount = 0;
      await media.save();

      modLogAction = 'media_reports_cleared';
      modLogDetails = 'Medya raporları temizlendi';
      actionPerformed = true;
    } else if (action === 'remove') {
      // Medyayı kaldır (silme, sadece görünürlüğü değiştir)
      media.isRemoved = true;
      media.removedBy = userId;
      media.removedAt = Date.now();
      media.removalReason = reason || 'Belirtilmedi';
      await media.save();

      modLogAction = 'media_removed';
      modLogDetails = `Medya kaldırıldı: ${reason || 'Neden belirtilmedi'}`;
      actionPerformed = true;
    } else if (action === 'restore') {
      // Kaldırılmış medyayı geri getir
      if (!media.isRemoved) {
        return res.status(400).json({
          success: false,
          message: 'Bu medya zaten aktif durumda',
        });
      }

      media.isRemoved = false;
      media.removedBy = null;
      media.removedAt = null;
      media.removalReason = null;
      await media.save();

      modLogAction = 'media_restored';
      modLogDetails = 'Medya geri yüklendi';
      actionPerformed = true;
    }

    // Moderasyon kaydı oluştur
    if (actionPerformed && media.subreddit) {
      await ModLog.create({
        subreddit: media.subreddit,
        action: modLogAction,
        targetType: 'media',
        targetId: media._id,
        moderator: userId,
        user: media.uploadedBy,
        details: modLogDetails,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Moderasyon işlemi başarıyla gerçekleştirildi',
      data: {
        action,
        media: {
          _id: media._id,
          title: media.title,
          isRemoved: media.isRemoved,
          isReported: media.isReported,
          reportCount: media.reportCount,
        },
      },
    });
  } catch (error) {
    console.error('Moderate media asset error:', error);
    res.status(500).json({
      success: false,
      message: 'Moderasyon işlemi gerçekleştirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Yardımcı fonksiyon: Byte formatını okunabilir formata dönüştürür
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = {
  getMediaAssetById,
  uploadMediaAsset,
  updateMediaAsset,
  deleteMediaAsset,
  getUserMediaAssets,
  getSubredditMediaAssets,
  reportMediaAsset,
  getMediaStats,
  getReportedMedia,
  moderateMediaAsset,
};
