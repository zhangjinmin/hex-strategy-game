const { formationOffsets, formationSpacing, rotateOffsetPx } = require('../frontend/src/config/formationLayout.ts');
const HEX_R=50, FOV=50, ASPECT=16/9, ELEV=0.55, N=183;
const offs = formationOffsets('wedge', N);
const spacing = formationSpacing(offs, HEX_R);
function scatterFor(label, azim, facing) {
  const dist = HEX_R * 12;
  const cam = { x: Math.sin(ELEV)*Math.sin(azim)*dist, y: Math.cos(ELEV)*dist, z: Math.sin(ELEV)*Math.cos(azim)*dist };
  function project(px,py){
    const wx=px, wz=-py;
    const fx=-cam.x, fy=-cam.y, fz=-cam.z, fl=Math.hypot(fx,fy,fz);
    const f={x:fx/fl,y:fy/fl,z:fz/fl};
    const R={x:-f.z,y:0,z:f.x}; const rl=Math.hypot(R.x,R.z); R.x/=rl; R.z/=rl;
    const U={x:R.y*f.z-R.z*f.y, y:R.z*f.x-R.x*f.z, z:R.x*f.y-R.y*f.x};
    const dx=wx-cam.x, dy=-cam.y, dz=wz-cam.z;
    const cx=dx*R.x+dy*R.y+dz*R.z, cy=dx*U.x+dy*U.y+dz*U.z, cz=dx*f.x+dy*f.y+dz*f.z;
    const depth=Math.max(0.1,cz), th=Math.tan(FOV*Math.PI/360);
    return {sx:(cx/depth)/(th*ASPECT), sy:(cy/depth)/th};
  }
  const pts = offs.map(([gx,gy])=>{ const [rx,ry]=rotateOffsetPx(gx*spacing,gy*spacing,facing,1); return project(rx,ry); });
  const W=72,H=22;
  const xs=pts.map(p=>p.sx), ys=pts.map(p=>p.sy);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const grid=Array.from({length:H},()=>Array(W).fill(' '));
  for (const p of pts){
    const gx=Math.round(((p.sx-x0)/Math.max(1e-6,x1-x0))*(W-1));
    const gy=Math.round(((p.sy-y0)/Math.max(1e-6,y1-y0))*(H-1));
    grid[H-1-gy][gx]='●';
  }
  console.log(`\n--- ${label} ---`);
  for (const row of grid) console.log('|'+row.join('')+'|');
}
// 现状：azim=0.6（硬编码），facing=0
scatterFor('现状 azim=0.6 facing=0（用户看到的斜带）', 0.6, 0);
// 修复：相机置于舰队后方（沿 -forward），azim = atan2(-cos fa, sin fa)
const fa = 0;
const azimBehind = Math.atan2(-Math.cos(fa), Math.sin(fa));
scatterFor(`修复 azim=${azimBehind.toFixed(3)}(=-PI/2) facing=0（相机在队尾后方）`, azimBehind, fa);
const azimFront = Math.atan2(Math.cos(fa), -Math.sin(fa));
scatterFor(`备选 azim=${azimFront.toFixed(3)}(=+PI/2) facing=0（相机在队首前方）`, azimFront, fa);
// 守方 facing=PI 同理
const fa2 = Math.PI;
const azimBehind2 = Math.atan2(-Math.cos(fa2), Math.sin(fa2));
scatterFor(`修复 守方 facing=180° azim=${azimBehind2.toFixed(3)}`, azimBehind2, fa2);
