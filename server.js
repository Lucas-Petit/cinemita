const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---------- vocabulario ----------
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const PRICES = ['gratis', 'bajo', 'medio', 'alto'];
const AGE_RATINGS = ['atp', '13', '16', '18'];
const TRACK_TYPES = ['view', 'website', 'phone', 'whatsapp', 'directions'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Rellena campos nuevos en registros guardados antes de que existieran.
function normalizeCinema(c) {
  if (!c || typeof c !== 'object') return c;
  delete c.category; // campo removido (la app es solo de cines por ahora)
  if (!c.stats || typeof c.stats !== 'object') c.stats = {};
  if (!Array.isArray(c.screenings)) c.screenings = [];
  for (const s of c.screenings) if (s && typeof s === 'object') delete s.category;
  return c;
}

// ---------- persistence (atomic JSON file) ----------
function loadDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!Array.isArray(parsed.cinemas)) return { cinemas: [] };
    parsed.cinemas.forEach(normalizeCinema);
    return parsed;
  } catch {
    return { cinemas: [] };
  }
}

let db = loadDb();

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- helpers ----------
function str(v, max = 500) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Acepta teléfonos/whatsapp: "+54 9 11 5555-1234" → "+5491155551234". null si inválido.
function normalizePhone(v) {
  const p = str(v, 30).replace(/[\s().-]/g, '');
  if (!p) return '';
  return /^\+?\d{6,15}$/.test(p) ? p : null;
}

function publicCinema(c) {
  const { ownerToken, ...rest } = c;
  return rest;
}

function findCinema(id) {
  return db.cinemas.find(c => c.id === id);
}

function authorized(req, cinema) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token && token === cinema.ownerToken;
}

function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Acepta "micine.com" y lo normaliza a "https://micine.com". Devuelve null si es inválido.
// Solo se permiten URLs http/https cuyo host parezca un dominio.
function normalizeWebsite(w) {
  w = str(w, 300);
  if (!w) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(w)) w = 'https://' + w;
  try {
    const u = new URL(w);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?$/.test(u.host)) return null;
    return u.href;
  } catch {
    return null;
  }
}

// YYYY-MM-DD parseado como fecha local (new Date("YYYY-MM-DD") sería UTC y
// correría el día en husos negativos como UTC-3).
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function parseIsoDate(iso) {
  const m = DATE_RE.exec(iso);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}
// JS getDay(): 0=Dom..6=Sáb -> nuestro índice: 0=Lun..6=Dom
function isoDayOurs(iso) {
  const d = parseIsoDate(iso);
  return d ? (d.getDay() + 6) % 7 : null;
}

// Valida una función. Devuelve {screening} o {error}.
// `day` = función semanal recurrente; `date` = función única en fecha puntual
// (en ese caso `day` se deriva de la fecha). `poster` es URL opcional.
// `price` y `age` son opcionales.
function parseScreening(b) {
  const movie = str(b && b.movie, 200);
  const time = str(b && b.time, 5);
  const notes = str(b && b.notes, 300);
  const poster = normalizeWebsite(b && b.poster);
  const date = str(b && b.date, 10);
  const price = str(b && b.price, 20);
  const age = str(b && b.age, 10);

  if (!movie) return { error: 'El título de la película es obligatorio' };
  if (poster === null) return { error: 'URL de póster inválida' };
  if (price && !PRICES.includes(price)) return { error: 'Precio inválido (gratis, bajo, medio, alto)' };
  if (age && !AGE_RATINGS.includes(age)) return { error: 'Edad inválida (atp, 13, 16, 18)' };

  let day, dateOut = '';
  if (date) {
    const derived = isoDayOurs(date);
    if (derived === null) return { error: 'Fecha inválida (formato AAAA-MM-DD)' };
    day = derived;
    dateOut = date;
  } else {
    day = Number(b && b.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return { error: 'Día inválido (0 = Lunes … 6 = Domingo)' };
    }
  }
  if (!TIME_RE.test(time)) return { error: 'Hora inválida (formato HH:MM)' };
  return { screening: { id: crypto.randomUUID(), movie, day, date: dateOut, time, notes, poster, price, age } };
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '100kb' }));

app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/days', (req, res) => res.json(DAYS));

app.get('/api/meta', (req, res) => res.json({
  days: DAYS, prices: PRICES, ageRatings: AGE_RATINGS
}));

app.get('/api/cinemas', (req, res) => {
  res.json(db.cinemas.map(publicCinema));
});

app.post('/api/cinemas', (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 120);
  const lat = Number(b.lat);
  const lng = Number(b.lng);

  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!validLatLng(lat, lng)) {
    return res.status(400).json({ error: 'Ubicación inválida: marcá el cine en el mapa' });
  }
  const website = normalizeWebsite(b.website);
  if (website === null) return res.status(400).json({ error: 'Sitio web inválido' });
  const poster = normalizeWebsite(b.poster);
  if (poster === null) return res.status(400).json({ error: 'URL de imagen inválida' });
  const phone = normalizePhone(b.phone);
  if (phone === null) return res.status(400).json({ error: 'Teléfono inválido' });
  const whatsapp = normalizePhone(b.whatsapp);
  if (whatsapp === null) return res.status(400).json({ error: 'WhatsApp inválido' });

  const cinema = {
    id: crypto.randomUUID(),
    ownerToken: crypto.randomUUID(),
    name,
    address: str(b.address, 200),
    description: str(b.description, 1000),
    website,
    poster,
    phone,
    whatsapp,
    lat,
    lng,
    screenings: [],
    stats: {},
    createdAt: new Date().toISOString()
  };
  db.cinemas.push(cinema);
  saveDb();
  res.status(201).json({ ...publicCinema(cinema), ownerToken: cinema.ownerToken });
});

