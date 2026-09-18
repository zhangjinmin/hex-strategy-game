/** [探针桥接] 把 three / FBXLoader / GLTFExporter 包成 Vite 能解析的模块，供页内 `page.evaluate` 使用。
 *  原因：`page.evaluate` 里 `import('three')` 解析不了裸模块名（项目已知坑）。 */
export * as THREE from 'three';
export { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
