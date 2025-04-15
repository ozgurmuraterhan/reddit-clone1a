const express = require('express');
const {
  isAuthenticated,
  hasPermission,
  isModeratorOf,
  isContentOwner,
  rateLimit
} = require('../middleware/auth');
const postController = require('../controllers/postController');

const router = express.Router();

// Rate limiting
const postLimit = rateLimit('/api/posts', 50, 60 * 60 * 1000); // 50 istek/saat

// Tüm gönderileri getir
router.get('/', postController.getPosts);

// Gönderi detayı getir
router.get('/:postId', postController.getPostById);

// Gönderi slug ile getir
router.get('/by-slug/:slug', postController.getPostBySlug);

// Gönderi oluştur
router.post('/',
  isAuthenticated,
  postLimit,
  hasPermission('post:create'),
  postController.createPost
);

// Gönderi güncelle
router.put('/:postId',
  isAuthenticated,
  isContentOwner('Post', 'postId'),
  postController.updatePost
);

// Gönderi sil
router.delete('/:postId',
  isAuthenticated,
  isContentOwner('Post', 'postId'),
  postController.deletePost
);

// Gönderi için yorumları getir
router.get('/:postId/comments', postController.getPostComments);

// Gönderi oyla
router.post('/:postId/vote',
  isAuthenticated,
  postController.votePost
);

// Gönderiyi kaydet
router.post('/:postId/save',
  isAuthenticated,
  postController.savePost
);

// Gönderi kaydını kaldır
router.delete('/:postId/save',
  isAuthenticated,
  postController.unsavePost
);

// Moderatör: Gönderiyi kaldır
router.put('/:postId/remove',
  isAuthenticated,
  isModeratorOf('subreddit', 'postId', 'Post'),
  postController.removePost
);

// Moderatör: Gönderiyi onayla
router.put('/:postId/approve',
  isAuthenticated,
  isModeratorOf('subreddit', 'postId', 'Post'),
  postController.approvePost
);

// Moderatör: Gönderiyi sabitle
router.put('/:postId/pin',
  isAuthenticated,
  isModeratorOf('subreddit', 'postId', 'Post'),
  postController.pinPost
);

// Moderatör: Gönderiyi kilitle
router.put('/:postId/lock',
  isAuthenticated,
  isModeratorOf('subreddit', 'postId', 'Post'),
  postController.lockPost
);

module.exports = router;
