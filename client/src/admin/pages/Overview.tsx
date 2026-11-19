// 实时总览：指标卡 + 趋势图表 + 在线玩家 + 实时事件流
import { useCallback, useEffect, useState } from "react";
import { api, fmtAgo, fmtShort } from "../api";
import type { OverviewRes } from "../api";
import { realtime, type AdminEvent } from "../realtime";
import { AreaChart, BarChart, DonutChart } from "../Charts";
import type { PageId } from "../AdminApp";

export default function Overview({
  token,
  onNavigate,
  push,
}: {
  token: string;
  onNavigate: (p: PageId) => void;
  push: (t: string, k?: "ok" | "err") => void;
}) {
  const [data, setData] = useState<OverviewRes["overview"] | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    api<OverviewRes>("/api/admin/overview", token).then((d) => d.ok && setData(d.overview));
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  // 实时事件流：先拉历史再订阅（避免切页时错过事件）
  useEffect(() => {
    api<{ ok: boolean; events: Array<{ id: number; ts: number; kind: string; actor: string; actorId: string; text: string }> }>(
      "/api/admin/events?limit=40",
      token
    ).then((d) => {
      if (d.ok) {
        // 服务端按 id 倒序返回 → 反转成时间正序
        setEvents(d.events.slice().reverse().map((e) => ({ ...e })));
      }
    });
    const off = realtime.onEvent((e) => {
      setEvents((prev) => [e, ...prev].slice(0, 40));
    });
    return off;
  }, [token]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="admEmpty">加载中…</div>;

  const trendSeries = [
    {
      name: "注册",
      color: "#f291a9",
      points: data.trends.map((t, i) => ({ x: i, y: t.users, label: t.day })),
    },
    {
      name: "造物",
      color: "#7fb98a",
      points: data.trends.map((t, i) => ({ x: i, y: t.objects, label: t.day })),
    },
  ];
  const xLabels = data.trends.map((t) => t.day.slice(5));
  const onlineSeries = [
    {
      name: "在线",
      color: "#f0a85c",
      points: data.onlineTrend.map((p, i) => ({ x: i, y: p.count, label: fmtShort(p.minute) })),
    },
  ];
  const chatBars = data.trends.map((t) => ({ label: t.day.slice(5), value: t.chats }));

  const cards = [
    { label: "注册用户", value: data.users, sub: `今日 +${data.todayNewUsers}`, icon: "👥", tone: "sakura" },
    { label: "当前在线", value: data.online, sub: `其中游客 ${data.guestsOnline}`, icon: "🟢", tone: "matcha" },
    { label: "世界造物", value: data.objects, sub: `今日 +${data.todayNewObjects}`, icon: "🏝", tone: "mikan" },
    { label: "今日聊天", value: data.chatsToday, sub: `近 1 分钟 ${data.chatRate} 条`, icon: "💬", tone: "berry" },
  ];

  return (
    <>
      <div className="admStatGrid">
        {cards.map((c) => (
          <div key={c.label} className={`admStatCard tone-${c.tone}`}>
            <div className="admStatLabel">
              <span className="admStatIcon">{c.icon}</span> {c.label}
            </div>
            <div className="admStatValue">{c.value}</div>
            <div className="admStatSub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="admGrid2">
        <div className="admCard">
          <div className="admCardHead">
            <b>注册 / 造物趋势</b>
            <span className="admCount">近 14 天</span>
          </div>
          <AreaChart series={trendSeries} xLabels={xLabels} />
          <div className="admChartLegend">
            <span><i style={{ background: "#f291a9" }} />注册</span>
            <span><i style={{ background: "#7fb98a" }} />造物</span>
          </div>
        </div>

        <div className="admCard">
          <div className="admCardHead">
            <b>造物类型分布</b>
            <button className="admMiniBtn" onClick={() => onNavigate("objects")}>
              查看全部 →
            </button>
          </div>
          {data.objectKinds.length ? (
            <DonutChart
              data={data.objectKinds.slice(0, 6)}
              centerLabel={String(data.objects)}
              centerSub="件造物"
            />
          ) : (
            <div className="admEmpty">还没有造物</div>
          )}
        </div>
      </div>

      <div className="admGrid2">
        <div className="admCard">
          <div className="admCardHead">
            <b>在线人数</b>
            <span className="admCount">近 2 小时（事件回放）</span>
          </div>
          <AreaChart series={onlineSeries} height={150} />
        </div>
        <div className="admCard">
          <div className="admCardHead">
            <b>聊天活跃度</b>
            <span className="admCount">近 14 天</span>
          </div>
          <BarChart data={chatBars} height={150} color="#b98ad1" />
        </div>
      </div>

      <div className="admGrid2">
        <div className="admCard">
          <div className="admCardHead">
            <b>贡献者排行</b>
            <span className="admCount">按造物数</span>
          </div>
          {data.topCreators.length ? (
            <div className="admRankList">
              {data.topCreators.map((c, i) => (
                <div key={c.label} className="admRankRow">
                  <span className={`admRankNo r${i + 1}`}>{i + 1}</span>
                  <span className="admRankName">{c.label}</span>
                  <span className="admRankVal">{c.value} 件</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="admEmpty">还没有数据</div>
          )}
        </div>

        <div className="admCard">
          <div className="admCardHead">
            <b>实时事件流</b>
            <span className="admLive mini on">
              <i className="admLiveDot" />实时
            </span>
          </div>
          <div className="admEventFeed">
            {events.length === 0 && <div className="admEmpty">等待事件…（进入世界试试）</div>}
            {events.map((e, i) => (
              <div key={`${e.ts}-${i}`} className="admEventRow">
                <span className="admEventTime">{fmtShort(e.ts)}</span>
                <span className={`admEventKind kind-${e.kind}`}>{e.kind}</span>
                <span className="admEventText">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.latestRoot && (
        <div className="admCard">
          <div className="admCardHead">
            <b>🔐 最新产权存证根</b>
            <button className="admMiniBtn" onClick={() => onNavigate("attest")}>
              完整性对账 →
            </button>
          </div>
          <code className="admHash">{data.latestRoot.root}</code>
          <div className="admStatSub">
            覆盖 {data.latestRoot.count} 件造物 · 发布于 {fmtAgo(data.latestRoot.createdAt)}
          </div>
        </div>
      )}
    </>
  );
}
