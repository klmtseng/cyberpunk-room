# NEON/2077 — Cyberpunk Room

A first-person cyberpunk room simulator that runs in your browser.
Walk around a neon-lit loft, look out over a living holographic city,
and interact with the room: light the mosaic lanterns, flip CRT TV
channels, fire up the projector, sit on the sofa and watch the street.

**Live demo: <https://cyberpunk-room.vercel.app>**

No install, no login. Desktop and mobile (touch supported, WebXR-ready).

## Highlights

- **Living street outside the window** — animated holographic ad towers,
  flickering LED billboards, video holo-ads projected on building walls,
  and trains passing on elevated rails.
- **Interactive room** — mosaic lanterns you can light and put out,
  a CRT TV with channels (including a cathode-ray tracking screen),
  a wall projector, a wardrobe, a gaming desk with a working retro PC.
- **Shareable room state** — everything you toggle is serialized into a
  `#room=` URL. Copy the link, and a friend opens the room exactly as
  you left it.
- **Photoreal pass** — real PBR textures (Polyhaven CC0), Victorian
  leather furniture models, mosaic art from The Met's open-access
  collection, all recorded in [`THIRD_PARTY_ASSETS.md`](THIRD_PARTY_ASSETS.md).

## Controls

| Input | Action |
|---|---|
| Click | Lock pointer / first-touch activate on mobile |
| WASD + mouse | Move / look |
| E | Interact (lanterns, TV, projector…) |
| P | Floor plan overlay |

## Tech

- [three.js](https://threejs.org) r170 + [postprocessing](https://github.com/pmndrs/postprocessing)
- TypeScript + Vite, zero framework
- WebGL2 with WebGPU types in place, WebXR-ready
- Serverless functions (book / news / music feeds) on Vercel
- Auto quality presets; forces LOW on touch devices

## Run locally

```bash
npm install
npm run dev       # vite dev server
npm run build     # typecheck + production build
```

## Assets & licenses

Every bundled third-party asset (Polyhaven CC0 models and textures,
Wikimedia Commons images, The Met open-access art, CC-licensed video
clips) is recorded with source, fetch date, and license in
[`THIRD_PARTY_ASSETS.md`](THIRD_PARTY_ASSETS.md).

## License

Code: MIT. Bundled third-party assets keep their original licenses as
documented above.
