/* Cinemita — mapa de cines independientes de Buenos Aires */

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const BA_CENTER = [-34.6037, -58.3816];

const state = {
  cinemas: [],
  markers: new Map(),
  userPos: null,
  pickMap: null,
  pickMarker: null,
  pickedLatLng: null,
  editingId: null,
};

// ---------- utils ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function ownerToken(cinemaId) {
  return localStorage.getItem('cinemita_token_' + cinemaId);
}

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

// ---------- modo demo (sin backend: datos en localStorage) ----------
let DEMO = false;
const DEMO_DB_KEY = 'cinemita_demo_db';

const demoDb = {
  load() {
    try { return JSON.parse(localStorage.getItem(DEMO_DB_KEY)) || { cinemas: [] }; }
    catch { return { cinemas: [] }; }
  },
  save(db) { localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db)); },
  async init() {
    if (!localStorage.getItem(DEMO_DB_KEY)) {
      const seed = await (await fetch('data/seed.json')).json();
      this.save(seed);
    }
    return this.load().cinemas;
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

function demoScreening(b) {
  const movie = (b.movie || '').trim().slice(0, 200);
  const day = Number(b.day);
  const time = (b.time || '').trim();
  const notes = (b.notes || '').trim().slice(0, 300);
  if (!movie) throw new Error('El título de la película es obligatorio');
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('Día inválido');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Hora inválida (formato HH:MM)');
  return { id: crypto.randomUUID(), movie, day, time, notes };
}

async function demoApi(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  const db = demoDb.load();
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
    const created = {
      id: crypto.randomUUID(), ownerToken: crypto.randomUUID(), name,
      address: (body.address || '').trim().slice(0, 200),
      description: (body.description || '').trim().slice(0, 1000),
      website, lat, lng, screenings: [], createdAt: new Date().toISOString()
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
  const today = jsDayToOurs(now.getDay());
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let best = null;
  for (const s of cinema.screenings) {
    const [h, m] = s.time.split(':').map(Number);
    let delta = (s.day - today + 7) % 7;
    if (delta === 0 && h * 60 + m <= nowMin) delta = 7;
    if (!best || delta < best.delta || (delta === best.delta && s.time < best.s.time)) {
      best = { s, delta };
    }
  }
  return best;
}

// ---------- map ----------
const WORLD_BOUNDS = [[-85, -180], [85, 180]];
const TILE_OPTS = {
  maxZoom: 19,
  noWrap: true,
  bounds: [[-90, -180], [90, 180]],
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
};
const MAP_OPTS = {
  minZoom: 3,
  maxBounds: L.latLngBounds(WORLD_BOUNDS),
  maxBoundsViscosity: 1.0
};

const map = L.map('map', MAP_OPTS).setView(BA_CENTER, 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', TILE_OPTS).addTo(map);

function popupHtml(c) {
  const grouped = screeningsByDay(c);
  let rows = '';
  for (let d = 0; d < 7; d++) {
    const list = grouped.get(d) || [];
    if (!list.length) continue;
    const times = list.slice(0, 3).map(s => `${esc(s.time)} ${esc(s.movie)}`).join('<br>');
    rows += `<tr><td>${DAYS[d]}</td><td>${times}${list.length > 3 ? '<br>…' : ''}</td></tr>`;
  }
  const schedule = rows
    ? `<table class="schedule-table">${rows}</table>`
    : '<p class="hint">Todavía no hay funciones cargadas.</p>';
  return `
    <div class="popup">
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
    const marker = L.marker([c.lat, c.lng]).addTo(map).bindPopup(popupHtml(c));
    state.markers.set(c.id, marker);
  }
}

// ---------- sidebar ----------
function renderList() {
  const list = document.getElementById('cinemaList');
  const cinemas = [...state.cinemas];
  if (state.userPos) {
    cinemas.sort((a, b) =>
      haversineKm(state.userPos.lat, state.userPos.lng, a.lat, a.lng) -
      haversineKm(state.userPos.lat, state.userPos.lng, b.lat, b.lng));
  } else {
    cinemas.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  if (!cinemas.length) {
    list.innerHTML = '<p class="empty">Todavía no hay cines registrados.<br>¡Sé el primero!</p>';
    return;
  }

  list.innerHTML = cinemas.map(c => {
    const isOwner = !!ownerToken(c.id);
    const dist = state.userPos
      ? `<p class="distance">a ${haversineKm(state.userPos.lat, state.userPos.lng, c.lat, c.lng).toFixed(1)} km</p>`
      : '';
    const next = nextScreening(c);
    const nextHtml = next
      ? `<p class="next">Próxima: ${next.delta === 0 ? 'hoy' : DAYS[next.s.day]} ${esc(next.s.time)} — ${esc(next.s.movie)}</p>`
      : '<p class="next">Sin funciones cargadas</p>';
    return `
      <div class="cinema-card" data-id="${c.id}">
        <h3>${esc(c.name)}${isOwner ? '<span class="owner-badge">tu cine</span>' : ''}</h3>
        <p class="addr">${esc(c.address || 'Sin dirección')}</p>
        ${dist}${nextHtml}
      </div>`;
  }).join('');

  for (const card of list.querySelectorAll('.cinema-card')) {
    card.addEventListener('click', () => {
      const c = state.cinemas.find(x => x.id === card.dataset.id);
      if (!c) return;
      map.setView([c.lat, c.lng], 15);
      state.markers.get(c.id)?.openPopup();
    });
  }
}

// ---------- detail / manage ----------
window.openDetail = function (id) {
  const c = state.cinemas.find(x => x.id === id);
  if (!c) return;
  const grouped = screeningsByDay(c);
  let rows = '';
  for (let d = 0; d < 7; d++) {
    for (const s of grouped.get(d) || []) {
      rows += `<tr><td>${DAYS[d]}</td><td>${esc(s.time)} — <strong>${esc(s.movie)}</strong>` +
        `${s.notes ? ` <span class="notes">(${esc(s.notes)})</span>` : ''}</td></tr>`;
    }
  }
  const schedule = rows
    ? `<table class="schedule-table">${rows}</table>`
    : '<p class="hint">Todavía no hay funciones cargadas.</p>';

  const website = c.website
    ? `<a class="website-link" href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>`
    : '';

  let manage = '';
  if (ownerToken(c.id)) {
    const screeningRows = c.screenings
      .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
      .map(s => `
        <div class="screening-row">
          <span>${DAYS[s.day]} ${esc(s.time)} — ${esc(s.movie)}</span>
          <button class="btn danger small" data-del-screening="${s.id}">Eliminar</button>
        </div>`).join('');

    manage = `
      <div class="manage-section">
        <h3>Administrar (sos el dueño de este cine)</h3>
        <div class="manage-grid">
          <input id="newMovie" placeholder="Película" maxlength="200" />
          <select id="newDay">${DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>
          <input id="newTime" type="time" />
        </div>
        <input id="newNotes" placeholder="Notas (sala, precio, formato…) — opcional" maxlength="300" />
        <button id="addScreeningBtn" class="btn primary small">Agregar función</button>
        <p id="manageError" class="error hidden"></p>
        <div style="margin-top:12px">${screeningRows || '<p class="hint">Sin funciones todavía.</p>'}</div>
        <div class="csv-import">
          <p class="hint">Importar funciones desde CSV: columnas <code>dia,pelicula,hora,notas</code>
            (día: nombre o 1–7, Lunes=1; hora HH:MM; notas opcional). Se aceptan <code>,</code> o <code>;</code> como separador.
            <a href="ejemplo-funciones.csv" download>Descargar ejemplo</a></p>
          <input type="file" id="csvFile" accept=".csv,text/csv" />
          <button id="importCsvBtn" class="btn secondary small">Importar CSV</button>
        </div>
        <div style="margin-top:14px; display:flex; gap:8px;">
          <button id="editCinemaBtn" class="btn secondary small">Editar datos del cine</button>
          <button id="deleteCinemaBtn" class="btn danger small">Eliminar cine del mapa</button>
        </div>
      </div>`;
  }

  document.getElementById('detailBody').innerHTML = `
    <h2>${esc(c.name)}</h2>
    <p class="addr">${esc(c.address || '')}</p>
    ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
    ${website}
    <h3 style="margin-top:14px">Funciones semanales</h3>
    ${schedule}
    ${manage}`;

  document.getElementById('detailModal').classList.remove('hidden');

  if (ownerToken(c.id)) {
    document.getElementById('addScreeningBtn').addEventListener('click', () => addScreening(c.id));
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

async function addScreening(cinemaId) {
  const movie = document.getElementById('newMovie').value.trim();
  const day = document.getElementById('newDay').value;
  const time = document.getElementById('newTime').value;
  const notes = document.getElementById('newNotes').value.trim();
  try {
    await api(`api/cinemas/${cinemaId}/screenings`, {
      method: 'POST',
      headers: authHeaders(cinemaId),
      body: JSON.stringify({ movie, day: Number(day), time, notes })
    });
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
  if (col.day === -1 || col.movie === -1 || col.time === -1) {
    return { error: 'Encabezado inválido. Se espera: dia,pelicula,hora,notas' };
  }

  const screenings = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const day = dayFromToken(r[col.day] || '');
    const movie = (r[col.movie] || '').trim();
    let time = (r[col.time] || '').trim();
    if (/^\d:\d{2}$/.test(time)) time = '0' + time;
    const notes = col.notes === -1 ? '' : (r[col.notes] || '').trim();
    if (day === null) return { error: `Fila ${i + 1}: día inválido ("${(r[col.day] || '').trim()}")` };
    if (!movie) return { error: `Fila ${i + 1}: falta el título de la película` };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return { error: `Fila ${i + 1}: hora inválida ("${time}", usar HH:MM)` };
    }
    screenings.push({ day, movie, time, notes });
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
    registerForm.website.value = cinema.website;
  }

  registerModal.classList.remove('hidden');
  if (!state.pickMap) {
    state.pickMap = L.map('pickMap', MAP_OPTS).setView(BA_CENTER, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', TILE_OPTS).addTo(state.pickMap);
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
    website: registerForm.website.value,
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
document.getElementById('locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Tu navegador no soporta geolocalización.');
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (userMarker) userMarker.setLatLng(state.userPos);
    else {
      userMarker = L.circleMarker(state.userPos, {
        radius: 8, color: '#fff', weight: 2, fillColor: '#1971c2', fillOpacity: 1
      }).addTo(map).bindPopup('Estás acá');
    }
    map.setView(state.userPos, 13);
    document.getElementById('sidebarTitle').textContent = 'Cines ordenados por distancia';
    renderList();
  }, () => alert('No se pudo obtener tu ubicación.'));
});

// ---------- misc ----------
function closeModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
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
  renderList();
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
  renderList();
}

loadInitial().catch(e => {
  document.getElementById('cinemaList').innerHTML =
    `<p class="empty">Error al cargar: ${esc(e.message)}</p>`;
});
