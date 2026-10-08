// Carga cines de ejemplo en Buenos Aires via la API.
// Uso: node seed.js            (contra http://localhost:3000)
//      BASE_URL=http://host:puerto node seed.js
//      docker exec <contenedor> node seed.js

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const COMMONS = 'https://commons.wikimedia.org/wiki/Special:FilePath/';

const SEED_CINEMAS = [
  {
    name: 'Cine Gaumont (Espacio INCAA)',
    address: 'Av. Rivadavia 1635, Congreso',
    description: 'Sala del INCAA dedicada a cine argentino e independiente.',
    website: 'incaa.gov.ar',
    poster: COMMONS + 'Cine_Gaumont_(fachada_nocturna).JPG?width=800',
    lat: -34.6090, lng: -58.3917,
    screenings: [
      { movie: 'Relatos salvajes', day: 4, time: '21:00', notes: 'Ciclo cine argentino', price: 'bajo', age: '16' },
      { movie: 'Nueve reinas', day: 5, time: '19:30', notes: '', price: 'bajo', age: '13' },
      { movie: 'La ciénaga', day: 6, time: '15:00', notes: 'Matineé — copia restaurada', price: 'gratis', age: '13' },
      { movie: 'El ciudadano ilustre', day: 0, time: '20:30', notes: '', price: 'bajo' },
      { movie: 'Medianoche en París', day: 5, time: '00:15', notes: 'Función de trasnoche', price: 'medio', age: 'atp' },
    ]
  },
  {
    name: 'Cine Cosmos UBA',
    address: 'Av. Corrientes 2046, Centro',
    description: 'Cine club universitario, programación de culto y de autor.',
    website: 'cosmosuba.org.ar',
    poster: COMMONS + 'Cine_Cosmos_(julio_de_2010).JPG?width=800',
    lat: -34.6045, lng: -58.3968,
    screenings: [
      { movie: 'Zama', day: 2, time: '20:00', notes: 'Debate posterior', price: 'gratis' },
      { movie: 'Cléo de 5 a 7', day: 4, time: '19:00', notes: 'Ciclo Agnès Varda', price: 'gratis', age: '16' },
      { movie: 'Historia mínima', day: 6, time: '17:30', notes: '', price: 'gratis', age: 'atp' },
      { movie: 'Donnie Darko', day: 4, time: '23:59', notes: 'Función de culto', price: 'bajo', age: '16' },
      { movie: 'Mi vecino Totoro', day: 6, time: '10:30', notes: 'Matineé familiar', price: 'gratis', age: 'atp' },
    ]
  },
  {
    name: 'MALBA Cine',
    address: 'Av. Figueroa Alcorta 3415, Palermo',
    description: 'Cine del museo MALBA: estrenos de autor y ciclos temáticos.',
    website: 'malba.org.ar',
    poster: COMMONS + 'Fachada_del_Museo_de_Arte_Latinoamericano_de_Buenos_Aires_(MALBA).jpg?width=800',
    lat: -34.5761, lng: -58.4137,
    screenings: [
      { movie: 'El faro', day: 3, time: '21:30', notes: '', price: 'medio', age: '18' },
      { movie: 'La odisea de los giles', day: 5, time: '20:00', notes: '', price: 'medio', age: 'atp' },
      { movie: 'Retrato de una mujer en llamas', day: 6, time: '19:00', notes: 'Subtitulada', price: 'medio', age: '13' },
      { movie: 'Avant premiere: cine de autor', day: 2, time: '21:00', notes: 'Con directora invitada', price: 'alto', age: '16' },
    ]
  },
  {
    name: 'Cine Teatro 25 de Mayo',
    address: 'Av. Triunvirato 4439, Villa Urquiza',
    description: 'Sala barrial municipal con funciones de cine nacional.',
    lat: -34.5739, lng: -58.4937,
    website: '',
    poster: COMMONS + 'Complejo_Cultural_Teatro_25_de_Mayo_Villa_Urquiza.jpg?width=800',
    screenings: [
      { movie: 'El secreto de sus ojos', day: 5, time: '21:00', notes: 'Entrada gratuita', price: 'gratis', age: '13' },
      { movie: 'Un cuento chino', day: 6, time: '18:30', notes: 'Función familiar', price: 'gratis', age: 'atp' },
      { movie: 'Cine de barrio: matineé', day: 0, time: '11:00', notes: 'Ciclo municipal', price: 'gratis' },
      { movie: 'La novia del desierto', day: 5, time: '19:00', notes: 'Función doble', price: 'bajo' },
    ]
  },
  {
    name: 'Alianza Francesa',
    address: 'Av. Córdoba 946, Centro',
    description: 'Sala de la Alianza Francesa: cine francófono y europeo.',
    website: 'alianzafrancesa.org.ar',
    poster: COMMONS + 'RZ_Metro_Movie_Theater_interior_2023-03_(4).jpg?width=800',
    lat: -34.5988, lng: -58.3807,
    screenings: [
      { movie: 'Amélie', day: 1, time: '19:00', notes: 'VOSE', price: 'bajo', age: 'atp' },
      { movie: 'La clase', day: 3, time: '20:30', notes: 'Cine debate', price: 'bajo' },
      { movie: 'El niño de la bicicleta', day: 6, time: '17:00', notes: 'Dardenne', price: 'bajo' },
      { movie: 'Cuentos de la medianoche', day: 5, time: '23:30', notes: 'Hors normes', price: 'medio', age: '18' },
    ]
  },
  {
    name: 'Patio de los Lecheros',
    address: 'Donato Álvarez 175, Caballito',
    description: 'Espacio cultural barrial con proyecciones al aire libre.',
    lat: -34.6192, lng: -58.4408,
    website: 'patiodeloslecheros.com.ar',
    poster: COMMONS + "Cine_al_Aire_Libre-_'The_Artist'.jpg?width=800",
    screenings: [
      { movie: 'Esperando la carroza', day: 4, time: '21:00', notes: 'A cielo abierto', price: 'gratis', age: 'atp' },
      { movie: 'El clan', day: 5, time: '21:00', notes: 'A cielo abierto', price: 'gratis', age: '16' },
      { movie: 'Festival de jazz', day: 5, time: '22:30', notes: 'Música en vivo', price: 'bajo' },
      { movie: 'Picnic + cortos al aire libre', day: 6, time: '12:30', notes: 'Mediodía familiar', price: 'gratis', age: 'atp' },
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
  main().catch(e => {
    const conn = e.cause && ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(e.cause.code);
    console.error(conn || e.message === 'fetch failed'
      ? `No se pudo conectar a ${BASE_URL} — ¿está corriendo el servidor? (npm start, o docker compose up)`
      : 'Error: ' + e.message);
    process.exit(1);
  });
}
