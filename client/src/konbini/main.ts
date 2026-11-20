// 雨夜便利店 · 街角微缩模型：独立观赏页（无 UI，可拖拽旋转缩放，组装动画）
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildBase, buildGround, buildStore, buildProps, toon, PAL } from "./build";
import { Timeline } from "./timeline";

// ---------- 渲染器 / 场景 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = nightSky();

function nightSky(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 512;
  const g = canvas.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#05060f");
  grad.addColorStop(0.55, "#0c1226");
  grad.addColorStop(0.8, "#1b2340");
  grad.addColorStop(1, "#2a2f52");
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- 相机 + 控制（自由拖拽/旋转/缩放） ----------
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(17, 13, 19);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 9;
controls.maxDistance = 46;
controls.maxPolarAngle = 1.46; // 不钻到底座下面
controls.autoRotate = true; // 开场缓慢环绕
controls.autoRotateSpeed = 0.5;
controls.addEventListener("start", () => {
  controls.autoRotate = false; // 用户一上手就停止环绕
});
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 灯光（夜景：冷月光 + 店内暖光 + 霓虹点光） ----------
scene.add(new THREE.AmbientLight(0x44506e, 0.85));
const moon = new THREE.DirectionalLight(0x8aa2cc, 0.7);
moon.position.set(-18, 26, -10);
scene.add(moon);

// ---------- 场景组装 ----------
const tl = new Timeline();
const baseGroup = buildBase();
scene.add(baseGroup);
tl.add(baseGroup, "rise", 0, 0.9, 2.2);

const groundGroup = buildGround();
scene.add(groundGroup);
tl.add(groundGroup, "rise", 0.7, 1.0, 1.2);

const store = buildStore();
scene.add(store.shell);
scene.add(store.interior);
scene.add(store.roofGroup);
scene.add(store.signGroup);
tl.add(store.shell, "growY", 1.5, 1.0, 1.0); // 墙体从底座长出
tl.add(store.interior, "rise", 2.4, 0.9, 0.7); // 内饰整体升入
tl.add(store.roofGroup, "drop", 3.2, 0.7, 5.0); // 屋顶落下
tl.add(store.signGroup, "pop", 4.1, 0.6, 1.0);

// 街景道具：每个子项错峰弹出
const propsGroup = buildProps();
scene.add(propsGroup);
propsGroup.children.forEach((child, i) => {
  tl.add(child, "pop", 4.6 + i * 0.22, 0.55, 1.0);
});

// ---------- 雨（线段粒子，7s 后淡入） ----------
const RAIN_N = 520;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) {
  const x = (Math.random() - 0.5) * 30;
  const y = Math.random() * 16;
  const z = (Math.random() - 0.5) * 30;
  const len = 0.35 + Math.random() * 0.4;
  rainPos.set([x, y, z, x + 0.06, y + len, z + 0.06], i * 6);
}
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0x9fb8cc, transparent: true, opacity: 0 });
const rain = new THREE.LineSegments(rainGeo, rainMat);
scene.add(rain);

// 水洼/斑马线反光在 buildGround 里已用高光材质，这里把夜间点光补两盏（霓虹氛围）
const neonPink = new THREE.PointLight(0xff5fa2, 2.6, 12, 1.8);
neonPink.position.set(-3.5, 1.1, 9.9); // 贴地粉光：映亮积水与斑马线
scene.add(neonPink);
const signWhite = new THREE.PointLight(0xfff6e8, 1.8, 10, 1.6);
signWhite.position.set(-3.5, 3.2, 8.4); // 招牌补白光，保证可读
scene.add(signWhite);
const neonCyan = new THREE.PointLight(0x53e3e0, 1.4, 12, 1.8);
neonCyan.position.set(9.6, 3.6, 8.6);
scene.add(neonCyan);
const storeGlow = new THREE.PointLight(0xfff2d8, 7, 20, 1.2);
storeGlow.position.set(-3.5, 2.4, 4.2);
scene.add(storeGlow);
const storeGlow2 = new THREE.PointLight(0xfff2d8, 5, 14, 1.2);
storeGlow2.position.set(-7.5, 2.4, 3.6);
scene.add(storeGlow2);
const storeGlow3 = new THREE.PointLight(0xfff2d8, 4, 12, 1.2);
storeGlow3.position.set(-1, 2.4, 4.6);
scene.add(storeGlow3);

