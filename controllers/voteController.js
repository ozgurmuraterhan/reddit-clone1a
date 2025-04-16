const Vote = require('../models/Vote');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Post için oy ver (upvote/downvote)
 * @route   POST /api/posts/:postId/vote
 * @access  Private
 */
const votePost = asyncHandler(async (req, res, next) => {
  const { postId } = req.params;
  const { value } = req.body;
  const userId = req.user.id;

  // Oy değeri doğrulama
  if (![1, 0, -1].includes(Number(value))) {
    return next(
      new ErrorResponse('Oy değeri 1 (upvote), 0 (kaldır) veya -1 (downvote) olmalıdır', 400),
    );
  }

  // MongoDB transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Post'un varlığını kontrol et
    const post = await Post.findById(postId).session(session);
    if (!post) {
      await session.abortTransaction();
      return next(new ErrorResponse('Post bulunamadı', 404));
    }

    // Kendi postlarına oy verme kontrolü (opsiyonel)
    if (post.author.toString() === userId && Number(value) !== 0) {
      await session.abortTransaction();
      return next(new ErrorResponse('Kendi postunuza oy veremezsiniz', 403));
    }

    // Mevcut oy kontrolü
    let existingVote = await Vote.findOne({
      user: userId,
      post: postId,
    }).session(session);

    const previousVoteValue = existingVote ? existingVote.value : 0;
    const voteChange = Number(value) - previousVoteValue;

    // Oy değişikliği yoksa erken çık
    if (voteChange === 0) {
      await session.abortTransaction();
      return res.status(200).json({
        success: true,
        data: existingVote,
        message: 'Oy değişmedi',
      });
    }

    // Post'un oy sayılarını güncelle
    if (previousVoteValue === 1 && Number(value) !== 1) {
      // Upvote kaldırıldı
      post.upvotes -= 1;
    } else if (previousVoteValue !== 1 && Number(value) === 1) {
      // Upvote eklendi
      post.upvotes += 1;
    }

    if (previousVoteValue === -1 && Number(value) !== -1) {
      // Downvote kaldırıldı
      post.downvotes -= 1;
    } else if (previousVoteValue !== -1 && Number(value) === -1) {
      // Downvote eklendi
      post.downvotes += 1;
    }

    // Post'un toplam skorunu güncelle
    post.score = post.upvotes - post.downvotes;
    await post.save({ session });

    // Oy yoksa oluştur, varsa güncelle veya sil
    if (!existingVote) {
      if (Number(value) !== 0) {
        // Yeni oy oluştur
        existingVote = await Vote.create(
          [
            {
              user: userId,
              post: postId,
              value: Number(value),
            },
          ],
          { session },
        );
        existingVote = existingVote[0]; // create with session returns array
      }
    } else {
      if (Number(value) === 0) {
        // Oyu kaldır
        await Vote.findByIdAndDelete(existingVote._id, { session });
        existingVote = null;
      } else {
        // Oyu güncelle
        existingVote.value = Number(value);
        await existingVote.save({ session });
      }
    }

    // Post sahibinin karma puanını güncelle
    if (post.author.toString() !== userId) {
      // Kendi postuna verilen oylar karma etkilemez
      const postAuthor = await User.findById(post.author).session(session);
      postAuthor.karma.post += voteChange;
      await postAuthor.save({ session });
    }

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {
        vote: existingVote,
        post: {
          id: post._id,
          score: post.score,
          upvotes: post.upvotes,
          downvotes: post.downvotes,
        },
      },
      message:
        Number(value) === 0
          ? 'Oy kaldırıldı'
          : Number(value) === 1
            ? 'Upvote verildi'
            : 'Downvote verildi',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse(`Oy işlemi sırasında hata oluştu: ${error.message}`, 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Yorum için oy ver (upvote/downvote)
 * @route   POST /api/comments/:commentId/vote
 * @access  Private
 */
const voteComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const { value } = req.body;
  const userId = req.user.id;

  // Oy değeri doğrulama
  if (![1, 0, -1].includes(Number(value))) {
    return next(
      new ErrorResponse('Oy değeri 1 (upvote), 0 (kaldır) veya -1 (downvote) olmalıdır', 400),
    );
  }

  // MongoDB transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Yorum varlığını kontrol et
    const comment = await Comment.findById(commentId).session(session);
    if (!comment) {
      await session.abortTransaction();
      return next(new ErrorResponse('Yorum bulunamadı', 404));
    }

    // Kendi yorumlarına oy verme kontrolü (opsiyonel)
    if (comment.author.toString() === userId && Number(value) !== 0) {
      await session.abortTransaction();
      return next(new ErrorResponse('Kendi yorumunuza oy veremezsiniz', 403));
    }

    // Mevcut oy kontrolü
    let existingVote = await Vote.findOne({
      user: userId,
      comment: commentId,
    }).session(session);

    const previousVoteValue = existingVote ? existingVote.value : 0;
    const voteChange = Number(value) - previousVoteValue;

    // Oy değişikliği yoksa erken çık
    if (voteChange === 0) {
      await session.abortTransaction();
      return res.status(200).json({
        success: true,
        data: existingVote,
        message: 'Oy değişmedi',
      });
    }

    // Yorum'un oy sayılarını güncelle
    if (previousVoteValue === 1 && Number(value) !== 1) {
      // Upvote kaldırıldı
      comment.upvotes -= 1;
    } else if (previousVoteValue !== 1 && Number(value) === 1) {
      // Upvote eklendi
      comment.upvotes += 1;
    }

    if (previousVoteValue === -1 && Number(value) !== -1) {
      // Downvote kaldırıldı
      comment.downvotes -= 1;
    } else if (previousVoteValue !== -1 && Number(value) === -1) {
      // Downvote eklendi
      comment.downvotes += 1;
    }

    // Yorum'un toplam skorunu güncelle
    comment.score = comment.upvotes - comment.downvotes;
    await comment.save({ session });

    // Oy yoksa oluştur, varsa güncelle veya sil
    if (!existingVote) {
      if (Number(value) !== 0) {
        // Yeni oy oluştur
        existingVote = await Vote.create(
          [
            {
              user: userId,
              comment: commentId,
              value: Number(value),
            },
          ],
          { session },
        );
        existingVote = existingVote[0]; // create with session returns array
      }
    } else {
      if (Number(value) === 0) {
        // Oyu kaldır
        await Vote.findByIdAndDelete(existingVote._id, { session });
        existingVote = null;
      } else {
        // Oyu güncelle
        existingVote.value = Number(value);
        await existingVote.save({ session });
      }
    }

    // Yorum sahibinin karma puanını güncelle
    if (comment.author.toString() !== userId) {
      // Kendi yorumuna verilen oylar karma etkilemez
      const commentAuthor = await User.findById(comment.author).session(session);
      commentAuthor.karma.comment += voteChange;
      await commentAuthor.save({ session });
    }

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {
        vote: existingVote,
        comment: {
          id: comment._id,
          score: comment.score,
          upvotes: comment.upvotes,
          downvotes: comment.downvotes,
        },
      },
      message:
        Number(value) === 0
          ? 'Oy kaldırıldı'
          : Number(value) === 1
            ? 'Upvote verildi'
            : 'Downvote verildi',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse(`Oy işlemi sırasında hata oluştu: ${error.message}`, 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Kullanıcının post için verdiği oyu al
 * @route   GET /api/posts/:postId/vote
 * @access  Private
 */
const getPostVote = asyncHandler(async (req, res, next) => {
  const { postId } = req.params;
  const userId = req.user.id;

  // Post'un varlığını kontrol et
  const postExists = await Post.exists({ _id: postId });
  if (!postExists) {
    return next(new ErrorResponse('Post bulunamadı', 404));
  }

  // Kullanıcının oyunu bul
  const vote = await Vote.findOne({
    user: userId,
    post: postId,
  });

  res.status(200).json({
    success: true,
    data: vote ? vote.value : 0,
  });
});

/**
 * @desc    Kullanıcının yorum için verdiği oyu al
 * @route   GET /api/comments/:commentId/vote
 * @access  Private
 */
const getCommentVote = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const userId = req.user.id;

  // Yorum'un varlığını kontrol et
  const commentExists = await Comment.exists({ _id: commentId });
  if (!commentExists) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  // Kullanıcının oyunu bul
  const vote = await Vote.findOne({
    user: userId,
    comment: commentId,
  });

  res.status(200).json({
    success: true,
    data: vote ? vote.value : 0,
  });
});

/**
 * @desc    Kullanıcının tüm oylarını getir
 * @route   GET /api/users/votes
 * @access  Private
 */
const getUserVotes = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { type } = req.query; // 'post', 'comment', or undefined for all
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  let query = { user: userId };

  // Tip filtrelemesi
  if (type === 'post') {
    query.post = { $exists: true };
  } else if (type === 'comment') {
    query.comment = { $exists: true };
  }

  // Toplam sayıyı hesapla
  const total = await Vote.countDocuments(query);

  // Oyları getir
  const votes = await Vote.find(query)
    .sort({ updatedAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate([
      {
        path: 'post',
        select: 'title content score upvotes downvotes createdAt',
        populate: { path: 'author', select: 'username profilePicture' },
      },
      {
        path: 'comment',
        select: 'content score upvotes downvotes createdAt',
        populate: [
          { path: 'author', select: 'username profilePicture' },
          { path: 'post', select: 'title' },
        ],
      },
    ]);

  // Pagination bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalCount: total,
  };

  if (startIndex + limit < total) {
    pagination.next = { page: page + 1, limit };
  }

  if (startIndex > 0) {
    pagination.prev = { page: page - 1, limit };
  }

  res.status(200).json({
    success: true,
    pagination,
    count: votes.length,
    data: votes,
  });
});

/**
 * @desc    Bir post'un tüm oylarını getir
 * @route   GET /api/admin/posts/:postId/votes
 * @access  Private/Admin
 */
const getPostVotes = asyncHandler(async (req, res, next) => {
  const { postId } = req.params;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const sortBy = req.query.sortBy || 'createdAt';
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1;

  // Post'un varlığını kontrol et
  const post = await Post.findById(postId);
  if (!post) {
    return next(new ErrorResponse('Post bulunamadı', 404));
  }

  // Sorgu ayarları
  const sort = {};
  sort[sortBy] = sortDir;

  // Oyları getir
  const total = await Vote.countDocuments({ post: postId });

  const votes = await Vote.find({ post: postId })
    .sort(sort)
    .skip(startIndex)
    .limit(limit)
    .populate('user', 'username profilePicture');

  // Pagination bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalCount: total,
  };

  if (startIndex + limit < total) {
    pagination.next = { page: page + 1, limit };
  }

  if (startIndex > 0) {
    pagination.prev = { page: page - 1, limit };
  }

  // Oy dağılımı özeti
  const voteSummary = {
    total: post.upvotes + post.downvotes,
    upvotes: post.upvotes,
    downvotes: post.downvotes,
    score: post.score,
    upvotePercentage:
      post.upvotes + post.downvotes > 0
        ? Math.round((post.upvotes / (post.upvotes + post.downvotes)) * 100)
        : 0,
  };

  res.status(200).json({
    success: true,
    data: {
      votes,
      summary: voteSummary,
    },
    pagination,
  });
});

