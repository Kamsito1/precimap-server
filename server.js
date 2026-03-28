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

// ─── ADMIN CONFIG ────────────────────────────────────────────────────────────
const ADMIN_EMAILS = ['sitoexpositorodriguez@gmail.com'];
const isAdmin = (email) => ADMIN_EMAILS.includes((email||'').toLowerCase());
const { applyOurTag, detectStore, extractAsin, getAmazonProductInfo } = require('./affiliates');

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
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

// Privacy & Terms pages (Apple requires accessible URL)
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public/privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public/terms.html')));

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
// Grupos de productos — para que "Café con leche" también encuentre "Café solo", etc.
const PRODUCT_GROUPS = {
  'cafe': ['cafe', 'coffee', 'cortado', 'cappuccino', 'expreso', 'espresso', 'americano'],
  'cerveza': ['cerveza', 'cana', 'birra', 'caña', 'beer'],
  'menu': ['menu', 'menú', 'comida', 'almuerzo', 'combinado'],
};
function getProductGroup(product) {
  if (!product) return null;
  const p = normalize(product);
  for (const [group, keywords] of Object.entries(PRODUCT_GROUPS)) {
    if (keywords.some(k => p.includes(k))) return group;
  }
  return null;
}
function productMatch(query, target) {
  if (!query || !target) return false;
  // Primero fuzzy directo
  if (fuzzyMatch(query, target)) return true;
  // Luego por grupo: si ambos pertenecen al mismo grupo (ej: "café con leche" y "café solo")
  const qGroup = getProductGroup(query);
  const tGroup = getProductGroup(target);
  if (qGroup && tGroup && qGroup === tGroup) return true;
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
function adminAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return fail(res, 'No autenticado', 401);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (!isAdmin(req.user.email)) return fail(res, 'Acceso solo para administradores', 403);
    next();
  } catch { fail(res, 'Token inválido', 401); }
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
const RANK_LEVELS = [
  { min: 0,    title: 'Novato',      emoji: '🌱', perks: ['Reportar precios','Votar chollos'] },
  { min: 50,   title: 'Ahorrador',   emoji: '💰', perks: ['Publicar chollos','Comentar en eventos'] },
  { min: 150,  title: 'Experto',     emoji: '⭐', perks: ['Votar cambios de precio','Reportar expirados'] },
  { min: 400,  title: 'Gurú',        emoji: '🏆', perks: ['Destacar chollos propios','Badge verificado'] },
  { min: 1000, title: 'Leyenda',     emoji: '👑', perks: ['Prioridad en reportes','Mención en top 3','Icono exclusivo'] },
];
const BADGES_DEF = [
  { key:'primer_reporte',  name:'Primer Reporte',     emoji:'📍', desc:'Reportaste tu primer precio',         pts:5  },
  { key:'diez_reportes',   name:'Reportero',          emoji:'📊', desc:'10 precios reportados',              pts:15 },
  { key:'cincuenta',       name:'Experto Local',      emoji:'🌟', desc:'50 precios reportados',              pts:50 },
  { key:'cien_reportes',   name:'Maestro Ahorro',     emoji:'💎', desc:'100 precios reportados',             pts:100},
  { key:'primer_chollo',   name:'Cazachollos',        emoji:'🔥', desc:'Publicaste tu primer chollo',        pts:10 },
  { key:'cinco_chollos',   name:'Chollero',           emoji:'🎯', desc:'5 chollos publicados',               pts:25 },
  { key:'chollo_viral',    name:'Viral',              emoji:'🚀', desc:'Un chollo tuyo superó 50 votos',     pts:50 },
  { key:'racha_7',         name:'Racha Semanal',      emoji:'🔥', desc:'7 días consecutivos activo',         pts:15 },
  { key:'racha_30',        name:'Mes Constante',      emoji:'📅', desc:'30 días consecutivos activo',        pts:50 },
  { key:'primer_voto',     name:'Votante',            emoji:'👍', desc:'Votaste por primera vez',            pts:2  },
  { key:'precio_aprobado', name:'Verificador',        emoji:'✅', desc:'Un cambio de precio fue aprobado',   pts:20 },
  { key:'madrugador',      name:'Madrugador',         emoji:'🌅', desc:'Reportaste precio antes de las 8am', pts:10 },
  { key:'explorador',      name:'Explorador',         emoji:'🗺️',  desc:'Reportaste en 5 ciudades distintas', pts:30 },
];

function getRankByPoints(pts) {
  const levels = [...RANK_LEVELS].reverse();
  return levels.find(l => pts >= l.min) || RANK_LEVELS[0];
}

async function addPoints(userId, points, reason) {
  try {
    await supabase.rpc('increment_points', { uid: userId, pts: points });
    await db.insert('notifications', { user_id: userId, type: 'points', message: `+${points} puntos por ${reason}` });
    const user = await db.query('users', { eq: { id: userId }, single: true });
    if (user) {
      const newPts = (user.points || 0) + points;
      const rank = getRankByPoints(newPts);
      const prevRank = getRankByPoints(user.points || 0);
      const updates = { rank_title: rank.title };
      await db.update('users', userId, updates);
      // Level-up notification
      if (rank.title !== prevRank.title) {
        await db.insert('notifications', { user_id: userId, type: 'level_up',
          message: `🎉 ¡Has subido de nivel! Ahora eres ${rank.emoji} ${rank.title}` });
      }
    }
  } catch {}
}

async function checkBadges(userId) {
  try {
    const [reports, deals, votes, user] = await Promise.all([
      db.count('prices', { eq: { reported_by: userId } }),
      db.count('deals',  { eq: { reported_by: userId } }),
      db.count('deal_votes', { eq: { user_id: userId } }),
      db.query('users',  { eq: { id: userId }, single: true }),
    ]);
    const existingBadges = (await db.query('badges', { eq: { user_id: userId }, select: 'key' }) || []).map(b=>b.key);
    const award = async (key, name, pts) => {
      if (!existingBadges.includes(key)) {
        await db.insert('badges', { user_id: userId, key });
        await db.insert('notifications', { user_id: userId, type: 'badge',
          message: `🎖️ ¡Nuevo logro desbloqueado: ${name}!` });
        await addPoints(userId, pts, `logro "${name}"`);
      }
    };
    const def = Object.fromEntries(BADGES_DEF.map(b => [b.key, b]));
    if (reports >= 1)  await award('primer_reporte', def.primer_reporte.name, def.primer_reporte.pts);
    if (reports >= 10) await award('diez_reportes',  def.diez_reportes.name,  def.diez_reportes.pts);
    if (reports >= 50) await award('cincuenta',      def.cincuenta.name,      def.cincuenta.pts);
    if (reports >= 100) await award('cien_reportes', def.cien_reportes.name,  def.cien_reportes.pts);
    if (deals >= 1)    await award('primer_chollo',  def.primer_chollo.name,  def.primer_chollo.pts);
    if (deals >= 5)    await award('cinco_chollos',  def.cinco_chollos.name,  def.cinco_chollos.pts);
    if (votes >= 1)    await award('primer_voto',    def.primer_voto.name,    def.primer_voto.pts);
    if ((user?.streak || 0) >= 7)  await award('racha_7',  def.racha_7.name,  def.racha_7.pts);
    if ((user?.streak || 0) >= 30) await award('racha_30', def.racha_30.name, def.racha_30.pts);
    // Viral badge - check if any deal by user has 50+ votes
    const { data: viralDeals } = await supabase.from('deals').select('id')
      .eq('reported_by', userId).gte('votes_up', 50).limit(1);
    if (viralDeals?.length > 0) await award('chollo_viral', def.chollo_viral.name, def.chollo_viral.pts);
  } catch {}
}

