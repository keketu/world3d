// 唯美化预览 harness：脱离 socket 服务端直接渲染新场景（仅 dev 用，不进 dist）
import * as THREE from "three";
import { WATER_LEVEL, TerrainMod } from "@world3d/shared";
import { buildTerrain, buildWater } from "../engine/terrain";
import { buildProp } from "../engine/props";
import { clientWorld } from "../engine/world";

const size = 256;
const scene = new THREE.Scene();
const skyCanvas = document.createElement("canvas");
skyCanvas.width = 2;
skyCanvas.height = 256;
const sctx = skyCanvas.getContext("2d")!;
const grad = sctx.createLinearGradient(0, 0, 0, 256);
grad.addColorStop(0, "#8fc7ec");
grad.addColorStop(0.55, "#c8e4ef");
grad.addColorStop(1, "#f2f6ec");
sctx.fillStyle = grad;
sctx.fillRect(0, 0, 2, 256);
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
scene.background = skyTex;
scene.fog = new THREE.Fog(new THREE.Color("#e2f0ea"), 75, 110);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("host")!.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xe8f5ff, 0xa8c48a, 1.0));
const sun = new THREE.DirectionalLight(0xfff0da, 1.1);
sun.position.set(60, 90, 30);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.28));

// 一个池塘凹陷 mod，让地形 + 池塘道具一起看效果
const pond: TerrainMod = { id: "demo-pond", type: "pond", x: 60, z: 60, r: 7, depth: 3, by: "demo" };
clientWorld.mods.set(pond.id, pond);
scene.add(buildTerrain(size));
scene.add(buildWater(size, WATER_LEVEL));

const demos: Array<[string, string, number, number]> = [
  ["tree", "樱花", 52, 78],
  ["tree", "樱花", 66, 70],
  ["tree", "樱花", 46, 66],
  ["tree", "樱花", 74, 84],
  ["tree", "松", 40, 90],
  ["tree", "白桦", 88, 60],
  ["tree", "橡树", 96, 78],
  ["flower", "粉", 58, 52],
  ["flower", "黄", 70, 50],
  ["house", "木屋", 84, 40],
  ["fence", "木", 74, 34],
  ["path", "石板路", 60, 42],
];
for (const [kind, variant, x, z] of demos) {
  const { mesh } = buildProp({
    id: `demo-${kind}-${variant}-${x}-${z}`,
    kind,
    variant,
    x,
    z,
    rotY: 0,
    scale: 1,
    creatorId: "demo",
    creatorName: "demo",
    createdAt: 0,
    params: kind === "house" ? { w: 5, d: 5 } : kind === "path" ? { len: 8, dx: 1, dz: 0 } : {},
  } as never);
  mesh.position.set(x, clientWorld.heightAt(x, z), z);
  scene.add(mesh);
}

function frame() {
  requestAnimationFrame(frame);
  renderer.render(scene, camera);
}
frame();

// 相机操作钩子：绕目标点环绕
const ctl = {
  lookAt(x: number, y: number, z: number) {
    camera.lookAt(x, y, z);
  },
  orbit(target: [number, number, number], dist: number, yaw: number, pitch: number) {
    camera.position.set(
      target[0] + dist * Math.cos(pitch) * Math.sin(yaw),
      target[1] + dist * Math.sin(pitch),
      target[2] + dist * Math.cos(pitch) * Math.cos(yaw)
    );
    camera.lookAt(target[0], target[1], target[2]);
  },
  shot() {
    return renderer.domElement.toDataURL("image/png");
  },
};
(window as unknown as Record<string, unknown>).__beauty = ctl;
