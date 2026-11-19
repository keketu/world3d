// 世界造物：筛选 + 批量删除 + 类型分布 + 详情（含验章状态）
import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, post, type ObjectsRes } from "../api";
import { BulkBar, Checkbox, Drawer, Empty, Pagination } from "../components";
import { DonutChart } from "../Charts";

const PAGE_SIZE = 30;

export default function Objects({ token, push }: { token: string; push: (t: string, k?: "ok" | "err") => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [creator, setCreator] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ObjectsRes | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ObjectsRes["objects"][number] | null>(null);
  const [proof, setProof] = useState<{ valid: boolean; sig: string } | null>(null);

  const load = useCallback(() => {
    api<ObjectsRes>(
      `/api/admin/objects?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}&creator=${encodeURIComponent(creator)}&limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
      token
    ).then((d) => d.ok && setData(d));
  }, [token, q, kind, creator, page]);

  useEffect(() => {
    const t = setTimeout(load, 220);
    return () => clearTimeout(t);
  }, [load]);

  const objects = data?.objects ?? [];
  const allOn = objects.length > 0 && objects.every((o) => selected.has(o.id));

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`确认删除选中的 ${ids.length} 件造物？（会立即从所有玩家世界中移除）`)) return;
    const d = await post<{ ok: boolean; affected: number; reason?: string }>("/api/admin/objects/bulk", token, {
      ids,
      action: "delete",
    });
    if (!d.ok) return push(d.reason || "删除失败", "err");
    push(`已删除 ${d.affected} 件造物`);
    setSelected(new Set());
    load();
  };

  const openDetail = async (o: ObjectsRes["objects"][number]) => {
    setDetail(o);
    setProof(null);
    const d = await fetch(`/api/attest/object/${encodeURIComponent(o.id)}`);
    const j = (await d.json()) as { ok: boolean; proof?: { valid: boolean; sig: string } };
    if (j.ok && j.proof) setProof(j.proof);
  };

  return (
    <>
      <div className="admToolbar">
        <input
          className="admInput"
          placeholder="搜索类型 / 创建者 / ID…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <select className="admSelect" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
          <option value="">全部类型</option>
          {(data?.kinds ?? []).map((k) => (
            <option key={k.label} value={k.label}>
              {k.label} ({k.value})
            </option>
          ))}
        </select>
        <input
          className="admInput"
          placeholder="创建者"
          value={creator}
          onChange={(e) => { setCreator(e.target.value); setPage(1); }}
        />
        <button className="admMiniBtn" onClick={load}>
          🔄 刷新
        </button>
      </div>

      {data && data.kinds.length > 0 && (
        <div className="admCard">
          <div className="admCardHead">
            <b>类型分布</b>
            <span className="admCount">共 {data.total} 件</span>
          </div>
          <DonutChart data={data.kinds.slice(0, 8)} centerLabel={String(data.total)} centerSub="件造物" />
        </div>
      )}

      <BulkBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={
          <button className="admMiniBtn danger" onClick={() => void bulkDelete()}>
            🗑 批量删除
          </button>
        }
      />

      <div className="admTableWrap">
        <table className="admTable">
          <thead>
            <tr>
              <th className="w-check">
                <Checkbox
                  checked={allOn}
                  onChange={(v) => setSelected(v ? new Set(objects.map((o) => o.id)) : new Set())}
                />
              </th>
              <th>类型</th>
              <th>创建者</th>
              <th>坐标</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {objects.map((o) => (
              <tr key={o.id}>
                <td>
                  <Checkbox checked={selected.has(o.id)} onChange={(v) => toggle(o.id, v)} />
                </td>
                <td>
                  <b className="link" onClick={() => void openDetail(o)}>
                    {o.kind}
                  </b>{" "}
                  {o.variant && <span className="admVariant">{o.variant}</span>}
                </td>
                <td>{o.creatorName}</td>
                <td>
                  ({Math.round(o.x)}, {Math.round(o.z)})
                </td>
                <td>{fmtTime(o.createdAt)}</td>
                <td className="admOps">
                  <button className="admMiniBtn" onClick={() => void openDetail(o)}>
                    详情
                  </button>
                </td>
              </tr>
            ))}
            {objects.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <Empty text="没有匹配的造物" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />

      <Drawer open={!!detail} title={detail ? `${detail.kind} ${detail.variant ?? ""}` : ""} subtitle={detail?.id} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <div className="admDetailGrid">
              <div>
                <span>创建者</span>
                <b>{detail.creatorName}</b>
              </div>
              <div>
                <span>归属 ID</span>
                <b>{detail.creatorId}</b>
              </div>
              <div>
                <span>坐标</span>
                <b>
                  ({Math.round(detail.x)}, {Math.round(detail.z)})
                </b>
              </div>
              <div>
                <span>创建时间</span>
                <b>{fmtTime(detail.createdAt)}</b>
              </div>
            </div>
            <div className="admDetailSection">
              <div className="admDetailSectionTitle">产权存证</div>
              {proof ? (
                <>
                  <div className={`admVerifyBadge ${proof.valid ? "ok" : "bad"}`}>
                    {proof.valid ? "✅ 验章通过（未被篡改）" : "❌ 验章失败（数据被篡改！）"}
                  </div>
                  <code className="admHash block">签名：{proof.sig.slice(0, 60)}…</code>
                </>
              ) : (
                <div className="admEmpty">验章中…</div>
              )}
            </div>
            <button
              className="admMiniBtn danger wide"
              onClick={() => {
                setSelected(new Set([detail.id]));
                setTimeout(() => void bulkDelete(), 0);
              }}
            >
              🗑 删除这件造物
            </button>
          </>
        )}
      </Drawer>
    </>
  );
}
