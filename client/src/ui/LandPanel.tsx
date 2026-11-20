// 土地面板：当前位置地块状态 / 申请土地 / 我的土地与审批（州长、管理员可见对应操作）
import { useEffect, useState } from "react";
import { useWorld } from "../state/store";
import { plotIdAt, plotBounds, listPlots } from "@world3d/shared";

type SetLandOverlay = (rows: Array<{ plotId: string; ownerId: string; ownerName: string }> | null) => void;
function overlayApi(): SetLandOverlay | null {
  const w = window as unknown as { __world3d?: { setLandOverlay?: SetLandOverlay } };
  return w.__world3d?.setLandOverlay ?? null;
}

interface LandState {
  plots: Array<{ plotId: string; state: string; ownerId: string; ownerName: string; grantedAt: number }>;
  apps: Array<{ id: string; plotId: string; status: string; reason: string; createdAt: number }>;
  governed: Array<{ state: string; userId: string; userName: string }>;
  pending: Array<{ id: string; plotId: string; state: string; applicantName: string; reason: string }>;
}

export default function LandPanel({ onClose }: { onClose: () => void }) {
  const auth = useWorld((s) => s.auth);
  const [data, setData] = useState<LandState | null>(null);
  const [here, setHere] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = auth.user?.role === "admin";
  const ownerKey = auth.user ? `u:${auth.user.id}` : "";

  const load = async () => {
    if (!auth.token) return;
    try {
      const r = await fetch("/api/me/land", { headers: { Authorization: `Bearer ${auth.token}` } });
      const d = await r.json();
      if (d.ok) {
        setData(d);
        // 全量地块着色数据喂给地面边界线
        const all = listPlots().map((p) => {
          const owned = d.plots.find((q: { plotId: string }) => q.plotId === p.plotId);
          return { plotId: p.plotId, ownerId: owned?.ownerId ?? "", ownerName: owned?.ownerName ?? "" };
        });
        overlayApi()?.(all);
      }
    } catch {
      /* 忽略 */
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      const w = window as unknown as { __world3d?: { selfPos: () => { x: number; z: number } } };
      const pos = w.__world3d?.selfPos?.();
      if (pos) setHere(plotIdAt(pos.x, pos.z));
    }, 1000);
    return () => {
      clearInterval(timer);
      overlayApi()?.(null); // 关面板清掉边界线
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);

  const apply = async (targetPlot: string) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/me/land/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ plotId: targetPlot, reason: reason || "想在这里安家" }),
      });
      const d = await r.json();
      setMsg(d.ok ? "✅ 申请已提交，等待州长/管理员审批" : `❌ ${d.reason}`);
      if (d.ok) load();
    } finally {
      setBusy(false);
    }
  };

  const decide = async (appId: string, decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      const r = await fetch("/api/land/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ appId, decision }),
      });
      const d = await r.json();
      setMsg(d.ok ? "✅ 已处理" : `❌ ${d.reason}`);
      if (d.ok) load();
    } finally {
      setBusy(false);
    }
  };

  const boundsOf = (plotId: string) => plotBounds(plotId);

  return (
    <>
      <div className="setMask" onClick={onClose} />
      <aside className={`setPanel`}>
        <header className="setHead">
          <b>🗺 土地</b>
          <button className="setIconBtn" onClick={onClose} title="关闭">✕</button>
        </header>
        <div className="setBody">
          {!auth.user && <div className="setHint">游客不能申请土地——先在右上角注册/登录账号。</div>}
          {auth.user && (
            <>
              <div className="setGroup">
                <div className="setGroupTitle">当前位置</div>
                <div className="setHint">
                  {here ? (
                    <>
                      你站在地块 <b>{here}</b>。
                      {data?.plots.some((p) => p.plotId === here) ? (
                        <span> 属于 {data.plots.find((p) => p.plotId === here)!.ownerName}{data.plots.find((p) => p.plotId === here)!.ownerId === ownerKey ? "（就是你）" : ""}。</span>
                      ) : (
                        <span> 还没有被认领。</span>
                      )}
                      {!data?.plots.some((p) => p.plotId === here) && here && (
                        <div className="setPreview">
                          <button className="setMiniBtn" disabled={busy} onClick={() => apply(here)}>📩 申请这块地</button>
                        </div>
                      )}
                      <input
                        className="joinInput"
                        placeholder="申请理由（可选）"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        style={{ marginTop: 6, width: "100%" }}
                      />
                    </>
                  ) : (
                    <span>当前不在可申请的地块上（道路/广场/公园是公共区，随处可逛）。</span>
                  )}
                </div>
                {msg && <div className="setHint"><b>{msg}</b></div>}
              </div>

              {data && data.pending.length > 0 && (
                <div className="setGroup">
                  <div className="setGroupTitle">待我审批（{data.pending.length}）</div>
                  {data.pending.map((a) => (
                    <div key={a.id} className="setHint" style={{ borderBottom: "1px dashed #e4d9c6", paddingBottom: 6 }}>
                      <b>{a.applicantName}</b> 申请 <b>{a.plotId}</b>（{a.reason || "无理由"}）
                      <div className="setPreview">
                        <button className="setMiniBtn" disabled={busy} onClick={() => decide(a.id, "approved")}>✅ 批准</button>
                        <button className="setMiniBtn" disabled={busy} onClick={() => decide(a.id, "rejected")}>❌ 拒绝</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="setGroup">
                <div className="setGroupTitle">我的土地</div>
                {data?.plots.filter((p) => p.ownerId === ownerKey).length ? (
                  data.plots.filter((p) => p.ownerId === ownerKey).map((p) => (
                    <div key={p.plotId} className="setHint">
                      🏷 <b>{p.plotId}</b>（{p.state} 州）— {boundsOf(p.plotId) ? `${Math.round(boundsOf(p.plotId)!.x1 - boundsOf(p.plotId)!.x0)}×${Math.round(boundsOf(p.plotId)!.z1 - boundsOf(p.plotId)!.z0)}m` : ""}
                    </div>
                  ))
                ) : (
                  <div className="setHint">还没有土地——站在想去的街区里点「申请这块地」。</div>
                )}
              </div>

              <div className="setGroup">
                <div className="setGroupTitle">我的申请记录</div>
                {data?.apps.length ? (
                  data.apps.slice(0, 6).map((a) => (
                    <div key={a.id} className="setHint">
                      {a.status === "pending" ? "⏳ 审批中" : a.status === "approved" ? "✅ 已通过" : "❌ 已拒绝"} · {a.plotId}
                    </div>
                  ))
                ) : (
                  <div className="setHint">暂无申请记录。</div>
                )}
              </div>

              {data?.governed && data.governed.length > 0 && (
                <div className="setGroup">
                  <div className="setGroupTitle">🏛 我的辖区</div>
                  {data.governed.map((g) => (
                    <div key={g.state} className="setHint">👑 {g.state} 州州长</div>
                  ))}
                </div>
              )}

              <div className="setGroup">
                <div className="setGroupTitle">关于九州</div>
                <div className="setHint">
                  全图 3×3 共九个街区即「九州」。州长由管理员任命，负责审批本州的土地申请；管理员可审批全部。共有 24 块 27×27m 的土地可申请，审批通过后可以在自己的土地上建造任何东西。
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
