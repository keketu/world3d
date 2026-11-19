// 在线玩家：实时列表 + 踢人 / 传送 / 私信
import { useEffect, useState } from "react";
import type { PlayerRow } from "@world3d/shared";
import { api, fmtAgo, post, type PlayersRes } from "../api";
import { realtime } from "../realtime";
import { Badge, Drawer, Empty } from "../components";

export default function Players({ token, push }: { token: string; push: (t: string, k?: "ok" | "err") => void }) {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [target, setTarget] = useState<PlayerRow | null>(null);
  const [msg, setMsg] = useState("");
  const [tx, setTx] = useState("");
  const [tz, setTz] = useState("");

  useEffect(() => {
    api<PlayersRes>("/api/admin/players", token).then((d) => d.ok && setPlayers(d.players));
    const off = realtime.onPlayers((p) => setPlayers(p));
    const t = setInterval(() => {
      api<PlayersRes>("/api/admin/players", token).then((d) => d.ok && setPlayers(d.players));
    }, 10000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [token]);

  const kick = async (p: PlayerRow) => {
    if (!confirm(`确认把 ${p.name} 移出世界？`)) return;
    const d = await post<{ ok: boolean; reason?: string }>(`/api/admin/player/${p.id}/kick`, token, { reason: "已被管理员移出" });
    if (!d.ok) return push(d.reason || "操作失败", "err");
    push(`已移出 ${p.name}`);
    setTarget(null);
  };

  const teleport = async () => {
    if (!target) return;
    const d = await post<{ ok: boolean; reason?: string }>(`/api/admin/player/${target.id}/teleport`, token, {
      x: Number(tx),
      z: Number(tz),
    });
    if (!d.ok) return push(d.reason || "传送失败", "err");
    push(`已把 ${target.name} 传送到 (${tx}, ${tz})`);
  };

  const sendMsg = async () => {
    if (!target || !msg.trim()) return;
    const d = await post<{ ok: boolean; reason?: string }>(`/api/admin/player/${target.id}/message`, token, { text: msg });
    if (!d.ok) return push(d.reason || "发送失败", "err");
    push(`已私信 ${target.name}`);
    setMsg("");
  };

  return (
    <>
      <div className="admToolbar">
        <span className="admCount">当前在线 {players.length} 人（实时更新）</span>
        <span className="admLive mini on">
          <i className="admLiveDot" />实时
        </span>
      </div>

      <div className="admTableWrap">
        <table className="admTable">
          <thead>
            <tr>
              <th>玩家</th>
              <th>类型</th>
              <th>位置</th>
              <th>所在空间</th>
              <th>最后活动</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>
                  <b className="link" onClick={() => { setTarget(p); setTx(String(p.x)); setTz(String(p.z)); }}>
                    {p.name}
                  </b>
                  <div className="admId">{p.id}</div>
                </td>
                <td>{p.isGuest ? <Badge kind="guest" text="游客" /> : <Badge kind="user" text="账号" />}</td>
                <td>
                  ({p.x}, {p.z})
                </td>
                <td>{p.roomId ? "🏢 室内" : "🌍 户外"}</td>
                <td>{fmtAgo(p.lastMove)}</td>
                <td className="admOps">
                  <button className="admMiniBtn" onClick={() => { setTarget(p); setTx(String(p.x)); setTz(String(p.z)); }}>
                    管理
                  </button>
                  <button className="admMiniBtn danger" onClick={() => void kick(p)}>
                    移出
                  </button>
                </td>
              </tr>
            ))}
            {players.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <Empty text="当前无人在线" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Drawer open={!!target} title={target?.name ?? ""} subtitle={target?.id} onClose={() => setTarget(null)}>
        {target && (
          <>
            <div className="admDetailSection">
              <div className="admDetailSectionTitle">玩家信息</div>
              <div className="admDetailGrid">
                <div>
                  <span>类型</span>
                  <b>{target.isGuest ? "游客" : `账号 ${target.userId}`}</b>
                </div>
                <div>
                  <span>位置</span>
                  <b>
                    ({target.x}, {target.z})
                  </b>
                </div>
              </div>
            </div>
            <div className="admDetailSection">
              <div className="admDetailSectionTitle">传送到坐标</div>
              <div className="admInlineForm">
                <input className="admInput" placeholder="X" value={tx} onChange={(e) => setTx(e.target.value)} />
                <input className="admInput" placeholder="Z" value={tz} onChange={(e) => setTz(e.target.value)} />
                <button className="admPrimaryBtn inline" onClick={() => void teleport()}>
                  传送
                </button>
              </div>
            </div>
            <div className="admDetailSection">
              <div className="admDetailSectionTitle">私信</div>
              <textarea
                className="admTextarea"
                rows={3}
                placeholder="给玩家发一条消息…"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
              />
              <button className="admPrimaryBtn inline" onClick={() => void sendMsg()}>
                发送
              </button>
            </div>
            <button className="admMiniBtn danger wide" onClick={() => void kick(target)}>
              🚫 移出世界
            </button>
          </>
        )}
      </Drawer>
    </>
  );
}
