// 后台管理系统（/admin）：登录门 + 六页（看板/用户/造物/聊天/项目/存证）
// 纯 React + fetch，复用奶油和果子设计语言（admin.css）
import { useCallback, useEffect, useRef, useState } from "react";
import "./admin.css";
import type { AdminStats, AdminUserRow, AuthUser, ProjectInfo, TaskInfo, WorldObject } from "@world3d/shared";

const TOKEN_KEY = "w3d_token";

interface ChatLog {
  id: number;
  ts: number;
  kind: string;
  from: string;
  fromId: string;
  text: string;
}

interface AttestRoot {
  root: string;
  count: number;
  createdAt: number;
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  return (await res.json()) as T;
}

const fmt = (ts: number | null | undefined) => (ts ? new Date(ts).toLocaleString("zh-CN", { hour12: false }) : "—");

export default function AdminApp() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

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
          setUser(d.user); // 登录了但不是 admin，登录门会提示
        }
      })
      .catch(() => {});
  }, []);

  if (!token || !user) return <LoginGate onLogin={(t, u) => { setToken(t); setUser(u); }} />;
  if (user.role !== "admin") return <LoginGate onLogin={(t, u) => { setToken(t); setUser(u); }} notice={`「${user.name}」不是管理员账号`} />;

  return <Dashboard token={token} user={user} onLogout={() => { setToken(null); setUser(null); }} />;
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
        <input className="admInput" placeholder="管理员账号" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
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

/* ---------- 主面板 ---------- */

type Tab = "stats" | "users" | "objects" | "chat" | "projects" | "attest";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "stats", label: "📊 看板" },
  { id: "users", label: "👥 用户" },
  { id: "objects", label: "🏝 造物" },
  { id: "chat", label: "💬 聊天记录" },
  { id: "projects", label: "📋 项目" },
  { id: "attest", label: "🔐 存证" },
];

