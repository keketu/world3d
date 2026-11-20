// 雨夜便利店街角微缩模型：全部几何构建 + 三渲二（卡通着色/描边）工具
// 坐标系：底座 26×26，顶面 y=0，元素向 y+ 堆叠
import * as THREE from "three";

// ---------- 调色板（日式动画夜景：柔和底色 + 霓虹点缀） ----------
export const PAL = {
  outline: 0x141824,
  asphalt: 0x2e3138,
  asphaltDim: 0x26282e,
  curb: 0x9a948a,
  sidewalk: 0xbdb6a8,
  paintWhite: 0xe8e6df,
  baseSide: 0x1b2032,
  baseTop: 0x232a3e,
  storeWall: 0xf2ede2,
  storeWallSide: 0xe3dccd,
  fascia: 0x1e3a5f,
  roof: 0x303744,
  glass: 0x9fd2e8,
  interiorFloor: 0xd9d4c8,
  shelf: 0xd8d2c4,
  counter: 0xe2d6bc,
  vendingRed: 0xc9503e,
  vendingBlue: 0x3a6ea8,
  lampPole: 0x3a3f47,
  pole: 0x555b62,
  neonPink: 0xff5fa2,
  neonCyan: 0x53e3e0,
  neonBlue: 0x5aa8ff,
  warm: 0xffdfae,
  bicycle: 0xc9503e,
  bin: 0x4a5158,
  awningA: 0xe8e2d4,
  awningB: 0x3a6ea8,
};

// ---------- 三渲二：4 阶灰度渐变（卡通着色） ----------
let gradientMap: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (!gradientMap) {
    const data = new Uint8Array([70, 140, 205, 255]);
    gradientMap = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

const toonMats = new Map<string, THREE.MeshToonMaterial>();
/** 卡通材质（同色复用） */
export function toon(color: number): THREE.MeshToonMaterial {
  let m = toonMats.get(String(color));
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    toonMats.set(String(color), m);
  }
  return m;
}

const outlineMat = new THREE.MeshBasicMaterial({ color: PAL.outline, side: THREE.BackSide });
/** 描边（反面外扩壳，仅给大件用） */
export function outlined<T extends THREE.Mesh>(mesh: T, thick = 1.045): T {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(thick);
  mesh.add(o);
  return mesh;
}

/** 店内平涂材质（透过玻璃的明亮二次元室内感） */
const basicMats = new Map<string, THREE.MeshBasicMaterial>();
export function ibasic(color: number): THREE.MeshBasicMaterial {
  let m = basicMats.get(String(color));
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    basicMats.set(String(color), m);
  }
  return m;
}

/** 自发光材质（霓虹/灯） */
export function glow(color: number, intensity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, opacity: intensity, transparent: intensity < 1 });
}

// ---------- 基础几何快捷方式 ----------
export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, ol = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (ol) outlined(m);
  return m;
}
export function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, ol = true, seg = 14): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  if (ol) outlined(m);
  return m;
}
export function sphere(r: number, mat: THREE.Material, x = 0, y = 0, z = 0, ol = false): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), mat);
  m.position.set(x, y, z);
  if (ol) outlined(m);
  return m;
}

