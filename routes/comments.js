const express = require('express');
const {
  isAuthenticated,
  hasPermission,
  isModeratorOf,
  isContentOwner,
  rateLimit
} = require('../middleware/auth');
const commentController = require('../controllers/commentController');

const router = express.Router();

// Rate limiting
const commentLimit = rateLimit('/api/comments', 60, 60 * 60 * 1000); // 60 istek/saat

// Yorum getir
router.get('/:commentId', commentController.getCommentById);

// Yorum oluştur
router.post('/',
  isAuthenticated,
  commentLimit,
  hasPermission('comment:create'),
  commentController.createComment
);

// Yorum güncelle
router.put('/:commentId',
  isAuthenticated,
  isContentOwner('Comment', 'commentId'),
  commentController.updateComment
);

// Yorum sil
router.delete('/:commentId',
  isAuthenticated,
  isContentOwner('Comment', 'commentId'),
  commentController.deleteComment
);

// Yoruma yanıt ver
router.post('/:commentId/replies',
  isAuthenticated,
  commentLimit,
  hasPermission('comment:create'),
  commentController.replyToComment
);

// Yorum yanıtlarını getir
router.get('/:commentId/replies', commentController.getCommentReplies);

// Yorum oyla
router.post('/:commentId/vote',
  isAuthenticated,
  commentController.voteComment
);

// Yorumu kaydet
router.post('/:commentId/save',
  isAuthenticated,
  commentController.saveComment
);

// Yorum kaydını kaldır
router.delete('/:commentId/save',
  isAuthenticated,
  commentController.unsaveComment
);

// Moderatör: Yorumu kaldır
router.put('/:commentId/remove',
  isAuthenticated,
  isModeratorOf('subreddit', 'commentId', 'Comment'),
  commentController.removeComment
);

// Moderatör: Yorumu onayla
router.put('/:commentId/approve',
  isAuthenticated,
  isModeratorOf('subreddit', 'commentId', 'Comment'),
  commentController.approveComment
);

module.exports = router;
