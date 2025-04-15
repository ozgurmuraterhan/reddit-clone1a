const { Wiki, WikiRevision, Subreddit, SubredditMembership } = require('../models');

/**
 * Wiki sayfasını getir
 * @route GET /api/subreddits/:subredditName/wiki/:pageName
 * @access Public
 */
const getWikiPage = async (req, res) => {
  try {
    const { subredditName, pageName } = req.params;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Wiki sayfasını bul
    const wikiPage = await Wiki.findOne({
      subreddit: subreddit._id,
      name: pageName,
      isDeleted: false,
    }).populate('lastEditor', 'username');

    if (!wikiPage) {
      return res.status(404).json({
        success: false,
        message: 'Wiki sayfası bulunamadı',
      });
    }

    res.status(200).json({
      success: true,
      data: wikiPage,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Wiki sayfası getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Subreddit'in tüm wiki sayfalarını listele
 * @route GET /api/subreddits/:subredditName/wiki
 * @access Public
 */
const getWikiPages = async (req, res) => {
  try {
    const { subredditName } = req.params;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Wiki sayfalarını bul
    const wikiPages = await Wiki.find({
      subreddit: subreddit._id,
      isDeleted: false,
    })
      .select('name title lastUpdated lastEditor')
      .sort({ lastUpdated: -1 })
      .populate('lastEditor', 'username');

    res.status(200).json({
      success: true,
      count: wikiPages.length,
      data: wikiPages,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Wiki sayfaları listelenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Yeni wiki sayfası oluştur
 * @route POST /api/subreddits/:subredditName/wiki
 * @access Private/Moderator
 */
const createWikiPage = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const { name, title, content } = req.body;
    const userId = req.user._id;

    if (!name || !title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Sayfa adı, başlık ve içerik gereklidir',
      });
    }

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const membership = await SubredditMembership.findOne({
      user: userId,
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'Wiki sayfası oluşturmak için moderatör yetkiniz yok',
      });
    }

    // Aynı isimde sayfa var mı kontrol et
    const existingPage = await Wiki.findOne({
      subreddit: subreddit._id,
      name,
      isDeleted: false,
    });

    if (existingPage) {
      return res.status(400).json({
        success: false,
        message: 'Bu isimde bir wiki sayfası zaten mevcut',
      });
    }

    // Wiki sayfasını oluştur
    const wikiPage = await Wiki.create({
      subreddit: subreddit._id,
      name,
      title,
      content,
      creator: userId,
      lastEditor: userId,
      lastUpdated: new Date(),
    });

    // İlk revizyonu kaydet
    await WikiRevision.create({
      wiki: wikiPage._id,
      content,
      editor: userId,
      editReason: 'İlk oluşturma',
    });

    res.status(201).json({
      success: true,
      message: 'Wiki sayfası başarıyla oluşturuldu',
      data: wikiPage,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Wiki sayfası oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Wiki sayfasını güncelle
 * @route PUT /api/subreddits/:subredditName/wiki/:pageName
 * @access Private/Moderator
 */
const updateWikiPage = async (req, res) => {
  try {
    const { subredditName, pageName } = req.params;
    const { title, content, editReason } = req.body;
    const userId = req.user._id;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'İçerik alanı gereklidir',
      });
    }

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Wiki sayfasını bul
    const wikiPage = await Wiki.findOne({
      subreddit: subreddit._id,
      name: pageName,
      isDeleted: false,
    });

    if (!wikiPage) {
      return res.status(404).json({
        success: false,
        message: 'Wiki sayfası bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const membership = await SubredditMembership.findOne({
      user: userId,
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'Wiki sayfasını düzenlemek için moderatör yetkiniz yok',
      });
    }

    // Wiki sayfasını güncelle
    if (title) wikiPage.title = title;
    wikiPage.content = content;
    wikiPage.lastEditor = userId;
    wikiPage.lastUpdated = new Date();

    await wikiPage.save();

    // Yeni revizyonu kaydet
    await WikiRevision.create({
      wiki: wikiPage._id,
      content,
      editor: userId,
      editReason: editReason || 'Düzenleme',
    });

    res.status(200).json({
      success: true,
      message: 'Wiki sayfası başarıyla güncellendi',
      data: wikiPage,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Wiki sayfası güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Wiki sayfasının revizyonlarını getir
 * @route GET /api/subreddits/:subredditName/wiki/:pageName/revisions
 * @access Public
 */
const getWikiRevisions = async (req, res) => {
  try {
    const { subredditName, pageName } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Wiki sayfasını bul
    const wikiPage = await Wiki.findOne({
      subreddit: subreddit._id,
      name: pageName,
    });

    if (!wikiPage) {
      return res.status(404).json({
        success: false,
        message: 'Wiki sayfası bulunamadı',
      });
    }

    // Revizyonları getir
    const revisions = await WikiRevision.find({
      wiki: wikiPage._id,
    })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('editor', 'username');

    const totalRevisions = await WikiRevision.countDocuments({
      wiki: wikiPage._id,
    });

    res.status(200).json({
      success: true,
      count: revisions.length,
      total: totalRevisions,
      totalPages: Math.ceil(totalRevisions / limit),
      currentPage: page,
      data: revisions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Wiki revizyonları getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Wiki sayfasını sil
 * @route DELETE /api/subreddits/:subredditName/wiki/:pageName
 * @access Private/Moderator
 */
const deleteWikiPage = async (req, res) => {
  try {
    const { subredditName, pageName } = req.params;
    const userId = req.user._id;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Wiki sayfasını bul
    const wikiPage = await Wiki.findOne({
      subreddit: subreddit._id,
      name: pageName,
      isDeleted: false,
    });

    if (!wikiPage) {
      return res.status(404).json({
        success: false,
        message: 'Wiki sayfası bulunamadı',
      });
    }

    // Kullanıcının moderatör olup olmadığını kontrol et
    const membership = await SubredditMembership.findOne({
      user: userId,
      subreddit: subreddit._id,
      status: { $in: ['moderator', 'admin'] },
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'Wiki sayfasını silmek için moderatör yetkiniz yok',
      });
    }

    // Soft delete
    wikiPage.isDeleted = true;
    wikiPage.deletedAt = new Date();
    wikiPage.deletedBy = userId;

    await wikiPage.save();

    res.status(200).json({
      success: true,
      message: 'Wiki sayfası başarıyla silindi',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Wiki sayfası silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getWikiPage,
  getWikiPages,
  createWikiPage,
  updateWikiPage,
  getWikiRevisions,
  deleteWikiPage,
};
