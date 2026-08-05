# OZ: Down the Yellow Brick Road

Portable Phaser 3 greybox scaffold — three-quarter beat-em-up traversal.

## Stack

- Phaser 3 (Arcade Physics, top-down)
- TypeScript (strict)
- Vite (`base: './'` for file:// / app-scheme builds)

## Commands

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # output → dist/
npm run preview  # serve dist with relative paths
```

## Controls

| Action | Keys |
|--------|------|
| Walk (8-way) | WASD / Arrow keys |
| Fast run | Shift + move |
| Hop | Space / K |
| Menus | ↑↓ select, Enter confirm, Esc back |

## Scene flow

Boot → Preload → Menu → **Path Select** → Game → **Win**

Reach the end of the lane to win. Each road path terminates at a different place in Oz.

## Stage / parallax

- Floor meets a vertical backdrop on a shared horizon (no overlap).
- Depth tracks (`far` / `mid` / `near` + backdrop) derive scroll factors from perspective depth; prop speed = `cameraScrollSpeed × scrollFactor`.
