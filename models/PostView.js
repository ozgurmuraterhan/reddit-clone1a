const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PostViewSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    referrer: {
      type: String,
    },
    country: {
      type: String,
    },
    city: {
      type: String,
    },
    deviceType: {
      type: String,
      enum: ['desktop', 'mobile', 'tablet', 'other'],
    },
    sessionId: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

// Post başına görüntüleme sayısını verimli bir şekilde getirmek için indeks
PostViewSchema.index({ post: 1, viewedAt: -1 });

// Kullanıcı başına görüntüleme istatistiklerini hızlıca getirmek için indeks
PostViewSchema.index({ user: 1, post: 1, viewedAt: -1 });

// Coğrafi analiz için indeks
PostViewSchema.index({ post: 1, country: 1 });

// Referrer analizi için indeks
PostViewSchema.index({ post: 1, referrer: 1 });

// Tekrar eden görüntülemeleri kontrol edebilmek için benzersiz indeks
// (Bir kullanıcının/IP'nin belirli bir zaman aralığında sadece bir kez sayılmasını sağlamak için)
PostViewSchema.index(
  {
    post: 1,
    ipAddress: 1,
    viewedAt: 1,
  },
  {
    unique: false,
  },
);

// PostView için statik yöntemler ekle
PostViewSchema.statics.recordView = async function (postId, viewData) {
  // Aynı IP adresi ve post için son 30 dakika içinde kayıt var mı kontrol et
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  const existingView = await this.findOne({
    post: postId,
    ipAddress: viewData.ipAddress,
    viewedAt: { $gte: thirtyMinutesAgo },
  });

  // Eğer son 30 dakika içinde aynı IP'den görüntüleme yoksa yeni kayıt oluştur
  if (!existingView) {
    return this.create({
      post: postId,
      user: viewData.userId || null,
      ipAddress: viewData.ipAddress,
      userAgent: viewData.userAgent,
      referrer: viewData.referrer,
      country: viewData.country,
      city: viewData.city,
      deviceType: viewData.deviceType,
      sessionId: viewData.sessionId,
    });
  }

  return existingView;
};

// Bir post için toplam görüntüleme sayısını getir
PostViewSchema.statics.getTotalViews = async function (postId) {
  const result = await this.aggregate([
    { $match: { post: mongoose.Types.ObjectId(postId) } },
    { $count: 'totalViews' },
  ]);

  return result.length > 0 ? result[0].totalViews : 0;
};

// Bir postun belirli bir zaman aralığındaki görüntülemelerini günlük olarak getir
PostViewSchema.statics.getViewsByDateRange = async function (postId, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        post: mongoose.Types.ObjectId(postId),
        viewedAt: {
          $gte: startDate,
          $lte: endDate,
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$viewedAt' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

module.exports = mongoose.model('PostView', PostViewSchema);
