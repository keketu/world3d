// 产权存证：公示根列表 + 单件验章 + 完整性对账
import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, post } from "../api";
import { Empty } from "../components";

interface RootRow {
  root: string;
  count: number;
  createdAt: number;
}

export default function Attest({ token, push }: { token: string; push: (t: string, k?: "ok" | "err") => void }) {
  const [roots, setRoots] = useState<RootRow[]>([]);
  const [pubKey, setPubKey] = useState("");
  const [checkId, setCheckId] = useState("");
  const [result, setResult] = useState<string>("");
  const [recon, setRecon] = useState<{ consistent: boolean; broken: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ ok: boolean; roots: RootRow[]; publicKey: string }>("/api/admin/attest", token).then((d) => {
      if (d.ok) {
        setRoots(d.roots);
        setPubKey(d.publicKey);
      }
    });
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const check = async () => {
    setResult("验证中…");
    const d = await fetch(`/api/attest/object/${encodeURIComponent(checkId.trim())}`);
    const j = (await d.json()) as {
      ok: boolean;
      reason?: string;
      proof?: { creatorName: string; createdAt: number; sig: string; valid: boolean };
    };
    if (!j.ok || !j.proof) return setResult(`❌ ${j.reason ?? "查无此造物"}`);
    setResult(
      `${j.proof.valid ? "✅ 验章通过" : "❌ 验章失败（数据被篡改！）"} · 归属 ${j.proof.creatorName} · ${fmtTime(
        j.proof.createdAt
      )}\n签名：${j.proof.sig}`
    );
  };

  const reconcile = async () => {
    setBusy(true);
    const d = await post<{ ok: boolean; consistent: boolean; broken: string[]; reason?: string }>(
      "/api/admin/attest/reconcile",
      token,
      {}
    );
    setBusy(false);
    if (!d.ok) return push(d.reason || "对账失败", "err");
    setRecon({ consistent: d.consistent, broken: d.broken ?? [] });
    push(d.consistent ? "对账通过：账本与公示根一致" : `对账发现 ${d.broken?.length ?? 0} 处异常`, d.consistent ? "ok" : "err");
    load();
  };

  return (
    <>
      <div className="admGrid2">
        <div className="admCard">
          <div className="admCardHead">
            <b>🔐 完整性对账</b>
            <button className="admMiniBtn" disabled={busy} onClick={() => void reconcile()}>
              {busy ? "对账中…" : "立即对账"}
            </button>
          </div>
          <div className="admStatSub">重算全岛归属指纹，与最新公示根比对；逐件验章找出异常造物。</div>
          {recon && (
            <div className={`admVerifyBadge ${recon.consistent ? "ok" : "bad"}`}>
              {recon.consistent
                ? "✅ 账本与公示根一致，未发现篡改"
                : `❌ 发现 ${recon.broken.length} 处异常`}
            </div>
          )}
          {recon && recon.broken.length > 0 && (
            <div className="admBrokenList">
              {recon.broken.map((id) => (
                <code key={id} className="admHash block">
                  {id}
                </code>
              ))}
            </div>
          )}
          <div className="admDetailSectionTitle">公钥（任何人都可用它独立验章）</div>
          <code className="admHash block">{pubKey.trim()}</code>
        </div>

        <div className="admCard">
          <div className="admCardHead">
            <b>单件验章</b>
          </div>
          <div className="admInlineForm">
            <input
              className="admInput"
              placeholder="输入造物 ID…"
              value={checkId}
              onChange={(e) => setCheckId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void check()}
            />
            <button className="admPrimaryBtn inline" onClick={() => void check()}>
              验证
            </button>
          </div>
          {result && <pre className="admVerifyResult">{result}</pre>}
          <div className="admStatSub">
            验章用「造物 ID + 归属人 + 创建时间」与服务器签名比对；任何一项被改，验章立刻失败。
          </div>
        </div>
      </div>

      <div className="admCard pad0">
        <table className="admTable">
          <thead>
            <tr>
              <th>公示时间</th>
              <th>覆盖造物</th>
              <th>Merkle 根</th>
            </tr>
          </thead>
          <tbody>
            {roots.map((r, i) => (
              <tr key={i}>
                <td>{fmtTime(r.createdAt)}</td>
                <td>{r.count}</td>
                <td>
                  <code className="admHash">{r.root}</code>
                </td>
              </tr>
            ))}
            {roots.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <Empty text="还没有公示根" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
