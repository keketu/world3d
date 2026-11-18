// 低多边形地形：高度图连续网格 + flat shading 顶点色 + 水面
import * as THREE from "three";
import { WATER_LEVEL } from "@world3d/shared";
import { clientWorld } from "./world";

const SEGMENTS = 128; // 256 世界 / 128 段 = 2m 一格，低模棱面感

/** 地形配色：按高度渐变（糖果绿 → 深绿），水边沙色 */
function terrainColor(h: number, isShore: boolean, out: THREE.Color) {
  if (h < WATER_LEVEL + 0.4) {
    out.setRGB(0.93, 0.85, 0.62); // 沙滩
    return;
  }
  if (isShore) {
    out.setRGB(0.82, 0.9, 0.6); // 浅绿
    return;
  }
  // 两个绿之间的平滑渐变（加一点噪声变化避免死板）
  const t = Math.min(1, Math.max(0, (h - 10) / 16));
  out.setRGB(0.62 - t * 0.12, 0.78 - t * 0.1, 0.5 - t * 0.08);
}

/** 构建整块地形网格（非索引 = 每三角独立顶点 = flat shading 低模棱面） */
export function buildTerrain(size: number): THREE.Mesh {
  const seg = SEGMENTS;
  const step = size / seg;
  const positions = new Float32Array(seg * seg * 6 * 3);
  const colors = new Float32Array(seg * seg * 6 * 3);
  const col = new THREE.Color();
  let p = 0;

  for (let iz = 0; iz < seg; iz++) {
    for (let ix = 0; ix < seg; ix++) {
      const x0 = ix * step;
      const z0 = iz * step;
      const x1 = x0 + step;
      const z1 = z0 + step;
      // 四角高度
      const h00 = clientWorld.heightAt(x0, z0);
      const h10 = clientWorld.heightAt(x1, z0);
      const h01 = clientWorld.heightAt(x0, z1);
      const h11 = clientWorld.heightAt(x1, z1);
      // 两个三角（对角线交替方向形成随机棱面感）
      const flip = (ix + iz) % 2 === 0;
      const tris = flip
        ? [
            [x0, h00, z0, x1, h10, z0, x1, h11, z1],
            [x0, h00, z0, x1, h11, z1, x0, h01, z1],
          ]
        : [
            [x0, h00, z0, x1, h10, z0, x0, h01, z1],
            [x1, h10, z0, x1, h11, z1, x0, h01, z1],
          ];
      for (const tri of tris) {
        // 三角形质心高度决定颜色（水边沙色）
        const midH = (tri[1] + tri[4] + tri[7]) / 3;
        const shore = midH < WATER_LEVEL + 1.4;
        terrainColor(midH, shore, col);
        // 逐面色彩抖动：低模风格化的「碎色」质感
        const fi = ix * 131 + iz * 37 + (flip ? 7 : 0);
        const jitter = 0.94 + ((Math.sin(fi * 12.9898) + 1) / 2) * 0.12;
        // 注意绕序：交换第 2/3 顶点让法线朝上（+y），否则从上看全是背面被剔除
        for (const vi of [0, 2, 1]) {
          positions[p] = tri[vi * 3];
          positions[p + 1] = tri[vi * 3 + 1];
          positions[p + 2] = tri[vi * 3 + 2];
          colors[p] = col.r * jitter;
          colors[p + 1] = col.g * jitter;
          colors[p + 2] = col.b * jitter;
          p += 3;
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals(); // 非索引几何 = flat shading

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true })
  );
  mesh.name = "terrain";
  return mesh;
}

/** 水面（整图平面，轻微起伏动画在 game 循环里做） */
export function buildWater(size: number, waterLevel: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size * 1.02, size * 1.02);
  const mat = new THREE.MeshLambertMaterial({
    color: "#5da3d6",
    transparent: true,
    opacity: 0.8,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(size / 2, waterLevel, size / 2);
  mesh.name = "water";
  return mesh;
}
