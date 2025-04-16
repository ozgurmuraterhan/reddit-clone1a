const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Subreddit = require('../models/Subreddit');
const Vote = require('../models/Vote');
const Tag = require('../models/Tag');
const Statistics = require('../models/Statistics');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const mongoose = require('mongoose');

/**
 * @desc    Trend olan gönderileri getir
 * @route   GET /api/trending/posts
 * @access  Public
 */
const getTrendingPosts = asyncHandler(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Zaman aralığı (varsayılan: son 24 saat)
  const timeRange = req.query.timeRange || '24h';
  let timeFilter = new Date();

  switch (timeRange) {
    case '1h':
      timeFilter.setHours(timeFilter.getHours() - 1);
      break;
    case '6h':
      timeFilter.setHours(timeFilter.getHours() - 6);
      break;
    case '12h':
      timeFilter.setHours(timeFilter.getHours() - 12);
      break;
    case '24h':
      timeFilter.setHours(timeFilter.getHours() - 24);
      break;
    case '7d':
      timeFilter.setDate(timeFilter.getDate() - 7);
      break;
    case '30d':
      timeFilter.setDate(timeFilter.getDate() - 30);
      break;
    default:
      timeFilter.setHours(timeFilter.getHours() - 24);
  }

  // NSFW içerik filtreleme
  const includeNSFW = req.query.includeNSFW === 'true';

  // Subreddit filtreleme
  let subredditFilter = {};
  if (req.query.subreddit) {
    const subreddit = await Subreddit.findOne({ name: req.query.subreddit });
    if (subreddit) {
      subredditFilter = { subreddit: subreddit._id };
    }
  }

  // Trend skoru hesaplama için pipeline
  // Trend skoru = (upvotes - downvotes) * decay_factor + (commentCount * comment_weight)
  const trendingPosts = await Post.aggregate([
    {
      $match: {
        createdAt: { $gte: timeFilter },
        isDeleted: false,
        isNSFW: includeNSFW ? { $in: [true, false] } : false,
        ...subredditFilter,
      },
    },
    {
      $addFields: {
        // Zamana göre azalan ağırlık (daha yeni içerikler daha önemli)
        hoursSinceCreation: {
          $divide: [
            { $subtract: [new Date(), '$createdAt'] },
            1000 * 60 * 60, // Saat cinsinden
          ],
        },
      },
    },
    {
      $addFields: {
        // Trend skoru hesaplama
        decayFactor: {
          $exp: {
            $multiply: [-0.05, '$hoursSinceCreation'], // Zaman için üstel azalma faktörü
          },
        },
      },
    },
    {
      $addFields: {
        trendScore: {
          $add: [
            // Vote skoru * zaman değeri
            { $multiply: ['$voteScore', '$decayFactor'] },

            // Yorum sayısı ağırlığı (yorumlar etkileşimi gösterir)
            { $multiply: ['$commentCount', 0.25, '$decayFactor'] },
          ],
        },
      },
    },
    {
      $sort: { trendScore: -1 },
    },
    {
      $skip: startIndex,
    },
    {
      $limit: limit,
    },
    {
      $lookup: {
        from: 'subreddits',
        localField: 'subreddit',
        foreignField: '_id',
        as: 'subredditInfo',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'authorInfo',
      },
    },
    {
      $addFields: {
        subredditInfo: { $arrayElemAt: ['$subredditInfo', 0] },
        authorInfo: { $arrayElemAt: ['$authorInfo', 0] },
      },
    },
    {
      $project: {
        _id: 1,
        title: 1,
        type: 1,
        url: 1,
        mediaUrl: 1,
        content: 1,
        upvotes: 1,
        downvotes: 1,
        voteScore: 1,
        commentCount: 1,
        isNSFW: 1,
        isSpoiler: 1,
        createdAt: 1,
        slug: 1,
        trendScore: 1,
        'subredditInfo.name': 1,
        'subredditInfo.title': 1,
        'subredditInfo.icon': 1,
        'authorInfo.username': 1,
      },
    },
  ]);

  // Toplam sayıyı hesapla
  const total = await Post.countDocuments({
    createdAt: { $gte: timeFilter },
    isDeleted: false,
    isNSFW: includeNSFW ? { $in: [true, false] } : false,
    ...subredditFilter,
  });

  res.status(200).json({
    success: true,
    count: trendingPosts.length,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      total,
    },
    data: trendingPosts,
  });
});

