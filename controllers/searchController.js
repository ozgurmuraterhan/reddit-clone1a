const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Subreddit = require('../models/Subreddit');
const User = require('../models/User');
const Tag = require('../models/Tag');
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

/**
 * @desc    Genel arama fonksiyonu (tüm içerik tipleri)
 * @route   GET /api/search
 * @access  Public
 */
const searchAll = asyncHandler(async (req, res, next) => {
  const { query, type, sort, time, nsfw, subreddit } = req.query;

  // Arama sorgusu kontrolü
  if (!query || query.trim().length < 3) {
    return next(new ErrorResponse('Arama sorgusu en az 3 karakter olmalıdır', 400));
  }

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // İçerik tipi kontrolü
  const validTypes = ['all', 'post', 'comment', 'subreddit', 'user', 'tag'];
  const searchType = validTypes.includes(type) ? type : 'all';

  // Zaman filtresi
  const timeFilter = {};
  if (time) {
    const now = new Date();
    switch (time) {
      case 'day':
        timeFilter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 1)) };
        break;
      case 'week':
        timeFilter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 7)) };
        break;
      case 'month':
        timeFilter.createdAt = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
        break;
      case 'year':
        timeFilter.createdAt = { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) };
        break;
    }
  }

  // NSFW içerik kontrolü
  const nsfwFilter = {};
  if (nsfw !== undefined) {
    if (nsfw === 'false' || nsfw === '0') {
      nsfwFilter.isNSFW = false;
      nsfwFilter.nsfw = false;
    } else if (nsfw === 'true' || nsfw === '1') {
      nsfwFilter.isNSFW = true;
      nsfwFilter.nsfw = true;
    }
  } else if (!req.user || !req.user.showNSFW) {
    // Kullanıcı giriş yapmadıysa veya NSFW ayarı kapalıysa, NSFW içeriği gösterme
    nsfwFilter.isNSFW = false;
    nsfwFilter.nsfw = false;
  }

  // Subreddit filtresi
  const subredditFilter = {};
  if (subreddit) {
    // Subreddit ID veya isim olabilir
    if (mongoose.Types.ObjectId.isValid(subreddit)) {
      subredditFilter.subreddit = subreddit;
    } else {
      const foundSubreddit = await Subreddit.findOne({ name: subreddit.toLowerCase() });
      if (foundSubreddit) {
        subredditFilter.subreddit = foundSubreddit._id;
      } else {
        return next(new ErrorResponse('Belirtilen subreddit bulunamadı', 404));
      }
    }
  }

  // Sıralama seçenekleri
  const sortOptions = {
    relevance: { score: { $meta: 'textScore' } },
    new: { createdAt: -1 },
    top: { voteScore: -1 },
    comments: { commentCount: -1 },
  };

  const sortBy = sortOptions[sort] || sortOptions.relevance;

  // Toplam sonuç sayısı
  let total = 0;

  // İçerik tipine göre farklı aramalar gerçekleştir
  const results = {
    posts: [],
    comments: [],
    subreddits: [],
    users: [],
    tags: [],
  };

  // Arama işlemlerini paralel olarak yap
  if (searchType === 'all' || searchType === 'post') {
    const postQuery = {
      $text: { $search: query },
      isDeleted: false,
      ...timeFilter,
      ...nsfwFilter,
      ...subredditFilter,
    };

    const posts = await Post.find(postQuery, { score: { $meta: 'textScore' } })
      .select(
        'title content type author subreddit createdAt upvotes downvotes voteScore commentCount isNSFW',
      )
      .sort(sortBy)
      .skip(searchType === 'post' ? startIndex : 0)
      .limit(searchType === 'post' ? limit : 5)
      .populate('author', 'username profilePicture')
      .populate('subreddit', 'name title');

    results.posts = posts;

    if (searchType === 'post') {
      total = await Post.countDocuments(postQuery);
    }
  }

  if (searchType === 'all' || searchType === 'comment') {
    const commentQuery = {
      $text: { $search: query },
      isDeleted: false,
      ...timeFilter,
      ...subredditFilter,
    };

    const comments = await Comment.find(commentQuery, { score: { $meta: 'textScore' } })
      .select('content author post createdAt upvotes downvotes voteScore')
      .sort(sortBy)
      .skip(searchType === 'comment' ? startIndex : 0)
      .limit(searchType === 'comment' ? limit : 5)
      .populate('author', 'username profilePicture')
      .populate({
        path: 'post',
        select: 'title subreddit',
        populate: {
          path: 'subreddit',
          select: 'name title',
        },
      });

    results.comments = comments;

    if (searchType === 'comment') {
      total = await Comment.countDocuments(commentQuery);
    }
  }

  if (searchType === 'all' || searchType === 'subreddit') {
    const subredditQuery = {
      $or: [{ $text: { $search: query } }, { name: { $regex: query, $options: 'i' } }],
      isDeleted: false,
      ...nsfwFilter,
      ...timeFilter,
    };

    const subreddits = await Subreddit.find(subredditQuery, { score: { $meta: 'textScore' } })
      .select('name title description icon banner memberCount createdAt')
      .sort(sortBy)
      .skip(searchType === 'subreddit' ? startIndex : 0)
      .limit(searchType === 'subreddit' ? limit : 5);

    results.subreddits = subreddits;

    if (searchType === 'subreddit') {
      total = await Subreddit.countDocuments(subredditQuery);
    }
  }

  if (searchType === 'all' || searchType === 'user') {
    const userQuery = {
      $or: [{ $text: { $search: query } }, { username: { $regex: query, $options: 'i' } }],
      isDeleted: false,
      ...timeFilter,
    };

    const users = await User.find(userQuery, { score: { $meta: 'textScore' } })
      .select('username profilePicture bio createdAt karma')
      .sort(sortBy)
      .skip(searchType === 'user' ? startIndex : 0)
      .limit(searchType === 'user' ? limit : 5);

    results.users = users;

    if (searchType === 'user') {
      total = await User.countDocuments(userQuery);
    }
  }

  if (searchType === 'all' || searchType === 'tag') {
    const tagQuery = {
      $or: [{ $text: { $search: query } }, { name: { $regex: query, $options: 'i' } }],
      isActive: true,
      ...subredditFilter,
    };

    const tags = await Tag.find(tagQuery, { score: { $meta: 'textScore' } })
      .select('name color description scope subreddit')
      .sort(sortBy)
      .skip(searchType === 'tag' ? startIndex : 0)
      .limit(searchType === 'tag' ? limit : 5)
      .populate('subreddit', 'name title');

    results.tags = tags;

    if (searchType === 'tag') {
      total = await Tag.countDocuments(tagQuery);
    }
  }

  // Tüm içerik tiplerinde arama yapılıyorsa, toplam sonuç sayısını hesapla
  if (searchType === 'all') {
    const counts = await Promise.all([
      Post.countDocuments({
        $text: { $search: query },
        isDeleted: false,
        ...nsfwFilter,
        ...subredditFilter,
      }),
      Comment.countDocuments({ $text: { $search: query }, isDeleted: false, ...subredditFilter }),
      Subreddit.countDocuments({ $text: { $search: query }, isDeleted: false, ...nsfwFilter }),
      User.countDocuments({
        $or: [{ $text: { $search: query } }, { username: { $regex: query, $options: 'i' } }],
        isDeleted: false,
      }),
      Tag.countDocuments({
        $or: [{ $text: { $search: query } }, { name: { $regex: query, $options: 'i' } }],
        isActive: true,
        ...subredditFilter,
      }),
    ]);

    total = counts.reduce((acc, count) => acc + count, 0);
  }

  // Arama sorgusu loglaması (opsiyonel)
  if (req.user) {
    // Kullanıcı arama geçmişi kaydedilebilir (ayrı bir model olarak oluşturulabilir)
  }

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalResults: total,
  };

  if (startIndex + limit < total) {
    pagination.nextPage = page + 1;
  }

  if (startIndex > 0) {
    pagination.prevPage = page - 1;
  }

  res.status(200).json({
    success: true,
    data: searchType === 'all' ? results : results[`${searchType}s`],
    pagination,
    query,
    type: searchType,
  });
});

