const { EditHistory, Post, Comment, Subreddit, SubredditMembership } = require('../models');
const mongoose = require('mongoose');

/**
 * @desc    İçeriğin düzenleme geçmişini getir
 * @route   GET /api/posts/:postId/edit-history
 * @route   GET /api/comments/:commentId/edit-history
 * @access  Public
 */
const getContentEditHistory = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Hangi içerik türü için geçmiş isteniyor kontrol et
    if (!postId && !commentId) {
      return res.status(400).json({
        success: false,
        message: 'Post ID veya Comment ID gereklidir',
      });
    }

    let contentType, contentId, originalContent;

    // Post geçmişi için
    if (postId) {
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz post ID formatı',
        });
      }

      contentType = 'post';
      contentId = postId;

      // Orijinal postu kontrol et
      const post = await Post.findById(postId);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post bulunamadı',
        });
      }

      originalContent = post;
    }

    // Yorum geçmişi için
    if (commentId) {
      if (!mongoose.Types.ObjectId.isValid(commentId)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz yorum ID formatı',
        });
      }

      contentType = 'comment';
      contentId = commentId;

      // Orijinal yorumu kontrol et
      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Yorum bulunamadı',
        });
      }

      originalContent = comment;
    }

    // Düzenleme geçmişini getir
    const editHistory = await EditHistory.find({
      contentType,
      contentId,
    })
      .sort({ editedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('editedBy', 'username avatar');

    const totalEdits = await EditHistory.countDocuments({
      contentType,
      contentId,
    });

    res.status(200).json({
      success: true,
      currentContent: {
        content: contentType === 'post' ? originalContent.content : originalContent.text,
        updatedAt: originalContent.updatedAt,
      },
      count: editHistory.length,
      total: totalEdits,
      totalPages: Math.ceil(totalEdits / limit),
      currentPage: page,
      data: editHistory,
    });
  } catch (error) {
    console.error('Get content edit history error:', error);
    res.status(500).json({
      success: false,
      message: 'Düzenleme geçmişi getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Belirli bir düzenlemenin detayını getir
 * @route   GET /api/edit-history/:editId
 * @access  Public
 */
const getEditById = async (req, res) => {
  try {
    const { editId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(editId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz düzenleme ID formatı',
      });
    }

    const edit = await EditHistory.findById(editId).populate('editedBy', 'username avatar');

    if (!edit) {
      return res.status(404).json({
        success: false,
        message: 'Düzenleme kaydı bulunamadı',
      });
    }

    res.status(200).json({
      success: true,
      data: edit,
    });
  } catch (error) {
    console.error('Get edit by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Düzenleme detayı getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Yeni bir düzenleme kaydı oluştur
 * @route   POST /api/posts/:postId/edit-history
 * @route   POST /api/comments/:commentId/edit-history
 * @access  Private
 */
const createEditHistory = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { previousContent, reason } = req.body;
    const userId = req.user._id;

    // Hangi içerik türü için geçmiş oluşturuluyor kontrol et
    if (!postId && !commentId) {
      return res.status(400).json({
        success: false,
        message: 'Post ID veya Comment ID gereklidir',
      });
    }

    if (!previousContent) {
      return res.status(400).json({
        success: false,
        message: 'Önceki içerik gereklidir',
      });
    }

    let contentType, contentId, originalContent;

    // Post düzenlemesi için
    if (postId) {
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz post ID formatı',
        });
      }

      contentType = 'post';
      contentId = postId;

      // Orijinal postu kontrol et
      const post = await Post.findById(postId);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post bulunamadı',
        });
      }

      // Yalnızca post sahibi veya moderatör düzenleyebilir
      if (!post.author.equals(userId) && req.user.role !== 'admin') {
        // Kullanıcı moderatör mü kontrol et
        const isModerator = await SubredditMembership.exists({
          user: userId,
          subreddit: post.subreddit,
          isModerator: true,
        });

        if (!isModerator) {
          return res.status(403).json({
            success: false,
            message: 'Bu işlemi gerçekleştirmek için yetkiniz yok',
          });
        }
      }

      originalContent = post;
    }

    // Yorum düzenlemesi için
    if (commentId) {
      if (!mongoose.Types.ObjectId.isValid(commentId)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz yorum ID formatı',
        });
      }

      contentType = 'comment';
      contentId = commentId;

      // Orijinal yorumu kontrol et
      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Yorum bulunamadı',
        });
      }

      // Yalnızca yorum sahibi veya moderatör düzenleyebilir
      if (!comment.author.equals(userId) && req.user.role !== 'admin') {
        // Post'u bul ve subreddit'i öğren
        const post = await Post.findById(comment.post);
        if (!post) {
          return res.status(404).json({
            success: false,
            message: 'Yoruma ait post bulunamadı',
          });
        }

        // Kullanıcı moderatör mü kontrol et
        const isModerator = await SubredditMembership.exists({
          user: userId,
          subreddit: post.subreddit,
          isModerator: true,
        });

        if (!isModerator) {
          return res.status(403).json({
            success: false,
            message: 'Bu işlemi gerçekleştirmek için yetkiniz yok',
          });
        }
      }

      originalContent = comment;
    }

    // Düzenleme kaydı oluştur
    const newEditHistory = await EditHistory.create({
      contentType,
      contentId,
      previousContent,
      editedBy: userId,
      reason: reason || 'Düzenleme nedeni belirtilmedi',
      editedAt: Date.now(),
    });

    res.status(201).json({
      success: true,
      message: 'Düzenleme kaydı başarıyla oluşturuldu',
      data: newEditHistory,
    });
  } catch (error) {
    console.error('Create edit history error:', error);
    res.status(500).json({
      success: false,
      message: 'Düzenleme kaydı oluşturulurken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Belirli bir kullanıcının son düzenlemelerini getir
 * @route   GET /api/users/:userId/edit-history
 * @access  Private
 */
const getUserEditHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz kullanıcı ID formatı',
      });
    }

    // Sadece kendisi veya admin kullanıcının düzenleme geçmişini görebilir
    if (!req.user._id.equals(userId) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu kullanıcının düzenleme geçmişini görüntülemek için yetkiniz yok',
      });
    }

    // Kullanıcının düzenleme geçmişini getir
    const editHistory = await EditHistory.find({
      editedBy: userId,
    })
      .sort({ editedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'contentId',
        select: contentType === 'post' ? 'title' : 'text',
        model: contentType === 'post' ? 'Post' : 'Comment',
      });

    const totalEdits = await EditHistory.countDocuments({
      editedBy: userId,
    });

    res.status(200).json({
      success: true,
      count: editHistory.length,
      total: totalEdits,
      totalPages: Math.ceil(totalEdits / limit),
      currentPage: page,
      data: editHistory,
    });
  } catch (error) {
    console.error('Get user edit history error:', error);
    res.status(500).json({
      success: false,
      message: 'Kullanıcı düzenleme geçmişi getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Subreddit düzenleme geçmişini getir
 * @route   GET /api/subreddits/:subredditId/edit-history
 * @access  Private/Moderator
 */
const getSubredditEditHistory = async (req, res) => {
  try {
    const { subredditId } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

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

    // Subreddit'e ait postların ID'lerini al
    const posts = await Post.find({ subreddit: subredditId }, '_id');
    const postIds = posts.map((post) => post._id);

    // Yorumları al
    const comments = await Comment.find({ post: { $in: postIds } }, '_id');
    const commentIds = comments.map((comment) => comment._id);

    // Tüm düzenleme geçmişini getir
    const editHistory = await EditHistory.find({
      $or: [
        { contentType: 'post', contentId: { $in: postIds } },
        { contentType: 'comment', contentId: { $in: commentIds } },
      ],
    })
      .sort({ editedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('editedBy', 'username avatar')
      .populate({
        path: 'contentId',
        select: 'title text',
        refPath: (contentType) => (contentType === 'post' ? 'Post' : 'Comment'),
      });

    const totalEdits = await EditHistory.countDocuments({
      $or: [
        { contentType: 'post', contentId: { $in: postIds } },
        { contentType: 'comment', contentId: { $in: commentIds } },
      ],
    });

    res.status(200).json({
      success: true,
      count: editHistory.length,
      total: totalEdits,
      totalPages: Math.ceil(totalEdits / limit),
      currentPage: page,
      data: editHistory,
    });
  } catch (error) {
    console.error('Get subreddit edit history error:', error);
    res.status(500).json({
      success: false,
      message: 'Subreddit düzenleme geçmişi getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    İçeriğin düzenleme sayısını getir
 * @route   GET /api/posts/:postId/edit-count
 * @route   GET /api/comments/:commentId/edit-count
 * @access  Public
 */
const getContentEditCount = async (req, res) => {
  try {
    const { postId, commentId } = req.params;

    // Hangi içerik türü için geçmiş isteniyor kontrol et
    if (!postId && !commentId) {
      return res.status(400).json({
        success: false,
        message: 'Post ID veya Comment ID gereklidir',
      });
    }

    let contentType, contentId;

    // Post geçmişi için
    if (postId) {
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz post ID formatı',
        });
      }

      contentType = 'post';
      contentId = postId;

      // Orijinal postu kontrol et
      const post = await Post.findById(postId);
      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post bulunamadı',
        });
      }
    }

    // Yorum geçmişi için
    if (commentId) {
      if (!mongoose.Types.ObjectId.isValid(commentId)) {
        return res.status(400).json({
          success: false,
          message: 'Geçersiz yorum ID formatı',
        });
      }

      contentType = 'comment';
      contentId = commentId;

      // Orijinal yorumu kontrol et
      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Yorum bulunamadı',
        });
      }
    }

    // Düzenleme sayısını getir
    const editCount = await EditHistory.countDocuments({
      contentType,
      contentId,
    });

    // Son düzenleme bilgisini getir
    const lastEdit = await EditHistory.findOne({
      contentType,
      contentId,
    })
      .sort({ editedAt: -1 })
      .populate('editedBy', 'username');

    res.status(200).json({
      success: true,
      data: {
        editCount,
        lastEdit: lastEdit
          ? {
              editedAt: lastEdit.editedAt,
              editedBy: lastEdit.editedBy.username,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Get content edit count error:', error);
    res.status(500).json({
      success: false,
      message: 'Düzenleme sayısı getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    İki düzenleme arasındaki farkı getir
 * @route   GET /api/edit-history/compare
 * @access  Public
 */
const compareEdits = async (req, res) => {
  try {
    const { editId1, editId2, currentContent } = req.query;

    if (!editId1 || (!editId2 && !currentContent)) {
      return res.status(400).json({
        success: false,
        message:
          "Karşılaştırma için en az iki içerik gereklidir (iki düzenleme ID'si veya bir düzenleme ID'si ve mevcut içerik)",
      });
    }

    // İlk düzenlemeyi getir
    let edit1;
    if (editId1 && mongoose.Types.ObjectId.isValid(editId1)) {
      edit1 = await EditHistory.findById(editId1);

      if (!edit1) {
        return res.status(404).json({
          success: false,
          message: 'Belirtilen düzenleme kaydı bulunamadı',
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz düzenleme ID formatı',
      });
    }

    let content1 = edit1.previousContent;
    let content2;
    let timestamp1 = edit1.editedAt;
    let timestamp2;
    let editor1 = edit1.editedBy;
    let editor2;

    // İkinci içeriği belirle
    if (editId2 && mongoose.Types.ObjectId.isValid(editId2)) {
      const edit2 = await EditHistory.findById(editId2);

      if (!edit2) {
        return res.status(404).json({
          success: false,
          message: 'Belirtilen düzenleme kaydı bulunamadı',
        });
      }

      content2 = edit2.previousContent;
      timestamp2 = edit2.editedAt;
      editor2 = edit2.editedBy;
    } else if (currentContent) {
      // Mevcut içerikle karşılaştırma
      content2 = currentContent;
      timestamp2 = new Date();

      // İçeriğin mevcut sahibini bul
      if (edit1.contentType === 'post') {
        const post = await Post.findById(edit1.contentId).populate('author', 'username');
        if (post) {
          editor2 = post.author;
        }
      } else if (edit1.contentType === 'comment') {
        const comment = await Comment.findById(edit1.contentId).populate('author', 'username');
        if (comment) {
          editor2 = comment.author;
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Geçersiz ikinci içerik kaynağı',
      });
    }

    // Basit bir karşılaştırma yapılıyor
    // Gerçek uygulamada diff algoritması kullanılması önerilir
    const wordCount1 = content1.split(/\s+/).length;
    const wordCount2 = content2.split(/\s+/).length;
    const charCount1 = content1.length;
    const charCount2 = content2.length;

    const wordDiff = wordCount2 - wordCount1;
    const charDiff = charCount2 - charCount1;

    res.status(200).json({
      success: true,
      data: {
        content1,
        content2,
        timestamp1,
        timestamp2,
        editor1,
        editor2,
        statistics: {
          wordCount1,
          wordCount2,
          wordDiff,
          charCount1,
          charCount2,
          charDiff,
        },
      },
    });
  } catch (error) {
    console.error('Compare edits error:', error);
    res.status(500).json({
      success: false,
      message: 'Düzenlemeler karşılaştırılırken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Düzenleme geçmişi özeti
 * @route   GET /api/edit-history/summary
 * @access  Private/Admin
 */
const getEditHistorySummary = async (req, res) => {
  try {
    // Yetki kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu bilgilere erişmek için admin yetkileri gerekiyor',
      });
    }

    // Toplam düzenleme sayısı
    const totalEdits = await EditHistory.countDocuments();

    // İçerik türüne göre düzenleme dağılımı
    const contentTypeStats = await EditHistory.aggregate([
      { $group: { _id: '$contentType', count: { $sum: 1 } } },
    ]);

    // Son 7 gündeki düzenleme sayıları
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentEditsCount = await EditHistory.countDocuments({
      editedAt: { $gte: sevenDaysAgo },
    });

    // Günlük düzenleme trendi (son 7 gün)
    const dailyTrend = await EditHistory.aggregate([
      {
        $match: {
          editedAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$editedAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // En çok düzenleme yapan 5 kullanıcı
    const topEditors = await EditHistory.aggregate([
      {
        $group: {
          _id: '$editedBy',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    // Kullanıcı detaylarını ekle
    const editorIds = topEditors.map((editor) => editor._id);
    const editorDetails = await User.find({ _id: { $in: editorIds } }, { username: 1, avatar: 1 });

    const editorsMap = {};
    editorDetails.forEach((editor) => {
      editorsMap[editor._id.toString()] = {
        username: editor.username,
        avatar: editor.avatar,
      };
    });

    const topEditorsWithDetails = topEditors.map((editor) => ({
      userId: editor._id,
      editCount: editor.count,
      username: editorsMap[editor._id.toString()]?.username || 'Silinmiş Kullanıcı',
      avatar: editorsMap[editor._id.toString()]?.avatar,
    }));

    res.status(200).json({
      success: true,
      data: {
        totalEdits,
        recentEditsCount,
        contentTypeStats,
        dailyTrend,
        topEditors: topEditorsWithDetails,
      },
    });
  } catch (error) {
    console.error('Get edit history summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Düzenleme geçmişi özeti getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getContentEditHistory,
  getEditById,
  createEditHistory,
  getUserEditHistory,
  getSubredditEditHistory,
  getContentEditCount,
  compareEdits,
  getEditHistorySummary,
};
