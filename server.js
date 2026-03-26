'use strict';
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const rateLimit  = require('express-rate-limit');
const validator  = require('validator');
const { createClient } = require('@supabase/supabase-js');
const { applyOurTag, detectStore } = require('./affiliates');

const app  = express();
const PORT = process.env.PORT || 3000;

// JWT secret MUST come from env — no insecure fallback
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET not set in .env');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('❌ FATAL: SUPABASE_URL or SUPABASE_SERVICE_KEY not set');
  process.exit(1);
}
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    // In production: only allow known web origins
    if (process.env.NODE_ENV === 'production') {
      const allowed = ['https://precimap.app', 'https://www.precimap.app'];
      if (allowed.includes(origin)) return callback(null, true);
      return callback(null, true); // still allow for mobile app until web is deployed
    }
    return callback(null, true); // allow all in dev
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/public', express.static(path.join(__dirname, 'public')));
// Note: apiLimiter applied after its declaration below

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window per IP
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
  standardHeaders: true, legacyHeaders: false,
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 200,
  message: { error: 'Demasiadas peticiones. Espera un momento.' },
});

// Apply global rate limit to all API routes (declared after apiLimiter)
app.use('/api/', apiLimiter);

// ─── MULTER (image uploads) with MIME validation ─────────────────────────────
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.${file.originalname.split('.').pop().toLowerCase()}`)
});
const ALLOWED_MIME = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (JPG, PNG, GIF, WebP)'));
  }
});


// ─── HELPERS ──────────────────────────────────────────────────────────────────
function normalize(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function fuzzyMatch(query, target) {
  if (!query || !target) return false;
  const q = normalize(query), t = normalize(target);
  if (t.includes(q)) return true;
  if (q.length > 3 && t.includes(q.slice(1))) return true;
  if (q.length >= 4) {
    function lev(a, b) {
      const m = []; const al = a.length, bl = b.length;
      for (let i = 0; i <= al; i++) m[i] = [i];
      for (let j = 0; j <= bl; j++) m[0][j] = j;
      for (let i = 1; i <= al; i++) for (let j = 1; j <= bl; j++)
        m[i][j] = a[i-1]===b[j-1] ? m[i-1][j-1] : 1+Math.min(m[i-1][j],m[i][j-1],m[i-1][j-1]);
      return m[al][bl];
    }
    for (const w of t.split(/\s+/))
      if (w.length >= 4 && lev(q, w) <= Math.floor(q.length / 4)) return true;
  }
  return false;
}
function calcDist(lat1, lng1, lat2, lng2) {
  if (!lat1||!lng1||!lat2||!lng2) return 999;
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function ok(res, data)   { res.json({ ok: true, ...data }); }
function fail(res, msg, code=400) { res.status(code).json({ error: msg }); }
function parseId(val) {
  const n = parseInt(val, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return fail(res, 'No autenticado', 401);
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { fail(res, 'Token inválido', 401); }
}
function optAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) { try { req.user = jwt.verify(token, JWT_SECRET); } catch {} }
  next();
}


// ─── SUPABASE WRAPPERS ────────────────────────────────────────────────────────
const db = {
  async query(table, options = {}) {
    let q = supabase.from(table).select(options.select || '*');
    if (options.eq)     Object.entries(options.eq).forEach(([k,v])  => { q = q.eq(k, v); });
    if (options.neq)    Object.entries(options.neq).forEach(([k,v]) => { q = q.neq(k, v); });
    if (options.gte)    Object.entries(options.gte).forEach(([k,v]) => { q = q.gte(k, v); });
    if (options.lte)    Object.entries(options.lte).forEach(([k,v]) => { q = q.lte(k, v); });
    if (options.ilike)  Object.entries(options.ilike).forEach(([k,v])=> { q = q.ilike(k, `%${v}%`); });
    if (options.order)  q = q.order(options.order.col, { ascending: options.order.asc ?? true });
    if (options.limit)  q = q.limit(options.limit);
    if (options.single) q = q.single();
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },
  async insert(table, row) {
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async update(table, id, changes) {
    const { data, error } = await supabase.from(table).update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async upsert(table, row, conflict) {
    const { data, error } = await supabase.from(table).upsert(row, { onConflict: conflict }).select().single();
    if (error) throw error;
    return data;
  },
  async delete(table, id) {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
    return true;
  },
  async count(table, options = {}) {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (options.eq) Object.entries(options.eq).forEach(([k,v]) => { q = q.eq(k,v); });
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  },
  async rpc(fn, params) {
    const { data, error } = await supabase.rpc(fn, params);
    if (error) throw error;
    return data;
  }
};

// ─── GAMIFICATION ─────────────────────────────────────────────────────────────
async function addPoints(userId, points, reason) {
  try {
    await supabase.rpc('increment_points', { uid: userId, pts: points });
    await db.insert('notifications', { user_id: userId, type: 'points', message: `+${points} puntos por ${reason}` });
    // Auto-update rank_title based on new point total
    const user = await db.query('users', { eq: { id: userId }, single: true });
    if (user) {
      const pts = (user.points || 0) + points;
      const rank = pts >= 1000 ? 'Leyenda' : pts >= 400 ? 'Gurú' : pts >= 150 ? 'Experto' : pts >= 50 ? 'Ahorrador' : 'Novato';
      await db.update('users', userId, { rank_title: rank });
    }
  } catch {}
}
async function checkBadges(userId) {
  try {
    const [reports, deals, streak] = await Promise.all([
      db.count('prices', { eq: { reported_by: userId } }),
      db.count('deals',  { eq: { reported_by: userId } }),
      db.query('users',  { eq: { id: userId }, select: 'streak', single: true }),
    ]);
    const earned = (await db.query('badges', { eq: { user_id: userId }, select: 'key' }) || []).map(b=>b.key);
    const award = async (key, name, pts) => {
      if (!earned.includes(key)) {
        await db.insert('badges', { user_id: userId, key });
        await db.insert('notifications', { user_id: userId, type: 'badge', message: `🎖️ Nuevo logro: ${name}` });
        await addPoints(userId, pts, `logro ${name}`);
      }
    };
    if (reports >= 1)  await award('primer_reporte',  'Primer Reporte', 5);
    if (reports >= 10) await award('diez_reportes',   '10 Reportes', 15);
    if (reports >= 50) await award('cincuenta',       'Experto Local', 50);
    if (deals >= 1)    await award('primer_chollo',   'Primer Chollo', 10);
    if (streak?.streak >= 7)  await award('racha_7',  'Racha 7 días', 15);
    if (streak?.streak >= 30) await award('racha_30', 'Mes Constante', 50);
  } catch {}
}


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, version: '3.3.0', db: 'supabase', stations: _gasCache?.length || 0 }));
app.get('/api/stats', async (req, res) => {
  try {
    const [places, prices, deals, users, events] = await Promise.all([
      db.count('places'), db.count('prices'), db.count('deals'),
      db.count('users'),  db.count('events'),
    ]);
    res.json({
      places, prices, deals, users, events,
      gasolineras: _gasCache?.length || 0,
      version: '3.3.0',
    });
  } catch(e) { fail(res, e.message, 500); }
});

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email || !password) return fail(res, 'Faltan campos');
    if (!validator.isEmail(email)) return fail(res, 'Email no válido');
    if (password.length < 6) return fail(res, 'Contraseña mínimo 6 caracteres');
    if (name.trim().length < 2) return fail(res, 'El nombre debe tener al menos 2 caracteres');
    const normalizedEmail = email.trim().toLowerCase();
    const exists = await db.query('users', { eq: { email: normalizedEmail }, select: 'id', single: true }).catch(()=>null);
    if (exists) return fail(res, 'Email ya registrado');
    const hash = await bcrypt.hash(password, 12);
    const user = await db.insert('users', { name: name.trim(), email: normalizedEmail, password_hash: hash, points: 0, streak: 0 });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, points: 0 } });
  } catch(e) { fail(res, e.message); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return fail(res, 'Faltan campos');
    if (!validator.isEmail(email)) return fail(res, 'Email no válido');
    const normalizedEmail = email.trim().toLowerCase();
    const user = await db.query('users', { eq: { email: normalizedEmail }, single: true }).catch(()=>null);
    if (!user || !user.password_hash) return fail(res, 'Email o contraseña incorrectos');
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return fail(res, 'Email o contraseña incorrectos');
    // Update streak
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
    let streak = user.streak || 0;
    if (user.last_report_date === yesterday) streak++;
    else if (user.last_report_date !== today) streak = 1;
    await db.update('users', user.id, { streak, last_report_date: today }).catch(()=>{});
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, points: user.points, avatar_url: user.avatar_url, streak } });
  } catch(e) { fail(res, e.message); }
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !validator.isEmail(email)) return res.json({ ok: true }); // silently ignore invalid
    const normalizedEmail = email.trim().toLowerCase();
    const user = await db.query('users', { eq: { email: normalizedEmail }, select: 'id,email', single: true }).catch(()=>null);
    // Always respond OK to prevent email enumeration
    if (!user) return res.json({ ok: true, message: 'Si el email existe, recibirás el código' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15*60000).toISOString();
    await supabase.from('password_resets').delete().eq('email', normalizedEmail);
    await db.insert('password_resets', { email: normalizedEmail, code, expires_at: expires });
    // In production: send real email. For now log server-side only (NEVER in response)
    console.log(`🔑 [DEV ONLY] Reset code for ${normalizedEmail}: ${code}`);
    res.json({ ok: true, message: 'Si el email existe, recibirás el código en breve' });
  } catch(e) { fail(res, e.message); }
});

app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { email, code, new_password } = req.body;
    if (!email || !code || !new_password) return fail(res, 'Faltan campos');
    if (!validator.isEmail(email)) return fail(res, 'Email no válido');
    if (new_password.length < 6) return fail(res, 'Contraseña mínimo 6 caracteres');
    const normalizedEmail = email.trim().toLowerCase();
    const reset = await db.query('password_resets', { eq: { email: normalizedEmail, code, used: 0 }, single: true }).catch(()=>null);
    if (!reset) return fail(res, 'Código inválido o ya usado');
    if (new Date(reset.expires_at) < new Date()) return fail(res, 'Código expirado. Solicita uno nuevo.');
    const hash = await bcrypt.hash(new_password, 12);
    const { data: user } = await supabase.from('users').update({ password_hash: hash }).eq('email', normalizedEmail).select().single();
    await db.update('password_resets', reset.id, { used: 1 });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email } });
  } catch(e) { fail(res, e.message); }
});


// ─── USER PROFILE + AVATAR ────────────────────────────────────────────────────
app.get('/api/users/me', auth, async (req, res) => {
  try {
    const [user, badges, notifs] = await Promise.all([
      db.query('users', { eq: { id: req.user.id }, single: true }),
      db.query('badges', { eq: { user_id: req.user.id } }),
      db.query('notifications', { eq: { user_id: req.user.id }, order: { col: 'created_at', asc: false }, limit: 20 }),
    ]);
    const [reportCount, verifiedCount, dealCount] = await Promise.all([
      db.count('prices', { eq: { reported_by: req.user.id } }),
      db.count('prices', { eq: { reported_by: req.user.id, status: 'verified' } }),
      db.count('deals',  { eq: { reported_by: req.user.id } }),
    ]);
    const { password_hash, ...safeUser } = user;
    res.json({ ...safeUser, badges: badges||[], notifications: notifs||[], stats: { reports: reportCount, verified: verifiedCount, deals: dealCount } });
  } catch(e) { fail(res, e.message, 500); }
});

// My deals — user's own published deals
app.get('/api/users/me/deals', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .eq('reported_by', req.user.id)
      .eq('is_active', 1)
      .order('detected_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    // Add temperature
    const now = Date.now();
    const deals = (data||[]).map(d => {
      const ageH = (now - new Date(d.detected_at)) / 3600000;
      const score = (d.votes_up||0) - (d.votes_down||0);
      const dec = score / Math.pow(ageH+2, 1.5);
      let temp, tc;
      if (score>=20||dec>3) { temp='🔥🔥🔥'; tc='#DC2626'; }
      else if (score>=10||dec>1.5) { temp='🔥🔥'; tc='#EA580C'; }
      else if (score>=3||dec>0.5) { temp='🔥'; tc='#D97706'; }
      else if (score>=0) { temp='😐'; tc='#6B7280'; }
      else { temp='🧊'; tc='#3B82F6'; }
      return { ...d, temperature: temp, temp_color: tc };
    });
    res.json(deals);
  } catch(e) { fail(res, e.message, 500); }
});

// Upload avatar photo
app.post('/api/users/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 'No se subió ninguna imagen');
    const avatarUrl = `/public/uploads/${req.file.filename}`;
    // Upload to Supabase Storage if available, else use local
    try {
      const fileBuffer = fs.readFileSync(req.file.path);
      const ext = req.file.originalname.split('.').pop();
      const storagePath = `avatars/${req.user.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from('precimap').upload(storagePath, fileBuffer, { upsert: true, contentType: req.file.mimetype });
      if (!upErr) {
        const { data: { publicUrl } } = supabase.storage.from('precimap').getPublicUrl(storagePath);
        await db.update('users', req.user.id, { avatar_url: publicUrl });
        fs.unlinkSync(req.file.path);
        return res.json({ ok: true, avatar_url: publicUrl });
      }
    } catch {}
    // Fallback: local file
    await db.update('users', req.user.id, { avatar_url: avatarUrl });
    res.json({ ok: true, avatar_url: avatarUrl });
  } catch(e) { fail(res, e.message); }
});

