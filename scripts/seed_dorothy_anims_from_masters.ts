/**
 * Seed Dorothy Walk/Run/Jump(+Idle) working copies from masters/.
 *
 * - Never modifies masters/
 * - Writes full working copies under models/dorothy/Animations/mixamo_character/
 * - Writes optimized (no meshopt) copies under models/dorothy/Animations/studio/
 * - Copies related FBX masters into models/dorothy/Animations/ for catalog listings
 *
 * Usage:
 *   npx tsx scripts/seed_dorothy_anims_from_masters.ts
 */
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const MASTER_DIR = path.join(ROOT, 'masters/dorothy/Animations/mixamo_character');
const MASTER_FBX_DIR = path.join(ROOT, 'masters/dorothy/Animations');
const WORKING_FULL = path.join(ROOT, 'models/dorothy/Animations/mixamo_character');
const WORKING_FBX = path.join(ROOT, 'models/dorothy/Animations');
const STUDIO_OPT = path.join(ROOT, 'models/dorothy/Animations/studio');

const CLIPS = ['Traversal_walk.glb', 'Traversal_run.glb', 'Jump.glb', 'Idle.glb'] as const;
const FBX_COPIES = ['Jump.fbx', 'Traversal_walk.fbx', 'Traversal_run.fbx', 'Idle.fbx'] as const;

function optimizeGlb(input: string, output: string): void {
  const result = spawnSync(
    'npx',
    [
      '--yes',
      '@gltf-transform/cli@4.1.1',
      'optimize',
      input,
      output,
      // Keep three.js-loadable (no EXT_meshopt_compression).
      '--compress',
      'false',
      '--simplify',
      'false',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `gltf-transform failed for ${input}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
}

function main(): void {
  mkdirSync(WORKING_FULL, { recursive: true });
  mkdirSync(STUDIO_OPT, { recursive: true });
  mkdirSync(WORKING_FBX, { recursive: true });

  for (const file of CLIPS) {
    const masterPath = path.join(MASTER_DIR, file);
    if (!existsSync(masterPath)) {
      console.error('MISSING master (skip):', masterPath);
      continue;
    }

    const masterBytes = readFileSync(masterPath).length;

    // 1) Working full copy (same-bake characters) — byte-identical to master
    const fullOut = path.join(WORKING_FULL, file);
    copyFileSync(masterPath, fullOut);
    console.log(`full copy → ${path.relative(ROOT, fullOut)} (${masterBytes} B)`);

    // 2) Optimized studio copy (textures pruned/compressed, no meshopt)
    const optOut = path.join(STUDIO_OPT, file);
    optimizeGlb(masterPath, optOut);
    const optBytes = readFileSync(optOut).length;
    console.log(
      `optimized → ${path.relative(ROOT, optOut)} (${optBytes} B, ${(
        (optBytes / masterBytes) *
        100
      ).toFixed(1)}% of master)`,
    );
  }

  for (const fbx of FBX_COPIES) {
    const src = path.join(MASTER_FBX_DIR, fbx);
    const dst = path.join(WORKING_FBX, fbx);
    if (!existsSync(src)) continue;
    copyFileSync(src, dst);
    console.log(`fbx copy → ${path.relative(ROOT, dst)}`);
  }

  // Tiny manifest so it's obvious these are derived
  writeFileSync(
    path.join(STUDIO_OPT, 'README.md'),
    [
      '# Studio-optimized Dorothy clips',
      '',
      'Derived from `masters/dorothy/Animations/mixamo_character/` via',
      '`scripts/seed_dorothy_anims_from_masters.ts`.',
      '',
      '- Masters are never modified.',
      '- Full working copies (for same-bake characters) live in',
      '  `models/dorothy/Animations/mixamo_character/`.',
      '- These studio files are gltf-transform optimized without meshopt so',
      '  three.js can load them without an extra decoder.',
      '',
    ].join('\n'),
  );
}

main();
