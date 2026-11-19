// 游戏引擎：低模世界渲染循环、本地玩家、道具交互、标签系统、远端玩家
import * as THREE from "three";
import { HOTBAR_PROPS, PlayerInfo, WorldObject, WATER_LEVEL } from "@world3d/shared";
import { clientWorld } from "./world";
import { buildTerrain, buildWater } from "./terrain";
import { buildProp } from "./props";
import { createAvatar, animateAvatar, Avatar } from "../scene/avatar";
import { useWorld } from "../state/store";
import { qualityFor, applyQuality, detectTier } from "./quality";
import { sendMove } from "../net/socket";
import { roomHost } from "./roomHost";
import { findPath } from "../scene/office/nav";

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
  const q = qualityFor(tier);

  // ---------- 三件套 ----------
  const scene = new THREE.Scene();
  // 渐变天空（屏幕空间垂直渐变：天顶浅蓝 → 地平线暖雾白）
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
  const HORIZON = new THREE.Color("#e2f0ea");
  const fog = new THREE.Fog(HORIZON, q.fogFar * 0.68, q.fogFar);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: tier !== "low" });
  applyQuality(tier, renderer, fog);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xe8f5ff, 0xa8c48a, 1.0));
  const sun = new THREE.DirectionalLight(0xfff0da, 1.1);
  sun.position.set(60, 90, 30);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.28));

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
    if (!waterMesh) {
      waterMesh = buildWater(size, WATER_LEVEL);
      scene.add(waterMesh);
    }
  }
  clientWorld.onModsChanged = rebuildTerrain;
  // hello 到达后：建地形 + 生成已有造物（无动画）
  clientWorld.onHello = () => {
    rebuildTerrain();
    for (const o of clientWorld.objects.values()) spawnProp(o, false);
  };

  // ---------- 道具管理 ----------
  const propMeshes = new Map<string, { mesh: THREE.Object3D; labelY: number; creator: string; variant: string; kind: string }>();
  const popAnims = new Map<string, number>();
  const propGroup = new THREE.Group();
  scene.add(propGroup);

  function spawnProp(o: WorldObject, animate: boolean) {
    const { mesh, labelY } = buildProp(o);
    const y = clientWorld.heightAt(o.x, o.z);
    mesh.position.set(o.x, y, o.z);
    mesh.rotation.y = o.rotY;
    mesh.scale.setScalar(animate ? 0.01 : o.scale || 1);
    propGroup.add(mesh);
    propMeshes.set(o.id, { mesh, labelY, creator: o.creatorName, variant: o.variant, kind: o.kind });
    if (animate) popAnims.set(o.id, 0);
    // 办公楼：计算门口世界坐标（进门触发点）
    if (o.kind === "office") {
      const doorDist = Number(o.params?.doorDist ?? 4.6);
      roomHost.setDoorWorld(o.x + Math.sin(o.rotY) * doorDist, o.z + Math.cos(o.rotY) * doorDist);
    }
  }

  clientWorld.onObjectAdded = (o, animate) => spawnProp(o, animate);
  clientWorld.onObjectRemoved = (id) => {
    const pm = propMeshes.get(id);
    if (pm) {
      propGroup.remove(pm.mesh);
      propMeshes.delete(id);
    }
  };

  // ---------- 本地玩家 ----------
  let self: { x: number; y: number; z: number; rotY: number; anim: "idle" | "walk" } = {
    x: 128.5, y: 14, z: 128.5, rotY: 0, anim: "idle",
  };
  const selfAvatar = createAvatar("self", "#5b8def");
  scene.add(selfAvatar.group);

  // ---------- 相机 ----------
  let camYaw = Math.PI * 0.3;
  let camPitch = 0.72;
  let camDist = 13;
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
  const dom = renderer.domElement;

  // ---------- 点击行走 ----------
  let moveTarget: { x: number; z: number } | null = null; // 户外：直线走向目标点
  let roomPath: Array<{ x: number; z: number }> | null = null; // 房间：A* 路径
  let roomWp = 1; // 下一个路径点索引（0 是起点）

  function setPlayerPath(x: number, z: number) {
    if (roomHost.active) {
      roomPath = findPath(self.x, self.z, x, z);
      roomWp = 1;
      moveTarget = null;
    } else {
      moveTarget = { x, z };
      roomPath = null;
    }
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
            if (viewMode === "first") {
              // 第一人称：捏合变焦（FOV）
              camera.fov = Math.max(42, Math.min(80, camera.fov + (d - lastPinch) * 0.12));
              camera.updateProjectionMatrix();
            } else {
              camDist = Math.max(5, Math.min(30, camDist - (d - lastPinch) * 0.06));
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
      // 鼠标左右转视角：灵敏度可调（1 = 默认）
      const sens = useWorld.getState().settings.mouseSensitivity;
      camYaw -= dx * 0.0052 * sens;
      // 俯仰钳制：第一人称可略仰视；房间内保持俯视区间（不穿墙）
      const [pMin, pMax] =
        viewMode === "first" ? [-0.55, 1.35] : roomHost.active ? [0.55, 1.45] : [0.15, 1.45];
      camPitch = Math.max(pMin, Math.min(pMax, camPitch + dy * 0.0042 * sens));
    }
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
      if (p.button === 2) removeAction();
      else if (roomHost.active) {
        // 房间内：点击 = 行走（A* 自动绕开桌椅）
        if (hoverTarget) setPlayerPath(hoverTarget.point.x, hoverTarget.point.z);
      } else {
        const sel = HOTBAR_PROPS[useWorld.getState().hotbarIndex];
        if (sel && sel.kind === "hand") {
          // 空手：点击地面行走
          if (hoverTarget) moveTarget = { x: hoverTarget.point.x, z: hoverTarget.point.z };
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

  const onWheel = (e: WheelEvent) => {
    if (viewMode === "first") {
      // 第一人称：滚轮变焦（FOV）
      camera.fov = Math.max(42, Math.min(80, camera.fov + Math.sign(e.deltaY) * 4));
      camera.updateProjectionMatrix();
    } else {
      camDist = Math.max(5, Math.min(30, camDist + Math.sign(e.deltaY) * 1.5));
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
  dom.addEventListener("wheel", onWheel, { passive: true });
  dom.addEventListener("contextmenu", onContext);

  // ---------- 射线：地形 + 道具 ----------
  const raycaster = new THREE.Raycaster();

  interface HitResult {
    ground: boolean;
    point: THREE.Vector3;
    objectId?: string;
  }

  function raycastWorld(): HitResult | null {
    // 房间模式：射线只打房间实体（户外地形在房间区域的高度不可用）
    if (roomHost.active && roomHost.solidMesh) {
      raycaster.setFromCamera(mouseNDC, camera);
      raycaster.far = 60;
      const hits = raycaster.intersectObject(roomHost.solidMesh, false);
      if (hits[0]) return { ground: true, point: hits[0].point };
      return null;
    }
    raycaster.setFromCamera(mouseNDC, camera);
    raycaster.far = 32;
    const propMeshList: THREE.Object3D[] = [];
    for (const [, pm] of propMeshes) if (pm.mesh.visible) propMeshList.push(pm.mesh);
    const propHits = raycaster.intersectObjects(propMeshList, false);
    const groundHits = terrainMesh ? raycaster.intersectObject(terrainMesh, false) : [];
    const groundHit = groundHits[0];
    const propHit = propHits[0];
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

  // ---------- 标签系统 ----------
  const labelLayer = document.createElement("div");
  labelLayer.className = "labelLayer";
  container.appendChild(labelLayer);
  const labels = new Map<string, { el: HTMLDivElement; wx: number; wy: number; wz: number; maxDist: number }>();

  function setLabel(id: string, html: string, wx: number, wy: number, wz: number, cls = "", maxDist = 42) {
    let l = labels.get(id);
    if (!l) {
      const el = document.createElement("div");
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
    av.group.position.set(p.x, p.y, p.z);
    scene.add(av.group);
    clientWorld.remotes.set(p.id, {
      group: av,
      target: { x: p.x, y: p.y, z: p.z, rotY: p.rotY },
      info: p,
    });
    setLabel(`tag-${p.id}`, p.name, p.x, p.y + 1.4, p.z, "nameTag");
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
  const camTarget = new THREE.Vector3(128.5, 14, 128.5);
  const camCur = new THREE.Vector3(140, 26, 142);

  function tick() {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.06);
    const time = clock.elapsedTime;
    const st = useWorld.getState();

    // 1. 本地移动（点击行走：户外直线+滑动避障，房间 A* 路径）
    if (st.joined) {
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
        const dx = moveTarget.x - self.x;
        const dz = moveTarget.z - self.z;
        const dist = Math.hypot(dx, dz);
        const step = SPEED * dt;
        if (dist <= step) {
          self.x = moveTarget.x;
          self.z = moveTarget.z;
          moveTarget = null;
          moving = true;
        } else {
          const nx = self.x + (dx / dist) * step;
          const nz = self.z + (dz / dist) * step;
          const stuckOut = clientWorld.blockedAt(self.x, self.z);
          const mx = stuckOut || !clientWorld.blockedAt(nx, self.z);
          const mz = stuckOut || !clientWorld.blockedAt(self.x, nz);
          if (mx) self.x = nx;
          if (mz) self.z = nz;
          if (!mx && !mz) moveTarget = null; // 撞死角就停下
          moving = mx || mz;
          self.rotY = Math.atan2(dx, dz);
          const ty = clientWorld.surfaceY(self.x, self.z);
          self.y += (ty - self.y) * Math.min(1, dt * 12);
        }
      }

      // ---------- 键盘移动（WASD / 方向键） ----------
      // 优先级高于点击行走：按住键时接管方向，松键后停止
      const st = useWorld.getState();
      if (st.settings.keyboardMove && keysDown.size > 0) {
        // 输入方向（屏幕空间）：W=前 S=后 A=左 D=右
        let ix = 0;
        let iz = 0;
        if (keysDown.has("KeyW") || keysDown.has("ArrowUp")) iz -= 1;
        if (keysDown.has("KeyS") || keysDown.has("ArrowDown")) iz += 1;
        if (keysDown.has("KeyA") || keysDown.has("ArrowLeft")) ix -= 1;
        if (keysDown.has("KeyD") || keysDown.has("ArrowRight")) ix += 1;
        if (ix !== 0 || iz !== 0) {
          moveTarget = null; // 键盘接管，取消点击目标
          roomPath = null; // 房内也放弃 A* 路径
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
          // 碰撞：户外用地形碰撞，房内用房间障碍
          const blocked = roomHost.active
            ? roomHost.movementBlocked(nx, nz)
            : clientWorld.blockedAt(nx, nz);
          const blockedHere = roomHost.active
            ? roomHost.movementBlocked(self.x, self.z)
            : clientWorld.blockedAt(self.x, self.z);
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
              : !clientWorld.blockedAt(nx, self.z);
            const okZ = roomHost.active
              ? !roomHost.movementBlocked(self.x, nz)
              : !clientWorld.blockedAt(self.x, nz);
            if (okX) self.x = nx;
            if (okZ) self.z = nz;
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
      self.anim = moving ? "walk" : "idle";

      moveTimer += dt;
      if (moveTimer >= 0.1) {
        moveTimer = 0;
        sendMove({ x: self.x, y: self.y, z: self.z, rotY: self.rotY, anim: self.anim });
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
      } else {
        const s = 1 - Math.pow(1 - t, 3);
        pm.mesh.scale.setScalar(s);
        pm.mesh.position.y = clientWorld.heightAt(pm.mesh.position.x, pm.mesh.position.z) + (1 - s) * 0.6;
      }
    }

    // 3. 自身 avatar
    selfAvatar.group.position.set(self.x, self.y, self.z);
    selfAvatar.group.rotation.y = self.rotY;
    animateAvatar(selfAvatar, self.anim, time);
    setLabel("tag-self", st.selfName || "我", self.x, self.y + 1.4, self.z, "nameTag self");

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
      animateAvatar(av, dist > 0.1 ? "walk" : (r.info.anim === "walk" ? "walk" : "idle"), time);
      setLabel(`tag-${r.info.id}`, r.info.name, g.position.x, g.position.y + 1.4, g.position.z, "nameTag");
    }

    // 5. 水面轻微波动
    if (waterMesh) waterMesh.position.y = WATER_LEVEL + Math.sin(time * 1.4) * 0.06;

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
      if (st.roomPrompt !== prompt) st.setRoomPrompt(prompt);
    }
    camTarget.set(self.x, self.y + 1.2, self.z);
    if (viewMode === "first") {
      const cp = Math.cos(camPitch);
      camera.position.set(self.x, self.y + 1.5, self.z);
      camera.lookAt(
        self.x + Math.sin(camYaw) * cp,
        self.y + 1.5 - Math.sin(camPitch),
        self.z - Math.cos(camYaw) * cp
      );
    } else {
      const [dMin, dMax] = roomHost.cameraDistRange();
      const effDist = Math.max(dMin, Math.min(dMax, camDist));
      const camOff = new THREE.Vector3(
        Math.sin(camYaw) * Math.cos(camPitch),
        Math.sin(camPitch) + 0.22,
        Math.cos(camYaw) * Math.cos(camPitch)
      ).multiplyScalar(effDist);
      const desired = camTarget.clone().add(camOff);
      if (!roomHost.active) {
        // 户外：相机不钻地；房间内地面 y=0，不适用地形钳制
        const groundY = clientWorld.surfaceY(desired.x, desired.z) + 0.8;
        desired.y = Math.max(desired.y, groundY);
      }
      camCur.lerp(desired, Math.min(1, dt * 8));
      camera.position.copy(camCur);
      camera.lookAt(camTarget);
    }
    selfAvatar.group.visible = viewMode === "third";

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
        if (pm.kind === "path") continue;
        const o = clientWorld.objects.get(objId);
        const icon = pm.kind === "tree" ? "🌳" : pm.kind === "flower" ? "🌼" : pm.kind === "house" ? "🏠" : pm.kind === "pond" ? "💧" : "🪵";
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
    propMeshes,
    pointers,
    viewMode: () => viewMode,
    selfPos: () => ({ ...self }),
    teleport: (x: number, z: number, y?: number) => {
      self.x = x;
      self.z = z;
      if (y !== undefined) self.y = y;
      moveTarget = null;
      roomPath = null;
    },
    store: useWorld,
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
      camCur.set(p.x + 10, p.y + 15, p.z + 12);
    },
  };
}