app.patch('/api/users/me', auth, async (req, res) => {
  try {
    const { name, bio } = req.body;
    const updates = {};
    if (name?.trim()?.length >= 2) updates.name = name.trim();
    if (bio !== undefined) updates.bio = bio.slice(0, 200); // max 200 chars
    if (!Object.keys(updates).length) return fail(res, 'Nada que actualizar');
    const user = await db.update('users', req.user.id, updates);
    res.json({ ok: true, user: { id: user.id, name: user.name, bio: user.bio, avatar_url: user.avatar_url } });
  } catch(e) { fail(res, e.message); }
});

// Change password from profile (requires current password)
app.post('/api/users/me/change-password', auth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return fail(res, 'Faltan campos');
    if (new_password.length < 6) return fail(res, 'Nueva contraseña mínimo 6 caracteres');
    if (current_password === new_password) return fail(res, 'La nueva contraseña debe ser diferente');
    const user = await db.query('users', { eq: { id: req.user.id }, single: true });
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return fail(res, 'Contraseña actual incorrecta');
    const hash = await bcrypt.hash(new_password, 12);
    await supabase.from('users').update({ password_hash: hash }).eq('id', req.user.id);
    res.json({ ok: true, message: 'Contraseña cambiada correctamente' });
  } catch(e) { fail(res, e.message); }
});

// Delete account via POST (for React Native where DELETE + body is unreliable)
app.post('/api/users/me/delete', auth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return fail(res, 'Debes confirmar tu contraseña');
    const user = await db.query('users', { eq: { id: req.user.id }, single: true });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return fail(res, 'Contraseña incorrecta');
    await supabase.from('users').update({
      name: '[Usuario eliminado]',
      email: `deleted_${req.user.id}_${Date.now()}@deleted.com`,
      password_hash: '', avatar_url: null, bio: null, is_deleted: 1,
    }).eq('id', req.user.id);
    await supabase.from('notifications').delete().eq('user_id', req.user.id);
    await supabase.from('price_alerts').delete().eq('user_id', req.user.id);
    res.json({ ok: true });
  } catch(e) { fail(res, e.message); }
});

// Delete account via DELETE (kept for compatibility)
app.delete('/api/users/me', auth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return fail(res, 'Debes confirmar tu contraseña');
    const user = await db.query('users', { eq: { id: req.user.id }, single: true });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return fail(res, 'Contraseña incorrecta');
    await supabase.from('users').update({
      name: '[Usuario eliminado]',
      email: `deleted_${req.user.id}_${Date.now()}@deleted.com`,
      password_hash: '', avatar_url: null, bio: null, is_deleted: 1,
    }).eq('id', req.user.id);
    await supabase.from('notifications').delete().eq('user_id', req.user.id);
    await supabase.from('price_alerts').delete().eq('user_id', req.user.id);
    res.json({ ok: true });
  } catch(e) { fail(res, e.message); }
});

