// 用户管理：多条件筛选 + 批量操作 + 用户详情抽屉
import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, post, type UserDetailRes, type UsersRes } from "../api";
import { Badge, BulkBar, Checkbox, Drawer, Empty, Pagination } from "../components";

const PAGE_SIZE = 20;

export default function Users({ token, push }: { token: string; push: (t: string, k?: "ok" | "err") => void }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [banned, setBanned] = useState("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<UsersRes["users"]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<UserDetailRes | null>(null);

  const load = useCallback(() => {
    api<UsersRes>(
      `/api/admin/users?q=${encodeURIComponent(q)}&role=${role}&banned=${banned}&limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
      token
    ).then((d) => {
      if (d.ok) {
        setUsers(d.users);
        setTotal(d.total);
      }
    });
  }, [token, q, role, banned, page]);

  useEffect(() => {
    const t = setTimeout(load, 220);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const allOn = users.length > 0 && users.every((u) => selected.has(u.id));

  const bulk = async (action: string, value?: string) => {
    const ids = [...selected];
    if (!ids.length) return;
    const label = action === "ban" ? "封禁" : action === "unban" ? "解封" : "设为管理员";
    if (!confirm(`确认${label}选中的 ${ids.length} 个用户？`)) return;
    const d = await post<{ ok: boolean; affected: number; failed?: number; reason?: string }>(
      "/api/admin/users/bulk",
      token,
      { ids, action, value }
    );
    if (!d.ok) return push(d.reason || "操作失败", "err");
    push(`已${label} ${d.affected} 个用户${d.failed ? `，${d.failed} 个跳过` : ""}`);
    setSelected(new Set());
    load();
  };

  const openDetail = async (id: string) => {
    const d = await api<UserDetailRes>(`/api/admin/users/${id}/detail`, token);
    if (d.ok) setDetail(d);
    else push(d.reason || "加载失败", "err");
  };

  return (
    <>
      <div className="admToolbar">
        <input
          className="admInput"
          placeholder="搜索用户名 / ID…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select className="admSelect" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">全部角色</option>
          <option value="admin">管理员</option>
          <option value="user">玩家</option>
        </select>
        <select className="admSelect" value={banned} onChange={(e) => { setBanned(e.target.value); setPage(1); }}>
          <option value="">全部状态</option>
          <option value="0">正常</option>
          <option value="1">已封禁</option>
        </select>
        <button className="admMiniBtn" onClick={load}>
          🔄 刷新
        </button>
      </div>

      <BulkBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={
          <>
            <button className="admMiniBtn danger" onClick={() => void bulk("ban")}>
              🚫 批量封禁
            </button>
            <button className="admMiniBtn" onClick={() => void bulk("unban")}>
              ♻️ 批量解封
            </button>
            <button className="admMiniBtn" onClick={() => void bulk("role", "admin")}>
              👑 设为管理员
            </button>
          </>
        }
      />

      <div className="admTableWrap">
        <table className="admTable">
          <thead>
            <tr>
              <th className="w-check">
                <Checkbox checked={allOn} onChange={(v) => setSelected(v ? new Set(users.map((u) => u.id)) : new Set())} />
              </th>
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
                  <Checkbox checked={selected.has(u.id)} onChange={(v) => toggle(u.id, v)} />
                </td>
                <td>
                  <b className="link" onClick={() => void openDetail(u.id)}>
                    {u.name}
                  </b>
                  {u.online && <span className="admOnlineDot" title="在线" />}
                  <div className="admId">{u.id}</div>
                </td>
                <td>{u.role === "admin" ? "👑 管理员" : "玩家"}</td>
                <td>{u.banned ? <Badge kind="banned" text="已封禁" /> : <Badge kind="ok" text="正常" />}</td>
                <td>{fmtTime(u.createdAt)}</td>
                <td>{fmtTime(u.lastLoginAt)}</td>
                <td className="admOps">
                  <button className="admMiniBtn" onClick={() => void openDetail(u.id)}>
                    详情
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <Empty text="没有匹配的用户" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      <Drawer
        open={!!detail}
        title={detail?.user.name ?? ""}
        subtitle={detail?.user.id}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <div className="admDetailGrid">
              <div>
                <span>角色</span>
                <b>{detail.user.role === "admin" ? "管理员" : "玩家"}</b>
              </div>
              <div>
                <span>状态</span>
                <b>{detail.user.banned ? "已封禁" : "正常"}</b>
              </div>
              <div>
                <span>注册</span>
                <b>{fmtTime(detail.user.createdAt)}</b>
              </div>
              <div>
                <span>最近登录</span>
                <b>{fmtTime(detail.user.lastLoginAt)}</b>
              </div>
              <div>
                <span>在线位置</span>
                <b>{detail.online ? `(${detail.online.x}, ${detail.online.z})` : "离线"}</b>
              </div>
              <div>
                <span>所属造物</span>
                <b>{detail.objects.length} 件</b>
              </div>
              <div>
                <span>Agent 大脑</span>
                <b>
                  {detail.llm ? (
                    <>
                      {detail.llm.enabled ? "🧠" : "⏸"} {detail.llm.provider}/{detail.llm.model}
                    </>
                  ) : (
                    "未配置"
                  )}
                </b>
              </div>
            </div>
            <div className="admDetailSection">
              <div className="admDetailSectionTitle">名下造物（{detail.objects.length}）</div>
              {detail.objects.map((o) => (
                <div key={o.id} className="admDetailRow">
                  <span className="admDetailRowTitle">
                    {o.kind} {o.variant}
                  </span>
                  <span className="admDetailRowSub">
                    ({Math.round(o.x)}, {Math.round(o.z)}) · {fmtTime(o.createdAt)}
                  </span>
                </div>
              ))}
              {detail.objects.length === 0 && <Empty />}
            </div>
            <div className="admDetailSection">
              <div className="admDetailSectionTitle">近期发言（{detail.chats.length}）</div>
              {detail.chats.map((c) => (
                <div key={c.id} className="admDetailRow">
                  <span className="admDetailRowTitle">{c.text}</span>
                  <span className="admDetailRowSub">{fmtTime(c.ts)}</span>
                </div>
              ))}
              {detail.chats.length === 0 && <Empty />}
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}
