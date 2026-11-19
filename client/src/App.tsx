import { useEffect, useRef, useState } from "react";
import { useWorld } from "./state/store";
import { startGame, GameHandle } from "./engine/game";
import { connect, join, sendChat, sendAiBuild, sendRoomSay } from "./net/socket";
import { ChatMessage } from "@world3d/shared";
import { Hotbar } from "./ui/Hotbar";
import { OfficePanel } from "./ui/OfficePanel";
import { roomHost } from "./engine/roomHost";

function Toaster() {
  const toasts = useWorld((s) => s.toasts);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 800);
    return () => clearInterval(t);
  }, []);
  const live = toasts.filter((t) => Date.now() - t.id < 3600);
  return (
    <div className="toasts">
      {live.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

function ChatPanel({ onClose, isTouch }: { onClose?: () => void; isTouch?: boolean }) {
  const chat = useWorld((s) => s.chat);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.length]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    const st = useWorld.getState();
    if (st.inRoom) {
      // 站在谁身边就是跟谁说话（不用先按 E）；不在身边才回落到 45s 内聊过的人
      const near = st.nearAgent;
      const partner = st.lastTalkAgent;
      const agentId = near?.id ?? (partner && partner.until > Date.now() ? partner.id : undefined);
      sendRoomSay(t, agentId);
      if (agentId) st.setLastTalkAgent({ id: agentId, until: Date.now() + 45_000 });
      // 房间发言没有 chat 服务器回声——本地立刻回显，话不能凭空消失
      st.pushChat({ id: `local-${Date.now()}`, kind: "player", from: st.selfName || "我", fromId: st.selfId, text: t.slice(0, 120), ts: Date.now() });
    } else if (/种|盖|建|修|铺|挖|清空|围栏|栅栏|帮助|help/i.test(t)) {
      sendAiBuild(t);
    } else {
      sendChat(t);
    }
    setText("");
  };

  return (
    <div className={`chatPanel ${isTouch ? "open" : ""}`}>
      {isTouch && (
        <div className="chatHead" onClick={onClose} title="收起聊天">
          <span>💬 聊天 / AI 施工队</span>
          <span className="chatClose">收起 ▾</span>
        </div>
      )}
      <div className="chatList" ref={listRef}>
        {chat.map((m: ChatMessage) => (
          <div key={m.id} className={`chatRow kind-${m.kind}`}>
            {m.kind !== "system" && (
              <span className="chatFrom" style={m.kind === "player" ? {} : { color: "#7a6adf" }}>
                {m.from}：
              </span>
            )}
            <span className="chatText">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chatInputRow">
        <input
          className="chatInput"
          placeholder="聊天，或对 AI 施工队说「种一排樱花树」…"
          value={text}
          maxLength={80}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
            e.stopPropagation();
          }}
        />
        <button className="chatSend" onClick={send}>
          ➤
        </button>
      </div>
    </div>
  );
}

function TopBar() {
  const players = useWorld((s) => s.players);
  const connected = useWorld((s) => s.connected);
  const tier = useWorld((s) => s.tier);
  const showOwnerLabels = useWorld((s) => s.showOwnerLabels);
  const toggleOwnerLabels = useWorld((s) => s.toggleOwnerLabels);
  const setTier = useWorld((s) => s.setTier);
  const viewMode = useWorld((s) => s.viewMode);
  const toggleView = useWorld((s) => s.toggleView);
  const TIER_LABEL = { low: "流畅", mid: "均衡", high: "高清" } as const;

  return (
    <div className="topBar">
      <div className="brand">🌍 小世界 <span className="sub">world3d</span></div>
      <div className={`connPill ${connected ? "on" : "off"}`}>{connected ? "● 已连接" : "○ 连接中"}</div>
      <div className="playersPill">👥 {players.length + 1}</div>
      <button className={`toggleBtn ${showOwnerLabels ? "on" : ""}`} onClick={toggleOwnerLabels} title="显示每个造物的创建者">
        ✍️ 产权标注
      </button>
      <button className="toggleBtn" onClick={toggleView} title="切换第一/第三人称（快捷键 V）">
        {viewMode === "third" ? "👁 第一人称" : "🎥 第三人称"}
      </button>
      <div className="qualitySel">
        画质：
        {(["low", "mid", "high"] as const).map((t) => (
          <button key={t} className={`qBtn ${tier === t ? "on" : ""}`} onClick={() => setTier(t)}>
            {TIER_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const joined = useWorld((s) => s.joined);
  const viewMode = useWorld((s) => s.viewMode);
  const toggleView = useWorld((s) => s.toggleView);
  const inRoom = useWorld((s) => s.inRoom);
  const roomPrompt = useWorld((s) => s.roomPrompt);
  const nearAgent = useWorld((s) => s.nearAgent);
  const isTouch = typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window || (typeof matchMedia !== "undefined" && (matchMedia("(pointer: coarse)").matches || matchMedia("(any-pointer: coarse)").matches)));
  const [chatOpen, setChatOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameHandle | null>(null);

  useEffect(() => {
    connect();
  }, []);

  const handleJoin = (name: string) => {
    // 先同步启动引擎，再 join（ack 回调里需要句柄设置出生点）
    if (containerRef.current && !gameRef.current) {
      gameRef.current = startGame(containerRef.current);
    }
    join(name, (h) => {
      gameRef.current?.setSpawn({ x: h.self.x, y: h.self.y, z: h.self.z });
    });
  };

  return (
    <div className="app">
      <div ref={containerRef} className="canvasHost" />
      {!joined && <JoinDialog onJoin={handleJoin} />}
      {joined && (
        <div className="ui">
          <TopBar />
          {(!isTouch || chatOpen) && <ChatPanel isTouch={isTouch} onClose={() => setChatOpen(false)} />}
          {isTouch && chatOpen && (
            <div className="chatBackdrop" onClick={() => setChatOpen(false)} />
          )}
          {isTouch && !chatOpen && (
            <button className="chatFab" onClick={() => setChatOpen(true)} title="聊天 / AI 施工队">
              💬
            </button>
          )}
          {isTouch && (
            <button className="viewFab" onClick={toggleView} title="切换第一/第三人称">
              {viewMode === "third" ? "👁" : "🎥"}
            </button>
          )}
          <Hotbar />
          <OfficePanel />
          {roomPrompt && (
            <button className="doorBtn" onClick={() => roomHost.doorAction()}>
              {roomPrompt === "enter" ? "🚪 进入办公室（E）" : "🚪 离开办公室（E）"}
            </button>
          )}
          {!roomPrompt && nearAgent && (
            <button className="doorBtn talkBtn" onClick={() => roomHost.talkToNearby()}>
              💬 和 {nearAgent.name} 聊聊（E）
            </button>
          )}
          <Toaster />
          <div className="hint">
            {inRoom
              ? "点击地面行走 · 点 📋 派项目（E）· 走到门口离开 · 聊天框说话=老板发言"
              : isTouch
                ? "点击地面行走 · 选中道具后点地放置 · 长按拆除 · 单指拖动转视角 · 双指缩放"
                : "点击地面行走 · 选道具（2-7）点地放置 · 右键拆除 · 拖拽转视角 · V 切换视角"}
          </div>
        </div>
      )}
    </div>
  );
}

function JoinDialog({ onJoin }: { onJoin: (name: string) => void }) {
  const [name, setName] = useState("");
  const rand = () => `旅人_${Math.floor(Math.random() * 900 + 100)}`;
  return (
    <div className="joinOverlay">
      <div className="joinCard">
        <div className="joinTitle">🌸 欢迎来到小世界</div>
        <div className="joinSub">多人共享的唯美小岛 —— 用 AI 种树盖房造园</div>
        <input
          className="joinInput"
          placeholder={rand()}
          value={name}
          maxLength={12}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onJoin(name.trim() || rand());
          }}
          autoFocus
        />
        <button className="joinBtn" onClick={() => onJoin(name.trim() || rand())}>
          进入世界 →
        </button>
        <div className="joinTips">
          电脑：点击地面行走 · 选道具点地放置 · 走进办公楼逛逛<br />
          手机：点击地面行走 · 选中道具点地放置 · 💬 聊天
        </div>
      </div>
    </div>
  );
}