// API endpoint for levels info
app.get('/api/levels', (req, res) => {
  res.json({ levels: RANK_LEVELS, badges: BADGES_DEF });
});


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  ok: true,
  version: '3.8.0',
  db: 'supabase',
  stations: _gasCache?.length || 0,
  gas_cache_age_min: _gasCacheTime ? Math.round((Date.now()-_gasCacheTime)/60000) : null,
  places_cache_size: _placesCache?.size || 0,
  stats_cache_size: _statsCache?.size || 0,
}));

// Version + changelog
app.get('/api/version', (req, res) => res.json({
  server: '3.8.0',
  app: '1.3.0',
  features: ['gasolineras-12225','places-27441','precios-29423','users-43','chollos-5','eventos-43','stats-por-ciudad','feed-actividad','trending-deals','trending-events','search-global','tips-ahorro-18','google-signin','admob','favorites-sync','weekly-cost-supermarkets','price-proximity-sort','cache-warmup'],
  updated: '2026-03-28',
}));
// ─── TIPS DE AHORRO ─────────────────────────────────────────────────────────
const SAVING_TIPS = [
  { id:1,  emoji:'⛽', title:'G95 más barato a primera hora',        desc:'Las gasolineras en autopistas son hasta 20cts más caras. Busca estaciones en poblaciones cercanas.', category:'gasolina', saves:'~18€/mes' },
  { id:2,  emoji:'🛒', title:'Compra en Aldi o Lidl los básicos',    desc:'El ahorro vs Mercadona en arroz, leche y pasta puede ser del 40%. La calidad es similar según OCU.', category:'super', saves:'~45€/mes' },
  { id:3,  emoji:'💳', title:'Revolut para compras en extranjero',    desc:'Sin comisiones en divisas hasta 1.000€/mes. Ideal para viajes o compras en Amazon UK/DE.', category:'bancos', saves:'~12€/viaje' },
  { id:4,  emoji:'🏦', title:'Trade Republic al 4% sobre efectivo',  desc:'Tu dinero no invertido debería estar generando intereses. Sin condiciones ni límite de importe.', category:'bancos', saves:'~200€/año por 5000€' },
  { id:5,  emoji:'🔥', title:'Alertas de precio con CamelCamelCamel',desc:'Historial de precios en Amazon. Pon una alerta y compra solo cuando baje al mínimo histórico.', category:'tech', saves:'Variable' },
  { id:6,  emoji:'🚗', title:'Gasolina: evita autopistas',           desc:'Las gasolineras de autopista son hasta 25cts más caras. Sal una salida antes y repostan más barato.', category:'gasolina', saves:'~25€/mes' },
  { id:7,  emoji:'💡', title:'Tarifa nocturna de luz: ahorra 30%',   desc:'Con discriminación horaria, programar lavadora y lavavajillas de noche (23h-8h) ahorra un 30%.', category:'hogar', saves:'~20€/mes' },
  { id:8,  emoji:'✈️', title:'Vuelos baratos: martes y miércoles',   desc:'Las aerolíneas lanzan ofertas los lunes. Martes y miércoles son los días más baratos para volar.', category:'viajes', saves:'~40% vs fin de semana' },
  { id:9,  emoji:'📱', title:'Apps de cashback: Mcupon y Tipealo',   desc:'Puedes obtener hasta un 3-5% de cashback en supermercados y tiendas con estas apps gratuitas.', category:'super', saves:'~15€/mes' },
  { id:10, emoji:'🏷️', title:'Compra marca blanca en Mercadona',     desc:'La marca Hacendado supera a marcas comerciales en muchos tests de cata ciega. Ahorra un 30%.', category:'super', saves:'~30€/mes' },
  { id:11, emoji:'📊', title:'Comparador de luz y gas OCU',          desc:'Cambiar de comercializadora de luz puede ahorrarte hasta 200€ al año. Usa el comparador de OCU.', category:'hogar', saves:'~200€/año' },
  { id:12, emoji:'🎫', title:'Tarjeta Lidl Plus para descuentos',    desc:'La app gratuita de Lidl Plus ofrece descuentos semanales exclusivos y cupones personalizados.', category:'super', saves:'~10€/semana' },
  { id:13, emoji:'🌡️', title:'Bajada del termostato 1 grado',        desc:'Reducir la calefacción 1°C ahorra hasta un 7% en la factura. En invierno suma 50-80€ al año.', category:'hogar', saves:'~65€/año' },
  { id:14, emoji:'📦', title:'Amazon: espera el Prime Day',           desc:'Las ofertas del Prime Day (julio) y Black Friday pueden superar el 50% de descuento en electrónica.', category:'tech', saves:'Variable' },
  { id:15, emoji:'🏋️', title:'Gimnasio: negocia en enero',           desc:'Los gimnasios llenan en enero. Negocia en marzo-abril cuando bajan los socios y consigue hasta 50% dto.', category:'ocio', saves:'~30€/mes' },
  { id:16, emoji:'💊', title:'Medicamentos genéricos',               desc:'Los genéricos tienen la misma eficacia que las marcas. Pregunta a tu farmacéutico — ahorra hasta un 70%.', category:'salud', saves:'~15€/mes' },
  { id:17, emoji:'🚿', title:'Ducha en lugar de baño',              desc:'Un baño gasta 150L, una ducha de 5 min solo 50L. El ahorro anual en agua caliente puede ser de 80-120€.', category:'hogar', saves:'~100€/año' },
  { id:18, emoji:'🛍️', title:'Cesta básica en Aldi + frescos en mercado', desc:'Aldi para secos/lácteos y mercado local para fruta y verdura: ahorro de hasta un 35% vs comprar todo en Mercadona.', category:'super', saves:'~50€/mes' },
];

// Price benchmarks per category — national averages for reference
app.get('/api/price-benchmarks', async (req, res) => {
  try {
    const { city } = req.query;
    let q = supabase.from('prices')
      .select('price, places!inner(category, city)')
      .eq('is_active', 1)
      .in('places.category', ['restaurante','farmacia','supermercado'])
      .gte('price', 0.5);
    if (city) q = q.ilike('places.city', `%${city}%`);
    const { data } = await q.limit(2000);
    const buckets = {};
    (data||[]).forEach(r => {
      const cat = r.places?.category;
      if (!cat) return;
      if (!buckets[cat]) buckets[cat] = [];
      buckets[cat].push(r.price);
    });
    const result = {};
    Object.entries(buckets).forEach(([cat, prices]) => {
      prices.sort((a,b)=>a-b);
      const n = prices.length;
      result[cat] = {
        count: n,
        min: prices[0],
        max: prices[n-1],
        avg: prices.reduce((a,b)=>a+b,0)/n,
        median: prices[Math.floor(n/2)],
      };
    });
    res.json({ benchmarks: result, city: city||'España', count: (data||[]).length });
  } catch(e) { res.json({ benchmarks: {}, city: 'España', count: 0 }); }
});

