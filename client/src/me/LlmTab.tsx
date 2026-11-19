// 🧠 Agent 大脑：配置自己的大模型（DeepSeek/GLM/MiniMax/GPT/Qwen/自定义兼容接口）
// API Key 只提交给服务器加密保存，回读永远是打码尾号
import { useCallback, useEffect, useState } from "react";
import { api, del, post, put, fmtTime } from "../admin/api";

interface ProviderDef {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  keyHint: string;
  note: string;
}

interface LlmConfigStatus {
  provider: string;
  model: string;
  baseUrl: string;
  persona: string;
  temperature: number;
  enabled: boolean;
  hasKey: boolean;
  keyMask: string;
  updatedAt: number;
}

interface LlmRes {
  ok: boolean;
  reason?: string;
  providers?: ProviderDef[];
  config?: LlmConfigStatus | null;
}

interface TestRes {
  ok: boolean;
  reason?: string;
  latencyMs?: number;
  model?: string;
  reply?: string;
}

interface ModelsRes {
  ok: boolean;
  reason?: string;
  models?: string[];
  live?: boolean;
}

const MANUAL = "__manual__";

export default function LlmTab({ token }: { token: string }) {
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [status, setStatus] = useState<LlmConfigStatus | null>(null);
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("deepseek-chat");
  const [manualModel, setManualModel] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [persona, setPersona] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<"" | "save" | "test" | "clear" | "models">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [testRes, setTestRes] = useState<TestRes | null>(null);
  const [liveModels, setLiveModels] = useState<string[] | null>(null);
  const [modelSrc, setModelSrc] = useState<string | null>(null);

  const applyModels = (res: ModelsRes) => {
    if (res.ok && res.models?.length) {
      setLiveModels(res.models);
      setModelSrc(res.live ? `已从厂商拉取全部 ${res.models.length} 个模型` : res.reason ?? "使用常见模型列表");
      return true;
    }
    return false;
  };

  const load = useCallback(async () => {
    const d = await api<LlmRes>("/api/me/llm", token);
    if (!d.ok) return;
    setProviders(d.providers ?? []);
    const c = d.config ?? null;
    setStatus(c);
    if (c) {
      setProvider(c.provider);
      setModel(c.model);
      setManualModel(!(d.providers ?? []).find((p) => p.id === c.provider)?.models.includes(c.model));
      setBaseUrl(c.provider === "custom" ? c.baseUrl : "");
      setPersona(c.persona);
      setTemperature(c.temperature);
      setEnabled(c.enabled);
      // 已有密钥：进页自动拉一次真实模型列表（失败静默回落，不提示报错）
      if (c.hasKey) {
        const m = await post<ModelsRes>("/api/me/llm/models", token, {
          provider: c.provider,
          baseUrl: c.provider === "custom" ? c.baseUrl : undefined,
        }).catch(() => null);
        // 拉到真列表 → 模型行切回下拉；已存模型不在列表里则显示「手动输入」选中态（不静默改配置）
        if (m && applyModels(m)) setManualModel(false);
      }
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const def = providers.find((p) => p.id === provider);
  const models = liveModels ?? def?.models ?? [];

  const switchProvider = (id: string) => {
    setProvider(id);
    const d = providers.find((p) => p.id === id);
    setModel(d?.models[0] ?? "");
    setManualModel(!(d?.models ?? []).length);
    setBaseUrl("");
    setTestRes(null);
    setMsg(null);
    setLiveModels(null);
    setModelSrc(null);
  };

  const save = async () => {
    setBusy("save");
    setMsg(null);
    const d = await put<LlmRes>(
      "/api/me/llm",
      token,
      {
        provider,
        model,
        baseUrl: provider === "custom" ? baseUrl : undefined,
        apiKey: apiKey || undefined,
        persona,
        temperature,
        enabled,
      }
    );
    setBusy("");
    if (d.ok) {
      setApiKey("");
      setMsg({ kind: "ok", text: "已保存 ✅ 配置立即生效（无需重启）" });
      await load();
    } else {
      setMsg({ kind: "err", text: d.reason ?? "保存失败" });
    }
  };

  const test = async () => {
    setBusy("test");
    setMsg(null);
    setTestRes(null);
    const d = await post<TestRes>(
      "/api/me/llm/test",
      token,
      { provider, model, baseUrl: provider === "custom" ? baseUrl : undefined, apiKey: apiKey || undefined }
    );
    setBusy("");
    setTestRes(d);
  };

  // 用 Key（刚输入未保存的也行）从厂商 GET /models 拉真实模型列表
  const fetchModels = async () => {
    setBusy("models");
    setMsg(null);
    const d = await post<ModelsRes>(
      "/api/me/llm/models",
      token,
      { provider, baseUrl: provider === "custom" ? baseUrl : undefined, apiKey: apiKey || undefined }
    );
    setBusy("");
    if (applyModels(d)) {
      // 拉到真列表后，当前选中的模型不在列表里就切到第一个
      setManualModel(false);
      setModel((cur) => (d.models!.includes(cur) ? cur : d.models![0]));
    } else {
      setMsg({ kind: "err", text: d.reason ?? "拉取失败（Key 对吗？）" });
    }
  };

  const clear = async () => {
    if (!window.confirm("确定清除配置吗？连加密保存的 API Key 一起删除，agent 将回到内置剧本。")) return;
    setBusy("clear");
    const d = await del<LlmRes>("/api/me/llm", token);
    setBusy("");
    if (d.ok) {
      setMsg({ kind: "ok", text: "已清除，agent 回到内置剧本" });
      setApiKey("");
      setTestRes(null);
      await load();
    } else {
      setMsg({ kind: "err", text: d.reason ?? "清除失败" });
    }
  };

  return (
    <div className="meGrid2">
      <div className="meCard">
        <div className="meCardHead">
          <b>🧠 模型配置</b>
          {status && (
            <span className="meCount">
              {status.enabled ? "🟢 已启用" : "⏸ 已停用"} · {status.provider}/{status.model}
              {status.hasKey && ` · 密钥 ${status.keyMask}`}
              {` · 更新于 ${fmtTime(status.updatedAt)}`}
            </span>
          )}
        </div>

        <div className="llmForm">
          <label className="llmRow">
            <span className="llmLabel">大模型厂商</span>
            <select className="llmSelect" value={provider} onChange={(e) => switchProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {def?.note && <div className="llmHint">{def.note}</div>}

          <label className="llmRow">
            <span className="llmLabel">模型</span>
            {manualModel || models.length === 0 ? (
              <input
                className="llmInput"
                placeholder="模型名，如 my-model-v1"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            ) : (
              <select
                className="llmSelect"
                value={models.includes(model) ? model : MANUAL}
                onChange={(e) => {
                  if (e.target.value === MANUAL) {
                    setManualModel(true);
                    setModel("");
                  } else {
                    setModel(e.target.value);
                  }
                }}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={MANUAL}>✏️ 手动输入…</option>
              </select>
            )}
          </label>

          <div className="llmHint llmModelSrc">
            <button className="llmBtn mini" disabled={busy !== ""} onClick={fetchModels} title="用 API Key 从厂商接口拉取真实模型列表">
              {busy === "models" ? "拉取中…" : "⟳ 拉取真实模型列表"}
            </button>
            {modelSrc && <span>{modelSrc}</span>}
          </div>

          {provider === "custom" && (
            <label className="llmRow">
              <span className="llmLabel">接口基址</span>
              <input
                className="llmInput"
                placeholder="https://your-llm-proxy/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
          )}

          <label className="llmRow">
            <span className="llmLabel">API Key</span>
            <input
              className="llmInput"
              type="password"
              autoComplete="new-password"
              placeholder={status?.hasKey ? `已保存 ${status.keyMask}，留空则不修改` : def?.keyHint ?? "你的密钥"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>

          <label className="llmRow">
            <span className="llmLabel">性格温度 {temperature.toFixed(1)}</span>
            <input
              className="llmRange"
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
          </label>
          <div className="llmHint">温度越低回答越稳重，越高越跳脱（0.7 上下比较像活人）</div>

          <label className="llmRow llmRowTop">
            <span className="llmLabel">Agent 人设（可选）</span>
            <textarea
              className="llmArea"
              rows={2}
              maxLength={200}
              placeholder="比如：说话带点冷幽默，喜欢用比喻，偶尔提到岛上的樱花"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
            />
          </label>

          <label className="llmSwitch">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="llmSwitchBox" />
            启用：办公室 agent 的对话与项目全流程由我的模型驱动
          </label>

          <div className="llmBtns">
            <button className="llmBtn primary" disabled={busy !== "" || !model} onClick={save}>
              {busy === "save" ? "保存中…" : "💾 保存配置"}
            </button>
            <button className="llmBtn" disabled={busy !== ""} onClick={test}>
              {busy === "test" ? "测试中…" : "🔌 测试连接"}
            </button>
            {status && (
              <button className="llmBtn danger" disabled={busy !== ""} onClick={clear}>
                🗑 清除配置
              </button>
            )}
          </div>

          {msg && <div className={`llmMsg ${msg.kind}`}>{msg.text}</div>}

          {testRes && (
            <div className={`llmTest ${testRes.ok ? "ok" : "bad"}`}>
              {testRes.ok ? (
                <>
                  ✅ 连接成功 · {testRes.model} · {testRes.latencyMs}ms
                  {testRes.reply && (
                    <>
                      {" "}
                      · 模型回复：<b>「{testRes.reply}」</b>
                    </>
                  )}
                </>
              ) : (
                <>❌ {testRes.reason}</>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="meCard">
        <div className="meCardHead">
          <b>它是怎么工作的？</b>
        </div>
        <div className="llmExplain">
          <p>
            <b>① 你配置的模型 = 你 agent 的大脑。</b>
            在办公楼里跟员工说话、派项目，他们的回应、任务拆解、讨论、会议发言、交付汇报都会由你选的模型现场生成，
            不再是固定台词。
          </p>
          <p>
            <b>② 密钥安全。</b>
            API Key 用 AES-256-GCM 加密后存在服务器数据库里，浏览器端永远只看到打码尾号（sk-***abcd），
            不会明文回传、不会写进日志。
          </p>
          <p>
            <b>③ 自动兜底。</b>
            没配置、停用、密钥失效或调用超时的时候，agent 自动切回内置剧本接话 —— 游戏永不卡壳。
          </p>
          <p>
            <b>④ 费用自理。</b>
            调用走你自己的厂商账号，按他们的计费；对话每条限制在 120 token 内，拆任务/会议也在 600 token 内，尽量省着用。
          </p>
          <p>
            <b>⑤ 游客不生效。</b>
            以游客身份进世界时不带大脑；注册并登录后再来配置。
          </p>
        </div>
        <div className="meCardHead" style={{ marginTop: 10 }}>
          <b>去哪里申请 Key？</b>
        </div>
        <div className="llmLinks">
          <span>DeepSeek → platform.deepseek.com</span>
          <span>智谱 GLM → open.bigmodel.cn（有免费额度的模型以官网为准）</span>
          <span>MiniMax → platform.minimax.cn</span>
          <span>OpenAI → platform.openai.com</span>
          <span>通义千问 → bailian.console.aliyun.com（新用户有免费额度）</span>
          <span>其他模型 → 选「自定义」，填任意 OpenAI 兼容接口基址</span>
        </div>
      </div>
    </div>
  );
}
