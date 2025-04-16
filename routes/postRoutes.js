const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const { isAuthenticated } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissionMiddleware');

// Rate limiting
const { rateLimit } = require('../middleware/auth');
const postCreateLimit = rateLimit('/api/posts', 10, 10 * 60 * 1000); // 10 dakikada 10 gönderi
const postActionLimit = rateLimit('/api/posts/actions', 30, 60 * 1000); // Dakikada 30 aksiyon

/**
 * @route   GET /api/posts
 * @desc    Tüm gönderileri listele (filtreleme ve sıralama ile)
 * @access  Public
 */
router.get('/', postController.getPosts);

/**
 * @route   POST /api/posts
 * @desc    Yeni bir gönderi oluştur
 * @access  Private
 */
router.post(
  '/',
  isAuthenticated,
  checkPermission('post:create'),
  postCreateLimit,
  postController.createPost,
);

/**
 * @route   GET /api/posts/search
 * @desc    Gönderilerde arama yap
 * @access  Public
 */
router.get('/search', postController.searchPosts);

/**
 * @route   GET /api/posts/saved
 * @desc    Kullanıcının kaydettiği gönderileri listele
 * @access  Private
 */
router.get('/saved', isAuthenticated, postController.getSavedPosts);

/**
 * @route   GET /api/posts/:id
 * @desc    Bir gönderiyi ID'ye göre getir
 * @access  Public
 */
router.get('/:id', postController.getPostById);

/**
 * @route   PUT /api/posts/:id
 * @desc    Gönderiyi güncelle
 * @access  Private
 */
router.put(
  '/:id',
  isAuthenticated,
  checkPermission(['post:update_own', 'post:update_any']),
  postController.updatePost,
);

/**
 * @route   DELETE /api/posts/:id
 * @desc    Gönderiyi sil (soft delete)
 * @access  Private
 */
router.delete(
  '/:id',
  isAuthenticated,
  checkPermission(['post:delete_own', 'post:delete_any']),
  postController.deletePost,
);

/**
 * @route   POST /api/posts/:id/vote
 * @desc    Gönderiye oy ver (upvote/downvote)
 * @access  Private
 */
router.post(
  '/:id/vote',
  isAuthenticated,
  checkPermission('post:vote'),
  postActionLimit,
  postController.votePost,
);

/**
 * @route   POST /api/posts/:id/save
 * @desc    Gönderiyi kaydet/kaydetme işlemini kaldır
 * @access  Private
 */
router.post('/:id/save', isAuthenticated, postActionLimit, postController.toggleSavePost);

/**
 * @route   PUT /api/posts/:id/pin
 * @desc    Gönderiyi sabitle/sabitlemesini kaldır
 * @access  Private (Moderatör/Admin)
 */
router.put(
  '/:id/pin',
  isAuthenticated,
  checkPermission('moderation:config'),
  postController.togglePinPost,
);

/**
 * @route   PUT /api/posts/:id/lock
 * @desc    Gönderiyi kilitle/kilidini aç
 * @access  Private (Moderatör/Admin)
 */
router.put(
  '/:id/lock',
  isAuthenticated,
  checkPermission('moderation:lock'),
  postController.toggleLockPost,
);

/**
 * @route   PUT /api/posts/:id/nsfw
 * @desc    Gönderiyi NSFW olarak işaretle/işareti kaldır
 * @access  Private (Yazar/Moderatör/Admin)
 */
router.put(
  '/:id/nsfw',
  isAuthenticated,
  checkPermission(['post:update_own', 'moderation:config']),
  postController.toggleNSFWPost,
);

/**
 * @route   PUT /api/posts/:id/spoiler
 * @desc    Gönderiyi spoiler olarak işaretle/işareti kaldır
 * @access  Private (Yazar/Moderatör/Admin)
 */
router.put(
  '/:id/spoiler',
  isAuthenticated,
  checkPermission(['post:update_own', 'moderation:config']),
  postController.toggleSpoilerPost,
);

/**
 * @route   PUT /api/posts/:id/archive
 * @desc    Gönderiyi arşivle/arşivden çıkar
 * @access  Private (Moderatör/Admin)
 */
router.put(
  '/:id/archive',
  isAuthenticated,
  checkPermission('moderation:config'),
  postController.toggleArchivePost,
);

/**
 * @route   GET /api/posts/:id/analytics
 * @desc    Gönderi istatistiklerini getir
 * @access  Private (Yazar/Moderatör/Admin)
 */
router.get(
  '/:id/analytics',
  isAuthenticated,
  checkPermission(['post:analytics', 'moderation:view_logs']),
  postController.getPostAnalytics,
);

// Subreddit veya kullanıcı spesifik post rotaları, ilgili dosyalarda tanımlanmalı
// Örneğin: /api/subreddits/:subredditId/posts bu dosyanın kapsamında değil

module.exports = router;
