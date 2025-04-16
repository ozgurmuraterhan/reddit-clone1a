const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const WikiPageSchema = new Schema(
  {
    // Wiki sayfasının bağlı olduğu subreddit
    subreddit: {
      type: Schema.Types.ObjectId,
      ref: 'Subreddit',
      required: true,
    },
    // Sayfa başlığı/adı - URL'lerde kullanılacak
    name: {
      type: String,
      required: [true, 'Wiki sayfası adı gereklidir'],
      trim: true,
      maxlength: [100, 'Wiki sayfası adı 100 karakterden uzun olamaz'],
      validate: {
        validator: function (v) {
          return /^[a-zA-Z0-9_-]+$/.test(v);
        },
        message: 'Wiki sayfası adı sadece harf, rakam, alt çizgi ve tire içerebilir',
      },
    },
    // Sayfa başlığı - görüntülenen başlık
    title: {
      type: String,
      required: [true, 'Wiki sayfası başlığı gereklidir'],
      trim: true,
      maxlength: [200, 'Wiki sayfası başlığı 200 karakterden uzun olamaz'],
    },
    // İçerik (Markdown formatında)
    content: {
      type: String,
      required: false,
      default: '',
    },
    // İçerik HTML olarak (Markdown'dan dönüştürülmüş)
    contentHtml: {
      type: String,
      required: false,
      default: '',
    },
    // Yayınlandı mı?
    isPublished: {
      type: Boolean,
      default: true,
    },
    // Erişim izni ayarları
    permissions: {
      // Görüntüleme izni: "public" (herkese açık), "members" (subreddit üyeleri), "mods" (sadece moderatörler)
      view: {
        type: String,
        enum: ['public', 'members', 'mods'],
        default: 'public',
      },
      // Düzenleme izni: "public" (herkese açık), "members" (subreddit üyeleri), "mods" (sadece moderatörler), "admins" (sadece adminler)
      edit: {
        type: String,
        enum: ['public', 'members', 'mods', 'admins'],
        default: 'mods',
      },
    },
    // Düzenleme kilidi - sadece moderatörler düzenleyebilir
    locked: {
      type: Boolean,
      default: false,
    },
    // Tartışma sayfası etkinleştirilmiş mi?
    discussionEnabled: {
      type: Boolean,
      default: true,
    },
    // En son revizyon ID'si
    currentRevision: {
      type: Schema.Types.ObjectId,
      ref: 'WikiRevision',
    },
    // Ana sayfa mı?
    isIndex: {
      type: Boolean,
      default: false,
    },
    // Sıralama (sidebar veya wiki index'te kullanılabilir)
    order: {
      type: Number,
      default: 0,
    },
    // Kategorisi (gruplandırma için)
    category: {
      type: String,
      default: null,
      trim: true,
      maxlength: [50, 'Kategori adı 50 karakterden uzun olamaz'],
    },
    // Oluşturulma ve güncellenme tarihleri
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    // Oluşturan kullanıcı
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Son düzenleyen kullanıcı
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Silinme bilgisi
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Slug oluşturmak için bileşik eşsiz index
WikiPageSchema.index({ subreddit: 1, name: 1 }, { unique: true });
// Kategori araması için index
WikiPageSchema.index({ subreddit: 1, category: 1 });
// Silinenleri filtrelemek için index
WikiPageSchema.index({ isDeleted: 1 });

// Timestamp güncellemesi
WikiPageSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Silinen içeriği filtreleme middleware
WikiPageSchema.pre('find', function () {
  this.where({ isDeleted: false });
});

WikiPageSchema.pre('findOne', function () {
  this.where({ isDeleted: false });
});

// Tartışma sayfası için sanal alan
WikiPageSchema.virtual('discussionPage', {
  ref: 'Post',
  localField: '_id',
  foreignField: 'wikiPage',
  justOne: true,
});

// Revizyon geçmişi için sanal alan
WikiPageSchema.virtual('revisions', {
  ref: 'WikiRevision',
  localField: '_id',
  foreignField: 'page',
  options: { sort: { createdAt: -1 } },
});

// Son N adet revizyon için sanal alan
WikiPageSchema.virtual('lastRevisions', {
  ref: 'WikiRevision',
  localField: '_id',
  foreignField: 'page',
  options: { sort: { createdAt: -1 }, limit: 10 },
});

// Wiki Revizyon Şeması
const WikiRevisionSchema = new Schema(
  {
    // İlişkili wiki sayfası
    page: {
      type: Schema.Types.ObjectId,
      ref: 'WikiPage',
      required: true,
    },
    // İçerik (Markdown)
    content: {
      type: String,
      required: true,
    },
    // İçerik HTML (işlenmiş)
    contentHtml: {
      type: String,
      required: true,
    },
    // Revizyon açıklaması
    reason: {
      type: String,
      trim: true,
      maxlength: [500, 'Revizyon açıklaması 500 karakterden uzun olamaz'],
    },
    // Revizyon farkı (önceki revizyona göre delta)
    diff: {
      type: String,
    },
    // Revizyon numarası
    revisionNumber: {
      type: Number,
      required: true,
    },
    // Önceki revizyon
    previousRevision: {
      type: Schema.Types.ObjectId,
      ref: 'WikiRevision',
    },
    // Oluşturulma tarihi
    createdAt: {
      type: Date,
      default: Date.now,
    },
    // Oluşturan kullanıcı
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Geri alınmış mı?
    isReverted: {
      type: Boolean,
      default: false,
    },
    // Meta veriler (ek bilgiler)
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Revizyon numaralarını etkin şekilde bulmak için index
WikiRevisionSchema.index({ page: 1, revisionNumber: 1 }, { unique: true });
// Tarih sıralaması için index
WikiRevisionSchema.index({ page: 1, createdAt: -1 });
// Kullanıcı katkılarını bulmak için index
WikiRevisionSchema.index({ createdBy: 1 });

// Wiki Settings Şeması (Subreddit seviyesinde wiki ayarları)
const WikiSettingsSchema = new Schema(
  {
    // İlişkili subreddit
    subreddit: {
      type: Schema.Types.ObjectId,
      ref: 'Subreddit',
      required: true,
      unique: true,
    },
    // Wiki etkin mi?
    enabled: {
      type: Boolean,
      default: true,
    },
    // Varsayılan görüntüleme izni
    defaultViewPermission: {
      type: String,
      enum: ['public', 'members', 'mods'],
      default: 'public',
    },
    // Varsayılan düzenleme izni
    defaultEditPermission: {
      type: String,
      enum: ['public', 'members', 'mods', 'admins'],
      default: 'mods',
    },
    // Düzenleme için gereken minimum hesap yaşı (gün)
    accountAgeDaysRequired: {
      type: Number,
      default: 0,
    },
    // Düzenleme için gereken minimum karma
    minKarmaRequired: {
      type: Number,
      default: 0,
    },
    // Düzenleme tarihçesini görebilecekler
    showRevisionHistory: {
      type: String,
      enum: ['public', 'members', 'mods'],
      default: 'public',
    },
    // Wiki için gereken onay sistemi
    approvalSystem: {
      type: Boolean,
      default: false,
    },
    // Onaylı düzenleyici listesi (özel izin verilen kullanıcılar)
    approvedEditors: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // Yasaklı düzenleyici listesi
    bannedEditors: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // Oluşturulma ve güncellenme tarihleri
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    // Oluşturan/güncelleyen moderatör
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Timestamp güncellemesi
WikiSettingsSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Model tanımlamaları
const WikiPage = mongoose.model('WikiPage', WikiPageSchema);
const WikiRevision = mongoose.model('WikiRevision', WikiRevisionSchema);
const WikiSettings = mongoose.model('WikiSettings', WikiSettingsSchema);

module.exports = {
  WikiPage,
  WikiRevision,
  WikiSettings,
};
