// Office 房间 UI：派项目 + 迷你看板 + 对话流（office3d BossPanel/Kanban 的 world3d 移植）
import { useState } from "react";
import { useWorld } from "../state/store";
import { sendRoomAssign, sendRoomSay } from "../net/socket";

const PRESETS = [
  "改版公司官网首页",
  "做一款记账小程序",
  "设计周年庆海报",
  "搭建销售数据大屏",
  "策划618促销活动",
];

const STATUS_ZH: Record<string, { label: string; cls: string }> = {
  queued: { label: "排队中", cls: "st-queued" },
  planning: { label: "规划中", cls: "st-planning" },
  in_progress: { label: "进行中", cls: "st-doing" },
  meeting: { label: "会议中", cls: "st-meeting" },
  reporting: { label: "汇报中", cls: "st-reporting" },
  done: { label: "已完成", cls: "st-done" },
  paused: { label: "已暂停", cls: "st-paused" },
};

const ACTIVITY_ZH: Record<string, string> = {
  idle: "发呆中",
  walking: "走动中",
  talking: "交谈中",
  working: "工作中",
  meeting: "会议中",
  coffee: "咖啡☕",
};

export function OfficePanel() {
  const inRoom = useWorld((s) => s.inRoom);
  const open = useWorld((s) => s.roomPanelOpen);
  const toggle = useWorld((s) => s.toggleRoomPanel);
  const agents = useWorld((s) => s.agents);
  const projects = useWorld((s) => s.projects);
  const tasks = useWorld((s) => s.tasks);
  const progress = useWorld((s) => s.progress);
  const dialogues = useWorld((s) => s.roomDialogues);
  const [tab, setTab] = useState<"assign" | "board">("assign");
  const [brief, setBrief] = useState("");

  if (!inRoom) return null;
  if (!open) {
    return (
      <button className="officeFab" onClick={toggle} title="派项目 / 看板（E）">
        📋
      </button>
    );
  }

  const active = projects.filter((p) => p.status !== "done").slice(-3);
  const done = projects.filter((p) => p.status === "done").slice(-4).reverse();
  const recentLines = dialogues.slice(-9);

  const assign = (b: string) => {
    const t = b.trim();
    if (!t) return;
    sendRoomAssign(t);
    setBrief("");
    useWorld.getState().pushToast(`📋 已派给林晓 PM：「${t.slice(0, 14)}」`);
  };

  const now = Date.now();
  return (
    <div className="officePanel">
      <div className="officeHead" onClick={toggle} title="收起">
        <span>🏢 办公室 · 小世界科技</span>
        <span className="officeClose">收起 ▾</span>
      </div>
      <div className="officeTabs">
        <button className={`officeTab ${tab === "assign" ? "on" : ""}`} onClick={() => setTab("assign")}>
          派项目
        </button>
        <button className={`officeTab ${tab === "board" ? "on" : ""}`} onClick={() => setTab("board")}>
          看板
        </button>
      </div>

      {tab === "assign" && (
        <div className="officeBody">
          <div className="officeChips">
            {PRESETS.map((p) => (
              <button key={p} className="chip" onClick={() => assign(p)}>
                {p}
              </button>
            ))}
          </div>
          <div className="officeAssignRow">
            <input
              className="officeInput"
              placeholder="或者对老板说点别的…"
              maxLength={60}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") assign(brief);
                e.stopPropagation();
              }}
            />
            <button className="officeSend" onClick={() => assign(brief)}>
              派发
            </button>
          </div>
          <div className="officeAgents">
            {agents.map((a) => (
              <span key={a.id} className={`agentDot ${a.activity}`}>
                <i style={{ background: a.color }} />
                {a.name.replace(" PM", "")}·{ACTIVITY_ZH[a.activity] ?? a.activity}
              </span>
            ))}
          </div>
        </div>
      )}

      {tab === "board" && (
        <div className="officeBody officeBoard">
          {active.length === 0 && done.length === 0 && <div className="officeEmpty">还没有项目，去「派项目」下单吧</div>}
          {[...active, ...done].map((p) => {
            const st = STATUS_ZH[p.status] ?? { label: p.status, cls: "st-queued" };
            const ptasks = tasks.filter((t) => t.projectId === p.id);
            return (
              <div key={p.id} className="projCard">
                <div className="projRow">
                  <b>{p.name}</b>
                  <span className={`projStatus ${st.cls}`}>{st.label}</span>
                </div>
                {ptasks.map((t) => {
                  const prog = progress[t.id];
                  let pct: number | null = null;
                  if (t.status === "done") pct = 100;
                  else if (prog && prog.endsAt > now) pct = Math.min(99, Math.floor(((now - prog.startedAt) / (prog.endsAt - prog.startedAt)) * 100));
                  const who = agents.find((a) => a.id === t.assigneeId)?.name ?? "";
                  return (
                    <div key={t.id} className="taskRow">
                      <span className="taskTitle">
                        {t.title}
                        {who && <i className="taskWho">{who}</i>}
                      </span>
                      {pct !== null && (
                        <span className="taskBar">
                          <i style={{ width: `${pct}%` }} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div className="officeLog">
        {recentLines.map((l) => {
          const a = agents.find((x) => x.id === l.agentId);
          return (
            <div key={l.id} className="logLine">
              <i style={{ background: a?.color ?? "#999" }} />
              <b>{a?.name ?? l.agentId}</b>
              {l.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