/**
 * @desc    Post araması
 * @route   GET /api/search/posts
 * @access  Public
 */
const searchPosts = asyncHandler(async (req, res, next) => {
  req.query.type = 'post';
  return searchAll(req, res, next);
});

/**
 * @desc    Yorum araması
 * @route   GET /api/search/comments
 * @access  Public
 */
const searchComments = asyncHandler(async (req, res, next) => {
  req.query.type = 'comment';
  return searchAll(req, res, next);
});

/**
 * @desc    Subreddit araması
 * @route   GET /api/search/subreddits
 * @access  Public
 */
const searchSubreddits = asyncHandler(async (req, res, next) => {
  req.query.type = 'subreddit';
  return searchAll(req, res, next);
});

/**
 * @desc    Kullanıcı araması
 * @route   GET /api/search/users
 * @access  Public
 */
const searchUsers = asyncHandler(async (req, res, next) => {
  req.query.type = 'user';
  return searchAll(req, res, next);
});

/**
 * @desc    Etiket araması
 * @route   GET /api/search/tags
 * @access  Public
 */
const searchTags = asyncHandler(async (req, res, next) => {
  req.query.type = 'tag';
  return searchAll(req, res, next);
});

/**
 * @desc    Otomatik tamamlama önerileri
 * @route   GET /api/search/autocomplete
 * @access  Public
 */
