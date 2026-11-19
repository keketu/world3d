// 聊天记录：搜索 / 筛选 / 时间范围 / CSV 导出
import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, type ChatRes } from "../api";
import { Empty } from "../components";

export default function Chat({ token }: { token: string; push: (t: string, k?: "ok" | "err") => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [range, setRange] = useState("");
  const [logs, setLogs] = useState<ChatRes["logs"]>([]);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (q) params.set("q", q);
    if (kind) params.set("kind", kind);
    if (from) params.set("from", from);
    if (range) {
      const to = new Date();
      const fromTs = new Date(to.getTime() - Number(range) * 3600_000);
      params.set("fromTs", String(fromTs.getTime()));
      params.set("toTs", String(to.getTime()));
    }
    api<ChatRes>(`/api/admin/chat?${params}`, token).then((d) => d.ok && setLogs(d.logs));
  }, [token, q, kind, from, range]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (kind) params.set("kind", kind);
    if (from) params.set("from", from);
    // 带 token 的下载：用 fetch + blob
    fetch(`/api/admin/chat/export.csv?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `chatlog-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  return (
    <>
      <div className="admToolbar">
        <input
          className="admInput wide"
          placeholder="搜索内容…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="admSelect" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">全部类型</option>
          <option value="player">玩家发言</option>
          <option value="system">系统消息</option>
        </select>
        <input
          className="admInput"
          placeholder="发送者"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <select className="admSelect" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="">全部时间</option>
          <option value="1">最近 1 小时</option>
          <option value="24">最近 24 小时</option>
          <option value="168">最近 7 天</option>
        </select>
        <button className="admMiniBtn" onClick={() => void exportCsv()}>
          ⬇ 导出 CSV
        </button>
        <button className="admMiniBtn" onClick={load}>
          🔄
        </button>
      </div>

      <div className="admCard pad0">
        <div className="admChatList">
          {logs.map((l) => (
            <div key={l.id} className={`admChatRow kind-${l.kind}`}>
              <span className="admChatTs">{fmtTime(l.ts)}</span>
              <span className={`admChatFrom kind-${l.kind}`}>{l.kind === "system" ? "系统" : l.from}</span>
              <span className="admChatText">{l.text}</span>
            </div>
          ))}
          {logs.length === 0 && <Empty text="没有匹配的聊天记录" />}
        </div>
      </div>
      <div className="admCount pad">共 {logs.length} 条（最多显示 100 条）</div>
    </>
  );
}
