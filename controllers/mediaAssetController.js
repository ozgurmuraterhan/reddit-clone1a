const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const MediaAsset = require('../models/MediaAsset');
const User = require('../models/User');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');

// Google Cloud Storage konfigürasyonu
const storage = new Storage({
  keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

const bucket = storage.bucket(process.env.GOOGLE_CLOUD_BUCKET);

// Geçici dosya işlemleri için yardımcı fonksiyonlar
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const mkdirAsync = promisify(fs.mkdir);

/**
 * @desc    Medya dosyası yükle
 * @route   POST /api/media/upload
 * @access  Private
 */
const uploadMedia = asyncHandler(async (req, res, next) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return next(new ErrorResponse('Lütfen bir dosya yükleyin', 400));
  }

  const file = req.files.file;
  const userId = req.user._id;

  // Dosya boyutu kontrolü
  const maxSize = 100 * 1024 * 1024; // 100MB
  if (file.size > maxSize) {
    return next(new ErrorResponse("Dosya boyutu 100MB'dan küçük olmalıdır", 400));
  }

  // Dosya tipi belirleme
  let fileType = determineFileType(file.mimetype);
  if (!fileType) {
    return next(new ErrorResponse('Desteklenmeyen dosya formatı', 400));
  }

  // Kullanım bağlamı ve ilişkili içerik ID'si
  const { usageContext, postId, commentId, subredditId } = req.body;

  if (
    !usageContext ||
    !['post', 'comment', 'subreddit', 'profile', 'message', 'other'].includes(usageContext)
  ) {
    return next(new ErrorResponse('Geçerli bir kullanım bağlamı belirtilmelidir', 400));
  }

  // Dosya adı oluşturma
  const fileExtension = path.extname(file.name);
  const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}${fileExtension}`;
  const timestamp = Date.now();
  const finalFilename = `${userId}-${timestamp}-${uniqueFilename}`;

  // Geçici dosya yolu
  const tempFilePath = path.join(os.tmpdir(), finalFilename);

  try {
    // Dosyayı geçici dizine kaydet
    await writeFileAsync(tempFilePath, file.data);

    // Dosya meta verilerini hazırla
    let metadata = {
      contentType: file.mimetype,
      metadata: {
        originalFilename: file.name,
        uploadedBy: userId.toString(),
        uploadedAt: timestamp.toString(),
        usageContext,
      },
    };

    // Dosya boyutlarını ve süresini belirle
    let width, height, duration;

    if (fileType === 'image') {
      // Resim boyutlarını al
      const imageInfo = await sharp(tempFilePath).metadata();
      width = imageInfo.width;
      height = imageInfo.height;

      // Eğer resim çok büyükse thumbnail oluştur
      let thumbnailUrl = null;
      if (width > 1000 || height > 1000) {
        const thumbnailFilename = `thumb-${finalFilename}`;
        const thumbnailPath = path.join(os.tmpdir(), thumbnailFilename);

        await sharp(tempFilePath)
          .resize({ width: 300, height: 300, fit: 'inside' })
          .toFile(thumbnailPath);

        // Thumbnail'ı yükle
        const thumbnailFile = bucket.file(`thumbnails/${thumbnailFilename}`);
        await thumbnailFile.save(fs.readFileSync(thumbnailPath), {
          contentType: 'image/jpeg',
          metadata: {
            metadata: {
              originalFilename: file.name,
              uploadedBy: userId.toString(),
              isThumbnail: 'true',
            },
          },
        });

        thumbnailUrl = `https://storage.googleapis.com/${process.env.GOOGLE_CLOUD_BUCKET}/thumbnails/${thumbnailFilename}`;

        // Geçici thumbnail'ı sil
        await unlinkAsync(thumbnailPath);
      }
    } else if (fileType === 'video') {
      // Video işleme için ffmpeg kullan (asenkron olduğu için promise ile sarmalıyoruz)
      const getVideoInfo = () => {
        return new Promise((resolve, reject) => {
          ffmpeg.ffprobe(tempFilePath, (err, metadata) => {
            if (err) return reject(err);

            const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
            if (videoStream) {
              width = videoStream.width;
              height = videoStream.height;
              duration = metadata.format.duration;
            }
            resolve();
          });
        });
      };

      await getVideoInfo();

      // Video thumbnail oluştur
      const thumbnailFilename = `thumb-${finalFilename.replace(fileExtension, '.jpg')}`;
      const thumbnailPath = path.join(os.tmpdir(), thumbnailFilename);

      const createVideoThumbnail = () => {
        return new Promise((resolve, reject) => {
          ffmpeg(tempFilePath)
            .screenshots({
              timestamps: ['10%'],
              filename: thumbnailFilename,
              folder: os.tmpdir(),
              size: '320x240',
            })
            .on('end', () => resolve())
            .on('error', (err) => reject(err));
        });
      };

      await createVideoThumbnail();

      // Thumbnail'ı yükle
      if (fs.existsSync(thumbnailPath)) {
        const thumbnailFile = bucket.file(`thumbnails/${thumbnailFilename}`);
        await thumbnailFile.save(fs.readFileSync(thumbnailPath), {
          contentType: 'image/jpeg',
          metadata: {
            metadata: {
              originalFilename: file.name,
              uploadedBy: userId.toString(),
              isThumbnail: 'true',
            },
          },
        });

        thumbnailUrl = `https://storage.googleapis.com/${process.env.GOOGLE_CLOUD_BUCKET}/thumbnails/${thumbnailFilename}`;

        // Geçici thumbnail'ı sil
        await unlinkAsync(thumbnailPath);
      }
    }

    // Google Cloud Storage'a dosyayı yükle
    const destFilename = `uploads/${fileType}s/${finalFilename}`;
    const cloudFile = bucket.file(destFilename);

    await cloudFile.save(fs.readFileSync(tempFilePath), {
      contentType: file.mimetype,
      metadata,
    });

    // Dosya URL'ini oluştur
    const cdnUrl = `https://storage.googleapis.com/${process.env.GOOGLE_CLOUD_BUCKET}/${destFilename}`;

    // MediaAsset kaydını oluştur
    const mediaAsset = await MediaAsset.create({
      user: userId,
      type: fileType,
      originalFilename: file.name,
      filename: finalFilename,
      mimeType: file.mimetype,
      size: file.size,
      width,
      height,
      duration,
      cdnUrl,
      thumbnailUrl,
      usageContext,
      postId: usageContext === 'post' && postId ? postId : undefined,
      commentId: usageContext === 'comment' && commentId ? commentId : undefined,
      subredditId: usageContext === 'subreddit' && subredditId ? subredditId : undefined,
      isPublic: true, // Varsayılan olarak herkese açık
      metadata: req.body.metadata ? JSON.parse(req.body.metadata) : undefined,
    });

    // Geçici dosyayı sil
    await unlinkAsync(tempFilePath);

    // Başarılı yanıt döndür
    res.status(201).json({
      success: true,
      data: mediaAsset,
    });
  } catch (error) {
    // Hata durumunda geçici dosyayı temizle
    if (fs.existsSync(tempFilePath)) {
      await unlinkAsync(tempFilePath);
    }

    return next(new ErrorResponse(`Dosya yükleme hatası: ${error.message}`, 500));
  }
});

