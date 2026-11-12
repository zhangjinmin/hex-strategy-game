const { formationOffsets, formationSpacing, rotateOffsetPx } = require('../frontend/src/config/formationLayout.ts');
const HEX_R = 50, FOV = 50, ASPECT = 16/9, ELEV = 0.55, AZIM = 0.6, N = 183;
const offs = formationOffsets('wedge', N);
const spacing = formationSpacing(offs, HEX_R);
console.log(`n=${N} spacing=${spacing.toFixed(2)}px rows(gx)=${new Set(offs.map(c=>c[0])).size}`);
// 相机
const dist = HEX_R * 12;
const cam = { x: Math.sin(ELEV)*Math.sin(AZIM)*dist, y: Math.cos(ELEV)*dist, z: Math.sin(ELEV)*Math.cos(AZIM)*dist };
function project(px, py) {
  const wx = px, wz = -py;
  const fx = -cam.x, fy = -cam.y, fz = -cam.z;
  const fl = Math.hypot(fx, fy, fz);
  const f = { x: fx/fl, y: fy/fl, z: fz/fl };
  const R = { x: -f.z, y: 0, z: f.x }; const rl = Math.hypot(R.x, R.z); R.x/=rl; R.z/=rl;
  const U = { x: R.y*f.z - R.z*f.y, y: R.z*f.x - R.x*f.z, z: R.x*f.y - R.y*f.x };
  const dx = wx-cam.x, dy = -cam.y, dz = wz-cam.z;
  const cx = dx*R.x+dy*R.y+dz*R.z, cy = dx*U.x+dy*U.y+dz*U.z, cz = dx*f.x+dy*f.y+dz*f.z;
  const depth = Math.max(0.1, cz);
  const th = Math.tan(FOV*Math.PI/360);
  return { sx: (cx/depth)/(th*ASPECT), sy: (cy/depth)/th, depth };
}
for (const facingDeg of [0, 180, 90, 45]) {
  const facing = facingDeg*Math.PI/180;
  const pts = offs.map(([gx,gy]) => {
    const [rx,ry] = rotateOffsetPx(gx*spacing, gy*spacing, facing, 1);
    return project(rx, ry);
  });
  const W=72, H=24;
  const xs=pts.map(p=>p.sx), ys=pts.map(p=>p.sy);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const grid=Array.from({length:H},()=>Array(W).fill(' '));
  for (const p of pts) {
    const gx=Math.round(((p.sx-x0)/Math.max(1e-6,x1-x0))*(W-1));
    const gy=Math.round(((p.sy-y0)/Math.max(1e-6,y1-y0))*(H-1));
    grid[H-1-gy][gx]='●';
  }
  console.log(`\n--- n=183 facing=${facingDeg}° dist=${dist} 跨度 ${ (x1-x0).toFixed(2)}×${(y1-y0).toFixed(2)} ratio=${((y1-y0)/Math.max(1e-6,x1-x0)).toFixed(2)} ---`);
  for (const row of grid) console.log('|'+row.join('')+'|');
}
