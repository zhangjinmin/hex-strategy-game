/**
 * 台架：量化 LOD（KHR_mesh_quantization）经 shipModels 合并后不得失真。
 *
 * 复现的 bug：BufferAttribute.applyMatrix4 对 normalized 整型数组会 setXYZ 回写，
 * 写前再 ×32767；node 缩放 >1 时溢出饱和 ⇒ 整艘船被压成 2×2×2 的盒子。
 * 判据：合并后包围盒最长轴必须与原始模型一致（±0.5%），且不随 node 缩放漂移。
 *
 * 跑法：cd frontend && node scripts/_probe_quantizedMerge.mjs
 */
globalThis.self = globalThis;

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const shipDir = resolve(import.meta.dirname, '../src/assets/ship');
await MeshoptDecoder.ready;

// 与 shipModels.ts 的加载/合并路径保持一致（含 [量化LOD] 反量化修复）
async function mergedSize(file) {
  const buf = await readFile(resolve(shipDir, file));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((res, rej) => {
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej);
  });
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts = [];
  const perPart = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    let g = o.geometry.clone();
    if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    for (const name of ['position', 'normal']) {
      const attr = g.getAttribute(name);
      if (!attr || !attr.normalized) continue;
      const out = new Float32Array(attr.count * 3);
      for (let i = 0; i < attr.count; i++) {
        out[i * 3] = attr.getX(i);
        out[i * 3 + 1] = attr.getY(i);
        out[i * 3 + 2] = attr.getZ(i);
      }
      g.setAttribute(name, new THREE.BufferAttribute(out, 3, false));
    }
    g.applyMatrix4(o.matrixWorld);
    const size = new THREE.Box3().setFromBufferAttribute(g.attributes.position).getSize(new THREE.Vector3());
    perPart.push({ name: o.name, size });
    parts.push(g);
  });
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  merged.computeBoundingBox();
  return { merged: merged.boundingBox.getSize(new THREE.Vector3()), perPart };
}

const CASES = [
  // [文件, 期望 longestAxis, 说明]
  ['alliance_battleship121.glb', 31.219, '原始模型（节点无变换）'],
  ['alliance_battleship121.lod1.glb', 31.219, '量化 LOD，node scale 15.61（溢出触发点）'],
  ['alliance_battleship121.lod2.glb', 31.219, '量化 LOD2，node scale 15.61'],
  ['alliance_battleship.lod1.glb', 1.1812, '量化 LOD，node scale 0.59（本就没溢出，防回归）'],
];

let failed = 0;
for (const [file, expect, note] of CASES) {
  try {
    const { merged, perPart } = await mergedSize(file);
    const got = Math.max(merged.x, merged.y, merged.z);
    const rel = Math.abs(got - expect) / expect;
    const ok = rel <= 0.005;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${file}  longestAxis=${got.toFixed(4)} (expect ${expect}, rel ${(rel * 100).toFixed(2)}%)  [${note}]`);
    console.log(`     parts: ${perPart.map((p) => `${p.name}=${p.size.toArray().map((v) => v.toFixed(2)).join('x')}`).join(' | ')}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${file}  ${e.message}`);
  }
}
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} CASE(S) FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