/**
 * @desc    Medya asetini getir
 * @route   GET /api/media/:id
 * @access  Public/Private (isPublic durumuna göre)
 */
const getMediaAsset = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const mediaAsset = await MediaAsset.findById(id)
    .populate('user', 'username profilePicture')
    .populate('postId', 'title')
    .populate('commentId', 'content')
    .populate('subredditId', 'name');

  if (!mediaAsset) {
    return next(new ErrorResponse('Medya bulunamadı', 404));
  }

  // Eğer medya özel ise ve kullanıcı yetkili değilse erişimi reddet
  if (!mediaAsset.isPublic) {
    if (
      !req.user ||
      (mediaAsset.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin')
    ) {
      return next(new ErrorResponse('Bu medyaya erişim izniniz yok', 403));
    }
  }

  res.status(200).json({
    success: true,
    data: mediaAsset,
  });
});

/**
 * @desc    Kullanıcının medyalarını listele
 * @route   GET /api/media/user/:username
 * @access  Public/Private (yalnızca kendi medyaları ve public olanlar)
 */
const getUserMedia = asyncHandler(async (req, res, next) => {
  const { username } = req.params;
  const { type, context, page = 1, limit = 20 } = req.query;

  // Kullanıcıyı bul
  const user = await User.findOne({ username });

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Sorgu oluştur
  const query = { user: user._id };

  // Dosya tipi filtresi
  if (type && ['image', 'video', 'gif', 'audio', 'document'].includes(type)) {
    query.type = type;
  }

  // Kullanım bağlamı filtresi
  if (
    context &&
    ['post', 'comment', 'subreddit', 'profile', 'message', 'other'].includes(context)
  ) {
    query.usageContext = context;
  }

  // İzin kontrolü: Sadece public medyalar veya kendi medyaları
  if (!req.user || (user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin')) {
    query.isPublic = true;
  }

  // Sayfalama
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Medyaları getir
  const mediaAssets = await MediaAsset.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate('user', 'username profilePicture');

  // Toplam sayı
  const total = await MediaAsset.countDocuments(query);

  res.status(200).json({
    success: true,
    count: mediaAssets.length,
    total,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
    },
    data: mediaAssets,
  });
});