/** 画布文字贴图（招牌用）：描边字 + 底色 */
export function textTexture(
  text: string,
  opt: { bg?: string; fg?: string; w?: number; h?: number; font?: number; border?: string } = {}
): THREE.CanvasTexture {
  const w = opt.w ?? 512;
  const h = opt.h ?? 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  g.fillStyle = opt.bg ?? "#f4f2ec";
  g.fillRect(0, 0, w, h);
  if (opt.border) {
    g.strokeStyle = opt.border;
    g.lineWidth = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
  }
  g.fillStyle = opt.fg ?? "#1e3a5f";
  g.font = `900 ${opt.font ?? 72}px "Noto Sans JP", "Meiryo", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 棋盘格地板贴图（店内） */
export function checkerTexture(a = "#e8e4d8", b = "#c9c3b4", cell = 24): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = cell * 8;
  const g = canvas.getContext("2d")!;
  g.fillStyle = a;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = b;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      if ((i + j) % 2 === 0) g.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------- 场景分区构建 ----------

/** 正方形底座 */
export function buildBase(): THREE.Group {
  const g = new THREE.Group();
  const S = 26;
  const top = box(S, 0.5, S, toon(PAL.baseTop), 0, -0.25, 0, false);
  g.add(top);
  g.add(box(S + 0.4, 1.1, S + 0.4, toon(PAL.baseSide), 0, -1.0, 0, false));
  return g;
}

/** 地面层：柏油路 + 前街 + 斑马线 + 停车位 + 排水沟 + 积水 */
export function buildGround(): THREE.Group {
  const g = new THREE.Group();
  const road = toon(PAL.asphalt);
  const roadDim = toon(PAL.asphaltDim);
  const paint = new THREE.MeshStandardMaterial({ color: PAL.paintWhite, roughness: 0.35, metalness: 0.05 });
  const paintDim = new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.4, metalness: 0.05 });

  // 街区底：整片人行道底色
  g.add(box(26, 0.06, 26, toon(PAL.sidewalk), 0, 0.03, 0, false));

  // 前街（东西向 z 8.3..11.5）+ 东侧纵街（x 8.3..11.5）→ 街角转折
  g.add(box(26, 0.08, 3.2, road, 0, 0.08, 9.9));
  g.add(box(3.2, 0.08, 26, roadDim, 9.9, 0.08, 0));

  // 排水沟：前街两侧的深色沟槽 + 篦子
  const drainMat = toon(0x1f2126);
  for (const zz of [8.15, 11.65]) {
    g.add(box(24, 0.02, 0.3, drainMat, 0, 0.115, zz, false));
    for (let x = -11; x <= 11; x += 1.4) {
      g.add(box(0.8, 0.02, 0.18, toon(0x3a3f47), x, 0.126, zz, false));
    }
  }

  // 斑马线（前街，反光材质）
  for (let x = -5.4; x <= 5.4; x += 1.3) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 3.0), paint);
    s.position.set(x, 0.13, 9.9);
    g.add(s);
  }

  // 停车位（前街北侧两个 L 形划线）
  const spot = (x: number) => {
    g.add(box(0.16, 0.02, 2.2, paintDim, x - 1.4, 0.13, 10.6, false));
    g.add(box(1.6, 0.02, 0.16, paintDim, x - 0.6, 0.13, 11.6, false));
  };
  spot(-3.4);
  spot(3.4);

  // 积水路面：几片高反光深色水洼
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x2c3e60, roughness: 0.04, metalness: 0.85 });
  const blobs: Array<[number, number, number, number]> = [
    [-6.5, 9.6, 1.8, 0.9],
    [1.2, 10.6, 2.4, 1.0],
    [6.8, 9.2, 1.5, 0.8],
    [10.2, 3.4, 0.9, 2.2],
    [-9.6, 10.4, 1.2, 0.8],
  ];
  for (const [x, z, w, d] of blobs) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(1, 26), puddleMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = x;
    p.scale.set(w / 2, d / 2, 1);
    p.position.set(x, 0.135, z);
    g.add(p);
  }
  return g;
}

/** 便利店（外壳 + 可见内饰 + 屋顶雨棚招牌） */
export function buildStore(): { shell: THREE.Group; interior: THREE.Group; roofGroup: THREE.Group; signGroup: THREE.Group } {
  const shell = new THREE.Group(); // 外壳（墙体/玻璃/矮墙）——入场时从地面长出
  const interior = new THREE.Group(); // 店内可见内容（货架/冷柜/收银/吊顶）
  const roofGroup = new THREE.Group();
  const signGroup = new THREE.Group();
  const group = new THREE.Group();
  group.add(shell, interior);

  // 外壳：位于 (-3.5, 4)，占地 11×7，前脸朝 +z（大街）
  const CX = -3.5;
  const CZ = 4;
  const W = 11;
  const D = 7;
  const WALL_H = 3.3;

  // 地板（店内棋盘格）
  const floorMat = new THREE.MeshBasicMaterial({ map: checkerTexture() });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 0.1, D - 0.4), floorMat);
  floor.position.set(CX, 0.06, CZ);
  interior.add(floor);

  // 后墙 / 左墙 / 右墙（描边大件）
  shell.add(box(W, WALL_H, 0.3, toon(PAL.storeWallSide), CX, WALL_H / 2, CZ - D / 2));
  shell.add(box(0.3, WALL_H, D, toon(PAL.storeWallSide), CX - W / 2, WALL_H / 2, CZ));
  shell.add(box(0.3, WALL_H, D, toon(PAL.storeWallSide), CX + W / 2, WALL_H / 2, CZ));

  // 前脸：矮墙 + 大面积玻璃橱窗 + 门框
  const frontZ = CZ + D / 2;
  shell.add(box(W, 0.75, 0.24, toon(PAL.storeWall), CX, 0.38, frontZ));
  // 玻璃（三段：橱窗-自动门-橱窗）
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: PAL.glass,
    transparent: true,
    opacity: 0.16,
    roughness: 0.06,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const pane = (w: number, x: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w - 0.12, WALL_H - 0.75, 0.05), glassMat);
    m.position.set(x, 0.75 + (WALL_H - 0.75) / 2, frontZ);
    shell.add(m);
  };
  pane(3.4, CX - W / 2 + 1.75);
  pane(2.2, CX + 0.2); // 自动门位置（双开玻璃门）
  pane(3.4, CX + W / 2 - 1.75);
  // 门框与感应盒
  shell.add(box(0.18, WALL_H - 0.75, 0.14, toon(0x3a3f47), CX - 0.95, 0.75 + (WALL_H - 0.75) / 2, frontZ));
  shell.add(box(0.18, WALL_H - 0.75, 0.14, toon(0x3a3f47), CX + 1.35, 0.75 + (WALL_H - 0.75) / 2, frontZ));

  // 屋顶板（出檐 0.5）+ 檐口深蓝带 —— 屋顶掀开式入场
  roofGroup.add(box(W + 1.0, 0.28, D + 1.0, toon(PAL.roof), CX, WALL_H + 0.14, CZ));
  roofGroup.add(box(W + 1.0, 0.5, 0.18, toon(PAL.fascia), CX, WALL_H - 0.25, frontZ + 0.55));
  // 空调外机（前脸右侧墙面）
  const ac = box(0.9, 0.7, 0.4, toon(0xd8d4ca), CX + W / 2 - 1.6, 2.6, frontZ + 0.3);
  roofGroup.add(ac);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.22, 18), toon(0x2a2e36));
  fan.position.set(CX + W / 2 - 1.6, 2.62, frontZ + 0.51);
  roofGroup.add(fan);

  // ---- 招牌（signGroup 单独分组，霓虹闪烁） ----
  // 主招牌：白底蓝字「コンビニ」
  const signBoard = new THREE.Mesh(
    new THREE.BoxGeometry(6.2, 1.1, 0.16),
    new THREE.MeshStandardMaterial({ map: textTexture("コンビニ", { bg: "#f4f2ec", fg: "#1e3a5f", border: "#1e3a5f" }), roughness: 0.5 })
  );
  signBoard.position.set(CX, WALL_H + 0.55, frontZ + 0.62);
  signGroup.add(signBoard);
  // 竖招牌：粉霓虹「24」
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 2.6, 0.14),
    new THREE.MeshBasicMaterial({ map: textTexture("24時間", { bg: "#232838", fg: "#ff5fa2", w: 128, h: 384, font: 64 }), toneMapped: false })
  );
  blade.position.set(CX - W / 2 - 0.02, WALL_H - 0.9, frontZ - 1.2);
  blade.rotation.y = Math.PI / 2;
  signGroup.add(blade);
  // 橱窗霓虹「営業中」
  const open = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), glowMat(0xff5fa2, textTexCircle("営業中")));
  open.position.set(CX + 2.6, 2.2, frontZ + 0.1);
  signGroup.add(open);

  // ---- 内饰（透过玻璃可见） ----
  // 吊顶 + 灯板
  interior.add(box(W - 0.5, 0.1, D - 0.5, toon(0xe8e4da), CX, WALL_H - 0.12, CZ, false));
  for (const lx of [CX - 3, CX, CX + 3]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.7), glowMat(0xfff6e0));
    panel.position.set(lx, WALL_H - 0.22, CZ);
    interior.add(panel);
  }

  // 货架 ×3（岛式货架，每组四层彩色商品）
  const goodsColors = [0xe8604a, 0x53a8e0, 0xf2b64e, 0x7bb98a, 0xc97ad8, 0xf0e0e8];
  for (let r = 0; r < 3; r++) {
    const sx = CX - 2.6 + r * 1.9;
    const sz = CZ - 1.2;
    interior.add(box(0.9, 1.7, D - 2.6, ibasic(PAL.shelf), sx, 0.85, sz));
    // 四层隔板 + 商品
    for (let tier = 0; tier < 4; tier++) {
      const ty = 0.45 + tier * 0.42;
      interior.add(box(0.95, 0.05, D - 2.7, ibasic(0xcfc8b8), sx, ty, sz, false));
      const cols = Math.floor((D - 2.9) / 0.34);
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.3, 0.24), new THREE.MeshBasicMaterial({}), cols);
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      for (let i = 0; i < cols; i++) {
        m4.makeTranslation(sx, ty + 0.22, sz - (D - 3.1) / 2 + 0.18 + i * 0.34);
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i, col.setHex(goodsColors[(r * 7 + tier * 3 + i) % goodsColors.length]));
      }
      inst.instanceMatrix.needsUpdate = true;
      interior.add(inst);
    }
  }

  // 墙面饮料冷柜（后墙玻璃门 + 彩色瓶装）
  const coolerW = 4.6;
  interior.add(box(coolerW, 2.1, 0.5, ibasic(0x3c4254), CX - 1, 1.05, CZ - D / 2 + 0.32));
  const coolerGlass = new THREE.Mesh(new THREE.BoxGeometry(coolerW - 0.3, 1.8, 0.06), glassMat);
  coolerGlass.position.set(CX - 1, 1.1, CZ - D / 2 + 0.6);
  interior.add(coolerGlass);
  const bottle = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 8), new THREE.MeshBasicMaterial({}), 34);
  const bm = new THREE.Matrix4();
  const bc = new THREE.Color();
  let bi = 0;
  for (let tier = 0; tier < 4 && bi < 34; tier++) {
    for (let i = 0; i < 8 && bi < 34; i++) {
      bm.makeTranslation(CX - 1 - coolerW / 2 + 0.5 + i * 0.52, 0.45 + tier * 0.48, CZ - D / 2 + 0.5);
      bottle.setMatrixAt(bi, bm);
      bottle.setColorAt(bi, bc.setHex(goodsColors[(tier * 5 + i) % goodsColors.length]));
      bi++;
    }
  }
  bottle.instanceMatrix.needsUpdate = true;
  interior.add(bottle);

  // 收银台（前窗右侧）+ 收银机
  interior.add(box(2.0, 0.95, 0.8, ibasic(PAL.counter), CX + W / 2 - 1.6, 0.5, CZ + 0.8));
  interior.add(box(0.5, 0.35, 0.4, ibasic(0x3c4254), CX + W / 2 - 1.9, 1.15, CZ + 0.8));
  interior.add(box(0.42, 0.3, 0.05, glowMat(0x9fd8ef), CX + W / 2 - 1.9, 1.18, CZ + 1.0));

  // 杂志架（门旁）
  interior.add(box(0.9, 1.2, 0.3, ibasic(0x8a6a48), CX + 2.2, 0.6, CZ + D / 2 - 0.4));
  for (let i = 0; i < 5; i++) {
    interior.add(box(0.7, 0.24, 0.06, ibasic(goodsColors[i % 6]), CX + 2.2, 0.45 + i * 0.24, CZ + D / 2 - 0.28));
  }

  return { shell, interior, roofGroup, signGroup };
}

/** 圆形霓虹文字贴图 */
function textTexCircle(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = "#ff5fa2";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#ff5fa2";
  g.font = '900 30px "Noto Sans JP", "Meiryo", sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 64, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowMat(color: number, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, map, transparent: true, toneMapped: false, side: THREE.DoubleSide });
}

/** 街景道具组：贩卖机/自行车/伞架/垃圾桶/路灯/电线杆/护栏/公告栏 */
export function buildProps(): THREE.Group {
  const g = new THREE.Group();
  const metal = toon(0x3a3f47);

  // 自动贩卖机 ×2（便利店门口右侧，一红一蓝，发光面板）
  const vend = (x: number, z: number, color: number) => {
    const v = new THREE.Group();
    v.add(box(1.1, 1.9, 0.8, toon(color), 0, 0.95, 0));
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.3, 0.06), glowMat(0xbfd8e8));
    face.position.set(0, 1.15, 0.42);
    v.add(face);
    // 面板按钮与投币口
    for (let i = 0; i < 4; i++) {
      v.add(box(0.12, 0.12, 0.04, glowMat(0xffdfae), -0.32 + i * 0.22, 1.62, 0.44));
    }
    v.position.set(x, 0, z);
    return v;
  };
  g.add(vend(-7.7, 8.0, PAL.vendingRed));
  g.add(vend(-6.4, 8.05, PAL.vendingBlue));

  // 自行车 ×2（东墙小巷口，斜靠）
  const bike = (x: number, z: number) => {
    const b = new THREE.Group();
    const wheel = (wx: number) => {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 20), toon(0x22262c));
      w.rotation.y = Math.PI / 2;
      w.position.set(wx, 0.32, 0);
      b.add(w);
    };
    wheel(-0.4);
    wheel(0.4);
    // 车架：前管/后管/横梁
    b.add(box(0.06, 0.5, 0.06, toon(PAL.bicycle), 0.34, 0.5, 0));
    b.add(box(0.06, 0.4, 0.06, toon(PAL.bicycle), -0.3, 0.52, 0));
    b.add(box(0.72, 0.05, 0.05, toon(PAL.bicycle), 0, 0.68, 0));
    b.add(box(0.05, 0.05, 0.4, toon(PAL.bicycle), 0.38, 0.82, 0)); // 车把横杆
    b.add(box(0.28, 0.07, 0.13, toon(0x2b2b33), -0.26, 0.74, 0)); // 座
    const basket = box(0.3, 0.2, 0.24, toon(0x8a8f96), 0.38, 0.72, 0);
    b.add(basket);
    b.rotation.z = 0.06; // 轻微斜靠
    b.position.set(x, 0, z);
    return b;
  };
  g.add(bike(2.6, 5.6));
  g.add(bike(2.7, 6.4));

  // 雨伞架 + 两把折伞（自动门旁）
  const stand = cyl(0.24, 0.28, 0.5, toon(0x4a5158), -1.7, 0.25, 7.6);
  g.add(stand);
  const umbrella = (x: number, z: number, color: number, lean: number) => {
    const u = new THREE.Group();
    u.add(cyl(0.025, 0.025, 0.9, toon(0x3d4247), 0, 0.45, 0));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 8), toon(color));
    cap.position.y = 0.86;
    u.add(cap);
    u.position.set(x, 0, z);
    u.rotation.z = lean;
    return u;
  };
  g.add(umbrella(-1.62, 7.55, 0x5aa8ff, 0.12));
  g.add(umbrella(-1.8, 7.68, 0xc9503e, -0.1));

  // 垃圾桶（贩卖机旁）
  g.add(cyl(0.3, 0.26, 0.75, toon(PAL.bin), -8.8, 0.38, 7.2));
  g.add(cyl(0.32, 0.32, 0.06, toon(0x3a3f47), -8.8, 0.78, 7.2));

  // 公告栏（小巷口东墙）
  const bb = new THREE.Group();
  bb.add(box(1.6, 1.1, 0.08, toon(0x6b4a2f), 0, 0, 0));
  for (const [x, y, c] of [[-0.5, 0.2, "#f2e3cd"], [0.1, -0.1, "#bcd8f5"], [0.45, 0.25, "#f2d998"]] as Array<[number, number, string]>) {
    bb.add(box(0.5, 0.4, 0.03, toon(new THREE.Color(c).getHex()), x, y, 0.06));
  }
  bb.position.set(3.2, 1.6, 7.9);
  g.add(bb);

  // 路灯（街角）
  const lamp = new THREE.Group();
  lamp.add(cyl(0.14, 0.18, 0.2, metal, 0, 0.1, 0));
  lamp.add(cyl(0.06, 0.1, 4.2, toon(PAL.lampPole), 0, 2.2, 0));
  lamp.add(box(0.1, 0.1, 1.3, toon(PAL.lampPole), 0, 4.2, 0.6));
  const lampHead = box(0.5, 0.14, 0.8, toon(PAL.lampPole), 0, 4.15, 1.1);
  lamp.add(lampHead);
  const lampGlow = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.7), glowMat(0xffdfae));
  lampGlow.position.set(0, 4.06, 1.1);
  lamp.add(lampGlow);
  const lampLight = new THREE.PointLight(0xffdfae, 2.2, 12, 1.6);
  lampLight.position.set(0, 3.9, 1.1);
  lamp.add(lampLight);
  lamp.position.set(9.6, 0, 8.0);
  g.add(lamp);

  // 电线杆 + 变压器 + 电线（东街）
  const pole = new THREE.Group();
  pole.add(cyl(0.11, 0.15, 6.4, toon(PAL.pole), 0, 3.2, 0));
  pole.add(box(1.7, 0.12, 0.12, toon(PAL.pole), 0, 5.5, 0));
  pole.add(box(1.2, 0.1, 0.1, toon(PAL.pole), 0, 5.0, 0));
  pole.add(cyl(0.28, 0.28, 0.7, toon(0x6b7076), 0.3, 4.4, 0));
  for (const wx of [-0.6, 0, 0.6]) {
    pole.add(cyl(0.05, 0.05, 0.18, toon(0x8a8f96), wx, 5.62, 0));
  }
  pole.position.set(11.6, 0, 3.2);
  g.add(pole);

  // 路牌（蓝底白字，街角）
  const roadSign = new THREE.Group();
  roadSign.add(cyl(0.05, 0.05, 2.4, metal, 0, 1.2, 0));
  const signPlate = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.55, 0.06),
    new THREE.MeshStandardMaterial({ map: textTexture("中央通り", { bg: "#1e3a5f", fg: "#f4f2ec", w: 256, h: 96, font: 48 }), roughness: 0.5 })
  );
  signPlate.position.set(0, 2.3, 0);
  roadSign.add(signPlate);
  roadSign.position.set(-11.8, 0, 7.8);
  g.add(roadSign);

  // 街角护栏（黄黑条纹，转角处三段）
  const rail = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.09), stripedMat());
    bar.position.y = 0.62;
    seg.add(bar);
    seg.add(cyl(0.05, 0.06, 0.62, metal, -0.6, 0.31, 0));
    seg.add(cyl(0.05, 0.06, 0.62, metal, 0.6, 0.31, 0));
    seg.position.set(-5.2 + i * 1.32, 0, 12.1);
    rail.add(seg);
  }
  g.add(rail);

  // 电线（杆→楼、杆→底座角，三条悬链线）
  const wireMat = new THREE.LineBasicMaterial({ color: 0x20242c });
  const wire = (from: THREE.Vector3, to: THREE.Vector3, sag: number) => {
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y -= sag;
    const curve = new THREE.CatmullRomCurve3([from, mid, to]);
    const pts = curve.getPoints(24);
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
  };
  wire(new THREE.Vector3(11.6, 5.62, 3.2), new THREE.Vector3(-2.5, 4.6, 6.4), 0.7);
  wire(new THREE.Vector3(11.6, 5.62, 3.2), new THREE.Vector3(13, 4.2, 12.8), 0.5);
  wire(new THREE.Vector3(11.6, 5.5, 3.2), new THREE.Vector3(11.6, 5.62, 12.9), 0.6);

  return g;
}

/** 黄黑条纹材质（护栏） */
let striped: THREE.MeshToonMaterial | null = null;
function stripedMat(): THREE.MeshToonMaterial {
  if (!striped) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 16;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#e8c45a";
    g.fillRect(0, 0, 128, 16);
    g.fillStyle = "#2b2b33";
    for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 16, 16);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    striped = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() });
  }
  return striped;
}
