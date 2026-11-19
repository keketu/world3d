// 后台共用组件：详情抽屉 / Toast / 分页 / 批量工具条 / 空态
import { ReactNode, useEffect, useState } from "react";

/* ---------- 详情抽屉 ---------- */

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="admDrawerMask" onClick={onClose} />
      <aside className="admDrawer">
        <header className="admDrawerHead">
          <div>
            <div className="admDrawerTitle">{title}</div>
            {subtitle && <div className="admDrawerSub">{subtitle}</div>}
          </div>
          <button className="admIconBtn" onClick={onClose} title="关闭">
            ✕
          </button>
        </header>
        <div className="admDrawerBody">{children}</div>
      </aside>
    </>
  );
}

/* ---------- Toast ---------- */

export interface ToastItem {
  id: number;
  text: string;
  kind: "ok" | "err";
}

export function ToastHost({ items }: { items: ToastItem[] }) {
  return (
    <div className="admToastHost">
      {items.map((t) => (
        <div key={t.id} className={`admToast kind-${t.kind}`}>
          {t.kind === "ok" ? "✅" : "⚠️"} {t.text}
        </div>
      ))}
    </div>
  );
}

/** 轻量 toast 管理器 */
export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = (text: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-3), { id, text, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
  };
  return { items, push };
}

/* ---------- 分页 ---------- */

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="admPager"><span className="admCount">共 {total} 条</span></div>;
  return (
    <div className="admPager">
      <span className="admCount">共 {total} 条</span>
      <div className="admPagerBtns">
        <button className="admMiniBtn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹
        </button>
        <span className="admPagerNum">
          {page} / {pages}
        </span>
        <button className="admMiniBtn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          ›
        </button>
      </div>
    </div>
  );
}

/* ---------- 批量工具条 ---------- */

export function BulkBar({
  count,
  actions,
  onClear,
}: {
  count: number;
  actions: ReactNode;
  onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div className="admBulkBar">
      <span className="admBulkCount">已选 {count} 项</span>
      <div className="admBulkActions">{actions}</div>
      <button className="admMiniBtn" onClick={onClear}>
        取消选择
      </button>
    </div>
  );
}

/* ---------- 空态 ---------- */

export function Empty({ text = "暂无数据" }: { text?: string }) {
  return <div className="admEmpty">{text}</div>;
}

/* ---------- 复选框 ---------- */

export function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className={`admCheck ${checked ? "on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      title={checked ? "取消选择" : "选择"}
    >
      {checked ? "✓" : ""}
    </button>
  );
}

/* ---------- 状态徽章 ---------- */

export function Badge({ kind, text }: { kind: string; text: string }) {
  return <span className={`admBadge kind-${kind}`}>{text}</span>;
}
