// 用户自带大模型（BYO-LLM）：主流厂商注册表 + OpenAI 兼容 chat/completions 调用
// API Key 用 AES-256-GCM 加密落库（密钥从 data/secret.key 派生），绝不回传浏览器
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ---------- 厂商注册表（全部走 OpenAI 兼容协议，一个调用路径通吃） ----------

export interface LlmProviderDef {
  id: string;
  label: string;
  /** OpenAI 兼容基址（custom 由用户填写） */
  baseUrl: string;
  /** chat/completions 相对路径（MiniMax v2 是 /text/chatcompletion_v2） */
  chatPath: string;
  models: string[];
  keyHint: string;
  note: string;
}

export const LLM_PROVIDERS: LlmProviderDef[] = [
  {
    id: "deepseek",
    label: "DeepSeek 深度求索",
    baseUrl: "https://api.deepseek.com/v1",
    chatPath: "/chat/completions",
    // 兜底常见列表（2026-11 官方文档核对）；填好 Key 后以「拉取列表」为准
    models: ["deepseek-flash", "deepseek-v4-pro"],
    keyHint: "sk- 开头，DeepSeek 开放平台申请",
    note: "性价比高，中文对话自然",
  },
  {
    id: "glm",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    chatPath: "/chat/completions",
    models: ["glm-5.3-flash", "glm-5.3-flashx", "glm-5.3-flashx-legal"],
    keyHint: "bigmodel.cn 控制台 API Key",
    note: "GLM-5.3 系列，中文对话自然",
  },
  {
    id: "minimax",
    label: "MiniMax",
    // 2026-11：平台迁到 api.minimax.cn，新推标准 OpenAI 兼容 /chat/completions（旧 minimaxi.com/text/chatcompletion_v2 已废弃）
    baseUrl: "https://api.minimax.cn/v1",
    chatPath: "/chat/completions",
    models: ["MiniMax-M3.1-Flash", "MiniMax-M3"],
    keyHint: "MiniMax 开放平台（platform.minimax.cn）API Key",
    note: "Agent 推理能力强，模型列表以拉取为准",
  },
  {
    id: "openai",
    label: "OpenAI GPT",
    baseUrl: "https://api.openai.com/v1",
    chatPath: "/chat/completions",
    models: ["gpt-5.2", "gpt-5.1", "gpt-5-mini", "gpt-5-nano"],
    keyHint: "sk- 开头，OpenAI 平台申请",
    note: "需要能访问 OpenAI 的网络",
  },
  {
    id: "qwen",
    label: "阿里通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    chatPath: "/chat/completions",
    models: ["qwen4-max", "qwen3.7-plus", "qwen3.8-flash"],
    keyHint: "sk- 开头，阿里云百炼申请",
    note: "国内直连，新用户有免费额度",
  },
  {
    id: "custom",
    label: "自定义（任意 OpenAI 兼容接口）",
    baseUrl: "",
    chatPath: "/chat/completions",
    models: [],
    keyHint: "你的服务密钥",
    note: "填接口基址，如 https://your-proxy/v1（兼容 /chat/completions 即可）",
  },
];

