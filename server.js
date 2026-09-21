
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

// ---------- JOB ORDERS ----------
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
        // 2. บันทึกรายการงานย่อย
        if (Array.isArray(b.items)) {
            for (const i of b.items) {
                console.log("DEBUG: ข้อมูลที่ได้รับจากหน้าเว็บ -> work_type:", i.work_type, "total_sqm:", i.total_sqm);

        

                 await pool.query(

                   'INSERT INTO job_order_items (job_order_id, work_type, prev_cumulative, area_this_order, unit_price) VALUES ($1, $2, $3, $4, $5)',

                    [joId, i.work_type, toNum(i.prev_cumulative), toNum(i.total_sqm), toNum(i.unit_price)]

                );

            }
        }

        // 3. ส่ง Notification
        const contract = await pool.query('SELECT * FROM contracts WHERE id = $1', [toNum(b.contract_id)]);
        const link = `${req.protocol}://${req.get('host')}/contractor.html?token=${token}`;
        const lineId = contract.rows[0]?.contractor_line_id;
       if (lineId && lineId.trim() !== "") {
    sendLineMessage(lineId, `📄 มีใบสั่งงานใหม่: ${b.job_order_no}\n${link}`);
} else {
    console.log("⚠️ ข้ามการส่ง LINE: ไม่พบ LINE ID ของผู้รับ");
}

        const email = contract.rows[0]?.contractor_email;
        if (email) sendEmailNotification(email, `ใบสั่งงานใหม่ ${b.job_order_no}`, newJobOrderTemplate(b.job_order_no, b.work_detail, link));

        res.json({ success: true, id: joId, contractor_link: `/contractor.html?token=${token}` });

    } catch (err) {
        console.error('❌ Error บันทึกใบงาน:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// บันทึกใบสั่งงานใหม่
app.post('/api/job-orders', async (req, res) => {
    try {
        const b = req.body;
        
        // 1. บันทึกข้อมูลหลัก
        const jobResult = await pool.query(`
            INSERT INTO job_orders (
                job_order_no, contract_id, issued_date, delivery_date, survey_date, 
                start_date, duration_days, completion_date, prepared_by, department, 
                issued_for, map_image, total_area, work_detail, workers, 
                equipment, area_restriction, safety_condition, waste_management
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`, 
            [
                b.job_order_no,toNum(b.contract_id), b.issued_date, b.delivery_date, b.survey_date, 
                b.start_date, toNum(b.duration_days),  b.completion_date, b.prepared_by, b.department, 
                b.issued_for, b.map_image, toNum(b.total_area),   b.work_detail, b.workers, 
                b.equipment, b.area_restriction, b.safety_condition, b.waste_management
            ]
        );

        const joId = jobResult.rows[0].id;

        // 2. บันทึกรายการงานย่อย (items)
        if (b.items && Array.isArray(b.items)) {
            for (const item of b.items) {
                await pool.query(`
                    INSERT INTO job_order_items (job_order_id, work_type, prev_cumulative, area_this_order, unit_price) 
                    VALUES ($1, $2, $3, $4, $5)`,
                    [joId, item.work_type, item.prev_cumulative, item.area_this_order, item.unit_price]
                );
            }
        }

        res.json({ success: true, id: joId });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});

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