/**
 * @desc    Medya asetini güncelle
 * @route   PUT /api/media/:id
 * @access  Private (Sahip veya Admin)
 */
const updateMediaAsset = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { isPublic, metadata } = req.body;

  let mediaAsset = await MediaAsset.findById(id);

  if (!mediaAsset) {
    return next(new ErrorResponse('Medya bulunamadı', 404));
  }

  // Yetki kontrolü
  if (mediaAsset.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu medyayı güncelleme yetkiniz yok', 403));
  }

  // Güncellenecek alanları hazırla
  const updateData = {};

  if (isPublic !== undefined) {
    updateData.isPublic = isPublic;
  }

  if (metadata) {
    updateData.metadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
  }

  // Güncelleme zamanını ayarla
  updateData.updatedAt = Date.now();

  // Medyayı güncelle
  mediaAsset = await MediaAsset.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    data: mediaAsset,
  });
});

/**
 * @desc    Medya asetini sil
 * @route   DELETE /api/media/:id
 * @access  Private (Sahip veya Admin)
 */
const deleteMediaAsset = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const mediaAsset = await MediaAsset.findById(id);

  if (!mediaAsset) {
    return next(new ErrorResponse('Medya bulunamadı', 404));
  }

  // Yetki kontrolü
  if (mediaAsset.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu medyayı silme yetkiniz yok', 403));
  }

  try {
    // Google Cloud Storage'dan dosyayı sil
    const cdnUrlParts = mediaAsset.cdnUrl.split('/');
    const fileName = cdnUrlParts[cdnUrlParts.length - 1];
    const fileType = mediaAsset.type;
    const filePath = `uploads/${fileType}s/${fileName}`;

    await bucket.file(filePath).delete();

    // Thumbnail varsa onu da sil
    if (mediaAsset.thumbnailUrl) {
      const thumbnailUrlParts = mediaAsset.thumbnailUrl.split('/');
      const thumbnailName = thumbnailUrlParts[thumbnailUrlParts.length - 1];
      const thumbnailPath = `thumbnails/${thumbnailName}`;

      await bucket.file(thumbnailPath).delete();
    }

    // DB'den medya kaydını sil
    await mediaAsset.remove();

    res.status(200).json({
      success: true,
      data: {},
      message: 'Medya başarıyla silindi',
    });
  } catch (error) {
    return next(new ErrorResponse(`Dosya silme hatası: ${error.message}`, 500));
  }
});

/**
 * @desc    Post'a ait medya asetlerini getir
 * @route   GET /api/posts/:postId/media
 * @access  Public
 */
const getPostMedia = asyncHandler(async (req, res, next) => {
  const { postId } = req.params;

  const mediaAssets = await MediaAsset.find({
    postId,
    usageContext: 'post',
    isPublic: true,
  }).sort({ createdAt: 1 });

  res.status(200).json({
    success: true,
    count: mediaAssets.length,
    data: mediaAssets,
  });
});

/**
 * @desc    Subreddit'e ait medya asetlerini getir
 * @route   GET /api/subreddits/:subredditId/media
 * @access  Public/Private (Moderatör)
 */
const getSubredditMedia = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { type, page = 1, limit = 20 } = req.query;

  // Sorgu oluştur
  const query = {
    subredditId,
    usageContext: 'subreddit',
  };

  // Dosya tipi filtresi
  if (type && ['image', 'video', 'gif', 'audio', 'document'].includes(type)) {
    query.type = type;
  }

  // Yetki kontrolü
  const isModerator =
    req.user &&
    (await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subredditId,
      type: 'moderator',
    }));

  // Moderatör değilse sadece public medyalar
  if (!isModerator && req.user?.role !== 'admin') {
    query.isPublic = true;
  }

  // Sayfalama
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Medyaları getir
  const mediaAssets = await MediaAsset.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .populate('user', 'username profilePicture');

  // Toplam sayı
  const total = await MediaAsset.countDocuments(query);

  res.status(200).json({
    success: true,
    count: mediaAssets.length,
    total,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
    },
    data: mediaAssets,
  });
});

