// 办公室项目：项目与任务进度
import { useEffect, useState } from "react";
import type { ProjectInfo, TaskInfo } from "@world3d/shared";
import { api, fmtTime } from "../api";
import { Empty } from "../components";

export default function Projects({ token }: { token: string }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);

  useEffect(() => {
    api<{ ok: boolean; projects: ProjectInfo[]; tasks: TaskInfo[] }>("/api/admin/projects", token).then((d) => {
      if (d.ok) {
        setProjects([...d.projects].reverse());
        setTasks(d.tasks);
      }
    });
  }, [token]);

  return (
    <>
      <div className="admToolbar">
        <span className="admCount">共 {projects.length} 个项目</span>
      </div>
      <div className="admProjList">
        {projects.map((p) => {
          const pt = tasks.filter((t) => t.projectId === p.id);
          const done = pt.filter((t) => t.status === "done").length;
          const pct = pt.length ? Math.round((done / pt.length) * 100) : 0;
          return (
            <div key={p.id} className="admProjCard">
              <div className="admProjHead">
                <b>{p.name}</b>
                <span className={`admProjStatus st-${p.status}`}>{p.status}</span>
              </div>
              <div className="admProjBrief">{p.brief}</div>
              <div className="admProgressBar">
                <i style={{ width: `${pct}%` }} />
                <span>{pct}%</span>
              </div>
              <div className="admTaskList">
                {pt.map((t) => (
                  <div key={t.id} className="admTask">
                    <span>{t.status === "done" ? "✅" : t.status === "in_progress" ? "🔨" : "⏳"}</span>
                    <span className="admTaskTitle">{t.title}</span>
                    <span className="admTaskWho">→ {t.assigneeId ?? "未派"}</span>
                  </div>
                ))}
              </div>
              <div className="admProjFoot">
                创建 {fmtTime(p.createdAt)}
                {p.finishedAt ? ` · 完成 ${fmtTime(p.finishedAt)}` : ""} · 任务 {done}/{pt.length}
              </div>
            </div>
          );
        })}
        {projects.length === 0 && <Empty text="还没有项目" />}
      </div>
    </>
  );
}