function Dashboard({ token, user, onLogout }: { token: string; user: AuthUser; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("stats");
  return (
    <div className="admRoot">
      <header className="admHead">
        <div className="admBrand">🍰 小世界后台</div>
        <div className="admHeadRight">
          <span className="admWho">👑 {user.name}</span>
          <button className="admGhostBtn" onClick={() => (window.location.href = "/")}>
            回小世界
          </button>
          <button
            className="admGhostBtn"
            onClick={() => {
              localStorage.removeItem(TOKEN_KEY);
              onLogout();
            }}
          >
            退出
          </button>
        </div>
      </header>
      <nav className="admTabs">
        {TABS.map((t) => (
          <button key={t.id} className={`admTab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="admBody">
        {tab === "stats" && <StatsTab token={token} />}
        {tab === "users" && <UsersTab token={token} />}
        {tab === "objects" && <ObjectsTab token={token} />}
        {tab === "chat" && <ChatTab token={token} />}
        {tab === "projects" && <ProjectsTab token={token} />}
        {tab === "attest" && <AttestTab token={token} />}
      </main>
    </div>
  );
}

/* ---------- 看板 ---------- */

function StatsTab({ token }: { token: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const load = useCallback(() => {
    api<{ ok: boolean; stats: AdminStats }>("/api/admin/stats", token).then((d) => d.ok && setStats(d.stats));
  }, [token]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);
  if (!stats) return <div className="admEmpty">加载中…</div>;
  const cards = [
    { label: "注册用户", value: stats.users, sub: `今日 +${stats.todayNewUsers}` },
    { label: "当前在线", value: stats.online, sub: "含游客" },
    { label: "世界造物", value: stats.objects, sub: "全部已存证签名" },
    { label: "办公室项目", value: stats.projects, sub: "累计" },
  ];
  return (
    <>
      <div className="admStatGrid">
        {cards.map((c) => (
          <div key={c.label} className="admStatCard">
            <div className="admStatLabel">{c.label}</div>
            <div className="admStatValue">{c.value}</div>
            <div className="admStatSub">{c.sub}</div>
          </div>
        ))}
      </div>
      {stats.latestRoot && (
        <div className="admRootCard">
          <b>🔐 最新公示存证根</b>
          <code className="admHash">{stats.latestRoot.root}</code>
          <span className="admStatSub">
            覆盖 {stats.latestRoot.count} 件造物 · {fmt(stats.latestRoot.createdAt)}
          </span>
        </div>
      )}
    </>
  );
}

/* ---------- 用户 ---------- */

function UsersTab({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const load = useCallback(() => {
    api<{ ok: boolean; users: AdminUserRow[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`, token).then(
      (d) => d.ok && setUsers(d.users)
    );
  }, [token, q]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (path: string, body: object) => {
    const d = await api<{ ok: boolean; reason?: string }>(path, token, { method: "POST", body: JSON.stringify(body) });
    if (!d.ok) alert(d.reason || "操作失败");
    load();
  };

  return (
    <>
      <div className="admToolbar">
        <input className="admInput" placeholder="搜索用户名…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <table className="admTable">
        <thead>
          <tr>
            <th>用户</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>最近登录</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.banned ? "banned" : ""}>
              <td>
                <b>{u.name}</b>
                {u.online && <span className="admOnlineDot" title="在线" />}
                <div className="admId">{u.id}</div>
              </td>
              <td>{u.role === "admin" ? "👑 管理员" : "玩家"}</td>
              <td>{u.banned ? "🚫 已封禁" : "✅ 正常"}</td>
              <td>{fmt(u.createdAt)}</td>
              <td>{fmt(u.lastLoginAt)}</td>
              <td className="admOps">
                <button className="admMiniBtn" onClick={() => void act(`/api/admin/user/${u.id}/ban`, { banned: !u.banned })}>
                  {u.banned ? "解封" : "封禁"}
                </button>
                <button
                  className="admMiniBtn"
                  onClick={() => void act(`/api/admin/user/${u.id}/role`, { role: u.role === "admin" ? "user" : "admin" })}
                >
                  {u.role === "admin" ? "降为玩家" : "设为管理员"}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="admEmpty">
                没有匹配的用户
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

/* ---------- 造物 ---------- */

function ObjectsTab({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<WorldObject[]>([]);
  const load = useCallback(() => {
    api<{ ok: boolean; objects: WorldObject[] }>(`/api/admin/objects?q=${encodeURIComponent(q)}`, token).then(
      (d) => d.ok && setList(d.objects)
    );
  }, [token, q]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const del = async (id: string) => {
    if (!confirm("确定删除这件造物？（会广播下线，存证同步移除）")) return;
    const d = await api<{ ok: boolean; reason?: string }>(`/api/admin/object/${id}`, token, { method: "DELETE" });
    if (!d.ok) alert(d.reason || "删除失败");
    load();
  };

  return (
    <>
      <div className="admToolbar">
        <input className="admInput" placeholder="按创建者 / 类型搜索…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="admCount">共 {list.length} 件</span>
      </div>
      <table className="admTable">
        <thead>
          <tr>
            <th>类型</th>
            <th>创建者</th>
            <th>坐标</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((o) => (
            <tr key={o.id}>
              <td>
                <b>{o.kind}</b> {o.variant && <span className="admVariant">{o.variant}</span>}
              </td>
              <td>{o.creatorName}</td>
              <td>
                ({Math.round(o.x)}, {Math.round(o.z)})
              </td>
              <td>{fmt(o.createdAt)}</td>
              <td>
                <button className="admMiniBtn danger" onClick={() => void del(o.id)}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* ---------- 聊天记录 ---------- */

function ChatTab({ token }: { token: string }) {
  const [logs, setLogs] = useState<ChatLog[]>([]);
  const oldestId = useRef<number | null>(null);
  const load = useCallback(
    async (before?: number) => {
      const d = await api<{ ok: boolean; logs: ChatLog[] }>(
        `/api/admin/chatlog?limit=50${before ? `&before=${before}` : ""}`,
        token
      );
      if (!d.ok) return;
      if (before) setLogs((prev) => [...d.logs, ...prev]);
      else setLogs(d.logs);
      oldestId.current = d.logs[0]?.id ?? null;
    },
    [token]
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="admToolbar">
        <span className="admCount">最新 50 条（玩家发言 / 系统事件）</span>
        {oldestId.current !== null && (
          <button className="admMiniBtn" onClick={() => void load(oldestId.current!)}>
            加载更早
          </button>
        )}
      </div>
      <div className="admChatList">
        {logs.map((l) => (
          <div key={l.id} className={`admChatRow kind-${l.kind}`}>
            <span className="admChatTs">{fmt(l.ts)}</span>
            <span className={`admChatFrom kind-${l.kind}`}>{l.kind === "system" ? "系统" : l.from}</span>
            <span className="admChatText">{l.text}</span>
          </div>
        ))}
        {logs.length === 0 && <div className="admEmpty">还没有聊天记录</div>}
      </div>
    </>
  );
}

/* ---------- 项目 ---------- */

function ProjectsTab({ token }: { token: string }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  useEffect(() => {
    api<{ ok: boolean; projects: ProjectInfo[]; tasks: TaskInfo[] }>("/api/admin/projects", token).then((d) => {
      if (d.ok) {
        setProjects([...d.projects].reverse());
        setTasks(d.tasks);
      }
    });
  }, [token]);

  return (
    <div className="admProjList">
      {projects.map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id);
        const done = pt.filter((t) => t.status === "done").length;
        return (
          <div key={p.id} className="admProjCard">
            <div className="admProjHead">
              <b>{p.name}</b>
              <span className={`admProjStatus st-${p.status}`}>{p.status}</span>
            </div>
            <div className="admProjBrief">{p.brief}</div>
            <div className="admTaskList">
              {pt.map((t) => (
                <div key={t.id} className="admTask">
                  <span>{t.status === "done" ? "✅" : t.status === "in_progress" ? "🔨" : "⏳"}</span>
                  <span className="admTaskTitle">{t.title}</span>
                  <span className="admTaskWho">→ {t.assigneeId ?? "未派"}</span>
                </div>
              ))}
            </div>
            <div className="admProjFoot">
              {fmt(p.createdAt)} · 任务 {done}/{pt.length}
            </div>
          </div>
        );
      })}
      {projects.length === 0 && <div className="admEmpty">还没有项目</div>}
    </div>
  );
}

/* ---------- 存证 ---------- */

function AttestTab({ token }: { token: string }) {
  const [roots, setRoots] = useState<AttestRoot[]>([]);
  const [checkId, setCheckId] = useState("");
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    api<{ ok: boolean; roots: AttestRoot[] }>("/api/admin/attest", token).then((d) => d.ok && setRoots(d.roots));
  }, [token]);

  const check = async () => {
    setResult("验证中…");
    const d = await fetch(`/api/attest/object/${encodeURIComponent(checkId.trim())}`);
    const j = (await d.json()) as {
      ok: boolean;
      reason?: string;
      proof?: { creatorName: string; createdAt: number; sig: string; valid: boolean };
    };
    if (!j.ok || !j.proof) return setResult(`❌ ${j.reason}`);
    setResult(
      `${j.proof.valid ? "✅ 验章通过" : "❌ 验章失败（数据被篡改！）"} · 归属 ${j.proof.creatorName} · ${fmt(
        j.proof.createdAt
      )}\n签名：${j.proof.sig.slice(0, 44)}…`
    );
  };

  return (
    <>
      <div className="admToolbar">
        <input className="admInput" placeholder="输入造物 ID 验章…" value={checkId} onChange={(e) => setCheckId(e.target.value)} />
        <button className="admMiniBtn" onClick={() => void check()}>
          验证
        </button>
      </div>
      {result && <pre className="admVerifyResult">{result}</pre>}
      <div className="admToolbar">
        <span className="admCount">公示存证根（最新 50 条）——篡改任何归属记录，重算根必变</span>
      </div>
      <table className="admTable">
        <thead>
          <tr>
            <th>公示时间</th>
            <th>覆盖造物数</th>
            <th>Merkle 根</th>
          </tr>
        </thead>
        <tbody>
          {roots.map((r, i) => (
            <tr key={i}>
              <td>{fmt(r.createdAt)}</td>
              <td>{r.count}</td>
              <td>
                <code className="admHash">{r.root}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
