/* Cinemita — mapa de cines independientes de Buenos Aires */

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAY_SHORT = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];
const BA_CENTER = [-34.6037, -58.3816];

// Vocabulario compartido con el servidor (ver /api/meta)
const PRICE_ORDER = ['gratis', 'bajo', 'medio', 'alto'];
const PRICE_LABELS = { gratis: 'Gratis', bajo: '$', medio: '$$', alto: '$$$' };
const AGE_LABELS = { atp: 'ATP', '13': '+13', '16': '+16', '18': '+18' };
const TIME_SLOTS = [
  { id: 'manana', label: 'Mañana (6–12)', from: 6, to: 12 },
  { id: 'tarde', label: 'Tarde (12–18)', from: 12, to: 18 },
  { id: 'noche', label: 'Noche (18–24)', from: 18, to: 24 },
  { id: 'madrugada', label: 'Madrugada (0–6)', from: 0, to: 6 }
];

const state = {
  cinemas: [],
  markers: new Map(),
  userPos: null,
  pickMap: null,
  pickMarker: null,
  pickedLatLng: null,
  editingId: null,
  editingScreeningId: null,
  tab: 'cinemas',
  query: '',
  onlyToday: false,
  filters: { price: '', time: '', radius: 0 },
  carteleraDay: jsDayToOurs(new Date().getDay()),
};

// ---------- utils ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const norm = s => stripAccents(String(s ?? '').toLowerCase());

// Fechas puntuales (funciones únicas). YYYY-MM-DD se parsea como fecha local —
// new Date("YYYY-MM-DD") sería medianoche UTC y correría el día en UTC-3.
const pad2 = n => String(n).padStart(2, '0');
function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`;
}
function toIsoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isoToLocal(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}
function isoWeekday(iso) { // -> nuestro índice 0=Lun..6=Dom
  const d = isoToLocal(iso);
  return d ? jsDayToOurs(d.getDay()) : null;
}
function fmtDate(iso) {
  const d = isoToLocal(iso);
  return d ? `${d.getDate()}/${d.getMonth() + 1}` : '';
}
// Etiqueta corta: "Sábado" para funciones semanales, "Sáb 3/10" para únicas.
function screeningLabel(s) {
  if (!s.date) return DAYS[s.day];
  return `${DAY_SHORT[isoWeekday(s.date)]} ${fmtDate(s.date)}`;
}
function cinemaUrl(id) {
  return `${location.href.split('#')[0]}#cine=${id}`;
}

function ownerToken(cinemaId) {
  return localStorage.getItem('cinemita_token_' + cinemaId);
}

// Recuperación de acceso: un enlace #admin=<id>:<token> instala la clave
// de administración de ese cine en este navegador y se limpia de la URL.
(function consumeAdminHash() {
  const m = location.hash.match(/^#admin=([^:]+):(.+)$/);
  if (!m) return;
  localStorage.setItem('cinemita_token_' + m[1], decodeURIComponent(m[2]));
  history.replaceState(null, '', location.pathname + location.search);
})();

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, d = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * d / 2) ** 2 +
    Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin((lng2 - lng1) * d / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function authHeaders(cinemaId) {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ownerToken(cinemaId) };
}

async function remoteApi(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}

