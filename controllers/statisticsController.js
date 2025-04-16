const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const Subreddit = require('../models/Subreddit');
const Vote = require('../models/Vote');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const moment = require('moment');

/**
 * @desc    Tüm site istatistiklerini getir
 * @route   GET /api/statistics/site
 * @access  Public (Detailed stats for Admin)
 */
const getSiteStatistics = asyncHandler(async (req, res, next) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const timeRange = req.query.timeRange || 'all';

  // Zaman aralığı filtresi
  const timeFilter = getTimeFilter(timeRange);

  // Temel istatistikleri getir
  const [totalPosts, totalComments, totalUsers, totalSubreddits, totalVotes] = await Promise.all([
    Post.countDocuments({ isDeleted: false, ...timeFilter }),
    Comment.countDocuments({ isDeleted: false, ...timeFilter }),
    User.countDocuments({ isDeleted: false, ...timeFilter }),
    Subreddit.countDocuments({ isDeleted: false, ...timeFilter }),
    Vote.countDocuments(timeFilter),
  ]);

  // Temel cevap objesi
  const statistics = {
    totalPosts,
    totalComments,
    totalUsers,
    totalSubreddits,
    totalVotes,
    timeRange,
  };

  // Admin için daha detaylı istatistikler
  if (isAdmin) {
    // İçerik türü dağılımı
    const postTypeDistribution = await Post.aggregate([
      { $match: { isDeleted: false, ...(timeFilter || {}) } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Oy dağılımı
    const voteDistribution = await Vote.aggregate([
      { $match: timeFilter || {} },
      { $group: { _id: '$value', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    // Günlük aktivite
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

    const [dailyPosts, dailyComments, dailyUsers, dailyVotes] = await Promise.all([
      Post.aggregate([
        {
          $match: {
            isDeleted: false,
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Comment.aggregate([
        {
          $match: {
            isDeleted: false,
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      User.aggregate([
        {
          $match: {
            isDeleted: false,
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Vote.aggregate([
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // En aktif subredditler
    const topSubreddits = await Post.aggregate([
      { $match: { isDeleted: false, ...(timeFilter || {}) } },
      { $group: { _id: '$subreddit', postCount: { $sum: 1 } } },
      { $sort: { postCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'subreddits',
          localField: '_id',
          foreignField: '_id',
          as: 'subredditDetails',
        },
      },
      { $unwind: '$subredditDetails' },
      {
        $project: {
          _id: 1,
          postCount: 1,
          name: '$subredditDetails.name',
          title: '$subredditDetails.title',
          memberCount: '$subredditDetails.memberCount',
        },
      },
    ]);

    // Detaylı istatistikleri ekle
    statistics.detailed = {
      postTypeDistribution,
      voteDistribution: voteDistribution.reduce((obj, item) => {
        obj[item._id === 1 ? 'upvotes' : item._id === -1 ? 'downvotes' : 'novotes'] = item.count;
        return obj;
      }, {}),
      dailyActivity: {
        posts: dailyPosts,
        comments: dailyComments,
        users: dailyUsers,
        votes: dailyVotes,
      },
      topSubreddits,
    };

    // Ortalama istatistikler
    statistics.averages = {
      postsPerDay: (totalPosts / Math.max(1, moment().diff(moment(thirtyDaysAgo), 'days'))).toFixed(
        2,
      ),
      commentsPerPost: (totalComments / Math.max(1, totalPosts)).toFixed(2),
      votesPerPost: (totalVotes / Math.max(1, totalPosts)).toFixed(2),
      commentsPerUser: (totalComments / Math.max(1, totalUsers)).toFixed(2),
    };
  }

  res.status(200).json({
    success: true,
    data: statistics,
  });
});

/**
 * @desc    Subreddit istatistiklerini getir
 * @route   GET /api/statistics/subreddits/:subredditId
 * @access  Public (Detailed stats for Moderators)
 */
const getSubredditStatistics = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;
  const timeRange = req.query.timeRange || 'all';

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Moderatör kontrolü - İsteğe bağlı detaylı istatistikler için
  const isModerator =
    req.user &&
    (req.user.role === 'admin' ||
      (await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: subredditId,
        type: { $in: ['moderator', 'admin'] },
        status: 'active',
      })));

  // Zaman aralığı filtresi
  const timeFilter = getTimeFilter(timeRange);

  // Temel subreddit istatistikleri
  const [postCount, commentCount, upvoteCount, downvoteCount] = await Promise.all([
    Post.countDocuments({ subreddit: subredditId, isDeleted: false, ...timeFilter }),
    Comment.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      { $unwind: '$postDetails' },
      {
        $match: {
          'postDetails.subreddit': mongoose.Types.ObjectId(subredditId),
          isDeleted: false,
          ...(timeFilter || {}),
        },
      },
      { $count: 'total' },
    ]).then((result) => (result.length > 0 ? result[0].total : 0)),
    Vote.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      {
        $match: {
          'postDetails.subreddit': mongoose.Types.ObjectId(subredditId),
          value: 1,
          ...(timeFilter || {}),
        },
      },
      { $count: 'total' },
    ]).then((result) => (result.length > 0 ? result[0].total : 0)),
    Vote.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      {
        $match: {
          'postDetails.subreddit': mongoose.Types.ObjectId(subredditId),
          value: -1,
          ...(timeFilter || {}),
        },
      },
      { $count: 'total' },
    ]).then((result) => (result.length > 0 ? result[0].total : 0)),
  ]);

  // İçerik türü dağılımı
  const postTypeDistribution = await Post.aggregate([
    {
      $match: {
        subreddit: mongoose.Types.ObjectId(subredditId),
        isDeleted: false,
        ...(timeFilter || {}),
      },
    },
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  // Popüler postlar
  const topPosts = await Post.aggregate([
    {
      $match: {
        subreddit: mongoose.Types.ObjectId(subredditId),
        isDeleted: false,
        ...(timeFilter || {}),
      },
    },
    { $sort: { voteScore: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'authorDetails',
      },
    },
    { $unwind: '$authorDetails' },
    {
      $project: {
        _id: 1,
        title: 1,
        type: 1,
        createdAt: 1,
        voteScore: 1,
        commentCount: 1,
        author: {
          _id: '$authorDetails._id',
          username: '$authorDetails.username',
        },
      },
    },
  ]);

  // Temel istatistik objesi
  const statistics = {
    subreddit: {
      _id: subreddit._id,
      name: subreddit.name,
      title: subreddit.title,
      memberCount: subreddit.memberCount,
      createdAt: subreddit.createdAt,
    },
    stats: {
      postCount,
      commentCount,
      voteCount: {
        upvotes: upvoteCount,
        downvotes: downvoteCount,
        total: upvoteCount + downvoteCount,
      },
      postTypeDistribution,
      topPosts,
    },
    timeRange,
  };

  // Moderatörler için detaylı istatistikler
  if (isModerator) {
    // Günlük aktivite (son 30 gün)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

    const dailyActivity = await Post.aggregate([
      {
        $match: {
          subreddit: mongoose.Types.ObjectId(subredditId),
          isDeleted: false,
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          posts: { $sum: 1 },
          score: { $sum: '$voteScore' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // En aktif kullanıcılar
    const topContributors = await Post.aggregate([
      {
        $match: {
          subreddit: mongoose.Types.ObjectId(subredditId),
          isDeleted: false,
          ...(timeFilter || {}),
        },
      },
      { $group: { _id: '$author', postCount: { $sum: 1 }, totalScore: { $sum: '$voteScore' } } },
      { $sort: { postCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          _id: 1,
          postCount: 1,
          totalScore: 1,
          username: '$userDetails.username',
          karma: '$userDetails.karma',
        },
      },
    ]);

    // En popüler yorum yapanlar
    const topCommenters = await Comment.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      { $unwind: '$postDetails' },
      {
        $match: {
          'postDetails.subreddit': mongoose.Types.ObjectId(subredditId),
          isDeleted: false,
          ...(timeFilter || {}),
        },
      },
      { $group: { _id: '$author', commentCount: { $sum: 1 }, totalScore: { $sum: '$voteScore' } } },
      { $sort: { commentCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          _id: 1,
          commentCount: 1,
          totalScore: 1,
          username: '$userDetails.username',
        },
      },
    ]);

    // Flairler / Tagler dağılımı
    const flairDistribution = await Post.aggregate([
      {
        $match: {
          subreddit: mongoose.Types.ObjectId(subredditId),
          flair: { $exists: true, $ne: null },
          isDeleted: false,
          ...(timeFilter || {}),
        },
      },
      { $group: { _id: '$flair', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'flairs',
          localField: '_id',
          foreignField: '_id',
          as: 'flairDetails',
        },
      },
      { $unwind: '$flairDetails' },
      {
        $project: {
          _id: 1,
          count: 1,
          name: '$flairDetails.name',
          color: '$flairDetails.color',
        },
      },
    ]);

    // Moderatör-özel istatistikleri ekle
    statistics.moderatorStats = {
      dailyActivity,
      topContributors,
      topCommenters,
      flairDistribution,
    };

    // Büyüme istatistikleri
    const growthStats = {
      thisWeek: await calculateGrowthStats(subredditId, 7),
      thisMonth: await calculateGrowthStats(subredditId, 30),
      last3Months: await calculateGrowthStats(subredditId, 90),
    };

    statistics.growthStats = growthStats;
  }

  res.status(200).json({
    success: true,
    data: statistics,
  });
});

/**
 * @desc    Kullanıcı istatistiklerini getir
 * @route   GET /api/statistics/users/:userId
 * @access  Public (Detailed private stats only for user themselves or Admin)
 */
const getUserStatistics = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const timeRange = req.query.timeRange || 'all';

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(new ErrorResponse('Geçersiz kullanıcı ID formatı', 400));
  }

  // Kullanıcının varlığını kontrol et
  const user = await User.findById(userId);
  if (!user || user.isDeleted) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Kendisi veya admin mi kontrolü
  const isSelfOrAdmin =
    req.user && (req.user._id.toString() === userId || req.user.role === 'admin');

  // Zaman aralığı filtresi
  const timeFilter = getTimeFilter(timeRange);

  // Temel kullanıcı istatistikleri
  const [
    postCount,
    commentCount,
    upvotesGiven,
    downvotesGiven,
    upvotesReceived,
    downvotesReceived,
  ] = await Promise.all([
    Post.countDocuments({ author: userId, isDeleted: false, ...timeFilter }),
    Comment.countDocuments({ author: userId, isDeleted: false, ...timeFilter }),
    Vote.countDocuments({ user: userId, value: 1, ...timeFilter }),
    Vote.countDocuments({ user: userId, value: -1, ...timeFilter }),
    Vote.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      {
        $match: {
          'postDetails.author': mongoose.Types.ObjectId(userId),
          value: 1,
          ...(timeFilter || {}),
        },
      },
      { $count: 'total' },
    ]).then((result) => (result.length > 0 ? result[0].total : 0)),
    Vote.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      {
        $match: {
          'postDetails.author': mongoose.Types.ObjectId(userId),
          value: -1,
          ...(timeFilter || {}),
        },
      },
      { $count: 'total' },
    ]).then((result) => (result.length > 0 ? result[0].total : 0)),
  ]);

  // En çok gönderi yapılan subredditler
  const topSubreddits = await Post.aggregate([
    {
      $match: { author: mongoose.Types.ObjectId(userId), isDeleted: false, ...(timeFilter || {}) },
    },
    { $group: { _id: '$subreddit', postCount: { $sum: 1 }, totalScore: { $sum: '$voteScore' } } },
    { $sort: { postCount: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: 'subreddits',
        localField: '_id',
        foreignField: '_id',
        as: 'subredditDetails',
      },
    },
    { $unwind: '$subredditDetails' },
    {
      $project: {
        _id: 1,
        postCount: 1,
        totalScore: 1,
        name: '$subredditDetails.name',
        title: '$subredditDetails.title',
      },
    },
  ]);

  // En popüler postlar
  const topPosts = await Post.find({
    author: userId,
    isDeleted: false,
    ...(timeFilter || {}),
  })
    .sort({ voteScore: -1 })
    .limit(5)
    .select('title type createdAt voteScore commentCount subreddit')
    .populate('subreddit', 'name');

  // Temel istatistik objesi
  const statistics = {
    user: {
      _id: user._id,
      username: user.username,
      createdAt: user.createdAt,
      karma: user.karma,
    },
    stats: {
      postCount,
      commentCount,
      votesGiven: {
        upvotes: upvotesGiven,
        downvotes: downvotesGiven,
        total: upvotesGiven + downvotesGiven,
      },
      votesReceived: {
        upvotes: upvotesReceived,
        downvotes: downvotesReceived,
        total: upvotesReceived + downvotesReceived,
        ratio:
          upvotesReceived + downvotesReceived > 0
            ? (upvotesReceived / (upvotesReceived + downvotesReceived)).toFixed(2)
            : 0,
      },
      topSubreddits,
      topPosts,
    },
    timeRange,
  };

  // Kendisi veya admin için detaylı istatistikler
  if (isSelfOrAdmin) {
    // Günlük aktivite (son 30 gün)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

    const [dailyPosts, dailyComments, dailyVotes] = await Promise.all([
      Post.aggregate([
        {
          $match: {
            author: mongoose.Types.ObjectId(userId),
            isDeleted: false,
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Comment.aggregate([
        {
          $match: {
            author: mongoose.Types.ObjectId(userId),
            isDeleted: false,
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Vote.aggregate([
        {
          $match: {
            user: mongoose.Types.ObjectId(userId),
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // İçerik türlerine göre gönderi dağılımı
    const postTypeDistribution = await Post.aggregate([
      {
        $match: {
          author: mongoose.Types.ObjectId(userId),
          isDeleted: false,
          ...(timeFilter || {}),
        },
      },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Kullanıcının en çok etkileşim kurduğu kullanıcılar
    const topInteractedUsers = await Comment.aggregate([
      {
        $match: {
          author: mongoose.Types.ObjectId(userId),
          isDeleted: false,
          ...(timeFilter || {}),
        },
      },
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      { $unwind: '$postDetails' },
      { $match: { 'postDetails.author': { $ne: mongoose.Types.ObjectId(userId) } } },
      { $group: { _id: '$postDetails.author', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          _id: 1,
          count: 1,
          username: '$userDetails.username',
        },
      },
    ]);

    // Kişisel istatistikleri ekle
    statistics.personalStats = {
      dailyActivity: {
        posts: dailyPosts,
        comments: dailyComments,
        votes: dailyVotes,
      },
      postTypeDistribution,
      topInteractedUsers,
      bestTimeToPost: await calculateBestTimeToPost(userId),
    };

    // Karma dağılımı ve kaynakları
    const karmaBreakdown = await calculateKarmaBreakdown(userId, timeFilter);
    statistics.karmaStats = karmaBreakdown;
  }

  res.status(200).json({
    success: true,
    data: statistics,
  });
});

/**
 * @desc    Post istatistiklerini getir
 * @route   GET /api/statistics/posts/:postId
 * @access  Public (Detailed stats for Author/Moderator/Admin)
 */
const getPostStatistics = asyncHandler(async (req, res, next) => {
  const { postId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(postId)) {
    return next(new ErrorResponse('Geçersiz post ID formatı', 400));
  }

  // Post'un varlığını kontrol et
  const post = await Post.findById(postId)
    .populate('author', 'username')
    .populate('subreddit', 'name title');

  if (!post || post.isDeleted) {
    return next(new ErrorResponse('Post bulunamadı', 404));
  }

  // Kendisi, moderatör veya admin mi kontrolü
  const isAuthorModOrAdmin =
    req.user &&
    (req.user._id.toString() === post.author._id.toString() ||
      req.user.role === 'admin' ||
      (await SubredditMembership.findOne({
        user: req.user._id,
        subreddit: post.subreddit._id,
        type: { $in: ['moderator', 'admin'] },
        status: 'active',
      })));

  // Oy istatistikleri
  const votes = await Vote.aggregate([
    { $match: { post: mongoose.Types.ObjectId(postId) } },
    { $group: { _id: '$value', count: { $sum: 1 } } },
  ]);

  // Oy istatistiklerini düzenleme
  const voteStats = {
    upvotes: 0,
    downvotes: 0,
    total: 0,
    upvoteRatio: 0,
  };

  votes.forEach((vote) => {
    if (vote._id === 1) voteStats.upvotes = vote.count;
    else if (vote._id === -1) voteStats.downvotes = vote.count;
  });

  voteStats.total = voteStats.upvotes + voteStats.downvotes;
  voteStats.upvoteRatio =
    voteStats.total > 0 ? (voteStats.upvotes / voteStats.total).toFixed(2) : 0;

  // Yorumların dağılımı
  const commentStats = await Comment.aggregate([
    { $match: { post: mongoose.Types.ObjectId(postId), isDeleted: false } },
    { $count: 'total' },
    {
      $lookup: {
        from: 'comments',
        let: { postId: mongoose.Types.ObjectId(postId) },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$post', '$$postId'] },
                  { $eq: ['$isDeleted', false] },
                  { $eq: ['$parent', null] },
                ],
              },
            },
          },
          { $count: 'count' },
        ],
        as: 'topLevelComments',
      },
    },
  ]).then((result) => {
    return {
      total: result.length > 0 ? result[0].total : 0,
      topLevel:
        result.length > 0 && result[0].topLevelComments.length > 0
          ? result[0].topLevelComments[0].count
          : 0,
    };
  });

  // Postun görüntülenme zamanlarını getir (varsayılan olarak eklemiyoruz, gerçek uygulamada implement edilebilir)
  const viewTimeDistribution = [];

  // Temel istatistik objesi
  const statistics = {
    post: {
      _id: post._id,
      title: post.title,
      type: post.type,
      createdAt: post.createdAt,
      author: {
        _id: post.author._id,
        username: post.author.username,
      },
      subreddit: {
        _id: post.subreddit._id,
        name: post.subreddit.name,
        title: post.subreddit.title,
      },
    },
    stats: {
      votes: voteStats,
      voteScore: post.voteScore,
      comments: commentStats,
      viewTimeDistribution,
    },
  };

  // Yazar, moderatör veya admin için detaylı istatistikler
  if (isAuthorModOrAdmin) {
    // Yorumcuların dağılımı
    const commenters = await Comment.aggregate([
      { $match: { post: mongoose.Types.ObjectId(postId), isDeleted: false } },
      { $group: { _id: '$author', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          _id: 1,
          count: 1,
          username: '$userDetails.username',
        },
      },
    ]);

    // Zaman içinde yorum ve oy eğilimi
    const hourlyStats = await Vote.aggregate([
      { $match: { post: mongoose.Types.ObjectId(postId) } },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          votes: { $sum: 1 },
          score: { $sum: '$value' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Trafiğin geldiği yerler (referrer) - bu genelde analitik araçları ile ölçülür
    // Burada örnek olarak ekledik
    const traffic = {
      sources: [
        { source: 'direct', count: 120 },
        { source: 'reddit homepage', count: 87 },
        { source: 'subreddit', count: 64 },
        { source: 'external', count: 23 },
      ],
      userAgents: [
        { type: 'desktop', count: 184 },
        { type: 'mobile', count: 97 },
        { type: 'tablet', count: 13 },
      ],
    };

    // Detaylı istatistikleri ekle
    statistics.detailedStats = {
      commenters,
      hourlyStats,
      traffic,
    };
  }

  res.status(200).json({
    success: true,
    data: statistics,
  });
});

/**
 * @desc    Genel yorum istatistiklerini getir
 * @route   GET /api/statistics/comments
 * @access  Private (Admin)
 */
const getCommentStatistics = asyncHandler(async (req, res, next) => {
  // Admin kontrolü
  if (!req.user || req.user.role !== 'admin') {
    return next(new ErrorResponse('Bu endpoint sadece admin kullanıcılar içindir', 403));
  }

  const timeRange = req.query.timeRange || 'all';
  const timeFilter = getTimeFilter(timeRange);

  // Toplam yorum sayısı
  const totalComments = await Comment.countDocuments({
    isDeleted: false,
    ...(timeFilter || {}),
  });

  // Saatlik yorum dağılımı
  const hourlyDistribution = await Comment.aggregate([
    { $match: { isDeleted: false, ...(timeFilter || {}) } },
    {
      $group: {
        _id: { $hour: '$createdAt' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Yorum derinliği dağılımı
  const depthDistribution = await Comment.aggregate([
    { $match: { isDeleted: false, ...(timeFilter || {}) } },
    {
      $group: {
        _id: '$depth',
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // En çok yorum alan postlar
  const topCommentedPosts = await Post.find()
    .sort({ commentCount: -1 })
    .limit(10)
    .select('title commentCount voteScore createdAt subreddit author')
    .populate('author', 'username')
    .populate('subreddit', 'name');

  // En aktif yorumcular
  const topCommenters = await Comment.aggregate([
    { $match: { isDeleted: false, ...(timeFilter || {}) } },
    { $group: { _id: '$author', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'userDetails',
      },
    },
    { $unwind: '$userDetails' },
    {
      $project: {
        _id: 1,
        count: 1,
        username: '$userDetails.username',
        karma: '$userDetails.karma.comment',
      },
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalComments,
      hourlyDistribution,
      depthDistribution,
      topCommentedPosts,
      topCommenters,
      timeRange,
    },
  });
});

/**
 * @desc    Trend istatistiklerini getir
 * @route   GET /api/statistics/trends
 * @access  Public
 */
const getTrendStatistics = asyncHandler(async (req, res, next) => {
  const timeRange = req.query.timeRange || 'week';
  let timeFilter;

  // Zaman aralığını belirle
  switch (timeRange) {
    case 'day':
      timeFilter = { createdAt: { $gte: moment().subtract(24, 'hours').toDate() } };
      break;
    case 'week':
      timeFilter = { createdAt: { $gte: moment().subtract(7, 'days').toDate() } };
      break;
    case 'month':
      timeFilter = { createdAt: { $gte: moment().subtract(30, 'days').toDate() } };
      break;
    default:
      timeFilter = { createdAt: { $gte: moment().subtract(7, 'days').toDate() } };
  }

  // Trend olan postlar
  const trendingPosts = await Post.aggregate([
    { $match: { isDeleted: false, ...timeFilter } },
    {
      $addFields: {
        // Trend skorunu hesaplama - yeni postlar ve hızlı büyüyen postları öne çıkarma
        trendScore: {
          $divide: [
            { $add: ['$voteScore', { $multiply: ['$commentCount', 3] }] },
            {
              $add: [
                1,
                {
                  $divide: [
                    { $subtract: [new Date(), '$createdAt'] },
                    3600000, // milisaniye cinsinden 1 saat
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    { $sort: { trendScore: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'authorDetails',
      },
    },
    { $unwind: '$authorDetails' },
    {
      $lookup: {
        from: 'subreddits',
        localField: 'subreddit',
        foreignField: '_id',
        as: 'subredditDetails',
      },
    },
    { $unwind: '$subredditDetails' },
    {
      $project: {
        _id: 1,
        title: 1,
        type: 1,
        voteScore: 1,
        commentCount: 1,
        createdAt: 1,
        trendScore: 1,
        author: {
          _id: '$authorDetails._id',
          username: '$authorDetails.username',
        },
        subreddit: {
          _id: '$subredditDetails._id',
          name: '$subredditDetails.name',
        },
      },
    },
  ]);

  // Büyüyen subredditler
  const growingSubreddits = await Subreddit.find({ isDeleted: false })
    .sort({ memberCount: -1 })
    .limit(10)
    .select('name title memberCount createdAt');

  // Aktif konular/taglar
  const activeTopics = await Post.aggregate([
    { $match: { isDeleted: false, ...timeFilter } },
    { $unwind: '$keywords' },
    { $group: { _id: '$keywords', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  res.status(200).json({
    success: true,
    data: {
      trendingPosts,
      growingSubreddits,
      activeTopics,
      timeRange,
    },
  });
});

// Yardımcı Fonksiyonlar

/**
 * Zaman aralığı filtresini oluşturur
 * @param {string} timeRange - Zaman aralığı ('day', 'week', 'month', 'year', 'all')
 * @returns {Object} MongoDB sorgusu için zaman filtresi
 */
function getTimeFilter(timeRange) {
  if (timeRange === 'all') return null;

  const now = new Date();
  let startDate;

  switch (timeRange) {
    case 'day':
      startDate = new Date(now.setDate(now.getDate() - 1));
      break;
    case 'week':
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'year':
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    default:
      return null;
  }

  return { createdAt: { $gte: startDate } };
}

/**
 * Büyüme istatistiklerini hesaplar
 * @param {string} subredditId - Subreddit ID
 * @param {number} days - Gün sayısı
 * @returns {Object} Büyüme istatistikleri
 */
async function calculateGrowthStats(subredditId, days) {
  const now = new Date();
  const startDate = new Date(now.setDate(now.getDate() - days));

  // İlgili dönemdeki post, yorum ve oy sayıları
  const [periodPosts, periodComments, periodVotes] = await Promise.all([
    Post.countDocuments({
      subreddit: subredditId,
      isDeleted: false,
      createdAt: { $gte: startDate },
    }),
    Comment.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      { $unwind: '$postDetails' },
      {
        $match: {
          'postDetails.subreddit': mongoose.Types.ObjectId(subredditId),
          isDeleted: false,
          createdAt: { $gte: startDate },
        },
      },
      { $count: 'total' },
    ]).then((result) => (result.length > 0 ? result[0].total : 0)),
    Vote.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      {
        $match: {
          'postDetails.subreddit': mongoose.Types.ObjectId(subredditId),
          createdAt: { $gte: startDate },
        },
      },
      { $count: 'total' },
    ]).then((result) => (result.length > 0 ? result[0].total : 0)),
  ]);

  // Bir önceki döneme ait değerleri hesapla
  const previousStartDate = new Date(startDate);
  previousStartDate.setDate(previousStartDate.getDate() - days); // Bir önceki eşit zaman dilimi

  const [previousPosts, previousComments, previousVotes] = await Promise.all([
    Post.countDocuments({
      subreddit: subredditId,
      isDeleted: false,
      createdAt: { $gte: previousStartDate, $lt: startDate },
    }),
    Comment.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      { $unwind: '$postDetails' },
      {
        $match: {
          'postDetails.subreddit': mongoose.Types.ObjectId(subredditId),
          isDeleted: false,
          createdAt: { $gte: previousStartDate, $lt: startDate },
        },
      },
      { $count: 'total' },
    ]).then((result) => (result.length > 0 ? result[0].total : 0)),
    Vote.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'post',
          foreignField: '_id',
          as: 'postDetails',
        },
      },
      {
        $match: {
          'postDetails.subreddit': mongoose.Types.ObjectId(subredditId),
          createdAt: { $gte: previousStartDate, $lt: startDate },
        },
      },
      { $count: 'total' },
    ]).then((result) => (result.length > 0 ? result[0].total : 0)),
  ]);

  // Büyüme yüzdeleri hesapla
  const calculateGrowth = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return (((current - previous) / previous) * 100).toFixed(2);
  };

  return {
    posts: {
      current: periodPosts,
      previous: previousPosts,
      growth: calculateGrowth(periodPosts, previousPosts),
    },
    comments: {
      current: periodComments,
      previous: previousComments,
      growth: calculateGrowth(periodComments, previousComments),
    },
    votes: {
      current: periodVotes,
      previous: previousVotes,
      growth: calculateGrowth(periodVotes, previousVotes),
    },
  };
}

/**
 * Kullanıcının karma detaylarını hesaplar
 * @param {string} userId - Kullanıcı ID
 * @param {Object} timeFilter - Zaman filtresi
 * @returns {Object} Karma dağılımı ve detayları
 */
async function calculateKarmaBreakdown(userId, timeFilter) {
  // Post karması dağılımı
  const postKarma = await Post.aggregate([
    {
      $match: { author: mongoose.Types.ObjectId(userId), isDeleted: false, ...(timeFilter || {}) },
    },
    {
      $group: {
        _id: '$subreddit',
        totalKarma: { $sum: '$voteScore' },
        postCount: { $sum: 1 },
      },
    },
    { $match: { totalKarma: { $ne: 0 } } },
    { $sort: { totalKarma: -1 } },
    {
      $lookup: {
        from: 'subreddits',
        localField: '_id',
        foreignField: '_id',
        as: 'subredditDetails',
      },
    },
    { $unwind: '$subredditDetails' },
    {
      $project: {
        _id: 1,
        totalKarma: 1,
        postCount: 1,
        name: '$subredditDetails.name',
      },
    },
  ]);

  // Yorum karması dağılımı
  const commentKarma = await Comment.aggregate([
    {
      $match: { author: mongoose.Types.ObjectId(userId), isDeleted: false, ...(timeFilter || {}) },
    },
    {
      $group: {
        _id: '$post',
        totalKarma: { $sum: '$voteScore' },
        commentCount: { $sum: 1 },
      },
    },
    { $match: { totalKarma: { $ne: 0 } } },
    { $sort: { totalKarma: -1 } },
    {
      $lookup: {
        from: 'posts',
        localField: '_id',
        foreignField: '_id',
        as: 'postDetails',
      },
    },
    { $unwind: '$postDetails' },
    {
      $lookup: {
        from: 'subreddits',
        localField: 'postDetails.subreddit',
        foreignField: '_id',
        as: 'subredditDetails',
      },
    },
    { $unwind: '$subredditDetails' },
    {
      $project: {
        _id: 1,
        totalKarma: 1,
        commentCount: 1,
        postTitle: '$postDetails.title',
        subreddit: {
          _id: '$subredditDetails._id',
          name: '$subredditDetails.name',
        },
      },
    },
    { $limit: 10 },
  ]);

  // Karma özeti
  const user = await User.findById(userId).select('karma');

  return {
    summary: user.karma,
    totalKarma: user.totalKarma,
    postKarmaBySubreddit: postKarma,
    commentKarmaByPost: commentKarma,
  };
}

/**
 * Kullanıcının post paylaşmak için en iyi zamanını hesaplar
 * @param {string} userId - Kullanıcı ID
 * @returns {Object} En iyi gün ve saat istatistikleri
 */
async function calculateBestTimeToPost(userId) {
  // Saatlere göre post başarısı
  const hourlyPerformance = await Post.aggregate([
    { $match: { author: mongoose.Types.ObjectId(userId), isDeleted: false } },
    {
      $group: {
        _id: { $hour: '$createdAt' },
        avgScore: { $avg: '$voteScore' },
        avgComments: { $avg: '$commentCount' },
        postCount: { $sum: 1 },
      },
    },
    { $sort: { avgScore: -1 } },
  ]);

  // Günlere göre post başarısı
  const dailyPerformance = await Post.aggregate([
    { $match: { author: mongoose.Types.ObjectId(userId), isDeleted: false } },
    {
      $group: {
        _id: { $dayOfWeek: '$createdAt' },
        avgScore: { $avg: '$voteScore' },
        avgComments: { $avg: '$commentCount' },
        postCount: { $sum: 1 },
      },
    },
    { $sort: { avgScore: -1 } },
  ]);

  // Gün isimlerini map'le
  const dayNames = [
    'Pazar',
    'Pazartesi',
    'Salı',
    'Çarşamba',
    'Perşembe',
    'Cuma',
    'Cumartesi',
    'Pazar',
  ];
  const processedDailyData = dailyPerformance.map((item) => ({
    day: dayNames[item._id],
    dayNumber: item._id,
    avgScore: parseFloat(item.avgScore.toFixed(2)),
    avgComments: parseFloat(item.avgComments.toFixed(2)),
    postCount: item.postCount,
  }));

  // Saatleri düzenleme
  const processedHourlyData = hourlyPerformance.map((item) => ({
    hour: item._id,
    hourFormatted: `${item._id}:00`,
    avgScore: parseFloat(item.avgScore.toFixed(2)),
    avgComments: parseFloat(item.avgComments.toFixed(2)),
    postCount: item.postCount,
  }));

  return {
    bestDays: processedDailyData.slice(0, 3),
    bestHours: processedHourlyData.slice(0, 3),
    hourlyPerformance: processedHourlyData,
    dailyPerformance: processedDailyData,
  };
}

module.exports = {
  getSiteStatistics,
  getSubredditStatistics,
  getUserStatistics,
  getPostStatistics,
  getCommentStatistics,
  getTrendStatistics,
};
