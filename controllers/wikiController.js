const mongoose = require('mongoose');
const { WikiPage, WikiRevision, WikiSettings } = require('../models/Wiki');
const Subreddit = require('../models/Subreddit');
const User = require('../models/User');
const Post = require('../models/Post');
const SubredditMembership = require('../models/SubredditMembership');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const marked = require('marked');
const { sanitizeHtml } = require('../utils/sanitizeHtml');
const diff = require('diff');
const dayjs = require('dayjs');

/**
 * @desc    Wiki sayfası oluştur
 * @route   POST /api/subreddits/:subredditId/wiki
 * @access  Private
 */
const createWikiPage = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { name, title, content, category, permissions, isIndex } = req.body;
  const userId = req.user.id;

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının düzenleme yetkisini kontrol et
  const canEdit = await checkWikiEditPermission(subredditId, userId);
  if (!canEdit) {
    return next(new ErrorResponse('Bu subreddit wikisini düzenleme yetkiniz yok', 403));
  }

  // Sayfa adının benzersiz olduğunu kontrol et
  const existingPage = await WikiPage.findOne({
    subreddit: subredditId,
    name: name.toLowerCase().trim(),
  });

  if (existingPage) {
    return next(new ErrorResponse('Bu isimde bir wiki sayfası zaten var', 400));
  }

  // Markdown içeriğini HTML'e dönüştür
  const contentHtml = sanitizeHtml(marked.parse(content || ''));

  // MongoDB transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Wiki sayfasını oluştur
    const wikiPage = await WikiPage.create(
      [
        {
          subreddit: subredditId,
          name: name.toLowerCase().trim(),
          title,
          content: content || '',
          contentHtml,
          category: category || null,
          permissions: {
            view: permissions?.view || 'public',
            edit: permissions?.edit || 'mods',
          },
          isIndex: isIndex === true,
          createdBy: userId,
          updatedBy: userId,
        },
      ],
      { session },
    );

    // İlk revizyonu oluştur
    const revision = await WikiRevision.create(
      [
        {
          page: wikiPage[0]._id,
          content: content || '',
          contentHtml,
          reason: 'İlk revizyon',
          revisionNumber: 1,
          createdBy: userId,
        },
      ],
      { session },
    );

    // Wiki sayfasına mevcut revizyonu bağla
    wikiPage[0].currentRevision = revision[0]._id;
    await wikiPage[0].save({ session });

    // İndeks sayfası olarak işaretlendiyse, diğer indeks sayfalarını güncelle
    if (isIndex === true) {
      await WikiPage.updateMany(
        { subreddit: subredditId, isIndex: true, _id: { $ne: wikiPage[0]._id } },
        { isIndex: false },
        { session },
      );
    }

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(201).json({
      success: true,
      data: wikiPage[0],
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse(`Wiki sayfası oluşturulamadı: ${error.message}`, 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Wiki sayfasını güncelle
 * @route   PUT /api/subreddits/:subredditId/wiki/:pageId
 * @access  Private
 */
const updateWikiPage = asyncHandler(async (req, res, next) => {
  const { subredditId, pageId } = req.params;
  const { title, content, category, permissions, isIndex, reason } = req.body;
  const userId = req.user.id;

  // Wiki sayfasını kontrol et
  const wikiPage = await WikiPage.findOne({
    _id: pageId,
    subreddit: subredditId,
  }).populate('currentRevision');

  if (!wikiPage) {
    return next(new ErrorResponse('Wiki sayfası bulunamadı', 404));
  }

  // Kullanıcının düzenleme yetkisini kontrol et
  const canEdit = await checkWikiEditPermission(subredditId, userId, wikiPage);
  if (!canEdit) {
    return next(new ErrorResponse('Bu wiki sayfasını düzenleme yetkiniz yok', 403));
  }

  // Eğer sayfa kilitliyse ve kullanıcı moderatör değilse düzenlemeyi engelle
  if (wikiPage.locked) {
    const isModerator = await checkIsModeratorOrAdmin(subredditId, userId);
    if (!isModerator) {
      return next(
        new ErrorResponse(
          'Bu wiki sayfası kilitli ve sadece moderatörler tarafından düzenlenebilir',
          403,
        ),
      );
    }
  }

  // İçerik değişikliği var mı kontrol et
  const contentChanged = content !== undefined && content !== wikiPage.content;

  // Markdown içeriğini HTML'e dönüştür (eğer içerik değiştiyse)
  let contentHtml = wikiPage.contentHtml;
  if (contentChanged) {
    contentHtml = sanitizeHtml(marked.parse(content || ''));
  }

  // Değişiklik farklarını hesapla (eğer içerik değiştiyse)
  let diffResult = null;
  if (contentChanged && wikiPage.content) {
    diffResult = diff.createPatch('wiki', wikiPage.content, content || '', 'önceki', 'yeni');
  }

  // MongoDB transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Eğer içerik değiştiyse yeni revizyon oluştur
    let newRevision = null;
    if (contentChanged) {
      const lastRevision = await WikiRevision.findOne({ page: pageId })
        .sort({ revisionNumber: -1 })
        .session(session);

      const revisionNumber = lastRevision ? lastRevision.revisionNumber + 1 : 1;

      newRevision = await WikiRevision.create(
        [
          {
            page: pageId,
            content: content || '',
            contentHtml,
            reason: reason || 'İçerik güncellendi',
            diff: diffResult,
            revisionNumber,
            previousRevision: wikiPage.currentRevision?._id || null,
            createdBy: userId,
          },
        ],
        { session },
      );

      // Wiki sayfasının mevcut revizyonunu güncelle
      wikiPage.currentRevision = newRevision[0]._id;
      wikiPage.content = content || '';
      wikiPage.contentHtml = contentHtml;
    }

    // Diğer alanları güncelle
    if (title !== undefined) wikiPage.title = title;
    if (category !== undefined) wikiPage.category = category;
    if (permissions?.view !== undefined) wikiPage.permissions.view = permissions.view;
    if (permissions?.edit !== undefined) wikiPage.permissions.edit = permissions.edit;

    // İndeks sayfası olarak işaretlendiyse, diğer indeks sayfalarını güncelle
    if (isIndex === true && !wikiPage.isIndex) {
      await WikiPage.updateMany(
        { subreddit: subredditId, isIndex: true, _id: { $ne: pageId } },
        { isIndex: false },
        { session },
      );
      wikiPage.isIndex = true;
    } else if (isIndex === false) {
      wikiPage.isIndex = false;
    }

    wikiPage.updatedBy = userId;
    wikiPage.updatedAt = Date.now();

    await wikiPage.save({ session });

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: wikiPage,
      revisionCreated: contentChanged,
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse(`Wiki sayfası güncellenemedi: ${error.message}`, 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Wiki sayfasını getir
 * @route   GET /api/subreddits/:subredditId/wiki/:pageName
 * @access  Public/Private (izinlere bağlı)
 */
const getWikiPage = asyncHandler(async (req, res, next) => {
  const { subredditId, pageName } = req.params;
  const { revision } = req.query;
  const userId = req.user ? req.user.id : null;

  // Subreddit ve wiki ayarlarını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Wiki sayfasını bul
  const wikiPage = await WikiPage.findOne({
    subreddit: subredditId,
    name: pageName.toLowerCase().trim(),
  }).populate('currentRevision');

  if (!wikiPage) {
    return next(new ErrorResponse('Wiki sayfası bulunamadı', 404));
  }

  // Kullanıcının görüntüleme yetkisini kontrol et
  const canView = await checkWikiViewPermission(subredditId, userId, wikiPage);
  if (!canView) {
    return next(new ErrorResponse('Bu wiki sayfasını görüntüleme yetkiniz yok', 403));
  }

  // Belirli bir revizyon istendiyse
  if (revision) {
    const revisionDoc = await WikiRevision.findOne({
      page: wikiPage._id,
      revisionNumber: parseInt(revision, 10),
    }).populate('createdBy', 'username profilePicture');

    if (!revisionDoc) {
      return next(new ErrorResponse('Belirtilen revizyon bulunamadı', 404));
    }

    return res.status(200).json({
      success: true,
      data: {
        ...wikiPage.toObject(),
        content: revisionDoc.content,
        contentHtml: revisionDoc.contentHtml,
        revision: revisionDoc,
      },
    });
  }

  // Sayfanın son revizyonlarını getir
  const lastRevisions = await WikiRevision.find({ page: wikiPage._id })
    .sort({ revisionNumber: -1 })
    .limit(5)
    .populate('createdBy', 'username profilePicture');

  // Kullanıcının düzenleme yetkisini kontrol et (UI için)
  const canEdit = await checkWikiEditPermission(subredditId, userId, wikiPage);

  res.status(200).json({
    success: true,
    data: {
      ...wikiPage.toObject(),
      lastRevisions,
      permissions: {
        canView: true,
        canEdit,
      },
    },
  });
});

/**
 * @desc    Wiki sayfasını sil (soft delete)
 * @route   DELETE /api/subreddits/:subredditId/wiki/:pageId
 * @access  Private
 */
const deleteWikiPage = asyncHandler(async (req, res, next) => {
  const { subredditId, pageId } = req.params;
  const userId = req.user.id;

  // Wiki sayfasını kontrol et
  const wikiPage = await WikiPage.findOne({
    _id: pageId,
    subreddit: subredditId,
  });

  if (!wikiPage) {
    return next(new ErrorResponse('Wiki sayfası bulunamadı', 404));
  }

  // Kullanıcının moderatör veya admin olduğunu kontrol et (sadece moderatörler silebilir)
  const isModerator = await checkIsModeratorOrAdmin(subredditId, userId);
  if (!isModerator) {
    return next(new ErrorResponse('Wiki sayfalarını silme yetkiniz yok', 403));
  }

  // Soft delete işlemi
  wikiPage.isDeleted = true;
  wikiPage.deletedAt = Date.now();
  wikiPage.deletedBy = userId;
  await wikiPage.save();

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * @desc    Subreddit'in tüm wiki sayfalarını getir
 * @route   GET /api/subreddits/:subredditId/wiki
 * @access  Public/Private (izinlere bağlı)
 */
const getAllWikiPages = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { category } = req.query;
  const userId = req.user ? req.user.id : null;

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Wiki ayarlarını al
  const wikiSettings = await getOrCreateWikiSettings(subredditId);

  // Kullanıcının wiki görüntüleme iznini kontrol et
  if (wikiSettings.defaultViewPermission !== 'public') {
    const canViewWiki = await checkWikiAccessPermission(
      subredditId,
      userId,
      wikiSettings.defaultViewPermission,
    );
    if (!canViewWiki) {
      return next(new ErrorResponse('Bu subreddit wikisini görüntüleme yetkiniz yok', 403));
    }
  }

  // Sorgu oluştur
  let query = { subreddit: subredditId, isDeleted: false };

  // Kategori filtreleme
  if (category) {
    query.category = category;
  }

  // Sayfaları izinlere göre filtrele
  const pages = await WikiPage.find(query)
    .sort({ isIndex: -1, order: 1, title: 1 })
    .populate('createdBy', 'username profilePicture')
    .populate('updatedBy', 'username profilePicture');

  // Sayfaları izinlere göre filtrele
  const filteredPages = [];
  for (const page of pages) {
    const canView = await checkWikiViewPermission(subredditId, userId, page);
    if (canView) {
      filteredPages.push(page);
    }
  }

  // Kategorileri grupla
  const categories = {};
  const uncategorized = [];

  for (const page of filteredPages) {
    if (page.category) {
      if (!categories[page.category]) {
        categories[page.category] = [];
      }
      categories[page.category].push(page);
    } else {
      uncategorized.push(page);
    }
  }

  // Kullanıcının düzenleme yetkisini kontrol et (UI için)
  const canCreatePage = await checkWikiEditPermission(subredditId, userId);

  res.status(200).json({
    success: true,
    data: {
      pages: filteredPages,
      categories,
      uncategorized,
      indexPage: filteredPages.find((page) => page.isIndex) || null,
      permissions: {
        canCreate: canCreatePage,
      },
    },
  });
});

/**
 * @desc    Wiki revizyon geçmişini getir
 * @route   GET /api/subreddits/:subredditId/wiki/:pageId/history
 * @access  Public/Private (izinlere bağlı)
 */
const getWikiPageHistory = asyncHandler(async (req, res, next) => {
  const { subredditId, pageId } = req.params;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const userId = req.user ? req.user.id : null;

  // Wiki sayfasını kontrol et
  const wikiPage = await WikiPage.findOne({
    _id: pageId,
    subreddit: subredditId,
  });

  if (!wikiPage) {
    return next(new ErrorResponse('Wiki sayfası bulunamadı', 404));
  }

  // Wiki ayarlarını al
  const wikiSettings = await getOrCreateWikiSettings(subredditId);

  // Kullanıcının revizyon geçmişini görüntüleme iznini kontrol et
  const canViewHistory = await checkWikiAccessPermission(
    subredditId,
    userId,
    wikiSettings.showRevisionHistory,
  );
  if (!canViewHistory) {
    return next(new ErrorResponse('Revizyon geçmişini görüntüleme yetkiniz yok', 403));
  }

  // Pagination
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Revizyon sayısını al
  const totalRevisions = await WikiRevision.countDocuments({ page: pageId });

  // Revizyonları getir
  const revisions = await WikiRevision.find({ page: pageId })
    .sort({ revisionNumber: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate('createdBy', 'username profilePicture');

  // Pagination bilgisi
  const pagination = {};

  if (endIndex < totalRevisions) {
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

  pagination.totalPages = Math.ceil(totalRevisions / limit);
  pagination.totalCount = totalRevisions;

  res.status(200).json({
    success: true,
    count: revisions.length,
    pagination,
    data: revisions,
  });
});

/**
 * @desc    Wiki revizyonları karşılaştır
 * @route   GET /api/subreddits/:subredditId/wiki/:pageId/compare
 * @access  Public/Private (izinlere bağlı)
 */
const compareWikiRevisions = asyncHandler(async (req, res, next) => {
  const { subredditId, pageId } = req.params;
  const { from, to } = req.query;
  const userId = req.user ? req.user.id : null;

  if (!from || !to) {
    return next(
      new ErrorResponse('Karşılaştırma için "from" ve "to" parametreleri gereklidir', 400),
    );
  }

  // Wiki sayfasını kontrol et
  const wikiPage = await WikiPage.findOne({
    _id: pageId,
    subreddit: subredditId,
  });

  if (!wikiPage) {
    return next(new ErrorResponse('Wiki sayfası bulunamadı', 404));
  }

  // Kullanıcının görüntüleme yetkisini kontrol et
  const canView = await checkWikiViewPermission(subredditId, userId, wikiPage);
  if (!canView) {
    return next(new ErrorResponse('Bu wiki sayfasını görüntüleme yetkiniz yok', 403));
  }

  // Revizyonları bul
  const fromRevision = await WikiRevision.findOne({
    page: pageId,
    revisionNumber: parseInt(from, 10),
  }).populate('createdBy', 'username profilePicture');

  const toRevision = await WikiRevision.findOne({
    page: pageId,
    revisionNumber: parseInt(to, 10),
  }).populate('createdBy', 'username profilePicture');

  if (!fromRevision || !toRevision) {
    return next(new ErrorResponse('Belirtilen revizyonlardan biri veya ikisi de bulunamadı', 404));
  }

  // Revizyonlar arasındaki farkı hesapla
  const diffResult = diff.createPatch(
    wikiPage.name,
    fromRevision.content,
    toRevision.content,
    `Revizyon ${fromRevision.revisionNumber}`,
    `Revizyon ${toRevision.revisionNumber}`,
  );

  // HTML diff görünümü için farkı işle
  const htmlDiff = formatDiffToHtml(diffResult);

  res.status(200).json({
    success: true,
    data: {
      fromRevision,
      toRevision,
      diff: diffResult,
      htmlDiff,
    },
  });
});

/**
 * @desc    Wiki sayfasını önceki revizyona geri al
 * @route   POST /api/subreddits/:subredditId/wiki/:pageId/revert/:revisionNumber
 * @access  Private
 */
const revertWikiPage = asyncHandler(async (req, res, next) => {
  const { subredditId, pageId, revisionNumber } = req.params;
  const { reason } = req.body;
  const userId = req.user.id;

  // Wiki sayfasını kontrol et
  const wikiPage = await WikiPage.findOne({
    _id: pageId,
    subreddit: subredditId,
  });

  if (!wikiPage) {
    return next(new ErrorResponse('Wiki sayfası bulunamadı', 404));
  }

  // Kullanıcının düzenleme yetkisini kontrol et
  const canEdit = await checkWikiEditPermission(subredditId, userId, wikiPage);
  if (!canEdit) {
    return next(new ErrorResponse('Bu wiki sayfasını düzenleme yetkiniz yok', 403));
  }

  // Revizyonu bul
  const revision = await WikiRevision.findOne({
    page: pageId,
    revisionNumber: parseInt(revisionNumber, 10),
  });

  if (!revision) {
    return next(new ErrorResponse('Belirtilen revizyon bulunamadı', 404));
  }

  // Son revizyonu kontrol et
  const lastRevision = await WikiRevision.findOne({ page: pageId }).sort({ revisionNumber: -1 });

  if (revision.revisionNumber === lastRevision.revisionNumber) {
    return next(new ErrorResponse('En son revizyona geri alma yapılamaz', 400));
  }

  // MongoDB transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Yeni revizyon oluştur (geri alma işlemi)
    const newRevision = await WikiRevision.create(
      [
        {
          page: pageId,
          content: revision.content,
          contentHtml: revision.contentHtml,
          reason: reason || `Revizyon ${revision.revisionNumber}'e geri alındı`,
          revisionNumber: lastRevision.revisionNumber + 1,
          previousRevision: wikiPage.currentRevision,
          isReverted: true,
          createdBy: userId,
          metadata: {
            revertedFrom: revision.revisionNumber,
          },
        },
      ],
      { session },
    );

    // Wiki sayfasını güncelle
    wikiPage.content = revision.content;
    wikiPage.contentHtml = revision.contentHtml;
    wikiPage.currentRevision = newRevision[0]._id;
    wikiPage.updatedBy = userId;
    wikiPage.updatedAt = Date.now();

    await wikiPage.save({ session });

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {
        page: wikiPage,
        revision: newRevision[0],
      },
      message: `Wiki sayfası başarıyla revizyon ${revision.revisionNumber}'e geri alındı`,
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse(`Wiki sayfası geri alınamadı: ${error.message}`, 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Wiki sayfasını kilitle/kilidini aç (sadece moderatörler)
 * @route   PUT /api/subreddits/:subredditId/wiki/:pageId/lock
 * @access  Private/Moderator
 */
const lockWikiPage = asyncHandler(async (req, res, next) => {
  const { subredditId, pageId } = req.params;
  const { locked, reason } = req.body;
  const userId = req.user.id;

  // Wiki sayfasını kontrol et
  const wikiPage = await WikiPage.findOne({
    _id: pageId,
    subreddit: subredditId,
  });

  if (!wikiPage) {
    return next(new ErrorResponse('Wiki sayfası bulunamadı', 404));
  }

  // Kullanıcının moderatör veya admin olduğunu kontrol et
  const isModerator = await checkIsModeratorOrAdmin(subredditId, userId);
  if (!isModerator) {
    return next(new ErrorResponse('Wiki sayfalarını kilitleme/kilidini açma yetkiniz yok', 403));
  }

  // Kilitleme durumunu güncelle
  wikiPage.locked = locked === true;
  wikiPage.updatedBy = userId;
  wikiPage.updatedAt = Date.now();
  await wikiPage.save();

  // Moderatör log kaydı oluştur
  await mongoose.model('ModLog').create({
    subreddit: subredditId,
    moderator: userId,
    action: locked ? 'wiki_lock' : 'wiki_unlock',
    target: pageId,
    targetType: 'wiki_page',
    reason: reason || (locked ? 'Wiki sayfası kilitlendi' : 'Wiki sayfası kilidi açıldı'),
  });

  res.status(200).json({
    success: true,
    data: wikiPage,
    message: locked
      ? 'Wiki sayfası başarıyla kilitlendi, artık sadece moderatörler düzenleyebilir'
      : 'Wiki sayfasının kilidi açıldı',
  });
});

/**
 * @desc    Wiki tartışma sayfası oluştur/güncelle
 * @route   POST /api/subreddits/:subredditId/wiki/:pageId/discussion
 * @access  Private/Moderator
 */
const createWikiDiscussion = asyncHandler(async (req, res, next) => {
  const { subredditId, pageId } = req.params;
  const userId = req.user.id;

  // Wiki sayfasını kontrol et
  const wikiPage = await WikiPage.findOne({
    _id: pageId,
    subreddit: subredditId,
  });

  if (!wikiPage) {
    return next(new ErrorResponse('Wiki sayfası bulunamadı', 404));
  }

  // Kullanıcının moderatör veya admin olduğunu kontrol et
  const isModerator = await checkIsModeratorOrAdmin(subredditId, userId);
  if (!isModerator) {
    return next(new ErrorResponse('Wiki tartışma sayfası oluşturma yetkiniz yok', 403));
  }

  // Mevcut tartışma sayfasını kontrol et
  const existingDiscussion = await Post.findOne({
    wikiPage: pageId,
    type: 'wiki_discussion',
  });

  if (existingDiscussion) {
    return res.status(200).json({
      success: true,
      data: existingDiscussion,
      message: 'Bu wiki sayfası için zaten bir tartışma sayfası var',
    });
  }

  // Yeni tartışma post'u oluştur
  const discussion = await Post.create({
    title: `Wiki Tartışma: ${wikiPage.title}`,
    content: `Bu, "${wikiPage.title}" wiki sayfası hakkında tartışma ve öneri alanıdır.`,
    subreddit: subredditId,
    author: userId,
    type: 'wiki_discussion',
    wikiPage: pageId,
    isPinned: false,
    isLocked: false,
  });

  // Wiki sayfasının tartışma özelliğini etkinleştir
  wikiPage.discussionEnabled = true;
  await wikiPage.save();

  res.status(201).json({
    success: true,
    data: discussion,
    message: 'Wiki tartışma sayfası başarıyla oluşturuldu',
  });
});

/**
 * @desc    Wiki ayarlarını getir
 * @route   GET /api/subreddits/:subredditId/wiki/settings
 * @access  Private/Moderator
 */
const getWikiSettings = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const userId = req.user.id;

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör veya admin olduğunu kontrol et
  const isModerator = await checkIsModeratorOrAdmin(subredditId, userId);
  if (!isModerator) {
    return next(new ErrorResponse('Wiki ayarlarını görüntüleme yetkiniz yok', 403));
  }

  // Wiki ayarlarını al veya oluştur
  const wikiSettings = await getOrCreateWikiSettings(subredditId);

  res.status(200).json({
    success: true,
    data: wikiSettings,
  });
});

/**
 * @desc    Wiki ayarlarını güncelle
 * @route   PUT /api/subreddits/:subredditId/wiki/settings
 * @access  Private/Moderator
 */
const updateWikiSettings = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const {
    enabled,
    defaultViewPermission,
    defaultEditPermission,
    accountAgeDaysRequired,
    minKarmaRequired,
    showRevisionHistory,
    approvalSystem,
  } = req.body;
  const userId = req.user.id;

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör veya admin olduğunu kontrol et
  const isModerator = await checkIsModeratorOrAdmin(subredditId, userId);
  if (!isModerator) {
    return next(new ErrorResponse('Wiki ayarlarını güncelleme yetkiniz yok', 403));
  }

  // Wiki ayarlarını al veya oluştur
  let wikiSettings = await getOrCreateWikiSettings(subredditId);

  // Ayarları güncelle
  if (enabled !== undefined) wikiSettings.enabled = enabled;
  if (defaultViewPermission !== undefined)
    wikiSettings.defaultViewPermission = defaultViewPermission;
  if (defaultEditPermission !== undefined)
    wikiSettings.defaultEditPermission = defaultEditPermission;
  if (accountAgeDaysRequired !== undefined)
    wikiSettings.accountAgeDaysRequired = accountAgeDaysRequired;
  if (minKarmaRequired !== undefined) wikiSettings.minKarmaRequired = minKarmaRequired;
  if (showRevisionHistory !== undefined) wikiSettings.showRevisionHistory = showRevisionHistory;
  if (approvalSystem !== undefined) wikiSettings.approvalSystem = approvalSystem;

  wikiSettings.lastModifiedBy = userId;
  wikiSettings.updatedAt = Date.now();

  await wikiSettings.save();

  res.status(200).json({
    success: true,
    data: wikiSettings,
    message: 'Wiki ayarları başarıyla güncellendi',
  });
});

/**
 * @desc    Onaylı wiki düzenleyiciler listesini yönet
 * @route   PUT /api/subreddits/:subredditId/wiki/contributors
 * @access  Private/Moderator
 */
const manageWikiContributors = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { action, username } = req.body;
  const userId = req.user.id;

  if (!action || !username) {
    return next(new ErrorResponse('İşlem (action) ve kullanıcı adı (username) gereklidir', 400));
  }

  if (action !== 'add' && action !== 'remove') {
    return next(new ErrorResponse('Geçersiz işlem, "add" veya "remove" olmalıdır', 400));
  }

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör veya admin olduğunu kontrol et
  const isModerator = await checkIsModeratorOrAdmin(subredditId, userId);
  if (!isModerator) {
    return next(new ErrorResponse('Wiki katkıda bulunanları yönetme yetkiniz yok', 403));
  }

  // Hedef kullanıcıyı bul
  const targetUser = await User.findOne({ username });
  if (!targetUser) {
    return next(new ErrorResponse('Belirtilen kullanıcı bulunamadı', 404));
  }

  // Wiki ayarlarını al
  let wikiSettings = await getOrCreateWikiSettings(subredditId);

  // İşlemi gerçekleştir
  if (action === 'add') {
    // Kullanıcı zaten onaylı düzenleyici mi kontrol et
    if (wikiSettings.approvedEditors.includes(targetUser._id)) {
      return res.status(400).json({
        success: false,
        message: 'Bu kullanıcı zaten onaylı düzenleyiciler listesinde',
      });
    }

    // Kullanıcı yasaklı düzenleyicilerde ise çıkar
    if (wikiSettings.bannedEditors.includes(targetUser._id)) {
      wikiSettings.bannedEditors = wikiSettings.bannedEditors.filter(
        (id) => id.toString() !== targetUser._id.toString(),
      );
    }

    // Onaylı düzenleyicilere ekle
    wikiSettings.approvedEditors.push(targetUser._id);
  } else if (action === 'remove') {
    // Onaylı düzenleyicilerden çıkar
    wikiSettings.approvedEditors = wikiSettings.approvedEditors.filter(
      (id) => id.toString() !== targetUser._id.toString(),
    );
  }

  wikiSettings.lastModifiedBy = userId;
  wikiSettings.updatedAt = Date.now();

  await wikiSettings.save();

  // Moderasyon log kaydı oluştur
  await mongoose.model('ModLog').create({
    subreddit: subredditId,
    moderator: userId,
    action: action === 'add' ? 'wiki_approved_editor_add' : 'wiki_approved_editor_remove',
    target: targetUser._id,
    targetType: 'user',
    reason:
      action === 'add'
        ? `${targetUser.username} wiki onaylı düzenleyiciler listesine eklendi`
        : `${targetUser.username} wiki onaylı düzenleyiciler listesinden çıkarıldı`,
  });

  res.status(200).json({
    success: true,
    message:
      action === 'add'
        ? `${targetUser.username} wiki düzenleyici olarak onaylandı`
        : `${targetUser.username} onaylı düzenleyiciler listesinden çıkarıldı`,
    data: wikiSettings,
  });
});

/**
 * @desc    Yasaklı wiki düzenleyiciler listesini yönet
 * @route   PUT /api/subreddits/:subredditId/wiki/banned
 * @access  Private/Moderator
 */
const manageWikiBannedUsers = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { action, username, reason } = req.body;
  const userId = req.user.id;

  if (!action || !username) {
    return next(new ErrorResponse('İşlem (action) ve kullanıcı adı (username) gereklidir', 400));
  }

  if (action !== 'ban' && action !== 'unban') {
    return next(new ErrorResponse('Geçersiz işlem, "ban" veya "unban" olmalıdır', 400));
  }

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör veya admin olduğunu kontrol et
  const isModerator = await checkIsModeratorOrAdmin(subredditId, userId);
  if (!isModerator) {
    return next(new ErrorResponse('Wiki yasaklamalarını yönetme yetkiniz yok', 403));
  }

  // Hedef kullanıcıyı bul
  const targetUser = await User.findOne({ username });
  if (!targetUser) {
    return next(new ErrorResponse('Belirtilen kullanıcı bulunamadı', 404));
  }

  // Wiki ayarlarını al
  let wikiSettings = await getOrCreateWikiSettings(subredditId);

  // İşlemi gerçekleştir
  if (action === 'ban') {
    // Kullanıcı zaten yasaklı mı kontrol et
    if (wikiSettings.bannedEditors.includes(targetUser._id)) {
      return res.status(400).json({
        success: false,
        message: 'Bu kullanıcı zaten wiki düzenlemeden yasaklanmış',
      });
    }

    // Kullanıcı onaylı düzenleyicilerde ise çıkar
    if (wikiSettings.approvedEditors.includes(targetUser._id)) {
      wikiSettings.approvedEditors = wikiSettings.approvedEditors.filter(
        (id) => id.toString() !== targetUser._id.toString(),
      );
    }

    // Yasaklı listesine ekle
    wikiSettings.bannedEditors.push(targetUser._id);
  } else if (action === 'unban') {
    // Yasaklı listesinden çıkar
    wikiSettings.bannedEditors = wikiSettings.bannedEditors.filter(
      (id) => id.toString() !== targetUser._id.toString(),
    );
  }

  wikiSettings.lastModifiedBy = userId;
  wikiSettings.updatedAt = Date.now();

  await wikiSettings.save();

  // Moderasyon log kaydı oluştur
  await mongoose.model('ModLog').create({
    subreddit: subredditId,
    moderator: userId,
    action: action === 'ban' ? 'wiki_user_ban' : 'wiki_user_unban',
    target: targetUser._id,
    targetType: 'user',
    reason:
      reason ||
      (action === 'ban'
        ? `${targetUser.username} wiki düzenleme izninden yasaklandı`
        : `${targetUser.username} wiki yasağı kaldırıldı`),
  });

  res.status(200).json({
    success: true,
    message:
      action === 'ban'
        ? `${targetUser.username} wiki düzenlemekten yasaklandı`
        : `${targetUser.username} wiki yasağı kaldırıldı`,
    data: wikiSettings,
  });
});

/**
 * @desc    Wiki sayfalarını kategorilere göre sırala
 * @route   PUT /api/subreddits/:subredditId/wiki/order
 * @access  Private/Moderator
 */
const updateWikiPageOrder = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const { pages } = req.body;
  const userId = req.user.id;

  if (!pages || !Array.isArray(pages)) {
    return next(new ErrorResponse('Geçerli bir sayfa sıralaması gereklidir', 400));
  }

  // Subreddit'i kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Kullanıcının moderatör veya admin olduğunu kontrol et
  const isModerator = await checkIsModeratorOrAdmin(subredditId, userId);
  if (!isModerator) {
    return next(new ErrorResponse('Wiki sıralamasını yönetme yetkiniz yok', 403));
  }

  // MongoDB transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Her sayfa için sıralama numarasını güncelle
    for (const [index, pageData] of pages.entries()) {
      if (!pageData.id) continue;

      await WikiPage.updateOne(
        { _id: pageData.id, subreddit: subredditId },
        { order: index, category: pageData.category || null },
        { session },
      );
    }

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Wiki sayfaları başarıyla yeniden sıralandı',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse(`Wiki sıralaması güncellenemedi: ${error.message}`, 500));
  } finally {
    session.endSession();
  }
});

// Yardımcı fonksiyonlar

/**
 * Wiki ayarlarını al veya oluştur
 */
const getOrCreateWikiSettings = async (subredditId) => {
  let wikiSettings = await WikiSettings.findOne({ subreddit: subredditId });

  if (!wikiSettings) {
    wikiSettings = await WikiSettings.create({
      subreddit: subredditId,
      enabled: true,
      defaultViewPermission: 'public',
      defaultEditPermission: 'mods',
    });
  }

  return wikiSettings;
};

/**
 * Wiki görüntüleme iznini kontrol et
 */
const checkWikiViewPermission = async (subredditId, userId, wikiPage) => {
  // Sayfa yayınlanmamışsa sadece moderatörler görüntüleyebilir
  if (!wikiPage.isPublished) {
    return await checkIsModeratorOrAdmin(subredditId, userId);
  }

  const viewPermission = wikiPage.permissions.view;

  // Herkese açık ise izin ver
  if (viewPermission === 'public') {
    return true;
  }

  // Kullanıcı giriş yapmamışsa ve izin public değilse erişimi reddet
  if (!userId) {
    return false;
  }

  // members ise, kullanıcının üye olup olmadığını kontrol et
  if (viewPermission === 'members') {
    const membership = await SubredditMembership.findOne({
      subreddit: subredditId,
      user: userId,
      status: 'member',
    });

    return !!membership;
  }

  // mods ise, kullanıcının moderatör olup olmadığını kontrol et
  if (viewPermission === 'mods') {
    return await checkIsModeratorOrAdmin(subredditId, userId);
  }

  return false;
};

/**
 * Wiki düzenleme iznini kontrol et
 */
const checkWikiEditPermission = async (subredditId, userId, wikiPage = null) => {
  // Kullanıcı giriş yapmamışsa erişimi reddet
  if (!userId) {
    return false;
  }

  // Wiki ayarlarını al
  const wikiSettings = await getOrCreateWikiSettings(subredditId);

  // Wiki devre dışı bırakılmışsa sadece moderatörler düzenleyebilir
  if (!wikiSettings.enabled) {
    return await checkIsModeratorOrAdmin(subredditId, userId);
  }

  // Kullanıcı yasaklı düzenleyicilerde mi kontrol et
  if (wikiSettings.bannedEditors.some((id) => id.toString() === userId.toString())) {
    return false;
  }

  // Belirli bir sayfa kontrolü
  if (wikiPage) {
    // Sayfa kilitliyse sadece moderatörler düzenleyebilir
    if (wikiPage.locked) {
      return await checkIsModeratorOrAdmin(subredditId, userId);
    }

    const editPermission = wikiPage.permissions.edit;

    // admins ise, kullanıcının admin olup olmadığını kontrol et
    if (editPermission === 'admins') {
      return await checkIsAdmin(userId);
    }

    // mods ise, kullanıcının moderatör olup olmadığını kontrol et
    if (editPermission === 'mods') {
      return await checkIsModeratorOrAdmin(subredditId, userId);
    }

    // members ise, kullanıcının üye olup olmadığını kontrol et
    if (editPermission === 'members') {
      const membership = await SubredditMembership.findOne({
        subreddit: subredditId,
        user: userId,
        status: 'member',
      });

      if (!membership) {
        return false;
      }
    }

    // public veya üyelik kontrolünü geçtiyse
    // Hesap yaşı ve karma kontrolü
    if (wikiSettings.accountAgeDaysRequired > 0 || wikiSettings.minKarmaRequired > 0) {
      const user = await User.findById(userId);

      // Hesap yaşı kontrolü
      if (wikiSettings.accountAgeDaysRequired > 0) {
        const accountAgeInDays = dayjs().diff(dayjs(user.createdAt), 'day');
        if (accountAgeInDays < wikiSettings.accountAgeDaysRequired) {
          return false;
        }
      }

      // Karma kontrolü
      if (wikiSettings.minKarmaRequired > 0) {
        const totalKarma =
          user.karma.post + user.karma.comment + user.karma.awardee + user.karma.awarder;
        if (totalKarma < wikiSettings.minKarmaRequired) {
          return false;
        }
      }
    }

    // Onay sistemi aktifse, kullanıcı onaylı düzenleyicilerde mi kontrol et
    if (
      wikiSettings.approvalSystem &&
      !wikiSettings.approvedEditors.some((id) => id.toString() === userId.toString())
    ) {
      // Onaylı değilse, moderatörleri kontrol et
      return await checkIsModeratorOrAdmin(subredditId, userId);
    }

    return true;
  } else {
    // Genel wiki düzenleme kontrolü (sayfa belirtilmemiş)
    const defaultEditPermission = wikiSettings.defaultEditPermission;

    // admins ise, kullanıcının admin olup olmadığını kontrol et
    if (defaultEditPermission === 'admins') {
      return await checkIsAdmin(userId);
    }

    // mods ise, kullanıcının moderatör olup olmadığını kontrol et
    if (defaultEditPermission === 'mods') {
      return await checkIsModeratorOrAdmin(subredditId, userId);
    }

    // members ise, kullanıcının üye olup olmadığını kontrol et
    if (defaultEditPermission === 'members') {
      const membership = await SubredditMembership.findOne({
        subreddit: subredditId,
        user: userId,
        status: 'member',
      });

      if (!membership) {
        return false;
      }
    }

    // Hesap yaşı ve karma kontrolü
    if (wikiSettings.accountAgeDaysRequired > 0 || wikiSettings.minKarmaRequired > 0) {
      const user = await User.findById(userId);

      // Hesap yaşı kontrolü
      if (wikiSettings.accountAgeDaysRequired > 0) {
        const accountAgeInDays = dayjs().diff(dayjs(user.createdAt), 'day');
        if (accountAgeInDays < wikiSettings.accountAgeDaysRequired) {
          return false;
        }
      }

      // Karma kontrolü
      if (wikiSettings.minKarmaRequired > 0) {
        const totalKarma =
          user.karma.post + user.karma.comment + user.karma.awardee + user.karma.awarder;
        if (totalKarma < wikiSettings.minKarmaRequired) {
          return false;
        }
      }
    }

    // Onay sistemi aktifse, kullanıcı onaylı düzenleyicilerde mi kontrol et
    if (
      wikiSettings.approvalSystem &&
      !wikiSettings.approvedEditors.some((id) => id.toString() === userId.toString())
    ) {
      // Onaylı değilse, moderatörleri kontrol et
      return await checkIsModeratorOrAdmin(subredditId, userId);
    }

    return true;
  }
};

/**
 * Wiki erişim iznini kontrol et (görüntüleme, düzenleme, vb.)
 */
const checkWikiAccessPermission = async (subredditId, userId, permissionType) => {
  // Herkese açık ise izin ver
  if (permissionType === 'public') {
    return true;
  }

  // Kullanıcı giriş yapmamışsa ve izin public değilse erişimi reddet
  if (!userId) {
    return false;
  }

  // members ise, kullanıcının üye olup olmadığını kontrol et
  if (permissionType === 'members') {
    const membership = await SubredditMembership.findOne({
      subreddit: subredditId,
      user: userId,
      status: 'member',
    });

    return !!membership;
  }

  // mods ise, kullanıcının moderatör olup olmadığını kontrol et
  if (permissionType === 'mods') {
    return await checkIsModeratorOrAdmin(subredditId, userId);
  }

  // admins ise, kullanıcının admin olup olmadığını kontrol et
  if (permissionType === 'admins') {
    return await checkIsAdmin(userId);
  }

  return false;
};

/**
 * Kullanıcının moderatör veya admin olduğunu kontrol et
 */
const checkIsModeratorOrAdmin = async (subredditId, userId) => {
  if (!userId) return false;

  // Kullanıcının rollerini kontrol et
  const userRoleAssignment = await mongoose.model('UserRoleAssignment').findOne({
    user: userId,
    entityType: 'subreddit',
    entity: subredditId,
    role: { $in: ['moderator', 'admin'] },
  });

  if (userRoleAssignment) {
    return true;
  }

  // Site admin kontrolü
  const user = await User.findById(userId);
  return user && user.role === 'admin';
};

/**
 * Kullanıcının site admin olduğunu kontrol et
 */
const checkIsAdmin = async (userId) => {
  if (!userId) return false;

  const user = await User.findById(userId);
  return user && user.role === 'admin';
};

/**
 * Diff formatını HTML'e dönüştür
 */
const formatDiffToHtml = (diffText) => {
  if (!diffText) return '';

  const lines = diffText.split('\n');
  let html = '<div class="diff">';

  for (const line of lines) {
    if (line.startsWith('+')) {
      html += `<div class="diff-line diff-added">${escapeHtml(line.substring(1))}</div>`;
    } else if (line.startsWith('-')) {
      html += `<div class="diff-line diff-removed">${escapeHtml(line.substring(1))}</div>`;
    } else if (line.startsWith('@')) {
      html += `<div class="diff-line diff-info">${escapeHtml(line)}</div>`;
    } else {
      html += `<div class="diff-line">${escapeHtml(line)}</div>`;
    }
  }

  html += '</div>';
  return html;
};

/**
 * HTML karakterlerini escape et
 */
const escapeHtml = (text) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

module.exports = {
  createWikiPage,
  updateWikiPage,
  getWikiPage,
  deleteWikiPage,
  getAllWikiPages,
  getWikiPageHistory,
  compareWikiRevisions,
  revertWikiPage,
  lockWikiPage,
  createWikiDiscussion,
  getWikiSettings,
  updateWikiSettings,
  manageWikiContributors,
  manageWikiBannedUsers,
  updateWikiPageOrder,
};
