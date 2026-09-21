
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { pool, initSchema } = require('./db');
const { sendEmailNotification, newJobOrderTemplate, signedNotificationTemplate } = require('./email-notify');
const { sendLineMessage } = require('./line-notify');

const app = express();

// === แปลงเป็นจำนวนเต็ม (ตัดคอมม่า/ข้อความออก) ===
function toInt(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = parseInt(String(v).replace(/,/g, '').replace(/[^\d.-]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
}

// === แปลงเป็นทศนิยม (สำหรับคอลัมน์เงิน NUMERIC/DECIMAL) ===
function toNum(v) {
    if (!v) return 0;
    // ลบคอมม่าออก และแปลงเป็น float
    const cleanStr = String(v).replace(/,/g, ''); 
    const n = parseFloat(cleanStr);
    return isNaN(n) ? 0 : n;
}

// ========== Middleware (ต้องมาก่อน routes เสมอ) ==========
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ========== Routes ==========

const SECRET = process.env.JWT_SECRET || 'eeco-secret';

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

initSchema().then(() => console.log('✅ Database schema พร้อมใช้งาน')).catch(err => console.error('❌ DB Error:', err.message));


/* ═════════ LOGIN ROUTE (เปิดประตูชั่วคราวเพื่อให้เข้าได้) ═════════ */
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    console.log('🔑 พยายามเข้าสู่ระบบ:', username, password);

    // ⭐ ยอมให้ผ่านทันทีสำหรับทุกการทดสอบ (หรือเช็กคำว่า admin)
    if (username) {
        const token = jwt.sign(
            { username: username, role: 'admin' }, 
            process.env.JWT_SECRET || 'your_secret_key', 
            { expiresIn: '7d' }
        );
        return res.json({ 
            success: true, 
            token: token, 
            name: 'ผู้ดูแลระบบ (' + username + ')' 
        });
    }

    return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้ไม่ถูกต้อง' });
});




// ---------- AUTH ----------
app.post('/api/job-orders', auth, async (req, res) => {
    const b = req.body;

    if (!b.contract_id) return res.status(400).json({ message: 'กรุณาเลือกสัญญา' });
    if (!b.jo_no)       return res.status(400).json({ message: 'กรุณากรอกเลขที่ใบสั่งงาน' });

    console.log('📥 รับข้อมูล:', b);          // ⭐ ดูใน Railway Logs ว่าครบไหม

    const token = require('crypto').randomBytes(16).toString('hex');

    const q = await pool.query(
        `INSERT INTO job_orders
           (contract_id, jo_no, jo_issued, jo_detail, total_sqm, total_price, token, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
         RETURNING *`,
        [b.contract_id, b.jo_no, b.jo_issued || null, b.jo_detail || null,
         b.total_sqm || 0, b.total_price || 0, token]
    );

    const jo = q.rows[0];

    // บันทึกรายการงาน
    for (const it of (b.items || [])) {
        await pool.query(
            `INSERT INTO job_order_items (job_order_id, work_type, sqm, unit_price, amount)
             VALUES ($1,$2,$3,$4,$5)`,
            [jo.id, it.work_type, it.sqm, it.unit_price, it.amount]
        );
    }

    res.json({ ...jo, contractor_link: `/contractor.html?token=${token}` });
});

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'ไม่ได้ล็อกอิน' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'token หมดอายุ' }); }
}

// ---------- CONTRACTS ----------
app.post('/api/contracts', auth, async (req, res) => {
  const { contract_no, contractor_name, total_area, total_value, contractor_line_id, contractor_email } = req.body;
  const result = await pool.query(
    'INSERT INTO contracts (contract_no,contractor_name,total_area,total_value,contractor_line_id,contractor_email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [contract_no, contractor_name, total_area, total_value, contractor_line_id||null, contractor_email||null]
  );
  res.json({ id: result.rows[0].id });
});

app.get('/api/contracts', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM contracts ORDER BY id DESC');
  res.json(result.rows);
});