app.get('/api/tips', (req, res) => {
  const { category } = req.query;
  const tips = category ? SAVING_TIPS.filter(t => t.category === category) : SAVING_TIPS;
  res.json(tips);
});

let _globalStatsCache = null, _globalStatsCacheTime = 0;
app.get('/api/stats', async (req, res) => {  try {
    // Caché 2 minutos para stats — cambian lentamente
    if (_globalStatsCache && Date.now() - _globalStatsCacheTime < 2*60*1000) {
      return res.set('Cache-Control','public,max-age=60').json(_globalStatsCache);
    }
    const [places, prices, deals, users, events, priceHistory] = await Promise.all([
      db.count('places'), db.count('prices'), db.count('deals'),
      db.count('users'),  db.count('events'), db.count('price_history'),
    ]);
    // Gas price stats from cache
    const gasStats = {};
    if (_gasCache?.length) {
      ['g95','g98','diesel','dieselPlus','glp','gnc'].forEach(fuel => {
        const vals = _gasCache.map(s => s.prices?.[fuel]).filter(v => v && v > 0);
        if (vals.length) gasStats[fuel] = { min: Math.min(...vals), avg: vals.reduce((a,b)=>a+b,0)/vals.length, max: Math.max(...vals) };
      });
    }
    const result = {
      places, prices, deals, users, events, price_history: priceHistory,
      gasolineras: _gasCache?.length || 0,
      gas_stats: gasStats,
      version: '3.8.0',
    };
    _globalStatsCache = result; _globalStatsCacheTime = Date.now();
    res.set('Cache-Control','public,max-age=60').json(result);
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
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, points: 0, is_admin: isAdmin(user.email) } });
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
    // Check badges on login (catches users who earned badges before the system existed)
    checkBadges(user.id).catch(() => {});
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, points: user.points, avatar_url: user.avatar_url, streak, is_admin: isAdmin(user.email) } });
  } catch(e) { fail(res, e.message); }
});

// ─── GOOGLE SIGN-IN ─────────────────────────────────────────────────────────
app.post('/api/auth/google', authLimiter, async (req, res) => {
  try {
    const { email, name, google_id, avatar_url } = req.body;
    if (!email) return fail(res, 'Email requerido');
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    let user = await db.query('users', { eq: { email: normalizedEmail }, single: true }).catch(() => null);

    if (user) {
      // Existing user — update google_id and avatar if missing
      const updates = {};
      if (google_id && !user.google_id) updates.google_id = google_id;
      if (avatar_url && !user.avatar_url) updates.avatar_url = avatar_url;
      if (Object.keys(updates).length > 0) {
        await db.update('users', user.id, updates).catch(() => {});
      }
      // Update streak
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      let streak = user.streak || 0;
      if (user.last_report_date === yesterday) streak++;
      else if (user.last_report_date !== today) streak = 1;
      await db.update('users', user.id, { streak, last_report_date: today }).catch(() => {});
      checkBadges(user.id).catch(() => {});
      const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ token, user: { id: user.id, name: user.name, email: user.email, points: user.points, avatar_url: user.avatar_url || avatar_url, streak, google_id: user.google_id || google_id, is_admin: isAdmin(user.email) } });
    } else {
      // New user — register with Google (no password needed)
      const randomHash = await bcrypt.hash(Math.random().toString(36) + Date.now(), 10);
      user = await db.insert('users', {
        name: (name || 'Usuario').trim(),
        email: normalizedEmail,
        password_hash: randomHash, // Random hash — user can set password later via "change password"
        google_id: google_id || null,
        avatar_url: avatar_url || null,
        points: 0, streak: 1,
        last_report_date: new Date().toISOString().split('T')[0],
      });
      const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ token, user: { id: user.id, name: user.name, email: user.email, points: 0, avatar_url: avatar_url, streak: 1, google_id: google_id, is_admin: isAdmin(user.email) } });
    }
  } catch (e) { fail(res, e.message); }
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

