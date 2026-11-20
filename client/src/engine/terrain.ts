// 地形：连续网格 + 城市贴图（阳光都市路网/街区全画进 CanvasTexture）
import * as THREE from "three";
import { WORLD_SEED, mulberry32, zoneAt, blockId, ROAD_LINES, ROAD_HALF, SIDEWALK_W, EDGE_GRASS, CITY_SIZE } from "@world3d/shared";
import { clientWorld } from "./world";

const SEGMENTS = 220; // 256 世界 / 220 段 ≈ 1.16m 一格
const TEX_PX_PER_M = 8; // 2048² 贴图 = 8px/m，0.3m 标线 ≈ 2.4px 清晰

const m2p = (v: number) => v * TEX_PX_PER_M;

/** 阳光都市地面配色 */
const COLORS = {
  grass: "#8fbc6f",       // 外圈草绿
  park: "#85b96a",        // 公园 / 绿带
  sidewalk: "#d9d2c6",    // 人行道暖灰
  road: "#57534e",        // 暖色沥青
  laneDash: "rgba(246,240,228,0.9)",
  plaza: "#e8d2a8",       // 广场暖铺装
  plazaRing: "#d9bd92",
  curb: "#b9b0a2",
  lotTints: ["#e8dfc9", "#e3d5bb", "#ddcfb2", "#e6d9bf", "#e9dcc3"],
};

function blockTint(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return COLORS.lotTints[Math.abs(h) % COLORS.lotTints.length];
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
        // 市民广场（两块 + 中央大道贯穿）
        g.fillStyle = COLORS.plaza;
        g.fillRect(x0, z0, w, h);
        // 同心环装饰（以各自块中心）
        const cx = x0 + w / 2;
        const cz = z0 + h / 2;
        g.strokeStyle = COLORS.plazaRing;
        g.lineWidth = m2p(0.4);
        for (let r = 6; r <= 22; r += 5) {
          g.beginPath();
          g.arc(cx, cz, m2p(r), 0, Math.PI * 2);
          g.stroke();
        }
        speckle(g, rng, bounds[i] + 8, bounds[j] + 8, bounds[i + 1] - 8, bounds[j + 1] - 8, 90, 0.05);
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
        // 公园块：草绿 + 深浅斑块 + 土路圆环
        g.fillStyle = COLORS.park;
        g.fillRect(x0, z0, w, h);
        for (let k = 0; k < 10; k++) {
          const bx = bounds[i] + 6 + rng() * (bounds[i + 1] - bounds[i] - 12);
          const bz = bounds[j] + 6 + rng() * (bounds[j + 1] - bounds[j] - 12);
          g.fillStyle = rng() > 0.5 ? "#7aab5d" : "#93c47d";
          g.beginPath();
          g.arc(m2p(bx), m2p(bz), m2p(2 + rng() * 4), 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = "#c9a97e";
        g.lineWidth = m2p(1.2);
        g.beginPath();
        g.arc(m2p((bounds[i] + bounds[i + 1]) / 2), m2p((bounds[j] + bounds[j + 1]) / 2), m2p(12), 0.4, Math.PI * 1.6);
        g.stroke();
        continue;
      }
      // 普通街区地块：按块 tint
      g.fillStyle = blockTint(id);
      g.fillRect(x0, z0, w, h);
      speckle(g, rng, bounds[i] + 8, bounds[j] + 8, bounds[i + 1] - 8, bounds[j + 1] - 8, 110, 0.05);
    }
  }

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

  // 6) 车道中央虚线
  g.strokeStyle = COLORS.laneDash;
  g.lineWidth = m2p(0.3);
  g.setLineDash([m2p(3), m2p(2.6)]);
  for (const L of ROAD_LINES) {
    g.beginPath();
    g.moveTo(m2p(L), clipLo);
    g.lineTo(m2p(L), clipHi);
    g.stroke();
    g.beginPath();
    g.moveTo(clipLo, m2p(L));
    g.lineTo(clipHi, m2p(L));
    g.stroke();
  }
  g.setLineDash([]);

  // 7) 路口斑马线
  for (const Lx of ROAD_LINES) {
    for (const Lz of ROAD_LINES) crosswalk(g, Lx, Lz);
  }

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
  return mesh;
}
