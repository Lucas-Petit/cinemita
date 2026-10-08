# Feature Gap Analysis — Cinemita vs. App Planes.txt ("Planit")

Date: 2026-10-05
Scope: compares the features described in `App Planes.txt` against the current
codebase (`server.js`, `public/`).

---

## 1. Already implemented

| Plan requirement | Current implementation |
|---|---|
| Interactive map with venues at their location | Leaflet + OSM, one pin per cinema |
| Business panel to load venues/branches and events | Owner registers cinema via `ownerToken`; loads `screenings` (weekly recurring or one-off dated events) |
| Search | Text search over name/address/description/movie |
| Location-aware browsing | "📍 Cerca de mí" sorts by distance (sort only, no radius filter) |
| Basic filtering | "Funciones hoy" chip; "Cartelera" tab by weekday |

---

## 2. Missing features (gap list)

### User side
- User registration / login (plan requires Google + Apple sign-in)
- User profile: name, barrio, search radius, preference onboarding
- Attendance confirmation (RSVP) — **central to the plan's MVP**
- "Mis planes" tab: confirmed plans + favorites
- "Inicio" tab: recommendations by preference + highlight of the day
- Account deletion from inside the app (required by Apple once accounts exist)

### Search filters (plan § Filtros de búsqueda)
- Franja horaria (time slot)
- Tipo de evento (entretenimiento, gastronómico, deportivo, boliche, música…)
- Rango de precio
- Ubicación por rango de km (only distance *sorting* exists today)
- Dress code

### Data model gaps
- `category`/`type` on venues/events (code is cinema-only: `cinemas`/`screenings`/`movie`)
- `price` on events
- `ageRestriction` (plan requires e.g. +18 on boliches)
- `featured`/`promoted` flag for paid highlights
- `business` entity grouping multiple branches (today: one token per venue)
- Contact fields that feed intent metrics (phone, whatsapp, "cómo llegar")

### Business panel — statistics (all absent; zero tracking exists)
- Views, confirmations, clicks on profile/event, favorites saves
- Intent signals: clicks on "cómo llegar" / phone / whatsapp / reservas
- Conversion: confirmation rate
- Audience profile: age/gender, origin, peak days/times, new vs. returning
- Comparison: evolution over time, vs. category average in zone, ad performance
- Check-in (QR) → real vs. confirmed attendance

### Legal / privacy (Ley 25.326)
- Terms & conditions + privacy policy pages (required by app stores too)
- Block/report users; private vs. public attendance
- Guarantee: never expose a user's exact location

### Monetization
- Subscriptions (plan: charged via web/Mercado Pago, not in-app)
- Featured/promoted events (labeled "Destacado"/"Promocionado", capped, filter-constrained)

---

## 3. Evaluation: does every feature make sense?

### Implement now (high value, low/moderate cost, on the MVP critical path)

| Feature | Why |
|---|---|
| `category` on venues + events | Foundational. Every filter, recommendation and stat groups by it. Cheap to add now, painful to retrofit. **Only if scope is Planit, not cinema-only** — see open question below. |
| `price` field (or free/paid/$) | Needed for the price filter; a coarse enum is enough — don't demand exact prices businesses won't maintain. |
| `ageRestriction` field | One optional field; required by the plan and feeds the app-store age rating. |
| Radius (km) filter | Trivial: `haversineKm` already exists — just a distance cutoff. |
| Time-slot filter | Trivial: `time` is already `HH:MM` — bucket into ranges. |
| Terms & privacy pages | Static pages, required by law and both stores. No engineering risk; do it before collecting real data. |
| Basic stats counters (views, confirmations) | Cheap (increment on GET detail / on RSVP) and it is *the* sales pitch to businesses — they only pay if they see numbers. |
| Attendance confirmation (RSVP) | Core of the MVP per the plan. Everything social builds on it. Requires user identity — see below. |

### Implement later (real features, but wrong to build now)

| Feature | Why defer |
|---|---|
| User accounts (Google/Apple OAuth) | Heavyweight: OAuth setup, token/session handling, privacy obligations (Ley 25.326, AAIP). The plan itself wants accounts, but a lighter interim exists: device-local identity (like today's `ownerToken` pattern) for favorites/RSVP while validating the product. Full OAuth can land with the app-store push. **Apple sign-in is only required once an iOS app + Google login ship.** |
| "Mis planes" + favorites (server-side) | Needs the account decision above. A `localStorage` version works today with zero backend changes and validates demand. |
| "Inicio" recommendation feed | Needs preferences → needs accounts. Interim: a "Hoy / esta noche" chronological feed needs zero personalization. |
| Multi-branch business entity | Only matters once businesses are real accounts. The per-venue token model works for the free launch period; migrate when subscriptions arrive. |
| Subscriptions / payments | The plan explicitly says launch with a 2–3 month free period. Building billing before validating retention is premature; also lives on the web, not in the app. |
| Featured/promoted events | The plan itself says **don't launch with ads** — with few users, paying businesses see no lift and churn. Add once user volume makes "first position" worth paying for. When built, respect the plan's constraints: labeled, filter-constrained, capped. |
| Advanced stats (audience profile, zone comparison, ad performance) | Needs volume to be meaningful; also the plan's proposed Pro-tier upsell. Also note tension: collecting age/gender data conflicts with the minimal-data privacy stance — decide what you actually need before storing it. |
| Check-in QR / real attendance | Highest-value metric per the plan, but needs venue hardware/ops (QR at the door, staff cooperation). v2. |
| Block/report users, public attendance | Only needed if profiles become visible — the plan defers the social layer to v2 and defaults attendance to private. Deferring also removes a moderation burden. |

### Probably unnecessary (reconsider before building)

| Feature | Concern |
|---|---|
| **Dress code filter** | Applies almost only to boliches; sparse, stale data. One field on the event + free-text display is enough — a dedicated filter维度 earns its UI cost poorly. |
| **Exact-price filter** | Same data-quality problem: businesses won't maintain prices, and "under $X" queries break on empty fields. A `free`/`paid`/`$$` badge is more honest. |
| **Push notifications to zone users** | The plan itself flags the uninstall risk; also needs native app + notification infra. Far-future at best. |
| **"See who's going" social layer** | The plan already flags the privacy risk of showing strangers' profiles and defers it to v2. Right call — it also drags in moderation, reporting, blocking. Revisit only if retention data says people want it. |

---

## 4. Open questions that gate the roadmap

1. **Scope: Cinemita (cinema-only) or Planit (all event types)?**
   This decides whether `cinemas`/`screenings`/`movie` generalizes to
   `venues`/`events`/`category`. Do it before adding filters — renaming the
   domain later is the expensive version.

2. **Identity model for RSVP/favorites.**
   Full OAuth now vs. device-local identity now + OAuth later. The plan's MVP
   assumes real registration, but nothing in the code does — this is the
   single biggest fork in effort.

3. **Privacy/data policy for stats.**
   Audience-profile metrics (age, gender, origin) require storing personal
   data → Ley 25.326 duties (AAIP registration, deletion flows). Decide the
   minimum dataset that still sells to businesses.

4. **Platform.**
   The plan targets app stores; the code is a responsive web app (with a
   static/demo build). Native vs. PWA changes what "accounts", "notifications"
   and "Apple sign-in" even mean.