// ─── FAVORITE GAS STATIONS (persistent across devices) ──────────────────────
app.get('/api/users/me/favorites', auth, async (req, res) => {
  try {
    const favs = await db.query('favorite_stations', {
      eq: { user_id: req.user.id },
      order: { col: 'created_at', asc: false },
    });
    res.json(favs || []);
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/users/me/favorites', auth, async (req, res) => {
  try {
    const { station_id, station_name, station_city, lat, lng } = req.body;
    if (!station_id) return fail(res, 'station_id requerido');
    await db.upsert('favorite_stations', {
      user_id: req.user.id, station_id: String(station_id),
      station_name, station_city, lat, lng,
    }, 'user_id,station_id');
    ok(res, { saved: true });
  } catch(e) { fail(res, e.message, 500); }
});

app.delete('/api/users/me/favorites/:stationId', auth, async (req, res) => {
  try {
    const { error } = await supabase.from('favorite_stations')
      .delete()
      .eq('user_id', req.user.id)
      .eq('station_id', req.params.stationId);
    if (error) throw error;
    ok(res, { deleted: true });
  } catch(e) { fail(res, e.message, 500); }
});

// ─── DEAL VOTES — get user's votes for persistence ──────────────────────────
app.get('/api/users/me/votes', auth, async (req, res) => {
  try {
    const votes = await db.query('deal_votes', {
      eq: { user_id: req.user.id },
      select: 'deal_id,vote',
    });
    const map = {};
    (votes || []).forEach(v => { map[v.deal_id] = v.vote; });
    res.json(map);
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
    const user = await db.query('users', { eq: { id: req.user.id }, single: true });
    // Google Sign-In users have google_id but no real password — allow delete without password
    if (user.google_id && !password) {
      // Google user — no password needed, proceed with deletion
    } else {
      if (!password) return fail(res, 'Debes confirmar tu contraseña');
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return fail(res, 'Contraseña incorrecta');
    }
    await supabase.from('users').update({
      name: '[Usuario eliminado]',
      email: `deleted_${req.user.id}_${Date.now()}@deleted.com`,
      password_hash: '', avatar_url: null, bio: null, is_deleted: 1,
      google_id: null,
    }).eq('id', req.user.id);
    await supabase.from('notifications').delete().eq('user_id', req.user.id);
    await supabase.from('price_alerts').delete().eq('user_id', req.user.id);
    await supabase.from('favorite_stations').delete().eq('user_id', req.user.id);
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
const _leaderCache = new Map(); // key: period, val: {data, time}
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    // Caché 3 minutos
    const lc = _leaderCache.get(period);
    if (lc && Date.now() - lc.time < 3*60*1000) {
      return res.set('Cache-Control','public,max-age=60').json(lc.data);
    }
    const BOT_EMAIL = 'bot@precimap.es';

    // Get bot user ID to exclude from ranking
    let botId = null;
    try {
      const { data: botUser } = await supabase.from('users').select('id').eq('email', BOT_EMAIL).single();
      botId = botUser?.id || null;
    } catch {}

    let sinceDate = null;
    if (period === 'week')  sinceDate = new Date(Date.now() - 7  * 86400000).toISOString();
    if (period === 'month') sinceDate = new Date(Date.now() - 30 * 86400000).toISOString();

    if (sinceDate) {
      let q = supabase.from('prices')
        .select('reported_by, users(id, name, avatar_url, points, streak)')
        .gte('reported_at', sinceDate)
        .not('reported_by', 'is', null);
      if (botId) q = q.neq('reported_by', botId);
      const { data: topReporters, error } = await q;
      if (error) throw error;
      const counts = {};
      (topReporters || []).forEach(r => {
        if (!r.users) return;
        const uid = r.reported_by;
        if (!counts[uid]) counts[uid] = { ...r.users, reports: 0 };
        counts[uid].reports++;
      });
      const sorted = Object.values(counts)
        .sort((a,b) => (b.reports !== a.reports) ? b.reports - a.reports : (b.points||0) - (a.points||0))
        .slice(0, 30);
      if (sorted.length === 0) {
        let fbQ = supabase.from('users').select('id, name, avatar_url, points, streak, rank_title')
          .eq('is_deleted', 0).order('points', { ascending: false }).limit(30);
        if (botId) fbQ = fbQ.neq('id', botId);
        const { data: fallback } = await fbQ;
        const fb = (fallback || []).map(u => ({ ...u, reports: 0, period_fallback: true }));
        _leaderCache.set(period, { data: fb, time: Date.now() });
        return res.set('Cache-Control','public,max-age=60').json(fb);
      }
      // Add missing users who have points but 0 reports this period (to fill ranking)
      _leaderCache.set(period, { data: sorted, time: Date.now() });
      return res.set('Cache-Control','public,max-age=60').json(sorted);
    }

    // All time: rank by points, exclude bot
    let q = supabase.from('users')
      .select('id, name, avatar_url, points, streak, rank_title')
      .eq('is_deleted', 0)
      .order('points', { ascending: false })
      .limit(30);
    if (botId) q = q.neq('id', botId);
    const { data, error } = await q;
    if (error) throw error;

    const userIds = (data || []).map(u => u.id);
    const { data: reportCounts } = await supabase.from('prices').select('reported_by').in('reported_by', userIds);
    const countMap = {};
    (reportCounts || []).forEach(r => { countMap[r.reported_by] = (countMap[r.reported_by] || 0) + 1; });

    res.json((data || []).map(u => ({ ...u, reports: countMap[u.id] || 0 })));
  } catch(e) { fail(res, e.message, 500); }
});


// ─── DEALS (CHOLLOS) ──────────────────────────────────────────────────────────

// Trending deals — top 5 by hot_score in last 7 days
app.get('/api/deals/trending', async (req, res) => {
  try {
    const since = new Date(Date.now() - 7*24*3600000).toISOString();
    const { data, error } = await supabase.from('deals')
      .select('id,title,deal_price,original_price,discount_percent,store,category,image_url,votes_up,votes_down,detected_at,url,deal_comments(id)')
      .eq('is_active', 1).gte('detected_at', since).order('votes_up', { ascending: false }).limit(5);
    if (error) throw error;
    const trending = (data||[]).map(d => {
      const ageHours = (Date.now() - new Date(d.detected_at)) / 3600000;
      const score = (d.votes_up||0) - (d.votes_down||0);
      const comment_count = Array.isArray(d.deal_comments) ? d.deal_comments.length : 0;
      const { deal_comments, ...clean } = d;
      return { ...clean, comment_count, hot_score: score / Math.pow(ageHours + 2, 1.5),
        temperature: score >= 20 ? '🔥🔥🔥' : score >= 10 ? '🔥🔥' : '🔥' };
    }).sort((a,b) => b.hot_score - a.hot_score);
    res.json(trending);
  } catch(e) { fail(res, e.message, 500); }
});

app.get('/api/deals', optAuth, async (req, res) => {
  try {
    const { cat='all', sort='hot', search, limit=20, offset=0, min_price, max_price, min_discount } = req.query;
    const now = new Date().toISOString();

    // Auto-expire deals past their expiry date (fire-and-forget, never block)
    supabase.from('deals').update({ is_active: 0 })
      .eq('is_active', 1).lt('expires_at', now).then(() => {}).catch(() => {});

    let q = supabase.from('deals')
      .select('*, users(id,name,avatar_url), deal_comments(id)')
      .eq('is_active', 1);
    try { q = q.or(`expires_at.is.null,expires_at.gt.${now}`); } catch {}

    if (cat && cat !== 'all') q = q.eq('category', cat);
    if (search) q = q.ilike('title', `%${search}%`);
    if (min_price) q = q.gte('deal_price', parseFloat(min_price));
    if (max_price) q = q.lte('deal_price', parseFloat(max_price));
    if (min_discount) q = q.gte('discount_percent', parseFloat(min_discount));

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

    const deals = (data || []).map(d => {
      const ageHours = (Date.now() - new Date(d.detected_at)) / 3600000;
      const score = (d.votes_up||0) - (d.votes_down||0);
      const decayedScore = score / Math.pow(ageHours + 2, 1.5);
      let temp, tempColor;
      if (score >= 20 || decayedScore > 3)       { temp='🔥🔥🔥'; tempColor='#DC2626'; }
      else if (score >= 10 || decayedScore > 1.5) { temp='🔥🔥';  tempColor='#EA580C'; }
      else if (score >= 3  || decayedScore > 0.5) { temp='🔥';    tempColor='#D97706'; }
      else if (score >= 0)                         { temp='😐';    tempColor='#6B7280'; }
      else                                         { temp='🧊';    tempColor='#3B82F6'; }
      // Add comment_count from joined data
      const comment_count = Array.isArray(d.deal_comments) ? d.deal_comments.filter(c => !c.is_deleted).length : 0;
      const { deal_comments, ...cleanDeal } = d;
      return { ...cleanDeal, hot_score: decayedScore, temperature: temp, temp_color: tempColor, comment_count };
    });

    if (sort === 'hot') deals.sort((a,b) => b.hot_score - a.hot_score);

    res.set('X-Total-Count', deals.length);
    res.json(deals);
  } catch(e) { fail(res, e.message, 500); }
});

// ─── AMAZON PRODUCT LOOKUP via PA API ────────────────────────────────────────
app.get('/api/amazon/product', optAuth, async (req, res) => {
  const { url } = req.query;
  if (!url) return fail(res, 'URL requerida', 400);
  try {
    const asin = extractAsin(url);
    if (!asin) return fail(res, 'No se pudo extraer el ASIN de la URL', 400);
    const product = await getAmazonProductInfo(asin);
    if (!product) return fail(res, 'Producto no encontrado o error de API', 404);
    res.json(product);
  } catch(e) { fail(res, e.message || 'Error al consultar Amazon', 500); }
});

// ─── DEAL DUPLICATE CHECK ────────────────────────────────────────────────────
// Chollometro-style: check URL + title similarity before posting
app.post('/api/deals/check-duplicate', auth, async (req, res) => {
  try {
    const { url, title } = req.body;
    const duplicates = [];

    // 1. Exact URL match (normalize: strip query params except ASIN)
    if (url) {
      let cleanUrl = url.split('?')[0].toLowerCase().trim();
      // For Amazon: extract ASIN
      const asinMatch = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (asinMatch) {
        // Search by ASIN pattern in stored URLs
        const { data: urlMatches } = await supabase.from('deals')
          .select('id,title,deal_price,store,image_url,created_at,is_active')
          .ilike('url', `%${asinMatch[1]}%`)
          .eq('is_active', 1)
          .order('created_at', { ascending: false })
          .limit(5);
        if (urlMatches?.length) duplicates.push(...urlMatches.map(d => ({ ...d, match_type: 'url_exacta' })));
      } else {
        const { data: urlMatches } = await supabase.from('deals')
          .select('id,title,deal_price,store,image_url,created_at,is_active')
          .ilike('url', `%${cleanUrl}%`)
          .eq('is_active', 1)
          .limit(3);
        if (urlMatches?.length) duplicates.push(...urlMatches.map(d => ({ ...d, match_type: 'url_similar' })));
      }
    }

    // 2. Title similarity — check for very similar titles (>70% word overlap)
    if (title && duplicates.length === 0) {
      const words = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (words.length >= 2) {
        // Search using first meaningful words
        const searchTerm = words.slice(0, 3).join(' ');
        const { data: titleMatches } = await supabase.from('deals')
          .select('id,title,deal_price,store,image_url,created_at,is_active')
          .ilike('title', `%${words[0]}%`)
          .eq('is_active', 1)
          .order('created_at', { ascending: false })
          .limit(10);
        if (titleMatches?.length) {
          // Calculate overlap score
          const scored = titleMatches.map(d => {
            const dWords = d.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const overlap = words.filter(w => dWords.some(dw => dw.includes(w) || w.includes(dw))).length;
            const score = overlap / Math.max(words.length, dWords.length);
            return { ...d, match_type: 'titulo_similar', similarity: Math.round(score * 100) };
          }).filter(d => d.similarity >= 60).sort((a,b) => b.similarity - a.similarity);
          duplicates.push(...scored.slice(0, 3));
        }
      }
    }

    // Deduplicate by id
    const seen = new Set();
    const unique = duplicates.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });

    res.json({ duplicates: unique, count: unique.length });
  } catch(e) { res.json({ duplicates: [], count: 0 }); }
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
    // Admin can delete anything; owner can only soft-delete their own
    if (!isAdmin(req.user.email) && deal.reported_by !== req.user.id) return fail(res, 'Sin permiso', 403);
    await db.update('deals', deal.id, { is_active: 0, deleted_at: new Date().toISOString() });
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

// ─── STATS DE PRECIOS POR CIUDAD ─────────────────────────────────────────────
// ─── CACHÉ para /api/places/stats ────────────────────────────────────────────
const _statsCache = new Map();
const STATS_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

app.get('/api/places/stats', async (req, res) => {
  try {
    const { city } = req.query;
    if (!city) return fail(res, 'city requerida', 400);

    // Caché por ciudad
    const ckey = `stats:${city.toLowerCase()}`;
    const cached = _statsCache.get(ckey);
    if (cached && Date.now() - cached.time < STATS_CACHE_TTL) {
      return res.json(cached.data);
    }

    // Precios mínimos por categoría en esta ciudad
    const { data: places } = await supabase.from('places')
      .select('id,category').eq('is_active',1).ilike('city',`%${city}%`);
    if (!places?.length) return res.json({ city, stats: {} });

    const ids = places.map(p => p.id);
    const { data: prices } = await supabase.from('prices')
      .select('place_id,product,price')
      .eq('is_active',1).in('place_id', ids);

    // Agrupar por categoría + producto
    const stats = {};
    const catOf = Object.fromEntries(places.map(p => [p.id, p.category]));
    (prices||[]).forEach(p => {
      const cat = catOf[p.place_id];
      const key = cat === 'restaurante' ? p.product : cat;
      if (!stats[key]) stats[key] = { min: p.price, max: p.price, count: 0, sum: 0 };
      stats[key].min = Math.min(stats[key].min, p.price);
      stats[key].max = Math.max(stats[key].max, p.price);
      stats[key].sum += p.price;
      stats[key].count++;
    });
    Object.values(stats).forEach(s => { s.avg = Math.round(s.sum/s.count*100)/100; delete s.sum; });

    const result = { city, places: places.length, prices: prices?.length || 0, stats };
    _statsCache.set(ckey, { data: result, time: Date.now() });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json(result);
  } catch(e) { fail(res, e.message, 500); }
});

// ─── CACHÉ para /api/places (5 minutos) ──────────────────────────────────────
const _placesCache = new Map();
const PLACES_CACHE_TTL = 5 * 60 * 1000;
function placesCacheKey(q) {
  const {cat='',city='',product='',sort='proximity',lat='',lng='',radius=''} = q;
  return `${cat}|${city}|${product}|${sort}|${lat ? Math.round(lat*10)/10 : ''}|${lng ? Math.round(lng*10)/10 : ''}|${radius}`;
}

app.get('/api/places', optAuth, async (req, res) => {
  try {
    const { cat, lat, lng, radius, city, product, sort='proximity', search } = req.query;

    // Caché solo para queries sin búsqueda de texto (search) y sin autenticación especial
    if (!search) {
      const ckey = placesCacheKey(req.query);
      const cached = _placesCache.get(ckey);
      if (cached && Date.now() - cached.time < PLACES_CACHE_TTL) {
        return res.json(cached.data);
      }
    }

    // Solo los campos necesarios para la lista — más rápido que select('*')
    let q = supabase.from('places')
      .select('id,name,category,lat,lng,address,city,hours,category_detail')
      .eq('is_active', 1);
    if (cat && cat!=='all') q = q.eq('category', cat);
    const hasCity = city && city.trim() !== '';
    // Filtrar por campo city exacto (ilike para acentos) — NO por address para evitar falsos positivos
    if (hasCity) q = q.ilike('city', `%${city}%`);
    if (search) q = q.ilike('name', `%${search}%`);
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
        .select('place_id,product,price,reported_at,reported_by')  // sin JOIN users — más rápido para lista
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
      let productPrices = product ? prices.filter(p => productMatch(product, p.product)) : prices;
      // hasProduct: ¿tiene el producto pedido? Afecta al orden — sin él van al final
      const hasProduct = !product || productPrices.length > 0;
      // Para restaurantes: mostrar aunque no tenga el producto específico (van al final del sort)
      // Para otras categorías (farmacia): excluir si no tiene el producto
      if (product && productPrices.length === 0) {
        if (place.category === 'restaurante') {
          productPrices = prices; // fallback: usar todos sus precios (se ordenan al final)
        } else {
          return null; // farmacia sin ese medicamento → excluir
        }
      }
      prices = productPrices;

      // Compute representative price based on category:
      let repPrice = null;
      let repContext = null; // human-readable context for UI
      if (prices.length > 0) {
        const cat = place.category;
        if (cat === 'gasolinera') {
          repPrice = Math.min(...prices.map(p => p.price));
          repContext = `${prices.length} carburantes`;
        } else if (cat === 'supermercado') {
          // Weekly basket using median price (more robust vs outliers like olive oil)
          const priceList = prices.filter(p => p.price > 0).map(p => p.price).sort((a,b)=>a-b);
          if (priceList.length > 0) {
            // Median to avoid expensive outliers (olive oil, etc.) skewing result
            const mid = Math.floor(priceList.length/2);
            const medianP = priceList.length%2 ? priceList[mid] : (priceList[mid-1]+priceList[mid])/2;
            // Scale: Aldi median ~0.65€, basket ~80€. Higher median = pricier store
            const refMedian = 0.65;
            const weeklyBasket = Math.round((medianP / refMedian) * 80);
            repPrice = Math.max(60, Math.min(150, weeklyBasket));
            repContext = `~${repPrice}€/semana · ${prices.length} productos reportados`;
          }
        } else if (cat === 'gimnasio') {
          // Min monthly fee (only real fees > 0, not enrollment)
          const fees = prices.filter(p => p.price > 0 && (
            p.product?.toLowerCase().includes('básica') ||
            p.product?.toLowerCase().includes('mensual') ||
            p.product?.toLowerCase().includes('cuota')
          ));
          const src = fees.length > 0 ? fees : prices.filter(p => p.price > 5);
          repPrice = src.length > 0 ? Math.min(...src.map(p => p.price)) : null;
          repContext = repPrice ? `desde ${repPrice.toFixed(2)}€/mes` : null;
        } else if (cat === 'restaurante') {
          // Si hay product específico (café, cerveza, menú), usar SOLO ese precio
          // Si el bar no tiene ese precio → repPrice=null (sin precio, pero sigue en lista)
          const productFiltered = product ? prices.filter(p => productMatch(product, p.product)) : [];
          if (productFiltered.length > 0) {
            repPrice = Math.min(...productFiltered.map(p => p.price));
            repContext = `${productFiltered[0].product} · ${productFiltered.length} reporte${productFiltered.length!==1?'s':''}`;
          } else if (!product) {
            // Sin filtro de producto: media general de todos los precios ≥1€
            const all = prices.filter(p => p.price >= 1);
            repPrice = all.length > 0 ? all.reduce((a,b) => a+b.price,0)/all.length : null;
            repContext = repPrice ? `Media general · ${all.length} precios` : null;
          }
          // Si product pero no hay match: repPrice queda null — correcto
        } else if (cat === 'farmacia') {
          // Average of real medicines (>= 1€), exclude masks/bandages
          const meds = prices.filter(p => p.price >= 1);
          const src = meds.length >= 1 ? meds : prices;
          repPrice = src.reduce((a,b) => a + b.price, 0) / src.length;
          repContext = `Media de ${src.length} medicamento${src.length !== 1 ? 's' : ''} · media España ~4€`;
        } else {
          repPrice = prices.reduce((a,b) => a + b.price, 0) / prices.length;
          repContext = `Media de ${prices.length} productos`;
        }
        if (repPrice !== null && repPrice !== undefined) {
          repPrice = Math.round(repPrice * 100) / 100;
        }
      }

      return { ...place, prices, minPrice: repPrice, repPrice, repContext, hasProduct };

    });
    const filtered = result.filter(Boolean);
    if (sort==='price') {
      // Con precio → ordenados por precio ascendente
      // Sin precio → ordenados por distancia (más cercanos primero)
      filtered.sort((a,b)=>{
        const aHas = a.hasProduct && a.minPrice > 0;
        const bHas = b.hasProduct && b.minPrice > 0;
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        if (aHas && bHas) return (a.minPrice||999) - (b.minPrice||999);
        return (a._dist||999) - (b._dist||999); // ambos sin precio: por cercanía
      });
    } else if (sort==='price_proximity') {
      // Con precio → score combinado (60% precio + 40% distancia)
      // Sin precio → solo por distancia, pero después de los que tienen precio
      const withPrice = filtered.filter(p => p.hasProduct && p.minPrice > 0);
      const withoutPrice = filtered.filter(p => !p.hasProduct || !p.minPrice);
      const maxDist = Math.max(...filtered.map(p=>p._dist||0), 1);
      const maxPrice = Math.max(...withPrice.map(p=>p.minPrice||0), 1);
      withPrice.sort((a,b)=>{
        const sa = 0.6*(a.minPrice/maxPrice) + 0.4*((a._dist||maxDist)/maxDist);
        const sb = 0.6*(b.minPrice/maxPrice) + 0.4*((b._dist||maxDist)/maxDist);
        return sa - sb;
      });
      withoutPrice.sort((a,b)=>(a._dist||999)-(b._dist||999));
      filtered.length = 0;
      filtered.push(...withPrice, ...withoutPrice);
    } else {
      filtered.sort((a,b)=>(a._dist||999)-(b._dist||999));
    }
    const result_data = filtered.slice(0,200);
    // Guardar en caché si no hay búsqueda de texto
    if (!search) {
      const ckey = placesCacheKey(req.query);
      _placesCache.set(ckey, { data: result_data, time: Date.now() });
      // Limpiar entradas viejas si el caché crece demasiado
      if (_placesCache.size > 200) {
        const now = Date.now();
        for (const [k,v] of _placesCache) if (now - v.time > PLACES_CACHE_TTL) _placesCache.delete(k);
      }
    }
    // Cache-Control: cliente puede cachear 2 minutos, CDN/proxy 5 minutos
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
    res.json(result_data);
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/places', auth, async (req, res) => {
  try {
    const { name, category: rawCat, lat, lng, address, city } = req.body;
    if (!name||!rawCat||!lat||!lng) return fail(res, 'Faltan campos obligatorios');
    // Normalizar categorías obsoletas → restaurante
    const CAT_MAP = { bar:'restaurante', cafe:'restaurante', cafeteria:'restaurante' };
    const category = CAT_MAP[rawCat] || rawCat;
    const place = await db.insert('places', { name, category, lat: parseFloat(lat), lng: parseFloat(lng), address: address||'', city: city||'', created_by: req.user.id, is_active: 1 });
    await addPoints(req.user.id, 5, 'añadir lugar');
    res.json(place);
  } catch(e) { fail(res, e.message); }
});

