const express = require("express");
const router = express.Router();
const {
  createComment,
  updateComment,
  deleteComment,
  getCommentById,
  getCommentReplies,
  voteComment,
  saveComment,
  unsaveComment,
  removeComment,
  approveComment,
  lockComment,
} = require("../controllers/commentController");
const { protect, authorize } = require("../middleware/authMiddleware");
const { checkModeratorPermission } = require("../middleware/moderatorMiddleware");

// Temel yorum işlemleri
router.post("/", protect, createComment);
router.get("/:id", getCommentById);
router.get("/:id/replies", getCommentReplies);
router.put("/:id", protect, updateComment);
router.delete("/:id", protect, deleteComment);

// Oy verme
router.post("/:commentId/vote", protect, voteComment);

// Kaydetme
router.post("/:commentId/save", protect, saveComment);
router.delete("/:commentId/save", protect, unsaveComment);

// Moderatör işlemleri
router.put("/:commentId/remove", protect, checkModeratorPermission, removeComment);
router.put("/:commentId/approve", protect, checkModeratorPermission, approveComment);
router.put("/:commentId/lock", protect, checkModeratorPermission, lockComment);

module.exports = router;