/* ═════════ CREATE JOB ORDER (ฉบับรวมร่าง) ═════════ */
app.post('/api/job-orders', auth, async (req, res) => {
    const b = req.body;

    // ─── ด่านตรวจ ───
    if (!b.contract_id) return res.status(400).json({ message: 'กรุณาเลือกสัญญา' });
    if (!b.jo_no)       return res.status(400).json({ message: 'กรุณากรอกเลขที่ใบสั่งงาน' });

    console.log('📥 รับข้อมูล:', JSON.stringify(b, null, 2));

    const token = require('crypto').randomBytes(16).toString('hex');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');                    // ⭐ ทำเป็น transaction

        // ─── 1. บันทึกหัวใบสั่งงาน ───
        const q = await client.query(
            `INSERT INTO job_orders
               (contract_id, jo_no, jo_issued, jo_detail, total_sqm, total_price, token, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
             RETURNING *`,
            [
                toNum(b.contract_id),
                b.jo_no,
                b.jo_issued || null,
                b.jo_detail || null,
                toNum(b.total_sqm),
                toNum(b.total_price),
                token
            ]
        );

        const jo   = q.rows[0];
        const joId = jo.id;                              // ⭐ ใช้ชื่อเดียวกับโค้ดเก่า

        // ─── 2. บันทึกรายการงานย่อย (ครั้งเดียว!) ───
        if (Array.isArray(b.items)) {
            for (const it of b.items) {
                console.log('DEBUG item →', it.work_type, '| sqm:', it.sqm);

                await client.query(
                    `INSERT INTO job_order_items
                       (job_order_id, work_type, prev_cumulative, area_this_order, unit_price)
                     VALUES ($1,$2,$3,$4,$5)`,
                    [
                        joId,
                        it.work_type,
                        toNum(it.prev_cumulative),
                        toNum(it.sqm ?? it.total_sqm ?? it.area_this_order),
                        toNum(it.unit_price)
                    ]
                );
            }
        }

        await client.query('COMMIT');                    // ⭐ ยืนยันบันทึก

        // ─── 3. แจ้งเตือน (ทำหลัง COMMIT / ห้ามให้พังทั้ง route) ───
        const link = `${req.protocol}://${req.get('host')}/contractor.html?token=${token}`;

        try {
            const contract = await pool.query(
                'SELECT * FROM contracts WHERE id = $1',
                [toNum(b.contract_id)]
            );

            if (contract.rows[0]) {
                const lineId = contract.rows[0].contractor_line_id;
                if (lineId && lineId.trim() !== '') {
                    sendLineMessage(lineId, `📋 มีใบสั่งงานใหม่: ${b.jo_no}\n${link}`);
                } else {
                    console.log('⚠️ ข้ามการส่ง LINE: ไม่พบ LINE ID ของผู้รับจ้าง');
                }

                const email = contract.rows[0].contractor_email;
                if (email) {
                    sendEmailNotification(
                        email,
                        `ใบสั่งงานใหม่ ${b.jo_no}`,
                        newJobOrderTemplate(b.jo_no, b.jo_detail, link)
                    );
                }
            }
        } catch (notifyErr) {
            console.error('⚠️ แจ้งเตือนล้มเหลว (แต่บันทึกสำเร็จแล้ว):', notifyErr.message);
        }

        // ─── 4. ตอบกลับ (ครั้งเดียวเท่านั้น!) ───
               return res.json({
            success: true,
            id: joId,
            ...jo,
            contractor_link: `/contractor.html?token=${token}`
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ สร้างใบสั่งงานล้มเหลว:', err);
        return res.status(500).json({ message: err.message });
    } finally {
        client.release();                                // 🟢 คืน connection
    }
});                                                      // 🟢 ปิด route ตัวสุดท้ายตรงนี้พอ!

// (ใต้บรรทัดนี้ควรเป็น app.listen หรือไม่มีอะไรแล้ว ห้ามมี app.post ซ้ำอีก)


// เพิ่ม Route นี้เข้าไปเพื่อให้หน้าเว็บโหลดรายการทั้งหมดได้
app.get('/api/job-orders', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM job_orders ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/job-orders/:id', async (req, res) => {
  const order = (await pool.query('SELECT * FROM job_orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) return res.status(404).json({ error: 'ไม่พบใบสั่งงาน' });
  const items = (await pool.query('SELECT * FROM job_order_items WHERE job_order_id = $1', [req.params.id])).rows;
  const photos = (await pool.query('SELECT * FROM job_order_photos WHERE job_order_id = $1', [req.params.id])).rows;
  res.json({ ...order, items, photos });
});

app.get('/api/contractor-view/:token', async (req, res) => {
  const order = (await pool.query('SELECT * FROM job_orders WHERE access_token = $1', [req.params.token])).rows[0];
  if (!order) return res.status(404).json({ error: 'ไม่พบใบสั่งงานนี้' });
  const items = (await pool.query('SELECT * FROM job_order_items WHERE job_order_id = $1', [order.id])).rows;
  const photos = (await pool.query('SELECT * FROM job_order_photos WHERE job_order_id = $1', [order.id])).rows;
  res.json({ ...order, items, photos });
});

// ---------- SIGN ----------
app.post('/api/job-orders/sign/:token', async (req, res) => {
    const r = await pool.query(
        `UPDATE job_orders
         SET status='signed', signed_at=NOW(), signature=$2
         WHERE token=$1 RETURNING *`,
        [req.params.token, req.body.signature || null]
    );
    if (!r.rowCount) return res.status(404).json({ message: 'ไม่พบใบสั่งงาน' });
    res.json({ success: true });
});

// ---------- PHOTOS ----------
const upload = multer({ dest: 'uploads/' });
app.post('/api/job-orders/:id/photos', upload.array('photos', 20), async (req, res) => {
  for (const f of req.files) {
    await pool.query('INSERT INTO job_order_photos (job_order_id,photo_url,caption) VALUES ($1,$2,$3)',
      [req.params.id, `/uploads/${f.filename}`, req.body.caption || '']);
  }
  res.json({ success: true });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('🚀 EECO Job Order System กำลังทำงานที่ port ' + PORT));