// ─── PRICES ───────────────────────────────────────────────────────────────────

// Feed de actividad — últimos precios reportados por la comunidad
let _recentCache = null, _recentCacheTime = 0;
app.get('/api/prices/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit)||20, 50);
    // Caché 2 minutos para prices/recent
    if (_recentCache && Date.now() - _recentCacheTime < 2*60*1000) {
      res.set('Cache-Control','public, max-age=60, stale-while-revalidate=120');
      return res.json(_recentCache.slice(0, limit));
    }
    const { data, error } = await supabase.from('prices')
      .select('id,product,price,reported_at,places!inner(id,name,city,category)')
      .eq('is_active',1)
      .order('reported_at',{ascending:false})
      .limit(limit);
    if (error) throw error;
    const result = (data||[]).map(p => ({
      id: p.id,
      product: p.product,
      price: p.price,
      reported_at: p.reported_at,
      place_id: p.places?.id,
      place_name: p.places?.name,
      city: p.places?.city,
      category: p.places?.category,
    }));
    _recentCache = result; _recentCacheTime = Date.now();
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json(result.slice(0, limit));
  } catch(e) { fail(res, e.message, 500); }
});

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
    // Invalidar cachés afectados para que la siguiente petición tenga datos frescos
    _recentCache = null;
    _globalStatsCache = null;
    // Invalidar caché de places para la ciudad del lugar reportado
    const place = await db.query('places', { eq: { id: parseInt(place_id) }, select: 'city', single: true }).catch(() => null);
    if (place?.city) {
      const statsKey = `stats:${place.city.toLowerCase()}`;
      _statsCache.delete(statsKey);
      // Invalidar caché de places para esa ciudad
      for (const [k] of _placesCache) {
        if (k.includes(`|${place.city}|`) || k.includes(`|${encodeURIComponent(place.city)}|`)) {
          _placesCache.delete(k);
        }
      }
    }
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
const GAS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (aumentado)
const GAS_CACHE_STALE = 24 * 60 * 60 * 1000; // 24h — usar caché antiguo si falla la recarga
let _gasFetching = false;

