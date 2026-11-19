// 后台控制台：顶部栏 + 左侧栏 + 主内容区（经典双栏结构）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthUser, GlobalSearchHit } from "@world3d/shared";
import { api, TOKEN_KEY } from "./api";
import { realtime, type AdminEvent } from "./realtime";
import { ToastHost, useToasts } from "./components";
import Overview from "./pages/Overview";
import Users from "./pages/Users";
import Players from "./pages/Players";
import Broadcast from "./pages/Broadcast";
import Chat from "./pages/Chat";
import Objects from "./pages/Objects";
import Projects from "./pages/Projects";
import Attest from "./pages/Attest";
import AuditPage from "./pages/Audit";
import System from "./pages/System";
import "./admin.css";

export type PageId =
  | "overview"
  | "users"
  | "players"
  | "broadcast"
  | "chat"
  | "objects"
  | "projects"
  | "attest"
  | "audit"
  | "system";

interface NavItem {
  id: PageId;
  icon: string;
  label: string;
  group: string;
}

const NAV: NavItem[] = [
  { id: "overview", icon: "📊", label: "实时总览", group: "总览" },
  { id: "users", icon: "👥", label: "用户管理", group: "运营" },
  { id: "players", icon: "🎮", label: "在线玩家", group: "运营" },
  { id: "broadcast", icon: "📢", label: "广播公告", group: "运营" },
  { id: "chat", icon: "💬", label: "聊天记录", group: "运营" },
  { id: "objects", icon: "🏝", label: "世界造物", group: "内容" },
  { id: "projects", icon: "📋", label: "办公室项目", group: "内容" },
  { id: "attest", icon: "🔐", label: "产权存证", group: "内容" },
  { id: "audit", icon: "🛡", label: "审计日志", group: "系统" },
  { id: "system", icon: "⚙️", label: "系统运维", group: "系统" },
];

const GROUP_ORDER = ["总览", "运营", "内容", "系统"];

