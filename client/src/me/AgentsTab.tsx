// /me 「我的员工」：雇佣/改造/解雇个人 agent（进办公室可附身操控）
import { useCallback, useEffect, useState } from "react";
import { api, post, put, del } from "../admin/api";
import { Empty } from "../admin/components";

interface AgentRow {
  id: string;
  name: string;
  role: string;
  personality: string;
  colorIdx: number;
  color: string;
  createdAt: number;
  /** 已进办公室（有工位） */
  spawned: boolean;
  /** 正被附身操控 */
  controlled: boolean;
}

interface AgentsRes {
  ok: boolean;
  agents: AgentRow[];
  cap: number;
  roomCap: number;
  palette: string[];
  roles: string[];
}

const ROLE_LABEL: Record<string, string> = {
  product: "📐 产品",
  design: "🎨 设计",
  frontend: "💻 前端",
  backend: "🔧 后端",
  qa: "🔍 测试",
};

export default function AgentsTab({ token }: { token: string }) {
  const [data, setData] = useState<AgentsRes | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("frontend");
  const [personality, setPersonality] = useState("");
  const [colorIdx, setColorIdx] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<AgentRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<AgentsRes>("/api/me/agents", token).then((d) => d.ok && setData(d));
  }, [token]);

  useEffect(() => load(), [load]);

  const hire = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const d = await post<{ ok: boolean; reason?: string; spawned?: boolean }>("/api/me/agents", token, {
        name: name.trim(),
        role,
        personality: personality.trim(),
        colorIdx,
      });
      if (!d.ok) return setMsg({ ok: false, text: d.reason || "雇佣失败" });
      setMsg({ ok: true, text: d.spawned ? `🎉 ${name.trim()} 已入职，去办公楼找 TA 吧（走到身边按 E 附身）` : `🎉 ${name.trim()} 已雇佣（办公室工位已满，暂时候补）` });
      setName("");
      setPersonality("");
      load();
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const d = await put<{ ok: boolean; reason?: string }>(`/api/me/agents/${editing.id}`, token, {
        name: editing.name,
        role: editing.role,
        personality: editing.personality,
        colorIdx: editing.colorIdx,
      });
      if (!d.ok) return setMsg({ ok: false, text: d.reason || "保存失败" });
      setMsg({ ok: true, text: "已更新" });
      setEditing(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const fire = async (a: AgentRow) => {
    if (!confirm(`确定解雇 ${a.name} 吗？TA 会离开办公室。`)) return;
    setBusy(true);
    try {
      await del<{ ok: boolean }>(`/api/me/agents/${a.id}`, token);
      setMsg({ ok: true, text: `${a.name} 已离开` });
      load();
    } finally {
      setBusy(false);
    }
  };

  const agents = data?.agents ?? [];
  const palette = data?.palette ?? [];

  return (
    <div className="meGrid2">
      <div className="meCard">
        <div className="meCardHead">
          <b>我的员工（{agents.length}/{data?.cap ?? 4}）</b>
          <span className="meCount">办公室席位 {data?.roomCap ?? 6} · 先雇先上</span>
        </div>
        <div className="agentList">
          {agents.map((a) => (
            <div key={a.id} className="agentRow">
              <span className="agentDot" style={{ background: a.color }} />
              <div className="agentBody">
                <div className="agentName">
                  {a.name} <span className="agentRole">{ROLE_LABEL[a.role] ?? a.role}</span>
                  {a.controlled && <span className="agentBadge live">🎭 附身中</span>}
                  {a.spawned && !a.controlled && <span className="agentBadge">🏢 在岗</span>}
                  {!a.spawned && <span className="agentBadge wait">🪑 候补</span>}
                </div>
                <div className="agentSub">{a.personality || "还没有人设，去改造一下 TA"}</div>
              </div>
              <div className="agentOps">
                <button className="agentOp" disabled={busy} onClick={() => setEditing({ ...a })}>
                  改造
                </button>
                <button className="agentOp danger" disabled={busy} onClick={() => fire(a)}>
                  解雇
                </button>
              </div>
            </div>
          ))}
          {agents.length === 0 && <Empty text="还没有员工 —— 右边雇一位，进办公楼就能附身操控 TA" />}
        </div>

        {editing && (
          <div className="agentEdit">
            <div className="meCardHead">
              <b>改造 {editing.name}</b>
              <button className="agentOp" onClick={() => setEditing(null)}>
                取消
              </button>
            </div>
            <div className="llmForm">
              <div className="llmRow">
                <label className="llmLabel">名字</label>
                <input className="llmInput" value={editing.name} maxLength={12} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="llmRow">
                <label className="llmLabel">岗位</label>
                <select className="llmSelect" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                  {(data?.roles ?? []).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r] ?? r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="llmRow">
                <label className="llmLabel">性格人设</label>
                <input className="llmInput" value={editing.personality} maxLength={100} placeholder="例：元气满满，口头禅「包在我身上」" onChange={(e) => setEditing({ ...editing, personality: e.target.value })} />
              </div>
              <div className="llmRow">
                <label className="llmLabel">代表色</label>
                <div className="agentSwatches">
                  {palette.map((c, i) => (
                    <button key={c} className={`agentSwatch ${editing.colorIdx === i ? "on" : ""}`} style={{ background: c }} onClick={() => setEditing({ ...editing, colorIdx: i })} />
                  ))}
                </div>
              </div>
              <div className="llmBtns">
                <button className="llmBtn primary" disabled={busy} onClick={saveEdit}>
                  保存改造
                </button>
              </div>
            </div>
          </div>
        )}

        {msg && <div className={`llmMsg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
      </div>

      <div className="meCard">
        <div className="meCardHead">
          <b>雇佣新员工</b>
        </div>
        <div className="llmForm">
          <div className="llmRow">
            <label className="llmLabel">名字</label>
            <input className="llmInput" value={name} maxLength={12} placeholder="2-12 位中英文/数字" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="llmRow">
            <label className="llmLabel">岗位</label>
            <select className="llmSelect" value={role} onChange={(e) => setRole(e.target.value)}>
              {(data?.roles ?? []).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r] ?? r}
                </option>
              ))}
            </select>
          </div>
          <div className="llmRow">
            <label className="llmLabel">性格人设</label>
            <input className="llmInput" value={personality} maxLength={100} placeholder="例：沉稳靠谱，喜欢先想清楚再动手" onChange={(e) => setPersonality(e.target.value)} />
          </div>
          <div className="llmRow">
            <label className="llmLabel">代表色</label>
            <div className="agentSwatches">
              {palette.map((c, i) => (
                <button key={c} className={`agentSwatch ${colorIdx === i ? "on" : ""}`} style={{ background: c }} onClick={() => setColorIdx(i)} />
              ))}
            </div>
          </div>
          <div className="llmBtns">
            <button className="llmBtn primary" disabled={busy || !name.trim()} onClick={hire}>
              🤝 雇佣入职
            </button>
          </div>
        </div>
        <div className="llmExplain" style={{ marginTop: 14 }}>
          <b>怎么玩「我的员工」？</b>
          <span>1️⃣ 这里雇佣员工（最多 {data?.cap ?? 4} 位），有空位会自动进办公室入座；</span>
          <span>2️⃣ 进办公楼，走到自己的员工身边，按 <b>E 附身</b>，用 TA 的视角行走、说话（聊天框=以 TA 名义发言）；</span>
          <span>3️⃣ 再按 E 退出附身，TA 会自己走回工位继续上班；</span>
          <span>4️⃣ 配置了「🧠 Agent 大脑」的话，你的员工被搭话时用你的大模型回答；别人和 TA 聊天也会用。</span>
        </div>
      </div>
    </div>
  );
}