async function fetchAllStations() {
  if (_gasFetching) {
    // Ya hay fetch en curso — devolver caché actual aunque sea viejo
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

// Pre-warm cache on startup — delayed to let Railway healthcheck pass first
setTimeout(() => fetchAllStations().catch(() => {}), 90000);
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

    // Stale-while-revalidate: devolver caché inmediatamente aunque sea viejo,
    // y recargar en background para la siguiente petición
    let stations;
    const cacheAge = Date.now() - _gasCacheTime;
    if (_gasCache && cacheAge < GAS_CACHE_TTL) {
      // Caché fresco — usar directamente
      stations = _gasCache;
    } else if (_gasCache && cacheAge < GAS_CACHE_STALE) {
      // Caché viejo pero usable — devolver inmediatamente y recargar en background
      stations = _gasCache;
      if (!_gasFetching) fetchAllStations().catch(() => {}); // reload en background
    } else {
      // Sin caché o caché muy viejo — esperar la recarga
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
// Trending events — top 5 most voted upcoming events
// ─── BÚSQUEDA GLOBAL ─────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ deals:[], events:[], places:[] });
    const term = `%${q.trim()}%`;
    const [deals, events, places] = await Promise.all([
      supabase.from('deals').select('id,title,deal_price,discount_percent,category,store')
        .eq('is_active',1).ilike('title', term).limit(5),
      supabase.from('events').select('id,title,date,city,is_free,category')
        .eq('is_active',1).ilike('title', term).limit(5),
      supabase.from('places').select('id,name,category,city')
        .eq('is_active',1).ilike('name', term).limit(5),
    ]);
    res.json({ deals: deals.data||[], events: events.data||[], places: places.data||[], query: q });
  } catch(e) { fail(res, e.message, 500); }
});