const autocomplete = asyncHandler(async (req, res, next) => {
  const { query, type } = req.query;

  if (!query || query.trim().length < 2) {
    return res.status(200).json({
      success: true,
      data: [],
    });
  }

  const limit = 10;
  let suggestions = [];

  switch (type) {
    case 'subreddit':
      suggestions = await Subreddit.find({
        name: { $regex: `^${query}`, $options: 'i' },
        isDeleted: false,
      })
        .select('name title icon memberCount')
        .sort({ memberCount: -1 })
        .limit(limit);
      break;

    case 'user':
      suggestions = await User.find({
        username: { $regex: `^${query}`, $options: 'i' },
        isDeleted: false,
      })
        .select('username profilePicture')
        .sort({ createdAt: -1 })
        .limit(limit);
      break;

    case 'tag':
      suggestions = await Tag.find({
        name: { $regex: `^${query}`, $options: 'i' },
        isActive: true,
      })
        .select('name color description scope')
        .sort({ name: 1 })
        .limit(limit);
      break;

    default:
      // Karma sonuçlar (varsayılan)
      const [subreddits, users, tags] = await Promise.all([
        Subreddit.find({
          name: { $regex: `^${query}`, $options: 'i' },
          isDeleted: false,
        })
          .select('name title icon memberCount')
          .sort({ memberCount: -1 })
          .limit(5),

        User.find({
          username: { $regex: `^${query}`, $options: 'i' },
          isDeleted: false,
        })
          .select('username profilePicture')
          .sort({ createdAt: -1 })
          .limit(5),

        Tag.find({
          name: { $regex: `^${query}`, $options: 'i' },
          isActive: true,
        })
          .select('name color description scope')
          .sort({ name: 1 })
          .limit(5),
      ]);

      suggestions = {
        subreddits,
        users,
        tags,
      };
      break;
  }

  res.status(200).json({
    success: true,
    data: suggestions,
  });
});

/**
 * @desc    Bir subreddit içinde arama
 * @route   GET /api/subreddits/:subredditId/search
 * @access  Public
 */
const searchInSubreddit = asyncHandler(async (req, res, next) => {
  const { subredditId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(subredditId)) {
    return next(new ErrorResponse('Geçersiz subreddit ID formatı', 400));
  }

  // Subreddit'in varlığını kontrol et
  const subreddit = await Subreddit.findById(subredditId);
  if (!subreddit) {
    return next(new ErrorResponse('Subreddit bulunamadı', 404));
  }

  // Subreddit filtresi ekle
  req.query.subreddit = subredditId;

  // Aranan içerik tipini kontrol et
  if (!req.query.type || req.query.type === 'subreddit') {
    req.query.type = 'post'; // Subreddit içinde varsayılan olarak post ara
  }

  // Global arama fonksiyonunu çağır
  return searchAll(req, res, next);
});

/**
 * @desc    Gelişmiş arama
 * @route   POST /api/search/advanced
 * @access  Public
 */
