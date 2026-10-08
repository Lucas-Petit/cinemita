// Importa cines a Firestore (una sola vez, para poblar la app).
//
// Uso:
//   node scripts/import-seed.mjs <serviceAccount.json> [--owner <uid>] [--file <json>]
//
//   serviceAccount.json: Firebase Console → Configuración → Cuentas de servicio →
//                        "Generar nueva clave privada" (NO commitear el archivo).
//   --owner <uid>:       UID de tu usuario (Firebase Console → Authentication →
//                        Users). Los cines importados quedan a tu nombre.
//                        Sin este flag quedan sin dueño (nadie puede editarlos).
//   --file:              JSON con { cinemas: [...] }. Por defecto data/db.json;
//                        con --seed usa los cines de ejemplo de seed.js.
//
// Ejemplo:  node scripts/import-seed.mjs serviceAccount.json --seed --owner abc123

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};

const saPath = args.find(a => !a.startsWith('--'));
if (!saPath) {
  console.error('Falta la ruta al serviceAccount.json');
  process.exit(1);
}

const ownerUid = flag('--owner');
const useSeed = args.includes('--seed');
const file = flag('--file', 'data/db.json');

let cinemas;
if (useSeed) {
  const { SEED_CINEMAS } = require('../seed.js');
  cinemas = SEED_CINEMAS.map(({ screenings = [], ...c }) => ({
    ...c,
    screenings: screenings.map(s => ({ id: randomUUID(), ...s }))
  }));
} else {
  cinemas = JSON.parse(readFileSync(file, 'utf8')).cinemas || [];
}

admin.initializeApp({ credential: admin.credential.cert(saPath) });
const db = admin.firestore();

let n = 0;
for (const c of cinemas) {
  const { id, ownerToken, ...data } = c;
  const doc = {
    ...data,
    ownerUid: ownerUid || null,
    ownerEmail: data.ownerEmail || '',
    // Los importados ya están verificados: nacen aprobados.
    status: data.status || 'approved',
    screenings: (data.screenings || []).map(s => ({ id: s.id || randomUUID(), ...s })),
    stats: data.stats || {},
    createdAt: data.createdAt || new Date().toISOString()
  };
  await db.collection('cinemas').doc(id || randomUUID()).set(doc);
  console.log(`✓ ${doc.name}`);
  n++;
}
console.log(`\n${n} cines importados a Firestore.`);
