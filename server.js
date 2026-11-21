'use strict';
// Tableside backend: zero dependencies, Node 18+.
// Guests and manager use the same site. Orders and requests are stored on the server and pushed live to the manager (Server-Sent Events).
process.env.TZ = process.env.TZ || 'Asia/Kolkata';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const PIN = String(process.env.MANAGER_PIN || '1234');
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data', 'store.json');
const PUBLIC = path.join(__dirname, 'public');
const MENU = JSON.parse(fs.readFileSync(path.join(__dirname, 'menu.json'), 'utf8'));
if (!process.env.MANAGER_PIN) console.warn('WARNING: MANAGER_PIN not set, using 1234. Set a real PIN before going live.');

/* ---------- storage (JSON file, written atomically) ---------- */
const DEFAULTS = { hotel: 'Hotel Sunrise', wifiName: 'Sunrise-Guest', wifiPass: 'welcome2026', tables: 12, soldOut: [] };
let store = { orders: {}, requests: {}, settings: { ...DEFAULTS } };
try { const s = JSON.parse(fs.readFileSync(DATA, 'utf8')); store = { orders: s.orders || {}, requests: s.requests || {}, settings: { ...DEFAULTS, ...(s.settings || {}) } }; } catch {}
const cutoff = Date.now() - 60 * 864e5;
for (const [k, o] of Object.entries(store.orders)) if (o.createdAt < cutoff && (o.status === 'paid' || o.status === 'cancelled')) delete store.orders[k];
for (const [k, r] of Object.entries(store.requests)) if (r.createdAt < cutoff && r.status === 'done') delete store.requests[k];
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(DATA), { recursive: true }); const tmp = DATA + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(store)); fs.renameSync(tmp, DATA); }
    catch (e) { console.error('save failed', e.message); }
  }, 150);
}
process.on('SIGTERM', () => { try { fs.mkdirSync(path.dirname(DATA), { recursive: true }); fs.writeFileSync(DATA, JSON.stringify(store)); } catch {} process.exit(0); });

/* ---------- helpers ---------- */
const live = o => o.status !== 'paid' && o.status !== 'cancelled';
const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > 20000) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); } });
});
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const hits = new Map();
function limited(req, bucket, max, windowMs) {
  const key = bucket + clientIp(req), now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some(t => now - t < 600000)) hits.delete(k); }, 60000).unref();
const publicSettings = () => ({ hotel: store.settings.hotel, tables: store.settings.tables, soldOut: store.settings.soldOut });

/* ---------- manager auth: signed cookie ---------- */
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const makeToken = () => { const exp = String(Date.now() + 12 * 3600e3); return exp + '.' + sign(exp); };
function isManager(req) {
  const m = /(?:^|;\s*)tb_auth=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = Buffer.from(sign(exp)), got = Buffer.from(sig);
  return good.length === got.length && crypto.timingSafeEqual(good, got);
}
const sameHash = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

/* ---------- manager live feed ---------- */
const clients = new Set();
function managerState() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const all = Object.entries(store.orders).map(([id, o]) => ({ id, ...o }));
  const today = all.filter(o => o.status !== 'cancelled' && o.createdAt >= start.getTime());
  return {
    orders: all.filter(live).sort((a, b) => a.createdAt - b.createdAt),
    requests: Object.entries(store.requests).map(([id, r]) => ({ id, ...r })).filter(r => r.status === 'open').sort((a, b) => a.createdAt - b.createdAt),
    settings: store.settings,
    stats: { ordersToday: today.length, salesToday: today.reduce((s, o) => s + o.total, 0) }
  };
}
function changed() { save(); const msg = `data: ${JSON.stringify(managerState())}\n\n`; for (const c of clients) c.write(msg); }
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000).unref();

/* ---------- static files ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
function serveStatic(req, res, pathname) {
  let file = pathname === '/' || pathname === '/manager' || pathname.startsWith('/t/') ? '/index.html' : pathname;
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

/* ---------- API ---------- */
const STATUSES = ['new', 'preparing', 'served', 'paid', 'cancelled'];
const REQ_TYPES = ['help', 'bill', 'water', 'clean'];
const tableNo = (v, max) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= max ? n : null; };
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