export function providerById(id: string): LlmProviderDef | null {
  return LLM_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** 给客户端的公开注册表（不含内部细节） */
export function publicProviders() {
  return LLM_PROVIDERS.map(({ id, label, baseUrl, models, keyHint, note }) => ({
    id,
    label,
    baseUrl,
    models,
    keyHint,
    note,
  }));
}

// ---------- API Key 加密存储（AES-256-GCM，密钥从 data/secret.key 派生） ----------

let aesKey: Buffer | null = null;

/** 与 auth.ts 的 HMAC 密钥同源：直接对 secret.key 文件字节做 SHA-256 派生对称密钥 */
export function initLlmCrypto(dataDir: string) {
  const keyPath = path.join(dataDir, "secret.key");
  aesKey = createHash("sha256").update(fs.readFileSync(keyPath)).digest();
}

export function encryptApiKey(plain: string): string {
  if (!aesKey) throw new Error("LLM 加密未初始化");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptApiKey(enc: string): string | null {
  try {
    if (!aesKey) return null;
    const [v, ivB64, tagB64, ctB64] = enc.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(ivB64, "base64"));
    d.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([d.update(Buffer.from(ctB64, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** 打码提示（如 sk-***abc），只给前端看个尾号 */
export function maskKey(key: string): string {
  if (key.length <= 6) return "***";
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

// ---------- SSRF 防护：自定义接口地址不许指向内网 ----------

const PRIVATE_V4 =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function isAllowedBaseUrl(raw: string): boolean {
  // 本地联调（mock 服务）通过环境变量放行
  if (process.env.WORLD3D_ALLOW_LOCAL_LLM === "1") return true;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h === "[::1]" || h === "::1") return false;
    if (PRIVATE_V4.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

// ---------- OpenAI 兼容调用 ----------

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class LlmError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface LlmCallConfig {
  baseUrl: string;
  chatPath: string;
  apiKey: string;
  model: string;
  temperature?: number;
  persona?: string;
}

function sanitize(text: string): string {
  // 错误信息里可能出现密钥/鉴权头，统一清掉再截断
  return text
    .replace(/(sk-[A-Za-z0-9_-]{6,})/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .slice(0, 220);
}

/** fetch 被我们的超时 abort（而不是对端网络错误） */
function controller_aborted(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/**
 * 调一次 chat/completions，返回文本内容。
 * 五家厂商 + 任意兼容接口一个路径：POST {baseUrl}{chatPath}，Bearer 鉴权。
 * 网络层错误（连接被回收/复位）自动重试一次；HTTP 错误不重试。
 */
export async function chatComplete(
  cfg: LlmCallConfig,
  messages: LlmMessage[],
  opts: { maxTokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  const doFetch = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    try {
      return await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}${cfg.chatPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: cfg.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 300,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res: Response;
  try {
    res = await doFetch();
  } catch (first) {
    if (controller_aborted(first)) throw new LlmError(0, "请求超时");
    // 连接池复用撞上服务端关闭 keep-alive 是常见抖动，歇 300ms 重试一次
    await new Promise((r) => setTimeout(r, 300));
    try {
      res = await doFetch();
    } catch (e) {
      throw new LlmError(0, controller_aborted(e) ? "请求超时" : `网络错误：${sanitize(String((e as Error).message ?? e))}`);
    }
  }

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(bodyText) as { error?: { message?: string }; message?: string; base_resp?: { status_msg?: string } };
      msg = j.error?.message ?? j.message ?? j.base_resp?.status_msg ?? msg; // minimax 用 base_resp
    } catch {
      /* 保留 HTTP 状态 */
    }
    throw new LlmError(res.status, sanitize(msg));
  }
  try {
    const j = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: string } }>;
      output?: { choices?: Array<{ message?: { content?: string } }> }; // minimax 老格式兜底
      base_resp?: { status_code?: number; status_msg?: string }; // minimax 老风格：HTTP 200 + 业务错误码藏在 body
    };
    // 老式厂商（MiniMax 旧接口等）HTTP 200 也可能报错：业务码非 0 = 失败，把真实原因抛出来
    if (j.base_resp && (j.base_resp.status_code ?? 0) !== 0) {
      throw new LlmError(0, sanitize(`${j.base_resp.status_msg ?? "厂商返回业务错误"}（code ${j.base_resp.status_code}）`));
    }
    const content = j.choices?.[0]?.message?.content ?? j.output?.choices?.[0]?.message?.content ?? "";
    if (!content) throw new LlmError(0, "模型返回了空内容");
    return content.trim();
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(0, "响应解析失败（接口不兼容？）");
  }
}

/**
 * 拉取厂商真实模型列表：GET {baseUrl}/models（OpenAI 兼容接口，填好 Key 才能调）。
 * 任何失败返回 null，调用方回落静态兜底列表 —— 永不抛错，选模型不被阻塞。
 */
export async function listProviderModels(
  providerId: string,
  apiKey: string,
  customBaseUrl?: string,
  timeoutMs = 8_000
): Promise<string[] | null> {
  const def = providerById(providerId);
  if (!def || !apiKey) return null;
  const baseUrl = (providerId === "custom" ? (customBaseUrl ?? "") : def.baseUrl).replace(/\/+$/, "");
  if (!baseUrl) return null;
  if (providerId === "custom" && !isAllowedBaseUrl(baseUrl)) return null;
  const doFetch = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  let res: Response;
  try {
    res = await doFetch();
  } catch {
    try {
      res = await doFetch();
    } catch {
      return null;
    }
  }
  if (!res.ok) return null;
  try {
    const j = JSON.parse(await res.text()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string }> };
    const ids = (j.data ?? j.models ?? [])
      .map((m) => String(m.id ?? "").trim())
      .filter((s) => /^[A-Za-z0-9][A-Za-z0-9._\-:/]{0,80}$/.test(s));
    return ids.length ? [...new Set(ids)].sort() : null;
  } catch {
    return null;
  }
}
