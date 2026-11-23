// 地形：连续网格 + 城市贴图（阳光都市路网/街区全画进 CanvasTexture）
import * as THREE from "three";
import { WORLD_SEED, mulberry32, zoneAt, blockId, ROAD_LINES, ROAD_HALF, SIDEWALK_W, EDGE_GRASS, CITY_SIZE } from "@world3d/shared";
import { clientWorld } from "./world";
import { getTownPlan, type Paving, type ParkingBay } from "../scene/town/townPlan";

const SEGMENTS = 220; // 256 世界 / 220 段 ≈ 1.16m 一格
const TEX_PX_PER_M = 8; // 2048² 贴图 = 8px/m，0.3m 标线 ≈ 2.4px 清晰

const m2p = (v: number) => v * TEX_PX_PER_M;

/** 阳光都市地面配色 */
const COLORS = {
  grass: "#8fbc6f",       // 外圈草绿
  park: "#7fb35f",        // 公园 / 绿带（深一档）
  parkDark: "#6ea354",
  sidewalk: "#cfc8ba",    // 人行道浅灰
  road: "#57534e",        // 暖色沥青
  laneDash: "rgba(246,240,228,0.9)",
  plaza: "#c9c3b6",       // 广场石砖灰
  plazaRing: "#b5afa2",
  curb: "#a9a294",
  lotTints: ["#93c273", "#8ab96a", "#9dc97f", "#88b566", "#97c077"], // 街区=草地绿（深浅微差）
  forecourt: "#ded5c0",  // 建筑门前小广场：暖色石板
  walkway: "#d3c9b3",   // 步道：略深的石板
};

function blockTint(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return COLORS.lotTints[Math.abs(h) % COLORS.lotTints.length];
}

/** 在画布上摆到世界坐标 (x,z) 并转 rotY（局部 +z 朝 (sin rotY, cos rotY)），在世界系里画矩形 */
function inLocal(g: CanvasRenderingContext2D, x: number, z: number, rotY: number, draw: () => void) {
  g.save();
  g.translate(m2p(x), m2p(z));
  g.rotate(-rotY);
  draw();
  g.restore();
}

/** 建筑门前铺装 / 步道（石板 + 细边） */
function drawPaving(g: CanvasRenderingContext2D, p: Paving) {
  inLocal(g, p.x, p.z, p.rotY, () => {
    g.fillStyle = p.tone === 0 ? COLORS.forecourt : COLORS.walkway;
    g.fillRect(m2p(-p.hw), m2p(-p.hd), m2p(p.hw * 2), m2p(p.hd * 2));
    g.strokeStyle = "rgba(140,128,106,0.45)";
    g.lineWidth = m2p(0.1);
    g.strokeRect(m2p(-p.hw), m2p(-p.hd), m2p(p.hw * 2), m2p(p.hd * 2));
  });
}

/** 路边泊位：两端横线 + 路缘侧长边（局部 +z 朝路缘） */
function drawBay(g: CanvasRenderingContext2D, b: ParkingBay) {
  inLocal(g, b.x, b.z, b.rotY, () => {
    g.strokeStyle = "rgba(240,238,230,0.85)";
    g.lineWidth = m2p(0.14);
    g.beginPath();
    g.moveTo(m2p(-b.len / 2), m2p(-b.wid / 2));
    g.lineTo(m2p(-b.len / 2), m2p(b.wid / 2));
    g.lineTo(m2p(b.len / 2), m2p(b.wid / 2));
    g.lineTo(m2p(b.len / 2), m2p(-b.wid / 2));
    g.stroke();
  });
}