const advancedSearch = asyncHandler(async (req, res, next) => {
  const {
    query,
    includeKeywords,
    excludeKeywords,
    author,
    subreddit,
    dateRange,
    scoreRange,
    commentCountRange,
    flairs,
    contentTypes,
    nsfw,
    sort,
  } = req.body;

  // Ana arama sorgusu
  if (!query && !includeKeywords?.length && !author && !subreddit) {
    return next(new ErrorResponse('En az bir arama kriteri belirtilmelidir', 400));
  }

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // MongoDB sorguları oluştur
  let postQuery = { isDeleted: false };
  let commentQuery = { isDeleted: false };

  // Ana arama sorgusu
  if (query) {
    postQuery.$text = { $search: query };
    commentQuery.$text = { $search: query };
  }

  // Dahil edilecek anahtar kelimeler
  if (includeKeywords && includeKeywords.length > 0) {
    const keywordRegex = includeKeywords.map(
      (keyword) => new RegExp(keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'),
    );

    if (!postQuery.$and) postQuery.$and = [];
    if (!commentQuery.$and) commentQuery.$and = [];

    postQuery.$and.push({
      $or: [{ title: { $in: keywordRegex } }, { content: { $in: keywordRegex } }],
    });

    commentQuery.$and.push({
      content: { $in: keywordRegex },
    });
  }

  // Hariç tutulacak anahtar kelimeler
  if (excludeKeywords && excludeKeywords.length > 0) {
    const keywordRegex = excludeKeywords.map(
      (keyword) => new RegExp(keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'),
    );

    if (!postQuery.$and) postQuery.$and = [];
    if (!commentQuery.$and) commentQuery.$and = [];

    postQuery.$and.push({
      $nor: [{ title: { $in: keywordRegex } }, { content: { $in: keywordRegex } }],
    });

    commentQuery.$and.push({
      $nor: [{ content: { $in: keywordRegex } }],
    });
  }

  // Yazar filtresi
  if (author) {
    if (mongoose.Types.ObjectId.isValid(author)) {
      postQuery.author = author;
      commentQuery.author = author;
    } else {
      // Kullanıcı adı ile arama
      const authorUser = await User.findOne({ username: author });
      if (authorUser) {
        postQuery.author = authorUser._id;
        commentQuery.author = authorUser._id;
      } else {
        return next(new ErrorResponse('Belirtilen yazar bulunamadı', 404));
      }
    }
  }

  // Subreddit filtresi
  if (subreddit) {
    if (mongoose.Types.ObjectId.isValid(subreddit)) {
      postQuery.subreddit = subreddit;
      // Yorumlar için post->subreddit ilişkisi kurulacak
    } else {
      // Subreddit adı ile arama
      const subredditDoc = await Subreddit.findOne({ name: subreddit.toLowerCase() });
      if (subredditDoc) {
        postQuery.subreddit = subredditDoc._id;
        // Yorumlar için post->subreddit ilişkisi kurulacak
      } else {
        return next(new ErrorResponse('Belirtilen subreddit bulunamadı', 404));
      }
    }
  }

  // Tarih aralığı filtresi
  if (dateRange) {
    const dateFilter = {};

    if (dateRange.from) {
      dateFilter.$gte = new Date(dateRange.from);
    }

    if (dateRange.to) {
      dateFilter.$lte = new Date(dateRange.to);
    }

    if (Object.keys(dateFilter).length > 0) {
      postQuery.createdAt = dateFilter;
      commentQuery.createdAt = dateFilter;
    }
  }

  // Skor aralığı filtresi (upvotes - downvotes)
  if (scoreRange) {
    const scoreFilter = {};

    if (scoreRange.min !== undefined) {
      scoreFilter.$gte = scoreRange.min;
    }

    if (scoreRange.max !== undefined) {
      scoreFilter.$lte = scoreRange.max;
    }

    if (Object.keys(scoreFilter).length > 0) {
      postQuery.voteScore = scoreFilter;
      commentQuery.voteScore = scoreFilter;
    }
  }

  // Yorum sayısı aralığı filtresi (sadece gönderiler için)
  if (commentCountRange) {
    const commentFilter = {};

    if (commentCountRange.min !== undefined) {
      commentFilter.$gte = commentCountRange.min;
    }

    if (commentCountRange.max !== undefined) {
      commentFilter.$lte = commentCountRange.max;
    }

    if (Object.keys(commentFilter).length > 0) {
      postQuery.commentCount = commentFilter;
    }
  }

  // Flair filtresi (sadece gönderiler için)
  if (flairs && flairs.length > 0) {
    postQuery.flair = { $in: flairs };
  }

  // İçerik tipi filtresi (sadece gönderiler için)
  if (contentTypes && contentTypes.length > 0) {
    postQuery.type = { $in: contentTypes };
  }

  // NSFW içerik filtresi
  if (nsfw !== undefined) {
    postQuery.isNSFW = nsfw;
  }

  // Sıralama seçenekleri
  const sortOptions = {
    relevance: { score: { $meta: 'textScore' } },
    new: { createdAt: -1 },
    old: { createdAt: 1 },
    top: { voteScore: -1 },
    bottom: { voteScore: 1 },
    comments: { commentCount: -1 },
  };

  const sortBy = sort ? sortOptions[sort] : sortOptions.relevance;

  // İçerik tipine göre arama sonuçlarını getir
  const results = {};
  let total = 0;

  // Aranacak içerik tiplerini belirle
  const searchTypes = contentTypes || ['post', 'comment'];

  // Post araması
  if (searchTypes.includes('post')) {
    const projection = query ? { score: { $meta: 'textScore' } } : {};

    results.posts = await Post.find(postQuery, projection)
      .select(
        'title content type author subreddit createdAt upvotes downvotes voteScore commentCount isNSFW flair',
      )
      .sort(sortBy)
      .skip(startIndex)
      .limit(limit)
      .populate('author', 'username profilePicture')
      .populate('subreddit', 'name title')
      .populate('flair', 'name color');

    total += await Post.countDocuments(postQuery);
  }

  // Yorum araması
  if (searchTypes.includes('comment')) {
    const projection = query ? { score: { $meta: 'textScore' } } : {};

    // Subreddit filtresi varsa, yorumların bağlı olduğu postları filtrelememiz gerekiyor
    if (subreddit) {
      const subredditId = mongoose.Types.ObjectId.isValid(subreddit)
        ? subreddit
        : (await Subreddit.findOne({ name: subreddit.toLowerCase() }))._id;

      const postsInSubreddit = await Post.find({ subreddit: subredditId }).select('_id');
      const postIds = postsInSubreddit.map((post) => post._id);

      commentQuery.post = { $in: postIds };
    }

    results.comments = await Comment.find(commentQuery, projection)
      .select('content author post createdAt upvotes downvotes voteScore')
      .sort(sortBy)
      .skip(startIndex)
      .limit(limit)
      .populate('author', 'username profilePicture')
      .populate({
        path: 'post',
        select: 'title subreddit',
        populate: {
          path: 'subreddit',
          select: 'name title',
        },
      });

    total += await Comment.countDocuments(commentQuery);
  }

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalResults: total,
  };

  if (startIndex + limit < total) {
    pagination.nextPage = page + 1;
  }

  if (startIndex > 0) {
    pagination.prevPage = page - 1;
  }

  res.status(200).json({
    success: true,
    data: results,
    pagination,
    filters: {
      query,
      includeKeywords,
      excludeKeywords,
      author,
      subreddit,
      dateRange,
      scoreRange,
      commentCountRange,
      flairs,
      contentTypes,
      nsfw,
      sort,
    },
  });
});

/**
 * @desc    Popüler arama terimlerini getir
 * @route   GET /api/search/trending
 * @access  Public
 */
const getTrendingSearches = asyncHandler(async (req, res, next) => {
  // Not: Bu fonksiyon için ayrı bir model oluşturulabilir (SearchAnalytics)
  // Burada örnek olarak sabit bir liste dönüyoruz

  // Gerçek bir uygulamada, son aramaların istatistiklerini tutmak için
  // bir koleksiyon oluşturulabilir ve bu veriler düzenli olarak güncellenebilir

  const trending = [
    { term: 'yeni başlayanlar', count: 258 },
    { term: 'en iyi oyunlar', count: 187 },
    { term: 'güncel haberler', count: 153 },
    { term: 'resim paylaşımı', count: 129 },
    { term: 'podcast önerileri', count: 112 },
    { term: 'yemek tarifleri', count: 98 },
    { term: 'programlama', count: 87 },
    { term: 'film önerileri', count: 76 },
    { term: 'spor haberleri', count: 71 },
    { term: 'müzik listeleri', count: 65 },
  ];

  res.status(200).json({
    success: true,
    data: trending,
  });
});

/**
 * @desc    Kullanıcının geçmiş aramalarını getir
 * @route   GET /api/search/history
 * @access  Private
 */
const getSearchHistory = asyncHandler(async (req, res, next) => {
  // Not: Bu fonksiyon için ayrı bir model oluşturulabilir (UserSearchHistory)

  // Eğer kullanıcı oturum açmamışsa
  if (!req.user) {
    return next(new ErrorResponse('Bu işlem için oturum açmanız gerekiyor', 401));
  }

  // Örnek olarak sabit bir liste dönüyoruz
  // Gerçek bir uygulamada, kullanıcı aramalarını kaydetmek için
  // bir koleksiyon oluşturulabilir (örneğin UserSearchHistory)

  // Temsili kullanıcı arama geçmişi
  const history = [
    { query: 'programlama dilleri', timestamp: new Date(Date.now() - 86400000 * 2), type: 'all' },
    { query: 'javascript', timestamp: new Date(Date.now() - 86400000), type: 'post' },
    { query: 'react hooks', timestamp: new Date(Date.now() - 3600000 * 5), type: 'post' },
    { query: 'node.js', timestamp: new Date(Date.now() - 1800000), type: 'subreddit' },
  ];

  res.status(200).json({
    success: true,
    data: history,
  });
});

/**
 * @desc    Arama geçmişini temizle
 * @route   DELETE /api/search/history
 * @access  Private
 */
const clearSearchHistory = asyncHandler(async (req, res, next) => {
  // Eğer kullanıcı oturum açmamışsa
  if (!req.user) {
    return next(new ErrorResponse('Bu işlem için oturum açmanız gerekiyor', 401));
  }

  // Gerçek bir uygulamada, kullanıcının arama geçmişini temizler
  // Örnek: await UserSearchHistory.deleteMany({ user: req.user._id });

  res.status(200).json({
    success: true,
    message: 'Arama geçmişiniz başarıyla temizlendi',
  });
});

/**
 * @desc    Gelişmiş arama için kullanılabilecek filtreleri getir
 * @route   GET /api/search/filters
 * @access  Public
 */
const getSearchFilters = asyncHandler(async (req, res, next) => {
  // Filtreleme seçeneklerini getir
  const [postTypes, flairsList, popularSubreddits] = await Promise.all([
    // Post tipleri
    [
      { value: 'text', label: 'Metin' },
      { value: 'link', label: 'Bağlantı' },
      { value: 'image', label: 'Resim' },
      { value: 'video', label: 'Video' },
      { value: 'poll', label: 'Anket' },
    ],

    // En popüler flairler
    Tag.find({})
      .sort({ usageCount: -1 })
      .limit(20)
      .select('name color description scope subreddit')
      .populate('subreddit', 'name'),

    // En popüler subredditler
    Subreddit.find({}).sort({ memberCount: -1 }).limit(20).select('name title icon'),
  ]);

  // Sıralama seçenekleri
  const sortOptions = [
    { value: 'relevance', label: 'Alaka Düzeyi' },
    { value: 'new', label: 'En Yeni' },
    { value: 'old', label: 'En Eski' },
    { value: 'top', label: 'En Çok Oy Alan' },
    { value: 'bottom', label: 'En Az Oy Alan' },
    { value: 'comments', label: 'En Çok Yorum Alan' },
  ];

  // Zaman filtresi seçenekleri
  const timeOptions = [
    { value: 'hour', label: 'Son 1 saat' },
    { value: 'day', label: 'Son 24 saat' },
    { value: 'week', label: 'Son 1 hafta' },
    { value: 'month', label: 'Son 1 ay' },
    { value: 'year', label: 'Son 1 yıl' },
    { value: 'all', label: 'Tüm zamanlar' },
  ];

  res.status(200).json({
    success: true,
    data: {
      postTypes,
      flairs: flairsList,
      subreddits: popularSubreddits,
      sortOptions,
      timeOptions,
    },
  });
});

/**
 * @desc    Belirli bir kullanıcının gönderilerini ve yorumlarını ara
 * @route   GET /api/users/:username/search
 * @access  Public
 */
const searchUserContent = asyncHandler(async (req, res, next) => {
  const { username } = req.params;
  const { query, type, sort, time } = req.query;

  // Kullanıcıyı bul
  const user = await User.findOne({ username });

  if (!user) {
    return next(new ErrorResponse('Kullanıcı bulunamadı', 404));
  }

  // Arama tipi (post, comment veya all)
  const contentType = ['post', 'comment'].includes(type) ? type : 'all';

  // Arama sorgusu
  const searchQuery = query && query.trim().length >= 3 ? query : '';

  // Sayfalama için
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;

  // Zaman filtresi
  const timeFilter = {};
  if (time) {
    const now = new Date();
    switch (time) {
      case 'hour':
        timeFilter.createdAt = { $gte: new Date(now.setHours(now.getHours() - 1)) };
        break;
      case 'day':
        timeFilter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 1)) };
        break;
      case 'week':
        timeFilter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 7)) };
        break;
      case 'month':
        timeFilter.createdAt = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
        break;
      case 'year':
        timeFilter.createdAt = { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) };
        break;
    }
  }

  // Sıralama seçenekleri
  const sortOptions = {
    relevance: searchQuery ? { score: { $meta: 'textScore' } } : { createdAt: -1 },
    new: { createdAt: -1 },
    old: { createdAt: 1 },
    top: { voteScore: -1 },
    comments: { commentCount: -1 },
  };

  const sortBy = sortOptions[sort] || sortOptions.new;

  // Sonuçlar
  const results = {};
  let total = 0;

  // Postları ara
  if (contentType === 'all' || contentType === 'post') {
    const postQuery = {
      author: user._id,
      isDeleted: false,
      ...timeFilter,
    };

    if (searchQuery) {
      postQuery.$text = { $search: searchQuery };
    }

    const projection = searchQuery ? { score: { $meta: 'textScore' } } : {};

    const posts = await Post.find(postQuery, projection)
      .select(
        'title content type subreddit createdAt upvotes downvotes voteScore commentCount isNSFW',
      )
      .sort(sortBy)
      .skip(contentType === 'post' ? startIndex : 0)
      .limit(contentType === 'post' ? limit : 5)
      .populate('subreddit', 'name title');

    results.posts = posts;

    if (contentType === 'post') {
      total = await Post.countDocuments(postQuery);
    }
  }

  // Yorumları ara
  if (contentType === 'all' || contentType === 'comment') {
    const commentQuery = {
      author: user._id,
      isDeleted: false,
      ...timeFilter,
    };

    if (searchQuery) {
      commentQuery.$text = { $search: searchQuery };
    }

    const projection = searchQuery ? { score: { $meta: 'textScore' } } : {};

    const comments = await Comment.find(commentQuery, projection)
      .select('content post createdAt upvotes downvotes voteScore')
      .sort(sortBy)
      .skip(contentType === 'comment' ? startIndex : 0)
      .limit(contentType === 'comment' ? limit : 5)
      .populate({
        path: 'post',
        select: 'title subreddit',
        populate: {
          path: 'subreddit',
          select: 'name title',
        },
      });

    results.comments = comments;

    if (contentType === 'comment') {
      total = await Comment.countDocuments(commentQuery);
    }
  }

  // Toplam sayı (all için)
  if (contentType === 'all') {
    const postCount = await Post.countDocuments({
      author: user._id,
      isDeleted: false,
      ...timeFilter,
      ...(searchQuery && { $text: { $search: searchQuery } }),
    });

    const commentCount = await Comment.countDocuments({
      author: user._id,
      isDeleted: false,
      ...timeFilter,
      ...(searchQuery && { $text: { $search: searchQuery } }),
    });

    total = postCount + commentCount;
  }

  // Sayfalama bilgisi
  const pagination = {
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalResults: total,
  };

  if (startIndex + limit < total) {
    pagination.nextPage = page + 1;
  }

  if (startIndex > 0) {
    pagination.prevPage = page - 1;
  }

  res.status(200).json({
    success: true,
    data: contentType === 'all' ? results : results[`${contentType}s`],
    pagination,
    query: searchQuery,
    user: {
      username: user.username,
      profilePicture: user.profilePicture,
    },
  });
});

module.exports = {
  searchAll,
  searchPosts,
  searchComments,
  searchSubreddits,
  searchUsers,
  searchTags,
  autocomplete,
  searchInSubreddit,
  advancedSearch,
  getTrendingSearches,
  getSearchHistory,
  clearSearchHistory,
  getSearchFilters,
  searchUserContent,
};
