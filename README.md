# Cinemita

Mapa de cines independientes de Buenos Aires. Los dueños de cines pueden registrar
su sala, ubicarla en el mapa y cargar sus funciones semanales. Los espectadores ven
todos los cines como pins, pueden ordenarlos por distancia a su ubicación y
consultar los horarios de funciones.

## Ejecutar con Docker

```bash
docker compose up --build
```

o sin compose:

```bash
docker build -t cinemita .
docker run -p 3000:3000 -v cinemita-data:/app/data cinemita
```

Abrir http://localhost:3000

## Ejecutar sin Docker

```bash
npm install
npm start
```

## Datos de ejemplo

Para cargar cines de ejemplo en Buenos Aires:

```bash
node seed.js                                  # local
docker exec cinemita-cinemita-1 node seed.js  # dentro del contenedor
```

Es idempotente: saltea cines cuyo nombre ya existe.

## Cómo funciona

- **Registrar un cine**: botón "Registrar mi cine" → completar datos y hacer clic
  en el mapa (o buscar la dirección) para fijar la ubicación. El navegador guarda
  una clave de administración para ese cine.
- **Cargar funciones**: desde el detalle del cine (si es tuyo) → película, día de
  la semana, horario y notas opcionales (sala, precio, formato).
- **Editar datos**: botón "Editar datos del cine" en el panel de administración,
  incluye reubicar el pin en el mapa.
- **Ver cines cercanos**: botón "📍 Cerca de mí" ordena la lista por distancia.

## Importar funciones por CSV

Desde el panel de administración de tu cine podés subir un CSV. Formato:

```csv
dia,pelicula,hora,notas
lunes,La ciénaga,19:30,Sala 1
viernes,Relatos salvajes,22:00,"Sala 2, 35mm"
6,Zama,18:00,Función doble
```

- Encabezado obligatorio: `dia,pelicula,hora` (`notas` opcional)
- `dia`: nombre del día en español (con o sin tilde) o número 1–7 (Lunes=1, Domingo=7)
- `hora`: `HH:MM` (también acepta `H:MM`)
- Separador: `,` o `;` (se detecta automáticamente — útil para Excel en español)
- La importación es todo-o-nada: si una fila es inválida no se carga nada
- Ejemplo descargable: [`public/ejemplo-funciones.csv`](public/ejemplo-funciones.csv)

## Stack

Node.js + Express · Leaflet + OpenStreetMap · persistencia en `data/db.json`.

## Versión estática (GitHub Pages)

`node build-static.js` genera `dist-static/` con la app sin backend. Al no
encontrar la API entra en **modo demo**: los cines de ejemplo se cargan desde
`data/seed.json` y todo lo que se registre se guarda en el `localStorage` del
navegador (no se comparte entre visitantes — el Docker sigue siendo la versión
"real" con datos compartidos).

La rama `gh-pages` contiene esa build servida por GitHub Pages.

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/cinemas` | Lista todos los cines con sus funciones |
| POST | `/api/cinemas` | Registra un cine (devuelve `ownerToken`) |
| PUT | `/api/cinemas/:id` | Edita un cine (requiere token) |
| DELETE | `/api/cinemas/:id` | Elimina un cine (requiere token) |
| POST | `/api/cinemas/:id/screenings` | Agrega función `{movie, day(0=Lun..6=Dom), time, notes}` |
| POST | `/api/cinemas/:id/screenings/bulk` | Importación masiva `{screenings:[…]}` (máx. 500, todo-o-nada) |
| DELETE | `/api/cinemas/:cid/screenings/:sid` | Elimina función (requiere token) |

Notas: `website` acepta dominios sin esquema (`micine.com` → `https://micine.com`).
Las rutas que modifican datos usan `Authorization: Bearer <ownerToken>`.