/**
 * @desc    Bir yorumun tüm oylarını getir
 * @route   GET /api/admin/comments/:commentId/votes
 * @access  Private/Admin
 */
const getCommentVotes = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const sortBy = req.query.sortBy || 'createdAt';
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1;

  // Yorum'un varlığını kontrol et
  const comment = await Comment.findById(commentId);
  if (!comment) {
    return next(new ErrorResponse('Yorum bulunamadı', 404));
  }

  // Sorgu ayarları
  const sort = {};
  sort[sortBy] = sortDir;

  // Oyları getir
  const total = await Vote.countDocuments({ comment: commentId });

  const votes = await Vote.find({ comment: commentId })
    .sort(sort)
    .skip(startIndex)
    .limit(limit)
    .populate('user', 'username profilePicture');

  // Pagination bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalCount: total,
  };

  if (startIndex + limit < total) {
    pagination.next = { page: page + 1, limit };
  }

  if (startIndex > 0) {
    pagination.prev = { page: page - 1, limit };
  }

  // Oy dağılımı özeti
  const voteSummary = {
    total: comment.upvotes + comment.downvotes,
    upvotes: comment.upvotes,
    downvotes: comment.downvotes,
    score: comment.score,
    upvotePercentage:
      comment.upvotes + comment.downvotes > 0
        ? Math.round((comment.upvotes / (comment.upvotes + comment.downvotes)) * 100)
        : 0,
  };

  res.status(200).json({
    success: true,
    data: {
      votes,
      summary: voteSummary,
    },
    pagination,
  });
});

