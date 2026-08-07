# OZ: Down the Yellow Brick Road (WOZ Game)

Portable Phaser 3 greybox — **one-point perspective** side-scroller with discrete depth tracks.

## Stack

- Phaser 3
- TypeScript (strict)
- Vite (`base: './'`)

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Scene flow

Menu (facade gate) → Character Select → **Gate rotation (facade→feed east)** → walk-through east → fork → Game → Win

## Controls

| Action | Keys |
|--------|------|
| Walk | A/D or ←/→ |
| Change track | W/S or ↑/↓ |
| Run | Shift + move |
| Jump | Space / K |
| Debug | F3 |

## Stage model

- Floor recedes to a vanishing point and meets a vertical back wall at `horizonY`.
- Depth = discrete tracks (`src/config/tracks.ts`); `depthToStage` → screenY, scale, parallax.
- Camera scrolls on **x only**; the stage frame stays fixed in screen space.