app.get('/api/events/trending', async (req, res) => {  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.from('events')
      .select('id,title,category,date,city,is_free,price_from,votes_up')
      .eq('is_active', 1).gte('date', today)
      .order('votes_up', { ascending: false }).limit(5);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { fail(res, e.message, 500); }
});

app.get('/api/events', async (req, res) => {
  try {
    const { cat, sort='date', city, source, limit=50, search } = req.query;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentHour = now.getHours();
    let q = supabase.from('events').select('*, users(id,name,avatar_url)').eq('is_active', 1).gte('date', today);
    if (cat && cat!=='all') q = q.eq('category', cat);
    if (source && source !== 'all') q = q.eq('source', source);
    if (search) q = q.ilike('title', `%${search}%`);
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

// Admin deactivate event
app.post('/api/events/:id/deactivate', adminAuth, async (req, res) => {
  try {
    await supabase.from('events').update({ is_active: 0 }).eq('id', parseId(req.params.id));
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

// ─── DEAL EXPIRE VOTING SYSTEM ────────────────────────────────────────────────
// Users vote that a deal has expired. At 5 votes it auto-deactivates.

app.post('/api/deals/:id/report-expired', auth, async (req, res) => {
  try {
    const dealId = parseInt(req.params.id);
    // Check already voted
    const { data: already } = await supabase.from('deal_expire_votes')
      .select('id').eq('deal_id', dealId).eq('user_id', req.user.id).single();
    if (already) return fail(res, 'Ya has reportado esta oferta como expirada');
    // Insert vote
    await supabase.from('deal_expire_votes').insert({ deal_id: dealId, user_id: req.user.id });
    // Count votes
    const { count } = await supabase.from('deal_expire_votes')
      .select('*', { count: 'exact', head: true }).eq('deal_id', dealId);
    let deactivated = false;
    if (count >= 5) {
      await supabase.from('deals').update({ is_active: 0 }).eq('id', dealId);
      deactivated = true;
    } else {
      await supabase.from('deals').update({ expire_reports: count }).eq('id', dealId);
    }
    await addPoints(req.user.id, 2, 'reportar oferta expirada');
    res.json({ ok: true, expire_reports: count, deactivated });
  } catch(e) { fail(res, e.message, 500); }
});

// Admin delete deal (only is_admin users)
app.delete('/api/deals/:id/admin', auth, async (req, res) => {
  try {
    const { data: u } = await supabase.from('users').select('is_admin').eq('id', req.user.id).single();
    if (!u?.is_admin) return fail(res, 'Solo administradores pueden eliminar directamente', 403);
    await supabase.from('deals').update({ is_active: 0 }).eq('id', parseInt(req.params.id));
    res.json({ ok: true });
  } catch(e) { fail(res, e.message, 500); }
});

// ─── PRICE CHANGE REQUEST SYSTEM (anti-troll voting) ─────────────────────────
// Users propose price changes, community votes, auto-applies at +5 net votes

app.get('/api/places/:placeId/price-changes', optAuth, async (req, res) => {
  try {
    const placeId = parseInt(req.params.placeId);
    const { data, error } = await supabase
      .from('price_change_requests')
      .select('*, users(id,name,avatar_url)')
      .eq('place_id', placeId)
      .in('status', ['pending','approved'])
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/places/:placeId/price-changes', auth, async (req, res) => {
  try {
    const placeId = parseInt(req.params.placeId);
    const { product, new_price, reason } = req.body;
    if (!product || !new_price || isNaN(parseFloat(new_price))) return fail(res, 'Producto y precio nuevo requeridos');
    // Get current price
    const { data: current } = await supabase.from('prices')
      .select('price').eq('place_id', placeId).eq('product', product).single();
    const old_price = current?.price || null;
    // Check no pending request for same product
    const { data: existing } = await supabase.from('price_change_requests')
      .select('id').eq('place_id', placeId).eq('product', product).eq('status','pending').single();
    if (existing) return fail(res, 'Ya hay una solicitud de cambio pendiente para este producto');
    const { data: req2, error } = await supabase.from('price_change_requests').insert({
      place_id: placeId, product, old_price, new_price: parseFloat(new_price),
      reason: reason?.slice(0,200) || null, requested_by: req.user.id,
      votes_up: 0, votes_down: 0, status: 'pending',
    }).select().single();
    if (error) throw error;
    await addPoints(req.user.id, 3, 'solicitar cambio precio');
    res.json({ ok: true, request: req2 });
  } catch(e) { fail(res, e.message, 500); }
});

app.post('/api/price-changes/:id/vote', auth, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const { vote } = req.body; // 1 = approve, -1 = reject
    if (![1,-1].includes(vote)) return fail(res, 'Voto inválido');
    // Check already voted
    const { data: existing } = await supabase.from('price_change_votes')
      .select('id').eq('request_id', reqId).eq('user_id', req.user.id).single();
    if (existing) return fail(res, 'Ya has votado esta solicitud');
    // Record vote
    await supabase.from('price_change_votes').insert({ request_id: reqId, user_id: req.user.id, vote });
    // Update tallies
    const field = vote === 1 ? 'votes_up' : 'votes_down';
    const { data: pcr } = await supabase.from('price_change_requests')
      .select('*').eq('id', reqId).single();
    if (!pcr) return fail(res, 'Solicitud no encontrada');
    const newUp = (pcr.votes_up || 0) + (vote === 1 ? 1 : 0);
    const newDown = (pcr.votes_down || 0) + (vote === -1 ? 1 : 0);
    const net = newUp - newDown;
    let status = pcr.status;
    // Auto-apply at +5 net votes
    if (net >= 5 && status === 'pending') {
      status = 'approved';
      // Update the actual price
      await supabase.from('prices').upsert({
        place_id: pcr.place_id, product: pcr.product, price: pcr.new_price,
        unit: 'ud', reported_by: pcr.requested_by, status: 'verified',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'place_id,product' });
      // Add to history
      await supabase.from('price_history').insert({
        place_id: pcr.place_id, product: pcr.product, price: pcr.new_price,
        reported_at: new Date().toISOString(),
      });
      await addPoints(pcr.requested_by, 10, 'precio aprobado por la comunidad');
    }
    // Auto-reject at -3 net votes
    if (net <= -3 && status === 'pending') status = 'rejected';
    await supabase.from('price_change_requests')
      .update({ votes_up: newUp, votes_down: newDown, status }).eq('id', reqId);
    await addPoints(req.user.id, 1, 'votar cambio precio');
    res.json({ ok: true, votes_up: newUp, votes_down: newDown, net, status });
  } catch(e) { fail(res, e.message, 500); }
});

// Get all pending price changes (for community feed)
app.get('/api/price-changes/pending', optAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('price_change_requests')
      .select('*, places(id,name,city,category), users(id,name,avatar_url)')
      .eq('status','pending')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { fail(res, e.message, 500); }
});

// ─── AUTO-EXPIRE EVENTS (runs on startup + every 6h) ──────────────────────────
async function expireOldEvents() {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('events').update({ is_active: 0 })
      .eq('is_active', 1).lt('date', yesterday);
    if (!error) console.log(`🗓️  Auto-expired events older than ${yesterday}`);
  } catch(e) { console.error('Auto-expire error:', e.message); }
}
expireOldEvents();
setInterval(expireOldEvents, 6 * 60 * 60 * 1000); // every 6h

// ─── AMAZON SCRAPER — DESHABILITADO ──────────────────────────────────────────
// Los chollos los añaden los usuarios directamente desde la app.
// El scraper automático está desactivado para evitar contenido desactualizado.
// const { runAmazonScraper, verifyActiveBotDeals } = require('./amazon_scraper');
console.log('ℹ️  Scraper automático desactivado — chollos manuales de usuarios');

// ID del usuario bot (PreciMap Bot) — si no existe lo creamos
let BOT_USER_ID = process.env.BOT_USER_ID || null;

// Scraper deshabilitado — función vacía para no romper referencias
async function ensureBotUser() { return null; }
async function runScraperJob() { /* scraper deshabilitado */ }
// setInterval y setTimeout eliminados — scraper off

// Endpoint manual para admin — forzar scraper o verificación
// Admin: re-award badges to all users (retroactive)
app.post('/api/admin/recheck-badges', auth, async (req, res) => {
  if (!req.user.is_admin) return fail(res, 'No autorizado', 403);
  try {
    const { data: users } = await supabase.from('users').select('id,name').eq('is_deleted', 0).limit(200);
    let count = 0;
    for (const u of (users || [])) {
      await checkBadges(u.id).catch(() => {});
      count++;
    }
    res.json({ ok: true, checked: count });
  } catch(e) { fail(res, e.message); }
});

app.post('/api/admin/run-scraper', auth, async (req, res) => {
  if (!req.user.is_admin) return fail(res, 'No autorizado', 403);
  const { action = 'all' } = req.body;
  runScraperJob().catch(console.error); // always run full job
  res.json({ ok: true, message: `Scraper lanzado en background (action: ${action})` });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🗺️  PreciMap v3.8.0 en http://localhost:${PORT}`);
  console.log(`🗄️  Base de datos: Supabase (${process.env.SUPABASE_URL ? '✅ Connected' : '❌ No URL'})\n`);

  // Warmup caché con las queries más frecuentes para las ciudades principales
  setTimeout(async () => {
    const TOP_CITIES = ['Sevilla','Córdoba','Madrid','Málaga','Granada','Barcelona'];
    const CATS = [
      {cat:'restaurante', product:'Café con leche', sort:'price'},
      {cat:'restaurante', product:'Caña de cerveza', sort:'price'},
      {cat:'restaurante', product:'Menú del día', sort:'price'},
      {cat:'supermercado', sort:'price'},
      {cat:'farmacia', sort:'proximity'},
      {cat:'gimnasio', sort:'price'},
    ];
    let warmed = 0;
    for (const city of TOP_CITIES) {
      for (const {cat, product='', sort} of CATS) {
        try {
          const fakeReq = { query: {cat, city, product, sort, lat:'', lng:'', radius:''} };
          // Simular la clave de caché para pre-calentar
          const ckey = placesCacheKey(fakeReq.query);
          if (!_placesCache.has(ckey)) {
            // Hacer la query real y guardar en caché
            const baseUrl = `http://localhost:${PORT}/api/places?cat=${cat}&city=${encodeURIComponent(city)}&sort=${sort}${product?`&product=${encodeURIComponent(product)}`:''}`;
            await fetch(baseUrl).then(r=>r.json()).then(data => {
              _placesCache.set(ckey, { data, time: Date.now() });
              warmed++;
            }).catch(()=>{});
          }
        } catch(_) {}
      }
    }
    console.log(`🔥 Caché calentado: ${warmed} queries pre-cargadas`);

    // Calentar también el caché de stats para las ciudades top
    const TOP_STATS = ['Sevilla','Córdoba','Madrid','Málaga','Granada','Barcelona','Valencia','Zaragoza'];
    let statsWarmed = 0;
    for (const city of TOP_STATS) {
      try {
        const ckey = `stats:${city.toLowerCase()}`;
        if (!_statsCache.has(ckey)) {
          await fetch(`http://localhost:${PORT}/api/places/stats?city=${encodeURIComponent(city)}`)
            .then(r=>r.json()).then(data => {
              _statsCache.set(ckey, { data, time: Date.now() });
              statsWarmed++;
            }).catch(()=>{});
        }
      } catch(_) {}
    }
    console.log(`📊 Stats caché: ${statsWarmed} ciudades pre-cargadas`);

    // Calentar prices/recent (sin caché propio, pero la query de Supabase es rápida si se ejecuta una vez)
    fetch(`http://localhost:${PORT}/api/prices/recent?limit=20`).catch(()=>{});
  }, 3000);
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

// redeploy Sat Mar 28 01:12:15 CET 2026
// perf deploy Sat Mar 28 06:07:27 CET 2026