/**
 * @desc    Trend olan subredditleri getir
 * @route   GET /api/trending/subreddits
 * @access  Public
 */
const getTrendingSubreddits = asyncHandler(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;

  // Zaman aralığı (varsayılan: son 7 gün)
  const timeRange = req.query.timeRange || '7d';
  let timeFilter = new Date();

  switch (timeRange) {
    case '24h':
      timeFilter.setHours(timeFilter.getHours() - 24);
      break;
    case '7d':
      timeFilter.setDate(timeFilter.getDate() - 7);
      break;
    case '30d':
      timeFilter.setDate(timeFilter.getDate() - 30);
      break;
    default:
      timeFilter.setDate(timeFilter.getDate() - 7);
  }

  // NSFW içerik filtreleme
  const includeNSFW = req.query.includeNSFW === 'true';

  // İstatistik verilerini kullanarak trend olan subredditleri bul
  const trendingSubredditsFromStats = await Statistics.aggregate([
    {
      $match: {
        targetType: 'subreddit',
        date: { $gte: timeFilter },
        subreddit: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$subreddit',
        totalPageViews: { $sum: '$metrics.pageViews' },
        totalUniqueVisitors: { $sum: '$metrics.uniqueVisitors' },
        totalNewSubscribers: { $sum: '$metrics.newSubscribers' },
        totalActiveUsers: { $sum: '$metrics.activeUsers' },
        totalPostCount: { $sum: '$metrics.postCount' },
        totalCommentCount: { $sum: '$metrics.commentCount' },
        dataPoints: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'subreddits',
        localField: '_id',
        foreignField: '_id',
        as: 'subredditInfo',
      },
    },
    {
      $match: {
        'subredditInfo.isDeleted': false,
        'subredditInfo.nsfw': includeNSFW ? { $in: [true, false] } : false,
      },
    },
    {
      $addFields: {
        subredditInfo: { $arrayElemAt: ['$subredditInfo', 0] },
        // Trend skoru formülü: sayfa görüntülemeleri + (aktif kullanıcılar * 5) + (yeni aboneler * 20) + (gönderi sayısı * 3) + (yorum sayısı * 1)
        trendScore: {
          $add: [
            '$totalPageViews',
            { $multiply: ['$totalActiveUsers', 5] },
            { $multiply: ['$totalNewSubscribers', 20] },
            { $multiply: ['$totalPostCount', 3] },
            '$totalCommentCount',
          ],
        },
      },
    },
    {
      $sort: { trendScore: -1 },
    },
    {
      $skip: startIndex,
    },
    {
      $limit: limit,
    },
    {
      $project: {
        _id: 0,
        subredditId: '$_id',
        name: '$subredditInfo.name',
        title: '$subredditInfo.title',
        description: '$subredditInfo.description',
        icon: '$subredditInfo.icon',
        banner: '$subredditInfo.banner',
        memberCount: '$subredditInfo.memberCount',
        nsfw: '$subredditInfo.nsfw',
        createdAt: '$subredditInfo.createdAt',
        type: '$subredditInfo.type',
        trendScore: 1,
        stats: {
          pageViews: '$totalPageViews',
          uniqueVisitors: '$totalUniqueVisitors',
          newSubscribers: '$totalNewSubscribers',
          activeUsers: '$totalActiveUsers',
          postCount: '$totalPostCount',
          commentCount: '$totalCommentCount',
        },
      },
    },
  ]);

  // İstatistik verilerinde yeterli subreddit yoksa, son 7 günde en aktif subredditleri bul
  let trendingSubreddits = trendingSubredditsFromStats;

  if (trendingSubreddits.length < limit) {
    // İstatistiklerde bulunmayan trendleri post aktivitesi üzerinden hesapla
    const activityBasedTrending = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: timeFilter },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: '$subreddit',
          postCount: { $sum: 1 },
          totalComments: { $sum: '$commentCount' },
          totalVotes: { $sum: '$voteScore' },
        },
      },
      {
        $lookup: {
          from: 'subreddits',
          localField: '_id',
          foreignField: '_id',
          as: 'subredditInfo',
        },
      },
      {
        $match: {
          'subredditInfo.isDeleted': false,
          'subredditInfo.nsfw': includeNSFW ? { $in: [true, false] } : false,
        },
      },
      {
        $addFields: {
          subredditInfo: { $arrayElemAt: ['$subredditInfo', 0] },
          activityScore: {
            $add: [
              '$postCount',
              { $multiply: ['$totalComments', 0.5] },
              { $divide: ['$totalVotes', 10] },
            ],
          },
        },
      },
      {
        $sort: { activityScore: -1 },
      },
      {
        $limit: limit,
      },
      {
        $project: {
          _id: 0,
          subredditId: '$_id',
          name: '$subredditInfo.name',
          title: '$subredditInfo.title',
          description: '$subredditInfo.description',
          icon: '$subredditInfo.icon',
          banner: '$subredditInfo.banner',
          memberCount: '$subredditInfo.memberCount',
          nsfw: '$subredditInfo.nsfw',
          createdAt: '$subredditInfo.createdAt',
          type: '$subredditInfo.type',
          trendScore: '$activityScore',
          stats: {
            postCount: '$postCount',
            commentCount: '$totalComments',
            totalVotes: '$totalVotes',
          },
        },
      },
    ]);

    // İki listeyi birleştir ve tekrar sırala
    const existingIds = new Set(trendingSubreddits.map((s) => s.subredditId.toString()));
    const additionalSubreddits = activityBasedTrending.filter(
      (s) => !existingIds.has(s.subredditId.toString()),
    );

    trendingSubreddits = [...trendingSubreddits, ...additionalSubreddits]
      .sort((a, b) => b.trendScore - a.trendScore)
      .slice(0, limit);
  }

  res.status(200).json({
    success: true,
    count: trendingSubreddits.length,
    pagination: {
      page,
      limit,
    },
    data: trendingSubreddits,
  });
});

