// utils/email.js
const nodemailer = require('nodemailer');
require('dotenv').config();

// 修复 #92：EMAIL_USER 未配置时给出明确警告，避免邮件功能静默失败
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️ 邮件服务未配置（缺少 EMAIL_USER / EMAIL_PASS），邮件相关功能（验证码、公告、报表）将无法使用');
}

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