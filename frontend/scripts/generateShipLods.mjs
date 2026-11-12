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
// Run the CLI's JS entrypoint with the current Node binary rather than the
// node_modules/.bin shim. Node >=18.20.2/20.12.2 refuses to spawn a .cmd/.bat with
// shell:false (CVE-2024-27980) and throws EINVAL on Windows, and the POSIX shim is
// not executable on a Windows filesystem. This path works identically on both.
const gltfTransformCli = resolve(here, '../node_modules/@gltf-transform/cli/bin/cli.js');

function lodName(sourceName, level) {
  return sourceName.replace(/\.glb$/i, `.lod${level}.glb`);
}

/** Component-type maxima used by glTF normalized integer accessors. */
const NORMALIZED_MAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function meshMetrics(document) {
  let tris = 0;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  // Walk nodes rather than meshes: gltf-transform writes quantized LODs whose POSITION is a
  // normalized integer accessor, with the real extent restored by the owning node's matrix.
  // Reading the raw array alone yields the quantized integer range (e.g. 65534) instead of a
  // length in model units, and the runtime divides orig/lod to rescale the mesh — a bogus
  // number there collapses the LOD to sub-pixel size.
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const indices = primitive.getIndices();
      tris += Math.floor((indices ? indices.getCount() : position.getCount()) / 3);
      const array = position.getArray();
      const stride = position.getElementSize();
      const k = position.getNormalized() ? 1 / (NORMALIZED_MAX[position.getComponentType()] ?? 1) : 1;
      for (let i = 0; i + 2 < array.length; i += stride) {
        const x = array[i] * k;
        const y = array[i + 1] * k;
        const z = array[i + 2] * k;
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        lo[0] = Math.min(lo[0], wx); lo[1] = Math.min(lo[1], wy); lo[2] = Math.min(lo[2], wz);
        hi[0] = Math.max(hi[0], wx); hi[1] = Math.max(hi[1], wy); hi[2] = Math.max(hi[2], wz);
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
    const child = spawn(process.execPath, [gltfTransformCli,
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
    // Leftover from an interrupted run; never treat it as a source model.
    .filter((name) => !/\.tmp\.glb$/i.test(name))
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