app.get('/api/users/:id/public', async (req, res) => {
  try {
    const user = await db.query('users', { eq: { id: req.params.id }, select: 'id,name,avatar_url,bio,points,streak,created_at', single: true });
    if (!user) return fail(res, 'Usuario no encontrado', 404);
    const [badges, reportCount, dealCount] = await Promise.all([
      db.query('badges', { eq: { user_id: req.params.id } }),
      db.count('prices', { eq: { reported_by: req.params.id } }),
      db.count('deals',  { eq: { reported_by: req.params.id } }),
    ]);
    res.json({ ...user, badges: badges||[], stats: { reports: reportCount, deals: dealCount } });
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/notifications/read', auth, async (req, res) => {
  try {
    await supabase.from('notifications').update({ is_read: 1 }).eq('user_id', req.user.id);
    res.json({ ok: true });
  } catch(e) { fail(res, e.message); }
});

// ─── LEADERBOARD — with real period filter, no N+1 ───────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    // Period filter: compute since date
    let sinceDate = null;
    if (period === 'week')  sinceDate = new Date(Date.now() - 7  * 86400000).toISOString();
    if (period === 'month') sinceDate = new Date(Date.now() - 30 * 86400000).toISOString();

    if (sinceDate) {
      const { data: topReporters, error } = await supabase
        .from('prices')
        .select('reported_by, users(id, name, avatar_url, points, streak)')
        .gte('reported_at', sinceDate)
        .not('reported_by', 'is', null);
      if (error) throw error;
      const counts = {};
      (topReporters || []).forEach(r => {
        const uid = r.reported_by;
        if (!counts[uid]) counts[uid] = { ...r.users, reports: 0 };
        counts[uid].reports++;
      });
      const sorted = Object.values(counts).sort((a,b) => b.reports - a.reports).slice(0, 30);
      // If no activity in period, fall back to all-time points ranking
      if (sorted.length === 0) {
        const { data: fallback } = await supabase
          .from('users').select('id, name, avatar_url, points, streak')
          .eq('is_deleted', 0).order('points', { ascending: false }).limit(30);
        return res.json((fallback || []).map(u => ({ ...u, reports: 0, period_fallback: true })));
      }
      return res.json(sorted);
    }

    // All time: rank by points, single query
    const { data, error } = await supabase
      .from('users')
      .select('id, name, avatar_url, points, streak')
      .eq('is_deleted', 0)
      .order('points', { ascending: false })
      .limit(30);
    if (error) throw error;

    // Get report counts in one query (not N+1)
    const userIds = (data || []).map(u => u.id);
    const { data: reportCounts } = await supabase
      .from('prices')
      .select('reported_by')
      .in('reported_by', userIds);
    const countMap = {};
    (reportCounts || []).forEach(r => { countMap[r.reported_by] = (countMap[r.reported_by] || 0) + 1; });

    res.json((data || []).map(u => ({ ...u, reports: countMap[u.id] || 0 })));
  } catch(e) { fail(res, e.message, 500); }
});


