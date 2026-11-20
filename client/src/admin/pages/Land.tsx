// 土地管理：九州地块归属 + 申请审批 + 州长任命
import { useCallback, useEffect, useState } from "react";
import { api, post, fmtTime } from "../api";
import { Badge, Empty } from "../components";

interface LandRes {
  ok: boolean;
  plots: Array<{ plotId: string; state: string; ownerId: string; ownerName: string; grantedAt: number }>;
  apps: Array<{ id: string; plotId: string; state: string; applicantName: string; reason: string; status: string; reviewerName?: string; createdAt: number }>;
  governors: Array<{ state: string; userId: string; userName: string; appointedBy: string }>;
}

export default function Land({ token, push }: { token: string; push: (t: string, k?: "ok" | "err") => void }) {
  const [data, setData] = useState<LandRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [govState, setGovState] = useState("1-1");
  const [govUser, setGovUser] = useState("");

  const load = useCallback(() => {
    api<LandRes>("/api/admin/land", token).then((d) => {
      if (d.ok) setData(d);
    });
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (path: string, body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      const d = await post(path, token, body);
      push(d.ok ? okMsg : d.reason || "操作失败", d.ok ? "ok" : "err");
      if (d.ok) load();
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Empty text="加载中…" />;
  const pending = data.apps.filter((a) => a.status === "pending");

  return (
    <div>
      <h2>🗺 土地管理</h2>

      <h3>待审批申请（{pending.length}）</h3>
      {pending.length === 0 && <Empty text="没有待审批的申请" />}
      {pending.map((a) => (
        <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #eee", padding: "6px 0" }}>
          <b>{a.applicantName}</b>
          <span>申请 {a.plotId}（{a.state} 州）</span>
          <span style={{ color: "#888" }}>{a.reason || "无理由"} · {fmtTime(a.createdAt)}</span>
          <button disabled={busy} onClick={() => act("/api/admin/land/decide", { appId: a.id, decision: "approved" }, "已批准")}>
            ✅ 批准
          </button>
          <button disabled={busy} onClick={() => act("/api/admin/land/decide", { appId: a.id, decision: "rejected" }, "已拒绝")}>
            ❌ 拒绝
          </button>
        </div>
      ))}

      <h3>九州州长</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <select value={govState} onChange={(e) => setGovState(e.target.value)}>
          {["1-1", "1-2", "1-3", "2-1", "2-3", "3-1", "3-2", "3-3"].map((s) => (
            <option key={s} value={s}>
              {s} 州
            </option>
          ))}
        </select>
        <input placeholder="用户 ID（u-xxxx）" value={govUser} onChange={(e) => setGovUser(e.target.value)} style={{ width: 180 }} />
        <button
          disabled={busy || !govUser}
          onClick={() => act("/api/admin/land/governor", { state: govState, userId: govUser }, "已任命州长")}
        >
          👑 任命
        </button>
        <button
          disabled={busy}
          onClick={() => act("/api/admin/land/governor", { state: govState, remove: true }, "已罢免")}
        >
          罢免
        </button>
      </div>
      {data.governors.length === 0 && <Empty text="还没有任命任何州长" />}
      {data.governors.map((g) => (
        <div key={g.state} style={{ padding: "4px 0" }}>
          <Badge kind="state" text={`${g.state} 州`} /> 👑 {g.userName}（{g.userId}）· 由 {g.appointedBy} 任命
        </div>
      ))}

      <h3>已批土地（{data.plots.length}）</h3>
      {data.plots.length === 0 && <Empty text="还没有批出的土地" />}
      {data.plots.map((p) => (
        <div key={p.plotId} style={{ padding: "4px 0", borderBottom: "1px solid #eee" }}>
          <Badge kind="state" text={`${p.state} 州`} /> <b>{p.plotId}</b> → {p.ownerName}（{p.ownerId}）· {fmtTime(p.grantedAt)}
        </div>
      ))}
    </div>
  );
}
