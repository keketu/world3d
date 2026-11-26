// 游戏引擎：低模世界渲染循环、本地玩家、道具交互、标签系统、远端玩家
import * as THREE from "three";
import { HOTBAR_PROPS, PROP_KINDS, PlayerInfo, WorldObject, isBuildingKind, isPropCollidable, buildingSize, buildingRect, plotIdAt, plotBounds, propIcon, propLabel } from "@world3d/shared";
import { clientWorld } from "./world";
import { buildTerrain } from "./terrain";
import { buildSkyline } from "../scene/skyline";
import { getTownPlan } from "../scene/town/townPlan";
import { buildTownDressing, TownDressing, trafficPhase } from "../scene/town/townDressing";
import { createTownLife, TownLife } from "../scene/town/townLife";
import { pixelAvatarDataURL } from "../scene/pixelAvatar";
import { buildProp } from "./props";
import { createAvatar, animateAvatar, setAvatarOffline, Avatar } from "../scene/avatar";
import { useWorld, ControlMode } from "../state/store";
import { qualityFor, applyQuality, detectTier, QualitySettings } from "./quality";
import { sendMove } from "../net/socket";
import { roomHost } from "./roomHost";
import { findPath } from "../scene/office/nav";
import { buildNavGrid, findPath2D, type NavGrid } from "./nav2d";

export interface GameHandle {
  dispose(): void;
  setSpawn(p: { x: number; y: number; z: number }): void;
}

let started = false;

