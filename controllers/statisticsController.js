const { Post, Comment, User, Subreddit, Vote } = require('../models');

/**
 * Subreddit istatistikleri
 * @route GET /api/subreddits/:subredditName/statistics
 * @access Public
 */
const getSubredditStats = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const { timeRange } = req.query; // day, week, month, year, all

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Zaman aralığını belirle
    const timeFilter = getTimeFilter(timeRange);

    // Temel subreddit bilgileri
    const stats = {
      name: subreddit.name,
      title: subreddit.title,
      description: subreddit.description,
      subscriberCount: subreddit.subscriberCount,
      createdAt: subreddit.createdAt,
      age: Math.floor(
        (Date.now() - new Date(subreddit.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      ), // Age in days
    };

    // Post ve yorum istatistikleri
    const postFilter = {
      subreddit: subreddit._id,
      isDeleted: false,
      isRemoved: false,
      ...timeFilter,
    };

    // Post sayısı
    stats.totalPosts = await Post.countDocuments(postFilter);

    // Yorum sayısı (subreddit'teki tüm postlara yapılan yorumlar)
    const subredditPosts = await Post.find({ subreddit: subreddit._id }).select('_id');
    const postIds = subredditPosts.map((post) => post._id);

    stats.totalComments = await Comment.countDocuments({
      post: { $in: postIds },
      isDeleted: false,
      isRemoved: false,
      ...timeFilter,
    });

    // Oy istatistikleri
    const postVotes = await Vote.aggregate([
      {
        $match: {
          post: { $in: postIds },
          ...timeFilter,
        },
      },
      {
        $group: {
          _id: '$voteType',
          count: { $sum: 1 },
        },
      },
    ]);

    stats.upvotes = postVotes.find((v) => v._id === 'upvote')?.count || 0;
    stats.downvotes = postVotes.find((v) => v._id === 'downvote')?.count || 0;
    stats.totalVotes = stats.upvotes + stats.downvotes;

    // En popüler postlar
    stats.topPosts = await Post.find(postFilter)
      .sort({ voteScore: -1 })
      .limit(5)
      .select('title author voteScore commentCount createdAt')
      .populate('author', 'username');

    // En aktif kullanıcılar
    const activeUsers = await Post.aggregate([
      { $match: postFilter },
      { $group: { _id: '$author', postCount: { $sum: 1 } } },
      { $sort: { postCount: -1 } },
      { $limit: 5 },
    ]);

    stats.activeUsers = await User.populate(activeUsers, {
      path: '_id',
      select: 'username profilePicture',
    });

    // Trafik istatistikleri
    if (timeRange === 'day') {
      // Günlük trafik (saatlik dağılım)
      const hourlyPosts = await Post.aggregate([
        { $match: postFilter },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      stats.hourlyActivity = Array.from({ length: 24 }, (_, i) => {
        const hour = hourlyPosts.find((h) => h._id === i);
        return { hour: i, count: hour ? hour.count : 0 };
      });
    } else {
      // Haftalık/aylık trafik (günlük dağılım)
      const startDate = new Date();
      const endDate = new Date();
      let days = 7;

      if (timeRange === 'month') days = 30;
      else if (timeRange === 'year') days = 365;

      startDate.setDate(startDate.getDate() - days);

      const dailyPosts = await Post.aggregate([
        {
          $match: {
            subreddit: subreddit._id,
            createdAt: { $gte: startDate, $lte: endDate },
            isDeleted: false,
            isRemoved: false,
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      // Tüm günleri içeren dizi oluştur
      const dateArray = [];
      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (days - i - 1));
        const dateStr = date.toISOString().split('T')[0];

        const dayData = dailyPosts.find((d) => d._id === dateStr);
        dateArray.push({
          date: dateStr,
          count: dayData ? dayData.count : 0,
        });
      }

      stats.dailyActivity = dateArray;
    }

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'İstatistikler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcı istatistikleri
 * @route GET /api/users/:username/statistics
 * @access Public
 */
const getUserStats = async (req, res) => {
  try {
    const { username } = req.params;
    const { timeRange } = req.query; // day, week, month, year, all

    // Kullanıcıyı bul
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    // Zaman aralığını belirle
    const timeFilter = getTimeFilter(timeRange);

    // Temel kullanıcı bilgileri
    const stats = {
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt,
      accountAge: Math.floor(
        (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      ), // Age in days
      totalKarma: user.totalKarma,
      postKarma: user.karma.post,
      commentKarma: user.karma.comment,
    };

    // Post istatistikleri
    const postFilter = { author: user._id, isDeleted: false, ...timeFilter };
    stats.totalPosts = await Post.countDocuments(postFilter);

    // Yorum istatistikleri
    const commentFilter = { author: user._id, isDeleted: false, ...timeFilter };
    stats.totalComments = await Comment.countDocuments(commentFilter);

    // En çok gönderi yapılan subreddit'ler
    const topSubreddits = await Post.aggregate([
      { $match: postFilter },
      { $group: { _id: '$subreddit', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    stats.topSubreddits = await Subreddit.populate(topSubreddits, {
      path: '_id',
      select: 'name title',
    });

    // En popüler postlar
    stats.topPosts = await Post.find(postFilter)
      .sort({ voteScore: -1 })
      .limit(5)
      .select('title subreddit voteScore commentCount createdAt')
      .populate('subreddit', 'name');

    // En popüler yorumlar
    stats.topComments = await Comment.find(commentFilter)
      .sort({ voteScore: -1 })
      .limit(5)
      .select('content voteScore createdAt')
      .populate({
        path: 'post',
        select: 'title subreddit',
        populate: { path: 'subreddit', select: 'name' },
      });

    // Aktivite grafiği
    if (timeRange === 'day' || timeRange === 'week') {
      // Saatlik aktivite
      const hourlyActivity = await Post.aggregate([
        { $match: { ...postFilter } },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            posts: { $sum: 1 },
          },
        },
      ]);

      const hourlyComments = await Comment.aggregate([
        { $match: { ...commentFilter } },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            comments: { $sum: 1 },
          },
        },
      ]);

      stats.hourlyActivity = Array.from({ length: 24 }, (_, i) => {
        const posts = hourlyActivity.find((h) => h._id === i)?.posts || 0;
        const comments = hourlyComments.find((h) => h._id === i)?.comments || 0;
        return { hour: i, posts, comments, total: posts + comments };
      });
    } else {
      // Günlük aktivite
      const startDate = new Date();
      let days = 30;

      if (timeRange === 'year') days = 365;

      startDate.setDate(startDate.getDate() - days);

      const dailyPosts = await Post.aggregate([
        {
          $match: {
            author: user._id,
            createdAt: { $gte: startDate },
            isDeleted: false,
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            posts: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      const dailyComments = await Comment.aggregate([
        {
          $match: {
            author: user._id,
            createdAt: { $gte: startDate },
            isDeleted: false,
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            comments: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      // Tüm günleri içeren dizi oluştur
      const dateArray = [];
      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (days - i - 1));
        const dateStr = date.toISOString().split('T')[0];

        const postData = dailyPosts.find((d) => d._id === dateStr);
        const commentData = dailyComments.find((d) => d._id === dateStr);

        const posts = postData ? postData.posts : 0;
        const comments = commentData ? commentData.comments : 0;

        dateArray.push({
          date: dateStr,
          posts,
          comments,
          total: posts + comments,
        });
      }

      stats.dailyActivity = dateArray;
    }

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı istatistikleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Zaman aralığı filtresi oluştur
 * @param {String} timeRange
 * @returns {Object}
 */
const getTimeFilter = (timeRange) => {
  if (!timeRange || timeRange === 'all') return {};

  const now = new Date();
  let startDate;

  switch (timeRange) {
    case 'day':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'year':
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    default:
      return {};
  }

  return { createdAt: { $gte: startDate } };
};

/**
 * Platform genel istatistikleri (admin için)
 * @route GET /api/statistics
 * @access Private/Admin
 */
const getPlatformStats = async (req, res) => {
  try {
    // Admin kontrolü
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkiniz bulunmamaktadır',
      });
    }

    const stats = {
      users: {
        total: await User.countDocuments(),
        active: await User.countDocuments({ accountStatus: 'active' }),
        newToday: await User.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        }),
      },
      posts: {
        total: await Post.countDocuments(),
        today: await Post.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        }),
      },
      comments: {
        total: await Comment.countDocuments(),
        today: await Comment.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        }),
      },
      subreddits: {
        total: await Subreddit.countDocuments(),
        active: await Subreddit.countDocuments({ status: 'active' }),
        newToday: await Subreddit.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        }),
      },
      votes: {
        total: await Vote.countDocuments(),
        upvotes: await Vote.countDocuments({ voteType: 'upvote' }),
        downvotes: await Vote.countDocuments({ voteType: 'downvote' }),
      },
    };

    // En popüler subredditler
    stats.topSubreddits = await Subreddit.find()
      .sort({ subscriberCount: -1 })
      .limit(10)
      .select('name title subscriberCount');

    // En aktif kullanıcılar (son 7 gün)
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const activePosters = await Post.aggregate([
      { $match: { createdAt: { $gte: lastWeek } } },
      { $group: { _id: '$author', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    stats.mostActiveUsers = await User.populate(activePosters, {
      path: '_id',
      select: 'username totalKarma',
    });

    // Günlük aktivite (son 30 gün)
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const dailyActivity = await Post.aggregate([
      { $match: { createdAt: { $gte: last30Days } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          posts: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dailyComments = await Comment.aggregate([
      { $match: { createdAt: { $gte: last30Days } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          comments: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Günlük aktivite grafiği oluştur
    const dailyData = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (30 - i - 1));
      const dateStr = date.toISOString().split('T')[0];

      const postData = dailyActivity.find((d) => d._id === dateStr);
      const commentData = dailyComments.find((d) => d._id === dateStr);

      dailyData.push({
        date: dateStr,
        posts: postData ? postData.posts : 0,
        comments: commentData ? commentData.comments : 0,
      });
    }

    stats.dailyActivity = dailyData;

    // Büyüme oranları (son 30 güne kıyasla)
    const last60Days = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    // Son 30 gün
    const last30DaysStats = {
      users: await User.countDocuments({ createdAt: { $gte: last30Days } }),
      posts: await Post.countDocuments({ createdAt: { $gte: last30Days } }),
      comments: await Comment.countDocuments({ createdAt: { $gte: last30Days } }),
      subreddits: await Subreddit.countDocuments({ createdAt: { $gte: last30Days } }),
    };

    // Önceki 30 gün
    const previous30DaysStats = {
      users: await User.countDocuments({
        createdAt: { $gte: last60Days, $lt: last30Days },
      }),
      posts: await Post.countDocuments({
        createdAt: { $gte: last60Days, $lt: last30Days },
      }),
      comments: await Comment.countDocuments({
        createdAt: { $gte: last60Days, $lt: last30Days },
      }),
      subreddits: await Subreddit.countDocuments({
        createdAt: { $gte: last60Days, $lt: last30Days },
      }),
    };

    // Büyüme oranlarını hesapla
    stats.growth = {
      users: calculateGrowthRate(previous30DaysStats.users, last30DaysStats.users),
      posts: calculateGrowthRate(previous30DaysStats.posts, last30DaysStats.posts),
      comments: calculateGrowthRate(previous30DaysStats.comments, last30DaysStats.comments),
      subreddits: calculateGrowthRate(previous30DaysStats.subreddits, last30DaysStats.subreddits),
    };

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Platform istatistikleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Büyüme oranı hesapla
 * @param {Number} previous
 * @param {Number} current
 * @returns {Number}
 */
const calculateGrowthRate = (previous, current) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return parseFloat((((current - previous) / previous) * 100).toFixed(2));
};

module.exports = {
  getSubredditStats,
  getUserStats,
  getPlatformStats,
};