/**
 * @desc    Trend olan etiketleri getir
 * @route   GET /api/trending/tags
 * @access  Public
 */
const getTrendingTags = asyncHandler(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;

  // Zaman aralığı (varsayılan: son 7 gün)
  const timeRange = req.query.timeRange || '7d';
  let timeFilter = new Date();

  switch (timeRange) {
    case '24h':
      timeFilter.setHours(timeFilter.getHours() - 24);
      break;
    case '7d':
      timeFilter.setDate(timeFilter.getDate() - 7);
      break;
    case '30d':
      timeFilter.setDate(timeFilter.getDate() - 30);
      break;
    default:
      timeFilter.setDate(timeFilter.getDate() - 7);
  }

  // Kapsam filtreleme (site veya subreddit)
  const scope = req.query.scope || 'site';

  let scopeFilter = {};
  if (scope === 'subreddit' && req.query.subredditId) {
    scopeFilter = {
      scope: 'subreddit',
      subreddit: mongoose.Types.ObjectId(req.query.subredditId),
    };
  } else if (scope === 'subreddit' && req.query.subredditName) {
    const subreddit = await Subreddit.findOne({ name: req.query.subredditName });
    if (subreddit) {
      scopeFilter = {
        scope: 'subreddit',
        subreddit: subreddit._id,
      };
    } else {
      return next(new ErrorResponse('Belirtilen subreddit bulunamadı', 404));
    }
  } else {
    scopeFilter = { scope: 'site' };
  }

  // Tagged Item verileri üzerinden trend etiketleri hesapla
  const trendingTags = await mongoose.model('TaggedItem').aggregate([
    {
      $match: {
        createdAt: { $gte: timeFilter },
      },
    },
    {
      $lookup: {
        from: 'tags',
        localField: 'tag',
        foreignField: '_id',
        as: 'tagInfo',
      },
    },
    {
      $unwind: '$tagInfo',
    },
    {
      $match: {
        'tagInfo.isActive': true,
        ...scopeFilter,
      },
    },
    {
      $group: {
        _id: '$tag',
        count: { $sum: 1 },
        itemIds: { $push: '$item' },
        tagInfo: { $first: '$tagInfo' },
      },
    },
    {
      $addFields: {
        uniqueItems: { $size: { $setUnion: '$itemIds' } },
      },
    },
    {
      $sort: { uniqueItems: -1, count: -1 },
    },
    {
      $skip: startIndex,
    },
    {
      $limit: limit,
    },
    {
      $project: {
        _id: 0,
        tagId: '$_id',
        name: '$tagInfo.name',
        color: '$tagInfo.color',
        description: '$tagInfo.description',
        scope: '$tagInfo.scope',
        subreddit: '$tagInfo.subreddit',
        createdBy: '$tagInfo.createdBy',
        createdAt: '$tagInfo.createdAt',
        useCount: '$count',
        uniqueItemCount: '$uniqueItems',
      },
    },
  ]);

  // Toplam etiket sayısını hesapla
  const totalTagCount = await Tag.countDocuments({
    isActive: true,
    ...scopeFilter,
  });

  res.status(200).json({
    success: true,
    count: trendingTags.length,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(totalTagCount / limit),
      total: totalTagCount,
    },
    data: trendingTags,
  });
});

