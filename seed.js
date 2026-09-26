// Carga cines de ejemplo en Buenos Aires via la API.
// Uso: node seed.js            (contra http://localhost:3000)
//      BASE_URL=http://host:puerto node seed.js
//      docker exec <contenedor> node seed.js

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const SEED_CINEMAS = [
  {
    name: 'Cine Gaumont (Espacio INCAA)',
    address: 'Av. Rivadavia 1635, Congreso',
    description: 'Sala del INCAA dedicada a cine argentino e independiente.',
    website: 'incaa.gov.ar',
    lat: -34.6090, lng: -58.3917,
    screenings: [
      { movie: 'Relatos salvajes', day: 4, time: '21:00', notes: 'Ciclo cine argentino' },
      { movie: 'Nueve reinas', day: 5, time: '19:30', notes: '' },
      { movie: 'La ciénaga', day: 6, time: '18:00', notes: 'Copia restaurada' },
      { movie: 'El ciudadano ilustre', day: 0, time: '20:30', notes: '' },
    ]
  },
  {
    name: 'Cine Cosmos UBA',
    address: 'Av. Corrientes 2046, Centro',
    description: 'Cine club universitario, programación de culto y de autor.',
    website: 'cosmosuba.org.ar',
    lat: -34.6045, lng: -58.3968,
    screenings: [
      { movie: 'Zama', day: 2, time: '20:00', notes: 'Debate posterior' },
      { movie: 'Cléo de 5 a 7', day: 4, time: '19:00', notes: 'Ciclo Agnès Varda' },
      { movie: 'Historia mínima', day: 6, time: '17:30', notes: '' },
    ]
  },
  {
    name: 'MALBA Cine',
    address: 'Av. Figueroa Alcorta 3415, Palermo',
    description: 'Cine del museo MALBA: estrenos de autor y ciclos temáticos.',
    website: 'malba.org.ar',
    lat: -34.5761, lng: -58.4137,
    screenings: [
      { movie: 'El faro', day: 3, time: '21:30', notes: '' },
      { movie: 'La odisea de los giles', day: 5, time: '20:00', notes: '' },
      { movie: 'Retrato de una mujer en llamas', day: 6, time: '19:00', notes: 'Subtitulada' },
    ]
  },
  {
    name: 'Cine Teatro 25 de Mayo',
    address: 'Av. Triunvirato 4439, Villa Urquiza',
    description: 'Sala barrial municipal con funciones de cine nacional.',
    lat: -34.5739, lng: -58.4937,
    website: '',
    screenings: [
      { movie: 'El secreto de sus ojos', day: 5, time: '21:00', notes: 'Entrada gratuita' },
      { movie: 'Un cuento chino', day: 6, time: '18:30', notes: 'Función familiar' },
    ]
  },
  {
    name: 'Alianza Francesa',
    address: 'Av. Córdoba 946, Centro',
    description: 'Sala de la Alianza Francesa: cine francófono y europeo.',
    website: 'alianzafrancesa.org.ar',
    lat: -34.5988, lng: -58.3807,
    screenings: [
      { movie: 'Amélie', day: 1, time: '19:00', notes: 'VOSE' },
      { movie: 'La clase', day: 3, time: '20:30', notes: 'Cine debate' },
      { movie: 'El niño de la bicicleta', day: 6, time: '17:00', notes: 'Dardenne' },
    ]
  },
  {
    name: 'Patio de los Lecheros',
    address: 'Donato Álvarez 175, Caballito',
    description: 'Espacio cultural barrial con proyecciones al aire libre.',
    lat: -34.6192, lng: -58.4408,
    website: 'patiodeloslecheros.com.ar',
    screenings: [
      { movie: 'Esperando la carroza', day: 4, time: '21:00', notes: 'A cielo abierto' },
      { movie: 'El clan', day: 5, time: '21:00', notes: 'A cielo abierto' },
    ]
  },
];

async function api(path, options = {}) {
  const res = await fetch(BASE_URL + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${data.error || res.status}`);
  return data;
}

module.exports = { SEED_CINEMAS };

async function main() {
  const existing = await api('/api/cinemas');
  const existingNames = new Set(existing.map(c => c.name));

  for (const c of SEED_CINEMAS) {
    if (existingNames.has(c.name)) {
      console.log(`- ${c.name}: ya existe, salteado`);
      continue;
    }
    const { screenings, ...cinema } = c;
    const created = await api('/api/cinemas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cinema)
    });
    if (screenings.length) {
      await api(`/api/cinemas/${created.id}/screenings/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${created.ownerToken}`
        },
        body: JSON.stringify({ screenings })
      });
    }
    console.log(`+ ${c.name}: ${screenings.length} funciones`);
  }
  console.log('Listo.');
}

if (require.main === module) {
  main().catch(e => { console.error('Error:', e.message); process.exit(1); });
}
