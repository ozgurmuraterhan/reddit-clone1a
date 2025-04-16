const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const Post = require('../models/Post');
const Subreddit = require('../models/Subreddit');
const SubredditMembership = require('../models/SubredditMembership');
const User = require('../models/User');
const Vote = require('../models/Vote');

/**
 * @desc    Ana feed'i getir (All)
 * @route   GET /api/feed
 * @access  Public
 */
const getMainFeed = asyncHandler(async (req, res, next) => {
  // Sayfalama parametreleri
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const skip = (page - 1) * limit;

  const sort = req.query.sort || 'hot';

  // Zaman aralığı (today, week, month, year, all)
  const timeRange = req.query.timeRange || 'all';

  // NSFW kontrol
  const includeNSFW = req.query.includeNSFW === 'true';

  // Query oluşturma
  let query = { isDeleted: false };

  // NSFW içerikleri filtrele
  if (!includeNSFW) {
    query.isNSFW = false;
  }

  // Zaman aralığı filtresi
  if (timeRange !== 'all') {
    const timeFilters = {
      today: 24 * 60 * 60 * 1000, // 1 gün (ms)
      week: 7 * 24 * 60 * 60 * 1000, // 1 hafta (ms)
      month: 30 * 24 * 60 * 60 * 1000, // 30 gün (ms)
      year: 365 * 24 * 60 * 60 * 1000, // 1 yıl (ms)
    };

    const timeAgo = new Date(Date.now() - timeFilters[timeRange]);
    query.createdAt = { $gte: timeAgo };
  }

  // Sadece public subreddit içeriklerini getir
  const publicSubreddits = await Subreddit.find({ type: 'public' }).select('_id');
  query.subreddit = { $in: publicSubreddits.map((s) => s._id) };

  // Sıralama stratejisi
  let sortOption = {};

  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'controversial':
      // Controversial için özel sıralama: yüksek toplam oy + düşük skor farkı
      sortOption = {
        $expr: {
          $divide: [
            { $abs: { $subtract: ['$upvotes', '$downvotes'] } },
            { $add: ['$upvotes', '$downvotes', 1] }, // 0'a bölünmeyi önlemek için +1
          ],
        },
        createdAt: -1,
      };
      break;
    case 'hot':
    default:
      // Hot için özel sıralama: Wilson score confidence + zaman faktörü
      // Basitleştirilmiş versiyon: yüksek skor + yeni içerik
      sortOption = {
        voteScore: -1,
        commentCount: -1,
        createdAt: -1,
      };
  }

  // Kullanıcı kimliği varsa, kişiselleştirme uygula
  let userVotes = [];
  let userSaved = [];

  if (req.user) {
    const userId = req.user._id;

    // Kullanıcının oylarını getir
    userVotes = await Vote.find({
      user: userId,
      post: { $exists: true },
    }).select('post value');

    // Kullanıcının kaydettiği içerikleri getir
    userSaved = await mongoose
      .model('SavedItem')
      .find({
        user: userId,
        post: { $exists: true },
      })
      .select('post');
  }

  // Post'ları getir
  const posts = await Post.find(query)
    .sort(sortOption)
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  // Toplam post sayısını getir
  const total = await Post.countDocuments(query);

  // Kullanıcı verilerini ekle
  const postsWithUserData = posts.map((post) => {
    // Varsayılan değerler
    post.userVote = 0;
    post.isSaved = false;

    // Kullanıcı oturum açmışsa, kişiselleştirme uygula
    if (req.user) {
      // Kullanıcının oy bilgisini ekle
      const userVote = userVotes.find((vote) => vote.post.toString() === post._id.toString());
      if (userVote) {
        post.userVote = userVote.value;
      }

      // Kullanıcının kaydetme bilgisini ekle
      const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
      post.isSaved = !!saved;
    }

    return post;
  });

  res.status(200).json({
    success: true,
    data: postsWithUserData,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Kullanıcının kişisel feed'ini getir (aboneliklere göre)
 * @route   GET /api/feed/home
 * @access  Private
 */
const getHomeFeed = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Sayfalama parametreleri
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const skip = (page - 1) * limit;

  // Sıralama tipi (hot, new, top, controversial)
  const sort = req.query.sort || 'hot';

  // Zaman aralığı (today, week, month, year, all)
  const timeRange = req.query.timeRange || 'all';

  // NSFW kontrol
  const includeNSFW = req.query.includeNSFW === 'true';

  // Kullanıcının üye olduğu subreddit'leri getir
  const memberships = await SubredditMembership.find({
    user: userId,
    type: 'member',
  }).select('subreddit');

  const subscribedSubreddits = memberships.map((m) => m.subreddit);

  // Eğer kullanıcı hiçbir subreddit'e üye değilse, popüler feed'i göster
  if (subscribedSubreddits.length === 0) {
    return getPopularFeed(req, res, next);
  }

  // Query oluşturma
  let query = {
    isDeleted: false,
    subreddit: { $in: subscribedSubreddits },
  };

  // NSFW içerikleri filtrele
  if (!includeNSFW) {
    query.isNSFW = false;
  }

  // Zaman aralığı filtresi
  if (timeRange !== 'all') {
    const timeFilters = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };

    const timeAgo = new Date(Date.now() - timeFilters[timeRange]);
    query.createdAt = { $gte: timeAgo };
  }

  // Sıralama stratejisi
  let sortOption = {};

  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'controversial':
      sortOption = {
        $expr: {
          $divide: [
            { $abs: { $subtract: ['$upvotes', '$downvotes'] } },
            { $add: ['$upvotes', '$downvotes', 1] },
          ],
        },
        createdAt: -1,
      };
      break;
    case 'hot':
    default:
      sortOption = {
        voteScore: -1,
        commentCount: -1,
        createdAt: -1,
      };
  }

  // Kullanıcının oylarını getir
  const userVotes = await Vote.find({
    user: userId,
    post: { $exists: true },
  }).select('post value');

  // Kullanıcının kaydettiği içerikleri getir
  const userSaved = await mongoose
    .model('SavedItem')
    .find({
      user: userId,
      post: { $exists: true },
    })
    .select('post');

  // Post'ları getir
  const posts = await Post.find(query)
    .sort(sortOption)
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  // Toplam post sayısını getir
  const total = await Post.countDocuments(query);

  // Kullanıcı verilerini ekle
  const postsWithUserData = posts.map((post) => {
    // Kullanıcının oy bilgisini ekle
    const userVote = userVotes.find((vote) => vote.post.toString() === post._id.toString());
    post.userVote = userVote ? userVote.value : 0;

    // Kullanıcının kaydetme bilgisini ekle
    const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
    post.isSaved = !!saved;

    return post;
  });

  res.status(200).json({
    success: true,
    data: postsWithUserData,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Popüler feed'i getir
 * @route   GET /api/feed/popular
 * @access  Public
 */
const getPopularFeed = asyncHandler(async (req, res, next) => {
  // Sayfalama parametreleri
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const skip = (page - 1) * limit;

  // Zaman aralığı (today, week, month, year, all)
  const timeRange = req.query.timeRange || 'day';

  // NSFW kontrol
  const includeNSFW = req.query.includeNSFW === 'true';

  // Query oluşturma
  let query = {
    isDeleted: false,
    isNSFW: includeNSFW ? { $in: [true, false] } : false,
  };

  // Zaman aralığı filtresi
  if (timeRange !== 'all') {
    const timeFilters = {
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };

    const timeAgo = new Date(Date.now() - timeFilters[timeRange]);
    query.createdAt = { $gte: timeAgo };
  }

  // Sadece public subreddit içeriklerini getir
  const publicSubreddits = await Subreddit.find({ type: 'public' }).select('_id');
  query.subreddit = { $in: publicSubreddits.map((s) => s._id) };

  // Popüler post'ları getir - yüksek oy + yorum sayısı
  let posts = await Post.find(query)
    .sort({
      voteScore: -1,
      commentCount: -1,
      createdAt: -1,
    })
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  // Toplam post sayısını getir
  const total = await Post.countDocuments(query);

  // Kullanıcı kimliği varsa, kişiselleştirme uygula
  if (req.user) {
    const userId = req.user._id;

    // Kullanıcının oylarını getir
    const userVotes = await Vote.find({
      user: userId,
      post: { $in: posts.map((p) => p._id) },
    }).select('post value');

    // Kullanıcının kaydettiği içerikleri getir
    const userSaved = await mongoose
      .model('SavedItem')
      .find({
        user: userId,
        post: { $in: posts.map((p) => p._id) },
      })
      .select('post');

    // Kullanıcı verilerini ekle
    posts = posts.map((post) => {
      // Kullanıcının oy bilgisini ekle
      const userVote = userVotes.find((vote) => vote.post.toString() === post._id.toString());
      post.userVote = userVote ? userVote.value : 0;

      // Kullanıcının kaydetme bilgisini ekle
      const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
      post.isSaved = !!saved;

      return post;
    });
  } else {
    // Oturum açmamış kullanıcılar için varsayılan değerler
    posts = posts.map((post) => {
      post.userVote = 0;
      post.isSaved = false;
      return post;
    });
  }

  res.status(200).json({
    success: true,
    data: posts,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Subreddit feed'i getir
 * @route   GET /api/feed/subreddit/:subredditName
 * @access  Public/Private (Subreddit tipine göre)
 */
const getSubredditFeed = asyncHandler(async (req, res, next) => {
  const { subredditName } = req.params;

  // Sayfalama parametreleri
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const skip = (page - 1) * limit;

  // Sıralama tipi (hot, new, top, controversial)
  const sort = req.query.sort || 'hot';

  // Zaman aralığı (today, week, month, year, all)
  const timeRange = req.query.timeRange || 'all';

  // NSFW kontrol
  const includeNSFW = req.query.includeNSFW === 'true';

  // Subreddit'i bul
  const subreddit = await Subreddit.findOne({
    name: subredditName,
    isDeleted: false,
  });

  if (!subreddit) {
    return next(new ErrorResponse(`${subredditName} adlı subreddit bulunamadı`, 404));
  }

  // Subreddit erişim kontrolü
  if (subreddit.type === 'private') {
    // Private subreddit için üyelik kontrolü
    if (!req.user) {
      return next(
        new ErrorResponse('Bu subreddit özeldir. Görüntülemek için giriş yapmanız gerekiyor', 401),
      );
    }

    const membership = await SubredditMembership.findOne({
      user: req.user._id,
      subreddit: subreddit._id,
      type: { $in: ['member', 'moderator'] },
    });

    if (!membership) {
      return next(new ErrorResponse("Bu özel subreddit'e erişiminiz yok", 403));
    }
  } else if (subreddit.type === 'restricted') {
    // Restricted subreddit için içerik erişimi kontrol edilmez,
    // ancak içerik gönderimi için üyelik gerekir
  }

  // Query oluşturma
  let query = {
    subreddit: subreddit._id,
    isDeleted: false,
  };

  // NSFW içerikleri filtrele (subreddit NSFW değilse)
  if (!subreddit.nsfw && !includeNSFW) {
    query.isNSFW = false;
  }

  // Zaman aralığı filtresi
  if (timeRange !== 'all') {
    const timeFilters = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };

    const timeAgo = new Date(Date.now() - timeFilters[timeRange]);
    query.createdAt = { $gte: timeAgo };
  }

  // Sıralama stratejisi
  let sortOption = {};

  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'controversial':
      sortOption = {
        $expr: {
          $divide: [
            { $abs: { $subtract: ['$upvotes', '$downvotes'] } },
            { $add: ['$upvotes', '$downvotes', 1] },
          ],
        },
        createdAt: -1,
      };
      break;
    case 'hot':
    default:
      sortOption = {
        isPinned: -1, // Pinned posts first
        voteScore: -1,
        commentCount: -1,
        createdAt: -1,
      };
  }

  // Post'ları getir
  let posts = await Post.find(query)
    .sort(sortOption)
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .populate('flair', 'text backgroundColor textColor')
    .lean();

  // Toplam post sayısını getir
  const total = await Post.countDocuments(query);

  // Kullanıcı kimliği varsa, kişiselleştirme uygula
  if (req.user) {
    const userId = req.user._id;

    // Kullanıcının oylarını getir
    const userVotes = await Vote.find({
      user: userId,
      post: { $in: posts.map((p) => p._id) },
    }).select('post value');

    // Kullanıcının kaydettiği içerikleri getir
    const userSaved = await mongoose
      .model('SavedItem')
      .find({
        user: userId,
        post: { $in: posts.map((p) => p._id) },
      })
      .select('post');

    // Kullanıcı verilerini ekle
    posts = posts.map((post) => {
      // Kullanıcının oy bilgisini ekle
      const userVote = userVotes.find((vote) => vote.post.toString() === post._id.toString());
      post.userVote = userVote ? userVote.value : 0;

      // Kullanıcının kaydetme bilgisini ekle
      const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
      post.isSaved = !!saved;

      return post;
    });
  } else {
    // Oturum açmamış kullanıcılar için varsayılan değerler
    posts = posts.map((post) => {
      post.userVote = 0;
      post.isSaved = false;
      return post;
    });
  }

  res.status(200).json({
    success: true,
    data: posts,
    subreddit: {
      _id: subreddit._id,
      name: subreddit.name,
      title: subreddit.title,
      description: subreddit.description,
      icon: subreddit.icon,
      banner: subreddit.banner,
      type: subreddit.type,
      nsfw: subreddit.nsfw,
      memberCount: subreddit.memberCount,
      createdAt: subreddit.createdAt,
    },
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Trend olan içerikleri getir
 * @route   GET /api/feed/trending
 * @access  Public
 */
const getTrendingFeed = asyncHandler(async (req, res, next) => {
  // NSFW kontrol
  const includeNSFW = req.query.includeNSFW === 'true';

  // Sadece public subreddit'lerdeki içerikleri getir
  const publicSubreddits = await Subreddit.find({ type: 'public' }).select('_id');

  // Son 24 saate trend olan postları bul
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const query = {
    isDeleted: false,
    createdAt: { $gte: oneDayAgo },
    subreddit: { $in: publicSubreddits.map((s) => s._id) },
  };

  if (!includeNSFW) {
    query.isNSFW = false;
  }

  // Yeni, hızla oy alan veya yorum alan postları bul
  // Trend formülü: (upvotes / age) + (commentCount / age)
  const posts = await Post.aggregate([
    { $match: query },
    {
      $addFields: {
        age: { $subtract: [new Date(), '$createdAt'] },
        totalActivity: { $add: ['$voteScore', '$commentCount'] },
      },
    },
    {
      $addFields: {
        trendScore: {
          $divide: [
            '$totalActivity',
            { $max: [{ $divide: ['$age', 1000 * 60 * 60] }, 1] }, // Saat başına aktivite (minimum 1)
          ],
        },
      },
    },
    { $sort: { trendScore: -1 } },
    { $limit: 10 },
  ]);

  // Post detaylarını getir
  const trendingPosts = await Post.find({ _id: { $in: posts.map((p) => p._id) } })
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  // Kullanıcı kimliği varsa, kişiselleştirme uygula
  let postsWithUserData = [...trendingPosts];

  if (req.user) {
    const userId = req.user._id;

    // Kullanıcının oylarını getir
    const userVotes = await Vote.find({
      user: userId,
      post: { $in: trendingPosts.map((p) => p._id) },
    }).select('post value');

    // Kullanıcının kaydettiği içerikleri getir
    const userSaved = await mongoose
      .model('SavedItem')
      .find({
        user: userId,
        post: { $in: trendingPosts.map((p) => p._id) },
      })
      .select('post');

    // Kullanıcı verilerini ekle
    postsWithUserData = trendingPosts.map((post) => {
      // Kullanıcının oy bilgisini ekle
      const userVote = userVotes.find((vote) => vote.post.toString() === post._id.toString());
      post.userVote = userVote ? userVote.value : 0;

      // Kullanıcının kaydetme bilgisini ekle
      const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
      post.isSaved = !!saved;

      return post;
    });
  } else {
    // Oturum açmamış kullanıcılar için varsayılan değerler
    postsWithUserData = trendingPosts.map((post) => {
      post.userVote = 0;
      post.isSaved = false;
      return post;
    });
  }

  res.status(200).json({
    success: true,
    data: postsWithUserData,
  });
});

/**
 * @desc    Kullanıcı için önerilen içerikleri getir
 * @route   GET /api/feed/recommended
 * @access  Private
 */
const getRecommendedFeed = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Sayfalama parametreleri
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const skip = (page - 1) * limit;

  // NSFW kontrol
  const includeNSFW = req.query.includeNSFW === 'true';

  // Kullanıcının üye olduğu subreddit'leri getir
  const memberships = await SubredditMembership.find({
    user: userId,
    type: 'member',
  }).select('subreddit');

  const subscribedSubreddits = memberships.map((m) => m.subreddit);

  // Kullanıcının son etkileşimde bulunduğu içerikleri getir
  const userVotes = await Vote.find({
    user: userId,
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Son 30 gün
  }).populate('post', 'subreddit');

  // Kullanıcının etkileşimde bulunduğu subredditler
  const interactedSubreddits = userVotes
    .filter((vote) => vote.post && vote.post.subreddit)
    .map((vote) => vote.post.subreddit.toString());

  // Önerilen subreddit'leri bul: etkileşimde bulunulan ama üye olunmayan
  const recommendedSubreddits = [...new Set(interactedSubreddits)].filter(
    (id) => !subscribedSubreddits.includes(id),
  );

  // Kullanıcının ilgi alanlarına göre subreddit önerileri
  // Üye olunan subreddit'lerdeki diğer kullanıcıların yaygın olarak üye olduğu subreddit'ler
  const similarSubreddits = await SubredditMembership.aggregate([
    { $match: { subreddit: { $in: subscribedSubreddits } } },
    { $group: { _id: '$user', count: { $sum: 1 } } },
    {
      $lookup: {
        from: 'subreddit_memberships',
        localField: '_id',
        foreignField: 'user',
        as: 'other_memberships',
      },
    },
    { $unwind: '$other_memberships' },
    { $match: { 'other_memberships.subreddit': { $nin: subscribedSubreddits } } },
    { $group: { _id: '$other_memberships.subreddit', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  // Tüm önerilen subreddit'leri birleştir
  const allRecommendedSubreddits = [
    ...recommendedSubreddits,
    ...similarSubreddits.map((s) => s._id),
  ];

  // Önerilen subreddit'lerdeki popüler postları getir
  let query = {
    isDeleted: false,
    subreddit: { $in: allRecommendedSubreddits },
  };

  if (!includeNSFW) {
    query.isNSFW = false;
  }

  // Son 7 gündeki içerikler
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  query.createdAt = { $gte: oneWeekAgo };

  // Önerilen post'ları getir
  let recommendedPosts = await Post.find(query)
    .sort({ voteScore: -1, commentCount: -1 })
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  // Eğer yeterli öneri yoksa, genel olarak popüler içerikleri ekle
  if (recommendedPosts.length < limit) {
    const remainingLimit = limit - recommendedPosts.length;

    // Zaten önerilen postların ID'lerini topla
    const existingPostIds = recommendedPosts.map((p) => p._id);

    // Genel popüler içerikleri getir
    const publicSubreddits = await Subreddit.find({ type: 'public' }).select('_id');

    const generalQuery = {
      isDeleted: false,
      _id: { $nin: existingPostIds },
      subreddit: { $in: publicSubreddits.map((s) => s._id) },
    };

    if (!includeNSFW) {
      generalQuery.isNSFW = false;
    }

    const popularPosts = await Post.find(generalQuery)
      .sort({ voteScore: -1, commentCount: -1 })
      .limit(remainingLimit)
      .populate('author', 'username profilePicture totalKarma')
      .populate('subreddit', 'name icon type')
      .lean();

    // Önerilere ekle
    recommendedPosts = [...recommendedPosts, ...popularPosts];
  }

  // Kullanıcının oylarını getir
  const userPostVotes = await Vote.find({
    user: userId,
    post: { $in: recommendedPosts.map((p) => p._id) },
  }).select('post value');

  // Kullanıcının kaydettiği içerikleri getir
  const userSaved = await mongoose
    .model('SavedItem')
    .find({
      user: userId,
      post: { $in: recommendedPosts.map((p) => p._id) },
    })
    .select('post');

  // Kullanıcı verilerini ekle
  const postsWithUserData = recommendedPosts.map((post) => {
    // Kullanıcının oy bilgisini ekle
    const userVote = userPostVotes.find((vote) => vote.post.toString() === post._id.toString());
    post.userVote = userVote ? userVote.value : 0;

    // Kullanıcının kaydetme bilgisini ekle
    const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
    post.isSaved = !!saved;

    return post;
  });

  res.status(200).json({
    success: true,
    data: postsWithUserData,
    pagination: {
      page,
      limit,
      hasMore: recommendedPosts.length === limit,
    },
  });
});

/**
 * @desc    Kullanıcının profil feed'ini getir
 * @route   GET /api/feed/user/:username
 * @access  Public
 */
const getUserFeed = asyncHandler(async (req, res, next) => {
  const { username } = req.params;

  // Sayfalama parametreleri
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const skip = (page - 1) * limit;

  // Sıralama tipi (new, top, controversial)
  const sort = req.query.sort || 'new';

  // Zaman aralığı (today, week, month, year, all)
  const timeRange = req.query.timeRange || 'all';

  // NSFW kontrol
  const includeNSFW = req.query.includeNSFW === 'true';

  // Kullanıcıyı bul
  const user = await User.findOne({ username }).select(
    '_id username profilePicture bio totalKarma createdAt',
  );

  if (!user) {
    return next(new ErrorResponse(`${username} adlı kullanıcı bulunamadı`, 404));
  }

  // Kullanıcının postlarını getir
  let query = {
    author: user._id,
    isDeleted: false,
  };

  if (!includeNSFW) {
    query.isNSFW = false;
  }

  // Zaman aralığı filtresi
  if (timeRange !== 'all') {
    const timeFilters = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };

    const timeAgo = new Date(Date.now() - timeFilters[timeRange]);
    query.createdAt = { $gte: timeAgo };
  }

  // Sıralama stratejisi
  let sortOption = {};

  switch (sort) {
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'controversial':
      sortOption = {
        $expr: {
          $divide: [
            { $abs: { $subtract: ['$upvotes', '$downvotes'] } },
            { $add: ['$upvotes', '$downvotes', 1] },
          ],
        },
        createdAt: -1,
      };
      break;
    case 'new':
    default:
      sortOption = { createdAt: -1 };
  }

  // Post'ları getir
  let posts = await Post.find(query)
    .sort(sortOption)
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  // Toplam post sayısını getir
  const total = await Post.countDocuments(query);

  // Kullanıcı kimliği varsa, kişiselleştirme uygula
  if (req.user) {
    const userId = req.user._id;

    // Kullanıcının oylarını getir
    const userVotes = await Vote.find({
      user: userId,
      post: { $in: posts.map((p) => p._id) },
    }).select('post value');

    // Kullanıcının kaydettiği içerikleri getir
    const userSaved = await mongoose
      .model('SavedItem')
      .find({
        user: userId,
        post: { $in: posts.map((p) => p._id) },
      })
      .select('post');

    // Kullanıcı verilerini ekle
    posts = posts.map((post) => {
      // Kullanıcının oy bilgisini ekle
      const userVote = userVotes.find((vote) => vote.post.toString() === post._id.toString());
      post.userVote = userVote ? userVote.value : 0;

      // Kullanıcının kaydetme bilgisini ekle
      const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
      post.isSaved = !!saved;

      return post;
    });
  } else {
    // Oturum açmamış kullanıcılar için varsayılan değerler
    posts = posts.map((post) => {
      post.userVote = 0;
      post.isSaved = false;
      return post;
    });
  }

  res.status(200).json({
    success: true,
    data: posts,
    user: {
      _id: user._id,
      username: user.username,
      profilePicture: user.profilePicture,
      bio: user.bio,
      totalKarma: user.totalKarma,
      createdAt: user.createdAt,
    },
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Arama sonuçları feed'i
 * @route   GET /api/feed/search
 * @access  Public
 */
const getSearchFeed = asyncHandler(async (req, res, next) => {
  const { q } = req.query;

  if (!q || q.trim().length === 0) {
    return next(new ErrorResponse('Arama terimi gereklidir', 400));
  }

  // Sayfalama parametreleri
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const skip = (page - 1) * limit;

  // Filtreleme parametreleri
  const sort = req.query.sort || 'relevance';
  const timeRange = req.query.timeRange || 'all';
  const subredditFilter = req.query.subreddit;
  const authorFilter = req.query.author;
  const typeFilter = req.query.type;
  const includeNSFW = req.query.includeNSFW === 'true';

  // Temel sorgu hazırla
  let query = {
    isDeleted: false,
    $text: { $search: q },
  };

  // NSFW içerikleri filtrele
  if (!includeNSFW) {
    query.isNSFW = false;
  }

  // Sadece public subreddit'leri dahil et (özel filtreleme yoksa)
  if (!subredditFilter) {
    const publicSubreddits = await Subreddit.find({ type: 'public' }).select('_id');
    query.subreddit = { $in: publicSubreddits.map((s) => s._id) };
  }

  // Zaman aralığı filtresi
  if (timeRange !== 'all') {
    const timeFilters = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };

    const timeAgo = new Date(Date.now() - timeFilters[timeRange]);
    query.createdAt = { $gte: timeAgo };
  }

  // Subreddit filtreleme
  if (subredditFilter) {
    const subreddit = await Subreddit.findOne({ name: subredditFilter });
    if (subreddit) {
      query.subreddit = subreddit._id;
    }
  }

  // Yazar filtreleme
  if (authorFilter) {
    const author = await User.findOne({ username: authorFilter });
    if (author) {
      query.author = author._id;
    }
  }

  // İçerik tipi filtreleme
  if (typeFilter && ['text', 'link', 'image', 'video', 'poll'].includes(typeFilter)) {
    query.type = typeFilter;
  }

  // Sıralama stratejisi
  let sortOption = {};

  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'comments':
      sortOption = { commentCount: -1, createdAt: -1 };
      break;
    case 'relevance':
    default:
      sortOption = { score: { $meta: 'textScore' }, voteScore: -1, createdAt: -1 };
      break;
  }

  // Post'ları getir
  let posts = await Post.find(query)
    .select(sort === 'relevance' ? { score: { $meta: 'textScore' } } : '')
    .sort(sortOption)
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  // Toplam post sayısını getir
  const total = await Post.countDocuments(query);

  // Kullanıcı kimliği varsa, kişiselleştirme uygula
  if (req.user) {
    const userId = req.user._id;

    // Kullanıcının oylarını getir
    const userVotes = await Vote.find({
      user: userId,
      post: { $in: posts.map((p) => p._id) },
    }).select('post value');

    // Kullanıcının kaydettiği içerikleri getir
    const userSaved = await mongoose
      .model('SavedItem')
      .find({
        user: userId,
        post: { $in: posts.map((p) => p._id) },
      })
      .select('post');

    // Kullanıcı verilerini ekle
    posts = posts.map((post) => {
      // Kullanıcının oy bilgisini ekle
      const userVote = userVotes.find((vote) => vote.post.toString() === post._id.toString());
      post.userVote = userVote ? userVote.value : 0;

      // Kullanıcının kaydetme bilgisini ekle
      const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
      post.isSaved = !!saved;

      return post;
    });
  } else {
    // Oturum açmamış kullanıcılar için varsayılan değerler
    posts = posts.map((post) => {
      post.userVote = 0;
      post.isSaved = false;
      return post;
    });
  }

  res.status(200).json({
    success: true,
    data: posts,
    query: q,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Belirli bir tag/etiket için feed
 * @route   GET /api/feed/tag/:tagName
 * @access  Public
 */
const getTagFeed = asyncHandler(async (req, res, next) => {
  const { tagName } = req.params;

  // Sayfalama parametreleri
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const skip = (page - 1) * limit;

  // Sıralama tipi (hot, new, top)
  const sort = req.query.sort || 'hot';

  // Zaman aralığı (today, week, month, year, all)
  const timeRange = req.query.timeRange || 'all';

  // NSFW kontrol
  const includeNSFW = req.query.includeNSFW === 'true';

  // Tag'i kontrol et
  const tag = await mongoose.model('Tag').findOne({ name: tagName.toLowerCase() });

  if (!tag) {
    return next(new ErrorResponse(`${tagName} etiketi bulunamadı`, 404));
  }

  // Tag'i içeren post'ları bul
  const taggedPosts = await mongoose.model('PostTag').find({ tag: tag._id }).select('post');
  const postIds = taggedPosts.map((pt) => pt.post);

  if (postIds.length === 0) {
    return res.status(200).json({
      success: true,
      data: [],
      pagination: {
        page,
        limit,
        total: 0,
        pages: 0,
      },
    });
  }

  // Query oluşturma
  let query = {
    _id: { $in: postIds },
    isDeleted: false,
  };

  if (!includeNSFW) {
    query.isNSFW = false;
  }

  // Zaman aralığı filtresi
  if (timeRange !== 'all') {
    const timeFilters = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };

    const timeAgo = new Date(Date.now() - timeFilters[timeRange]);
    query.createdAt = { $gte: timeAgo };
  }

  // Sıralama stratejisi
  let sortOption = {};

  switch (sort) {
    case 'new':
      sortOption = { createdAt: -1 };
      break;
    case 'top':
      sortOption = { voteScore: -1, createdAt: -1 };
      break;
    case 'hot':
    default:
      sortOption = {
        voteScore: -1,
        commentCount: -1,
        createdAt: -1,
      };
  }

  // Post'ları getir
  let posts = await Post.find(query)
    .sort(sortOption)
    .skip(skip)
    .limit(limit)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  // Toplam post sayısını getir
  const total = await Post.countDocuments(query);

  // Kullanıcı kimliği varsa, kişiselleştirme uygula
  if (req.user) {
    const userId = req.user._id;

    // Kullanıcının oylarını getir
    const userVotes = await Vote.find({
      user: userId,
      post: { $in: posts.map((p) => p._id) },
    }).select('post value');

    // Kullanıcının kaydettiği içerikleri getir
    const userSaved = await mongoose
      .model('SavedItem')
      .find({
        user: userId,
        post: { $in: posts.map((p) => p._id) },
      })
      .select('post');

    // Kullanıcı verilerini ekle
    posts = posts.map((post) => {
      // Kullanıcının oy bilgisini ekle
      const userVote = userVotes.find((vote) => vote.post.toString() === post._id.toString());
      post.userVote = userVote ? userVote.value : 0;

      // Kullanıcının kaydetme bilgisini ekle
      const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
      post.isSaved = !!saved;

      return post;
    });
  } else {
    // Oturum açmamış kullanıcılar için varsayılan değerler
    posts = posts.map((post) => {
      post.userVote = 0;
      post.isSaved = false;
      return post;
    });
  }

  res.status(200).json({
    success: true,
    data: posts,
    tag: {
      _id: tag._id,
      name: tag.name,
      postCount: total,
    },
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Farklı kategorilerdeki içeriklerin karışık olduğu bir feed
 * @route   GET /api/feed/mixed
 * @access  Public/Private
 */
const getMixedFeed = asyncHandler(async (req, res, next) => {
  // NSFW kontrol
  const includeNSFW = req.query.includeNSFW === 'true';

  // Her kategori için getirilecek post sayısı
  const postsPerCategory = 5;

  // Sadece public subreddit'leri içerecek şekilde filtre
  const publicSubreddits = await Subreddit.find({ type: 'public' }).select('_id');
  const publicSubredditIds = publicSubreddits.map((s) => s._id);

  // Temel sorgu parametreleri
  const baseQuery = {
    isDeleted: false,
    subreddit: { $in: publicSubredditIds },
    isNSFW: includeNSFW ? { $in: [true, false] } : false,
  };

  // Kategorilere göre postlar
  const trendingPosts = await Post.find({
    ...baseQuery,
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  })
    .sort({ voteScore: -1, commentCount: -1 })
    .limit(postsPerCategory)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  const newPosts = await Post.find(baseQuery)
    .sort({ createdAt: -1 })
    .limit(postsPerCategory)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  const topPosts = await Post.find(baseQuery)
    .sort({ voteScore: -1 })
    .limit(postsPerCategory)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  const discussionPosts = await Post.find({
    ...baseQuery,
    commentCount: { $gt: 10 },
  })
    .sort({ commentCount: -1, createdAt: -1 })
    .limit(postsPerCategory)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  const mediaPosts = await Post.find({
    ...baseQuery,
    type: { $in: ['image', 'video'] },
  })
    .sort({ voteScore: -1, createdAt: -1 })
    .limit(postsPerCategory)
    .populate('author', 'username profilePicture totalKarma')
    .populate('subreddit', 'name icon type')
    .lean();

  // Tüm postları tekil ID'ler olacak şekilde birleştir
  const allPostsMap = new Map();

  [...trendingPosts, ...newPosts, ...topPosts, ...discussionPosts, ...mediaPosts].forEach(
    (post) => {
      if (!allPostsMap.has(post._id.toString())) {
        allPostsMap.set(post._id.toString(), post);
      }
    },
  );

  const allPosts = Array.from(allPostsMap.values());

  // Kullanıcı kimliği varsa, kişiselleştirme uygula
  if (req.user) {
    const userId = req.user._id;

    // Kullanıcının oylarını getir
    const userVotes = await Vote.find({
      user: userId,
      post: { $in: allPosts.map((p) => p._id) },
    }).select('post value');

    // Kullanıcının kaydettiği içerikleri getir
    const userSaved = await mongoose
      .model('SavedItem')
      .find({
        user: userId,
        post: { $in: allPosts.map((p) => p._id) },
      })
      .select('post');

    // Kullanıcı verilerini ekle
    allPosts.forEach((post) => {
      // Kullanıcının oy bilgisini ekle
      const userVote = userVotes.find((vote) => vote.post.toString() === post._id.toString());
      post.userVote = userVote ? userVote.value : 0;

      // Kullanıcının kaydetme bilgisini ekle
      const saved = userSaved.find((item) => item.post.toString() === post._id.toString());
      post.isSaved = !!saved;
    });
  } else {
    // Oturum açmamış kullanıcılar için varsayılan değerler
    allPosts.forEach((post) => {
      post.userVote = 0;
      post.isSaved = false;
    });
  }

  res.status(200).json({
    success: true,
    data: {
      trending: trendingPosts,
      new: newPosts,
      top: topPosts,
      discussion: discussionPosts,
      media: mediaPosts,
      all: allPosts,
    },
  });
});

module.exports = {
  getMainFeed,
  getHomeFeed,
  getPopularFeed,
  getSubredditFeed,
  getTrendingFeed,
  getRecommendedFeed,
  getUserFeed,
  getSearchFeed,
  getTagFeed,
  getMixedFeed,
};
