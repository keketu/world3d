// 广播公告：向全服玩家发公告 + 历史记录
import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, post, type ChatRes } from "../api";

export default function Broadcast({ token, push }: { token: string; push: (t: string, k?: "ok" | "err") => void }) {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<ChatRes["logs"]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<ChatRes>(`/api/admin/chat?kind=system&limit=40`, token).then((d) => d.ok && setHistory(d.logs));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const d = await post<{ ok: boolean; reason?: string }>("/api/admin/broadcast", token, { text: t });
    setBusy(false);
    if (!d.ok) return push(d.reason || "发送失败", "err");
    push("公告已发送到全服");
    setText("");
    load();
  };

  const presets = [
    "🌸 小岛樱花全开了，欢迎来赏花～",
    "🔧 服务器将于今晚 23:00 维护约 10 分钟",
    "🎉 新功能上线：现在可以在岛上种更多树啦！",
    "📢 请大家文明建造，垃圾请带走～",
  ];

  return (
    <div className="admGrid2">
      <div className="admCard">
        <div className="admCardHead">
          <b>📢 发布全服公告</b>
          <span className="admCount">所有在线玩家都会收到</span>
        </div>
        <textarea
          className="admTextarea big"
          rows={5}
          maxLength={300}
          placeholder="写点什么广播给所有人…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="admInlineForm between">
          <span className="admCount">{text.length} / 300</span>
          <button className="admPrimaryBtn inline" disabled={busy || !text.trim()} onClick={() => void send()}>
            {busy ? "发送中…" : "立即广播"}
          </button>
        </div>
        <div className="admPresetList">
          {presets.map((p) => (
            <button key={p} className="admChipBtn" onClick={() => setText(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="admCard">
        <div className="admCardHead">
          <b>历史公告</b>
          <button className="admMiniBtn" onClick={load}>
            🔄
          </button>
        </div>
        <div className="admChatList compact">
          {history.map((l) => (
            <div key={l.id} className="admChatRow kind-system">
              <span className="admChatTs">{fmtTime(l.ts)}</span>
              <span className="admChatText">{l.text}</span>
            </div>
          ))}
          {history.length === 0 && <div className="admEmpty">还没有公告记录</div>}
        </div>
      </div>
    </div>
  );
}