/**
 * @desc    Kullanıcının oylarını toplu olarak getir (belirli içerik için)
 * @route   POST /api/votes/batch
 * @access  Private
 */
const getBatchVotes = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { postIds, commentIds } = req.body;

  if ((!postIds || !postIds.length) && (!commentIds || !commentIds.length)) {
    return next(new ErrorResponse("En az bir post veya yorum ID'si belirtilmelidir", 400));
  }

  // ID'lerin geçerliliğini kontrol et
  const validPostIds = postIds ? postIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) : [];
  const validCommentIds = commentIds
    ? commentIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
    : [];

  // Kullanıcının verilen post ve yorumlardaki oylarını al
  const query = { user: userId };

  if (validPostIds.length > 0) {
    query.post = { $in: validPostIds };
  }

  if (validCommentIds.length > 0) {
    query.comment = { $in: validCommentIds };
  }

  const votes = await Vote.find(query);

  // Sonuçları işle
  const postVotes = {};
  const commentVotes = {};

  votes.forEach((vote) => {
    if (vote.post) {
      postVotes[vote.post.toString()] = vote.value;
    } else if (vote.comment) {
      commentVotes[vote.comment.toString()] = vote.value;
    }
  });

  res.status(200).json({
    success: true,
    data: {
      posts: postVotes,
      comments: commentVotes,
    },
  });
});

