/**
 * Build 3D Studio–optimized Winged Monkey character GLB from bind export.
 *
 * - Never touches masters/
 * - Reads models/wingedmonkey/WingedMonkey_new_wings.glb
 * - Writes WingedMonkey_new_wings_studio.glb for clipCatalog
 *
 * Usage:
 *   npx tsx scripts/seed_monkey_studio_glbs.ts
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'models/wingedmonkey');
const SRC = 'WingedMonkey_new_wings.glb';
const STUDIO = 'WingedMonkey_new_wings_studio.glb';

function run(args: string[]): void {
  const result = spawnSync('npx', ['--yes', '@gltf-transform/cli@4.1.1', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`gltf-transform failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
}

function main(): void {
  const input = path.join(DIR, SRC);
  const output = path.join(DIR, STUDIO);
  if (!existsSync(input)) {
    throw new Error(`MISSING: ${input}`);
  }
  const before = readFileSync(input).length;
  run(['optimize', input, output, '--compress', 'false', '--simplify', 'false']);
  const after = readFileSync(output).length;
  console.log(`${SRC} → ${STUDIO}: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);

  writeFileSync(
    path.join(DIR, 'STUDIO_README.md'),
    [
      '# Winged Monkey — 3D Studio character',
      '',
      'Only character pack: `WingedMonkey_new_wings.glb` → `WingedMonkey_new_wings_studio.glb`',
      '(via `scripts/seed_monkey_studio_glbs.ts`).',
      '',
      'Catalog: `monkey_new_wings` in `src/dev/studio/clipCatalog.ts`.',
      '',
      'Gargoyle clips: `models/wingedmonkey/Animations/gargoyle/*.glb`',
      '(MVP `Garg*` bones — studio pass-through).',
      '',
      'Authoring bind: `EDIT_ME_monkey_bind.blend`. Masters under `masters/wingedmonkey/` are never modified.',
      '',
    ].join('\n'),
  );
  console.log('DONE');
}

main();
