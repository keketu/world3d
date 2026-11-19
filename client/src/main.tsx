import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AdminApp from "./admin/AdminApp";
import MeApp from "./me/MeApp";
import "./index.css";

// /admin → 后台管理；/me → 个人面板；其余 → 3D 世界
// （SPA fallback 已覆盖任意路径，服务端无需额外路由）
const path = typeof location !== "undefined" ? location.pathname : "/";
const isAdmin = path.startsWith("/admin");
const isMe = path.startsWith("/me");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isAdmin ? <AdminApp /> : isMe ? <MeApp /> : <App />}</React.StrictMode>
);