app.put('/api/cinemas/:id', (req, res) => {
  const cinema = findCinema(req.params.id);
  if (!cinema) return res.status(404).json({ error: 'Cine no encontrado' });
  if (!authorized(req, cinema)) return res.status(403).json({ error: 'No autorizado' });

  const b = req.body || {};
  if (b.name !== undefined) {
    const name = str(b.name, 120);
    if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
    cinema.name = name;
  }
  if (b.address !== undefined) cinema.address = str(b.address, 200);
  if (b.description !== undefined) cinema.description = str(b.description, 1000);
  if (b.website !== undefined) {
    const website = normalizeWebsite(b.website);
    if (website === null) return res.status(400).json({ error: 'Sitio web inválido' });
    cinema.website = website;
  }
  if (b.poster !== undefined) {
    const poster = normalizeWebsite(b.poster);
    if (poster === null) return res.status(400).json({ error: 'URL de imagen inválida' });
    cinema.poster = poster;
  }
  if (b.phone !== undefined) {
    const phone = normalizePhone(b.phone);
    if (phone === null) return res.status(400).json({ error: 'Teléfono inválido' });
    cinema.phone = phone;
  }
  if (b.whatsapp !== undefined) {
    const whatsapp = normalizePhone(b.whatsapp);
    if (whatsapp === null) return res.status(400).json({ error: 'WhatsApp inválido' });
    cinema.whatsapp = whatsapp;
  }
  if (b.lat !== undefined || b.lng !== undefined) {
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (!validLatLng(lat, lng)) return res.status(400).json({ error: 'Ubicación inválida' });
    cinema.lat = lat;
    cinema.lng = lng;
  }
  saveDb();
  res.json(publicCinema(cinema));
});

app.delete('/api/cinemas/:id', (req, res) => {
  const cinema = findCinema(req.params.id);
  if (!cinema) return res.status(404).json({ error: 'Cine no encontrado' });
  if (!authorized(req, cinema)) return res.status(403).json({ error: 'No autorizado' });
  db.cinemas = db.cinemas.filter(c => c.id !== cinema.id);
  saveDb();
  res.json({ ok: true });
});

// Métricas anónimas para el panel del dueño: vistas y clics de intención.
// No lleva auth ni datos personales; solo incrementa contadores.
app.post('/api/cinemas/:id/track', (req, res) => {
  const cinema = findCinema(req.params.id);
  if (!cinema) return res.status(404).json({ error: 'Cine no encontrado' });
  const type = str(req.body && req.body.type, 20);
  if (!TRACK_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo de evento inválido' });
  cinema.stats[type] = (cinema.stats[type] || 0) + 1;
  saveDb();
  res.json({ ok: true });
});

app.post('/api/cinemas/:id/screenings', (req, res) => {
  const cinema = findCinema(req.params.id);
  if (!cinema) return res.status(404).json({ error: 'Cine no encontrado' });
  if (!authorized(req, cinema)) return res.status(403).json({ error: 'No autorizado' });

  const { screening, error } = parseScreening(req.body);
  if (error) return res.status(400).json({ error });

  cinema.screenings.push(screening);
  saveDb();
  res.status(201).json(screening);
});

// Importación masiva (CSV): { screenings: [{movie, day, time, notes}, ...] }
// All-or-nothing: si alguna fila es inválida no se agrega nada.
app.post('/api/cinemas/:id/screenings/bulk', (req, res) => {
  const cinema = findCinema(req.params.id);
  if (!cinema) return res.status(404).json({ error: 'Cine no encontrado' });
  if (!authorized(req, cinema)) return res.status(403).json({ error: 'No autorizado' });

  const items = req.body && req.body.screenings;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No se enviaron funciones' });
  }
  if (items.length > 500) {
    return res.status(400).json({ error: 'Máximo 500 funciones por importación' });
  }

  const toAdd = [];
  for (let i = 0; i < items.length; i++) {
    const { screening, error } = parseScreening(items[i]);
    if (error) return res.status(400).json({ error: `Fila ${i + 1}: ${error}` });
    toAdd.push(screening);
  }
  cinema.screenings.push(...toAdd);
  saveDb();
  res.status(201).json({ added: toAdd.length });
});

app.put('/api/cinemas/:cid/screenings/:sid', (req, res) => {
  const cinema = findCinema(req.params.cid);
  if (!cinema) return res.status(404).json({ error: 'Cine no encontrado' });
  if (!authorized(req, cinema)) return res.status(403).json({ error: 'No autorizado' });
  const s = cinema.screenings.find(x => x.id === req.params.sid);
  if (!s) return res.status(404).json({ error: 'Función no encontrada' });
  const { screening, error } = parseScreening(req.body);
  if (error) return res.status(400).json({ error });
  const { id, ...fields } = screening;
  Object.assign(s, fields);
  saveDb();
  res.json(s);
});

app.delete('/api/cinemas/:cid/screenings/:sid', (req, res) => {
  const cinema = findCinema(req.params.cid);
  if (!cinema) return res.status(404).json({ error: 'Cine no encontrado' });
  if (!authorized(req, cinema)) return res.status(403).json({ error: 'No autorizado' });
  const before = cinema.screenings.length;
  cinema.screenings = cinema.screenings.filter(s => s.id !== req.params.sid);
  if (cinema.screenings.length === before) {
    return res.status(404).json({ error: 'Función no encontrada' });
  }
  saveDb();
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Cinemita corriendo en http://localhost:${PORT}`);
});