// ─── DEALS (CHOLLOS) ──────────────────────────────────────────────────────────
app.get('/api/deals', optAuth, async (req, res) => {
  try {
    const { cat='all', sort='hot', search, limit=20, offset=0, min_price, max_price, min_discount } = req.query;
    const now = new Date().toISOString();

    let q = supabase.from('deals')
      .select('*, users(id,name,avatar_url)')
      .eq('is_active', 1);
    try { q = q.or(`expires_at.is.null,expires_at.gt.${now}`); } catch {}

    if (cat && cat !== 'all') q = q.eq('category', cat);
    if (search) q = q.ilike('title', `%${search}%`);
    if (min_price) q = q.gte('deal_price', parseFloat(min_price));
    if (max_price) q = q.lte('deal_price', parseFloat(max_price));
    if (min_discount) q = q.gte('discount_percent', parseFloat(min_discount));

    // Hot score: votes_up - votes_down weighted by recency
    // Sort in Supabase, compute hot_score client-side after
    if (sort === 'hot' || sort === 'temp')
      q = q.order('votes_up', { ascending: false }).order('detected_at', { ascending: false });
    else if (sort === 'new')
      q = q.order('detected_at', { ascending: false });
    else if (sort === 'top')
      q = q.order('votes_up', { ascending: false });
    else if (sort === 'price')
      q = q.order('deal_price', { ascending: true, nullsFirst: false });

    q = q.range(parseInt(offset), parseInt(offset)+parseInt(limit)-1);
    const { data, error } = await q;
    if (error) throw error;

    // Compute temperature for each deal
    const deals = (data || []).map(d => {
      const ageHours = (Date.now() - new Date(d.detected_at)) / 3600000;
      const score = (d.votes_up||0) - (d.votes_down||0);
      const decayedScore = score / Math.pow(ageHours + 2, 1.5); // gravity decay like HN
      let temp, tempColor;
      if (score >= 20 || decayedScore > 3)      { temp='🔥🔥🔥'; tempColor='#DC2626'; }
      else if (score >= 10 || decayedScore > 1.5){ temp='🔥🔥';  tempColor='#EA580C'; }
      else if (score >= 3  || decayedScore > 0.5){ temp='🔥';    tempColor='#D97706'; }
      else if (score >= 0)                        { temp='😐';    tempColor='#6B7280'; }
      else                                        { temp='🧊';    tempColor='#3B82F6'; }
      return { ...d, hot_score: decayedScore, temperature: temp, temp_color: tempColor };
    });

    // Re-sort by hot_score if 'hot'
    if (sort === 'hot') deals.sort((a,b) => b.hot_score - a.hot_score);

    res.set('X-Total-Count', deals.length);
    res.json(deals);
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/deals', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, url: rawUrl, deal_price, original_price, store, category } = req.body;
    if (!title || !deal_price) return fail(res, 'Título y precio son obligatorios');
    // Silently replace any affiliate tag with ours — user never knows
    const url = rawUrl ? applyOurTag(rawUrl) : null;
    const autoStore = store || detectStore(rawUrl) || null;
    let image_url = null;
    if (req.file) {
      try {
        const buf = fs.readFileSync(req.file.path);
        const ext = req.file.originalname.split('.').pop();
        const p = `deals/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('precimap').upload(p, buf, { contentType: req.file.mimetype });
        if (!upErr) {
          const { data: { publicUrl } } = supabase.storage.from('precimap').getPublicUrl(p);
          image_url = publicUrl;
          fs.unlinkSync(req.file.path);
        }
      } catch { image_url = `/public/uploads/${req.file.filename}`; }
    }
    if (!image_url && req.body.image_base64) {
      const buf = Buffer.from(req.body.image_base64, 'base64');
      const filename = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(uploadDir, filename), buf);
      image_url = `/public/uploads/${filename}`;
    }
    const disc = original_price && deal_price ? Math.round((1 - deal_price/original_price)*100) : null;
    // Auto-expire deals after 30 days
    const expires = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    const deal = await db.insert('deals', {
      title: title.trim(), url: url||null, deal_price: parseFloat(deal_price),
      original_price: original_price ? parseFloat(original_price) : null,
      discount_percent: disc, store: autoStore, category: category||'otros',
      image_url, reported_by: req.user.id, is_active: 1, expires_at: expires,
    });
    await addPoints(req.user.id, 5, 'publicar chollo');
    await checkBadges(req.user.id);
    res.json(deal);
  } catch(e) { fail(res, e.message); }
});

app.post('/api/deals/:id/vote', auth, async (req, res) => {
  try {
    const { vote } = req.body; // 1 = hot, -1 = cold
    const dealId = parseId(req.params.id);
    if (!dealId) return fail(res, "ID inválido", 400);
    // Check if already voted
    const existing = await db.query('deal_votes', { eq: { deal_id: dealId, user_id: req.user.id }, single: true }).catch(()=>null);
    if (existing) {
      if (existing.vote === vote) { // undo vote
        await db.delete('deal_votes', existing.id);
        await supabase.from('deals').update({ votes_up: supabase.rpc ? undefined : 0 }).eq('id', dealId);
        await supabase.rpc('deal_vote_adjust', { did: dealId, delta: -vote });
      } else { // change vote
        await db.update('deal_votes', existing.id, { vote });
        await supabase.rpc('deal_vote_adjust', { did: dealId, delta: vote*2 });
      }
    } else {
      await db.insert('deal_votes', { deal_id: dealId, user_id: req.user.id, vote });
      await supabase.rpc('deal_vote_adjust', { did: dealId, delta: vote });
      if (vote === 1) await addPoints(req.user.id, 2, 'votar chollo');
    }
    const deal = await db.query('deals', { eq: { id: dealId }, select: 'votes_up,votes_down', single: true });
    res.json({ ok: true, ...deal });
  } catch(e) { fail(res, e.message); }
});

app.delete('/api/deals/:id', auth, async (req, res) => {
  try {
    const deal = await db.query('deals', { eq: { id: req.params.id }, single: true });
    if (!deal) return fail(res, 'No encontrado', 404);
    if (deal.reported_by !== req.user.id) return fail(res, 'Sin permiso', 403);
    await db.update('deals', deal.id, { is_active: 0 });
    res.json({ ok: true });
  } catch(e) { fail(res, e.message); }
});

// Edit deal (owner only — title and price)
app.post('/api/deals/:id/edit', auth, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 'ID inválido');
    const deal = await db.query('deals', { eq: { id }, single: true });
    if (!deal) return fail(res, 'No encontrado', 404);
    if (deal.reported_by !== req.user.id) return fail(res, 'Sin permiso', 403);
    const { title, deal_price } = req.body;
    if (!title?.trim()) return fail(res, 'Título obligatorio');
    if (!deal_price || isNaN(parseFloat(deal_price))) return fail(res, 'Precio inválido');
    const updated = await db.update('deals', id, {
      title: title.trim(),
      deal_price: parseFloat(deal_price),
    });
    res.json(updated);
  } catch(e) { fail(res, e.message); }
});


// ─── COMMENTS (threaded) ──────────────────────────────────────────────────────
// Deal detail
app.get('/api/deals/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return fail(res, 'Invalid id', 400);
    const { data, error } = await supabase
      .from('deals')
      .select('*, users(id,name,avatar_url)')
      .eq('id', id)
      .eq('is_active', 1)
      .single();
    if (error || !data) return fail(res, 'Deal not found', 404);
    res.json(data);
  } catch(e) { fail(res, e.message, 500); }
});

app.get('/api/deals/:id/comments', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('deal_comments')
      .select('*, users(id,name,avatar_url)')
      .eq('deal_id', req.params.id)
      .eq('is_deleted', 0)
      .order('created_at', { ascending: true });
    if (error) throw error;
    // Build tree
    const flat = data || [];
    const map = {}, roots = [];
    flat.forEach(c => { map[c.id] = { ...c, replies: [] }; });
    flat.forEach(c => {
      if (c.parent_id && map[c.parent_id]) map[c.parent_id].replies.push(map[c.id]);
      else roots.push(map[c.id]);
    });
    res.json(roots);
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/deals/:id/comments', auth, async (req, res) => {
  try {
    const { text, parent_id } = req.body;
    if (!text?.trim()) return fail(res, 'El comentario no puede estar vacío');
    const comment = await db.insert('deal_comments', {
      deal_id: parseId(req.params.id), user_id: req.user.id,
      parent_id: parent_id || null, text: text.trim(), votes_up: 0,
    });
    await addPoints(req.user.id, 1, 'comentar');
    // Notify deal author
    const deal = await db.query('deals', { eq: { id: req.params.id }, select: 'reported_by,title', single: true });
    if (deal && deal.reported_by !== req.user.id) {
      await db.insert('notifications', { user_id: deal.reported_by, type: 'comment', message: `💬 ${req.user.name} comentó en tu chollo "${deal.title.slice(0,30)}"` });
    }
    const full = await supabase.from('deal_comments').select('*, users(id,name,avatar_url)').eq('id', comment.id).single();
    res.json(full.data);
  } catch(e) { fail(res, e.message); }
});

app.post('/api/comments/:id/vote', auth, async (req, res) => {
  try {
    await supabase.rpc('comment_vote_up', { cid: parseId(req.params.id) });
    res.json({ ok: true });
  } catch(e) { fail(res, e.message); }
});

app.delete('/api/comments/:id', auth, async (req, res) => {
  try {
    const c = await db.query('deal_comments', { eq: { id: req.params.id }, single: true });
    if (!c || c.user_id !== req.user.id) return fail(res, 'Sin permiso', 403);
    await db.update('deal_comments', c.id, { is_deleted: 1, text: '[eliminado]' });
    res.json({ ok: true });
  } catch(e) { fail(res, e.message); }
});

// ─── PLACES ───────────────────────────────────────────────────────────────────
const SPAIN_PROVINCES = ['Álava','Albacete','Alicante','Almería','Asturias','Ávila','Badajoz','Barcelona','Burgos','Cáceres','Cádiz','Cantabria','Castellón','Ciudad Real','Córdoba','Cuenca','Gerona','Granada','Guadalajara','Guipúzcoa','Huelva','Huesca','Islas Baleares','Jaén','La Coruña','La Rioja','Las Palmas','León','Lleida','Lugo','Madrid','Málaga','Murcia','Navarra','Orense','Palencia','Pontevedra','Salamanca','Santa Cruz de Tenerife','Segovia','Sevilla','Soria','Tarragona','Teruel','Toledo','Valencia','Valladolid','Vizcaya','Zamora','Zaragoza','Ceuta','Melilla'];
const SPAIN_REGIONS  = ['Andalucía','Aragón','Asturias','Canarias','Cantabria','Castilla-La Mancha','Castilla y León','Cataluña','Comunidad Valenciana','Extremadura','Galicia','La Rioja','Madrid','Murcia','Navarra','País Vasco','Baleares'];
const SPAIN_CITIES   = ['Madrid','Barcelona','Valencia','Sevilla','Zaragoza','Málaga','Murcia','Palma','Las Palmas','Bilbao','Alicante','Córdoba','Valladolid','Vigo','Gijón','Granada','A Coruña','Vitoria','Elche','Santa Cruz de Tenerife','Badalona','Oviedo','Sabadell','Cartagena','Terrassa','Jerez de la Frontera','Pamplona','Almería','Getafe','Logroño','Hospitalet','San Sebastián','Burgos','Castellón','Albacete','Santander','Alcalá de Henares','Jaén','Badajoz','Huelva','Marbella','León','Tarragona','Salamanca','Lleida','Dos Hermanas','Torrevieja','Mataró','Reus','Cádiz','Lugo','Ourense','Girona','Cáceres','Melilla','Ceuta','Villafranca de Córdoba','Montilla','Lucena','Cabra','Puente Genil','Priego de Córdoba','Pozoblanco'];

app.get('/api/cities', async (req, res) => {
  try {
    const { q } = req.query;
    const nq = normalize(q);
    const { data: dbCities } = await supabase.from('places').select('city').not('city', 'is', null).limit(100);
    const { data: evCities } = await supabase.from('events').select('city').not('city', 'is', null).limit(50);
    const all = [...new Set([...(dbCities||[]).map(r=>r.city), ...(evCities||[]).map(r=>r.city), ...SPAIN_CITIES])].filter(Boolean).sort();
    const allProvs = [...new Set([...SPAIN_PROVINCES, ...SPAIN_REGIONS])].sort();
    const cities   = nq ? all.filter(c => normalize(c).includes(nq)) : all;
    const provinces= nq ? allProvs.filter(p => normalize(p).includes(nq)) : allProvs;
    res.json({ cities: cities.slice(0,40), provinces: provinces.slice(0,20) });
  } catch(e) { fail(res, e.message, 500); }
});


// Price history for a place
app.get('/api/places/:id/price-history', async (req, res) => {
  try {
    const placeId = parseInt(req.params.id);
    if (!placeId) return fail(res, 'Invalid place id', 400);
    const { product, limit = 30 } = req.query;
    let q = supabase.from('price_history')
      .select('*')
      .eq('place_id', placeId)
      .order('reported_at', { ascending: true })
      .limit(parseInt(limit));
    if (product) q = q.eq('product', product);
    const { data, error } = await q;
    if (error) throw error;
    // Group by product
    const byProduct = {};
    (data||[]).forEach(r => {
      if (!byProduct[r.product]) byProduct[r.product] = [];
      byProduct[r.product].push({ date: r.reported_at?.split('T')[0], price: r.price });
    });
    res.json({ place_id: placeId, history: byProduct, total: data?.length || 0 });
  } catch(e) { fail(res, e.message, 500); }
});

app.get('/api/places', optAuth, async (req, res) => {
  try {
    const { cat, lat, lng, radius, city, product, sort='proximity' } = req.query;
    let q = supabase.from('places').select('*').eq('is_active', 1);
    if (cat && cat!=='all') q = q.eq('category', cat);
    const hasCity = city && city.trim() !== '';
    if (hasCity) q = q.or(`address.ilike.%${city}%,city.ilike.%${city}%`);
    const { data: places, error } = await q.limit(500);
    if (error) throw error;
    let list = places || [];
    // Radius filter only if no city and radius < 500
    const r = parseFloat(radius);
    if (lat && lng && !hasCity && r && r < 500) {
      const uLat = parseFloat(lat), uLng = parseFloat(lng);
      list = list.filter(p => { p._dist = calcDist(uLat, uLng, p.lat, p.lng); return p._dist <= r; });
    } else if (lat && lng) {
      list.forEach(p => p._dist = calcDist(parseFloat(lat), parseFloat(lng), p.lat, p.lng));
    } else { list.forEach(p => p._dist = 999); }
    // Attach prices — single bulk query instead of N+1
    const placeIds = list.map(p => p.id);
    let allPrices = [];
    if (placeIds.length > 0) {
      const { data: pricesData } = await supabase
        .from('prices')
        .select('*, users(id,name,avatar_url)')
        .in('place_id', placeIds)
        .eq('is_active', 1)
        .order('price', { ascending: true });
      allPrices = pricesData || [];
    }
    // Group prices by place_id
    const pricesByPlace = {};
    allPrices.forEach(p => {
      if (!pricesByPlace[p.place_id]) pricesByPlace[p.place_id] = [];
      pricesByPlace[p.place_id].push(p);
    });
    const result = list.map(place => {
      let prices = (pricesByPlace[place.id] || []).slice(0, 10);
      if (product) prices = prices.filter(p => fuzzyMatch(product, p.product));
      if (product && prices.length === 0) return null;
      const minPrice = prices.length ? Math.min(...prices.map(p => p.price)) : null;
      return { ...place, prices, minPrice };
    });
    const filtered = result.filter(Boolean);
    if (sort==='price') filtered.sort((a,b)=>(a.minPrice??999)-(b.minPrice??999));
    else filtered.sort((a,b)=>(a._dist||999)-(b._dist||999));
    res.json(filtered.slice(0,200));
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/places', auth, async (req, res) => {
  try {
    const { name, category, lat, lng, address, city } = req.body;
    if (!name||!category||!lat||!lng) return fail(res, 'Faltan campos obligatorios');
    const place = await db.insert('places', { name, category, lat: parseFloat(lat), lng: parseFloat(lng), address: address||'', city: city||'', created_by: req.user.id, is_active: 1 });
    await addPoints(req.user.id, 5, 'añadir lugar');
    res.json(place);
  } catch(e) { fail(res, e.message); }
});

// ─── PRICES ───────────────────────────────────────────────────────────────────
app.post('/api/prices', auth, upload.single('photo'), async (req, res) => {
  try {
    const { place_id, product, price, unit } = req.body;
    if (!place_id||!product||!price) return fail(res, 'Faltan campos');
    let photo_url = null;
    if (req.file) {
      try {
        const buf = fs.readFileSync(req.file.path);
        const ext = req.file.originalname.split('.').pop();
        const p = `prices/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('precimap').upload(p, buf, { contentType: req.file.mimetype });
        if (!upErr) { const { data: { publicUrl } } = supabase.storage.from('precimap').getPublicUrl(p); photo_url = publicUrl; fs.unlinkSync(req.file.path); }
      } catch { photo_url = `/public/uploads/${req.file.filename}`; }
    }
    // Deactivate old price for same product+place
    await supabase.from('prices').update({ is_active: 0 }).eq('place_id', parseInt(place_id)).eq('product', product).eq('reported_by', req.user.id);
    const priceRow = await db.insert('prices', { place_id: parseInt(place_id), product: product.trim(), price: parseFloat(price), unit: unit||'unidad', reported_by: req.user.id, photo_url, status: 'pending', votes_up: 0, votes_down: 0, is_active: 1 });
    // Save to price_history
    await db.insert('price_history', { place_id: parseInt(place_id), product: product.trim(), price: parseFloat(price) });
    await addPoints(req.user.id, 10, 'reportar precio');
    await checkBadges(req.user.id);
    res.json(priceRow);
  } catch(e) { fail(res, e.message); }
});

