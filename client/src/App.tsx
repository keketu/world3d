import { useEffect, useRef, useState } from "react";
import { useWorld } from "./state/store";
import { startGame, GameHandle } from "./engine/game";
import { connect, join, sendChat, sendAiBuild } from "./net/socket";
import { ChatMessage } from "@world3d/shared";
import { Hotbar } from "./ui/Hotbar";

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
    if (/种|盖|建|修|铺|挖|清空|围栏|栅栏|帮助|help/i.test(t)) {
      sendAiBuild(t);
    } else {
      sendChat(t);
    }
    setText("");
  };

  return (
    <div className={`chatPanel ${isTouch ? "open" : ""}`}>
      {isTouch && (
        <button className="chatClose" onClick={onClose} title="收起">
          ✕
        </button>
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
  const TIER_LABEL = { low: "流畅", mid: "均衡", high: "高清" } as const;

  return (
    <div className="topBar">
      <div className="brand">🌍 小世界 <span className="sub">world3d</span></div>
      <div className={`connPill ${connected ? "on" : "off"}`}>{connected ? "● 已连接" : "○ 连接中"}</div>
      <div className="playersPill">👥 {players.length + 1}</div>
      <button className={`toggleBtn ${showOwnerLabels ? "on" : ""}`} onClick={toggleOwnerLabels} title="显示每个造物的创建者">
        ✍️ 产权标注
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
  const isTouch = typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 || (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches));
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
          {isTouch && (
            <button className="chatFab" onClick={() => setChatOpen((o) => !o)} title="聊天 / AI 施工队">
              💬
            </button>
          )}
          <Hotbar />
          <Toaster />
          <div className="hint">
            {isTouch
              ? "左下摇杆走动 · 点地面放置 · 长按拆除 · 右侧滑动转视角 · 双指缩放"
              : "WASD 走动 · 拖拽转视角 · 选下方道具左键放置 · 右键拆除自己的造物 · 对聊天框说「种一排樱花树」"}
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
        <div className="joinTitle">🌍 欢迎来到小世界</div>
        <div className="joinSub">多人共享的唯美小世界 —— 用 AI 种树、盖房、造园</div>
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
          电脑：WASD 走动 · 选道具左键点地面放置<br />
          手机：左侧摇杆走动 · 点地面放置 · 💬 展开聊天
        </div>
      </div>
    </div>
  );
}
