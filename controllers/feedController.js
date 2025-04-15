const { Post, Subreddit, SubredditMembership, User, Vote } = require('../models');

/**
 * Kullanıcının ana beslemesini getir
 * @route GET /api/feed
 * @access Private
 */
const getUserFeed = async (req, res) => {
  try {
    const userId = req.user?._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { sort = 'hot' } = req.query;

    // Kullanıcı giriş yapmışsa üye olduğu subreddit'leri getir
    let userSubreddits = [];

    if (userId) {
      const memberships = await SubredditMembership.find({
        user: userId,
        status: { $in: ['member', 'moderator', 'admin'] },
      }).select('subreddit');

      userSubreddits = memberships.map((m) => m.subreddit);
    }

    // Eğer kullanıcı hiçbir subreddite üye değilse veya giriş yapmamışsa
    // popüler subredditlerden gönderi göster
    const filter = {
      isDeleted: false,
      isRemoved: false,
    };

    if (userSubreddits.length > 0) {
      filter.subreddit = { $in: userSubreddits };
    }

    let sortOption = {};

    // Sıralama seçenekleri
    switch (sort) {
      case 'new':
        sortOption = { createdAt: -1 };
        break;
      case 'top':
        sortOption = { voteScore: -1, createdAt: -1 };
        break;
      case 'controversial':
        sortOption = { controversyScore: -1, createdAt: -1 };
        break;
      case 'hot':
      default:
        sortOption = { hotScore: -1, createdAt: -1 };
        break;
    }

    // Gönderileri getir
    const posts = await Post.find(filter)
      .skip(skip)
      .limit(limit)
      .sort(sortOption)
      .populate('author', 'username profilePicture')
      .populate('subreddit', 'name icon description')
      .lean();

    const totalPosts = await Post.countDocuments(filter);

    // Kullanıcı giriş yapmışsa oy bilgilerini ekle
    let postsWithUserVote = posts;

    if (userId) {
      // Kullanıcının bu gönderilere verdiği oyları getir
      const postIds = posts.map((post) => post._id);
      const userVotes = await Vote.find({
        user: userId,
        post: { $in: postIds },
      }).select('post voteType');

      // Oy bilgilerini gönderilere ekle
      const voteMap = {};
      userVotes.forEach((vote) => {
        voteMap[vote.post.toString()] = vote.voteType;
      });

      postsWithUserVote = posts.map((post) => ({
        ...post,
        userVote: voteMap[post._id.toString()] || null,
      }));
    }

    res.status(200).json({
      success: true,
      count: postsWithUserVote.length,
      total: totalPosts,
      totalPages: Math.ceil(totalPosts / limit),
      currentPage: page,
      data: postsWithUserVote,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Ana besleme getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Popüler beslemeleri getir (tüm kullanıcılar için)
 * @route GET /api/feed/popular
 * @access Public
 */
const getPopularFeed = async (req, res) => {
  try {
    const userId = req.user?._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { timeRange = '24h' } = req.query;

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
      case 'all':
        startDate = new Date(0); // Tüm zamanlar
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Belirli zamandaki en popüler gönderiler
    const filter = {
      isDeleted: false,
      isRemoved: false,
      createdAt: { $gte: startDate },
    };

    // Gönderileri getir (vote score'a göre sıralı)
    const posts = await Post.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ voteScore: -1, commentCount: -1, createdAt: -1 })
      .populate('author', 'username profilePicture')
      .populate('subreddit', 'name icon description')
      .lean();

    const totalPosts = await Post.countDocuments(filter);

    // Kullanıcı giriş yapmışsa oy bilgilerini ekle
    let postsWithUserVote = posts;

    if (userId) {
      // Kullanıcının bu gönderilere verdiği oyları getir
      const postIds = posts.map((post) => post._id);
      const userVotes = await Vote.find({
        user: userId,
        post: { $in: postIds },
      }).select('post voteType');

      // Oy bilgilerini gönderilere ekle
      const voteMap = {};
      userVotes.forEach((vote) => {
        voteMap[vote.post.toString()] = vote.voteType;
      });

      postsWithUserVote = posts.map((post) => ({
        ...post,
        userVote: voteMap[post._id.toString()] || null,
      }));
    }

    res.status(200).json({
      success: true,
      count: postsWithUserVote.length,
      total: totalPosts,
      totalPages: Math.ceil(totalPosts / limit),
      currentPage: page,
      data: postsWithUserVote,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Popüler besleme getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Tüm içerikler beslemesini getir
 * @route GET /api/feed/all
 * @access Public
 */
const getAllFeed = async (req, res) => {
  try {
    const userId = req.user?._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { sort = 'new' } = req.query;

    // Filtreyi oluştur
    const filter = {
      isDeleted: false,
      isRemoved: false,
    };

    let sortOption = {};

    // Sıralama seçenekleri
    switch (sort) {
      case 'hot':
        sortOption = { hotScore: -1, createdAt: -1 };
        break;
      case 'top':
        sortOption = { voteScore: -1, createdAt: -1 };
        break;
      case 'controversial':
        sortOption = { controversyScore: -1, createdAt: -1 };
        break;
      case 'new':
      default:
        sortOption = { createdAt: -1 };
        break;
    }

    // Tüm gönderileri getir
    const posts = await Post.find(filter)
      .skip(skip)
      .limit(limit)
      .sort(sortOption)
      .populate('author', 'username profilePicture')
      .populate('subreddit', 'name icon description')
      .lean();

    const totalPosts = await Post.countDocuments(filter);

    // Kullanıcı giriş yapmışsa oy bilgilerini ekle
    let postsWithUserVote = posts;

    if (userId) {
      const postIds = posts.map((post) => post._id);
      const userVotes = await Vote.find({
        user: userId,
        post: { $in: postIds },
      }).select('post voteType');

      const voteMap = {};
      userVotes.forEach((vote) => {
        voteMap[vote.post.toString()] = vote.voteType;
      });

      postsWithUserVote = posts.map((post) => ({
        ...post,
        userVote: voteMap[post._id.toString()] || null,
      }));
    }

    res.status(200).json({
      success: true,
      count: postsWithUserVote.length,
      total: totalPosts,
      totalPages: Math.ceil(totalPosts / limit),
      currentPage: page,
      data: postsWithUserVote,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Tüm içerikler beslemesi getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Belirli bir subreddit'in beslemesini getir
 * @route GET /api/feed/subreddit/:subredditName
 * @access Public
 */
const getSubredditFeed = async (req, res) => {
  try {
    const { subredditName } = req.params;
    const userId = req.user?._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { sort = 'hot' } = req.query;

    // Subreddit'i bul
    const subreddit = await Subreddit.findOne({ name: subredditName });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Kullanıcının bu subreddit'e üye olup olmadığını kontrol et
    let userMembership = null;
    if (userId) {
      userMembership = await SubredditMembership.findOne({
        user: userId,
        subreddit: subreddit._id,
      });
    }

    // Filtreyi oluştur
    const filter = {
      subreddit: subreddit._id,
      isDeleted: false,
      isRemoved: false,
    };

    let sortOption = {};

    // Sıralama seçenekleri
    switch (sort) {
      case 'new':
        sortOption = { createdAt: -1 };
        break;
      case 'top':
        sortOption = { voteScore: -1, createdAt: -1 };
        break;
      case 'controversial':
        sortOption = { controversyScore: -1, createdAt: -1 };
        break;
      case 'hot':
      default:
        sortOption = { hotScore: -1, createdAt: -1 };
        break;
    }

    // Gönderileri getir
    const posts = await Post.find(filter)
      .skip(skip)
      .limit(limit)
      .sort(sortOption)
      .populate('author', 'username profilePicture')
      .populate('subreddit', 'name icon description')
      .lean();

    const totalPosts = await Post.countDocuments(filter);

    // Kullanıcı giriş yapmışsa oy bilgilerini ekle
    let postsWithUserVote = posts;

    if (userId) {
      const postIds = posts.map((post) => post._id);
      const userVotes = await Vote.find({
        user: userId,
        post: { $in: postIds },
      }).select('post voteType');

      const voteMap = {};
      userVotes.forEach((vote) => {
        voteMap[vote.post.toString()] = vote.voteType;
      });

      postsWithUserVote = posts.map((post) => ({
        ...post,
        userVote: voteMap[post._id.toString()] || null,
      }));
    }

    res.status(200).json({
      success: true,
      count: postsWithUserVote.length,
      total: totalPosts,
      totalPages: Math.ceil(totalPosts / limit),
      currentPage: page,
      subreddit: {
        ...subreddit.toObject(),
        userMembership: userMembership ? userMembership.status : null,
      },
      data: postsWithUserVote,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Subreddit beslemesi getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Kullanıcının oluşturduğu içerikler beslemesini getir
 * @route GET /api/feed/user/:username
 * @access Public
 */
const getUserContentFeed = async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user?._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { sort = 'new', contentType = 'all' } = req.query;

    // Kullanıcıyı bul
    const profileUser = await User.findOne({ username });

    if (!profileUser) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı',
      });
    }

    let result = [];
    let total = 0;

    // Sıralama seçenekleri
    let sortOption = {};
    switch (sort) {
      case 'top':
        sortOption = { voteScore: -1, createdAt: -1 };
        break;
      case 'hot':
        sortOption = { hotScore: -1, createdAt: -1 };
        break;
      case 'controversial':
        sortOption = { controversyScore: -1, createdAt: -1 };
        break;
      case 'new':
      default:
        sortOption = { createdAt: -1 };
        break;
    }

    // İçerik türüne göre filtreleme
    if (contentType === 'posts' || contentType === 'all') {
      // Kullanıcının gönderilerini getir
      const posts = await Post.find({
        author: profileUser._id,
        isDeleted: false,
      })
        .skip(contentType === 'all' ? 0 : skip)
        .limit(contentType === 'all' ? 10 : limit)
        .sort(sortOption)
        .populate('author', 'username profilePicture')
        .populate('subreddit', 'name icon description')
        .lean();

      // Kullanıcı giriş yapmışsa oy bilgilerini ekle
      if (currentUserId) {
        const postIds = posts.map((post) => post._id);
        const userVotes = await Vote.find({
          user: currentUserId,
          post: { $in: postIds },
        }).select('post voteType');

        const voteMap = {};
        userVotes.forEach((vote) => {
          voteMap[vote.post.toString()] = vote.voteType;
        });

        posts.forEach((post) => {
          post.userVote = voteMap[post._id.toString()] || null;
          post.contentType = 'post';
        });
      } else {
        posts.forEach((post) => {
          post.contentType = 'post';
        });
      }

      if (contentType === 'posts') {
        result = posts;
        total = await Post.countDocuments({
          author: profileUser._id,
          isDeleted: false,
        });
      } else {
        result = result.concat(posts);
      }
    }

    if (contentType === 'comments' || contentType === 'all') {
      // Kullanıcının yorumlarını getir
      const comments = await Comment.find({
        author: profileUser._id,
        isDeleted: false,
      })
        .skip(contentType === 'all' ? 0 : skip)
        .limit(contentType === 'all' ? 10 : limit)
        .sort(sortOption)
        .populate('author', 'username profilePicture')
        .populate({
          path: 'post',
          select: 'title subreddit',
          populate: {
            path: 'subreddit',
            select: 'name icon',
          },
        })
        .lean();

      // Kullanıcı giriş yapmışsa oy bilgilerini ekle
      if (currentUserId) {
        const commentIds = comments.map((comment) => comment._id);
        const userVotes = await Vote.find({
          user: currentUserId,
          comment: { $in: commentIds },
        }).select('comment voteType');

        const voteMap = {};
        userVotes.forEach((vote) => {
          voteMap[vote.comment.toString()] = vote.voteType;
        });

        comments.forEach((comment) => {
          comment.userVote = voteMap[comment._id.toString()] || null;
          comment.contentType = 'comment';
        });
      } else {
        comments.forEach((comment) => {
          comment.contentType = 'comment';
        });
      }

      if (contentType === 'comments') {
        result = comments;
        total = await Comment.countDocuments({
          author: profileUser._id,
          isDeleted: false,
        });
      } else {
        result = result.concat(comments);
      }
    }

    // Tarih sıralaması
    if (contentType === 'all') {
      result.sort((a, b) => {
        if (sort === 'new' || sort === 'hot') {
          return new Date(b.createdAt) - new Date(a.createdAt);
        } else if (sort === 'top') {
          return b.voteScore - a.voteScore;
        } else {
          return b.controversyScore - a.controversyScore;
        }
      });

      // Pagination for combined results
      result = result.slice(skip, skip + limit);
      total =
        (await Post.countDocuments({
          author: profileUser._id,
          isDeleted: false,
        })) +
        (await Comment.countDocuments({
          author: profileUser._id,
          isDeleted: false,
        }));
    }

    res.status(200).json({
      success: true,
      count: result.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      user: {
        username: profileUser.username,
        profilePicture: profileUser.profilePicture,
        bio: profileUser.bio,
        createdAt: profileUser.createdAt,
      },
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Kullanıcı içerikleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getUserFeed,
  getPopularFeed,
  getAllFeed,
  getSubredditFeed,
  getUserContentFeed,
};
