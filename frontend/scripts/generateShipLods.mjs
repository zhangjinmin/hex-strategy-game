#!/usr/bin/env node
/**
 * Incremental ship-model LOD compiler.
 *
 * Source: src/assets/ship/<name>.glb
 * Output: <name>.lod1.glb (20%) and <name>.lod2.glb (5%) plus shipLodManifest.json.
 *
 * It is deliberately run before both `vite` and `vite build`: artists only need to
 * copy a source GLB into the directory. Existing outputs newer than the source are
 * retained, making the normal startup pass effectively a cheap directory scan.
 */
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMaterialsSpecular, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const here = dirname(fileURLToPath(import.meta.url));
const shipDir = resolve(here, '../src/assets/ship');
const manifestPath = join(shipDir, 'shipLodManifest.json');
const force = process.argv.includes('--force');
const refreshManifest = process.argv.includes('--refresh-manifest');
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMaterialsSpecular, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const gltfTransformBin = process.platform === 'win32'
  ? resolve(here, '../node_modules/.bin/gltf-transform.cmd')
  : resolve(here, '../node_modules/.bin/gltf-transform');

function lodName(sourceName, level) {
  return sourceName.replace(/\.glb$/i, `.lod${level}.glb`);
}

function meshMetrics(document) {
  let tris = 0;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const indices = primitive.getIndices();
      tris += Math.floor((indices ? indices.getCount() : position.getCount()) / 3);
      const array = position.getArray();
      for (let i = 0; i + 2 < array.length; i += position.getElementSize()) {
        lo[0] = Math.min(lo[0], array[i]); lo[1] = Math.min(lo[1], array[i + 1]); lo[2] = Math.min(lo[2], array[i + 2]);
        hi[0] = Math.max(hi[0], array[i]); hi[1] = Math.max(hi[1], array[i + 1]); hi[2] = Math.max(hi[2], array[i + 2]);
      }
    }
  }
  const longestAxis = Number.isFinite(lo[0]) ? Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0;
  return { tris, longestAxis };
}

async function readManifest() {
  try { return JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { return {}; }
}

async function needsBuild(sourcePath, outputPath) {
  if (force) return true;
  try { return (await stat(outputPath)).mtimeMs < (await stat(sourcePath)).mtimeMs; }
  catch { return true; }
}

async function writeLod(sourcePath, outputPath, { ratio, textureSize }) {
  // Use the CLI for writes. It registers all optional glTF extensions and therefore preserves
  // source material/texture encoding; NodeIO alone would drop unknown extensions on write.
  const tempPath = outputPath.replace(/\.glb$/i, '.tmp.glb');
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(gltfTransformBin, [
      'optimize', sourcePath, tempPath,
      '--simplify-ratio', String(ratio), '--simplify-error', '0.01',
      // Keep transform nodes/FX anchors intact; only optimize mesh and texture payloads.
      '--flatten', 'false', '--join', 'false', '--instance', 'false', '--palette', 'false',
      '--texture-compress', 'auto', '--texture-size', String(textureSize),
    ], {
      stdio: 'inherit', shell: false,
    });
    child.once('error', rejectRun);
    child.once('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`gltf-transform simplify exited ${code}`)));
  });
  // Atomic replacement keeps an interrupted build from leaving the runtime with a partial GLB.
  await rename(tempPath, outputPath);
  return metricsFor(outputPath);
}

async function metricsFor(path) {
  return meshMetrics(await io.read(path));
}

async function main() {
  await mkdir(shipDir, { recursive: true });
  const files = (await readdir(shipDir))
    .filter((name) => name.toLowerCase().endsWith('.glb'))
    .filter((name) => !/\.lod[12]\.glb$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const manifest = await readManifest();
  let generated = 0;

  for (const sourceName of files) {
    const sourcePath = join(shipDir, sourceName);
    const lod1Path = join(shipDir, lodName(sourceName, 1));
    const lod2Path = join(shipDir, lodName(sourceName, 2));
    const stale = await needsBuild(sourcePath, lod1Path) || await needsBuild(sourcePath, lod2Path);
    if (stale) {
      process.stdout.write(`[ship-lod] ${sourceName} -> lod1/lod2\n`);
      const orig = await metricsFor(sourcePath);
      const lod1 = await writeLod(sourcePath, lod1Path, { ratio: 0.20, textureSize: 1024 });
      const lod2 = await writeLod(sourcePath, lod2Path, { ratio: 0.05, textureSize: 512 });
      manifest[sourceName] = { orig, lod1, lod2 };
      generated++;
    } else if (refreshManifest || !manifest[sourceName]) {
      manifest[sourceName] = { orig: await metricsFor(sourcePath), lod1: await metricsFor(lod1Path), lod2: await metricsFor(lod2Path) };
    }
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`[ship-lod] ${generated === 0 ? 'up to date' : `generated ${generated} model set(s)`}\n`);
}

main().catch((error) => {
  console.error('[ship-lod] generation failed:', error);
  process.exitCode = 1;
});