/**
 * @desc    Popüler postları oy skoruna göre getir
 * @route   GET /api/posts/top
 * @access  Public
 */
const getTopPosts = asyncHandler(async (req, res, next) => {
  const timeFrame = req.query.time || 'day'; // day, week, month, year, all
  const limit = parseInt(req.query.limit, 10) || 20;
  const page = parseInt(req.query.page, 10) || 1;
  const startIndex = (page - 1) * limit;

  // Zaman aralığı filtresi oluştur
  let dateFilter = {};
  const now = new Date();

  if (timeFrame === 'day') {
    dateFilter = { createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) } };
  } else if (timeFrame === 'week') {
    dateFilter = { createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } };
  } else if (timeFrame === 'month') {
    dateFilter = { createdAt: { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) } };
  } else if (timeFrame === 'year') {
    dateFilter = { createdAt: { $gte: new Date(now - 365 * 24 * 60 * 60 * 1000) } };
  }

  // NSFW içerik filtresi
  let nsfwFilter = {};
  if (!req.user || !req.user.settings || !req.user.settings.contentPreferences.showNSFWContent) {
    nsfwFilter = { nsfw: { $ne: true } };
  }

  // Toplam sayım
  const total = await Post.countDocuments({
    ...dateFilter,
    ...nsfwFilter,
    isDeleted: false,
  });

  // En çok oy alan postları getir
  const posts = await Post.find({
    ...dateFilter,
    ...nsfwFilter,
    isDeleted: false,
  })
    .sort({ score: -1, createdAt: -1 })
    .skip(startIndex)
    .limit(limit)
    .populate('author', 'username profilePicture')
    .populate('subreddit', 'name title icon');

  // Pagination bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalCount: total,
  };

  if (startIndex + limit < total) {
    pagination.next = { page: page + 1, limit };
  }

  if (startIndex > 0) {
    pagination.prev = { page: page - 1, limit };
  }

  res.status(200).json({
    success: true,
    timeFrame,
    count: posts.length,
    pagination,
    data: posts,
  });
});

/**
 * @desc    Oy verme trendi raporları (Admin)
 * @route   GET /api/admin/analytics/votes
 * @access  Private/Admin
 */
const getVoteAnalytics = asyncHandler(async (req, res, next) => {
  const timeFrame = req.query.time || 'week'; // day, week, month, year
  const type = req.query.type || 'all'; // all, post, comment

  let dateFilter = {};
  const now = new Date();

  if (timeFrame === 'day') {
    dateFilter = { createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) } };
  } else if (timeFrame === 'week') {
    dateFilter = { createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } };
  } else if (timeFrame === 'month') {
    dateFilter = { createdAt: { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) } };
  } else if (timeFrame === 'year') {
    dateFilter = { createdAt: { $gte: new Date(now - 365 * 24 * 60 * 60 * 1000) } };
  }

  // İçerik tipine göre filtre
  let typeFilter = {};
  if (type === 'post') {
    typeFilter = { post: { $exists: true } };
  } else if (type === 'comment') {
    typeFilter = { comment: { $exists: true } };
  }

  // Toplam oy sayısı
  const totalVotes = await Vote.countDocuments({
    ...dateFilter,
    ...typeFilter,
  });

  // Oy değeri dağılımı
  const voteDistribution = await Vote.aggregate([
    {
      $match: {
        ...dateFilter,
        ...typeFilter,
      },
    },
    {
      $group: {
        _id: '$value',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        value: '$_id',
        count: 1,
        _id: 0,
      },
    },
    {
      $sort: { value: -1 },
    },
  ]);

  // Zamanla oy sayılarını al (günlük dağılım)
  const votesOverTime = await Vote.aggregate([
    {
      $match: {
        ...dateFilter,
        ...typeFilter,
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        upvotes: {
          $sum: { $cond: [{ $eq: ['$value', 1] }, 1, 0] },
        },
        downvotes: {
          $sum: { $cond: [{ $eq: ['$value', -1] }, 1, 0] },
        },
        total: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      timeFrame,
      type,
      totalVotes,
      voteDistribution,
      votesOverTime: votesOverTime.map((item) => ({
        date: item._id,
        upvotes: item.upvotes,
        downvotes: item.downvotes,
        total: item.total,
        ratio: item.total > 0 ? item.upvotes / item.total : 0,
      })),
    },
  });
});

