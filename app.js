require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');

// Uygulama oluştur
const app = express();

// Temel middleware'ler
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Güvenlik middleware'leri
app.use(mongoSanitize()); // NoSQL injection koruması
app.use(xss()); // XSS koruması
app.use(hpp()); // HTTP Parameter Pollution koruması

// Helmet güvenlik başlıkları
app.use(
  helmet({
    contentSecurityPolicy: false, // Geliştirme sırasında devre dışı bırakılabilir
    crossOriginEmbedderPolicy: false,
  }),
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100, // IP başına 100 istek
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Çok fazla istek gönderildi, lütfen daha sonra tekrar deneyin',
});
app.use('/api/', limiter);

// CORS yapılandırması
const corsOptions = {
  origin:
    process.env.NODE_ENV === 'development'
      ? true
      : [process.env.FRONTEND_URL || 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
};
app.use(cors(corsOptions));

// Loglama
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// MongoDB bağlantısı
mongoose
  .connect(process.env.MONGODB_URI, {
    // MongoDB 8.x sürümünde bu seçenekler artık gerekli değil
  })
  .then(() => {
    console.log('MongoDB bağlantısı başarılı');
  })
  .catch((err) => {
    console.error('MongoDB bağlantı hatası:', err.message);
    process.exit(1);
  });

// Session yapılandırması
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'super-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      ttl: parseInt(process.env.SESSION_EXPIRE, 10) / 1000 || 86400 * 365, // TTL in seconds
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: parseInt(process.env.SESSION_EXPIRE, 10) || 86400000 * 365, // 365 gün
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    },
  }),
);

// Passport initialize
app.use(passport.initialize());
app.use(passport.session());

// Passport stratejileri yapılandır
const configPassport = require('./config/passport');
configPassport();

// Test rotası - Middleware'lerden önce tanımlanmalı
app.get('/test-route', (req, res) => {
  res.status(200).json({ message: 'Test route works!', env: process.env.NODE_ENV });
});

// Route dosyalarını import et
const authRoutes = require('./routes/authRoutes');
const usersRoutes = require('./routes/usersRoutes');
const postRoutes = require('./routes/postRoutes');

// Route'ları tanımla
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/posts', postRoutes);

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.originalUrl}`,
  });
});

// Global hata yakalama
app.use((err, req, res, next) => {
  console.error(err.stack);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Sunucu hatası';

  res.status(statusCode).json({
    success: false,
    error: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

// İşlenmemiş Promise ret durumlarını yakala
process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
  console.error(err.stack);
});

// Server başlatma
const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor (${process.env.NODE_ENV || 'development'} modu)`);
});

module.exports = app;
