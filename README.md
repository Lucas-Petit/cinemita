# Cinemita

Mapa de cines y espacios culturales de Buenos Aires. Los dueños pueden registrar
su lugar, ubicarlo en el mapa y cargar sus funciones semanales. Los espectadores ven
todos los lugares como pins, pueden filtrarlos por categoría, precio, horario y
distancia, y consultar los horarios de funciones.

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

- **Registrar un lugar**: botón "Registrar mi cine" → completar datos (incluye
  teléfono y WhatsApp opcionales) y hacer clic en el mapa (o buscar
  la dirección) para fijar la ubicación. El navegador guarda una clave de
  administración para ese lugar.
- **Cargar funciones**: desde el detalle del lugar (si es tuyo) → película, día de
  la semana, horario, precio y restricción de edad opcionales, y
  notas/póster. Si la función tiene **fecha** puntual es un evento único (no se
  repite semanalmente). Cada función se puede editar o eliminar.
- **Compartir un cine**: cada cine tiene enlace directo `#cine=<id>` (botón
  "Copiar enlace" en el detalle); abrirlo muestra el cine en el mapa.
- **Editar datos**: botón "Editar datos del cine" en el panel de administración,
  incluye reubicar el pin en el mapa.
- **Ver cines cercanos**: botón "📍 Cerca de mí" ordena la lista por distancia.
- **Buscar**: la barra de búsqueda filtra por nombre, dirección, descripción o
  película; el filtro "Funciones hoy" muestra solo cines con una función de hoy
  que todavía no empezó (se tiene en cuenta la hora).
- **Filtros**: precio máximo (Gratis / hasta $ / $$ / $$$), franja horaria
  (mañana, tarde, noche, madrugada) y distancia en km desde tu ubicación. Un
  lugar coincide si tiene alguna función que cumple los filtros.
- **Estadísticas del dueño**: el panel de administración muestra vistas del
  perfil y clics de intención (sitio web, "cómo llegar", teléfono, WhatsApp).
- **Cartelera**: la pestaña "Cartelera" muestra todas las funciones de un día
  ordenadas por horario, en todos los lugares (respeta los mismos filtros).

## Recuperar el acceso a tu cine

La clave de administración vive en el navegador donde registraste el cine. En el
panel de administración hay un **enlace de administración** copiable
(`#admin=<id>:<token>`): abrirlo en cualquier navegador instala la clave ahí.
Guardalo para no perder el acceso — es secreto, quien lo tenga puede editar el
cine.

## Importar funciones por CSV

Desde el panel de administración de tu cine podés subir un CSV. Formato:

```csv
dia,pelicula,hora,notas
lunes,La ciénaga,19:30,Sala 1
viernes,Relatos salvajes,22:00,"Sala 2, 35mm"
6,Zama,18:00,Función doble
```

- Encabezado obligatorio: `dia,pelicula,hora` (opcionales: `notas`, `fecha`,
  `poster`, `precio`, `edad`)
- `dia`: nombre del día en español (con o sin tilde) o número 1–7 (Lunes=1, Domingo=7)
- `fecha`: `AAAA-MM-DD` o `DD/MM/AAAA` — si está presente la función es única y
  la columna `dia` puede quedar vacía
- `hora`: `HH:MM` (también acepta `H:MM`)
- `poster`: URL http(s) de una imagen para la función
- `precio`: `gratis`, `$`/`bajo`, `$$`/`medio`, `$$$`/`alto`
- `edad`: `atp`, `13`, `16` o `18`
- Separador: `,` o `;` (se detecta automáticamente — útil para Excel en español)
- La importación es todo-o-nada: si una fila es inválida no se carga nada
- Ejemplo descargable: [`public/ejemplo-funciones.csv`](public/ejemplo-funciones.csv)

## Stack

Node.js + Express · Leaflet · persistencia en `data/db.json`.

**Mapa**: por defecto usa los tiles estándar de OpenStreetMap (sin key, con un
filtro suave para el tema oscuro). Si configurás una key gratuita de CARTO
(https://carto.com/basemaps/apikey — llega por email, sin cuenta) en
`localStorage.setItem('cinemita_carto_key', '...')` o pegándola en `CARTO_KEY`
en `public/app.js`, el mapa usa el basemap oscuro Dark Matter.

## App Android (APK) y Firebase

La app para Android es la misma web app envuelta con Capacitor — sin código
duplicado. Si `public/firebase-config.js` está configurado, la app usa
**Firestore + login con Google** (los cines quedan atados a la cuenta del dueño);
si no, sigue funcionando con el servidor Express o en modo demo.

El APK se compila gratis con GitHub Actions (`.github/workflows/android-apk.yml`,
descargable como artefacto) o localmente con Android Studio + `npx cap open android`.

Guía paso a paso (proyecto Firebase, reglas, google-services.json, firma de
release, importar los datos): **[ANDROID.md](ANDROID.md)**.

## Versión estática (GitHub Pages)

`node build-static.js` genera `dist-static/` con la app sin backend. Al no
encontrar la API entra en **modo demo**: los cines de ejemplo se cargan desde
`data/seed.json` y todo lo que se registre se guarda en el `localStorage` del
navegador (no se comparte entre visitantes — el Docker sigue siendo la versión
"real" con datos compartidos).

La carpeta `dist-static/` se puede servir desde cualquier hosting estático
(GitHub Pages, Netlify, etc.).

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/meta` | Vocabulario: `days`, `prices`, `ageRatings` |
| GET | `/api/cinemas` | Lista todos los cines con sus funciones |
| POST | `/api/cinemas` | Registra un cine (devuelve `ownerToken`) |
| PUT | `/api/cinemas/:id` | Edita un cine (requiere token) |
| DELETE | `/api/cinemas/:id` | Elimina un cine (requiere token) |
| POST | `/api/cinemas/:id/track` | Métrica anónima `{type}`: `view`, `website`, `phone`, `whatsapp`, `directions` |
| POST | `/api/cinemas/:id/screenings` | Agrega función `{movie, day(0=Lun..6=Dom) o date(AAAA-MM-DD), time, notes, poster, price, age}` |
| PUT | `/api/cinemas/:cid/screenings/:sid` | Edita una función (requiere token) |
| POST | `/api/cinemas/:id/screenings/bulk` | Importación masiva `{screenings:[…]}` (máx. 500, todo-o-nada) |
| DELETE | `/api/cinemas/:cid/screenings/:sid` | Elimina función (requiere token) |

Campos del cine: `name` (obligatorio), `address`, `description`, `website`,
`poster`, `phone`, `whatsapp`, `lat`, `lng`.
El objeto `stats` acumula los contadores de `/track` y se ve en el panel del dueño.

Campos de función: `price` (`gratis`/`bajo`/`medio`/`alto`), `age`
(`atp`/`13`/`16`/`18`), ambos opcionales.

Notas: `website` acepta dominios sin esquema (`micine.com` → `https://micine.com`).
Las rutas que modifican datos usan `Authorization: Bearer <ownerToken>`.