export function startGame(container: HTMLElement): GameHandle {
  if (started) throw new Error("game already started");
  started = true;

  /** 键盘移动键位集合 */
  const KEY_MOVE_CODES = new Set([
    "KeyW", "KeyA", "KeyS", "KeyD",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  ]);
  /** 当前按下的移动键 */
  const keysDown = new Set<string>();

  const tier = detectTier();
  useWorld.getState().setTier(tier);
  let q = qualityFor(tier);

  // ---------- 三件套 ----------
  const scene = new THREE.Scene();
  // 渐变天空（屏幕空间垂直渐变：天顶浅蓝 → 地平线暖雾白）
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 2;
  skyCanvas.height = 256;
  const sctx = skyCanvas.getContext("2d")!;
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#6db5e6");
  grad.addColorStop(0.55, "#b7dcf3");
  grad.addColorStop(1, "#e8f3ef");
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  const HORIZON = new THREE.Color("#dceef0");
  const fog = new THREE.Fog(HORIZON, q.fogNear, q.fogFar);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1400);
  const renderer = new THREE.WebGLRenderer({ antialias: tier !== "low" });
  applyQuality(tier, renderer, fog);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // ---------- 光照：晴天（物理光照单位下漫反射会再除以 π，强度按此标定） ----------
  // 受光顶面 ≈ 1.07×固有色，阴影里 ≈ 0.5×——明暗分明但不发黑
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const hemi = new THREE.HemisphereLight(0xdcefff, 0xa9bd8e, 1.35);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(amb);
  // 太阳方向固定；阴影相机每帧跟随玩家（见 updateSun），覆盖范围随画质档位
  const UP = new THREE.Vector3(0, 1, 0);
  const SUN_DIR = new THREE.Vector3(0.62, 1, 0.4).normalize();
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
  scene.add(sun);
  scene.add(sun.target);
  // 光照坐标系的右/上轴：阴影中心沿这两轴对齐贴图纹素，走动时阴影边缘不抖
  const sunRight = new THREE.Vector3().crossVectors(SUN_DIR, UP).normalize();
  const sunUp = new THREE.Vector3().crossVectors(sunRight, SUN_DIR).normalize();
  function applySunQuality(qq: QualitySettings) {
    const on = qq.shadowMap > 0;
    renderer.shadowMap.enabled = on;
    sun.castShadow = on;
    if (!on) return;
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -qq.shadowExtent;
    sc.right = qq.shadowExtent;
    sc.top = qq.shadowExtent;
    sc.bottom = -qq.shadowExtent;
    sc.near = 10;
    sc.far = 520;
    sc.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== qq.shadowMap) {
      sun.shadow.mapSize.set(qq.shadowMap, qq.shadowMap);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.05;
  }
  function updateSun(cx: number, cy: number, cz: number) {
    const texel = (2 * q.shadowExtent) / Math.max(1, q.shadowMap);
    const rx = cx * sunRight.x + cy * sunRight.y + cz * sunRight.z;
    const uy = cx * sunUp.x + cy * sunUp.y + cz * sunUp.z;
    const dz = cx * SUN_DIR.x + cy * SUN_DIR.y + cz * SUN_DIR.z;
    const a = Math.round(rx / texel) * texel;
    const b = Math.round(uy / texel) * texel;
    const tx = sunRight.x * a + sunUp.x * b + SUN_DIR.x * dz;
    const ty = sunRight.y * a + sunUp.y * b + SUN_DIR.y * dz;
    const tz = sunRight.z * a + sunUp.z * b + SUN_DIR.z * dz;
    sun.target.position.set(tx, ty, tz);
    sun.position.set(tx + SUN_DIR.x * 240, ty + SUN_DIR.y * 240, tz + SUN_DIR.z * 240);
  }
  applySunQuality(q);
  // 设置面板切换画质：即时生效（像素比 / 雾距 / 阴影）
  useWorld.subscribe((s, prev) => {
    if (s.tier === prev.tier) return;
    q = qualityFor(s.tier);
    applyQuality(s.tier, renderer, fog);
    applySunQuality(q);
  });

  // ---------- 地形与水 ----------
  let terrainMesh: THREE.Mesh | null = null;
  let waterMesh: THREE.Mesh | null = null;

  function rebuildTerrain() {
    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
    }
    const size = clientWorld.meta?.size ?? 256;
    terrainMesh = buildTerrain(size);
    scene.add(terrainMesh);
    // 平原世界：全域陆地，不再渲染海平面（pond 池塘有独立水盘道具）
    // 地形（含宅基地整平）变化后：建筑重新落座 + 相机避让盒刷新
    for (const [id, pm] of propMeshes) {
      if (!isBuildingKind(pm.kind)) continue;
      const o = clientWorld.objects.get(id);
      if (!o) continue;
      const y = clientWorld.siteLevelOf(o);
      pm.seatY = y;
      pm.mesh.position.y = y;
      rebuildCamBox(id, pm.mesh);
    }
  }
  clientWorld.onModsChanged = rebuildTerrain;
  // hello 到达后：建地形 + 生成已有造物（无动画）+ 城市陈设
  clientWorld.onHello = () => {
    rebuildTerrain();
    for (const o of clientWorld.objects.values()) spawnProp(o, false);
    buildTownDressingOnce();
  };

  // ---------- 城市陈设：行道树/街具/红绿灯/停车/广场公园设施，按布局合批，进世界后建一次 ----------
  let dressing: TownDressing | null = null;
  let townLife: TownLife | null = null;
  function buildTownDressingOnce() {
    if (dressing) return;
    const plan = getTownPlan(clientWorld.objects.values());
    dressing = buildTownDressing(plan, (x, z) => clientWorld.heightAt(x, z));
    propGroup.add(dressing.group);
    townLife = createTownLife(plan, { crowd: q.crowd, heightAt: (x, z) => clientWorld.heightAt(x, z) });
    propGroup.add(townLife.group);
    for (const c of plan.colliders) clientWorld.extra.add(c);
    navGrid = buildNavGrid(clientWorld.objects.values(), plan.colliders);
  }

  // ---------- 道具管理 ----------
  const propMeshes = new Map<string, { mesh: THREE.Object3D; labelY: number; seatY: number; creator: string; variant: string; kind: string }>();
  const popAnims = new Map<string, number>();
  const propGroup = new THREE.Group();
  scene.add(propGroup);
  // 远景（延伸草地/远山/云）：挂在 propGroup 下，进屋时随户外场景一起隐藏
  const skyline = buildSkyline(clientWorld.meta?.size ?? 256);
  propGroup.add(skyline.group);
  /** 大道具（房屋/办公楼）世界 AABB：相机避让 + 点击外推，防穿模透视 */
  const camBoxes = new Map<string, THREE.Box3>();

  function rebuildCamBox(id: string, mesh: THREE.Object3D) {
    mesh.updateWorldMatrix(true, true);
    camBoxes.set(id, new THREE.Box3().setFromObject(mesh));
  }

  function spawnProp(o: WorldObject, animate: boolean) {
    const { mesh, labelY } = buildProp(o);
    // 实时阴影：造物投影到地面/彼此（透明件如玻璃不投影，免得店内一片黑；花/路面圆盘贴地无影可投，省掉阴影通道）
    const flat = o.kind === "flower" || o.kind === "path" || o.kind === "pond";
    mesh.traverse((c) => {
      c.receiveShadow = true;
      const m = (c as THREE.Mesh).material as THREE.Material | undefined;
      c.castShadow = !flat && !m?.transparent;
    });
    // 建筑：坐在宅基地基座高度（脚印内地形会被整平到同一高度）；其余道具贴中心点地面
    const y = isBuildingKind(o.kind) ? clientWorld.siteLevelOf(o) : clientWorld.heightAt(o.x, o.z);
    mesh.position.set(o.x, y, o.z);
    mesh.rotation.y = o.rotY;
    mesh.scale.setScalar(animate ? 0.01 : o.scale || 1);
    propGroup.add(mesh);
    mesh.userData.objectId = o.id; // 射线命中道具后由此取 id（拆除/走近大建筑都靠它）
    propMeshes.set(o.id, { mesh, labelY, seatY: y, creator: o.creatorName, variant: o.variant, kind: o.kind });
    if (animate) popAnims.set(o.id, 0);
    if (isBuildingKind(o.kind) && !animate) rebuildCamBox(o.id, mesh);
    // 系统建筑常显地名牌（像小镇地图上每栋房子都有名字）
    if (isBuildingKind(o.kind) && (o.creatorId === "system-city" || o.creatorId === "system")) {
      const size = buildingSize(o.kind, o.params);
      const topY = o.kind === "tower" ? 2.8 + Number(o.params?.f ?? 6) * 3 + 1.2 : o.kind === "office" ? 6.5 : 7.2;
      setLabel(`bld-${o.id}`, String(o.params?.name ?? propLabel(o.kind, o.variant)), o.x, y + topY, o.z, "objTag", 110);
    }
    // 可进入建筑：登记门口世界坐标与目标房间（进门触发点）
    if (isBuildingKind(o.kind)) {
      const size = buildingSize(o.kind, o.params);
      const doorDist = o.kind === "office"
        ? Number(o.params?.doorDist ?? 4.6)
        : o.kind === "tower" ? size.d / 2 + 2.2 : o.kind === "shop" ? size.d / 2 + 0.9 : size.d / 2 + 0.5;
      roomHost.setDoor(o.id, {
        x: o.x + Math.sin(o.rotY) * doorDist,
        z: o.z + Math.cos(o.rotY) * doorDist,
        roomId: o.kind === "office" ? "office-1" : `${o.kind}-${o.id}`,
        label: propLabel(o.kind, o.variant),
      });
    }
  }

  clientWorld.onObjectAdded = (o, animate) => {
    spawnProp(o, animate);
    // 建筑（宅基地）增删会改变地表形状：重建地形网格使整平生效
    if (isBuildingKind(o.kind)) rebuildTerrain();
  };
  clientWorld.onObjectRemoved = (id) => {
    const pm = propMeshes.get(id);
    const wasBuilding = pm ? isBuildingKind(pm.kind) : false;
    if (pm) {
      propGroup.remove(pm.mesh);
      propMeshes.delete(id);
    }
    camBoxes.delete(id);
    removeLabel(`bld-${id}`);
    roomHost.removeDoor(id);
    if (wasBuilding) rebuildTerrain();
  };

  // ---------- 本地玩家 ----------
  let self: { x: number; y: number; z: number; rotY: number; anim: "idle" | "walk" } = {
    x: 128.5, y: 14, z: 128.5, rotY: 0, anim: "idle",
  };
  const selfAvatar = createAvatar("self", "#5b8def");
  selfAvatar.group.traverse((c) => {
    c.castShadow = true;
  });
  scene.add(selfAvatar.group);

  // ---------- 相机 ----------
  // 默认背对岛心朝外看：出生画面是开阔平原 + 身后樱花，办公楼在身后不抢镜
  let camYaw = Math.PI;
  // 默认低俯角（~24°）：能看见天空/海/远景和角色半侧脸，画面有纵深氛围；用户滚轮/双指可自由调
  let camPitch = 0.62;
  let camDist = 13;
  /** 相机实际距离的平滑值（建筑裁剪时避免突变） */
  let camDistSmooth = 13;
  let viewMode: "third" | "first" = "third";

  // ---------- 输入（鼠标/触摸统一 Pointer Events；行走 = 点击地面） ----------
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // WASD / 方向键：键盘移动
    if (KEY_MOVE_CODES.has(e.code)) {
      keysDown.add(e.code);
      e.preventDefault();
      return;
    }
    if (e.code === "KeyV") useWorld.getState().toggleView();
    if (e.code === "KeyE") {
      const st = useWorld.getState();
      if (st.roomPrompt) roomHost.doorAction();
      else if (st.possessAgent) roomHost.release(); // 附身中：E = 退出附身
      else if (st.nearOwnAgent) roomHost.possessNearby(); // 面前有自己的空闲员工：附身
      else if (st.nearAgent) roomHost.talkToNearby();
      else if (st.inRoom) st.toggleRoomPanel();
    }
    if (e.code.startsWith("Digit")) {
      const n = parseInt(e.code.slice(5)) - 1;
      if (n >= 0 && n < HOTBAR_PROPS.length) useWorld.getState().setHotbar(n);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keysDown.delete(e.code);
  };
  const onBlur = () => keysDown.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  interface PtrTrack {
    sx: number; sy: number; lx: number; ly: number;
    moved: number; t0: number; button: number;
  }
  const pointers = new Map<number, PtrTrack>();
  let lastPinch = 0;
  const mouseNDC = new THREE.Vector2(9, 9);
  /** 鼠标上一次位置（自由转向的增量基准） */
  let lastMouseX = 0;
  let lastMouseY = 0;
  /** 边缘锁定：鼠标贴近左右边缘时持续转向 */
  let edgeTurn = 0;
  /** 鼠标是否在画布内（移出后停止边缘转向） */
  let mouseInside = false;
  /** 首次收到鼠标位置时初始化基准，避免第一帧视角猛跳 */
  let mouseInit = false;
  const dom = renderer.domElement;

  // ---------- 点击行走 ----------
  let moveTarget: { x: number; z: number } | null = null; // 户外：直线走向目标点
  /** 绕行途经点：被障碍挡住时先绕到障碍侧面，绕过再回原目标 */
  let avoidPoint: { x: number; z: number } | null = null;
  /** 户外寻路网格（建筑 + 街具为障碍），进世界后建一次 */
  let navGrid: NavGrid | null = null;
  /** 户外 A* 路径点序列（点击目的地时算一次） */
  let outdoorPath: Array<{ x: number; z: number }> = [];
  let outdoorWp = 0;
  /** 连续卡住帧数（真死角时放弃目标） */
  let stuckFrames = 0;
  /** 行人动态阻挡：附近的散步居民算障碍，玩家会绕开 */
  const pedBlock = (x: number, z: number): boolean => {
    const ped = townLife?.pedNear(x, z, 0.62);
    return !!ped && Math.hypot(ped.x - x, ped.z - z) < 0.62;
  };
  let roomPath: Array<{ x: number; z: number }> | null = null; // 房间：A* 路径
  let roomWp = 1; // 下一个路径点索引（0 是起点）
  /** 点击人物：走到面前后的对话对象（到达后自动开聊） */
  let approach: PersonHit | null = null;

  /** 设定户外目的地：用 A* 算出绕过建筑/街具的路径（没路才退回直线） */
  function setWalkPath(x: number, z: number) {
    moveTarget = { x, z };
    avoidPoint = null;
    stuckFrames = 0;
    outdoorPath = [];
    outdoorWp = 0;
    if (navGrid) {
      const path = findPath2D(navGrid, self.x, self.z, x, z);
      if (path.length > 1) {
        outdoorPath = path;
        outdoorWp = 1; // 起点是当前位置
      }
    }
  }

  function setPlayerPath(x: number, z: number) {
    if (roomHost.active) {
      roomPath = findPath(self.x, self.z, x, z);
      roomWp = 1;
      moveTarget = null;
      avoidPoint = null;
      outdoorPath = [];
      outdoorWp = 0;
      stuckFrames = 0;
    } else {
      moveTarget = { x, z };
      roomPath = null;
    }
  }

  function personPosOf(p: PersonHit): { x: number; z: number } | null {
    if (p.kind === "agent") return roomHost.agentPos(p.id);
    const r = clientWorld.remotes.get(p.id);
    return r ? { x: r.target.x, z: r.target.z } : null;
  }

  /** 点到人物：走到 TA 面前停下（agent 到达后自动开聊） */
  function approachPerson(p: PersonHit) {
    const tgt = personPosOf(p);
    if (!tgt) return;
    const d = Math.hypot(tgt.x - self.x, tgt.z - self.z);
    if (d <= 2.3) {
      // 已经在面前：直接开聊
      if (p.kind === "agent" && roomHost.active) roomHost.approachTalk(p.id);
      return;
    }
    let tx: number;
    let tz: number;
    if (roomHost.active) {
      // 工位四周有桌椅：取 agent 周围可落脚、且离自己最近的点（1.7m 一圈不够就 2.1m）
      let best: { x: number; z: number } | null = null;
      let bd = Infinity;
      for (const r of [1.7, 2.1]) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const px = tgt.x + Math.cos(a) * r;
          const pz = tgt.z + Math.sin(a) * r;
          if (roomHost.movementBlocked(px, pz)) continue;
          const dd = Math.hypot(px - self.x, pz - self.z);
          if (dd < bd) {
            bd = dd;
            best = { x: px, z: pz };
          }
        }
        if (best) break;
      }
      if (!best) return; // 四周全堵（比如正被围着开会）：不动
      tx = best.x;
      tz = best.z;
    } else {
      const stop = 1.7;
      tx = tgt.x + ((self.x - tgt.x) / d) * stop;
      tz = tgt.z + ((self.z - tgt.z) / d) * stop;
    }
    setPlayerPath(tx, tz);
    approach = p;
  }

  interface InEv {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    button: number;
    target: EventTarget | null;
  }
  const norm = (e: { pointerId?: number; identifier?: number; pointerType?: string; clientX: number; clientY: number; button?: number; target?: EventTarget | null }): InEv => ({
    pointerId: typeof e.pointerId === "number" ? e.pointerId : e.identifier ?? 0,
    pointerType: e.pointerType ?? "touch",
    clientX: e.clientX,
    clientY: e.clientY,
    button: e.button ?? 0,
    target: e.target ?? null,
  });

  const onPointerDown = (raw: InEv) => {
    const e = raw;
    // 只处理画布上的按下（UI 面板/聊天框的事件不拦截游戏交互）
    if (e.target !== renderer.domElement) return;
    // 按下时重置鼠标基准，避免「按下瞬间视角跳一下」
    if (e.pointerType === "mouse") {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
    pointers.set(e.pointerId, {
      sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY,
      moved: 0, t0: Date.now(), button: e.button,
    });
  };

  const onPointerMove = (raw: InEv) => {
    const e = raw;
    // 鼠标始终更新悬停坐标
    if (e.pointerType === "mouse") {
      mouseNDC.x = (e.clientX / container.clientWidth) * 2 - 1;
      mouseNDC.y = -(e.clientY / container.clientHeight) * 2 + 1;
      hoverScreen.x = e.clientX;
      hoverScreen.y = e.clientY;
    }
    const p = pointers.get(e.pointerId);
    if (p) {
      const camPointers = [...pointers.entries()];
      if (camPointers.length >= 2) {
        // 双指捏合缩放
        p.lx = e.clientX;
        p.ly = e.clientY;
        const pts = camPointers.map(([, q]) => ({ x: q.lx, y: q.ly }));
        if (pts.length === 2) {
          const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (lastPinch > 0) {
            // 双指缩放：按比例缩放（线性增量会一合就大幅跳变）
            const ratio = d / lastPinch;
            if (viewMode === "first") {
              // 第一人称：捏合变焦（FOV）
              camera.fov = Math.max(42, Math.min(80, camera.fov / ratio));
              camera.updateProjectionMatrix();
            } else {
              camDist = Math.max(5, Math.min(30, camDist / ratio));
            }
          }
          lastPinch = d;
        }
        p.moved += 10;
        return;
      }
      const dx = e.clientX - p.lx;
      const dy = e.clientY - p.ly;
      p.moved += Math.abs(dx) + Math.abs(dy);
      p.lx = e.clientX;
      p.ly = e.clientY;
      applyLookDelta(dx, dy, true);
    } else if (e.pointerType === "mouse") {
      // 自由转向：鼠标横向滑动即转视角（不需要按住拖动）
      if (!mouseInit) {
        mouseInit = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
      }
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      if (dx !== 0 || dy !== 0) applyLookDelta(dx, dy, false);
    }
  };

  /**
   * 把鼠标位移应用到视角（横向转 yaw + 纵向转 pitch），灵敏度可调
   * fromDrag=true 表示按住拖动（始终生效）；false 表示自由滑动（受 freeLook 开关控制）
   */
  const applyLookDelta = (dx: number, dy: number, fromDrag: boolean) => {
    const st = useWorld.getState().settings;
    if (!fromDrag && !st.freeLook) return;
    // 点击行走模式：鼠标移动只做落点指示，不自动转视角（否则指哪跑哪），转向靠按住拖拽
    if (!fromDrag && st.controlMode === "mouse") return;
    const sens = st.mouseSensitivity;
    camYaw -= dx * 0.0052 * sens;
    // 俯仰钳制：第一人称可略仰视；房间内保持俯视区间（不穿墙）
    const [pMin, pMax] =
      viewMode === "first" ? [-0.55, 1.35] : roomHost.active ? [0.55, 1.45] : [0.15, 1.45];
    camPitch = Math.max(pMin, Math.min(pMax, camPitch + dy * 0.0042 * sens));
  };

  const onPointerUp = (raw: InEv) => {
    const e = raw;
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    lastPinch = 0;
    const dur = Date.now() - p.t0;
    const wasTap = p.moved < 8 && dur < 400;
    const wasLongPress = p.moved < 8 && dur >= 500;
    if (!useWorld.getState().joined) return;
    if (wasTap) {
      mouseNDC.x = (p.lx / container.clientWidth) * 2 - 1;
      mouseNDC.y = -(p.ly / container.clientHeight) * 2 + 1;
      hoverTarget = raycastWorld();
      // 点击移动只在「鼠标点击」操作模式下生效；键盘模式下点击只做放置/拆除等建造交互
      const mouseControl = useWorld.getState().settings.controlMode === "mouse";
      if (p.button === 2) removeAction();
      else if (hoverTarget?.person) {
        // 点到人物：走到 TA 面前对话（不再穿透跑到身后）
        if (mouseControl) approachPerson(hoverTarget.person);
      } else if (roomHost.active) {
        // 房间内：点击 = 行走（A* 自动绕开桌椅）
        if (mouseControl && hoverTarget) setPlayerPath(hoverTarget.point.x, hoverTarget.point.z);
      } else {
        const sel = HOTBAR_PROPS[useWorld.getState().hotbarIndex];
        if (sel && sel.kind === "hand") {
          // 空手：点击地面行走
          if (mouseControl && hoverTarget) {
            const o = hoverTarget.objectId ? clientWorld.objects.get(hoverTarget.objectId) : null;
            const R = o ? (PROP_KINDS[o.kind]?.collideR ?? 0) : 0;
            if (R >= 2) {
              // 点到大建筑（房屋/办公楼）：目标外推到碰撞圈外一点，避免顶着墙卡死
              const dx = self.x - o!.x;
              const dz = self.z - o!.z;
              const dd = Math.hypot(dx, dz) || 1;
              const stop = R + 1.4;
              if (dd > stop) setWalkPath(o!.x + (dx / dd) * stop, o!.z + (dz / dd) * stop);
            } else {
              // 点空地行走：先算 A* 路径绕过建筑和街具
              setWalkPath(hoverTarget.point.x, hoverTarget.point.z);
              roomPath = null;
            }
          }
        } else {
          clickAction();
        }
      }
    } else if (wasLongPress) {
      mouseNDC.x = (p.lx / container.clientWidth) * 2 - 1;
      mouseNDC.y = -(p.ly / container.clientHeight) * 2 + 1;
      hoverTarget = raycastWorld();
      removeAction();
    }
  };

  // 滚轮缩放：阻止页面缩放（否则整个界面会跟着忽大忽小）+ 触控板细调不跳格
  let lastWheelTs = 0;
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheelTs < 80) return; // 惯性滚动期间不连续改
    lastWheelTs = now;
    const mag = Math.abs(e.deltaY);
    // 鼠标滚轮一格 deltaY≈100；触控板是连续小值 → 小步细调
    const step = mag >= 50 ? Math.sign(e.deltaY) * 1.6 : Math.sign(e.deltaY) * 0.45;
    if (viewMode === "first") {
      // 第一人称：滚轮变焦（FOV）
      camera.fov = Math.max(42, Math.min(80, camera.fov - step * 2.4));
      camera.updateProjectionMatrix();
    } else {
      camDist = Math.max(5, Math.min(30, camDist + step));
    }
  };
  const onContext = (e: Event) => e.preventDefault();
  if (typeof window.PointerEvent === "function") {
    dom.addEventListener("pointerdown", (e) => onPointerDown(norm(e)));
    window.addEventListener("pointermove", (e) => onPointerMove(norm(e)));
    window.addEventListener("pointerup", (e) => onPointerUp(norm(e)));
    window.addEventListener("pointercancel", (e) => onPointerUp(norm(e)));
  } else {
    // 旧浏览器：Touch Events + Mouse 回退
    const touchList = (e: TouchEvent) => Array.from(e.changedTouches);
    dom.addEventListener("touchstart", (e) => { for (const t of touchList(e)) onPointerDown(norm(t)); }, { passive: true });
    window.addEventListener("touchmove", (e) => { for (const t of touchList(e)) onPointerMove(norm(t)); }, { passive: true });
    window.addEventListener("touchend", (e) => { for (const t of touchList(e)) onPointerUp(norm(t)); });
    window.addEventListener("touchcancel", (e) => { for (const t of touchList(e)) onPointerUp(norm(t)); });
    dom.addEventListener("mousedown", (e) => onPointerDown(norm(e)));
    window.addEventListener("mousemove", (e) => onPointerMove(norm(e)));
    window.addEventListener("mouseup", (e) => onPointerUp(norm(e)));
  }
  dom.addEventListener("wheel", onWheel, { passive: false });
  dom.addEventListener("contextmenu", onContext);
  // 鼠标是否在画布内（自由转向 + 边缘锁定用）
  dom.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") mouseInside = true;
  });
  dom.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") mouseInside = false;
  });

  // ---------- 射线：人物（玩家/agent）+ 地形 + 道具 ----------
  const raycaster = new THREE.Raycaster();

  interface PersonHit {
    id: string;
    kind: "player" | "agent";
  }

  interface HitResult {
    ground: boolean;
    point: THREE.Vector3;
    objectId?: string;
    person?: PersonHit;
  }

  /** 命中的子 mesh 沿 parent 链找人物标记（rig 根上有 userData.personId） */
  function personOf(obj: THREE.Object3D | null): PersonHit | undefined {
    let o: THREE.Object3D | null = obj;
    while (o) {
      if (o.userData?.personId) return { id: o.userData.personId as string, kind: o.userData.personKind };
      o = o.parent;
    }
    return undefined;
  }

  function raycastWorld(): HitResult | null {
    raycaster.setFromCamera(mouseNDC, camera);
    // 人物（远端玩家 + 房间 agent）优先参与比距，点人物不再穿透点到身后地面
    const personRoots: THREE.Object3D[] = [];
    for (const [, r] of clientWorld.remotes) personRoots.push((r.group as Avatar).group);
    for (const m of roomHost.personMeshes()) personRoots.push(m);
    raycaster.far = roomHost.active ? 60 : 90; // 俯视下屏幕上方是很远的地面，32m 会让远处点击落空
    const personHits = personRoots.length ? raycaster.intersectObjects(personRoots, true) : [];
    const personHit = personHits.find((h) => personOf(h.object)) ?? null;
    const personInfo = personHit ? personOf(personHit.object) : undefined;
    // 房间模式：射线只打房间实体（户外地形在房间区域的高度不可用）
    if (roomHost.active && roomHost.solidMesh) {
      const hits = raycaster.intersectObject(roomHost.solidMesh, false);
      const solid = hits[0];
      if (personHit && (!solid || personHit.distance < solid.distance)) {
        return { ground: true, point: personHit.point, person: personInfo };
      }
      if (solid) return { ground: true, point: solid.point };
      return null;
    }
    const propMeshList: THREE.Object3D[] = [];
    for (const [, pm] of propMeshes) if (pm.mesh.visible) propMeshList.push(pm.mesh);
    const propHits = raycaster.intersectObjects(propMeshList, false);
    const groundHits = terrainMesh ? raycaster.intersectObject(terrainMesh, false) : [];
    const groundHit = groundHits[0];
    const propHit = propHits[0];
    if (personHit && personHit.distance < (propHit?.distance ?? Infinity) && personHit.distance < (groundHit?.distance ?? Infinity)) {
      return { ground: true, point: personHit.point, person: personInfo };
    }
    if (propHit && (!groundHit || propHit.distance < groundHit.distance)) {
      return { ground: false, point: propHit.point, objectId: propHit.object.userData.objectId as string };
    }
    if (groundHit) {
      return { ground: true, point: groundHit.point };
    }
    return null;
  }

  let hoverTarget: HitResult | null = null;

  function clickAction() {
    if (!hoverTarget) return;
    const sel = HOTBAR_PROPS[useWorld.getState().hotbarIndex];
    if (!sel) return;
    const x = Math.round(hoverTarget.point.x * 10) / 10;
    const z = Math.round(hoverTarget.point.z * 10) / 10;
    clientWorld.placeProp(sel.kind, sel.variant, x, z, camYaw + Math.PI, (ok, reason) => {
      if (!ok && reason) useWorld.getState().pushToast(reason);
    });
  }

  function removeAction() {
    if (!hoverTarget?.objectId) return;
    const id = hoverTarget.objectId;
    const o = clientWorld.objects.get(id);
    const selfId = useWorld.getState().selfId;
    if (o && o.creatorId !== selfId) {
      useWorld.getState().pushToast("只能拆除自己创建的造物哦");
      return;
    }
    clientWorld.removeProp(id);
  }

  // ---------- 高亮环 ----------
  const highlightRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.7, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  highlightRing.rotation.x = -Math.PI / 2;
  highlightRing.visible = false;
  scene.add(highlightRing);

  // ---------- 目的地标记：固定在目标点的脉冲圈 + 脚前指向行进方向的箭头 ----------
  const destRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 36),
    new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
  );
  destRing.rotation.x = -Math.PI / 2;
  destRing.visible = false;
  scene.add(destRing);
  const destArrow = new THREE.Group();
  const destArrowCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.6, 3),
    new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.6 })
  );
  destArrowCone.rotation.x = Math.PI / 2; // 锥体平躺，尖端指向局部 +z
  destArrow.add(destArrowCone);
  destArrow.visible = false;
  scene.add(destArrow);

  // ---------- 摆道具落点预览：选中道具时压暗地图 + 绿/红落点框 + 原因提示 ----------
  const placePreview = new THREE.Group();
  placePreview.visible = false;
  scene.add(placePreview);
  const previewRect = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, -1), new THREE.Vector3(1, 0, 1), new THREE.Vector3(-1, 0, 1),
    ]),
    new THREE.LineBasicMaterial({ color: 0x7ddc8b, transparent: true, opacity: 0.95 })
  );
  const previewCircle = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 33 }, (_, i) => {
        const a = (i / 32) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      })
    ),
    new THREE.LineBasicMaterial({ color: 0x7ddc8b, transparent: true, opacity: 0.95 })
  );
  placePreview.add(previewRect, previewCircle);
  /** 压暗状态：true = 当前处于摆道具模式（灯光降档），false = 已还原 */
  let dimmed = false;
  const LIGHT_DIM = { sun: 0.9, hemi: 0.6, amb: 0.11 };
  const LIGHT_FULL = { sun: 2.2, hemi: 1.35, amb: 0.25 };
  const setDim = (v: boolean) => {
    if (dimmed === v) return;
    dimmed = v;
    const t = v ? LIGHT_DIM : LIGHT_FULL;
    sun.intensity = t.sun;
    hemi.intensity = t.hemi;
    amb.intensity = t.amb;
  };
  /** 地块许可缓存（跨图块边界才重新请求） */
  const landAtCache = new Map<string, { canBuild: boolean; reason: string; at: number }>();
  let landAtLast = 0;
  const LAND_AT_TTL = 30_000; // 审批通过后 30s 内缓存自动失效
  /** 落点是否可放（本地规则 + 地块权限缓存），返回原因 */
  function placementCheck(x: number, z: number, kind: string): { ok: boolean; reason: string } {
    const W = clientWorld.meta?.size ?? 256;
    if (x < 1.2 || z < 1.2 || x > W - 1.2 || z > W - 1.2) return { ok: false, reason: "太靠地图边缘了" };
    if (!clientWorld.isLand(x, z)) return { ok: false, reason: "水里放不了" };
    // 间距（本地近似）：与任意已有造物的碰撞形状保持最小间距
    const size = buildingSize(kind, {});
    const halfW = isBuildingKind(kind) ? size.w / 2 + 0.3 : 0.9;
    const halfD = isBuildingKind(kind) ? size.d / 2 + 0.3 : 0.9;
    for (const o of clientWorld.objects.values()) {
      if (isBuildingKind(o.kind)) {
        const rect = buildingRect(o.kind, o.params, o.scale || 1);
        if (!rect) continue;
        const c = Math.cos(o.rotY);
        const s2 = Math.sin(o.rotY);
        const dx = o.x - x;
        const dz = o.z - z;
        const lx = dx * c - dz * s2;
        const lz = dx * s2 + dz * c;
        const ox = rect.hw + 0.34 + halfW - 0.3;
        const oz = rect.hd + 0.34 + halfD - 0.3;
        if (Math.abs(lx) < ox && Math.abs(lz) < oz) return { ok: false, reason: "离其他造物太近了" };
      } else {
        const cr = isPropCollidable(o.kind) * (o.scale || 1) * 0.8 + 0.32 + halfW - 0.3;
        if (Math.hypot(o.x - x, o.z - z) < cr) return { ok: false, reason: "离其他造物太近了" };
      }
    }
    // 街景陈设（长椅/行道树/停着的车…）不让压
    if (clientWorld.extra.hit(x, z, Math.hypot(halfW, halfD))) return { ok: false, reason: "压着街景设施了" };
    // 地块权限（九州地块须归属本人；公共区放行）——用缓存的 viewer 视角结果
    const pid = plotIdAt(x, z);
    if (pid) {
      const c = landAtCache.get(pid);
      if (c && !c.canBuild) return { ok: false, reason: c.reason };
    }
    return { ok: true, reason: "这里可以放" };
  }

  // ---------- 土地边界线（🗺 土地面板打开时显示 24 块地归属着色） ----------
  const landLines = new THREE.Group();
  landLines.visible = false;
  scene.add(landLines);
  function setLandOverlay(rows: Array<{ plotId: string; ownerId: string; ownerName: string }> | null) {
    landLines.clear();
    if (!rows) return;
    const st0 = useWorld.getState();
    const myKey = st0.auth.user ? `u:${st0.auth.user.id}` : "";
    for (const row of rows) {
      const b = plotBounds(row.plotId);
      if (!b) continue;
      const color = !row.ownerId ? 0xb8b2a4 : row.ownerId === myKey ? 0x6fdd8b : 0xe08a8a;
      const y = clientWorld.surfaceY((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) + 0.15;
      const pts = [
        new THREE.Vector3(b.x0, y, b.z0),
        new THREE.Vector3(b.x1, y, b.z0),
        new THREE.Vector3(b.x1, y, b.z1),
        new THREE.Vector3(b.x0, y, b.z1),
        new THREE.Vector3(b.x0, y, b.z0),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 })
      );
      landLines.add(line);
    }
  }

  // ---------- 标签系统 ----------
  const labelLayer = document.createElement("div");
  labelLayer.className = "labelLayer";
  container.appendChild(labelLayer);
  const labels = new Map<string, { el: HTMLDivElement; wx: number; wy: number; wz: number; maxDist: number }>();

  function setLabel(id: string, html: string, wx: number, wy: number, wz: number, cls = "", maxDist = 42) {
    let l = labels.get(id);
    if (!l) {
      const el = document.createElement("div");
      el.dataset.labelId = id; // 名牌点击走近：委托在 labelLayer 上按 labelId 分发
      labelLayer.appendChild(el);
      l = { el, wx, wy, wz, maxDist };
      labels.set(id, l);
    }
    l.wx = wx;
    l.wy = wy;
    l.wz = wz;
    l.maxDist = maxDist;
    if (l.el.innerHTML !== html) l.el.innerHTML = html;
    l.el.className = `gameLabel ${cls}`;
  }

  // 点名牌（agent / 其他玩家）= 走到 TA 面前：手机上名牌是天然的大号点击热区
  // 仅「鼠标点击」操作模式生效；键盘模式下自己用 WASD 走过去
  labelLayer.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement).closest(".nameTag") as HTMLElement | null;
    const lid = el?.dataset.labelId ?? "";
    if (!lid || lid === "tag-self") return;
    if (useWorld.getState().settings.controlMode !== "mouse") return;
    if (lid.startsWith("agent-")) approachPerson({ id: lid.slice(6), kind: "agent" });
    else if (lid.startsWith("tag-")) approachPerson({ id: lid.slice(4), kind: "player" });
  });

  function removeLabel(id: string) {
    const l = labels.get(id);
    if (l) {
      l.el.remove();
      labels.delete(id);
    }
  }

  const hoverTooltip = document.createElement("div");
  hoverTooltip.className = "hoverTooltip";
  hoverTooltip.style.display = "none";
  container.appendChild(hoverTooltip);
  const hoverScreen = { x: -1, y: -1 };

  // ---------- 房间宿主接线 ----------
  roomHost.init({
    scene,
    fog,
    labels: { setLabel, removeLabel },
    setSelf: (x, y, z, rotY) => {
      self.x = x;
      self.y = y;
      self.z = z;
      if (rotY !== undefined) self.rotY = rotY;
      moveTarget = null;
      avoidPoint = null;
      outdoorPath = [];
      outdoorWp = 0;
      stuckFrames = 0;
      roomPath = null;
      camTarget.set(x, y + 1.2, z);
      camCur.set(x, y + 10, z + 3);
    },
    getSelf: () => ({ x: self.x, y: self.y, z: self.z, rotY: self.rotY }),
    getCamDist: () => camDist,
    setCamDist: (d) => {
      camDist = d;
    },
    setCamPitch: (p) => {
      camPitch = p;
    },
    outdoor: {
      get terrain() {
        return terrainMesh;
      },
      get water() {
        return waterMesh;
      },
      get propGroup() {
        return propGroup;
      },
      get highlightRing() {
        return highlightRing;
      },
    },
  });

  // ---------- 远端玩家 ----------
  clientWorld.remoteFactory = (p: PlayerInfo) => {
    // 防御：任何路径都不给自己建远程分身
    if (p.id === useWorld.getState().selfId) return;
    const av = createAvatar(p.name, p.color);
    av.group.userData.personId = p.id; // 点击人物：射线命中后沿 parent 链找到 id
    av.group.userData.personKind = "player";
    av.group.traverse((c) => {
      c.castShadow = true;
    });
    av.group.position.set(p.x, p.y, p.z);
    // 离线驻留的小人（断线留原地的）：半透明 + 💤 名牌
    const off = p.online === false;
    if (off) {
      setAvatarOffline(av, true);
      av.group.userData.offlineDwelling = true;
    }
    scene.add(av.group);
    clientWorld.remotes.set(p.id, {
      group: av,
      target: { x: p.x, y: p.y, z: p.z, rotY: p.rotY },
      info: p,
    });
    setLabel(`tag-${p.id}`, off ? `💤 ${p.name}` : `<img class="pixelFace" src="${pixelAvatarDataURL(p.id)}" alt=""><span>${p.name}</span>`, p.x, p.y + 1.72, p.z, off ? "nameTag offline" : "nameTag");
  };
  clientWorld.remoteRemover = (id: string) => {
    const r = clientWorld.remotes.get(id);
    if (r) {
      scene.remove((r.group as Avatar).group);
      removeLabel(`tag-${id}`);
    }
  };

  // ---------- 主循环 ----------
  const clock = new THREE.Clock();
  let moveTimer = 0;
  let raf = 0;
  /** 当前操作方式（切换时清掉残余的点击目标/路径，避免换模式后继续自动走） */
  let lastControlMode: ControlMode | null = null;
  const camTarget = new THREE.Vector3(128.5, 14, 128.5);
  const camCur = new THREE.Vector3(140, 26, 142);
  /** 调试/截图用自由机位（null = 正常玩法相机） */
  let freeCam: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  function tick() {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.06);
    const time = clock.elapsedTime;
    const st = useWorld.getState();

    // 1. 本地移动（点击行走：户外直线+滑动避障，房间 A* 路径）
    if (st.joined) {
      // 操作方式切换：清掉残余的点击目标 / A* 路径 / 走向人物意图
      if (st.settings.controlMode !== lastControlMode) {
        lastControlMode = st.settings.controlMode;
        moveTarget = null;
        avoidPoint = null;
        stuckFrames = 0;
        roomPath = null;
        approach = null;
      }
      let moving = false;
            const SPEED = 4.6;
      if (roomHost.active && roomPath) {
        let remain = SPEED * dt;
        while (remain > 0 && roomWp < roomPath.length) {
          const wp = roomPath[roomWp];
          const dx = wp.x - self.x;
          const dz = wp.z - self.z;
          const d = Math.hypot(dx, dz);
          if (d <= remain) {
            self.x = wp.x;
            self.z = wp.z;
            remain -= d;
            roomWp++;
          } else {
            self.x += (dx / d) * remain;
            self.z += (dz / d) * remain;
            remain = 0;
          }
          moving = true;
          self.rotY = Math.atan2(dx, dz);
        }
        if (roomWp >= roomPath.length) roomPath = null;
        self.y = 0;
      } else if (moveTarget) {
        // 沿 A* 路径走（点击目的地时算好）；路径走完再走直线到最终目标
        if (outdoorPath.length && outdoorWp < outdoorPath.length) {
          const wp = outdoorPath[outdoorWp];
          const wdx = wp.x - self.x;
          const wdz = wp.z - self.z;
          const wd = Math.hypot(wdx, wdz);
          if (wd < 0.6) {
            outdoorWp++;
          } else {
            const step = SPEED * dt;
            const nx = self.x + (wdx / wd) * step;
            const nz = self.z + (wdz / wd) * step;
            const blockedHere = clientWorld.blockedAt(self.x, self.z) || pedBlock(self.x, self.z);
            const okX = blockedHere || !clientWorld.blockedAt(nx, self.z);
            const okZ = blockedHere || !clientWorld.blockedAt(self.x, nz);
            if (okX) self.x = nx;
            if (okZ) self.z = nz;
            moving = okX || okZ;
            self.rotY = Math.atan2(wdx, wdz);
            const ty = clientWorld.surfaceY(self.x, self.z);
            self.y += (ty - self.y) * Math.min(1, dt * 12);
          }
        } else {
        // 目标点：优先走向绕行途经点（绕开障碍侧面），没有则走向原目标
        const goal = avoidPoint ?? moveTarget;
        const dx = goal.x - self.x;
        const dz = goal.z - self.z;
        const dist = Math.hypot(dx, dz);
        const step = SPEED * dt;
        const blocked = (x: number, z: number) => clientWorld.blockedAt(x, z) || pedBlock(x, z);
        if (avoidPoint && dist < 1.3) {
          avoidPoint = null; // 绕过障碍，回到原目标
        } else if (dist <= step) {
          // 到达：只有落点能站才落位，否则停在这儿（不瞬移进墙/行人里）
          if (!avoidPoint && !blocked(moveTarget.x, moveTarget.z)) {
            self.x = moveTarget.x;
            self.z = moveTarget.z;
            moveTarget = null;
            outdoorPath = [];
            outdoorWp = 0;
            moving = true;
          } else {
            moving = false;
          }
        } else {
          const ux = dx / dist;
          const uz = dz / dist;
          const nx = self.x + ux * step;
          const nz = self.z + uz * step;
          let moved = false;
          let faceX = ux;
          let faceZ = uz;
          if (!blocked(nx, nz)) {
            self.x = nx;
            self.z = nz;
            moved = true;
          } else {
            // 前方有障碍：找一个绕行途经点（障碍侧后方），先绕过去
            if (!avoidPoint) {
              const hit = clientWorld.raycastHit(self.x, self.z, ux, uz, 3.2);
              if (hit) {
                const px = -uz; // 垂直于视线
                const pz = ux;
                for (const r of [2.4, 3.2, 1.8]) {
                  for (const s of [1, -1]) {
                    const cx = hit.x + px * r * s;
                    const cz = hit.z + pz * r * s;
                    if (!clientWorld.blockedAt(cx, cz)) {
                      avoidPoint = { x: cx, z: cz };
                      break;
                    }
                  }
                  if (avoidPoint) break;
                }
              }
            }
            if (avoidPoint) {
              // 朝绕行点走一步（每帧重算方向，形成弧线）
              const ax = avoidPoint.x - self.x;
              const az = avoidPoint.z - self.z;
              const ad = Math.hypot(ax, az);
              if (ad > 0.01) {
                const bx = self.x + (ax / ad) * step;
                const bz = self.z + (az / ad) * step;
                if (!blocked(bx, bz)) {
                  self.x = bx;
                  self.z = bz;
                  faceX = ax / ad;
                  faceZ = az / ad;
                  moved = true;
                } else {
                  // 绕行点也去不了：沿墙滑
                  const okX = !blocked(bx, self.z);
                  const okZ = !blocked(self.x, bz);
                  if (okX) {
                    self.x = bx;
                    moved = true;
                  }
                  if (okZ) {
                    self.z = bz;
                    moved = true;
                  }
                }
              }
            } else {
              // 沿墙滑（兜底）
              const okX = !blocked(nx, self.z);
              const okZ = !blocked(self.x, nz);
              if (okX) {
                self.x = nx;
                moved = true;
              }
              if (okZ) {
                self.z = nz;
                moved = true;
              }
            }
            if (!moved) {
              stuckFrames++;
              if (stuckFrames > 150) {
                // 真死角：放弃目标
                moveTarget = null;
                avoidPoint = null;
                stuckFrames = 0;
              }
            } else {
              stuckFrames = 0;
            }
          }
          moving = moved;
          self.rotY = Math.atan2(faceX, faceZ);
          const ty = clientWorld.surfaceY(self.x, self.z);
          self.y += (ty - self.y) * Math.min(1, dt * 12);
        }
        }
      }

      // ---------- 点击人物：走到面前后自动开聊 ----------
      if (approach) {
        const tgt = personPosOf(approach);
        const d = tgt ? Math.hypot(tgt.x - self.x, tgt.z - self.z) : Infinity;
        const arrived = (!moveTarget && !roomPath) || d < 2.3;
        if (!tgt || arrived) {
          if (approach.kind === "agent" && roomHost.active && d < 2.8) roomHost.approachTalk(approach.id);
          approach = null;
        }
      }

      // ---------- 鼠标横向移动转向（不需按住） ----------
      // 自由转向：鼠标横向滑动即转视角；滑到屏幕左右边缘时持续缓慢转
      if (useWorld.getState().settings.freeLook && !roomHost.active && mouseInside) {
        const w = container.clientWidth;
        const EDGE = 24;
        let turn = 0;
        if (hoverScreen.x < EDGE) turn = 1;
        else if (hoverScreen.x > w - EDGE) turn = -1;
        // 点击行走模式不开边缘转向（鼠标贴边会把视角带着跑）
        const edgeOk = useWorld.getState().settings.controlMode !== "mouse";
        if (turn !== 0 && edgeOk && useWorld.getState().settings.edgeLock) {
          const sens = useWorld.getState().settings.mouseSensitivity;
          camYaw += turn * dt * 1.1 * sens;
        }
      }

      // ---------- 键盘移动（WASD / 方向键） ----------
      // 仅「键盘」操作模式生效；与点击行走互斥
      if (st.settings.controlMode === "keyboard" && keysDown.size > 0) {
        // 输入方向（屏幕空间）：W=前 S=后 A=左 D=右
        let ix = 0;
        let iz = 0;
        if (keysDown.has("KeyW") || keysDown.has("ArrowUp")) iz -= 1;
        if (keysDown.has("KeyS") || keysDown.has("ArrowDown")) iz += 1;
        if (keysDown.has("KeyA") || keysDown.has("ArrowLeft")) ix -= 1;
        if (keysDown.has("KeyD") || keysDown.has("ArrowRight")) ix += 1;
        if (ix !== 0 || iz !== 0) {
          moveTarget = null; // 键盘接管，取消点击目标
          avoidPoint = null;
          outdoorPath = [];
          outdoorWp = 0;
          stuckFrames = 0;
          roomPath = null; // 房内也放弃 A* 路径
          approach = null; // 也放弃走向人物的意图
          // 相机朝向：前 = 相机正前方（camYaw 决定）
          const len = Math.hypot(ix, iz);
          const fx = ix / len;
          const fz = iz / len;
          // 相机前方向量（three.js 相机 yaw 与世界 -Z/+Z 的关系用 camYaw 推出）
          const sin = Math.sin(camYaw);
          const cos = Math.cos(camYaw);
          const wx = fx * cos + fz * sin;
          const wz = -fx * sin + fz * cos;
          const step = SPEED * st.settings.keyboardSpeed * dt;
          const nx = self.x + wx * step;
          const nz = self.z + wz * step;
          // 碰撞：户外用地形碰撞（+行人），房内用房间障碍
          const blocked = roomHost.active
            ? roomHost.movementBlocked(nx, nz)
            : clientWorld.blockedAt(nx, nz) || pedBlock(nx, nz);
          const blockedHere = roomHost.active
            ? roomHost.movementBlocked(self.x, self.z)
            : clientWorld.blockedAt(self.x, self.z) || pedBlock(self.x, self.z);
          if (!blocked) {
            self.x = nx;
            self.z = nz;
          } else if (blockedHere) {
            // 脚下已卡住 → 允许朝任一方向挪出（脱困）
            self.x += wx * step * 0.6;
            self.z += wz * step * 0.6;
          } else {
            // 沿墙滑动：只走未被挡住的轴
            const okX = roomHost.active
              ? !roomHost.movementBlocked(nx, self.z)
              : !clientWorld.blockedAt(nx, self.z) && !pedBlock(nx, self.z);
            const okZ = roomHost.active
              ? !roomHost.movementBlocked(self.x, nz)
              : !clientWorld.blockedAt(self.x, nz) && !pedBlock(self.x, nz);
            if (okX) self.x = nx;
            if (okZ) self.z = nz;
            if (!okX && !okZ) {
              // 正面对墙：找撞点求墙法线，沿墙的切线方向走（贴着墙绕过去，不会死锁）
              const hit = roomHost.active ? null : clientWorld.raycastHit(self.x, self.z, wx, wz, 1.3);
              if (hit) {
                let nX = self.x - hit.x;
                let nZ = self.z - hit.z;
                const nl = Math.hypot(nX, nZ) || 1;
                nX /= nl;
                nZ /= nl;
                const tX = -nZ; // 切线 = 法线旋转 90°
                const tZ = nX;
                for (const s of [1, -1]) {
                  const bx = self.x + tX * step * s;
                  const bz = self.z + tZ * step * s;
                  const ok = roomHost.active ? !roomHost.movementBlocked(bx, bz) : !clientWorld.blockedAt(bx, bz) && !pedBlock(bx, bz);
                  if (ok) {
                    self.x = bx;
                    self.z = bz;
                    break;
                  }
                }
              } else {
                // 房内（没有户外射线）：偏转绕行
                const angles = [0.7, -0.7, 1.25, -1.25];
                for (const a of angles) {
                  const c = Math.cos(a);
                  const s = Math.sin(a);
                  const rx = wx * c - wz * s;
                  const rz = wx * s + wz * c;
                  const bx = self.x + rx * step;
                  const bz = self.z + rz * step;
                  const ok = roomHost.active ? !roomHost.movementBlocked(bx, bz) : !clientWorld.blockedAt(bx, bz) && !pedBlock(bx, bz);
                  if (ok) {
                    self.x = bx;
                    self.z = bz;
                    break;
                  }
                }
              }
            }
          }
          moving = true;
          if (Math.abs(wx) > 0.001 || Math.abs(wz) > 0.001) self.rotY = Math.atan2(wx, wz);
          if (roomHost.active) {
            self.y = 0;
          } else {
            const ty = clientWorld.surfaceY(self.x, self.z);
            self.y += (ty - self.y) * Math.min(1, dt * 12);
          }
        }
      }
      // 贴地自愈：无论是否在移动，y 都向地表收敛——旧存档悬空、异常高度站着不动也能落回地面
      if (!roomHost.active) {
        const groundY = clientWorld.surfaceY(self.x, self.z);
        self.y += (groundY - self.y) * Math.min(1, dt * 8);
      }

      // ---------- 目的地标记：圈固定在目标点，箭头在脚前指向行进方向 ----------
      const dest = moveTarget ?? (roomPath && roomPath.length ? roomPath[roomPath.length - 1] : null);
      destRing.visible = !!dest;
      destArrow.visible = !!dest;
      if (dest) {
        const indoor = roomHost.active;
        destRing.position.set(dest.x, indoor ? 0.06 : clientWorld.surfaceY(dest.x, dest.z) + 0.1, dest.z);
        destRing.scale.setScalar(1 + Math.sin(time * 5) * 0.03);
        const dx = dest.x - self.x;
        const dz = dest.z - self.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.6) {
          destArrow.visible = true;
          destArrow.position.set(self.x + (dx / dist) * 0.9, indoor ? 0.18 : self.y + 0.22, self.z + (dz / dist) * 0.9);
          destArrow.rotation.y = Math.atan2(dx, dz);
        }
      }
      self.anim = moving ? "walk" : "idle";

      moveTimer += dt;
      if (moveTimer >= 0.1) {
        moveTimer = 0;
        // 附身中：自己的身体原地不动（房间内由 roomHost 转发所操控员工的移动）
        if (!roomHost.possessedId) sendMove({ x: self.x, y: self.y, z: self.z, rotY: self.rotY, anim: self.anim });
      }
    }

    // 2. 道具弹出动画
    for (const [id, t0] of popAnims) {
      const t = (Date.now() - t0) / 380;
      const pm = propMeshes.get(id);
      if (!pm) {
        popAnims.delete(id);
        continue;
      }
      if (t >= 1) {
        pm.mesh.scale.setScalar(1);
        popAnims.delete(id);
        if (isBuildingKind(pm.kind)) rebuildCamBox(id, pm.mesh); // 弹出动画结束才有真实尺寸
      } else {
        const s = 1 - Math.pow(1 - t, 3);
        pm.mesh.scale.setScalar(s);
        pm.mesh.position.y = pm.seatY + (1 - s) * 0.6;
      }
    }

    // 3. 自身 avatar（附身中隐身：镜头里只有被操控的员工身体）
    const possessing = !!roomHost.possessedId;
    selfAvatar.group.position.set(self.x, self.y, self.z);
    selfAvatar.group.rotation.y = self.rotY;
    animateAvatar(selfAvatar, possessing ? "idle" : self.anim, time);
    if (!possessing) setLabel("tag-self", `<img class="pixelFace" src="${pixelAvatarDataURL(st.selfId || "self")}" alt=""><span>${st.selfName || "我"}</span>`, self.x, self.y + 1.72, self.z, "nameTag self");
    else removeLabel("tag-self");

    // 4. 远端玩家插值
    for (const [, r] of clientWorld.remotes) {
      const av = r.group as Avatar;
      const g = av.group;
      g.position.x += (r.target.x - g.position.x) * Math.min(1, dt * 12);
      g.position.y += (r.target.y - g.position.y) * Math.min(1, dt * 12);
      g.position.z += (r.target.z - g.position.z) * Math.min(1, dt * 12);
      const dRot = ((r.target.rotY - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      g.rotation.y += dRot * Math.min(1, dt * 12);
      const dist = Math.hypot(r.target.x - g.position.x, r.target.z - g.position.z);
      // 离线驻留（快照带 online:false）：小人半透明💤站原地不动；复活自动恢复
      const off = r.info.online === false;
      if (!!g.userData.offlineDwelling !== off) {
        g.userData.offlineDwelling = off;
        setAvatarOffline(av, off);
      }
      animateAvatar(av, !off && (dist > 0.1 || r.info.anim === "walk") ? "walk" : "idle", time);
      setLabel(`tag-${r.info.id}`, off ? `💤 ${r.info.name}` : `<img class="pixelFace" src="${pixelAvatarDataURL(r.info.id)}" alt=""><span>${r.info.name}</span>`, g.position.x, g.position.y + 1.72, g.position.z, off ? "nameTag offline" : "nameTag");
    }

    // 土地边界线随面板开关显隐
    landLines.visible = st.landOpen && st.joined && !roomHost.active;

    // 6. 射线悬停 + 高亮环 + 溯源提示（房间内跳过：户外射线无意义）
    if (st.joined && !roomHost.active) {
      hoverTarget = raycastWorld();
      if (hoverTarget) {
        highlightRing.visible = true;
        highlightRing.position.set(hoverTarget.point.x, hoverTarget.point.y + 0.07, hoverTarget.point.z);
        const o = hoverTarget.objectId ? clientWorld.objects.get(hoverTarget.objectId) : null;
        if (o) {
          hoverTooltip.innerHTML = `<b>✍️ 由 ${o.creatorName} 创建</b><span class="t">${new Date(
            o.createdAt
          ).toLocaleString("zh-CN", { hour12: false })}</span>`;
          hoverTooltip.style.display = hoverScreen.x > 0 ? "" : "none";
        } else {
          hoverTooltip.style.display = "none";
        }
      } else {
        highlightRing.visible = false;
        hoverTooltip.style.display = "none";
      }
      if (hoverTooltip.style.display === "") {
        hoverTooltip.style.left = `${hoverScreen.x + 14}px`;
        hoverTooltip.style.top = `${hoverScreen.y + 10}px`;
      }
    }

    // 6b. 摆道具落点预览（选中非空手道具：压暗地图 + 落点框 + 原因提示）
    if (roomHost.active) setDim(false); // 房间内还原灯光
    const sel = HOTBAR_PROPS[st.hotbarIndex];
    const placing = !!sel && sel.kind !== "hand" && st.joined && !roomHost.active && !!hoverTarget && hoverTarget.ground;
    setDim(placing);
    placePreview.visible = placing;
    if (placing && hoverTarget) {
      const px2 = hoverTarget.point.x;
      const pz2 = hoverTarget.point.z;
      const kind = sel!.kind;
      const size = buildingSize(kind, {});
      const chk = placementCheck(px2, pz2, kind);
      previewRect.visible = isBuildingKind(kind);
      previewCircle.visible = !isBuildingKind(kind);
      const col = chk.ok ? 0x7ddc8b : 0xe08a8a;
      (previewRect.material as THREE.LineBasicMaterial).color.setHex(col);
      (previewCircle.material as THREE.LineBasicMaterial).color.setHex(col);
      previewRect.position.set(px2, hoverTarget.point.y + 0.12, pz2);
      previewRect.rotation.y = camYaw;
      previewRect.scale.set(size.w / 2 + 0.3, 1, size.d / 2 + 0.3);
      previewCircle.position.copy(previewRect.position);
      // 地块权限缓存：悬停地块变化时节流拉取（带 token = viewer 视角）
      const pid = plotIdAt(px2, pz2);
      const cached = pid ? landAtCache.get(pid) : null;
      const cacheOk = cached && Date.now() - cached.at < LAND_AT_TTL;
      if (pid && !cacheOk && Date.now() - landAtLast > 500) {
        landAtLast = Date.now();
        const headers: Record<string, string> = st.auth.token ? { Authorization: `Bearer ${st.auth.token}` } : {};
        fetch(`/api/land/at?x=${px2.toFixed(1)}&z=${pz2.toFixed(1)}`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d.plotId) landAtCache.set(d.plotId, { canBuild: !!d.viewer?.canBuild, reason: d.viewer?.reason ?? "", at: Date.now() });
          })
          .catch(() => {});
      }
      // 原因提示（覆盖 hover 溯源文案）
      hoverTooltip.innerHTML = `<b>${chk.ok ? "✅ 可以放" : "🚫 " + chk.reason}</b><span class="t">${sel!.label} · 点地放置</span>`;
      hoverTooltip.style.display = "";
      hoverTooltip.style.left = `${hoverScreen.x + 14}px`;
      hoverTooltip.style.top = `${hoverScreen.y + 10}px`;
    }

    // 7. 相机（第三人称环绕 / 第一人称眼位，store 驱动可切换）
    if (st.viewMode !== viewMode) {
      viewMode = st.viewMode;
      camera.fov = 58;
      camera.updateProjectionMatrix();
      if (viewMode === "first") {
        camPitch = Math.min(Math.max(-0.55, camPitch), 0.28); // 切入时近乎平视，看地平线而非脚底
        camCur.set(self.x, self.y + 1.5, self.z); // 避免切回第三人称时相机漂移
      } else {
        camPitch = roomHost.active ? Math.max(0.55, Math.min(1.45, camPitch)) : Math.max(0.15, Math.min(1.45, camPitch));
      }
    }
    // 门口提示检测（每帧，廉价）
    if (st.joined) {
      const prompt = roomHost.doorPrompt;
      if (prompt?.kind !== st.roomPrompt?.kind || prompt?.roomId !== st.roomPrompt?.roomId) st.setRoomPrompt(prompt);
    }
    camTarget.set(self.x, self.y + 1.2, self.z);
    if (viewMode === "first") {
      const cp = Math.cos(camPitch);
      camera.position.set(self.x, self.y + 1.5, self.z);
      camera.lookAt(
        // 与第三人称一致（第三人称视线 = -camDir）：原来这里 x 分量符号相反，导致第一人称转向是反的
        self.x - Math.sin(camYaw) * cp,
        self.y + 1.5 - Math.sin(camPitch),
        self.z - Math.cos(camYaw) * cp
      );
    } else {
      const [dMin, dMax] = roomHost.cameraDistRange();
      let effDist = Math.max(dMin, Math.min(dMax, camDist));
      // 俯角直接由 camPitch 决定（防钻地由下方地形钳制保证）——低角度能看到天空/海/地平线
      const camDir = new THREE.Vector3(
        Math.sin(camYaw) * Math.cos(camPitch),
        Math.sin(camPitch),
        Math.cos(camYaw) * Math.cos(camPitch)
      ).normalize();
      // 视线穿过房屋/办公楼时把相机拉到建筑前，避免相机进楼穿模透视
      if (camBoxes.size && !roomHost.active) {
        const ray = new THREE.Ray(camTarget, camDir);
        const hitV = new THREE.Vector3();
        for (const [, box] of camBoxes) {
          if (ray.intersectBox(box, hitV)) {
            const d = hitV.distanceTo(camTarget);
            if (d < effDist) effDist = Math.max(1.6, d - 0.4);
          }
        }
      }
      // 被建筑裁剪时距离会突变（走动时射线擦过楼角就跳一下）→ 平滑收敛，画面不忽远忽近
      camDistSmooth += (effDist - camDistSmooth) * Math.min(1, dt * 6);
      effDist = camDistSmooth;
      const desired = camTarget.clone().addScaledVector(camDir, effDist);
      if (!roomHost.active) {
        // 户外：相机不钻地；房间内地面 y=0，不适用地形钳制
        const groundY = clientWorld.surfaceY(desired.x, desired.z) + 0.8;
        desired.y = Math.max(desired.y, groundY);
      }
      camCur.lerp(desired, Math.min(1, dt * 8));
      camera.position.copy(camCur);
      camera.lookAt(camTarget);
    }
    selfAvatar.group.visible = viewMode === "third" && !roomHost.possessedId;

    // 8. 标签投影
    const w = container.clientWidth;
    const h = container.clientHeight;
    const v = new THREE.Vector3();
    for (const [, l] of labels) {
      v.set(l.wx, l.wy, l.wz).project(camera);
      const dist = camera.position.distanceTo(new THREE.Vector3(l.wx, l.wy, l.wz));
      // 第一人称隐藏自己的名牌（投影在屏幕中央很怪）
      if (viewMode === "first" && l === labels.get("tag-self")) {
        l.el.style.display = "none";
        continue;
      }
      if (v.z > 1 || dist > l.maxDist) {
        l.el.style.display = "none";
        continue;
      }
      l.el.style.display = "";
      l.el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
      l.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
    }

    // 9. 产权标注浮签
    if (st.showOwnerLabels) {
      for (const [objId, pm] of propMeshes) {
        if (pm.kind === "path" || pm.kind === "lamp") continue;
        const o = clientWorld.objects.get(objId);
        const icon = propIcon(pm.kind);
        setLabel(
          `obj-${objId}`,
          `<span class="objLabel">${icon} ${o?.variant ?? pm.variant} · ${pm.creator}</span>`,
          pm.mesh.position.x,
          clientWorld.heightAt(pm.mesh.position.x, pm.mesh.position.z) + pm.labelY,
          pm.mesh.position.z,
          "objTag",
          55
        );
      }
    } else {
      for (const [id] of labels) {
        if (id.startsWith("obj-")) removeLabel(id);
      }
    }

    // 10. 房间系统（agent 状态机/动画/名牌/气泡）
    roomHost.update(dt, time);

    // 阴影相机跟随玩家（对齐纹素，走动时阴影边缘不抖）
    updateSun(self.x, self.y, self.z);
    skyline.update(dt);
    dressing?.update(time); // 红绿灯相位
    // 居民避让玩家：把自己的位置喂给生活层
    townLife?.update(dt, time, dressing ? trafficPhase(time) : { ew: true, ns: true }, st.joined ? [{ x: self.x, z: self.z }] : []);

    // 调试/截图用自由机位：设了就覆盖本帧相机（不影响玩法逻辑）
    if (freeCam) {
      camera.position.copy(freeCam.pos);
      camera.lookAt(freeCam.target);
    }
    renderer.render(scene, camera);
  }

  tick();

  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener("resize", onResize);

  // 调试钩子（无头验证用）
  (window as unknown as Record<string, unknown>).__world3d = {
    clientWorld,
    scene,
    camera,
    camBoxes,
    propMeshes,
    pointers,
    viewMode: () => viewMode,
    selfPos: () => ({ ...self }),
    camDist: () => camDist,
    camYaw: () => camYaw,
    setCamYaw: (y: number) => {
      camYaw = y;
    },
    setCamDist: (d: number) => {
      camDist = d;
    },
    setCamPitch: (p: number) => {
      camPitch = p;
    },
    /** 当前视线方向（水平分量）与相机右向量——验证转向方向用 */
    viewDir: () => {
      const v = new THREE.Vector3();
      camera.getWorldDirection(v);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      return { x: v.x, z: v.z, rx: right.x, rz: right.z };
    },
    /** 自由机位：pos/target 为世界坐标 [x,y,z]；传 null 恢复玩法相机 */
    freeCam: (pos: [number, number, number] | null, target?: [number, number, number]) => {
      freeCam = pos ? { pos: new THREE.Vector3(...pos), target: new THREE.Vector3(...(target ?? [128, 12, 128])) } : null;
    },
    setFog: (on: boolean) => {
      scene.fog = on ? fog : null;
    },
    /** 渲染统计（draw call / 三角形数），性能预算核对用 */
    renderStats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tier }),
    raycastAt: (sx: number, sy: number) => {
      mouseNDC.x = (sx / container.clientWidth) * 2 - 1;
      mouseNDC.y = -(sy / container.clientHeight) * 2 + 1;
      const r = raycastWorld();
      return r ? { person: r.person ?? null, obj: r.objectId ?? null, ground: r.ground, p: [Math.round(r.point.x * 10) / 10, Math.round(r.point.z * 10) / 10] } : null;
    },
    /** 世界坐标 (x,z) 处地形网格的真实渲染高度（射线垂直下探），诊断悬空用 */
    groundYAt: (x: number, z: number) => {
      if (!terrainMesh) return null;
      raycaster.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
      raycaster.far = 300;
      const hits = raycaster.intersectObject(terrainMesh, false);
      return hits.length ? hits[0].point.y : null;
    },
    teleport: (x: number, z: number, y?: number) => {
      self.x = x;
      self.z = z;
      if (y !== undefined) self.y = y;
      moveTarget = null;
      avoidPoint = null;
      outdoorPath = [];
      outdoorWp = 0;
      stuckFrames = 0;
      roomPath = null;
    },
    walkState: () => ({
      moveTarget: moveTarget ? { x: Math.round(moveTarget.x * 10) / 10, z: Math.round(moveTarget.z * 10) / 10 } : null,
      roomPath: roomPath ? roomPath.length : null,
      approach: approach ? `${approach.kind}:${approach.id}` : null,
      chatOpen: !!document.querySelector(".chatPanel.open"),
      avoidPoint: avoidPoint ? { x: Math.round(avoidPoint.x * 10) / 10, z: Math.round(avoidPoint.z * 10) / 10 } : null,
    }),
    /** 调试：直接指定点击目的地（自动化测试用） */
    setWalkTarget: (x: number, z: number) => {
      setWalkPath(x, z);
    },
    store: useWorld,
    setLandOverlay: (rows: Array<{ plotId: string; ownerId: string; ownerName: string }> | null) => setLandOverlay(rows),
    townStats: () => ({ dressing: dressing?.stats ?? null, life: townLife?.stats ?? null }),
    lifeSample: () => townLife?.sample() ?? null,
  };

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointermove", onPointerMove as never);
      window.removeEventListener("pointerup", onPointerUp as never);
      window.removeEventListener("pointercancel", onPointerUp as never);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      container.innerHTML = "";
      started = false;
    },
    setSpawn(p: { x: number; y: number; z: number }) {
      self.x = p.x;
      self.y = p.y;
      self.z = p.z;
      camTarget.set(p.x, p.y + 1.2, p.z);
      // 出生视角自动面朝「岛外」（远离岛心方向）：办公楼在身后不抢出生画面的镜
      const c = (clientWorld.meta?.size ?? 256) / 2;
      const dx = p.x - c;
      const dz = p.z - c;
      const len = Math.hypot(dx, dz) || 1;
      camYaw = Math.atan2(-dx / len, -dz / len);
      // 初始机位放在玩家身后（跟 camYaw 同向），避免第一帧从别处飘过来
      camCur.set(p.x + Math.sin(camYaw) * 9, p.y + 5.5, p.z + Math.cos(camYaw) * 9);
    },
  };
}
