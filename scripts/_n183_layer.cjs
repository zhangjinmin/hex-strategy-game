const { formationOffsets, formationSpacing, rotateOffsetPx } = require('../frontend/src/config/formationLayout.ts');
const HEX_R=50, FOV=50, ASPECT=16/9, ELEV=0.55, N=183;
const offs = formationOffsets('wedge', N);
const spacing = formationSpacing(offs, HEX_R);
const LAYER_GAP = 7.07;
const R2A = 0.6180339887498949, R2B = 0.3819660112501051;
const cam = { x: Math.sin(ELEV)*Math.sin(-Math.PI/2)*600, y: Math.cos(ELEV)*600, z: Math.sin(ELEV)*Math.cos(-Math.PI/2)*600 };
function project(px,py,worldY){
  const wx=px, wy=worldY||0, wz=-py;
  const fx=-cam.x, fy=-cam.y, fz=-cam.z, fl=Math.hypot(fx,fy,fz);
  const f={x:fx/fl,y:fy/fl,z:fz/fl};
  const R={x:-f.z,y:0,z:f.x}; const rl=Math.hypot(R.x,R.z); R.x/=rl; R.z/=rl;
  const U={x:R.y*f.z-R.z*f.y, y:R.z*f.x-R.x*f.z, z:R.x*f.y-R.y*f.x};
  const dx=wx-cam.x, dy=wy-cam.y, dz=wz-cam.z;
  const cx=dx*R.x+dy*R.y+dz*R.z, cy=dx*U.x+dy*U.y+dz*U.z, cz=dx*f.x+dy*f.y+dz*f.z;
  const depth=Math.max(0.1,cz), th=Math.tan(FOV*Math.PI/360);
  return {sx:(cx/depth)/(th*ASPECT), sy:(cy/depth)/th};
}
function scatter(label, heightOf) {
  const pts = offs.map(([gx,gy],i)=>{
    const [rx,ry]=rotateOffsetPx(gx*spacing,gy*spacing,0,1);
    return project(rx, ry, heightOf(i, gx, gy));
  });
  const W=72,H=22;
  const xs=pts.map(p=>p.sx), ys=pts.map(p=>p.sy);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const grid=Array.from({length:H},()=>Array(W).fill(' '));
  for (const p of pts){
    const gx=Math.round(((p.sx-x0)/Math.max(1e-6,x1-x0))*(W-1));
    const gy=Math.round(((p.sy-y0)/Math.max(1e-6,y1-y0))*(H-1));
    grid[H-1-gy][gx]='●';
  }
  console.log(`\n--- ${label} ratio=${((y1-y0)/Math.max(1e-6,x1-x0)).toFixed(2)} ---`);
  for (const row of grid) console.log('|'+row.join('')+'|');
}
// A) 现状：R2 行内去相关（14 排 → 16 层）
{
  const gxSet=[...new Set(offs.map(c=>c[0]))].sort((a,b)=>a-b);
  const rowOf=new Map(); gxSet.forEach((g,r)=>rowOf.set(g,r));
  const L=16;
  const heights=offs.map(([gx],i)=>{
    const r=rowOf.get(gx); const rowCells=offs.map((c,j)=>({c,j})).filter(o=>o.c[0]===gx).sort((a,b)=>a.c[1]-b.c[1]);
    const k=rowCells.findIndex(o=>o.j===i);
    const u=((k*R2A + r*R2B)%1+1)%1;
    return Math.min(L-1, Math.floor(u*L)) * LAYER_GAP;
  });
  const mid=(Math.min(...heights)+Math.max(...heights))/2;
  scatter('A 现状 R2 去相关（层高按行内序号散布）', (i)=>heights[i]-mid);
}
// B) 修复：按排单调（第 r 排 → 第 r 层）
{
  const gxSet=[...new Set(offs.map(c=>c[0]))].sort((a,b)=>a-b);
  const rowOf=new Map(); gxSet.forEach((g,r)=>rowOf.set(g,r));
  const R=gxSet.length, L=16;
  const heights=offs.map(([gx])=>{
    const r=rowOf.get(gx);
    return (R<=1?0:Math.round(r*(L-1)/(R-1))) * LAYER_GAP;
  });
  const mid=(Math.min(...heights)+Math.max(...heights))/2;
  scatter('B 修复 按排单调（同排同高、后排更高）', (i)=>heights[i]-mid);
}
// C) 对照：无分层
scatter('C 对照 无分层（纯楔形）', ()=>0);