/**
 * @desc    Oyları admin olarak sil (moderasyon amaçlı)
 * @route   DELETE /api/admin/votes/:voteId
 * @access  Private/Admin
 */
const deleteVote = asyncHandler(async (req, res, next) => {
  const { voteId } = req.params;
  const reason = req.body.reason || 'Moderasyon kararı';

  // MongoDB transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Oy varlığını kontrol et
    const vote = await Vote.findById(voteId).session(session);
    if (!vote) {
      await session.abortTransaction();
      return next(new ErrorResponse('Oy bulunamadı', 404));
    }

    // İlgili içeriği bul ve oy sayılarını güncelle
    if (vote.post) {
      const post = await Post.findById(vote.post).session(session);
      if (post) {
        if (vote.value === 1) {
          post.upvotes = Math.max(0, post.upvotes - 1);
        } else if (vote.value === -1) {
          post.downvotes = Math.max(0, post.downvotes - 1);
        }
        post.score = post.upvotes - post.downvotes;
        await post.save({ session });

        // Post sahibinin karma puanını güncelle
        const postAuthor = await User.findById(post.author).session(session);
        if (postAuthor) {
          postAuthor.karma.post -= vote.value; // Oy değeriyle karşıt olarak güncelle
          await postAuthor.save({ session });
        }
      }
    } else if (vote.comment) {
      const comment = await Comment.findById(vote.comment).session(session);
      if (comment) {
        if (vote.value === 1) {
          comment.upvotes = Math.max(0, comment.upvotes - 1);
        } else if (vote.value === -1) {
          comment.downvotes = Math.max(0, comment.downvotes - 1);
        }
        comment.score = comment.upvotes - comment.downvotes;
        await comment.save({ session });

        // Yorum sahibinin karma puanını güncelle
        const commentAuthor = await User.findById(comment.author).session(session);
        if (commentAuthor) {
          commentAuthor.karma.comment -= vote.value; // Oy değeriyle karşıt olarak güncelle
          await commentAuthor.save({ session });
        }
      }
    }

    // Oy kaydını silmeden önce moderasyon logu oluştur
    await mongoose.model('ModLog').create(
      [
        {
          action: 'vote_remove',
          actionBy: req.user.id,
          actionDetails: {
            voteId: vote._id,
            userId: vote.user,
            targetType: vote.post ? 'post' : 'comment',
            targetId: vote.post || vote.comment,
            voteValue: vote.value,
          },
          reason,
        },
      ],
      { session },
    );

    // Oy kaydını sil
    await Vote.findByIdAndDelete(voteId, { session });

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Oy başarıyla silindi ve ilgili içerik güncellendi',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse(`Oy silme işlemi sırasında hata oluştu: ${error.message}`, 500));
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Bir kullanıcının oy geçmişini getir (Admin)
 * @route   GET /api/admin/users/:userId/votes
 * @access  Private/Admin
 */
const getUserVotesAdmin = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const type = req.query.type || 'all'; // all, post, comment
  const sortBy = req.query.sortBy || 'createdAt';
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1;

  // Kullanıcı varlığını kontrol et
  const userExists = await User.exists({ _id: userId });
  if (!userExists) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Sorgu filtrelerini oluştur
  let query = { user: userId };
  if (type === 'post') {
    query.post = { $exists: true };
  } else if (type === 'comment') {
    query.comment = { $exists: true };
  }

  // Sıralama ayarları
  const sort = {};
  sort[sortBy] = sortDir;

  // Toplam sayıyı hesapla
  const total = await Vote.countDocuments(query);

  // Oyları getir
  const votes = await Vote.find(query)
    .sort(sort)
    .skip(startIndex)
    .limit(limit)
    .populate([
      {
        path: 'post',
        select: 'title content score upvotes downvotes createdAt',
        populate: { path: 'author', select: 'username profilePicture' },
      },
      {
        path: 'comment',
        select: 'content score upvotes downvotes createdAt',
        populate: [
          { path: 'author', select: 'username profilePicture' },
          { path: 'post', select: 'title' },
        ],
      },
    ]);

  // Oy istatistiklerini hesapla
  const upvotes = await Vote.countDocuments({ user: userId, value: 1 });
  const downvotes = await Vote.countDocuments({ user: userId, value: -1 });
  const postVotes = await Vote.countDocuments({ user: userId, post: { $exists: true } });
  const commentVotes = await Vote.countDocuments({ user: userId, comment: { $exists: true } });

  // Pagination bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalCount: total,
  };

  if (startIndex + limit < total) {
    pagination.next = { page: page + 1, limit };
  }

  if (startIndex > 0) {
    pagination.prev = { page: page - 1, limit };
  }

  res.status(200).json({
    success: true,
    data: {
      votes,
      stats: {
        total,
        upvotes,
        downvotes,
        postVotes,
        commentVotes,
      },
    },
    pagination,
  });
});

