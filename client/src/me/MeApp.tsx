// 个人面板入口页（/me）：任何登录玩家可用
import { useEffect, useState } from "react";
import type { AuthUser } from "@world3d/shared";
import { TOKEN_KEY } from "../admin/api";
import MePage from "./MePage";
import "./me.css";

export default function MeApp() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      setReady(true);
      return;
    }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok) {
          setToken(t);
          setUser(d.user);
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="meEmpty">加载中…</div>;

  if (!token || !user) {
    return (
      <div className="meRoot">
        <div className="meCard" style={{ textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🎫</div>
          <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}>请先登录</div>
          <div className="meCount" style={{ marginBottom: 18 }}>
            个人面板需要登录账号 —— 游客的记录只在本次会话里
          </div>
          <a href="/" className="meLoginBtn">
            去登录 / 进入小世界 →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="meTopBar">
        <a href="/" className="meTopBrand">
          🌍 小世界
        </a>
        <span className="meTopTitle">我的小岛</span>
        <div className="meTopRight">
          <span className="meTopUser">
            👤 {user.name}
          </span>
          <a href="/admin" className="meTopLink">
            管理后台 →
          </a>
          <a href="/" className="meTopLink">
            回到小世界 →
          </a>
        </div>
      </div>
      <MePage token={token} user={user} />
    </div>
  );
}
