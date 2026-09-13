const axios = require('axios');

async function sendLineMessage(toUserId, message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !toUserId) {
    console.log('⚠️ ข้ามการส่ง LINE (ยังไม่ได้ตั้งค่า Token หรือ User ID)');
    return;
  }
  try {
    await axios.post('https://api.line.me/v2/bot/message/push',
      { to: toUserId, messages: [{ type: 'text', text: message }] },
      { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } }
    );
    console.log('✅ ส่ง LINE สำเร็จ');
  } catch (err) {
    console.error('❌ ส่ง LINE ไม่สำเร็จ:', err.response?.data || err.message);
  }
}

module.exports = { sendLineMessage };