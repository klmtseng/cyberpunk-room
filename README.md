# Neon Loft — Interactive Cyberpunk Room

A first-person cyberpunk room simulator that runs directly in your browser.
Walk around a neon-lit loft, look out over a living holographic city,
and interact with the room: light the mosaic lanterns, flip CRT TV
channels, fire up the projector, sit on the sofa, and watch the street.

**Live demo: <https://cyberpunk-room.vercel.app>**

No installation or login required. Desktop and mobile are supported, with touch controls and WebXR readiness.

## Highlights

- **Living street outside the window** — animated holographic ad towers,
  flickering LED billboards, video advertisements projected on building walls,
  and trains passing on elevated rails.
- **Interactive room** — mosaic lanterns you can turn on and off,
  a CRT television with multiple channels, a wall projector, a wardrobe,
  and a gaming desk with a working retro PC.
- **Shareable room state** — your changes are saved in the URL, so when
  you copy and share the link, other people can open Neon Loft with the
  lights, television, projector, and other settings just as you left them.
- **Detailed visual assets** — real PBR textures from Poly Haven,
  Victorian leather furniture models, and mosaic artwork from The Met's
  Open Access collection. All third-party assets are documented in
  [`THIRD_PARTY_ASSETS.md`](THIRD_PARTY_ASSETS.md).

## Controls

| Input | Action |
|---|---|
| Click | Lock pointer / first-touch activation on mobile |
| WASD + mouse | Move / look |
| E | Interact with lanterns, television, projector, and other objects |
| P | Floor plan overlay |
| EN / 中 button | Toggle language in the top-right corner |

## Tech

- [three.js](https://threejs.org) r170 + [postprocessing](https://github.com/pmndrs/postprocessing)
- TypeScript + Vite, with no frontend framework
- WebGL2 with WebGPU types in place; WebXR-ready
- Serverless functions for book, news, and music feeds on Vercel
- Automatic quality presets; LOW mode on touch devices

## Run locally

```bash
npm install
npm run dev       # Vite development server
npm run build     # Type-check and create a production build
```

## Assets and licenses

Every bundled third-party asset, including Poly Haven CC0 models and
textures, Wikimedia Commons images, The Met Open Access artwork, and
CC-licensed video clips, is recorded with its source, retrieval date,
and license in [`THIRD_PARTY_ASSETS.md`](THIRD_PARTY_ASSETS.md).
Assets requiring attribution are also credited in the in-app credits panel.

## License

Code: MIT. Bundled third-party assets retain their original licenses as
documented above.
