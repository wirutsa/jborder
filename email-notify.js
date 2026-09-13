const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD }
});

async function sendEmailNotification(toEmail, subject, htmlContent) {
  if (!toEmail || !process.env.EMAIL_USER) {
    console.log('⚠️ ข้ามการส่งอีเมล (ยังไม่ได้ตั้งค่าหรือไม่มีอีเมลผู้รับ)');
    return;
  }
  try {
    await transporter.sendMail({
      from: `"ระบบใบสั่งงาน EECO" <${process.env.EMAIL_USER}>`,
      to: toEmail, subject, html: htmlContent
    });
    console.log('✅ ส่งอีเมลสำเร็จ:', toEmail);
  } catch (err) {
    console.error('❌ ส่งอีเมลไม่สำเร็จ:', err.message);
  }
}

function newJobOrderTemplate(jobOrderNo, workDetail, link) {
  return `<div style="font-family:sans-serif;max-width:500px;margin:auto;border:1px solid #eee;border-radius:8px;overflow:hidden;">
    <div style="background:#0b5394;color:#fff;padding:16px;"><h2 style="margin:0;">📋 มีใบสั่งงานใหม่</h2></div>
    <div style="padding:20px;"><p><b>เลขที่:</b> ${jobOrderNo}</p><p><b>รายละเอียด:</b> ${workDetail||'-'}</p>
    <a href="${link}" style="background:#0b5394;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">เปิดใบสั่งงาน</a></div></div>`;
}

function signedNotificationTemplate(jobOrderNo, contractorName) {
  return `<div style="font-family:sans-serif;max-width:500px;margin:auto;border:1px solid #eee;border-radius:8px;overflow:hidden;">
    <div style="background:#27ae60;color:#fff;padding:16px;"><h2 style="margin:0;">✅ ผู้รับจ้างลงนามแล้ว</h2></div>
    <div style="padding:20px;"><p><b>เลขที่:</b> ${jobOrderNo}</p><p><b>ผู้ลงนาม:</b> ${contractorName}</p></div></div>`;
}

module.exports = { sendEmailNotification, newJobOrderTemplate, signedNotificationTemplate };