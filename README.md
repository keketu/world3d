# 🌍 小世界 · world3d

一个多人共享的唯美低多边形 3D 小世界：走动、种树、盖房、挖池塘，对 **AI 施工队**说一句话就能建造，每件造物都登记创建者（产权溯源）。

## 玩法

- `WASD` 走动 · 拖拽转视角 · 滚轮缩放
- 下方道具条选择 → 左键点地面放置 · 右键拆除**自己的**造物
- 聊天框对 **AI 施工队** 说：
  - 「在我附近种3棵樱花树」「种一圈松树」
  - 「盖一座小木屋」「盖一个7x6石屋」
  - 「种一片粉色花丛」「铺一条10格石板路」「修一圈围栏」「挖一个池塘」
- 顶栏「✍️ 产权标注」：显示每件造物的创建者

## 本地开发

```bash
npm install
npm run dev        # server:8788 + client:5174（热更新）
```

## 生产部署

```bash
npm install
npm run build      # 构建前端到 client/dist
npm start          # 单进程：Node 服务 + 托管前端（默认 8788，可用 PORT 环境变量覆盖）
```

### 部署到 Render（免费，推荐）

1. 把本仓库推到 GitHub
2. [render.com](https://render.com) → New → Web Service → 连接该仓库
3. 配置：
   - Build Command：`npm install && npm run build`
   - Start Command：`npm start`
4. 部署完成获得 `https://xxx.onrender.com`，手机/任意电脑打开即玩

> 免费档注意：闲置 15 分钟会休眠（首次访问冷启动约 1 分钟）；SQLite 数据在重新部署时会重置（重要存档后续可换 Postgres/挂载磁盘）。

## 架构

```
client (Vite + three.js 原生渲染 + React UI)
   │ socket.io
server (Node：世界状态/多人同步/AI 建造/SQLite 持久化)
   │
shared (地图坐标/协议/道具目录，两端共享 TS 源码)
```

- 地形：确定性噪声高度图（服务端权威）+ 雕塑增量
- 多人：10Hz 快照 + 兴趣半径 48m
- 建造模型：道具放置 + 地形雕塑（非体素），每件造物 = 一条 object 记录（creatorId 溯源）
- AI 建造：模板 NLU（`server/src/engine/nlu.ts`），`BuilderBrain` 接口预留 LLM 接入