/**
 * @desc    Bir kullanıcının karma güncellemesini manuel olarak tetikle (Admin)
 * @route   POST /api/admin/users/:userId/recalculate-karma
 * @access  Private/Admin
 */
const recalculateUserKarma = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Kullanıcı varlığını kontrol et
  const user = await User.findById(userId);
  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // MongoDB transaction başlat
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Post karmasını hesapla
    const postUpvotes = await Vote.countDocuments({
      post: { $in: await Post.find({ author: userId }).distinct('_id') },
      value: 1,
    }).session(session);

    const postDownvotes = await Vote.countDocuments({
      post: { $in: await Post.find({ author: userId }).distinct('_id') },
      value: -1,
    }).session(session);

    // Yorum karmasını hesapla
    const commentUpvotes = await Vote.countDocuments({
      comment: { $in: await Comment.find({ author: userId }).distinct('_id') },
      value: 1,
    }).session(session);

    const commentDownvotes = await Vote.countDocuments({
      comment: { $in: await Comment.find({ author: userId }).distinct('_id') },
      value: -1,
    }).session(session);

    // Karma değerlerini güncelle
    user.karma.post = postUpvotes - postDownvotes;
    user.karma.comment = commentUpvotes - commentDownvotes;

    // Not: awardee ve awarder karma değerleri ayrı bir sistemle ele alınabilir
    // Bu örnekte karma değerlerinin sadece oylardan etkilendiğini varsayıyoruz

    await user.save({ session });

    // Moderasyon log kaydı
    await mongoose.model('ModLog').create(
      [
        {
          action: 'karma_recalculate',
          actionBy: req.user.id,
          actionDetails: {
            userId: user._id,
            previousKarma: {
              post: user.karma.post - (postUpvotes - postDownvotes),
              comment: user.karma.comment - (commentUpvotes - commentDownvotes),
            },
            newKarma: {
              post: user.karma.post,
              comment: user.karma.comment,
            },
          },
          reason: req.body.reason || 'Manuel karma hesaplaması',
        },
      ],
      { session },
    );

    // İşlemi tamamla
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      data: {
        userId: user._id,
        username: user.username,
        karma: {
          post: user.karma.post,
          comment: user.karma.comment,
          awardee: user.karma.awardee,
          awarder: user.karma.awarder,
          total: user.karma.post + user.karma.comment + user.karma.awardee + user.karma.awarder,
        },
      },
      message: 'Kullanıcı karma değerleri başarıyla yeniden hesaplandı',
    });
  } catch (error) {
    await session.abortTransaction();
    return next(new ErrorResponse(`Karma hesaplama sırasında hata oluştu: ${error.message}`, 500));
  } finally {
    session.endSession();
  }
});

module.exports = {
  votePost,
  voteComment,
  getPostVote,
  getCommentVote,
  getUserVotes,
  getPostVotes,
  getCommentVotes,
  getBatchVotes,
  getTopPosts,
  getVoteAnalytics,
  deleteVote,
  getUserVotesAdmin,
  recalculateUserKarma,
};
