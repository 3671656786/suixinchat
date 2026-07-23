// utils/email.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.qq.com',
    port: parseInt(process.env.EMAIL_PORT) || 465,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

transporter.verify((error, success) => {
    if (error) console.error('❌ 邮件服务器配置错误:', error);
    else console.log('✅ 邮件服务器已就绪');
});

async function sendMail(to, subject, html) {
    return transporter.sendMail({
        from: `"随心聊" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html
    });
}

module.exports = { transporter, sendMail };