app.post('/api/prices/:id/vote', auth, async (req, res) => {
  try {
    const { vote } = req.body;
    const pid = parseId(req.params.id);
    if (!pid) return fail(res, "ID inválido", 400);
    await supabase.rpc('price_vote_adjust', { pid, delta: vote });
    const p = await db.query('prices', { eq: { id: pid }, select: 'votes_up,votes_down,reported_by', single: true });
    if (p && vote === 1 && p.votes_up >= 3 && p.reported_by !== req.user.id) {
      await addPoints(p.reported_by, 5, 'precio verificado');
      await supabase.from('prices').update({ status: 'verified' }).eq('id', pid);
    }
    await addPoints(req.user.id, 1, 'votar precio');
    res.json({ ok: true, votes_up: p?.votes_up, votes_down: p?.votes_down });
  } catch(e) { fail(res, e.message); }
});


// ─── GASOLINERAS (Ministerio de Energía) — with 10-min cache ─────────────────
let _gasCache = null;
let _gasCacheTime = 0;
const GAS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
let _gasFetching = false;

async function fetchAllStations() {
  if (_gasFetching) {
    // Wait for ongoing fetch
    await new Promise(r => setTimeout(r, 500));
    return _gasCache || [];
  }
  _gasFetching = true;
  try {
    console.log('⛽ Fetching gasolineras from Ministerio...');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000); // 50s timeout
    const response = await fetch(
      'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/',
      { headers: { 'Accept': 'application/json' }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    const stations = (raw.ListaEESSPrecio || []).map(s => {
      const lat = parseFloat((s['Latitud'] || '').replace(',','.'));
      const lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',','.'));
      if (isNaN(lat) || isNaN(lng)) return null;
      const p = (key) => {
        const v = s[key];
        if (!v || v.trim() === '') return null;
        const n = parseFloat(v.replace(',','.'));
        return isNaN(n) || n <= 0 ? null : n;
      };
      return {
        id:       s['IDEESS'],
        name:     s['Rótulo'],
        address:  s['Dirección'],
        city:     s['Municipio'],
        province: s['Provincia'],
        lat, lng,
        schedule: s['Horario'],
        prices: {
          g95:         p('Precio Gasolina 95 E5'),
          g98:         p('Precio Gasolina 98 E5'),
          diesel:      p('Precio Gasoleo A'),
          diesel_plus: p('Precio Gasoleo Premium'),
          glp:         p('Precio Gases licuados del petróleo'),
          gnc:         p('Precio Gas Natural Comprimido'),
        }
      };
    }).filter(Boolean);
    _gasCache = stations;
    _gasCacheTime = Date.now();
    console.log(`✅ ${stations.length} gasolineras cacheadas`);
    return stations;
  } catch(e) {
    console.log('⚠️ Gasolineras fetch error:', e.message);
    return _gasCache || [];
  } finally {
    _gasFetching = false;
  }
}

// Pre-warm cache on startup
setTimeout(() => fetchAllStations().catch(() => {}), 3000);
// Refresh every 10 minutes
setInterval(() => fetchAllStations().catch(() => {}), GAS_CACHE_TTL);