export default function AdminApp() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [page, setPage] = useState<PageId>("overview");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("adm_collapsed") === "1");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [online, setOnline] = useState(0);
  const [connected, setConnected] = useState(false);
  const { items: toasts, push } = useToasts();

  // 静默恢复登录
  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok && d.user.role === "admin") {
          setToken(t);
          setUser(d.user);
        } else if (d?.ok) {
          setToken(t);
          setUser(d.user);
        }
      })
      .catch(() => {});
  }, []);

  // 实时通道
  useEffect(() => {
    if (!token) return;
    realtime.connect(token);
    const offStats = realtime.onStats((s) => setOnline(s.online));
    const t = setInterval(() => setConnected(realtime.isConnected), 2000);
    setConnected(realtime.isConnected);
    return () => {
      offStats();
      clearInterval(t);
      realtime.disconnect();
    };
  }, [token]);

  useEffect(() => {
    localStorage.setItem("adm_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    realtime.disconnect();
    setToken(null);
    setUser(null);
  };

  if (!token || !user) return <LoginGate onLogin={(t, u) => { setToken(t); setUser(u); }} />;
  if (user.role !== "admin")
    return <LoginGate onLogin={(t, u) => { setToken(t); setUser(u); }} notice={`「${user.name}」不是管理员账号`} />;

  const current = NAV.find((n) => n.id === page)!;

  return (
    <div className={`admShell ${collapsed ? "collapsed" : ""} ${drawerOpen ? "drawer-open" : ""}`}>
      <Topbar
        user={user}
        online={online}
        connected={connected}
        token={token}
        onToggle={() => setCollapsed((c) => !c)}
        onMenu={() => setDrawerOpen((d) => !d)}
        onLogout={logout}
        onNavigate={setPage}
      />
      <Sidebar page={page} onNavigate={setPage} />
      <main className="admContent">
        <div className="admPageHead">
          <div className="admCrumbs">
            小世界后台 <span>/</span> {current.group} <span>/</span> <b>{current.label}</b>
          </div>
          <h1 className="admPageTitle">
            <span className="admPageIcon">{current.icon}</span> {current.label}
          </h1>
        </div>
        <div className="admPageBody">
          {page === "overview" && <Overview token={token} onNavigate={setPage} push={push} />}
          {page === "users" && <Users token={token} push={push} />}
          {page === "players" && <Players token={token} push={push} />}
          {page === "broadcast" && <Broadcast token={token} push={push} />}
          {page === "chat" && <Chat token={token} push={push} />}
          {page === "objects" && <Objects token={token} push={push} />}
          {page === "projects" && <Projects token={token} />}
          {page === "attest" && <Attest token={token} push={push} />}
          {page === "audit" && <AuditPage token={token} />}
          {page === "system" && <System token={token} />}
        </div>
      </main>
      <ToastHost items={toasts} />
    </div>
  );
}

/* ---------- 顶部栏 ---------- */

function Topbar({
  user,
  online,
  connected,
  token,
  onToggle,
  onMenu,
  onLogout,
  onNavigate,
}: {
  user: AuthUser;
  online: number;
  connected: boolean;
  token: string;
  onToggle: () => void;
  onMenu: () => void;
  onLogout: () => void;
  onNavigate: (p: PageId) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  const search = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setHits([]);
        return;
      }
      const d = await api<{ ok: boolean; hits: GlobalSearchHit[] }>(
        `/api/admin/search?q=${encodeURIComponent(text)}`,
        token
      );
      if (d.ok) setHits(d.hits);
    },
    [token]
  );

  const onInput = (v: string) => {
    setQ(v);
    setOpen(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void search(v), 300);
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const grouped = useMemo(() => {
    const g: Record<string, GlobalSearchHit[]> = { user: [], object: [], chat: [] };
    for (const h of hits) g[h.type]?.push(h);
    return g;
  }, [hits]);

  const iconOf = (t: string) => (t === "user" ? "👤" : t === "object" ? "🏝" : "💬");
  const labelOf = (t: string) => (t === "user" ? "用户" : t === "object" ? "造物" : "聊天");

  return (
    <header className="admTopbar">
      <div className="admTopLeft">
        <button className="admIconBtn only-mobile" onClick={onMenu} title="菜单">
          ☰
        </button>
        <button className="admIconBtn only-desktop" onClick={onToggle} title="折叠侧栏">
          ⇤
        </button>
        <div className="admBrand">
          🍰 <span>小世界后台</span>
        </div>
      </div>

      <div className="admSearchBox" ref={boxRef}>
        <span className="admSearchIcon">🔍</span>
        <input
          className="admSearchInput"
          placeholder="全局搜索：用户 / 造物 / 聊天…"
          value={q}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => setOpen(true)}
        />
        {open && hits.length > 0 && (
          <div className="admSearchPanel">
            {(["user", "object", "chat"] as const).map((t) =>
              grouped[t].length ? (
                <div key={t} className="admSearchGroup">
                  <div className="admSearchGroupTitle">{labelOf(t)}</div>
                  {grouped[t].map((h) => (
                    <button
                      key={`${h.type}-${h.id}`}
                      className="admSearchHit"
                      onClick={() => {
                        setOpen(false);
                        setQ("");
                        onNavigate(t === "user" ? "users" : t === "object" ? "objects" : "chat");
                      }}
                    >
                      <span className="admSearchHitIcon">{iconOf(h.type)}</span>
                      <span className="admSearchHitTitle">{h.title}</span>
                      <span className="admSearchHitSub">{h.sub}</span>
                    </button>
                  ))}
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      <div className="admTopRight">
        <div className={`admLive ${connected ? "on" : "off"}`} title={connected ? "实时通道已连接" : "重连中"}>
          <i className="admLiveDot" />
          {connected ? "实时" : "重连中"}
          <b>{online}</b> 在线
        </div>
        <div className="admUserChip">
          <span className="admUserAvatar">👑</span>
          <span className="admUserName">{user.name}</span>
          <div className="admUserMenu">
            <a href="/" target="_blank" rel="noreferrer">
              ↩ 回到小世界
            </a>
            <button onClick={onLogout}>🚪 退出登录</button>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ---------- 侧边栏 ---------- */

function Sidebar({ page, onNavigate }: { page: PageId; onNavigate: (p: PageId) => void }) {
  return (
    <nav className="admSidebar">
      <div className="admSideScroll">
        {GROUP_ORDER.map((g) => (
          <div key={g} className="admSideGroup">
            <div className="admSideGroupTitle">{g}</div>
            {NAV.filter((n) => n.group === g).map((n) => (
              <button
                key={n.id}
                className={`admSideItem ${page === n.id ? "on" : ""}`}
                onClick={() => onNavigate(n.id)}
                title={n.label}
              >
                <span className="admSideIcon">{n.icon}</span>
                <span className="admSideLabel">{n.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="admSideFoot">
        <div className="admSideStatus">
          <div className="admSideStatusRow">
            <span>服务状态</span>
            <b className="ok">● 正常</b>
          </div>
          <div className="admSideStatusRow">
            <span>存证公示</span>
            <b>每 10 分钟</b>
          </div>
        </div>
      </div>
    </nav>
  );
}

/* ---------- 登录门 ---------- */

function LoginGate({ onLogin, notice }: { onLogin: (token: string, user: AuthUser) => void; notice?: string }) {
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState(notice ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setMsg("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password: pass }),
      });
      const d = await res.json();
      if (!d.ok) return setMsg(d.reason || "登录失败");
      if (d.user.role !== "admin") {
        localStorage.setItem(TOKEN_KEY, d.token);
        return setMsg(`「${d.user.name}」不是管理员账号`);
      }
      localStorage.setItem(TOKEN_KEY, d.token);
      onLogin(d.token, d.user);
    } catch {
      setMsg("网络开小差了");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admLoginWrap">
      <div className="admLoginCard">
        <div className="admLoginTitle">🍰 小世界 · 后台管理</div>
        <div className="admLoginSub">仅管理员账号可进入</div>
        <input
          className="admInput"
          placeholder="管理员账号"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input
          className="admInput"
          type="password"
          placeholder="密码"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        {msg && <div className="admMsg">{msg}</div>}
        <button className="admPrimaryBtn" disabled={busy} onClick={() => void submit()}>
          {busy ? "请稍候…" : "进入后台"}
        </button>
        <a className="admBackLink" href="/">
          ← 回到小世界
        </a>
      </div>
    </div>
  );
}
