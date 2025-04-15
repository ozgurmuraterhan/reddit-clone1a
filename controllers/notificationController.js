const { Notification, User } = require('../models');

/**
 * Kullanıcının bildirimlerini getir
 * @route GET /api/notifications
 * @access Private
 */
const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { unreadOnly } = req.query;

    // Filtre oluştur
    const filter = { recipient: userId };
    if (unreadOnly === 'true') {
      filter.read = false;
    }

    const notifications = await Notification.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate('sender', 'username profilePicture')
      .populate('relatedPost', 'title')
      .populate('relatedComment', 'content')
      .populate('relatedSubreddit', 'name')
      .populate('relatedReport', 'reason');

    const totalNotifications = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ recipient: userId, read: false });

    res.status(200).json({
      success: true,
      count: notifications.length,
      total: totalNotifications,
      unreadCount,
      totalPages: Math.ceil(totalNotifications / limit),
      currentPage: page,
      data: notifications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bildirimler getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Bildirimi okundu olarak işaretle
 * @route PUT /api/notifications/:notificationId
 * @access Private
 */
const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: userId,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Bildirim bulunamadı',
      });
    }

    notification.read = true;
    notification.readAt = Date.now();
    await notification.save();

    res.status(200).json({
      success: true,
      message: 'Bildirim okundu olarak işaretlendi',
      data: notification,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bildirim güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Tüm bildirimleri okundu olarak işaretle
 * @route PUT /api/notifications/mark-all-read
 * @access Private
 */
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    await Notification.updateMany(
      { recipient: userId, read: false },
      { read: true, readAt: Date.now() },
    );

    res.status(200).json({
      success: true,
      message: 'Tüm bildirimler okundu olarak işaretlendi',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bildirimler güncellenirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Bildirimi sil
 * @route DELETE /api/notifications/:notificationId
 * @access Private
 */
const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: userId,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Bildirim bulunamadı',
      });
    }

    await notification.remove();

    res.status(200).json({
      success: true,
      message: 'Bildirim başarıyla silindi',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bildirim silinirken bir hata oluştu',
      error: error.message,
    });
  }
};

/**
 * Okunmamış bildirim sayısını getir
 * @route GET /api/notifications/unread-count
 * @access Private
 */
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;

    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      read: false,
    });

    res.status(200).json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Okunmamış bildirim sayısı getirilirken bir hata oluştu',
      error: error.message,
    });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
};
