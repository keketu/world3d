// 个人面板（/me）：任何登录玩家可用 —— agent 任务 / 我的员工 / 我的聊天 / 我的造物与产权 / 活动时间线 / Agent 大脑
import { useCallback, useEffect, useState } from "react";
import type { ProjectInfo, TaskInfo, AuthUser } from "@world3d/shared";
import { api, fmtTime, fmtAgo } from "../admin/api";
import { Empty } from "../admin/components";
import { DonutChart } from "../admin/Charts";
import LlmTab from "./LlmTab";
import AgentsTab from "./AgentsTab";
import "./me.css";

interface Overview {
  ok: boolean;
  user: { id: string; name: string; role: string; createdAt: number; lastLoginAt: number | null };
  online: { x: number; z: number; roomId: string | null } | null;
  agentTasks: {
    projects: ProjectInfo[];
    tasks: Array<TaskInfo & { projectName: string }>;
    total: number;
    done: number;
    running: number;
    dialogues: Array<{ id: string; ts: number; agentId: string; text: string; kind: string }>;
  };
  chats: Array<{ id: number; ts: number; kind: string; from: string; fromId: string; text: string }>;
  objects: Array<{
    id: string;
    kind: string;
    variant: string;
    x: number;
    z: number;
    createdAt: number;
    sig: string;
    valid: boolean;
  }>;
  objectStats: {
    total: number;
    valid: number;
    broken: number;
    byKind: Array<{ label: string; value: number }>;
  };
  events: Array<{ id: number; ts: number; kind: string; actor: string; actorId: string; text: string }>;
  latestRoot: { root: string; count: number; createdAt: number } | null;
}

type Tab = "tasks" | "agents" | "llm" | "chats" | "objects" | "timeline";

