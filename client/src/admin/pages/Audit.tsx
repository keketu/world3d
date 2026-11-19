// 审计日志：所有管理操作的留痕
import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, type AuditRes } from "../api";
import { Empty, Pagination } from "../components";

const PAGE_SIZE = 40;

const ACTION_LABEL: Record<string, string> = {
  ban: "封禁",
  unban: "解封",
  role: "设置角色",
  delete: "删除造物",
  broadcast: "发布公告",
  kick: "踢出玩家",
  teleport: "传送玩家",
  message: "私信玩家",
  reconcile: "存证对账",
};

export default function AuditPage({ token }: { token: string }) {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [audits, setAudits] = useState<AuditRes["audits"]>([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    api<AuditRes>(`/api/admin/audit?action=${encodeURIComponent(action)}&limit=${PAGE_SIZE}`, token).then((d) => {
      if (d.ok) {
        setAudits(d.audits);
        setTotal(d.total);
      }
    });
  }, [token, action]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <div className="admToolbar">
        <select className="admSelect" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">全部操作</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="admMiniBtn" onClick={load}>
          🔄 刷新
        </button>
        <span className="admCount">每条管理操作都会留痕（不可删除）</span>
      </div>

      <div className="admTableWrap">
        <table className="admTable">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作人</th>
              <th>操作</th>
              <th>对象</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id}>
                <td>{fmtTime(a.ts)}</td>
                <td>
                  <b>👑 {a.adminName}</b>
                </td>
                <td>
                  <span className="admBadge kind-audit">{ACTION_LABEL[a.action] ?? a.action}</span>
                </td>
                <td>
                  {a.targetType && <span className="admVariant">{a.targetType}</span>}
                  {a.targetId && <div className="admId">{a.targetId}</div>}
                </td>
                <td>{a.detail}</td>
              </tr>
            ))}
            {audits.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <Empty text="还没有管理操作记录" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </>
  );
}
