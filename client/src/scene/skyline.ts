// 远景：地图外的延伸草地 + 底座裙边 + 四周低模远山 + 漂移的云
// 让地平线不再是"悬空的一块板"，晴天有远山和云，层次更深
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32, WORLD_SEED } from "@world3d/shared";

export interface Skyline {
  group: THREE.Group;
  update(dt: number): void;
}

/** 给几何体逐顶点写统一颜色（合批后一个材质画多种颜色） */
function withColor(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const col = new THREE.Color(hex);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

export function buildSkyline(size: number): Skyline {
  const group = new THREE.Group();
  const c = size / 2;
  const rng = mulberry32(WORLD_SEED ^ 0x736b79); // "sky"

  // 延伸草地：地图之外铺到远处，被雾融进天色
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshLambertMaterial({ color: "#86b264" }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(c, -0.8, c);
  ground.receiveShadow = true;
  group.add(ground);

  // 底座裙边：只围地图四周（地形最低 11.4，裙边顶到 10.5），从外面看不到地形底下的空腔
  const skirtParts: THREE.BufferGeometry[] = [];
  const skirt = (w: number, d: number, x: number, z: number) => {
    const g = new THREE.BoxGeometry(w, 14, d);
    g.translate(x, 3.5, z);
    skirtParts.push(withColor(g, 0x7d9160));
  };
  skirt(size + 3, 1.5, c, -0.75);
  skirt(size + 3, 1.5, c, size + 0.75);
  skirt(1.5, size, -0.75, c);
  skirt(1.5, size, size + 0.75, c);
  group.add(new THREE.Mesh(mergeGeometries(skirtParts), new THREE.MeshLambertMaterial({ vertexColors: true })));

  // 远山：沿圆角方环排一圈，低多边形平面着色，两种青绿色调
  const hillParts: THREE.BufferGeometry[] = [];
  const N = 34;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const rr = (size / 2 + 95 + rng() * 55) / Math.pow(Math.max(Math.abs(cs), Math.abs(sn)), 0.7);
    const rad = 42 + rng() * 36;
    const hgt = 18 + rng() * 26;
    const g = new THREE.SphereGeometry(1, 11, 7).toNonIndexed();
    g.scale(rad, hgt, rad * (0.75 + rng() * 0.4));
    g.rotateY(rng() * Math.PI);
    g.translate(c + cs * rr, -1.5, c + sn * rr);
    g.computeVertexNormals();
    hillParts.push(withColor(g, rng() > 0.5 ? 0x6f9e83 : 0x7bab8c));
  }
  group.add(new THREE.Mesh(mergeGeometries(hillParts), new THREE.MeshLambertMaterial({ vertexColors: true })));

  // 云：多团扁球合成，整体缓慢漂移（不受雾影响，保持洁白）
  const cloudParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const cx = c + (rng() - 0.5) * 900;
    const cz = c + (rng() - 0.5) * 900;
    const cy = 95 + rng() * 55;
    const s = 14 + rng() * 15;
    const k = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < k; j++) {
      const g = new THREE.SphereGeometry(1, 10, 7).toNonIndexed();
      const r = s * (0.55 + rng() * 0.6);
      g.scale(r, r * 0.55, r * 0.8);
      g.translate(cx + (j - k / 2) * s * 0.85 + (rng() - 0.5) * s * 0.3, cy + (rng() - 0.5) * s * 0.25, cz + (rng() - 0.5) * s * 0.7);
      g.computeVertexNormals();
      cloudParts.push(g);
    }
  }
  const clouds = new THREE.Mesh(
    mergeGeometries(cloudParts),
    new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x59606a, fog: false })
  );
  group.add(clouds);

  return {
    group,
    update(dt: number) {
      clouds.position.x += dt * 1.6;
      if (clouds.position.x > 480) clouds.position.x -= 960;
    },
  };
}