async function api(req, res, url) {
  const p = url.pathname, method = req.method;
  try {
    if (method === 'GET' && p === '/api/menu') return send(res, 200, { menu: MENU, settings: publicSettings() });

    let m;
    if (method === 'GET' && (m = p.match(/^\/api\/table\/(\d+)$/))) {
      const t = tableNo(m[1], store.settings.tables); if (!t) return send(res, 404, { error: 'Unknown table' });
      const orders = Object.entries(store.orders).map(([id, o]) => ({ id, ...o })).filter(o => o.table === t && live(o)).sort((a, b) => a.createdAt - b.createdAt);
      const requests = Object.entries(store.requests).map(([id, r]) => ({ id, ...r })).filter(r => r.table === t && r.status === 'open');
      const wifi = orders.length ? { name: store.settings.wifiName, pass: store.settings.wifiPass } : null; // unlocked by a real order
      return send(res, 200, { orders, requests, wifi, settings: publicSettings() });
    }

    if (method === 'POST' && p === '/api/orders') {
      if (limited(req, 'order', 20, 60000)) return send(res, 429, { error: 'Too many requests. Please wait a minute.' });
      const b = await readBody(req);
      const table = tableNo(b.table, store.settings.tables); if (!table) return send(res, 400, { error: 'Invalid table' });
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) return send(res, 400, { error: 'Your order is empty' });
      const items = []; let total = 0;
      for (const it of b.items) {
        const mi = MENU.find(x => x.id === it.id); const qty = Number(it.qty);
        if (!mi || !Number.isInteger(qty) || qty < 1 || qty > 20) return send(res, 400, { error: 'Invalid item' });
        if (store.settings.soldOut.includes(mi.id)) return send(res, 409, { error: mi.name + ' just sold out. Please remove it.' });
        items.push({ id: mi.id, name: mi.name, price: mi.price, qty, veg: mi.veg }); total += mi.price * qty; // price always comes from the server menu
      }
      const id = newId();
      store.orders[id] = { table, items, total, note: text(b.note, 200), status: 'new', createdAt: Date.now() };
      changed();
      return send(res, 201, { id });
    }

    if (method === 'POST' && p === '/api/requests') {
      if (limited(req, 'req', 20, 60000)) return send(res, 429, { error: 'Too many requests. Please wait a minute.' });
      const b = await readBody(req);
      const table = tableNo(b.table, store.settings.tables); if (!table || !REQ_TYPES.includes(b.type)) return send(res, 400, { error: 'Invalid request' });
      const dup = Object.entries(store.requests).find(([, r]) => r.table === table && r.type === b.type && r.status === 'open');
      if (dup) return send(res, 200, { id: dup[0] });
      const id = newId();
      store.requests[id] = { table, type: b.type, status: 'open', createdAt: Date.now() };
      changed();
      return send(res, 201, { id });
    }

    if (method === 'POST' && p === '/api/login') {
      if (limited(req, 'login', 8, 600000)) return send(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });
      const b = await readBody(req);
      if (!sameHash(String(b.pin ?? ''), PIN)) return send(res, 401, { error: 'Wrong PIN' });
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { ok: true }, { 'Set-Cookie': `tb_auth=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
    }
    if (method === 'POST' && p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'tb_auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });

    if (p.startsWith('/api/manager/')) {
      if (!isManager(req)) return send(res, 401, { error: 'Manager login required' });
      if (method === 'GET' && p === '/api/manager/state') return send(res, 200, managerState());
      if (method === 'GET' && p === '/api/manager/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`data: ${JSON.stringify(managerState())}\n\n`);
        clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      if (method === 'PATCH' && (m = p.match(/^\/api\/manager\/orders\/([\w]+)$/))) {
        const o = store.orders[m[1]]; if (!o) return send(res, 404, { error: 'Order not found' });
        const b = await readBody(req); if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'Invalid status' });
        o.status = b.status; changed(); return send(res, 200, { ok: true });
      }
      if (method === 'PATCH' && (m = p.match(/^\/api\/manager\/requests\/([\w]+)$/))) {
        const r = store.requests[m[1]]; if (!r) return send(res, 404, { error: 'Request not found' });
        r.status = 'done'; changed(); return send(res, 200, { ok: true });
      }
      if (method === 'PUT' && p === '/api/manager/settings') {
        const b = await readBody(req), s = store.settings;
        if (b.hotel !== undefined) s.hotel = text(b.hotel, 60) || DEFAULTS.hotel;
        if (b.wifiName !== undefined) s.wifiName = text(b.wifiName, 60);
        if (b.wifiPass !== undefined) s.wifiPass = text(b.wifiPass, 60);
        if (b.tables !== undefined) { const n = Number(b.tables); if (Number.isInteger(n) && n >= 1 && n <= 60) s.tables = n; }
        if (Array.isArray(b.soldOut)) s.soldOut = b.soldOut.filter(id => MENU.some(m => m.id === id));
        changed(); return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Not found' });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, e.code === 413 || e.code === 400 ? e.code : 500, { error: e.code ? e.message : 'Server error' });
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  serveStatic(req, res, decodeURIComponent(url.pathname));
}).listen(PORT, () => console.log(`Tableside running on http://localhost:${PORT}  (manager: /manager)`));