// 水洼霓虹倒影（假反射：低透明发光面贴在水洼上方，随水洼淡入）
const reflect = new THREE.Group();
const reflMatPink = new THREE.MeshBasicMaterial({ color: 0xff5fa2, transparent: true, opacity: 0, toneMapped: false });
const reflMatCyan = new THREE.MeshBasicMaterial({ color: 0x53e3e0, transparent: true, opacity: 0, toneMapped: false });
const r1 = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), reflMatPink);
r1.rotation.x = -Math.PI / 2;
r1.rotation.z = 0.3;
r1.position.set(-6.5, 0.17, 9.6);
reflect.add(r1);
const r2 = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), reflMatCyan);
r2.rotation.x = -Math.PI / 2;
r2.rotation.z = -0.2;
r2.position.set(1.2, 0.17, 10.6);
reflect.add(r2);
const r3 = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.7), reflMatPink);
r3.rotation.x = -Math.PI / 2;
r3.position.set(6.8, 0.17, 9.2);
reflect.add(r3);
scene.add(reflect);

// ---------- 双击重播组装动画 ----------
renderer.domElement.addEventListener("dblclick", () => tl.restart());

// ---------- 主循环 ----------
const clock = new THREE.Clock();
const doorL = new THREE.Mesh();
const doorR = new THREE.Mesh();
// 自动门双开玻璃（挂在店内门前，随周期开合）
function attachAutoDoor() {
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: PAL.glass,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  doorL.geometry = new THREE.BoxGeometry(1.05, 2.5, 0.06);
  doorR.geometry = new THREE.BoxGeometry(1.05, 2.5, 0.06);
  const frame = toon(0x3a3f47);
  doorL.material = glassMat;
  doorR.material = glassMat;
  doorL.position.set(-2.55, 1.62, 7.62);
  doorR.position.set(-1.5, 1.62, 7.62);
  doorL.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.5, 0.1), frame));
  doorR.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.5, 0.1), frame));
  doorL.children[0].position.x = 0.48;
  doorR.children[0].position.x = -0.48;
  scene.add(doorL, doorR);
}
attachAutoDoor();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = tl.t;

  tl.update();
  controls.update();

  // 雨：下落循环 + 淡入
  const pos = rainGeo.getAttribute("position") as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const fall = dt * 9;
  for (let i = 0; i < RAIN_N; i++) {
    const y0 = i * 6 + 1;
    arr[y0] -= fall;
    arr[y0 + 3] -= fall;
    if (arr[y0] < 0.1) {
      const x = (Math.random() - 0.5) * 30;
      const z = (Math.random() - 0.5) * 30;
      arr[i * 6] = x;
      arr[i * 6 + 1] = 14 + Math.random() * 3;
      arr[i * 6 + 2] = z;
      arr[i * 6 + 3] = x + 0.06;
      arr[i * 6 + 4] = arr[i * 6 + 1] + 0.35 + Math.random() * 0.4;
      arr[i * 6 + 5] = z;
    }
  }
  pos.needsUpdate = true;
  rainMat.opacity = Math.max(0, Math.min(0.34, (t - 6.2) / 0.9 * 0.34));
  const reflO = Math.max(0, Math.min(0.3, (t - 6.4) / 1.2 * 0.3));
  reflMatPink.opacity = reflO * (0.75 + Math.sin(t * 7.3) * 0.25);
  reflMatCyan.opacity = reflO * (0.75 + Math.sin(t * 5.7 + 2) * 0.25);

  // 霓虹闪烁（入场后偶发闪一下，随后稳定）
  const flick = t < 5.4 ? (Math.sin(t * 30) > 0 ? 1 : 0.15) : Math.sin(t * 1.3) > -0.92 ? 1 : 0.55;
  neonPink.intensity = 2.4 * flick;
  // 店内灯在 2.6-3.4s 之间闪（灯管启动）
  const warmFlick = t > 2.55 && t < 3.5 ? (Math.sin(t * 40) > 0 ? 1 : 0.1) : 1;
  storeGlow.intensity = 3.2 * warmFlick;

  // 自动门周期开合（每 10s 开 2s）
  const cyc = (clock.elapsedTime % 10) / 2;
  const open = cyc < 1 ? Math.sin(Math.min(1, cyc) * Math.PI) : 0;
  doorL.position.x = -2.55 - open * 1.0;
  doorR.position.x = -1.5 + open * 1.0;

  // 雨伞极轻微晃动（雨夜氛围）
  renderer.render(scene, camera);
}
loop();
