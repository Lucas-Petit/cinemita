// Genera dist-static/ con la versión 100% estática de la app (para GitHub Pages).
// La app detecta que no hay API y entra en "modo demo" (localStorage),
// cargando data/seed.json como datos iniciales.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SEED_CINEMAS } = require('./seed.js');

const OUT = path.join(__dirname, 'dist-static');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });

copyDir(path.join(__dirname, 'public'), OUT);
copyDir(path.join(__dirname, 'node_modules', 'leaflet', 'dist'),
  path.join(OUT, 'vendor', 'leaflet'));

const seed = {
  cinemas: SEED_CINEMAS.map(({ screenings, ...c }) => ({
    id: crypto.randomUUID(),
    ownerToken: crypto.randomUUID(),
    ...c,
    screenings: screenings.map(s => ({ id: crypto.randomUUID(), ...s })),
    createdAt: new Date().toISOString()
  }))
};
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'data', 'seed.json'), JSON.stringify(seed, null, 2));

console.log(`dist-static/ listo (${seed.cinemas.length} cines en seed.json)`);