/** 在街区矩形内撒低透明度噪点，打破大色块的塑料感 */
function speckle(g: CanvasRenderingContext2D, rng: () => number, x0: number, z0: number, x1: number, z1: number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rng() * (x1 - x0);
    const z = z0 + rng() * (z1 - z0);
    const r = 0.15 + rng() * 0.4;
    g.fillStyle = rng() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(60,50,40,${alpha})`;
    g.beginPath();
    g.arc(m2p(x), m2p(z), m2p(r), 0, Math.PI * 2);
    g.fill();
  }
}

/** 路口斑马线：四个方向的过街条纹 */
function crosswalk(g: CanvasRenderingContext2D, cx: number, cz: number) {
  g.fillStyle = COLORS.laneDash;
  const half = ROAD_HALF;
  const depth = 1.8; // 条纹带深度
  const off = half + 1.2; // 条纹带中心距路口中心
  for (const s of [-1, 1]) {
    // 南北向过街（条纹沿 x 排布）
    const z0 = cz + s * (off - depth / 2);
    for (let x = cx - half + 0.6; x <= cx + half - 1.2; x += 1.2) {
      g.fillRect(m2p(x), m2p(z0), m2p(0.6), m2p(depth));
    }
    // 东西向过街（条纹沿 z 排布）
    const x0 = cx + s * (off - depth / 2);
    for (let z = cz - half + 0.6; z <= cz + half - 1.2; z += 1.2) {
      g.fillRect(m2p(x0), m2p(z), m2p(depth), m2p(0.6));
    }
  }
}

/** 画整张城市贴图：底草绿 → 街区色 → 人行道 → 路面 → 标线/斑马线 */
function drawCityCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * TEX_PX_PER_M;
  const g = canvas.getContext("2d")!;
  const rng = mulberry32(WORLD_SEED ^ 0x7374796c); // "styl"

  // 1) 底色草绿（外圈绿带基底）
  g.fillStyle = COLORS.grass;
  g.fillRect(0, 0, canvas.width, canvas.height);

  // 2) 街区/广场/公园底色（整块矩形铺，人行道与路面稍后覆盖回去）
  const bounds = [0, ...ROAD_LINES, size]; // 块边界线
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const x0 = m2p(bounds[i]);
      const z0 = m2p(bounds[j]);
      const w = m2p(bounds[i + 1] - bounds[i]);
      const h = m2p(bounds[j + 1] - bounds[j]);
      const id = blockId(
        (bounds[i] + bounds[i + 1]) / 2,
        (bounds[j] + bounds[j + 1]) / 2
      );
      if (id === "2-2" || id === "2-3") {
        // 市民广场（被 z=160 那条路分成南北两块）：外圈草坪环，中间 34×34 浅色石板核心，十字步道通向四边人行道
        const cx = bounds[i] + 32;
        const cz = bounds[j] + 32;
        g.fillStyle = blockTint(id);
        g.fillRect(x0, z0, w, h);
        g.fillStyle = "rgba(255,255,255,0.075)";
        for (let t = bounds[i] + 2; t < bounds[i + 1]; t += 8) g.fillRect(m2p(t), z0, m2p(4), h);
        g.fillStyle = COLORS.plaza;
        const half = 17;
        const pw = 1.6; // 步道半宽
        g.fillRect(m2p(cx - half), m2p(cz - half), m2p(half * 2), m2p(half * 2));
        g.fillRect(m2p(cx - pw), m2p(cz - 26), m2p(pw * 2), m2p(26 - half));
        g.fillRect(m2p(cx - pw), m2p(cz + half), m2p(pw * 2), m2p(26 - half));
        g.fillRect(m2p(cx - 26), m2p(cz - pw), m2p(26 - half), m2p(pw * 2));
        g.fillRect(m2p(cx + half), m2p(cz - pw), m2p(26 - half), m2p(pw * 2));
        // 核心 4m 分格，隔一格加深一点，读得出棋盘而不花
        g.strokeStyle = "rgba(120,112,96,0.38)";
        g.lineWidth = m2p(0.08);
        for (let t = cx - half; t <= cx + half; t += 4) {
          g.beginPath(); g.moveTo(m2p(t), m2p(cz - half)); g.lineTo(m2p(t), m2p(cz + half)); g.stroke();
          g.beginPath(); g.moveTo(m2p(cx - half), m2p(t)); g.lineTo(m2p(cx + half), m2p(t)); g.stroke();
        }
        g.fillStyle = "rgba(120,112,96,0.07)";
        for (let tx = cx - half; tx < cx + half; tx += 8) {
          for (let tz = cz - half + (((tx - cx + half) / 4) % 2 ? 4 : 0); tz < cz + half; tz += 8) {
            g.fillRect(m2p(tx), m2p(tz), m2p(4), m2p(4));
          }
        }
        // 围着中心景点的装饰环
        g.strokeStyle = COLORS.plazaRing;
        g.lineWidth = m2p(0.5);
        for (const r of [10.5, 11.2, 16]) {
          g.beginPath();
          g.arc(m2p(cx), m2p(cz), m2p(r), 0, Math.PI * 2);
          g.stroke();
        }
        continue;
      }
      if (i === 0 || i === 4 || j === 0 || j === 4) {
        // 外环绿带
        g.fillStyle = COLORS.park;
        g.fillRect(x0, z0, w, h);
        speckle(g, rng, bounds[i], bounds[j], bounds[i + 1], bounds[j + 1], 140, 0.07);
        continue;
      }
      if (zoneAt((bounds[i] + bounds[i + 1]) / 2, (bounds[j] + bounds[j + 1]) / 2) === "park") {
        // 公园块：草地 + 深浅斑块 + 环形土路和中央小广场（三维里有长椅环着它）
        g.fillStyle = COLORS.park;
        g.fillRect(x0, z0, w, h);
        for (let k = 0; k < 16; k++) {
          const bx = bounds[i] + 6 + rng() * (bounds[i + 1] - bounds[i] - 12);
          const bz = bounds[j] + 6 + rng() * (bounds[j + 1] - bounds[j] - 12);
          g.fillStyle = "rgba(96,150,80,0.35)";
          g.beginPath();
          g.arc(m2p(bx), m2p(bz), m2p(1.2 + rng() * 2.2), 0, Math.PI * 2);
          g.fill();
        }
        const pcx = m2p(bounds[i] + 32);
        const pcz = m2p(bounds[j] + 32);
        g.strokeStyle = "#cdb08a";
        g.lineWidth = m2p(1.3);
        g.beginPath();
        g.arc(pcx, pcz, m2p(12), 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = "#cdb08a";
        g.beginPath();
        g.arc(pcx, pcz, m2p(2.6), 0, Math.PI * 2);
        g.fill();
        continue;
      }
      // 普通街区地块：修剪过的草坪——每块深浅微差，叠 4m 宽的割草条纹（方向逐块交替）
      g.fillStyle = blockTint(id);
      g.fillRect(x0, z0, w, h);
      g.fillStyle = "rgba(255,255,255,0.075)";
      const alongX = (i + j) % 2 === 0;
      for (let t = bounds[i] + 2; t < bounds[i + 1]; t += 8) {
        if (alongX) g.fillRect(m2p(t), z0, m2p(4), h);
      }
      for (let t = bounds[j] + 2; t < bounds[j + 1]; t += 8) {
        if (!alongX) g.fillRect(x0, m2p(t), w, m2p(4));
      }
      speckle(g, rng, bounds[i] + 8, bounds[j] + 8, bounds[i + 1] - 8, bounds[j + 1] - 8, 160, 0.045);
    }
  }

  // 2b) 建筑门前铺装与步道（和三维陈设同一份布局：townPlan）
  for (const p of getTownPlan(clientWorld.objects.values()).paving) drawPaving(g, p);

  // 3) 人行道（贴着路两侧的全长条带）
  g.fillStyle = COLORS.sidewalk;
  const clipLo = m2p(EDGE_GRASS);
  const clipHi = m2p(size - EDGE_GRASS);
  for (const L of ROAD_LINES) {
    g.fillRect(m2p(L - ROAD_HALF - SIDEWALK_W), clipLo, m2p(SIDEWALK_W), clipHi - clipLo);
    g.fillRect(m2p(L + ROAD_HALF), clipLo, m2p(SIDEWALK_W), clipHi - clipLo);
    g.fillRect(clipLo, m2p(L - ROAD_HALF - SIDEWALK_W), clipHi - clipLo, m2p(SIDEWALK_W));
    g.fillRect(clipLo, m2p(L + ROAD_HALF), clipHi - clipLo, m2p(SIDEWALK_W));
  }

  // 4) 路面（盖过人行道条带相交处）
  g.fillStyle = COLORS.road;
  for (const L of ROAD_LINES) {
    g.fillRect(m2p(L - ROAD_HALF), clipLo, m2p(ROAD_HALF * 2), clipHi - clipLo);
    g.fillRect(clipLo, m2p(L - ROAD_HALF), clipHi - clipLo, m2p(ROAD_HALF * 2));
  }

  // 5) 路缘石（人行道与路面交界描一圈浅色）
  g.strokeStyle = COLORS.curb;
  g.lineWidth = m2p(0.22);
  for (const L of ROAD_LINES) {
    for (const s of [-1, 1]) {
      const v = L + s * ROAD_HALF;
      g.strokeRect(m2p(v - 0.11), clipLo, m2p(0.22), clipHi - clipLo);
      g.strokeRect(clipLo, m2p(v - 0.11), clipHi - clipLo, m2p(0.22));
    }
  }

  // 6) 车道中央虚线：分段画，路口里不画（路口是斑马线和停止线的地方）
  g.strokeStyle = COLORS.laneDash;
  g.lineWidth = m2p(0.3);
  g.setLineDash([m2p(3), m2p(2.6)]);
  {
    const edges = [EDGE_GRASS, ...ROAD_LINES, size - EDGE_GRASS];
    for (const L of ROAD_LINES) {
      for (let s = 0; s < edges.length - 1; s++) {
        const from = edges[s] + (s > 0 ? ROAD_HALF + 1.6 : 0);
        const to = edges[s + 1] - (s < edges.length - 2 ? ROAD_HALF + 1.6 : 0);
        g.lineDashOffset = -m2p(from);
        g.beginPath();
        g.moveTo(m2p(L), m2p(from));
        g.lineTo(m2p(L), m2p(to));
        g.stroke();
        g.beginPath();
        g.moveTo(m2p(from), m2p(L));
        g.lineTo(m2p(to), m2p(L));
        g.stroke();
      }
    }
    g.lineDashOffset = 0;
  }
  g.setLineDash([]);

  // 7) 路口斑马线
  for (const Lx of ROAD_LINES) {
    for (const Lz of ROAD_LINES) crosswalk(g, Lx, Lz);
  }

  // 8) 人行道砖缝（横缝每 2.2m 一道），只在路段内画，路口里没有人行道就不画
  {
    const edges = [EDGE_GRASS, ...ROAD_LINES, size - EDGE_GRASS];
    g.strokeStyle = "rgba(120,110,96,0.35)";
    g.lineWidth = m2p(0.06);
    for (const L of ROAD_LINES) {
      for (const s of [-1, 1]) {
        const a = m2p(L + s * (ROAD_HALF + 0.2));
        const b = m2p(L + s * (ROAD_HALF + SIDEWALK_W - 0.2));
        for (let k = 0; k < edges.length - 1; k++) {
          const from = edges[k] + (k > 0 ? ROAD_HALF : 0);
          const to = edges[k + 1] - (k < edges.length - 2 ? ROAD_HALF : 0);
          for (let t = from + 1.1; t < to; t += 2.2) {
            g.beginPath();
            g.moveTo(a, m2p(t));
            g.lineTo(b, m2p(t));
            g.stroke();
            g.beginPath();
            g.moveTo(m2p(t), a);
            g.lineTo(m2p(t), b);
            g.stroke();
          }
        }
      }
    }
  }

  // 9) 路面磨损：深浅沥青斑块 + 井盖圆
  const roadRng = mulberry32(WORLD_SEED ^ 0x77656172); // "wear"
  for (let i = 0; i < 260; i++) {
    const L = ROAD_LINES[Math.floor(roadRng() * ROAD_LINES.length)];
    const along = m2p(8 + roadRng() * (size - 16));
    const across = m2p(L + (roadRng() - 0.5) * ROAD_HALF * 1.6);
    const r = m2p(0.3 + roadRng() * 0.9);
    g.fillStyle = roadRng() > 0.5 ? "rgba(30,28,26,0.25)" : "rgba(120,116,110,0.18)";
    if (roadRng() > 0.5) {
      g.fillRect(across - r, along - r * 0.6, r * 2, r * 1.2);
    } else {
      g.beginPath();
      g.arc(across, along, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const L of ROAD_LINES) {
    for (const M of ROAD_LINES) {
      // 井盖：路口附近的圆形铁盖
      const mx = m2p(L + 2.6);
      const mz = m2p(M - 2.6);
      g.fillStyle = "#4a4740";
      g.beginPath();
      g.arc(mx, mz, m2p(0.55), 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#5d594f";
      g.lineWidth = m2p(0.08);
      g.stroke();
    }
  }

  // 10) 路边泊位白线（和停着的车同一份布局）
  for (const b of getTownPlan(clientWorld.objects.values()).bays) drawBay(g, b);

  return canvas;
}

let cityTexture: THREE.CanvasTexture | null = null;

/** 构建（或复用）城市贴图 */
function cityMapTexture(size: number): THREE.CanvasTexture {
  if (!cityTexture) {
    cityTexture = new THREE.CanvasTexture(drawCityCanvas(size));
    cityTexture.colorSpace = THREE.SRGBColorSpace;
    cityTexture.anisotropy = 8;
  }
  return cityTexture;
}

/** 构建整块地形网格：顶点高度含宅基地整平（buildTerrain 时 clientWorld.objects 已就绪） */
export function buildTerrain(size: number): THREE.Mesh {
  const seg = SEGMENTS;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2); // 平面转到 XZ 水平面
  geo.translate(size / 2, 0, size / 2); // 与世界坐标对齐（0..size）

  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, clientWorld.heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals(); // 索引几何 = 平滑法线

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ map: cityMapTexture(CITY_SIZE) })
  );
  mesh.name = "terrain";
  mesh.receiveShadow = true; // 承接建筑/树/人的实时阴影
  return mesh;
}
