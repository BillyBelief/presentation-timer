# Presentation Timer

A full-screen PWA stopwatch/timer for keeping on pace during presentations. Designed to be glanceable from across a room.

## Features

- **Two display modes** — *Stopwatch* (counts up total session time) or *Timer* (counts down per section). Toggle at any time.
- **Section-based schedule** — define any number of named sections with individual durations.
- **Per-section colour** — each section gets a distinct professional colour (OKLCH palette). During the **last 25%** of a section the background smoothly cross-fades to the next section's colour, so the transition itself signals you've moved on.
- **Huge display** — the timer fills over 60% of the screen in both portrait and landscape; readable from the back of a room.
- **Auto-advance** (on by default) — sections advance automatically; tap Next/Prev to jump manually.
- **Saved presets** — name and save presentation setups in local storage; reload them in one tap.
- **Screen stays on** — uses the Screen Wake Lock API so the display never dims while running.
- **Full-screen & installable** — PWA manifest with `display: fullscreen`; add to your Android home screen for a true full-screen native-like experience.
- **Offline-capable** — service worker caches all assets (network-first strategy; falls back to cache when offline).
- **Wall clock** — small current time shown in the top bar so you always know the real time.

## Usage

### Run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

### Use on Android (same Wi-Fi)

1. Find your Mac's local IP: `ipconfig getifaddr en0`
2. Open `http://<mac-ip>:8080` in Chrome on your phone
3. Menu → **Add to Home Screen** → launch from the icon for true full-screen + offline use

### Deploy (standalone, no Mac needed)

Push to GitHub and enable **GitHub Pages** (Settings → Pages → deploy from `main` branch root), or drop the folder onto [Netlify](https://netlify.com) / [Vercel](https://vercel.com).

## Project structure

```
index.html          # Setup view + run view
styles.css          # Responsive layout, huge digits, glass chrome, colour palette
app.js              # Timer state machine, OKLCH colour engine, presets, wake lock
sw.js               # Service worker (network-first, offline fallback)
manifest.webmanifest
icons/
  icon-192.png
  icon-512.png
```

## Colour model

Section colours are generated algorithmically in **OKLCH** (perceptually uniform):

```
L = 0.52, C = 0.11
H(i) = (212 + i × 280 / N) mod 360
```

This guarantees all N colours are visually distinct, harmonious, and maintain ≥ 6:1 contrast against the near-white digit colour (`#FBFCFD`).

The crossfade interpolates L, C, and H (shortest hue path) using a **smoothstep** easing over the final 25% of each section.
