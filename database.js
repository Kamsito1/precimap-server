const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'precimap.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    points INTEGER DEFAULT 0,
    streak INTEGER DEFAULT 0,
    last_report_date TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    address TEXT,
    phone TEXT,
    hours TEXT,
    created_by INTEGER,
    is_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id INTEGER NOT NULL,
    product TEXT NOT NULL,
    price REAL NOT NULL,
    unit TEXT DEFAULT 'unidad',
    reported_by INTEGER,
    photo_url TEXT,
    votes_up INTEGER DEFAULT 0,
    votes_down INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    is_active INTEGER DEFAULT 1,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (place_id) REFERENCES places(id),
    FOREIGN KEY (reported_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS price_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    vote INTEGER NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(price_id, user_id),
    FOREIGN KEY (price_id) REFERENCES prices(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    badge_key TEXT NOT NULL,
    earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, badge_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    place_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, place_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (place_id) REFERENCES places(id)
  );

  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    store TEXT,
    category TEXT DEFAULT 'otros',
    original_price REAL,
    deal_price REAL NOT NULL,
    discount_percent REAL,
    url TEXT,
    affiliate_url TEXT,
    image_url TEXT,
    ai_analysis TEXT,
    ai_score INTEGER DEFAULT 0,
    votes_up INTEGER DEFAULT 0,
    votes_down INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    reported_by INTEGER,
    source TEXT DEFAULT 'user',
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (reported_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deal_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    vote INTEGER NOT NULL,
    UNIQUE(deal_id, user_id),
    FOREIGN KEY (deal_id) REFERENCES deals(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deal_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    parent_id INTEGER,
    text TEXT NOT NULL,
    votes_up INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deal_id) REFERENCES deals(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES deal_comments(id)
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id INTEGER NOT NULL,
    product TEXT NOT NULL,
    price REAL NOT NULL,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (place_id) REFERENCES places(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, category TEXT NOT NULL,
    venue TEXT, address TEXT, city TEXT DEFAULT 'Cordoba',
    lat REAL, lng REAL,
    price REAL, price_from REAL, price_label TEXT, is_free INTEGER DEFAULT 0,
    date TEXT NOT NULL, time TEXT, url TEXT, description TEXT,
    source TEXT DEFAULT 'user', reported_by INTEGER,
    votes_up INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reported_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER, store TEXT,
    original_url TEXT, affiliate_url TEXT,
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bank_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_name TEXT NOT NULL,
    product_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    interest_rate REAL,
    bonus_amount REAL,
    conditions TEXT,
    url TEXT,
    affiliate_url TEXT,
    is_verified INTEGER DEFAULT 0,
    votes_up INTEGER DEFAULT 0,
    votes_down INTEGER DEFAULT 0,
    expires_at TEXT,
    source TEXT DEFAULT 'user',
    reported_by INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reported_by) REFERENCES users(id)
  );
`);

const BADGES = {
  primer_reporte: { name: 'Primer Reporte', emoji: '🌟', desc: 'Reportaste tu primer precio' },
  diez_reportes: { name: '10 Reportes', emoji: '📊', desc: '10 precios reportados' },
  cincuenta_reportes: { name: 'Experto', emoji: '🏅', desc: '50 precios reportados' },
  guru_gasolina: { name: 'Guru Gasolina', emoji: '⛽', desc: '10 precios de gasolineras' },
  rey_bar: { name: 'Rey del Bar', emoji: '🍺', desc: '10 precios de bares' },
  verificador: { name: 'Verificador', emoji: '✅', desc: '20 precios verificados' },
  racha_7: { name: 'Racha Semanal', emoji: '🔥', desc: '7 dias consecutivos' },
  racha_30: { name: 'Constante', emoji: '💎', desc: '30 dias consecutivos' },
  ahorrador: { name: 'Gran Ahorrador', emoji: '💰', desc: '500 puntos acumulados' },
};

function checkBadges(db, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const totalReports = db.prepare('SELECT COUNT(*) as c FROM prices WHERE reported_by = ?').get(userId).c;
  const gasReports = db.prepare(`SELECT COUNT(*) as c FROM prices p JOIN places pl ON p.place_id = pl.id WHERE p.reported_by = ? AND pl.category = 'gasolinera'`).get(userId).c;
  const barReports = db.prepare(`SELECT COUNT(*) as c FROM prices p JOIN places pl ON p.place_id = pl.id WHERE p.reported_by = ? AND pl.category = 'bar'`).get(userId).c;
  const verifications = db.prepare(`SELECT COUNT(*) as c FROM price_votes WHERE user_id = ? AND vote = 1`).get(userId).c;
  const existingBadges = db.prepare('SELECT badge_key FROM badges WHERE user_id = ?').all(userId).map(b => b.badge_key);
  const newBadges = [];
  const awardBadge = (key) => {
    if (!existingBadges.includes(key)) {
      db.prepare('INSERT OR IGNORE INTO badges (user_id, badge_key) VALUES (?, ?)').run(userId, key);
      newBadges.push(BADGES[key]);
    }
  };
  if (totalReports >= 1) awardBadge('primer_reporte');
  if (totalReports >= 10) awardBadge('diez_reportes');
  if (totalReports >= 50) awardBadge('cincuenta_reportes');
  if (gasReports >= 10) awardBadge('guru_gasolina');
  if (barReports >= 10) awardBadge('rey_bar');
  if (verifications >= 20) awardBadge('verificador');
  if (user.streak >= 7) awardBadge('racha_7');
  if (user.streak >= 30) awardBadge('racha_30');
  if (user.points >= 500) awardBadge('ahorrador');
  return newBadges;
}

function updateStreak(db, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  let streak = user.streak || 0;
  if (user.last_report_date === yesterday) streak += 1;
  else if (user.last_report_date !== today) streak = 1;
  db.prepare('UPDATE users SET streak = ?, last_report_date = ? WHERE id = ?').run(streak, today, userId);
  return streak;
}

function updatePriceStatus(db, priceId) {
  const price = db.prepare('SELECT * FROM prices WHERE id = ?').get(priceId);
  if (!price) return;
  const total = price.votes_up + price.votes_down;
  let status = 'pending';
  if (total >= 3) {
    const ratio = price.votes_up / total;
    if (ratio >= 0.7) status = 'verified';
    else if (ratio <= 0.3) status = 'disputed';
  }
  db.prepare('UPDATE prices SET status = ? WHERE id = ?').run(status, priceId);
  if (status === 'verified' && price.reported_by) {
    db.prepare('UPDATE users SET points = points + 20 WHERE id = ?').run(price.reported_by);
  }
  return status;
}

module.exports = { db, BADGES, checkBadges, updateStreak, updatePriceStatus };