/**
 * @desc    Medya tipi ve kullanım analizi
 * @route   GET /api/media/analytics
 * @access  Private (Admin)
 */
const getMediaAnalytics = asyncHandler(async (req, res, next) => {
  // Yetki kontrolü
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu işlem için admin yetkileri gerekiyor', 403));
  }

  // Toplam medya sayısı
  const totalCount = await MediaAsset.countDocuments();

  // Medya tipine göre sayı
  const typeAnalytics = await MediaAsset.aggregate([
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalSize: { $sum: '$size' },
      },
    },
  ]);

  // Kullanım bağlamına göre sayı
  const contextAnalytics = await MediaAsset.aggregate([
    {
      $group: {
        _id: '$usageContext',
        count: { $sum: 1 },
      },
    },
  ]);

  // Toplam boyut (byte)
  const totalSizeResult = await MediaAsset.aggregate([
    {
      $group: {
        _id: null,
        totalSize: { $sum: '$size' },
      },
    },
  ]);
  const totalSize = totalSizeResult.length > 0 ? totalSizeResult[0].totalSize : 0;

  // Son 30 günde yüklenen medya sayısı
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentUploadsCount = await MediaAsset.countDocuments({
    createdAt: { $gte: thirtyDaysAgo },
  });

  // Günlük yükleme trendi (son 30 gün)
  const dailyTrend = await MediaAsset.aggregate([
    {
      $match: { createdAt: { $gte: thirtyDaysAgo } },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
        size: { $sum: '$size' },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalCount,
      totalSize,
      recentUploadsCount,
      typeAnalytics,
      contextAnalytics,
      dailyTrend,
    },
  });
});

/**
 * @desc    Günlük kullanılmayan medya temizliği (Cron job için)
 * @route   None (Server-side job)
 * @access  Private (System only)
 */
const cleanupUnusedMedia = asyncHandler(async () => {
  // Bu işlev, sistem cron job'ı tarafından çağrılır
  console.log('Kullanılmayan medya temizliği başlatılıyor...');

  // 7 günden eski ve hiçbir içerik ile ilişkilendirilmemiş medyaları bul
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const unusedMedia = await MediaAsset.find({
    createdAt: { $lt: sevenDaysAgo },
    usageContext: 'other',
    postId: { $exists: false },
    commentId: { $exists: false },
    subredditId: { $exists: false },
  });

  console.log(`${unusedMedia.length} adet kullanılmayan medya bulundu`);

  // Her kullanılmayan medyayı sil
  let deletedCount = 0;

  for (const media of unusedMedia) {
    try {
      // Google Cloud Storage'dan dosyayı sil
      const cdnUrlParts = media.cdnUrl.split('/');
      const fileName = cdnUrlParts[cdnUrlParts.length - 1];
      const fileType = media.type;
      const filePath = `uploads/${fileType}s/${fileName}`;

      await bucket.file(filePath).delete();

      // Thumbnail varsa onu da sil
      if (media.thumbnailUrl) {
        const thumbnailUrlParts = media.thumbnailUrl.split('/');
        const thumbnailName = thumbnailUrlParts[thumbnailUrlParts.length - 1];
        const thumbnailPath = `thumbnails/${thumbnailName}`;

        await bucket.file(thumbnailPath).delete();
      }

      // DB'den medya kaydını sil
      await media.remove();

      deletedCount++;
    } catch (error) {
      console.error(`Medya silme hatası (ID: ${media._id}): ${error.message}`);
    }
  }

  console.log(`Temizlik tamamlandı. ${deletedCount} medya silindi.`);

  return {
    success: true,
    deleted: deletedCount,
    found: unusedMedia.length,
  };
});

/**
 * @desc    Dosya tipini belirleme yardımcı fonksiyonu
 */
const determineFileType = (mimeType) => {
  if (mimeType.startsWith('image/')) {
    if (mimeType === 'image/gif') {
      return 'gif';
    }
    return 'image';
  } else if (mimeType.startsWith('video/')) {
    return 'video';
  } else if (mimeType.startsWith('audio/')) {
    return 'audio';
  } else if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'text/plain'
  ) {
    return 'document';
  }

  return null;
};

module.exports = {
  uploadMedia,
  getMediaAsset,
  getUserMedia,
  updateMediaAsset,
  deleteMediaAsset,
  getPostMedia,
  getSubredditMedia,
  getMediaAnalytics,
  cleanupUnusedMedia,
};
