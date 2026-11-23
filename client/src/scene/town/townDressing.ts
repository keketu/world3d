// 城市陈设建模：把 townPlan 的布局合批成 32m 分块网格（每块 1 个 draw call），自发光件按组各 1 个
// 不走 props.ts 的 paintAndMerge：它按位置焊接顶点，会把长椅/车这类薄盒子的棱角抹成圆滑明暗
import * as THREE from "three";
import { CITY_SIZE } from "@world3d/shared";
import type { TownPlan, TownItem } from "./townPlan";
import * as Kit from "./townKit";

const CHUNK = 32;
const UP = new THREE.Vector3(0, 1, 0);
const PARASOL_COLORS = [0xe8604a, 0xf2d998, 0x7bb98a, 0x53a8e0];

export interface TownDressing {
  group: THREE.Group;
  /** 红绿灯相位（按世界时间切换亮灯组） */
  update(time: number): void;
  stats: { items: number; chunks: number; triangles: number };
}

/** 红绿灯相位：东西向绿 9.5s → 全红 1.5s → 南北向绿 9.5s → 全红 1.5s（车辆据此停车） */
export function trafficPhase(time: number): { ew: boolean; ns: boolean } {
  const t = time % 22;
  return { ew: t < 9.5, ns: t >= 11 && t < 20.5 };
}

/** 按陈设种类往 Kit 里填零件（局部坐标，原点在地面中心） */
function buildItem(k: Kit.Kit, it: TownItem) {
  const p = k.solid;
  switch (it.kind) {
    case "cherry": Kit.treeCherry(p); break;
    case "round": Kit.treeRound(p, it.tone); break;
    case "birch": Kit.treeBirch(p); break;
    case "pine": Kit.treePine(p); break;
    case "bush": Kit.bush(p, it.tone, it.variant); break;
    case "grate": Kit.treeGrate(p); break;
    case "bench": Kit.bench(p); break;
    case "bollard": Kit.bollard(p); break;
    case "bin": Kit.trashBin(p); break;
    case "planter": Kit.planter(p, it.tone, it.variant); break;
    case "hydrant": Kit.hydrant(p); break;
    case "mailbox": Kit.postBox(p); break;
    case "bikeRack": Kit.bikeRack(k, it.tone); break;
    case "busStop": Kit.busStop(k); break;
    case "trafficEW": Kit.trafficLight(k, "ew"); break;
    case "trafficNS": Kit.trafficLight(k, "ns"); break;
    case "parkedCar": Kit.car(p, Kit.CAR_COLORS[it.tone % Kit.CAR_COLORS.length], it.variant); break;
    case "fountain": Kit.fountain(k); break;
    case "parasol": Kit.parasolTable(k, PARASOL_COLORS[it.tone % PARASOL_COLORS.length]); break;
    case "kiosk": Kit.kiosk(k); break;
    case "clockTower": Kit.clockTower(p); break;
    case "pergola": Kit.pergola(p); break;
    case "flowerBed": Kit.flowerBed(p, it.tone); break;
    case "hedge": Kit.hedge(p, it.len); break;
    case "parkLamp": Kit.parkLamp(k); break;
    case "pond": Kit.pond(p, it.sx, it.sz); break;
    case "playground": Kit.playground(k); break;
    case "picnic": Kit.picnicTable(p); break;
  }
}

/** 展开索引并带上法线/顶点色合并（保留各零件原有明暗：盒子硬边、球面平滑） */
function mergeParts(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  let count = 0;
  for (const m of meshes) count += m.geometry.getIndex()?.count ?? m.geometry.getAttribute("position").count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let o = 0;
  for (const m of meshes) {
    const g = m.geometry;
    const pa = g.getAttribute("position");
    const na = g.getAttribute("normal");
    const idx = g.getIndex();
    const c = (m.material as THREE.MeshLambertMaterial).color;
    nm.getNormalMatrix(m.matrix);
    const cnt = idx ? idx.count : pa.count;
    for (let i = 0; i < cnt; i++) {
      const vi = idx ? idx.getX(i) : i;
      v.fromBufferAttribute(pa, vi).applyMatrix4(m.matrix);
      nv.fromBufferAttribute(na, vi).applyMatrix3(nm).normalize();
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      nor[o] = nv.x; nor[o + 1] = nv.y; nor[o + 2] = nv.z;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      o += 3;
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

export function buildTownDressing(plan: TownPlan, heightAt: (x: number, z: number) => number): TownDressing {
  const n = Math.ceil(CITY_SIZE / CHUNK);
  const buckets: Kit.Parts[] = Array.from({ length: n * n }, () => []);
  const glows = new Map<string, Kit.Parts>();
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  for (const it of plan.items) {
    const k = Kit.newKit();
    buildItem(k, it);
    m4.compose(pos.set(it.x, heightAt(it.x, it.z) - 0.02, it.z), quat.setFromAxisAngle(UP, it.rotY), scl.setScalar(it.scale));
    const cx = Math.min(n - 1, Math.max(0, Math.floor(it.x / CHUNK)));
    const cz = Math.min(n - 1, Math.max(0, Math.floor(it.z / CHUNK)));
    const bucket = buckets[cx * n + cz];
    for (const m of k.solid) {
      m.applyMatrix4(m4);
      bucket.push(m);
    }
    for (const [tag, arr] of k.glows) {
      let g = glows.get(tag);
      if (!g) {
        g = [];
        glows.set(tag, g);
      }
      for (const m of arr) {
        m.applyMatrix4(m4);
        g.push(m);
      }
    }
  }

  const group = new THREE.Group();
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  let chunks = 0;
  let triangles = 0;
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    const mesh = new THREE.Mesh(mergeParts(bucket), solidMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    triangles += mesh.geometry.getAttribute("position").count / 3;
    group.add(mesh);
    chunks++;
  }
  const glowMeshes = new Map<string, THREE.Mesh>();
  for (const [tag, arr] of glows) {
    const mesh = new THREE.Mesh(mergeParts(arr), new THREE.MeshBasicMaterial({ vertexColors: true }));
    group.add(mesh);
    glowMeshes.set(tag, mesh);
  }

  return {
    group,
    update(time) {
      const ph = trafficPhase(time);
      const show = (tag: string, on: boolean) => {
        const m = glowMeshes.get(tag);
        if (m) m.visible = on;
      };
      show("ewG", ph.ew);
      show("nsR", ph.ew);
      show("nsG", ph.ns);
      show("ewR", ph.ns);
    },
    stats: { items: plan.items.length, chunks, triangles },
  };
}
