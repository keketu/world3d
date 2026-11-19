// 系统运维：运行时/内存/数据库 + 实时日志终端
import { useEffect, useRef, useState } from "react";
import { api, fmtBytes, fmtDuration, fmtTime, type SystemRes } from "../api";
import { realtime, type AdminLogLine } from "../realtime";

export default function System({ token }: { token: string }) {
  const [info, setInfo] = useState<SystemRes["info"] | null>(null);
  const [logs, setLogs] = useState<AdminLogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      api<SystemRes>("/api/admin/system", token).then((d) => {
        if (d.ok) {
          setInfo(d.info);
          setLogs((prev) => (prev.length ? prev : d.logs ?? []));
        }
      });
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [token]);

  // 实时日志
  useEffect(() => {
    const off = realtime.onLog((l) => {
      setLogs((prev) => [...prev, l].slice(-400));
    });
    return off;
  }, []);

  useEffect(() => {
    if (autoScroll && termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [logs, autoScroll]);

  if (!info) return <div className="admEmpty">加载中…</div>;

  const memPct = Math.round((info.memory.rss / info.memory.system) * 100);
  const heapPct = Math.round((info.memory.heapUsed / info.memory.heapTotal) * 100);

  const rows = Object.entries(info.counts);

  return (
    <>
      <div className="admStatGrid">
        <div className="admStatCard tone-mikan">
          <div className="admStatLabel">
            <span className="admStatIcon">⏱️</span> 运行时长
          </div>
          <div className="admStatValue">{fmtDuration(info.uptime)}</div>
          <div className="admStatSub">启动于 {fmtTime(info.startedAt)}</div>
        </div>
        <div className="admStatCard tone-sakura">
          <div className="admStatLabel">
            <span className="admStatIcon">🧠</span> 内存占用
          </div>
          <div className="admStatValue">{fmtBytes(info.memory.rss)}</div>
          <div className="admStatSub">
            物理内存 {memPct}% · 堆 {heapPct}%
          </div>
        </div>
        <div className="admStatCard tone-matcha">
          <div className="admStatLabel">
            <span className="admStatIcon">💾</span> 数据库
          </div>
          <div className="admStatValue">{fmtBytes(info.dbSize)}</div>
          <div className="admStatSub">world.db（含 WAL）</div>
        </div>
        <div className="admStatCard tone-berry">
          <div className="admStatLabel">
            <span className="admStatIcon">🖥️</span> 运行环境
          </div>
          <div className="admStatValue" style={{ fontSize: 20 }}>
            {info.node}
          </div>
          <div className="admStatSub">
            {info.platform} · {info.cpu} 核
          </div>
        </div>
      </div>

      <div className="admGrid2">
        <div className="admCard">
          <div className="admCardHead">
            <b>数据表统计</b>
          </div>
          <div className="admTableCountGrid">
            {rows.map(([k, v]) => (
              <div key={k} className="admTableCount">
                <span className="admTableCountVal">{v}</span>
                <span className="admTableCountName">{k}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="admCard">
          <div className="admCardHead">
            <b>内存使用</b>
            <span className="admCount">heap {fmtBytes(info.memory.heapUsed)} / {fmtBytes(info.memory.heapTotal)}</span>
          </div>
          <div className="admMeter">
            <div className="admMeterRow">
              <span>RSS / 系统内存</span>
              <b>{memPct}%</b>
            </div>
            <div className="admMeterBar">
              <i style={{ width: `${Math.min(100, memPct)}%` }} />
            </div>
            <div className="admMeterRow">
              <span>V8 堆使用率</span>
              <b>{heapPct}%</b>
            </div>
            <div className="admMeterBar matcha">
              <i style={{ width: `${Math.min(100, heapPct)}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="admCard pad0">
        <div className="admCardHead">
          <b>实时日志终端</b>
          <label className="admAutoScroll">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            自动滚动
          </label>
          <button className="admMiniBtn" onClick={() => setLogs([])}>
            清屏
          </button>
        </div>
        <div className="admTerminal" ref={termRef}>
          {logs.map((l, i) => (
            <div key={`${l.ts}-${i}`} className={`admTermLine level-${l.level}`}>
              <span className="admTermTs">{fmtTime(l.ts).slice(11)}</span>
              <span className="admTermLevel">{l.level.toUpperCase()}</span>
              <span className="admTermText">{l.text}</span>
            </div>
          ))}
          {logs.length === 0 && <div className="admTermEmpty">等待日志…</div>}
        </div>
      </div>
    </>
  );
}
