const nodemailer = require('nodemailer');

/**
 * Email gönderme fonksiyonu
 * @param {Object} options Gönderim seçenekleri
 * @param {string} options.email Alıcı email adresi
 * @param {string} options.subject Email konu başlığı
 * @param {string} options.html Email içeriği (HTML formatında)
 * @returns {Promise} Gönderim sonucu
 */
const sendEmail = async (options) => {
  try {
    // Gerekli parametreleri kontrol et
    if (!options.email || !options.subject || !options.html) {
      throw new Error('Email, konu ve HTML içerik zorunludur');
    }

    // Gmail için transporter oluştur
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD, // Gmail uygulama şifresi
      },
      tls: {
        // Gmail için gerekli TLS ayarları
        rejectUnauthorized: false,
      },
    });

    // Email seçeneklerini hazırla
    const mailOptions = {
      from: `${process.env.FROM_NAME} <${process.env.SMTP_USER}>`, // Gmail'de FROM_EMAIL yerine SMTP_USER kullanılmalı
      to: options.email,
      subject: options.subject,
      html: options.html,
    };

    // Email'i gönder
    const info = await transporter.sendMail(mailOptions);

    console.log(`Email gönderildi: ${info.messageId}`);
    console.log(`Alıcı: ${options.email}, Konu: ${options.subject}`);

    return info;
  } catch (error) {
    console.error('Email gönderme hatası:', error);
    throw new Error(`Email gönderilemedi: ${error.message}`);
  }
};

module.exports = sendEmail;
