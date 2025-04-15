module.exports = {
  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Email configuration
  email: {
    from: process.env.EMAIL_FROM || 'noreply@redditclone.com',
    smtp: {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    },
  },

  // Upload configuration
  upload: {
    profilePicture: {
      maxSize: 2 * 1024 * 1024, // 2MB
      allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
    },
    subredditIcon: {
      maxSize: 2 * 1024 * 1024, // 2MB
      allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
    },
    subredditBanner: {
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
    },
    postImage: {
      maxSize: 10 * 1024 * 1024, // 10MB
      allowedFormats: ['image/jpeg', 'image/png', 'image/gif'],
    },
    postVideo: {
      maxSize: 100 * 1024 * 1024, // 100MB
      allowedFormats: ['video/mp4', 'video/webm'],
    },
  },

  // Rate limiting configuration
  rateLimit: {
    window: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  },

  // Frontend URL for email links
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};
