# Cinemita — App Android + Firebase

La app Android envuelve la misma web app con Capacitor (no hay código duplicado).
El backend puede ser Firebase (Firestore + login con Google) o el servidor Express
de siempre: si `public/firebase-config.js` tiene la config real, la app usa
Firebase; si no, intenta la API y cae en modo demo.

Todo lo que sigue es gratis. Lo único que no se puede automatizar son los pasos
en consolas web (Firebase y, si querés Play Store, Google Play — ese cuesta
USD 25 una sola vez).

## 1. Crear el proyecto Firebase (~10 min)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Agregar
   proyecto** → nombre `cinemita` → plan Spark (gratis). No hace falta Analytics.
2. **Firestore Database** → Crear base de datos → modo producción → región
   `southamerica-east1` (São Paulo, la más cercana).
3. **Authentication** → Método de acceso → habilitar **Google**.
4. **Configuración del proyecto** → Tus apps → **App web** (`</>`) → registrar
   `cinemita` → copiar los valores en `public/firebase-config.js`
   (apiKey, authDomain, projectId, appId).
5. Editar `.firebaserc` con el id real del proyecto.

## 2. Publicar las reglas de Firestore

Opción A (consola): Firestore → Reglas → pegar el contenido de
`firestore.rules` → Publicar.

Opción B (CLI): `npx firebase-tools login && npx firebase-tools deploy --only firestore:rules`

Las reglas: lectura pública solo de cines **aprobados**; crear requiere login y
deja el cine `pending`; editar solo el dueño; `stats` lo incrementa cualquiera;
el admin puede cambiar `status` y borrar.

## 2b. Moderación y anti-spam

- **Aprobación obligatoria**: todo cine nuevo nace `pending` — solo lo ve el
  dueño y el admin hasta que se apruebe (pestaña **Pendientes** en la app).
- **Darte admin**: Firestore → colección `admins` → crear documento con ID =
  tu UID (Authentication → Users → copiar uid). Contenido irrelevante
  (ej. `{ "ok": true }`). Al volver a entrar a la app aparece la pestaña.
- **Anti-spam**: máximo **1 cine cada 24 h por cuenta**, forzado por las reglas
  de Firestore (el alta exige escribir `users/{uid}.lastCinemaAt` en el mismo
  batch, y ese marcador solo admite la hora del servidor — no se puede falsear).
- Aprobá más admins repitiendo el paso 2b con otros UIDs.

## 3. (Opcional) Cargar los cines de ejemplo

1. Firebase Console → Configuración → **Cuentas de servicio** → Generar clave
   privada → guardar como `serviceAccount.json` (no se commitea).
2. Tu UID: Authentication → Users → copiar tu uid (logueate una vez en la web app).
3. `node scripts/import-seed.mjs serviceAccount.json --seed --owner TU_UID`

Sin `--owner` los cines quedan sin dueño (nadie los puede editar).
Sin `--seed` importa `data/db.json` (tu base actual del servidor Express).

## 4. Generar el APK

### Opción A — GitHub Actions (recomendada, sin instalar nada)

1. Subí el repo a GitHub.
2. Push a `main` → Actions → **Android APK** → esperar → descargar el artefacto
   `cinemita-debug-apk`. Ese APK ya es instalable en cualquier Android
   ("Instalar de todas formas" en el aviso de origen desconocido).

### Opción B — Android Studio local

1. Instalar [Android Studio](https://developer.android.com/studio).
2. `npx cap sync android && npx cap open android`
3. **Build → Build App Bundle(s)/APK(s) → Build APK(s)** → el APK queda en
   `android/app/build/outputs/apk/debug/app-debug.apk`.

## 5. Login con Google dentro del APK

El botón "Ingresar" usa el plugin nativo. Requiere:

1. Registrar la app Android en Firebase: Configuración del proyecto → Agregar app
   → Android → package `com.cinemita.app` → descargar `google-services.json` →
   ponerlo en `android/app/` (el build lo detecta solo; está en .gitignore).
2. **SHA-1 del certificado** que firmó el APK, agregado en esa app de Firebase:
   - APK de release firmado con tu keystore → `keytool -list -v -keystore cinemita.keystore`
   - APK de debug de CI → firmado con una clave nueva cada build; podés sacar su
     SHA-1 con `apksigner verify --print-certs app-debug.apk`, o simplemente usar
     la build de release (recomendado).
   - Si publicás en Play Store, además hay que agregar el SHA-1 del *app signing
     key* de Play Console (Play re-firma el bundle) y re-descargar el json.

Sin `google-services.json` el APK compila igual y funciona todo menos el login.

## 6. Firma de release (para distribuir fuera del CI de debug)

```bash
keytool -genkeypair -v -keystore cinemita.keystore -alias cinemita \
  -keyalg RSA -keysize 2048 -validity 10000
```

- **Local**: copiar `cinemita.keystore` a `android/app/` y exportar
  `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` → `gradlew assembleRelease`.
- **GitHub Actions**: subir como secrets (Settings → Secrets → Actions):
  `KEYSTORE_BASE64` (`base64 cinemita.keystore`), `KEYSTORE_PASSWORD`,
  `KEY_ALIAS`, `KEY_PASSWORD`. El workflow genera `app-release.apk` y
  `app-release.aab` firmados.
- Opcional: `GOOGLE_SERVICES_JSON` como secret (base64) para que el CI incluya el
  archivo en la build.

**Guardá el keystore a salvo**: sin él no podés publicar actualizaciones.

## 7. Play Store (opcional, USD 25 una vez)

El AAB firmado se sube a Play Console. Ojo: cuentas personales nuevas exigen un
test cerrado con 12 testers durante 14 días antes de producción. Distribuir el
APK por tu cuenta (GitHub Releases, Telegram, web) no tiene ese requisito.

## 8. Detalles que ya quedaron resueltos

- Ícono: `android/app/src/main/res/mipmap-*` (por defecto el de Capacitor;
  se reemplaza con Android Studio → Image Asset Studio o `@capacitor/assets`).
- Splash oscuro (#0b0c0f), status bar oscura, botón atrás cierra modales,
  permiso de ubicación nativo para "Cerca de mí".
- El APK usa la misma base de datos que la web: un cine cargado desde el teléfono
  aparece en la web al instante (y viceversa).
- En modo Firebase ya no hay "enlace de administración": la propiedad es tu
  cuenta de Google, así que no se puede perder ni robar por copiar un link.