/**
 * @desc    Trend olan yorumları getir
 * @route   GET /api/trending/comments
 * @access  Public
 */
const getTrendingComments = asyncHandler(async (req, res, next) => {
  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const startIndex = (page - 1) * limit;

  // Zaman aralığı (varsayılan: son 24 saat)
  const timeRange = req.query.timeRange || '24h';
  let timeFilter = new Date();

  switch (timeRange) {
    case '1h':
      timeFilter.setHours(timeFilter.getHours() - 1);
      break;
    case '6h':
      timeFilter.setHours(timeFilter.getHours() - 6);
      break;
    case '12h':
      timeFilter.setHours(timeFilter.getHours() - 12);
      break;
    case '24h':
      timeFilter.setHours(timeFilter.getHours() - 24);
      break;
    case '7d':
      timeFilter.setDate(timeFilter.getDate() - 7);
      break;
    default:
      timeFilter.setHours(timeFilter.getHours() - 24);
  }

  // Subreddit filtreleme
  let subredditFilter = {};
  if (req.query.subreddit) {
    const subreddit = await Subreddit.findOne({ name: req.query.subreddit });
    if (subreddit) {
      // Subreddit'e ait postları bul
      const posts = await Post.find({ subreddit: subreddit._id }, '_id');
      const postIds = posts.map((post) => post._id);

      subredditFilter = { post: { $in: postIds } };
    }
  }

  // Trend skoru hesaplama için pipeline
  const trendingComments = await Comment.aggregate([
    {
      $match: {
        createdAt: { $gte: timeFilter },
        isDeleted: false,
        ...subredditFilter,
      },
    },
    {
      $addFields: {
        // Zamana göre azalan ağırlık (daha yeni içerikler daha önemli)
        hoursSinceCreation: {
          $divide: [
            { $subtract: [new Date(), '$createdAt'] },
            1000 * 60 * 60, // Saat cinsinden
          ],
        },
      },
    },
    {
      $addFields: {
        // Trend skoru hesaplama
        decayFactor: {
          $exp: {
            $multiply: [-0.1, '$hoursSinceCreation'], // Yorum için daha hızlı azalan üstel faktör
          },
        },
        trendScore: {
          $add: [
            // Vote skoru * zaman değeri
            { $multiply: ['$voteScore', '$decayFactor'] },

            // Cevap sayısı ağırlığı
            { $multiply: ['$replyCount', 0.5, '$decayFactor'] },
          ],
        },
      },
    },
    {
      $sort: { trendScore: -1 },
    },
    {
      $skip: startIndex,
    },
    {
      $limit: limit,
    },
    {
      $lookup: {
        from: 'posts',
        localField: 'post',
        foreignField: '_id',
        as: 'postInfo',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'author',
        foreignField: '_id',
        as: 'authorInfo',
      },
    },
    {
      $lookup: {
        from: 'subreddits',
        localField: 'postInfo.subreddit',
        foreignField: '_id',
        as: 'subredditInfo',
      },
    },
    {
      $addFields: {
        postInfo: { $arrayElemAt: ['$postInfo', 0] },
        authorInfo: { $arrayElemAt: ['$authorInfo', 0] },
        subredditInfo: { $arrayElemAt: ['$subredditInfo', 0] },
      },
    },
    {
      $project: {
        _id: 1,
        content: 1,
        upvotes: 1,
        downvotes: 1,
        voteScore: 1,
        replyCount: 1,
        createdAt: 1,
        trendScore: 1,
        'authorInfo.username': 1,
        'postInfo._id': 1,
        'postInfo.title': 1,
        'postInfo.slug': 1,
        'subredditInfo.name': 1,
        'subredditInfo.title': 1,
      },
    },
  ]);

  // Toplam yorum sayısını hesapla
  const total = await Comment.countDocuments({
    createdAt: { $gte: timeFilter },
    isDeleted: false,
    ...subredditFilter,
  });

  res.status(200).json({
    success: true,
    count: trendingComments.length,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      total,
    },
    data: trendingComments,
  });
});

