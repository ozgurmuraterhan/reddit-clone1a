const { Post, Comment, Subreddit, Vote, Tag } = require('../models');

/**
 * Trend olan gönderileri getir
 * @route GET /api/trending/posts
 * @access Public
 */
const getTrendingPosts = async (req, res) => {
  try {
    const { timeRange = '24h', limit = 10, category } = req.query;

    // Zaman aralığını belirle
    let startDate;
    const now = new Date();

    switch (timeRange) {
      case '1h':
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '12h':
        startDate = new Date(now.getTime() - 12 * 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Kategori filtresi
    const filter = {
      createdAt: { $gte: startDate },
      isDeleted: false,
    };

    if (category) {
      filter.category = category;
    }

    // Son zamanlardaki popüler gönderileri bul
    const trendingPosts = await Post.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'votes',
          localField: '_id',
          foreignField: 'post',
          as: 'votes',
        },
      },
      {
        $lookup: {
          from: 'comments',
          localField: '_id',
          foreignField: 'post',
          as: 'comments',
        },
      },
      {
        $addFields: {
          upvotes: {
            $size: {
              $filter: {
                input: '$votes',
                as: 'vote',
                cond: { $eq: ['$$vote.voteType', 'upvote'] },
              },
            },
          },
          downvotes: {
            $size: {
              $filter: {
                input: '$votes',
                as: 'vote',
                cond: { $eq: ['$$vote.voteType', 'downvote'] },
              },
            },
          },
          commentCount: { $size: '$comments' },
        },
      },
      {
        $addFields: {
          // Reddit-benzeri "hot" algoritması
          score: {
            $add: [
              { $subtract: ['$upvotes', '$downvotes'] },
              {
                $multiply: [
                  '$commentCount',
                  0.5, // Yorumların ağırlığı
                ],
              },
            ],
          },
          age: {
            $divide: [
              { $subtract: [now, '$createdAt'] },
              3600000, // Saat cinsinden yaş
            ],
          },
        },
      },
      {
        $addFields: {
          // Sonuç = puan / (yaş + 2)^1.8
          hotScore: {
            $divide: [
              '$score',
              {
                $pow: [{ $add: ['$age', 2] }, 1.8],
              },
            ],
          },
        },
      },
      { $sort: { hotScore: -1 } },
      { $limit: parseInt(limit) },
      { $project: { votes: 0, comments: 0 } }, // Votes ve comments dizilerini kaldır
    ]);

    // Populate işlemi
    const populatedPosts = await Post.populate(trendingPosts, [
      { path: 'author', select: 'username profilePicture' },
      { path: 'subreddit', select: 'name description profileImage' },
    ]);

    res.status(200).json({
      success: true,
      count: populatedPosts.length,
      data: populatedPosts,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Trend gönderiler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Trend olan subredditleri getir
 * @route GET /api/trending/subreddits
 * @access Public
 */
const getTrendingSubreddits = async (req, res) => {
  try {
    const { timeRange = '7d', limit = 10 } = req.query;

    // Zaman aralığını belirle
    let startDate;
    const now = new Date();

    switch (timeRange) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Belirli zaman diliminde en çok üyelik alan subredditler
    const trendingSubreddits = await Subreddit.aggregate([
      {
        $lookup: {
          from: 'subreddit_memberships',
          localField: '_id',
          foreignField: 'subreddit',
          as: 'memberships',
        },
      },
      {
        $addFields: {
          recentMembers: {
            $size: {
              $filter: {
                input: '$memberships',
                as: 'membership',
                cond: { $gte: ['$$membership.createdAt', startDate] },
              },
            },
          },
          totalMembers: { $size: '$memberships' },
        },
      },
      {
        $match: {
          recentMembers: { $gt: 0 },
        },
      },
      {
        $sort: { recentMembers: -1 },
      },
      {
        $limit: parseInt(limit),
      },
      {
        $project: {
          memberships: 0,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      count: trendingSubreddits.length,
      data: trendingSubreddits,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Trend subredditler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Trend olan etiketleri getir
 * @route GET /api/trending/tags
 * @access Public
 */
const getTrendingTags = async (req, res) => {
  try {
    const { timeRange = '24h', limit = 20 } = req.query;

    // Zaman aralığını belirle
    let startDate;
    const now = new Date();

    switch (timeRange) {
      case '1h':
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Son zamanlardaki popüler etiketleri bul
    const trendingTags = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          isDeleted: false,
          tags: { $exists: true, $ne: [] },
        },
      },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          posts: { $push: '$_id' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: parseInt(limit) },
    ]);

    // Tag bilgilerini getir
    const tagDetails = await Tag.populate(trendingTags, {
      path: '_id',
      select: 'name description color',
    });

    const result = tagDetails.map((tag) => ({
      tag: tag._id,
      count: tag.count,
      postCount: tag.posts.length,
    }));

    res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Trend etiketler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Bugünün en çok etkileşim alan başlıklarını getir
 * @route GET /api/trending/today
 * @access Public
 */
const getTodayTrending = async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    // Bugünün başlangıcı
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Bugün en çok etkileşim alan gönderileri bul
    const todayTopPosts = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: today },
          isDeleted: false,
        },
      },
      {
        $lookup: {
          from: 'votes',
          localField: '_id',
          foreignField: 'post',
          as: 'votes',
        },
      },
      {
        $lookup: {
          from: 'comments',
          localField: '_id',
          foreignField: 'post',
          as: 'comments',
        },
      },
      {
        $addFields: {
          upvotes: {
            $size: {
              $filter: {
                input: '$votes',
                as: 'vote',
                cond: { $eq: ['$$vote.voteType', 'upvote'] },
              },
            },
          },
          downvotes: {
            $size: {
              $filter: {
                input: '$votes',
                as: 'vote',
                cond: { $eq: ['$$vote.voteType', 'downvote'] },
              },
            },
          },
          commentCount: { $size: '$comments' },
        },
      },
      {
        $addFields: {
          // Toplam etkileşim = upvote + commentCount * 2
          engagement: {
            $add: ['$upvotes', { $multiply: ['$commentCount', 2] }],
          },
        },
      },
      { $sort: { engagement: -1 } },
      { $limit: parseInt(limit) },
      {
        $project: {
          _id: 1,
          title: 1,
          content: 1,
          author: 1,
          subreddit: 1,
          createdAt: 1,
          upvotes: 1,
          downvotes: 1,
          commentCount: 1,
          engagement: 1,
        },
      },
    ]);

    // Populate işlemi
    const populatedPosts = await Post.populate(todayTopPosts, [
      { path: 'author', select: 'username profilePicture' },
      { path: 'subreddit', select: 'name description profileImage' },
    ]);

    res.status(200).json({
      success: true,
      count: populatedPosts.length,
      data: populatedPosts,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bugünün trend gönderileri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Hızla büyüyen yeni toplulukları getir
 * @route GET /api/trending/rising-communities
 * @access Public
 */
const getRisingCommunities = async (req, res) => {
  try {
    const { limit = 5, minDays = 7, maxDays = 90 } = req.query;

    const now = new Date();
    const minDate = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);
    const maxDate = new Date(now.getTime() - minDays * 24 * 60 * 60 * 1000);

    // Belirli gün aralığında oluşturulmuş ve hızla büyüyen toplulukları bul
    const risingCommunities = await Subreddit.aggregate([
      {
        $match: {
          createdAt: { $gte: minDate, $lte: maxDate },
          isDeleted: false,
        },
      },
      {
        $lookup: {
          from: 'subreddit_memberships',
          localField: '_id',
          foreignField: 'subreddit',
          as: 'memberships',
        },
      },
      {
        $lookup: {
          from: 'posts',
          localField: '_id',
          foreignField: 'subreddit',
          as: 'posts',
        },
      },
      {
        $addFields: {
          memberCount: { $size: '$memberships' },
          postCount: { $size: '$posts' },
          ageInDays: {
            $divide: [
              { $subtract: [now, '$createdAt'] },
              86400000, // 1 gün (ms)
            ],
          },
        },
      },
      {
        $addFields: {
          // Günlük büyüme oranı = üye sayısı / yaş
          growthRate: {
            $divide: ['$memberCount', '$ageInDays'],
          },
        },
      },
      {
        $match: {
          memberCount: { $gte: 10 }, // En az 10 üye
          postCount: { $gte: 5 }, // En az 5 gönderi
        },
      },
      { $sort: { growthRate: -1 } },
      { $limit: parseInt(limit) },
      {
        $project: {
          memberships: 0,
          posts: 0,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      count: risingCommunities.length,
      data: risingCommunities,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Hızla büyüyen topluluklar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getTrendingPosts,
  getTrendingSubreddits,
  getTrendingTags,
  getTodayTrending,
  getRisingCommunities,
};