// Métrica anónima para el panel del dueño: vistas y clics de intención.
function track(cinemaId, type) {
  api(`api/cinemas/${cinemaId}/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type })
  }).catch(() => {});
}

// ---------- modo demo (sin backend: datos en localStorage) ----------
let DEMO = false;
const DEMO_DB_KEY = 'cinemita_demo_db';
// Subir este número cuando cambie data/seed.json: refresca los cines del seed
// en navegadores que ya tenían una copia vieja (sin tocar los que el usuario creó).
const DEMO_SEED_VERSION = '2';
const DEMO_SEED_KEY = 'cinemita_demo_seed_v';

const demoDb = {
  load() {
    try { return JSON.parse(localStorage.getItem(DEMO_DB_KEY)) || { cinemas: [] }; }
    catch { return { cinemas: [] }; }
  },
  save(db) { localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db)); },
  async init() {
    const db = this.load();
    const seed = await (await fetch('data/seed.json')).json();
    if (localStorage.getItem(DEMO_SEED_KEY) !== DEMO_SEED_VERSION) {
      // Seed nuevo: reemplaza los cines del seed (conservando sus stats) y
      // mantiene los que el usuario registró en este navegador.
      const seedNames = new Set(seed.cinemas.map(c => c.name));
      const userCinemas = db.cinemas.filter(c => !seedNames.has(c.name));
      for (const s of seed.cinemas) {
        const prev = db.cinemas.find(c => c.name === s.name);
        if (prev && prev.stats) s.stats = prev.stats;
      }
      db.cinemas = [...seed.cinemas, ...userCinemas];
      localStorage.setItem(DEMO_SEED_KEY, DEMO_SEED_VERSION);
      this.save(db);
      return db.cinemas;
    }
    // Mezcla con el seed: agrega cines que falten y completa campos nuevos
    // (p. ej. poster) en los que ya estaban guardados de una versión anterior.
    let changed = false;
    for (const s of seed.cinemas) {
      const existing = db.cinemas.find(c => c.name === s.name);
      if (!existing) { db.cinemas.push(s); changed = true; }
      else if (s.poster && !existing.poster) { existing.poster = s.poster; changed = true; }
    }
    if (changed || !localStorage.getItem(DEMO_DB_KEY)) this.save(db);
    return db.cinemas;
  }
};

function normalizeWebsiteDemo(w) {
  w = (w || '').trim();
  if (!w) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(w)) w = 'https://' + w;
  try {
    const u = new URL(w);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?$/.test(u.host)) return null;
    return u.href;
  } catch { return null; }
}

function normalizePhoneDemo(v) {
  const p = (v || '').trim().slice(0, 30).replace(/[\s().-]/g, '');
  if (!p) return '';
  if (!/^\+?\d{6,15}$/.test(p)) throw new Error('Teléfono inválido');
  return p;
}

function demoScreening(b) {
  const movie = (b.movie || '').trim().slice(0, 200);
  const time = (b.time || '').trim();
  const notes = (b.notes || '').trim().slice(0, 300);
  const poster = normalizeWebsiteDemo(b.poster);
  const date = (b.date || '').trim().slice(0, 10);
  const price = (b.price || '').trim().slice(0, 20);
  const age = (b.age || '').trim().slice(0, 10);
  if (!movie) throw new Error('El título de la película es obligatorio');
  if (poster === null) throw new Error('URL de póster inválida');
  if (price && !PRICE_ORDER.includes(price)) throw new Error('Precio inválido');
  if (age && !AGE_LABELS[age]) throw new Error('Edad inválida');
  let day, dateOut = '';
  if (date) {
    day = isoWeekday(date);
    if (day === null) throw new Error('Fecha inválida (formato AAAA-MM-DD)');
    dateOut = date;
  } else {
    day = Number(b.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('Día inválido');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Hora inválida (formato HH:MM)');
  return { id: crypto.randomUUID(), movie, day, date: dateOut, time, notes, poster, price, age };
}

async function demoApi(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  const db = demoDb.load();
  for (const c of db.cinemas) {
    c.stats = c.stats || {};
    c.screenings = c.screenings || [];
  }
  const token = ((options.headers || {}).Authorization || '').replace('Bearer ', '');
  const publicC = c => { const { ownerToken, ...rest } = c; return rest; };
  const m = path.match(/^api\/cinemas(?:\/([^/]+))?(?:\/(.*))?$/);
  if (!m) throw new Error('Ruta inválida');
  const [, id, rest = ''] = m;
  const cinema = db.cinemas.find(c => c.id === id);
  const needOwner = () => {
    if (!cinema) throw new Error('Cine no encontrado');
    if (!token || token !== cinema.ownerToken) throw new Error('No autorizado');
  };

  if (method === 'GET' && !id) return db.cinemas.map(publicC);

  if (method === 'POST' && !id) {
    const name = (body.name || '').trim().slice(0, 120);
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!name) throw new Error('El nombre es obligatorio');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Ubicación inválida: marcá el cine en el mapa');
    }
    const website = normalizeWebsiteDemo(body.website);
    if (website === null) throw new Error('Sitio web inválido');
    const poster = normalizeWebsiteDemo(body.poster);
    if (poster === null) throw new Error('URL de imagen inválida');
    const created = {
      id: crypto.randomUUID(), ownerToken: crypto.randomUUID(), name,
      address: (body.address || '').trim().slice(0, 200),
      description: (body.description || '').trim().slice(0, 1000),
      website, poster,
      phone: normalizePhoneDemo(body.phone),
      whatsapp: normalizePhoneDemo(body.whatsapp),
      lat, lng, screenings: [], stats: {}, createdAt: new Date().toISOString()
    };
    db.cinemas.push(created);
    demoDb.save(db);
    return { ...publicC(created), ownerToken: created.ownerToken };
  }

  if (method === 'PUT' && id && !rest) {
    needOwner();
    if (body.name !== undefined) {
      const name = (body.name || '').trim().slice(0, 120);
      if (!name) throw new Error('El nombre es obligatorio');
      cinema.name = name;
    }
    if (body.address !== undefined) cinema.address = (body.address || '').trim().slice(0, 200);
    if (body.description !== undefined) cinema.description = (body.description || '').trim().slice(0, 1000);
    if (body.website !== undefined) {
      const website = normalizeWebsiteDemo(body.website);
      if (website === null) throw new Error('Sitio web inválido');
      cinema.website = website;
    }
    if (body.poster !== undefined) {
      const poster = normalizeWebsiteDemo(body.poster);
      if (poster === null) throw new Error('URL de imagen inválida');
      cinema.poster = poster;
    }
    if (body.phone !== undefined) cinema.phone = normalizePhoneDemo(body.phone);
    if (body.whatsapp !== undefined) cinema.whatsapp = normalizePhoneDemo(body.whatsapp);
    if (body.lat !== undefined || body.lng !== undefined) {
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Ubicación inválida');
      cinema.lat = lat; cinema.lng = lng;
    }
    demoDb.save(db);
    return publicC(cinema);
  }

  if (method === 'DELETE' && id && !rest) {
    needOwner();
    db.cinemas = db.cinemas.filter(c => c.id !== id);
    demoDb.save(db);
    return { ok: true };
  }

  if (method === 'POST' && rest === 'track') {
    if (!cinema) throw new Error('Cine no encontrado');
    if (!['view', 'website', 'phone', 'whatsapp', 'directions'].includes(body.type)) {
      throw new Error('Tipo de evento inválido');
    }
    cinema.stats[body.type] = (cinema.stats[body.type] || 0) + 1;
    demoDb.save(db);
    return { ok: true };
  }

  if (method === 'POST' && rest === 'screenings') {
    needOwner();
    const s = demoScreening(body);
    cinema.screenings.push(s);
    demoDb.save(db);
    return s;
  }

  if (method === 'POST' && rest === 'screenings/bulk') {
    needOwner();
    const items = body.screenings;
    if (!Array.isArray(items) || !items.length) throw new Error('No se enviaron funciones');
    const toAdd = items.map((b, i) => {
      try { return demoScreening(b); }
      catch (e) { throw new Error(`Fila ${i + 1}: ${e.message}`); }
    });
    cinema.screenings.push(...toAdd);
    demoDb.save(db);
    return { added: toAdd.length };
  }

  const delM = rest.match(/^screenings\/([^/]+)$/);
  if (method === 'PUT' && delM) {
    needOwner();
    const s = cinema.screenings.find(x => x.id === delM[1]);
    if (!s) throw new Error('Función no encontrada');
    const upd = demoScreening(body);
    s.movie = upd.movie; s.day = upd.day; s.date = upd.date;
    s.time = upd.time; s.notes = upd.notes; s.poster = upd.poster;
    s.price = upd.price; s.age = upd.age;
    demoDb.save(db);
    return s;
  }

  if (method === 'DELETE' && delM) {
    needOwner();
    const before = cinema.screenings.length;
    cinema.screenings = cinema.screenings.filter(s => s.id !== delM[1]);
    if (cinema.screenings.length === before) throw new Error('Función no encontrada');
    demoDb.save(db);
    return { ok: true };
  }

  throw new Error('Operación no soportada en modo demo');
}

const api = (path, options) => DEMO ? demoApi(path, options) : remoteApi(path, options);

// JS getDay(): 0=Sun..6=Sat -> our index: 0=Mon..6=Sun
function jsDayToOurs(jsDay) { return (jsDay + 6) % 7; }

function screeningsByDay(cinema) {
  const grouped = new Map();
  for (const s of cinema.screenings) {
    if (!grouped.has(s.day)) grouped.set(s.day, []);
    grouped.get(s.day).push(s);
  }
  for (const arr of grouped.values()) arr.sort((a, b) => a.time.localeCompare(b.time));
  return grouped;
}

function nextScreening(cinema) {
  if (!cinema.screenings.length) return null;
  const now = new Date();
  const todayIdx = jsDayToOurs(now.getDay());
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let best = null;
  for (const s of cinema.screenings) {
    const [h, m] = s.time.split(':').map(Number);
    const startMin = h * 60 + m;
    let delta;
    if (s.date) {
      // Función única: pasada la fecha (o la hora del día), no vuelve.
      const d = isoToLocal(s.date);
      if (!d) continue;
      delta = Math.round((d - todayMid) / 86400000);
      if (delta < 0 || (delta === 0 && startMin <= nowMin)) continue;
    } else {
      delta = (s.day - todayIdx + 7) % 7;
      if (delta === 0 && startMin <= nowMin) delta = 7;
    }
    if (!best || delta < best.delta || (delta === best.delta && s.time < best.s.time)) {
      best = { s, delta };
    }
  }
  return best;
}

// ---------- map ----------
const WORLD_BOUNDS = [[-85, -180], [85, 180]];
// Basemap oscuro de CARTO: requiere key gratuita (https://carto.com/basemaps/apikey —
// llega por email, sin cuenta). Se pega acá o en el navegador con
// localStorage.setItem('cinemita_carto_key', '...'). Sin key → OpenStreetMap estándar.
const CARTO_KEY = localStorage.getItem('cinemita_carto_key') || '';
const TILE_URL = CARTO_KEY
  ? `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`
  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = CARTO_KEY
  ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const TILE_OPTS = {
  maxZoom: 19,
  noWrap: true,
  bounds: [[-90, -180], [90, 180]],
  attribution: TILE_ATTR
};
const MAP_OPTS = {
  minZoom: 3,
  maxBounds: L.latLngBounds(WORLD_BOUNDS),
  maxBoundsViscosity: 1.0
};

const pinIcon = L.divIcon({
  className: 'pin',
  html: '<div class="pin-dot"></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 34],
  popupAnchor: [0, -28]
});

const meIcon = L.divIcon({
  className: 'me-pin',
  html: '<div class="me-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

const map = L.map('map', MAP_OPTS).setView(BA_CENTER, 12);
L.tileLayer(TILE_URL, TILE_OPTS).addTo(map);
// Con tiles OSM (sin key de CARTO), un filtro suave los muta para la UI oscura.
if (!CARTO_KEY) map.getContainer().classList.add('osm-fallback');

function popupHtml(c) {
  const today = todayIso();
  const grouped = screeningsByDay(c);
  let rows = '';
  for (let d = 0; d < 7; d++) {
    const list = (grouped.get(d) || []).filter(s => !s.date || s.date >= today);
    if (!list.length) continue;
    const times = list.slice(0, 3)
      .map(s => `${esc(s.time)} ${esc(s.movie)}${s.date ? ` <em>(${fmtDate(s.date)})</em>` : ''}`)
      .join('<br>');
    rows += `<tr><td>${DAYS[d]}</td><td>${times}${list.length > 3 ? '<br>…' : ''}</td></tr>`;
  }
  const schedule = rows
    ? `<table class="schedule-table">${rows}</table>`
    : '<p class="hint">Todavía no hay funciones cargadas.</p>';
  return `
    <div class="popup">
      ${c.poster ? `<img class="popup-cover" src="${esc(c.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ''}
      <strong>${esc(c.name)}</strong><br>
      <span class="addr">${esc(c.address || '')}</span>
      ${schedule}
      <button class="btn secondary small" onclick="openDetail('${c.id}')">Ver detalle</button>
    </div>`;
}

function renderMarkers() {
  for (const m of state.markers.values()) map.removeLayer(m);
  state.markers.clear();
  for (const c of state.cinemas) {
    const marker = L.marker([c.lat, c.lng], { icon: pinIcon }).addTo(map).bindPopup(popupHtml(c));
    state.markers.set(c.id, marker);
  }
}

// ---------- sidebar ----------
function matchesQuery(c) {
  if (!state.query) return true;
  const hay = norm([c.name, c.address, c.description, ...c.screenings.map(s => s.movie)].join(' '));
  return hay.includes(state.query);
}

// Filtros a nivel función: precio máximo ("hasta $") y franja horaria.
function screeningMatches(s) {
  const f = state.filters;
  if (f.price) {
    const idx = PRICE_ORDER.indexOf(s.price);
    if (idx === -1 || idx > PRICE_ORDER.indexOf(f.price)) return false;
  }
  if (f.time) {
    const slot = TIME_SLOTS.find(t => t.id === f.time);
    const h = Number(s.time.slice(0, 2));
    if (slot && (h < slot.from || h >= slot.to)) return false;
  }
  return true;
}

function cinemaMatches(c) {
  if (!matchesQuery(c)) return false;
  const f = state.filters;
  if (f.radius && state.userPos &&
      haversineKm(state.userPos.lat, state.userPos.lng, c.lat, c.lng) > f.radius) return false;
  if (f.price || f.time) return c.screenings.some(screeningMatches);
  return true;
}

function hasFilters() {
  const f = state.filters;
  return !!(f.price || f.time || (f.radius && state.userPos));
}

function renderList() {
  const list = document.getElementById('cinemaList');
  let cinemas = state.cinemas.filter(cinemaMatches);
  // "Funciones hoy" = la próxima función del cine es hoy (no empezó todavía)
  if (state.onlyToday) cinemas = cinemas.filter(c => nextScreening(c)?.delta === 0);

  if (state.userPos) {
    cinemas.sort((a, b) =>
      haversineKm(state.userPos.lat, state.userPos.lng, a.lat, a.lng) -
      haversineKm(state.userPos.lat, state.userPos.lng, b.lat, b.lng));
  } else {
    cinemas.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  const title = document.getElementById('sidebarTitle');
  if (state.query || state.onlyToday || hasFilters()) {
    title.textContent = `${cinemas.length} resultado${cinemas.length === 1 ? '' : 's'}`;
  } else {
    title.textContent = state.userPos ? 'Cines ordenados por distancia' : 'Todos los cines';
  }

  if (!cinemas.length) {
    list.innerHTML = state.cinemas.length
      ? '<p class="empty">Sin resultados.<br>Probá con otra búsqueda o filtro.</p>'
      : '<p class="empty">Todavía no hay cines registrados.<br>¡Sé el primero!</p>';
    return;
  }

  list.innerHTML = cinemas.map(c => {
    const isOwner = !!ownerToken(c.id);
    const dist = state.userPos
      ? `<p class="distance">a ${haversineKm(state.userPos.lat, state.userPos.lng, c.lat, c.lng).toFixed(1)} km</p>`
      : '';
    const next = nextScreening(c);
    const nextHtml = next
      ? `<p class="next">${next.delta === 0 ? 'Hoy' : screeningLabel(next.s)} ${esc(next.s.time)} — ${esc(next.s.movie)}</p>`
      : '<p class="next none">Sin funciones cargadas</p>';
    return `
      <div class="cinema-card" data-id="${c.id}">
        ${c.poster ? `<img class="card-cover" src="${esc(c.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ''}
        <div class="card-body">
          <h3>${esc(c.name)}${isOwner ? '<span class="owner-badge">tu cine</span>' : ''}</h3>
          <p class="addr">${esc(c.address || 'Sin dirección')}</p>
          ${dist}${nextHtml}
        </div>
      </div>`;
  }).join('');

  for (const card of list.querySelectorAll('.cinema-card')) {
    card.addEventListener('click', () => {
      const c = state.cinemas.find(x => x.id === card.dataset.id);
      if (!c) return;
      map.flyTo([c.lat, c.lng], 15, { duration: 0.6 });
      state.markers.get(c.id)?.openPopup();
    });
  }
}

// ---------- cartelera (todas las funciones de un día) ----------
function renderCartelera() {
  const el = document.getElementById('carteleraList');
  const d = state.carteleraDay;
  // Cada chip de día = la próxima ocurrencia de ese día (una fecha concreta):
  // las funciones únicas entran solo si su fecha coincide.
  const now = new Date();
  const todayIdx = jsDayToOurs(now.getDay());
  const diff = (d - todayIdx + 7) % 7;
  const targetIso = toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff));

  const items = [];
  for (const c of state.cinemas) {
    if (!cinemaMatches(c)) continue;
    for (const s of c.screenings) {
      if (!screeningMatches(s)) continue;
      if (s.date ? s.date === targetIso : s.day === d) items.push({ c, s });
    }
  }
  items.sort((a, b) => a.s.time.localeCompare(b.s.time));

  document.getElementById('sidebarTitle').textContent =
    d === todayIdx ? 'Funciones de hoy' : `Funciones del ${DAYS[d].toLowerCase()} ${fmtDate(targetIso)}`;

  if (!items.length) {
    el.innerHTML = '<p class="empty">No hay funciones cargadas para este día.</p>';
    return;
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  el.innerHTML = items.map(({ c, s }) => {
    const [h, m] = s.time.split(':').map(Number);
    const past = d === todayIdx && h * 60 + m <= nowMin;
    const img = s.poster || c.poster;
    return `
      <div class="cart-item${past ? ' past' : ''}" data-id="${c.id}">
        ${img ? `<img class="cart-poster" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ''}
        <span class="cart-time">${esc(s.time)}</span>
        <div>
          <span class="cart-movie">${esc(s.movie)}${s.date ? ` <span class="cart-date">· ${fmtDate(s.date)}</span>` : ''}${s.age ? ` <span class="tag tag-age">${AGE_LABELS[s.age]}</span>` : ''}</span>
          <span class="cart-cinema">${esc(c.name)}${s.notes ? ` · ${esc(s.notes)}` : ''}${s.price ? ` · ${PRICE_LABELS[s.price]}` : ''}</span>
        </div>
      </div>`;
  }).join('');

  for (const item of el.querySelectorAll('.cart-item')) {
    item.addEventListener('click', () => {
      const c = state.cinemas.find(x => x.id === item.dataset.id);
      if (!c) return;
      map.flyTo([c.lat, c.lng], 14, { duration: 0.6 });
      openDetail(c.id);
    });
  }
}

function renderSidebar() {
  const cinemasTab = state.tab === 'cinemas';
  document.getElementById('cinemaList').classList.toggle('hidden', !cinemasTab);
  document.getElementById('carteleraList').classList.toggle('hidden', cinemasTab);
  document.getElementById('cinemaControls').classList.toggle('hidden', !cinemasTab);
  document.getElementById('carteleraControls').classList.toggle('hidden', cinemasTab);
  if (cinemasTab) renderList(); else renderCartelera();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    if (state.tab === tab.dataset.tab) return;
    state.tab = tab.dataset.tab;
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
    renderSidebar();
  });
}

document.getElementById('searchInput').addEventListener('input', e => {
  state.query = norm(e.target.value.trim());
  renderSidebar();
});

document.getElementById('todayChip').addEventListener('click', () => {
  state.onlyToday = !state.onlyToday;
  document.getElementById('todayChip').classList.toggle('active', state.onlyToday);
  renderList();
});

// ---------- filtros ----------
{
  const priceSel = document.getElementById('fPrice');
  for (const p of PRICE_ORDER) {
    const label = p === 'gratis' ? 'Gratis' : `Hasta ${PRICE_LABELS[p]}`;
    priceSel.insertAdjacentHTML('beforeend', `<option value="${p}">${label}</option>`);
  }
  const timeSel = document.getElementById('fTime');
  for (const t of TIME_SLOTS) {
    timeSel.insertAdjacentHTML('beforeend', `<option value="${t.id}">${t.label}</option>`);
  }

  priceSel.addEventListener('change', () => { state.filters.price = priceSel.value; renderSidebar(); });
  timeSel.addEventListener('change', () => { state.filters.time = timeSel.value; renderSidebar(); });

  const radiusSel = document.getElementById('fRadius');
  radiusSel.addEventListener('change', () => {
    const km = Number(radiusSel.value);
    if (km && !state.userPos) {
      // El filtro de distancia necesita la ubicación: pedirla primero.
      requestLocation(() => { state.filters.radius = km; },
        () => { radiusSel.value = '0'; state.filters.radius = 0; });
      return;
    }
    state.filters.radius = km;
    renderSidebar();
  });
}

{
  const dayChipsEl = document.getElementById('dayChips');
  const today = jsDayToOurs(new Date().getDay());
  dayChipsEl.innerHTML = DAY_SHORT.map((d, i) =>
    `<button class="day-chip${i === state.carteleraDay ? ' active' : ''}${i === today ? ' today' : ''}" data-day="${i}">${d}</button>`
  ).join('');
  dayChipsEl.addEventListener('click', e => {
    const btn = e.target.closest('.day-chip');
    if (!btn) return;
    state.carteleraDay = Number(btn.dataset.day);
    for (const b of dayChipsEl.querySelectorAll('.day-chip')) b.classList.toggle('active', b === btn);
    renderCartelera();
  });
}

// ---------- detail / manage ----------
window.openDetail = function (id) {
  const c = state.cinemas.find(x => x.id === id);
  if (!c) return;
  state.editingScreeningId = null;
  history.replaceState(null, '', `#cine=${c.id}`);
  const today = todayIso();
  const grouped = screeningsByDay(c);
  let rows = '';
  for (let d = 0; d < 7; d++) {
    for (const s of grouped.get(d) || []) {
      if (s.date && s.date < today) continue; // función única ya pasada
      const poster = s.poster
        ? `<img class="sched-poster" src="${esc(s.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />`
        : '';
      const badges =
        (s.price ? `<span class="tag">${PRICE_LABELS[s.price]}</span>` : '') +
        (s.age ? `<span class="tag tag-age">${AGE_LABELS[s.age]}</span>` : '');
      rows += `<tr><td>${screeningLabel(s)}</td><td>${esc(s.time)} — ${poster}<strong>${esc(s.movie)}</strong>` +
        `${s.notes ? ` <span class="notes">(${esc(s.notes)})</span>` : ''}${badges}</td></tr>`;
    }
  }
  const schedule = rows
    ? `<table class="schedule-table">${rows}</table>`
    : '<p class="hint">Todavía no hay funciones cargadas.</p>';

  // Botones de acción: cada clic cuenta como señal de intención para el dueño.
  const waNum = (c.whatsapp || '').replace(/^\+/, '');
  const actions = [
    c.website ? `<a class="btn ghost small" href="${esc(c.website)}" target="_blank" rel="noopener" data-track="website">🌐 Sitio web</a>` : '',
    c.phone ? `<a class="btn ghost small" href="tel:${esc(c.phone)}" data-track="phone">📞 ${esc(c.phone)}</a>` : '',
    c.whatsapp ? `<a class="btn ghost small" href="https://wa.me/${esc(waNum)}" target="_blank" rel="noopener" data-track="whatsapp">💬 WhatsApp</a>` : '',
    `<a class="btn ghost small" href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}" target="_blank" rel="noopener" data-track="directions">🧭 Cómo llegar</a>`
  ].join('');

  let manage = '';
  if (ownerToken(c.id)) {
    const screeningRows = c.screenings
      .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
      .map(s => {
        const past = s.date && s.date < today;
        return `
        <div class="screening-row${past ? ' past' : ''}">
          <span>${screeningLabel(s)} ${esc(s.time)} — ${esc(s.movie)}${past ? ' · pasada' : ''}</span>
          <span class="row-actions">
            <button class="btn ghost small" data-edit-screening="${s.id}">Editar</button>
            <button class="btn danger small" data-del-screening="${s.id}">Eliminar</button>
          </span>
        </div>`;
      }).join('');

    const adminUrl = `${location.href.split('#')[0]}#admin=${c.id}:${ownerToken(c.id)}`;
    const st = c.stats || {};

    const priceNames = { gratis: 'Gratis', bajo: '$ económico', medio: '$$ moderado', alto: '$$$ caro' };
    const priceOpts = '<option value="">Precio — opcional</option>' +
      PRICE_ORDER.map(p => `<option value="${p}">${priceNames[p]}</option>`).join('');
    const ageOpts = '<option value="">Edad — opcional</option>' +
      Object.entries(AGE_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');

    manage = `
      <div class="manage-section">
        <h3>Administrar (sos el dueño de este cine)</h3>
        <div class="stats-block">
          <p class="hint"><strong>Estadísticas</strong> — vistas del perfil: <b>${st.view || 0}</b> ·
            clics: sitio web ${st.website || 0} · cómo llegar ${st.directions || 0} ·
            teléfono ${st.phone || 0} · whatsapp ${st.whatsapp || 0}</p>
        </div>
        <div class="manage-grid">
          <input id="newMovie" placeholder="Película o evento" maxlength="200" />
          <select id="newDay" title="Día de la semana">${DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>
          <input id="newTime" type="time" title="Horario" />
          <input id="newDate" type="date" title="Fecha puntual (función única)" />
        </div>
        <p class="hint">Sin fecha = función semanal. Con fecha = función única (estreno, evento…).</p>
        <div class="manage-grid-2">
          <select id="newPrice" title="Precio">${priceOpts}</select>
          <select id="newAge" title="Restricción de edad">${ageOpts}</select>
        </div>
        <div class="manage-grid-2">
          <input id="newNotes" placeholder="Notas (sala, precio, formato…) — opcional" maxlength="300" />
          <input id="newPoster" placeholder="Póster (URL) — opcional" maxlength="500" />
        </div>
        <div class="screening-form-actions">
          <button id="addScreeningBtn" class="btn primary small">Agregar función</button>
          <button id="cancelEditBtn" class="btn ghost small hidden">Cancelar</button>
        </div>
        <p id="manageError" class="error hidden"></p>
        <div style="margin-top:12px">${screeningRows || '<p class="hint">Sin funciones todavía.</p>'}</div>
        <div class="csv-import">
          <p class="hint">Importar funciones desde CSV: columnas <code>dia,pelicula,hora,notas</code>
            (día: nombre o 1–7, Lunes=1; hora HH:MM). Opcionales: <code>fecha</code> (AAAA-MM-DD o
            DD/MM/AAAA, función única), <code>poster</code> (URL), <code>precio</code>
            (gratis, $, $$, $$$) y <code>edad</code> (atp, 13, 16, 18).
            Se aceptan <code>,</code> o <code>;</code> como separador.
            <a href="ejemplo-funciones.csv" download>Descargar ejemplo</a></p>
          <input type="file" id="csvFile" accept=".csv,text/csv" />
          <button id="importCsvBtn" class="btn ghost small">Importar CSV</button>
        </div>
        <div class="csv-import">
          <p class="hint">Enlace de administración — guardalo para editar este cine desde otro
            navegador o si perdés el acceso. <strong>Es secreto:</strong> quien lo tenga puede modificar el cine.</p>
          <div class="admin-link-row">
            <input id="adminLink" readonly value="${esc(adminUrl)}" />
            <button id="copyAdminLink" class="btn ghost small">Copiar</button>
          </div>
        </div>
        <div style="margin-top:14px; display:flex; gap:8px;">
          <button id="editCinemaBtn" class="btn ghost small">Editar datos del cine</button>
          <button id="deleteCinemaBtn" class="btn danger small">Eliminar cine del mapa</button>
        </div>
      </div>`;
  }

  document.getElementById('detailBody').innerHTML = `
    ${c.poster ? `<img class="detail-cover" src="${esc(c.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ''}
    <h2>${esc(c.name)}</h2>
    <p class="detail-addr">${esc(c.address || '')}</p>
    ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
    <div class="detail-actions">${actions}</div>
    <div class="detail-actions">
      <button id="shareBtn" class="btn ghost small">🔗 Copiar enlace</button>
    </div>
    <h3 class="detail-kicker">Funciones</h3>
    ${schedule}
    ${manage}`;

  document.getElementById('detailModal').classList.remove('hidden');

  // Métricas del dueño: cuenta la vista y los clics de intención (no del propio dueño).
  if (!ownerToken(c.id)) {
    track(c.id, 'view');
    for (const a of document.querySelectorAll('#detailBody [data-track]')) {
      a.addEventListener('click', () => track(c.id, a.dataset.track));
    }
  }

  document.getElementById('shareBtn').addEventListener('click', e => {
    copyText(cinemaUrl(c.id), e.target);
  });

  if (ownerToken(c.id)) {
    document.getElementById('addScreeningBtn').addEventListener('click', () => addScreening(c.id));
    document.getElementById('cancelEditBtn').addEventListener('click', resetScreeningForm);
    document.getElementById('newDate').addEventListener('change', e => {
      const sel = document.getElementById('newDay');
      const w = isoWeekday(e.target.value);
      if (w !== null) { sel.value = String(w); sel.disabled = true; }
      else sel.disabled = false;
    });
    for (const btn of document.querySelectorAll('[data-edit-screening]')) {
      btn.addEventListener('click', () => {
        const s = c.screenings.find(x => x.id === btn.dataset.editScreening);
        if (!s) return;
        state.editingScreeningId = s.id;
        document.getElementById('newMovie').value = s.movie;
        document.getElementById('newDay').value = String(s.day);
        document.getElementById('newDay').disabled = !!s.date;
        document.getElementById('newTime').value = s.time;
        document.getElementById('newDate').value = s.date || '';
        document.getElementById('newPrice').value = s.price || '';
        document.getElementById('newAge').value = s.age || '';
        document.getElementById('newNotes').value = s.notes;
        document.getElementById('newPoster').value = s.poster || '';
        document.getElementById('addScreeningBtn').textContent = 'Guardar función';
        document.getElementById('cancelEditBtn').classList.remove('hidden');
        document.getElementById('newMovie').focus();
      });
    }
    document.getElementById('copyAdminLink').addEventListener('click', e => {
      copyText(document.getElementById('adminLink').value, e.target);
    });
    document.getElementById('editCinemaBtn').addEventListener('click', () => {
      closeModals();
      openRegister(c);
    });
    document.getElementById('importCsvBtn').addEventListener('click', () => importCsv(c.id));
    for (const btn of document.querySelectorAll('[data-del-screening]')) {
      btn.addEventListener('click', async () => {
        try {
          await api(`api/cinemas/${c.id}/screenings/${btn.dataset.delScreening}`,
            { method: 'DELETE', headers: authHeaders(c.id) });
          await reload();
          openDetail(c.id);
        } catch (e) { showManageError(e.message); }
      });
    }
    document.getElementById('deleteCinemaBtn').addEventListener('click', async () => {
      if (!confirm('¿Seguro que querés eliminar este cine y todas sus funciones?')) return;
      try {
        await api(`api/cinemas/${c.id}`, { method: 'DELETE', headers: authHeaders(c.id) });
        localStorage.removeItem('cinemita_token_' + c.id);
        closeModals();
        await reload();
      } catch (e) { showManageError(e.message); }
    });
  }
};

function showManageError(msg) {
  const el = document.getElementById('manageError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copiado ✓';
    setTimeout(() => { btn.textContent = old; }, 1500);
  } catch {
    const el = document.getElementById('adminLink');
    if (el) { el.select(); document.execCommand('copy'); }
  }
}

function resetScreeningForm() {
  state.editingScreeningId = null;
  document.getElementById('newMovie').value = '';
  document.getElementById('newDay').value = '0';
  document.getElementById('newDay').disabled = false;
  document.getElementById('newTime').value = '';
  document.getElementById('newDate').value = '';
  document.getElementById('newPrice').value = '';
  document.getElementById('newAge').value = '';
  document.getElementById('newNotes').value = '';
  document.getElementById('newPoster').value = '';
  document.getElementById('addScreeningBtn').textContent = 'Agregar función';
  document.getElementById('cancelEditBtn').classList.add('hidden');
}

async function addScreening(cinemaId) {
  const movie = document.getElementById('newMovie').value.trim();
  const day = document.getElementById('newDay').value;
  const time = document.getElementById('newTime').value;
  const date = document.getElementById('newDate').value;
  const price = document.getElementById('newPrice').value;
  const age = document.getElementById('newAge').value;
  const notes = document.getElementById('newNotes').value.trim();
  const poster = document.getElementById('newPoster').value.trim();
  const editing = state.editingScreeningId;
  try {
    await api(editing ? `api/cinemas/${cinemaId}/screenings/${editing}` : `api/cinemas/${cinemaId}/screenings`, {
      method: editing ? 'PUT' : 'POST',
      headers: authHeaders(cinemaId),
      body: JSON.stringify({ movie, day: Number(day), date, time, notes, poster, price, age })
    });
    state.editingScreeningId = null;
    await reload();
    openDetail(cinemaId);
  } catch (e) { showManageError(e.message); }
}

// ---------- CSV import ----------
// Formato: dia,pelicula,hora,notas — día como nombre (lunes…domingo, con o sin
// tilde) o número 1–7 (Lunes=1); hora HH:MM o H:MM; notas opcional.
// Se detecta el separador (, o ;) en la línea del encabezado.
const DAY_TOKENS = { lunes: 0, martes: 1, miercoles: 2, jueves: 3, viernes: 4, sabado: 5, domingo: 6 };

function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function dayFromToken(token) {
  const t = stripAccents(token.trim().toLowerCase());
  if (t in DAY_TOKENS) return DAY_TOKENS[t];
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 7) return n - 1;
  return null;
}

// Devuelven '' si la celda está vacía (usa el valor por defecto) o null si es inválida.
function priceFromToken(t) {
  const k = stripAccents((t || '').trim().toLowerCase());
  if (!k) return '';
  const map = { gratis: 'gratis', '$': 'bajo', '$$': 'medio', '$$$': 'alto',
    bajo: 'bajo', economico: 'bajo', medio: 'medio', moderado: 'medio', alto: 'alto', caro: 'alto' };
  return map[k] ?? null;
}
function ageFromToken(t) {
  const k = stripAccents((t || '').trim().toLowerCase().replace(/^\+/, ''));
  if (!k) return '';
  return AGE_LABELS[k] ? k : null;
}

// Acepta AAAA-MM-DD o DD/MM/AAAA; devuelve ISO o null.
function csvDateToIso(s) {
  s = s.trim();
  let y, mo, d;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; }
  else {
    const lat = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (!lat) return null;
    d = +lat[1]; mo = +lat[2]; y = +lat[3];
  }
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());

  if (!lines.length) return { error: 'El archivo está vacío' };

  const delim = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const rows = lines.map(line => {
    const cells = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delim) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  });

  const header = rows[0].map(h => stripAccents(h.trim().toLowerCase()));
  const col = { day: header.indexOf('dia'), movie: header.indexOf('pelicula'), time: header.indexOf('hora') };
  col.notes = header.indexOf('notas');
  col.date = header.indexOf('fecha');
  col.poster = header.indexOf('poster');
  col.price = header.indexOf('precio');
  col.age = header.indexOf('edad');
  if (col.day === -1 || col.movie === -1 || col.time === -1) {
    return { error: 'Encabezado inválido. Se espera: dia,pelicula,hora,notas' };
  }

  const screenings = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const movie = (r[col.movie] || '').trim();
    let time = (r[col.time] || '').trim();
    if (/^\d:\d{2}$/.test(time)) time = '0' + time;
    const notes = col.notes === -1 ? '' : (r[col.notes] || '').trim();
    const poster = col.poster === -1 ? '' : (r[col.poster] || '').trim();
    const dateRaw = col.date === -1 ? '' : (r[col.date] || '').trim();
    const date = dateRaw ? csvDateToIso(dateRaw) : '';
    if (dateRaw && !date) {
      return { error: `Fila ${i + 1}: fecha inválida ("${dateRaw}"; usar AAAA-MM-DD o DD/MM/AAAA)` };
    }
    let day;
    if (date) {
      day = isoWeekday(date);
    } else {
      day = dayFromToken(r[col.day] || '');
      if (day === null) return { error: `Fila ${i + 1}: día inválido ("${(r[col.day] || '').trim()}")` };
    }
    if (!movie) return { error: `Fila ${i + 1}: falta el título de la película` };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return { error: `Fila ${i + 1}: hora inválida ("${time}", usar HH:MM)` };
    }
    const price = col.price === -1 ? '' : priceFromToken(r[col.price]);
    if (price === null) return { error: `Fila ${i + 1}: precio inválido ("${(r[col.price] || '').trim()}")` };
    const age = col.age === -1 ? '' : ageFromToken(r[col.age]);
    if (age === null) return { error: `Fila ${i + 1}: edad inválida ("${(r[col.age] || '').trim()}")` };
    screenings.push({ day, date, movie, time, notes, poster, price, age });
  }
  if (!screenings.length) return { error: 'El archivo no tiene funciones' };
  return { screenings };
}

async function importCsv(cinemaId) {
  const input = document.getElementById('csvFile');
  if (!input.files.length) { showManageError('Elegí un archivo CSV primero.'); return; }
  const text = await input.files[0].text();
  const { screenings, error } = parseCsv(text);
  if (error) { showManageError(error); return; }
  try {
    const res = await api(`api/cinemas/${cinemaId}/screenings/bulk`, {
      method: 'POST',
      headers: authHeaders(cinemaId),
      body: JSON.stringify({ screenings })
    });
    await reload();
    openDetail(cinemaId);
    alert(`Se importaron ${res.added} funciones.`);
  } catch (e) { showManageError(e.message); }
}

// ---------- register / edit modal ----------
const registerModal = document.getElementById('registerModal');
const registerForm = document.getElementById('registerForm');

function openRegister(cinema = null) {
  state.editingId = cinema ? cinema.id : null;
  document.getElementById('registerModalTitle').textContent =
    cinema ? 'Editar cine' : 'Registrar mi cine';
  document.getElementById('registerSubmitBtn').textContent =
    cinema ? 'Guardar cambios' : 'Registrar cine';

  registerForm.reset();
  document.getElementById('registerError').classList.add('hidden');
  if (state.pickMarker) { state.pickMap?.removeLayer(state.pickMarker); state.pickMarker = null; }
  state.pickedLatLng = null;
  document.getElementById('pickedCoords').textContent = 'Sin ubicación seleccionada';

  if (cinema) {
    registerForm.name.value = cinema.name;
    registerForm.address.value = cinema.address;
    registerForm.description.value = cinema.description;
    registerForm.phone.value = cinema.phone || '';
    registerForm.whatsapp.value = cinema.whatsapp || '';
    registerForm.website.value = cinema.website;
    registerForm.poster.value = cinema.poster || '';
  }

  registerModal.classList.remove('hidden');
  if (!state.pickMap) {
    state.pickMap = L.map('pickMap', MAP_OPTS).setView(BA_CENTER, 12);
    L.tileLayer(TILE_URL, TILE_OPTS).addTo(state.pickMap);
    if (!CARTO_KEY) state.pickMap.getContainer().classList.add('osm-fallback');
    state.pickMap.on('click', e => setPicked(e.latlng));
  }
  if (cinema) setPicked({ lat: cinema.lat, lng: cinema.lng });
  setTimeout(() => state.pickMap.invalidateSize(), 50);
}

function setPicked(latlng) {
  state.pickedLatLng = latlng;
  if (state.pickMarker) state.pickMarker.setLatLng(latlng);
  else state.pickMarker = L.marker(latlng, { draggable: true }).addTo(state.pickMap);
  state.pickMarker.on('dragend', () => setPicked(state.pickMarker.getLatLng()));
  document.getElementById('pickedCoords').textContent =
    `Ubicación: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

document.getElementById('searchAddressBtn').addEventListener('click', async () => {
  const q = registerForm.address.value.trim();
  if (!q) return;
  const btn = document.getElementById('searchAddressBtn');
  const resultsEl = document.getElementById('addrResults');
  btn.disabled = true;
  try {
    // viewbox prioriza resultados dentro de CABA/GBA pero permite otros (bounded=0)
    const res = await fetch(
      'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ar' +
      '&viewbox=-58.60,-34.51,-58.30,-34.72&bounded=0&q=' + encodeURIComponent(q));
    const results = await res.json();
    if (!results.length) {
      resultsEl.classList.add('hidden');
      document.getElementById('pickedCoords').textContent =
        'Dirección no encontrada — hacé clic en el mapa.';
      return;
    }
    resultsEl.innerHTML = '';
    for (const r of results) {
      const li = document.createElement('li');
      li.textContent = r.display_name;
      li.addEventListener('click', () => {
        const ll = { lat: +r.lat, lng: +r.lon };
        setPicked(ll);
        state.pickMap.setView(ll, 16);
        registerForm.address.value = r.display_name.split(',').slice(0, 3).join(',').trim();
        resultsEl.classList.add('hidden');
      });
      resultsEl.appendChild(li);
    }
    resultsEl.classList.remove('hidden');
  } catch {
    document.getElementById('pickedCoords').textContent =
      'No se pudo buscar la dirección — hacé clic en el mapa.';
  } finally {
    btn.disabled = false;
  }
});

registerForm.addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('registerError');
  err.classList.add('hidden');
  if (!state.pickedLatLng) {
    err.textContent = 'Marcá la ubicación del cine en el mapa.';
    err.classList.remove('hidden');
    return;
  }
  const payload = {
    name: registerForm.name.value,
    address: registerForm.address.value,
    description: registerForm.description.value,
    phone: registerForm.phone.value,
    whatsapp: registerForm.whatsapp.value,
    website: registerForm.website.value,
    poster: registerForm.poster.value,
    lat: state.pickedLatLng.lat,
    lng: state.pickedLatLng.lng,
  };
  try {
    if (state.editingId) {
      await api(`api/cinemas/${state.editingId}`, {
        method: 'PUT',
        headers: authHeaders(state.editingId),
        body: JSON.stringify(payload)
      });
      const id = state.editingId;
      closeModals();
      await reload();
      openDetail(id);
    } else {
      const created = await api('api/cinemas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      localStorage.setItem('cinemita_token_' + created.id, created.ownerToken);
      closeModals();
      await reload();
      openDetail(created.id);
    }
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
  }
});

// ---------- geolocation ----------
let userMarker = null;
function requestLocation(onDone, onFail) {
  if (!navigator.geolocation) {
    alert('Tu navegador no soporta geolocalización.');
    onFail?.();
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (userMarker) userMarker.setLatLng(state.userPos);
    else {
      userMarker = L.marker(state.userPos, { icon: meIcon })
        .addTo(map).bindPopup('Estás acá');
    }
    onDone?.();
    renderSidebar();
  }, () => { alert('No se pudo obtener tu ubicación.'); onFail?.(); });
}

document.getElementById('locateBtn').addEventListener('click', () => {
  requestLocation(() => map.flyTo(state.userPos, 13, { duration: 0.8 }));
});

// ---------- misc ----------
function closeModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  if (location.hash.startsWith('#cine=')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}
for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', closeModals);
}
for (const m of document.querySelectorAll('.modal')) {
  m.addEventListener('click', e => { if (e.target === m) closeModals(); });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
document.getElementById('registerBtn').addEventListener('click', () => openRegister());

async function reload() {
  state.cinemas = await api('api/cinemas');
  renderMarkers();
  renderSidebar();
}

async function loadInitial() {
  try {
    state.cinemas = await remoteApi('api/cinemas');
  } catch {
    DEMO = true;
    document.getElementById('demoBadge').classList.remove('hidden');
    state.cinemas = await demoDb.init();
  }
  renderMarkers();
  renderSidebar();

  // Deep link: #cine=<id> abre el detalle del cine directamente
  const deep = location.hash.match(/^#cine=([A-Za-z0-9-]+)/);
  if (deep) {
    const c = state.cinemas.find(x => x.id === deep[1]);
    if (c) {
      map.flyTo([c.lat, c.lng], 14, { duration: 0.6 });
      openDetail(c.id);
    }
  }
}

loadInitial().catch(e => {
  document.getElementById('cinemaList').innerHTML =
    `<p class="empty">Error al cargar: ${esc(e.message)}</p>`;
});
