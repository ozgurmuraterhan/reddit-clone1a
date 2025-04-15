const { Post, Comment, Subreddit, User, Tag } = require('../models');
const mongoose = require('mongoose');

/**
 * @desc    Perform a comprehensive search across the platform
 * @route   GET /api/search
 * @access  Public
 */
const search = async (req, res) => {
  try {
    const {
      q, // Search query text
      type = 'posts', // Content type: posts, comments, subreddits, users, all
      sort = 'relevance', // Sort options: relevance, new, top, comments
      timeRange, // Time filter: hour, day, week, month, year, all
      subreddit, // Optional subreddit to search within
      nsfw = 'false', // Include NSFW content: true, false
      page = 1, // Pagination page
      limit = 25, // Results per page
    } = req.query;

    // Validate required search query
    if (!q || q.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Arama sorgusu gereklidir',
      });
    }

    const searchQuery = q.trim();
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const includeNsfw = nsfw === 'true';

    // Time filter configuration
    let dateFilter = {};
    if (timeRange) {
      const now = new Date();
      let startDate;

      switch (timeRange) {
        case 'hour':
          startDate = new Date(now.getTime() - 60 * 60 * 1000);
          break;
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
          startDate = null;
      }

      if (startDate) {
        dateFilter = { createdAt: { $gte: startDate } };
      }
    }

    // Sort configuration
    let sortOptions = {};
    switch (sort) {
      case 'new':
        sortOptions = { createdAt: -1 };
        break;
      case 'old':
        sortOptions = { createdAt: 1 };
        break;
      case 'top':
        sortOptions = { voteScore: -1, commentCount: -1, createdAt: -1 };
        break;
      case 'comments':
        sortOptions = { commentCount: -1, createdAt: -1 };
        break;
      case 'relevance':
      default:
        // For text search, MongoDB will sort by text score by default
        sortOptions = { score: { $meta: 'textScore' }, createdAt: -1 };
        break;
    }

    // Subreddit filter setup
    let subredditFilter = {};
    if (subreddit) {
      const foundSubreddit = await Subreddit.findOne({ name: subreddit.toLowerCase() });
      if (foundSubreddit) {
        subredditFilter = { subreddit: foundSubreddit._id };
      } else {
        // If specified subreddit doesn't exist, return empty results
        return res.status(200).json({
          success: true,
          count: 0,
          total: 0,
          totalPages: 0,
          currentPage: pageNum,
          data: [],
        });
      }
    }

    // NSFW filter
    const nsfwFilter = includeNsfw ? {} : { nsfw: false };

    let results;
    let totalResults;
    let searchProjection;

    // Perform search based on content type
    if (type === 'posts' || type === 'all') {
      // Post search
      const postSearchFilter = {
        $text: { $search: searchQuery },
        isDeleted: false,
        isRemoved: false,
        ...dateFilter,
        ...subredditFilter,
        ...nsfwFilter,
      };

      searchProjection = {
        score: { $meta: 'textScore' },
        title: 1,
        content: 1,
        author: 1,
        subreddit: 1,
        createdAt: 1,
        voteScore: 1,
        commentCount: 1,
        contentType: 1,
        nsfw: 1,
        tags: 1,
      };

      results = await Post.find(postSearchFilter, searchProjection)
        .skip(type === 'all' ? 0 : skip)
        .limit(type === 'all' ? Math.min(limitNum, 10) : limitNum)
        .sort(sortOptions)
        .populate('author', 'username profilePicture displayName')
        .populate('subreddit', 'name description icon color')
        .populate('tags', 'name color');

      // Add content type identifier
      results = results.map((post) => {
        const postObj = post.toObject();
        postObj.contentType = 'post';
        return postObj;
      });

      totalResults = await Post.countDocuments(postSearchFilter);

      if (type === 'all') {
        // For 'all' type search, we'll be combining results, so store posts for now
        allResults = [...results];
      }
    }

    if (type === 'comments' || type === 'all') {
      // Comment search
      const commentSearchFilter = {
        $text: { $search: searchQuery },
        isDeleted: false,
        isRemoved: false,
        ...dateFilter,
      };

      // If filtering by subreddit, find posts in that subreddit first
      if (Object.keys(subredditFilter).length > 0) {
        const relatedPosts = await Post.find(subredditFilter).select('_id');
        commentSearchFilter.post = { $in: relatedPosts.map((p) => p._id) };
      }

      searchProjection = {
        score: { $meta: 'textScore' },
        content: 1,
        author: 1,
        post: 1,
        createdAt: 1,
        voteScore: 1,
      };

      const comments = await Comment.find(commentSearchFilter, searchProjection)
        .skip(type === 'all' ? 0 : skip)
        .limit(type === 'all' ? Math.min(limitNum, 10) : limitNum)
        .sort(sortOptions)
        .populate('author', 'username profilePicture displayName')
        .populate({
          path: 'post',
          select: 'title subreddit',
          populate: {
            path: 'subreddit',
            select: 'name icon color',
          },
        });

      // Add content type identifier
      const commentResults = comments.map((comment) => {
        const commentObj = comment.toObject();
        commentObj.contentType = 'comment';
        return commentObj;
      });

      if (type === 'comments') {
        results = commentResults;
        totalResults = await Comment.countDocuments(commentSearchFilter);
      } else if (type === 'all') {
        allResults = [...allResults, ...commentResults];
      }
    }

    if (type === 'subreddits' || type === 'all') {
      // Subreddit search
      const subredditSearchFilter = {
        $text: { $search: searchQuery },
        status: 'active',
        isDeleted: false,
        ...dateFilter,
        ...nsfwFilter,
      };

      searchProjection = {
        score: { $meta: 'textScore' },
        name: 1,
        title: 1,
        description: 1,
        icon: 1,
        banner: 1,
        color: 1,
        subscriberCount: 1,
        createdAt: 1,
        nsfw: 1,
      };

      const subreddits = await Subreddit.find(subredditSearchFilter, searchProjection)
        .skip(type === 'all' ? 0 : skip)
        .limit(type === 'all' ? Math.min(limitNum, 5) : limitNum)
        .sort(sortOptions);

      // Add content type identifier
      const subredditResults = subreddits.map((sub) => {
        const subObj = sub.toObject();
        subObj.contentType = 'subreddit';
        return subObj;
      });

      if (type === 'subreddits') {
        results = subredditResults;
        totalResults = await Subreddit.countDocuments(subredditSearchFilter);
      } else if (type === 'all') {
        allResults = [...allResults, ...subredditResults];
      }
    }

    if (type === 'users' || type === 'all') {
      // User search
      const userSearchFilter = {
        $text: { $search: searchQuery },
        isDeleted: false,
        accountStatus: 'active',
        ...dateFilter,
      };

      searchProjection = {
        score: { $meta: 'textScore' },
        username: 1,
        displayName: 1,
        bio: 1,
        profilePicture: 1,
        totalKarma: 1,
        createdAt: 1,
      };

      const users = await User.find(userSearchFilter, searchProjection)
        .skip(type === 'all' ? 0 : skip)
        .limit(type === 'all' ? Math.min(limitNum, 5) : limitNum)
        .sort(sortOptions);

      // Add content type identifier
      const userResults = users.map((user) => {
        const userObj = user.toObject();
        userObj.contentType = 'user';
        return userObj;
      });

      if (type === 'users') {
        results = userResults;
        totalResults = await User.countDocuments(userSearchFilter);
      } else if (type === 'all') {
        allResults = [...allResults, ...userResults];
      }
    }

    // For 'all' type, combine and sort results based on text score
    if (type === 'all') {
      // Sort by relevance (MongoDB text score) and take top results
      allResults.sort((a, b) => b.score - a.score);

      // Apply pagination to combined results
      totalResults = allResults.length;
      results = allResults.slice(skip, skip + limitNum);
    }

    // Return the search results
    return res.status(200).json({
      success: true,
      query: searchQuery,
      count: results.length,
      total: totalResults,
      totalPages: Math.ceil(totalResults / limitNum),
      currentPage: pageNum,
      data: results,
    });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({
      success: false,
      message: 'Arama gerçekleştirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Search within a specific subreddit
 * @route   GET /api/subreddits/:subredditName/search
 * @access  Public
 */
const searchInSubreddit = async (req, res) => {
  try {
    const { subredditName } = req.params;

    // Validate subreddit exists
    const subreddit = await Subreddit.findOne({
      name: subredditName.toLowerCase(),
      status: 'active',
      isDeleted: false,
    });

    if (!subreddit) {
      return res.status(404).json({
        success: false,
        message: 'Subreddit bulunamadı',
      });
    }

    // Add subreddit to query and call main search function
    req.query.subreddit = subredditName;

    // Default to searching posts if type not specified
    if (!req.query.type) {
      req.query.type = 'posts';
    }

    await search(req, res);
  } catch (error) {
    console.error('Subreddit search error:', error);
    return res.status(500).json({
      success: false,
      message: 'Subreddit içinde arama gerçekleştirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Get search suggestions as user types
 * @route   GET /api/search/suggest
 * @access  Public
 */
const getSearchSuggestions = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim() === '') {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const searchQuery = q.trim();
    const limitNum = parseInt(limit, 10);

    // Search for subreddits
    const subreddits = await Subreddit.find({
      $or: [
        { name: { $regex: `^${searchQuery}`, $options: 'i' } },
        { title: { $regex: searchQuery, $options: 'i' } },
      ],
      status: 'active',
      isDeleted: false,
    })
      .select('name title icon subscriberCount')
      .sort({ subscriberCount: -1 })
      .limit(Math.ceil(limitNum / 2));

    // Search for users
    const users = await User.find({
      $or: [
        { username: { $regex: `^${searchQuery}`, $options: 'i' } },
        { displayName: { $regex: searchQuery, $options: 'i' } },
      ],
      isDeleted: false,
      accountStatus: 'active',
    })
      .select('username displayName profilePicture')
      .sort({ totalKarma: -1 })
      .limit(Math.floor(limitNum / 2));

    // Format the suggestions
    const subredditSuggestions = subreddits.map((sub) => ({
      type: 'subreddit',
      id: sub._id,
      name: sub.name,
      title: sub.title || sub.name,
      icon: sub.icon,
      subscriberCount: sub.subscriberCount,
    }));

    const userSuggestions = users.map((user) => ({
      type: 'user',
      id: user._id,
      username: user.username,
      displayName: user.displayName || user.username,
      profilePicture: user.profilePicture,
    }));

    // Combine and return suggestions
    const suggestions = [...subredditSuggestions, ...userSuggestions];

    return res.status(200).json({
      success: true,
      query: searchQuery,
      count: suggestions.length,
      data: suggestions,
    });
  } catch (error) {
    console.error('Search suggestions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Arama önerileri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Get trending search terms
 * @route   GET /api/search/trending
 * @access  Public
 */
const getTrendingSearches = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit, 10);

    // Get trending searches from analytics or cache
    // This would typically be implemented with a separate service/collection that tracks popular searches
    // For now, we'll simulate with popular tags or recent posts

    const trendingPosts = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          isDeleted: false,
        },
      },
      { $sort: { voteScore: -1, commentCount: -1 } },
      { $limit: limitNum },
      { $project: { title: 1, voteScore: 1, commentCount: 1 } },
    ]);

    const trendingTerms = trendingPosts.map((post) => {
      // Extract likely search terms from post titles
      const words = post.title.split(/\s+/).filter((word) => word.length > 3);
      return {
        term: words[0] || post.title.substring(0, 15),
        score: post.voteScore + post.commentCount,
      };
    });

    return res.status(200).json({
      success: true,
      count: trendingTerms.length,
      data: trendingTerms,
    });
  } catch (error) {
    console.error('Trending searches error:', error);
    return res.status(500).json({
      success: false,
      message: 'Trend aramalar getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Search posts by tags
 * @route   GET /api/search/tags
 * @access  Public
 */
const searchByTags = async (req, res) => {
  try {
    const { tags, sort = 'new', page = 1, limit = 25 } = req.query;

    if (!tags) {
      return res.status(400).json({
        success: false,
        message: 'En az bir etiket belirtilmelidir',
      });
    }

    const tagList = Array.isArray(tags) ? tags : tags.split(',');
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    // Find tag IDs first
    const tagDocs = await Tag.find({ name: { $in: tagList } }).select('_id');
    const tagIds = tagDocs.map((tag) => tag._id);

    if (tagIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        total: 0,
        totalPages: 0,
        currentPage: pageNum,
        data: [],
      });
    }

    // Set up sort options
    let sortOptions = {};
    switch (sort) {
      case 'new':
        sortOptions = { createdAt: -1 };
        break;
      case 'top':
        sortOptions = { voteScore: -1, createdAt: -1 };
        break;
      case 'comments':
        sortOptions = { commentCount: -1, createdAt: -1 };
        break;
      default:
        sortOptions = { createdAt: -1 };
    }

    // Find posts with all the specified tags
    const posts = await Post.find({
      tags: { $all: tagIds },
      isDeleted: false,
      isRemoved: false,
    })
      .skip(skip)
      .limit(limitNum)
      .sort(sortOptions)
      .populate('author', 'username profilePicture displayName')
      .populate('subreddit', 'name description icon color')
      .populate('tags', 'name color');

    const totalPosts = await Post.countDocuments({
      tags: { $all: tagIds },
      isDeleted: false,
      isRemoved: false,
    });

    return res.status(200).json({
      success: true,
      count: posts.length,
      total: totalPosts,
      totalPages: Math.ceil(totalPosts / limitNum),
      currentPage: pageNum,
      tags: tagList,
      data: posts,
    });
  } catch (error) {
    console.error('Tag search error:', error);
    return res.status(500).json({
      success: false,
      message: 'Etiketlerle arama gerçekleştirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * @desc    Get search statistics (for admins)
 * @route   GET /api/search/stats
 * @access  Private/Admin
 */
const getSearchStats = async (req, res) => {
  try {
    // Verify admin privileges
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkileri gereklidir',
      });
    }

    const { timeRange = 'week' } = req.query;

    // Determine time filter
    let startDate;
    const now = new Date();

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
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // This would typically use a SearchLog model to track searches
    // For now, we'll return simulated data
    const stats = {
      totalSearches: Math.floor(Math.random() * 10000),
      uniqueUsers: Math.floor(Math.random() * 5000),
      averageDuration: Math.round(Math.random() * 1000) / 1000,
      topSearchTerms: [
        { term: 'reddit', count: Math.floor(Math.random() * 1000) },
        { term: 'news', count: Math.floor(Math.random() * 800) },
        { term: 'games', count: Math.floor(Math.random() * 700) },
        { term: 'help', count: Math.floor(Math.random() * 600) },
        { term: 'javascript', count: Math.floor(Math.random() * 500) },
      ],
      searchesByType: {
        posts: Math.floor(Math.random() * 6000),
        comments: Math.floor(Math.random() * 2000),
        subreddits: Math.floor(Math.random() * 1500),
        users: Math.floor(Math.random() * 500),
        all: Math.floor(Math.random() * 1000),
      },
    };

    return res.status(200).json({
      success: true,
      timeRange,
      data: stats,
    });
  } catch (error) {
    console.error('Search stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Arama istatistikleri getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  search,
  searchInSubreddit,
  getSearchSuggestions,
  getTrendingSearches,
  searchByTags,
  getSearchStats,
};