/**
 * @desc    Yükselen toplulukları getir
 * @route   GET /api/trending/rising
 * @access  Public
 */
const getRisingCommunities = asyncHandler(async (req, res, next) => {
  // Bu fonksiyon, son 30 gün içinde üye sayısında en hızlı artışa sahip toplulukları bulur

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;

  // Son 30 gündeki verileri al
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // NSFW içerik filtreleme
  const includeNSFW = req.query.includeNSFW === 'true';

  // SubredditMembership modeli üzerinden üye artışını hesapla
  const risingCommunities = await mongoose.model('SubredditMembership').aggregate([
    {
      $match: {
        createdAt: { $gte: thirtyDaysAgo },
        status: 'member',
      },
    },
    {
      $group: {
        _id: '$subreddit',
        newMemberCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'subreddits',
        localField: '_id',
        foreignField: '_id',
        as: 'subredditInfo',
      },
    },
    {
      $match: {
        'subredditInfo.isDeleted': false,
        'subredditInfo.nsfw': includeNSFW ? { $in: [true, false] } : false,
      },
    },
    {
      $addFields: {
        subredditInfo: { $arrayElemAt: ['$subredditInfo', 0] },
      },
    },
    {
      $lookup: {
        from: 'posts',
        let: { subredditId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$subreddit', '$$subredditId'] },
                  { $gte: ['$createdAt', thirtyDaysAgo] },
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              postCount: { $sum: 1 },
              totalComments: { $sum: '$commentCount' },
            },
          },
        ],
        as: 'activityData',
      },
    },
    {
      $addFields: {
        activityData: { $arrayElemAt: ['$activityData', 0] },
        growthRate: {
          $divide: ['$newMemberCount', { $max: [1, '$subredditInfo.memberCount'] }],
        },
      },
    },
    {
      $addFields: {
        postCount: { $ifNull: ['$activityData.postCount', 0] },
        commentCount: { $ifNull: ['$activityData.totalComments', 0] },
        // Yükseliş skoru: büyüme oranı + üye sayısının logaritması * aktivite
        risingScore: {
          $add: [
            { $multiply: ['$growthRate', 1000] },
            {
              $multiply: [
                { $ln: { $max: [10, '$subredditInfo.memberCount'] } },
                {
                  $add: [
                    { $ifNull: ['$activityData.postCount', 0] },
                    { $divide: [{ $ifNull: ['$activityData.totalComments', 0] }, 5] },
                  ],
                },
                0.01,
              ],
            },
          ],
        },
      },
    },
    {
      $sort: { risingScore: -1 },
    },
    {
      $skip: startIndex,
    },
    {
      $limit: limit,
    },
    {
      $project: {
        _id: 0,
        subredditId: '$_id',
        name: '$subredditInfo.name',
        title: '$subredditInfo.title',
        description: '$subredditInfo.description',
        icon: '$subredditInfo.icon',
        memberCount: '$subredditInfo.memberCount',
        newMemberCount: 1,
        growthRate: 1,
        risingScore: 1,
        activityMetrics: {
          postCount: '$postCount',
          commentCount: '$commentCount',
        },
        createdAt: '$subredditInfo.createdAt',
      },
    },
  ]);

  // Toplam sayfa sayısını hesapla
  const totalSubreddits = await Subreddit.countDocuments({
    isDeleted: false,
    nsfw: includeNSFW ? { $in: [true, false] } : false,
    createdAt: { $lt: thirtyDaysAgo },
  });

  res.status(200).json({
    success: true,
    count: risingCommunities.length,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(totalSubreddits / limit),
      total: totalSubreddits,
    },
    data: risingCommunities,
  });
});

