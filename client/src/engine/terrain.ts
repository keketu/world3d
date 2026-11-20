// 地形：高度图连续网格 + 平滑着色顶点色 + 水面（柔和丘陵，无棱面块感）
import * as THREE from "three";
import { WATER_LEVEL } from "@world3d/shared";
import { clientWorld } from "./world";

const SEGMENTS = 220; // 256 世界 / 220 段 ≈ 1.16m 一格，海岸线更顺滑

/** 缓变色彩场：低频正弦叠加，形成有机的草地色斑（区别于逐面抖动） */
function fieldNoise(x: number, z: number): number {
  return (
    Math.sin(x * 0.045 + 1.3) * 0.5 +
    Math.sin(z * 0.038 + 4.1) * 0.35 +
    Math.sin((x + z) * 0.021 + 2.2) * 0.15
  ); // [-1, 1]
}

/** 地形配色：沙滩 → 浅草地 → 深草地 的柔和渐变 */
function terrainColor(h: number, x: number, z: number, out: THREE.Color) {
  const n = fieldNoise(x, z); // 有机色斑
  if (h < WATER_LEVEL + 2.2) {
    // 沙滩（带宽约 2.2m 高度差，岛岸缓坡上视觉约 3~5m；湿度渐变：越靠近水越深）
    const wet = Math.min(1, Math.max(0, (WATER_LEVEL + 2.2 - h) / 2.6));
    out.setRGB(0.91 - wet * 0.07, 0.84 - wet * 0.1, 0.66 - wet * 0.12);
    return;
  }
  // 高度 + 低频噪声共同决定草色深浅（清新但饱和的糖果绿）
  const t = Math.min(1, Math.max(0, (h - 10) / 16)) * 0.6 + (n * 0.5 + 0.5) * 0.4;
  out.setRGB(0.58 - t * 0.14, 0.79 - t * 0.12, 0.45 - t * 0.1);
}

/** 构建整块地形网格（索引几何 = 共享顶点 = 平滑法线，圆润丘陵） */
export function buildTerrain(size: number): THREE.Mesh {
  const seg = SEGMENTS;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2); // 平面转到 XZ 水平面
  geo.translate(size / 2, 0, size / 2); // 与世界坐标对齐（0..size）

  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, clientWorld.heightAt(x, z));
    terrainColor(pos.getY(i), x, z, col);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals(); // 索引几何 = 平滑法线

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true })
  );
  mesh.name = "terrain";
  return mesh;
}

/** 水面（大幅越出地图边界 → 远处雾化成海平线；轻微起伏动画在 game 循环里做） */
export function buildWater(size: number, waterLevel: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size * 6, size * 6, 1, 1);
  const mat = new THREE.MeshLambertMaterial({
    color: "#7ec4e8",
    transparent: true,
    opacity: 0.72,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(size / 2, waterLevel, size / 2);
  mesh.name = "water";
  return mesh;
}