// Gas station stats — min/avg/max per fuel type from cache
app.get('/api/gasolineras/stats', async (req, res) => {
  try {
    const stations = _gasCache || await fetchAllStations();
    const fuels = ['g95','g98','diesel','diesel_plus','glp','gnc'];
    const stats = {};
    fuels.forEach(key => {
      const prices = stations.map(s => s.prices?.[key]).filter(p => p > 0 && !isNaN(p));
      if (!prices.length) return;
      prices.sort((a,b) => a-b);
      stats[key] = {
        min:   +prices[0].toFixed(3),
        max:   +prices[prices.length-1].toFixed(3),
        avg:   +(prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(3),
        count: prices.length,
        cheapest: stations.filter(s=>s.prices?.[key]===prices[0]).slice(0,3).map(s=>({name:s.name,city:s.city,price:s.prices[key]})),
      };
    });
    res.json({ stats, total: stations.length, updated: new Date(_gasCacheTime).toISOString() });
  } catch(e) { fail(res, e.message, 500); }
});

app.get('/api/gasolineras', async (req, res) => {
  try {
    const { lat, lng, radius, city, fuel = 'g95' } = req.query;
    const FUEL_KEY = { g95:'g95', g98:'g98', diesel:'diesel', diesel_plus:'diesel_plus', glp:'glp', gnc:'gnc' };
    const fuelKey = FUEL_KEY[fuel] || 'g95';

    // Use cache if fresh, else fetch (with old cache as fallback)
    let stations;
    if (_gasCache && Date.now() - _gasCacheTime < GAS_CACHE_TTL) {
      stations = _gasCache;
    } else {
      stations = await fetchAllStations();
    }

    // Add minPrice for selected fuel, include ALL stations (don't filter by fuel here)
    let result = stations.map(s => ({ ...s, minPrice: s.prices[fuelKey] || null }));

    // Only filter by fuel if explicitly requested (not 'all' or 'g95' default)
    // Most stations have g95, filter only if fuel specifically selected and not g95

    // Radius filter
    const r = parseFloat(radius);
    if (lat && lng && r && r < 500) {
      const uLat = parseFloat(lat), uLng = parseFloat(lng);
      result = result.filter(s => { s._dist = calcDist(uLat, uLng, s.lat, s.lng); return s._dist <= r; });
      result.sort((a,b) => (a.minPrice||999)-(b.minPrice||999));
    }

    // City filter
    if (city && city !== 'all') {
      const nc = normalize(city);
      result = result.filter(s => normalize(s.city).includes(nc) || normalize(s.province).includes(nc));
    }

    res.json(result.slice(0, 15000)); // return all for client-side caching
  } catch(e) { console.error('gasolineras route error:', e.message); res.json([]); }
});

// ─── EVENTS ───────────────────────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
  try {
    const { cat, sort='date', city, source, limit=50 } = req.query;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentHour = now.getHours();
    let q = supabase.from('events').select('*, users(id,name,avatar_url)').eq('is_active', 1).gte('date', today);
    if (cat && cat!=='all') q = q.eq('category', cat);
    if (source && source !== 'all') q = q.eq('source', source);
    if (city) q = q.or(`city.ilike.%${city}%,address.ilike.%${city}%`);
    if (sort === 'price') q = q.order('price_from', { ascending: true, nullsFirst: false });
    else q = q.order('date', { ascending: true });
    q = q.limit(parseInt(limit));
    const { data, error } = await q;
    if (error) throw error;
    // Filter out today's events that have already ended (event time + 3h buffer)
    const filtered = (data || []).filter(ev => {
      if (ev.date !== today || !ev.time) return true; // keep future days or no time
      const [h, m] = ev.time.split(':').map(Number);
      if (isNaN(h)) return true;
      return (h + 3) > currentHour; // keep if event ended less than 3h ago
    });
    res.json(filtered);
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/events', auth, async (req, res) => {
  try {
    const { title, category, date, time, venue, address, city, lat, lng, price_from, is_free, url, description } = req.body;
    if (!title||!category||!date) return fail(res, 'Título, categoría y fecha son obligatorios');
    const event = await db.insert('events', { title: title.trim(), category, date, time: time||null, venue: venue||null, address: address||null, city: city||null, lat: lat?parseFloat(lat):null, lng: lng?parseFloat(lng):null, price_from: price_from?parseFloat(price_from):null, is_free: is_free?1:0, url: url||null, description: description||null, reported_by: req.user.id, source: 'user', is_active: 1, votes_up: 0 });
    await addPoints(req.user.id, 5, 'añadir evento');
    res.json(event);
  } catch(e) { fail(res, e.message); }
});

app.post('/api/events/:id/vote', auth, async (req, res) => {
  try {
    await supabase.rpc('event_vote_up', { eid: parseId(req.params.id) });
    res.json({ ok: true });
  } catch(e) { fail(res, e.message); }
});