/**
 * @desc    Trend olan içerik dağılımını getir
 * @route   GET /api/trending/distribution
 * @access  Public
 */
const getTrendingDistribution = asyncHandler(async (req, res, next) => {
  // Zaman aralığı (varsayılan: son 7 gün)
  const timeRange = req.query.timeRange || '7d';
  let timeFilter = new Date();

  switch (timeRange) {
    case '24h':
      timeFilter.setHours(timeFilter.getHours() - 24);
      break;
    case '7d':
      timeFilter.setDate(timeFilter.getDate() - 7);
      break;
    case '30d':
      timeFilter.setDate(timeFilter.getDate() - 30);
      break;
    default:
      timeFilter.setDate(timeFilter.getDate() - 7);
  }

  // Gönderi tiplerine göre dağılım
  const postTypeDistribution = await Post.aggregate([
    {
      $match: {
        createdAt: { $gte: timeFilter },
        isDeleted: false,
        voteScore: { $gt: 5 }, // Sadece belirli bir eşiğin üzerindeki gönderiler
      },
    },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        avgVoteScore: { $avg: '$voteScore' },
        avgCommentCount: { $avg: '$commentCount' },
        totalVoteScore: { $sum: '$voteScore' },
        totalCommentCount: { $sum: '$commentCount' },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  // Günün saatlerine göre aktivite dağılımı
  const hourlyActivityDistribution = await Post.aggregate([
    {
      $match: {
        createdAt: { $gte: timeFilter },
        isDeleted: false,
      },
    },
    {
      $project: {
        hour: { $hour: '$createdAt' },
        voteScore: 1,
        commentCount: 1,
      },
    },
    {
      $group: {
        _id: '$hour',
        postCount: { $sum: 1 },
        avgVoteScore: { $avg: '$voteScore' },
        totalVotes: { $sum: '$voteScore' },
        totalComments: { $sum: '$commentCount' },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // Haftanın günlerine göre aktivite dağılımı
  const dailyActivityDistribution = await Post.aggregate([
    {
      $match: {
        createdAt: { $gte: timeFilter },
        isDeleted: false,
      },
    },
    {
      $project: {
        dayOfWeek: { $dayOfWeek: '$createdAt' }, // 1 = Pazar, 7 = Cumartesi
        voteScore: 1,
        commentCount: 1,
      },
    },
    {
      $group: {
        _id: '$dayOfWeek',
        postCount: { $sum: 1 },
        avgVoteScore: { $avg: '$voteScore' },
        totalVotes: { $sum: '$voteScore' },
        totalComments: { $sum: '$commentCount' },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // En popüler ilk 10 Subreddit
  const topSubreddits = await Post.aggregate([
    {
      $match: {
        createdAt: { $gte: timeFilter },
        isDeleted: false,
        voteScore: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: '$subreddit',
        postCount: { $sum: 1 },
        totalVotes: { $sum: '$voteScore' },
        totalComments: { $sum: '$commentCount' },
        avgVoteScore: { $avg: '$voteScore' },
      },
    },
    {
      $lookup: {
        from: 'subreddits',
        localField: '_id',
        foreignField: '_id',
        as: 'subredditInfo',
      },
    },
    {
      $addFields: {
        subredditInfo: { $arrayElemAt: ['$subredditInfo', 0] },
      },
    },
    {
      $project: {
        name: '$subredditInfo.name',
        title: '$subredditInfo.title',
        postCount: 1,
        totalVotes: 1,
        totalComments: 1,
        avgVoteScore: 1,
        engagementScore: {
          $add: ['$totalVotes', { $multiply: ['$totalComments', 3] }],
        },
      },
    },
    {
      $sort: { engagementScore: -1 },
    },
    {
      $limit: 10,
    },
  ]);

  res.status(200).json({
    success: true,
    data: {
      postTypes: postTypeDistribution,
      hourlyActivity: hourlyActivityDistribution,
      dailyActivity: dailyActivityDistribution,
      topSubreddits: topSubreddits,
    },
  });
});

/**
 * @desc    Günlük trend değişimini getir
 * @route   GET /api/trending/daily
 * @access  Public
 */
const getDailyTrends = asyncHandler(async (req, res, next) => {
  // Son 7 günlük trendlerin günlük değişimini gösterir

  // Kaç gün geriye gidileceği
  const days = parseInt(req.query.days, 10) || 7;
  const limit = parseInt(req.query.limit, 10) || 10;

  // Son X günün her günü için trendleri hesapla
  const dailyTrends = [];

  for (let i = 0; i < days; i++) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - i - 1);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);

    // O gün için en yüksek oy alan gönderiler
    const topPosts = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          isDeleted: false,
        },
      },
      {
        $sort: { voteScore: -1 },
      },
      {
        $limit: limit,
      },
      {
        $lookup: {
          from: 'subreddits',
          localField: 'subreddit',
          foreignField: '_id',
          as: 'subredditInfo',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'author',
          foreignField: '_id',
          as: 'authorInfo',
        },
      },
      {
        $addFields: {
          subredditInfo: { $arrayElemAt: ['$subredditInfo', 0] },
          authorInfo: { $arrayElemAt: ['$authorInfo', 0] },
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          type: 1,
          createdAt: 1,
          voteScore: 1,
          commentCount: 1,
          slug: 1,
          'subredditInfo.name': 1,
          'authorInfo.username': 1,
        },
      },
    ]);

    // O gün için en aktif topluluklar
    const topSubreddits = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: '$subreddit',
          postCount: { $sum: 1 },
          totalVotes: { $sum: '$voteScore' },
          totalComments: { $sum: '$commentCount' },
        },
      },
      {
        $sort: { postCount: -1 },
      },
      {
        $limit: 5,
      },
      {
        $lookup: {
          from: 'subreddits',
          localField: '_id',
          foreignField: '_id',
          as: 'subredditInfo',
        },
      },
      {
        $addFields: {
          subredditInfo: { $arrayElemAt: ['$subredditInfo', 0] },
        },
      },
      {
        $project: {
          _id: 1,
          name: '$subredditInfo.name',
          title: '$subredditInfo.title',
          postCount: 1,
          totalVotes: 1,
          totalComments: 1,
        },
      },
    ]);

    dailyTrends.push({
      date: startDate,
      topPosts,
      topSubreddits,
    });
  }

  res.status(200).json({
    success: true,
    data: dailyTrends,
  });
});

module.exports = {
  getTrendingPosts,
  getTrendingSubreddits,
  getTrendingTags,
  getTrendingComments,
  getRisingCommunities,
  getTrendingDistribution,
  getDailyTrends,
};
