/* Cinemita — backend Firebase (Firestore + Auth con Google).
   app.js lo importa dinámicamente solo si firebase-config.js está configurado.
   En Android (Capacitor) el login usa el plugin nativo @capacitor-firebase/authentication;
   en web usa el popup estándar de Firebase Auth.
   - Los cines nuevos nacen con status 'pending' y solo se publican cuando un
     admin los aprueba (colección `admins` en Firestore).
   - Anti-spam: cada alta va en batch con users/{uid}.lastCinemaAt = ahora;
     las reglas de Firestore exigen ese marcador y un cooldown de 24 h. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential,
  signOut as fbSignOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, collection, doc, getDoc, getDocs,
  updateDoc, deleteDoc, increment, query, where, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const app = initializeApp(window.FIREBASE_CONFIG || window.firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });
const isNative = !!window.Capacitor?.isNativePlatform?.();

// ---------- auth ----------
// Se resuelve cuando el SDK conoce el estado de sesión (o la falta de ella).
let resolveAuthReady;
export const authReady = new Promise(r => { resolveAuthReady = r; });

let adminCache = null;
export function onAuth(cb) { return onAuthStateChanged(auth, cb); }
onAuthStateChanged(auth, () => { adminCache = null; resolveAuthReady(); });

export async function isAdmin() {
  if (!auth.currentUser) return false;
  if (adminCache === null) {
    try {
      adminCache = (await getDoc(doc(db, 'admins', auth.currentUser.uid))).exists();
      if (adminCache) console.info('Cinemita: sesión con permisos de admin');
    } catch (e) {
      console.warn('Cinemita: no se pudo verificar admin (¿reglas desactualizadas?)', e);
      adminCache = false;
    }
  }
  return adminCache;
}

export async function signIn() {
  if (isNative) {
    const { FirebaseAuthentication } = window.Capacitor.Plugins;
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('Google no devolvió credenciales');
    // Sincroniza la sesión nativa con el SDK web (para Firestore).
    await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  } else {
    await signInWithPopup(auth, new GoogleAuthProvider());
  }
}

export function logOut() { return fbSignOut(auth); }

// ---------- helpers ----------
function friendlyError(e) {
  if (e?.code === 'permission-denied' || e?.code === 'unauthenticated') {
    return new Error('No autorizado — iniciá sesión con la cuenta dueña del cine');
  }
  return e instanceof Error ? e : new Error(String(e));
}

function requireUser() {
  if (!auth.currentUser) throw new Error('Iniciá sesión con Google para continuar');
  return auth.currentUser;
}

// Reusa las validaciones del modo demo (funciones globales definidas en app.js).
const screeningOf = b => globalThis.demoScreening(b);
const normWeb = w => globalThis.normalizeWebsiteDemo(w);
const normPhone = p => globalThis.normalizePhoneDemo(p);

// Campos obligatorios validados para crear un cine.
function cinemaCreate(b) {
  const name = (b.name || '').trim().slice(0, 120);
  if (!name) throw new Error('El nombre es obligatorio');
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Ubicación inválida: marcá el cine en el mapa');
  }
  const website = normWeb(b.website);
  if (website === null) throw new Error('Sitio web inválido');
  const poster = normWeb(b.poster);
  if (poster === null) throw new Error('URL de imagen inválida');
  return {
    name, lat, lng, website, poster,
    address: (b.address || '').trim().slice(0, 200),
    description: (b.description || '').trim().slice(0, 1000),
    phone: normPhone(b.phone),
    whatsapp: normPhone(b.whatsapp)
  };
}

// Actualización parcial: solo los campos presentes (misma lógica que el modo demo).
function cinemaPatch(b) {
  const out = {};
  if (b.name !== undefined) {
    const name = (b.name || '').trim().slice(0, 120);
    if (!name) throw new Error('El nombre es obligatorio');
    out.name = name;
  }
  if (b.address !== undefined) out.address = (b.address || '').trim().slice(0, 200);
  if (b.description !== undefined) out.description = (b.description || '').trim().slice(0, 1000);
  if (b.website !== undefined) {
    const w = normWeb(b.website);
    if (w === null) throw new Error('Sitio web inválido');
    out.website = w;
  }
  if (b.poster !== undefined) {
    const p = normWeb(b.poster);
    if (p === null) throw new Error('URL de imagen inválida');
    out.poster = p;
  }
  if (b.phone !== undefined) out.phone = normPhone(b.phone);
  if (b.whatsapp !== undefined) out.whatsapp = normPhone(b.whatsapp);
  if (b.lat !== undefined || b.lng !== undefined) {
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Ubicación inválida');
    out.lat = lat; out.lng = lng;
  }
  return out;
}

const cinemasCol = collection(db, 'cinemas');
const cinemaRef = id => doc(db, 'cinemas', id);
const pub = d => ({ id: d.id, ...d.data() });

// Lee el doc y verifica que el usuario actual sea el dueño.
async function ownDoc(id) {
  const user = requireUser();
  const snap = await getDoc(cinemaRef(id));
  if (!snap.exists()) throw new Error('Cine no encontrado');
  if (snap.data().ownerUid !== user.uid) throw new Error('No autorizado');
  return snap;
}

// ---------- api (misma interfaz que demoApi/remoteApi de app.js) ----------
export async function api(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  const m = path.match(/^api\/cinemas(?:\/([^/]+))?(?:\/(.*))?$/);
  if (!m) throw new Error('Ruta inválida');
  const [, id, rest = ''] = m;

  try {
    if (method === 'GET' && !id) {
      // Espera a que Auth resuelva la sesión para incluir los cines propios
      // pendientes (los públicos solo devuelven los aprobados).
      await authReady;
      const snap = await getDocs(query(cinemasCol, where('status', '==', 'approved')));
      const out = new Map(snap.docs.map(d => [d.id, pub(d)]));
      if (auth.currentUser) {
        const mine = await getDocs(
          query(cinemasCol, where('ownerUid', '==', auth.currentUser.uid)));
        for (const d of mine.docs) out.set(d.id, pub(d));
      }
      return [...out.values()];
    }

    // GET api/cinemas/pending — solo admin.
    if (method === 'GET' && id === 'pending') {
      await authReady;
      if (!(await isAdmin())) throw new Error('No autorizado');
      const snap = await getDocs(query(cinemasCol, where('status', '==', 'pending')));
      return snap.docs.map(pub);
    }

    if (method === 'POST' && !id) {
      const user = requireUser();
      const created = {
        ownerUid: user.uid,
        ownerEmail: user.email || '', // referencia para el admin que modera
        status: 'pending', // queda oculto hasta que un admin lo apruebe
        ...cinemaCreate(body),
        screenings: [], stats: {}, createdAt: new Date().toISOString()
      };
      // Batch: cine + marcador anti-spam. Las reglas exigen ambos y rechazan el
      // alta si el último cine del usuario tiene menos de 24 h.
      const batch = writeBatch(db);
      const ref = doc(cinemasCol);
      batch.set(ref, created);
      batch.set(doc(db, 'users', user.uid), { lastCinemaAt: serverTimestamp() });
      try {
        await batch.commit();
      } catch (e) {
        if (e?.code === 'permission-denied') {
          throw new Error('No se pudo registrar: solo podés enviar un cine cada 24 h.');
        }
        throw e;
      }
      return { id: ref.id, ...created };
    }

    // POST api/cinemas/:id/approve|reject — moderación (solo admin).
    if (method === 'POST' && rest === 'approve') {
      if (!(await isAdmin())) throw new Error('No autorizado');
      await updateDoc(cinemaRef(id), { status: 'approved' });
      return { ok: true };
    }
    if (method === 'POST' && rest === 'reject') {
      if (!(await isAdmin())) throw new Error('No autorizado');
      await deleteDoc(cinemaRef(id));
      return { ok: true };
    }

    if (method === 'PUT' && id && !rest) {
      await ownDoc(id);
      const patch = cinemaPatch(body);
      await updateDoc(cinemaRef(id), patch);
      return { id, ...(await getDoc(cinemaRef(id))).data() };
    }

    if (method === 'DELETE' && id && !rest) {
      await ownDoc(id);
      await deleteDoc(cinemaRef(id));
      return { ok: true };
    }

    // Métrica anónima: cualquier visitante puede sumar un contador.
    // Las reglas de Firestore limitan este update al campo stats.
    if (method === 'POST' && rest === 'track') {
      const type = String(body.type);
      if (!['view', 'website', 'phone', 'whatsapp', 'directions'].includes(type)) {
        throw new Error('Tipo de evento inválido');
      }
      await updateDoc(cinemaRef(id), { [`stats.${type}`]: increment(1) });
      return { ok: true };
    }

    if (method === 'POST' && rest === 'screenings') {
      const snap = await ownDoc(id);
      const s = screeningOf(body);
      await updateDoc(cinemaRef(id), {
        screenings: [...(snap.data().screenings || []), s]
      });
      return s;
    }

    if (method === 'POST' && rest === 'screenings/bulk') {
      const snap = await ownDoc(id);
      const items = body.screenings;
      if (!Array.isArray(items) || !items.length) throw new Error('No se enviaron funciones');
      const toAdd = items.map((b, i) => {
        try { return screeningOf(b); }
        catch (e) { throw new Error(`Fila ${i + 1}: ${e.message}`); }
      });
      await updateDoc(cinemaRef(id), {
        screenings: [...(snap.data().screenings || []), ...toAdd]
      });
      return { added: toAdd.length };
    }

    const sm = rest.match(/^screenings\/([^/]+)$/);
    if (method === 'PUT' && sm) {
      const snap = await ownDoc(id);
      const list = snap.data().screenings || [];
      const idx = list.findIndex(x => x.id === sm[1]);
      if (idx === -1) throw new Error('Función no encontrada');
      const upd = { ...screeningOf(body), id: sm[1] };
      const next = list.slice();
      next[idx] = upd;
      await updateDoc(cinemaRef(id), { screenings: next });
      return upd;
    }

    if (method === 'DELETE' && sm) {
      const snap = await ownDoc(id);
      const list = snap.data().screenings || [];
      const next = list.filter(s => s.id !== sm[1]);
      if (next.length === list.length) throw new Error('Función no encontrada');
      await updateDoc(cinemaRef(id), { screenings: next });
      return { ok: true };
    }

    throw new Error('Operación no soportada');
  } catch (e) {
    throw friendlyError(e);
  }
}