// ─── BANKS ───────────────────────────────────────────────────────────────────
app.get('/api/banks', async (req, res) => {
  try {
    const { type } = req.query;
    let q = supabase.from('bank_deals').select('*, users(id,name,avatar_url)').eq('is_active', 1).order('votes_up', { ascending: false });
    if (type && type!=='all') q = q.eq('product_type', type);
    const { data, error } = await q.limit(50);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/banks', auth, async (req, res) => {
  try {
    const { bank_name, product_type, title, description, interest_rate, bonus_amount, conditions, url } = req.body;
    if (!bank_name||!title||!product_type) return fail(res, 'Faltan campos');
    const deal = await db.insert('bank_deals', { bank_name, product_type, title, description: description||null, interest_rate: interest_rate?parseFloat(interest_rate):null, bonus_amount: bonus_amount?parseFloat(bonus_amount):null, conditions: conditions||null, url: url||null, reported_by: req.user.id, is_active: 1 });
    await addPoints(req.user.id, 5, 'añadir oferta bancaria');
    res.json(deal);
  } catch(e) { fail(res, e.message); }
});

app.post('/api/banks/:id/vote', auth, async (req, res) => {
  try {
    const { vote } = req.body;
    await supabase.from('bank_deals').update({ votes_up: supabase.rpc ? undefined : 0 }).eq('id', req.params.id);
    await supabase.rpc('bank_vote_adjust', { bid: parseId(req.params.id), delta: vote });
    res.json({ ok: true });
  } catch(e) { fail(res, e.message); }
});

// ─── SUPERMARKETS — OCU ranking + product prices (updated daily) ──────────────

// OCU data — update manually when new annual study published
// Source: OCU Estudio Anual Supermercados 2024 (published Nov 2024)
const SUPER_DATA = {
  source: 'OCU - Organización de Consumidores y Usuarios',
  source_url: 'https://www.ocu.org/alimentacion/supermercados/informe/comparar-supermercados',
  study: 'Estudio Anual OCU Supermercados 2024',
  last_updated: '2024-11-15',
  note: 'Basado en la cesta de 140 productos de consumo habitual. Índice 100 = Mercadona (referencia). Los precios varían por zona geográfica.',
  ranking: [
    { pos:1,  name:'Mercadona',       price_index:100, savings_vs_expensive:'-22%', quality:'Alta',       emoji:'🟢', logo_color:'#009869', available:'Nacional',   tip:'Mejor marca blanca en limpieza (Bosque Verde) e higiene. Referencia de precio.' },
    { pos:2,  name:'Alcampo',         price_index:96,  savings_vs_expensive:'-25%', quality:'Alta',       emoji:'🟢', logo_color:'#E2231A', available:'Nacional',   tip:'4% más barato que Mercadona. Imbatible en bebidas y droguería.' },
    { pos:3,  name:'Lidl',            price_index:93,  savings_vs_expensive:'-27%', quality:'Alta',       emoji:'🟢', logo_color:'#0050AA', available:'Nacional',   tip:'7% más barato. Campeón absoluto en frutas, verduras y carne fresca.' },
    { pos:4,  name:'Aldi',            price_index:91,  savings_vs_expensive:'-29%', quality:'Media-Alta', emoji:'🟢', logo_color:'#00A0E2', available:'Nacional',   tip:'El más barato. Marca propia sin rival. Ideal para básicos.' },
    { pos:5,  name:'Día',             price_index:95,  savings_vs_expensive:'-26%', quality:'Media',      emoji:'🟡', logo_color:'#E2001A', available:'Nacional',   tip:'5% más barato pero calidad inferior en frescos. Bueno para enlatados.' },
    { pos:6,  name:'Carrefour',       price_index:103, savings_vs_expensive:'-19%', quality:'Alta',       emoji:'🟡', logo_color:'#004A97', available:'Nacional',   tip:'3% más caro. Gran variedad. Mejor en productos internacionales.' },
    { pos:7,  name:'Eroski',          price_index:107, savings_vs_expensive:'-16%', quality:'Alta',       emoji:'🟡', logo_color:'#E2001A', available:'Norte/Este', tip:'7% más caro. Fuerte en País Vasco y Navarra. Calidad muy buena.' },
    { pos:8,  name:'Consum',          price_index:108, savings_vs_expensive:'-15%', quality:'Alta',       emoji:'🟡', logo_color:'#E2001A', available:'Valenciana', tip:'8% más caro. Referente en Comunidad Valenciana y Murcia.' },
    { pos:9,  name:'Supercor/Spar',   price_index:115, savings_vs_expensive:'-10%', quality:'Alta',       emoji:'🔴', logo_color:'#003087', available:'Nacional',   tip:'15% más caro. Ventaja: ubicación urbana y horario extendido.' },
    { pos:10, name:'El Corte Inglés', price_index:122, savings_vs_expensive:'-5%',  quality:'Muy Alta',   emoji:'🔴', logo_color:'#006633', available:'Nacional',   tip:'22% más caro. Premium. Calidad y servicio superiores.' },
  ],
  // Price comparison for common products (avg Spain, Oct 2024)
  products: [
    { name:'Leche entera 1L',        best:'Aldi',      best_price:0.65, mercadona:0.72, lidl:0.67, carrefour:0.85 },
    { name:'Aceite oliva virgen 1L',  best:'Lidl',      best_price:4.99, mercadona:5.49, lidl:4.99, carrefour:5.79 },
    { name:'Pasta espaguetis 500g',   best:'Aldi',      best_price:0.39, mercadona:0.55, lidl:0.45, carrefour:0.65 },
    { name:'Arroz 1kg',               best:'Aldi',      best_price:0.69, mercadona:0.85, lidl:0.72, carrefour:0.99 },
    { name:'Pechuga pollo 1kg',       best:'Lidl',      best_price:4.49, mercadona:5.20, lidl:4.49, carrefour:5.89 },
    { name:'Pan molde 450g',          best:'Aldi',      best_price:0.79, mercadona:0.95, lidl:0.85, carrefour:1.15 },
    { name:'Yogur natural x8',        best:'Aldi',      best_price:0.99, mercadona:1.25, lidl:1.05, carrefour:1.45 },
    { name:'Detergente 40 lavados',   best:'Mercadona', best_price:3.95, mercadona:3.95, lidl:4.29, carrefour:5.99 },
    { name:'Agua mineral 6x1.5L',     best:'Alcampo',   best_price:1.59, mercadona:1.99, lidl:1.69, carrefour:2.29 },
    { name:'Fruta (cesta 2kg mix)',   best:'Lidl',      best_price:2.99, mercadona:3.50, lidl:2.99, carrefour:3.99 },
  ],
  by_category: {
    frescos:      { winner:'Lidl',      runner_up:'Mercadona', note:'Mejor precio en frutas, verduras y carne' },
    marca_blanca: { winner:'Aldi',      runner_up:'Lidl',      note:'Marca propia más barata de España' },
    bebidas:      { winner:'Alcampo',   runner_up:'Aldi',      note:'Mejor precio en agua, refrescos y zumos' },
    limpieza:     { winner:'Mercadona', runner_up:'Aldi',      note:'Mejor relación calidad/precio con Bosque Verde' },
    higiene:      { winner:'Mercadona', runner_up:'Alcampo',   note:'Mejor marca blanca de higiene personal' },
    pescado:      { winner:'Mercadona', runner_up:'Lidl',      note:'Mejor precio y calidad en pescadería' },
    lacteos:      { winner:'Aldi',      runner_up:'Lidl',      note:'Leche y yogures más baratos' },
  },
  tips: [
    { emoji:'💡', title:'Compra marca blanca de Lidl o Aldi', desc:'En básicos como leche, pasta, arroz o aceite el ahorro puede ser del 40-60% sin diferencia de calidad.' },
    { emoji:'🥦', title:'Frescos en Lidl, secos en Aldi',    desc:'Lidl gana en frutas y carne. Aldi gana en pasta, arroz y conservas. Combínalos.' },
    { emoji:'🧹', title:'Limpieza en Mercadona',              desc:'Bosque Verde (Mercadona) es la mejor marca blanca de limpieza. Más barato que las marcas.' },
    { emoji:'🔄', title:'Alterna supermercados por sección',  desc:'La compra mixta puede ahorrar un 20-25% respecto a comprar todo en uno.' },
    { emoji:'📱', title:'Usa las apps de descuentos',         desc:'Lidl Plus, Alcampo app y Carrefour app ofrecen descuentos exclusivos cada semana.' },
  ]
};

app.get('/api/supermarkets/ranking', (req, res) => { res.json(SUPER_DATA); });

// Supermarket places for the MAP — static well-known chains
app.get('/api/supermarkets/places', (req, res) => {
  const { lat, lng, radius = 25 } = req.query;
  // Return the OCU ranking so the app knows which chains are cheapest
  // Real location data comes from user-reported places in /api/places with category=supermercado
  res.json({
    ranking_summary: SUPER_DATA.ranking.slice(0, 5).map(r => ({
      name: r.name, price_index: r.price_index, emoji: r.emoji, tip: r.tip
    })),
    message: 'Busca supermercados en el mapa con el filtro "Súper". Los marcadores muestran el índice de precio OCU.'
  });
});

// ─── PRICE ALERTS ─────────────────────────────────────────────────────────────
app.get('/api/alerts', auth, async (req, res) => {
  try {
    const alerts = await db.query('price_alerts', { eq: { user_id: req.user.id, is_active: 1 } });
    res.json(alerts || []);
  } catch(e) { fail(res, e.message, 500); }
});
app.post('/api/alerts', auth, async (req, res) => {
  try {
    const { place_id, product, target_price } = req.body;
    if (!product) return fail(res, 'Producto requerido');
    const alert = await db.insert('price_alerts', { user_id: req.user.id, place_id: place_id||null, product, target_price: target_price?parseFloat(target_price):null, is_active: 1 });
    res.json(alert);
  } catch(e) { fail(res, e.message); }
});
app.delete('/api/alerts/:id', auth, async (req, res) => {
  try { await db.update('price_alerts', req.params.id, { is_active: 0 }); res.json({ ok: true }); }
  catch(e) { fail(res, e.message); }
});

// ─── FAVORITES ────────────────────────────────────────────────────────────────
app.post('/api/favorites/:placeId', auth, async (req, res) => {
  try {
    const existing = await db.query('favorites', { eq: { user_id: req.user.id, place_id: req.params.placeId }, single: true }).catch(()=>null);
    if (existing) { await db.delete('favorites', existing.id); return res.json({ ok: true, favorited: false }); }
    await db.insert('favorites', { user_id: req.user.id, place_id: parseInt(req.params.placeId) });
    res.json({ ok: true, favorited: true });
  } catch(e) { fail(res, e.message); }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🗺️  PreciMap v3.1.0 en http://localhost:${PORT}`);
  console.log(`🔗 Amazon afiliado: ${process.env.AMAZON_AFFILIATE_TAG}`);
  console.log(`🗄️  Base de datos: Supabase (${process.env.SUPABASE_URL ? '✅ Connected' : '❌ No URL'})\n`);
});


// ─── SERVICES (Luz, Agua, Gas, Internet, Seguro, Coche) ───────────────────────
// Static curated data + community-reported offers

const CURATED_SERVICES = {
  luz: [
    { provider:'Octopus Energy', tariff:'Tarifa Variable', price_kwh:0.12, monthly_fee:0, bonus:'50€ bienvenida', rating:4.8, url:'https://octopus.energy/es/', highlight:'La más barata 2024 según FACUA', badge:'⭐ MEJOR PRECIO' },
    { provider:'Holaluz',       tariff:'Tarifa 100% Verde', price_kwh:0.13, monthly_fee:0, bonus:'1 mes gratis', rating:4.6, url:'https://www.holaluz.com/', highlight:'100% renovable, sin permanencia', badge:'🌿 ECO' },
    { provider:'Iberdrola',     tariff:'One Luz',           price_kwh:0.14, monthly_fee:3, bonus:null, rating:4.2, url:'https://www.iberdrola.es/', highlight:'La más contratada de España', badge:null },
    { provider:'Endesa',        tariff:'One Luz Smart',     price_kwh:0.145,monthly_fee:3, bonus:'100€ bienvenida con domótica', rating:4.1, url:'https://www.endesa.com/', highlight:'App inteligente para controlar consumo', badge:null },
    { provider:'Repsol Luz',    tariff:'Repsol Fácil',      price_kwh:0.13, monthly_fee:0, bonus:'50€ en gasolina', rating:4.3, url:'https://www.repsolluzygas.com/', highlight:'Bonus gasolina si tienes coche Repsol', badge:'⛽ COMBO' },
  ],
  gas: [
    { provider:'Naturgy',   tariff:'Tarifa Gas Natural',  price_kwh:0.07, monthly_fee:6,  bonus:null, rating:4.0, url:'https://www.naturgy.es/', highlight:'Precio estable, sin sorpresas' },
    { provider:'Repsol Gas',tariff:'Repsol Gas Fácil',    price_kwh:0.068,monthly_fee:5,  bonus:'30€ bienvenida', rating:4.2, url:'https://www.repsolluzygas.com/', highlight:'Mejor precio kWh gas 2024' },
    { provider:'Endesa Gas',tariff:'One Gas',             price_kwh:0.072,monthly_fee:5,  bonus:null, rating:4.1, url:'https://www.endesa.com/', highlight:'Combinable con luz para descuento' },
  ],
  internet: [
    { provider:'Digi',      tariff:'Fibra 1Gb',    price_month:20,  permanencia:0,  download_mb:1000, bonus:null, rating:4.7, url:'https://www.digimobil.es/', highlight:'La más barata de España, sin permanencia', badge:'💥 CHOLLO' },
    { provider:'MásMóvil',  tariff:'Fibra 600Mb',  price_month:25,  permanencia:0,  download_mb:600,  bonus:'2 meses gratis', rating:4.4, url:'https://www.masmovil.es/', highlight:'Sin permanencia, buena cobertura' },
    { provider:'Movistar',  tariff:'Fusión 1Gb',   price_month:45,  permanencia:12, download_mb:1000, bonus:'TV incluida', rating:4.0, url:'https://www.movistar.es/', highlight:'Mejor cobertura y soporte técnico' },
    { provider:'Vodafone',  tariff:'Fibra 600Mb',  price_month:38,  permanencia:12, download_mb:600,  bonus:'60€ descuento primer año', rating:4.1, url:'https://www.vodafone.es/', highlight:'Buena combinación móvil+fibra' },
    { provider:'Orange',    tariff:'Love Total 1Gb',price_month:40, permanencia:12, download_mb:1000, bonus:'Amazon Prime incluido', rating:4.0, url:'https://www.orange.es/', highlight:'Amazon Prime gratis 12 meses' },
  ],
  seguro_coche: [
    { provider:'Mutua Madrileña', tariff:'Auto Cero',    price_year:350,  type:'Todo riesgo', rating:4.6, url:'https://www.mutua.es/', highlight:'Mejor valorado en España', badge:'⭐ TOP' },
    { provider:'Línea Directa',   tariff:'Cero Km',      price_year:320,  type:'Todo riesgo', rating:4.5, url:'https://www.lineadirecta.com/', highlight:'Sin franquicia, precio fijo', badge:'🏆 RECOMENDADO' },
    { provider:'Rastreator',      tariff:'Comparador',   price_year:null, type:'Comparador', rating:4.7, url:'https://www.rastreator.com/seguros-de-coche.aspx', highlight:'Compara 40+ aseguradoras al instante', badge:'🔍 COMPARAR' },
    { provider:'Axa',             tariff:'Auto Todo Riesgo', price_year:380, type:'Todo riesgo', rating:4.3, url:'https://www.axa.es/', highlight:'Asistencia en carretera 24h incluida' },
  ],
  seguro_hogar: [
    { provider:'Mutua Madrileña', tariff:'Hogar Cero',   price_year:180, rating:4.6, url:'https://www.mutua.es/', highlight:'El más contratado de España' },
    { provider:'Mapfre',         tariff:'Hogar Plus',    price_year:200, rating:4.3, url:'https://www.mapfre.es/', highlight:'Cobertura total incluyendo robo' },
    { provider:'Rastreator',     tariff:'Comparador',    price_year:null, rating:4.7, url:'https://www.rastreator.com/seguros-de-hogar.aspx', highlight:'Compara 30+ compañías' },
  ],
  coche_ocasion: [
    { provider:'Wallapop',    tariff:null, url:'https://es.wallapop.com/coches', highlight:'El marketplace más usado en España', badge:'📱 POPULAR' },
    { provider:'Milanuncios', tariff:null, url:'https://www.milanuncios.com/coches/', highlight:'Gran variedad de particulares' },
    { provider:'Coches.net',  tariff:null, url:'https://www.coches.net/', highlight:'El más completo: nuevo y ocasión', badge:'🔍 COMPLETO' },
    { provider:'Autoscout24', tariff:null, url:'https://www.autoscout24.es/', highlight:'Mayor marketplace europeo de coches' },
    { provider:'AutoTrader',  tariff:null, url:'https://www.autotrader.es/', highlight:'Valoraciones profesionales incluidas' },
  ],
  telefono_movil: [
    { provider:'Digi',      tariff:'30GB',  price_month:5,  gb:30,  calls:'Ilimitadas', rating:4.7, url:'https://www.digimobil.es/', highlight:'Lo más barato del mercado', badge:'💥 CHOLLO' },
    { provider:'Yoigo',     tariff:'10GB',  price_month:8,  gb:10,  calls:'Ilimitadas', rating:4.4, url:'https://www.yoigo.com/', highlight:'Sin permanencia, portabilidad fácil' },
    { provider:'Simyo',     tariff:'20GB',  price_month:9,  gb:20,  calls:'Ilimitadas', rating:4.5, url:'https://www.simyo.es/', highlight:'Siempre entre las más baratas de España' },
    { provider:'Movistar',  tariff:'50GB',  price_month:20, gb:50,  calls:'Ilimitadas', rating:4.2, url:'https://www.movistar.es/', highlight:'Mejor cobertura 5G de España' },
  ],
};

app.get('/api/services', (req, res) => {
  const { type } = req.query;
  if (type && CURATED_SERVICES[type]) return res.json({ type, curated: CURATED_SERVICES[type], community: [] });
  // Return all categories with summary
  const summary = Object.entries(CURATED_SERVICES).map(([key, items]) => ({
    key, count: items.length,
    best: items.reduce((b, i) => (!b || (i.price_month||i.price_year||i.price_kwh||0) < (b.price_month||b.price_year||b.price_kwh||0)) ? i : b, null),
  }));
  res.json({ categories: summary, all: CURATED_SERVICES });
});

// Community-reported service deals
app.get('/api/services/community', async (req, res) => {
  try {
    const { type } = req.query;
    let q = supabase.from('service_deals').select('*, users(id,name,avatar_url)').eq('is_active', 1).order('votes_up', { ascending: false });
    if (type) q = q.eq('service_type', type);
    const { data, error } = await q.limit(30);
    if (error) throw error;
    res.json(data || []);
  } catch { res.json([]); }
});

app.post('/api/services/community', auth, async (req, res) => {
  try {
    const { service_type, provider, title, price, price_unit, conditions, url, notes } = req.body;
    if (!service_type || !title) return fail(res, 'Faltan campos');
    const deal = await db.insert('service_deals', {
      service_type, provider: provider||null, title, price: price?parseFloat(price):null,
      price_unit: price_unit||null, conditions: conditions||null,
      url: url ? applyOurTag(url) : null,
      notes: notes||null, reported_by: req.user.id, is_active: 1, votes_up: 0,
    });
    await addPoints(req.user.id, 5, 'añadir oferta de servicio');
    res.json(deal);
  } catch(e) { fail(res, e.message); }
});

app.post('/api/services/community/:id/vote', auth, async (req, res) => {
  try {
    await supabase.rpc('service_vote_up', { sid: parseId(req.params.id) });
    res.json({ ok: true });
  } catch(e) { fail(res, e.message); }
});