export default function MePage({ token, user }: { token: string; user: AuthUser | null }) {
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>("tasks");
  const [chatQuery, setChatQuery] = useState("");

  const load = useCallback(() => {
    api<Overview>("/api/me/overview", token).then((d) => d.ok && setData(d));
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <div className="meEmpty">加载中…</div>;

  const tasks = data.agentTasks.tasks;
  const filteredChats = chatQuery
    ? data.chats.filter((c) => c.text.includes(chatQuery))
    : data.chats;

  return (
    <div className="meRoot">
      {/* 顶部：我的名片 */}
      <header className="meHero">
        <div className="meHeroAvatar">👤</div>
        <div className="meHeroInfo">
          <div className="meHeroName">
            {data.user.name}
            {data.user.role === "admin" && <span className="meHeroRole">👑 管理员</span>}
          </div>
          <div className="meHeroSub">
            {data.online ? (
              <span className="meHeroOn">● 在线 ({data.online.x}, {data.online.z})</span>
            ) : (
              <span>离线</span>
            )}
            <span>· 注册于 {fmtTime(data.user.createdAt)}</span>
            <span>· 最近登录 {fmtAgo(data.user.lastLoginAt)}</span>
          </div>
        </div>
        <div className="meHeroStats">
          <div className="meHeroStat">
            <b>{data.agentTasks.total}</b>
            <span>agent 任务</span>
          </div>
          <div className="meHeroStat">
            <b>{data.objectStats.total}</b>
            <span>我的造物</span>
          </div>
          <div className="meHeroStat">
            <b>{data.chats.length}</b>
            <span>我的发言</span>
          </div>
          <div className="meHeroStat">
            <b>{data.events.length}</b>
            <span>动态</span>
          </div>
        </div>
      </header>

      {/* 标签页 */}
      <nav className="meTabs">
        <button className={`meTab ${tab === "tasks" ? "on" : ""}`} onClick={() => setTab("tasks")}>
          🤖 agent 任务
          {data.agentTasks.running > 0 && <i className="meTabDot" />}
        </button>
        <button className={`meTab ${tab === "agents" ? "on" : ""}`} onClick={() => setTab("agents")}>
          🧑‍💼 我的员工
        </button>
        <button className={`meTab ${tab === "llm" ? "on" : ""}`} onClick={() => setTab("llm")}>
          🧠 Agent 大脑
        </button>
        <button className={`meTab ${tab === "chats" ? "on" : ""}`} onClick={() => setTab("chats")}>
          💬 我的聊天记录
        </button>
        <button className={`meTab ${tab === "objects" ? "on" : ""}`} onClick={() => setTab("objects")}>
          🏝 我的造物与产权
          {data.objectStats.broken > 0 && <i className="meTabDot warn" />}
        </button>
        <button className={`meTab ${tab === "timeline" ? "on" : ""}`} onClick={() => setTab("timeline")}>
          🕒 活动时间线
        </button>
      </nav>

      {/* ① agent 任务进度 */}
      {tab === "tasks" && (
        <div className="meGrid2">
          <div className="meCard">
            <div className="meCardHead">
              <b>任务进度</b>
              <span className="meCount">
                完成 {data.agentTasks.done}/{data.agentTasks.total}
                {data.agentTasks.running > 0 && ` · ${data.agentTasks.running} 个进行中`}
              </span>
            </div>
            <div className="meProgress">
              <div className="meProgressBar">
                <i style={{ width: `${data.agentTasks.total ? (data.agentTasks.done / data.agentTasks.total) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="meTaskList">
              {tasks.map((t) => (
                <div key={t.id} className="meTask">
                  <span className="meTaskIcon">
                    {t.status === "done" ? "✅" : t.status === "in_progress" ? "🔨" : "⏳"}
                  </span>
                  <div className="meTaskBody">
                    <div className="meTaskTitle">{t.title}</div>
                    <div className="meTaskSub">
                      {t.projectName || "独立任务"} · 负责 {t.assigneeId ?? "未派"}
                    </div>
                  </div>
                  <span className={`meTaskStatus st-${t.status}`}>{t.status}</span>
                </div>
              ))}
              {tasks.length === 0 && <Empty text="还没有 agent 任务 —— 去办公楼派个项目吧" />}
            </div>
          </div>

          <div className="meCard">
            <div className="meCardHead">
              <b>agent 最近的汇报</b>
              <span className="meCount">办公室对话记录</span>
            </div>
            <div className="meDialogue">
              {data.agentTasks.dialogues.map((d) => (
                <div key={d.id} className="meDialogueRow">
                  <span className="meDialogueAgent">{d.agentId}</span>
                  <span className="meDialogueText">{d.text}</span>
                  <span className="meDialogueTime">{fmtAgo(d.ts)}</span>
                </div>
              ))}
              {data.agentTasks.dialogues.length === 0 && <Empty text="还没有 agent 发言" />}
            </div>
          </div>
        </div>
      )}

      {/* ①.5 我的员工（雇佣/附身） */}
      {tab === "agents" && <AgentsTab token={token} />}

      {/* ①.6 Agent 大脑（自带 LLM 配置） */}
      {tab === "llm" && <LlmTab token={token} />}

      {/* ② 我的聊天记录 */}
      {tab === "chats" && (
        <div className="meCard">
          <div className="meCardHead">
            <b>我发过的消息</b>
            <input
              className="meSearch"
              placeholder="搜索我的发言…"
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
            />
          </div>
          <div className="meChatList">
            {filteredChats.map((c) => (
              <div key={c.id} className="meChatRow">
                <span className="meChatTs">{fmtTime(c.ts)}</span>
                <span className="meChatKind">{c.kind === "system" ? "系统" : "我"}</span>
                <span className="meChatText">{c.text}</span>
              </div>
            ))}
            {filteredChats.length === 0 && <Empty text="没有匹配的发言" />}
          </div>
        </div>
      )}

      {/* ③ 我的造物与产权 */}
      {tab === "objects" && (
        <div className="meGrid2">
          <div className="meCard">
            <div className="meCardHead">
              <b>我的造物（{data.objectStats.total}）</b>
              <span className="meCount">
                验章通过 {data.objectStats.valid}
                {data.objectStats.broken > 0 && ` · ⚠ ${data.objectStats.broken} 件异常`}
              </span>
            </div>
            <div className="meTableWrap">
              <table className="meTable">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>坐标</th>
                    <th>创建时间</th>
                    <th>产权验章</th>
                  </tr>
                </thead>
                <tbody>
                  {data.objects.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <b>{o.kind}</b> {o.variant && <span className="meVariant">{o.variant}</span>}
                      </td>
                      <td>
                        ({Math.round(o.x)}, {Math.round(o.z)})
                      </td>
                      <td>{fmtTime(o.createdAt)}</td>
                      <td>
                        {o.valid ? (
                          <span className="meVerify ok">✅ 已存证</span>
                        ) : (
                          <span className="meVerify bad">❌ 异常</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.objects.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <Empty text="还没有造物 —— 去岛上种点东西吧" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="meCard">
            <div className="meCardHead">
              <b>造物类型分布</b>
            </div>
            {data.objectStats.byKind.length ? (
              <DonutChart data={data.objectStats.byKind} centerLabel={String(data.objectStats.total)} centerSub="件造物" />
            ) : (
              <Empty />
            )}
            {data.latestRoot && (
              <>
                <div className="meCardHead" style={{ marginTop: 14 }}>
                  <b>全岛公示存证根</b>
                </div>
                <code className="meHash">{data.latestRoot.root}</code>
                <div className="meCount">覆盖 {data.latestRoot.count} 件 · {fmtAgo(data.latestRoot.createdAt)}</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ④ 活动时间线 */}
      {tab === "timeline" && (
        <div className="meCard">
          <div className="meCardHead">
            <b>我的动态</b>
            <span className="meCount">最近 {data.events.length} 条</span>
          </div>
          <div className="meTimeline">
            {data.events.map((e) => (
              <div key={e.id} className="meTlRow">
                <span className="meTlTime">{fmtTime(e.ts)}</span>
                <span className={`meTlKind kind-${e.kind}`}>{e.kind}</span>
                <span className="meTlText">{e.text}</span>
              </div>
            ))}
            {data.events.length === 0 && <Empty text="还没有活动记录" />}
          </div>
        </div>
      )}
    </div>
  );
}
