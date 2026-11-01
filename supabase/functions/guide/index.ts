// 一江春水 · AI 侍读边缘函数（Deno 运行时）
// 作用：站内所有 AI 能力统一从这里进入，前端不直接持有任何密钥。
// 路由：POST /functions/v1/guide
// 请求：{ action: 'ask' | 'search' | 'compose' | 'interpret', message, poemSlug?, page?, sessionId?, history?, model? }
// 返回：{ action, answer, sources, model, usage }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 读取环境变量并去掉末尾斜杠，避免拼出双斜杠
const readEnv = (key: string): string => (Deno.env.get(key) ?? "").replace(/\/$/, "");

// 返回 JSON 响应（统一带上 CORS 头）
const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

// 服务端密钥：仅用于函数内部访问网关与数据库，绝不下发到浏览器
const SERVICE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("SUPABASE_SERVICE_ROLE");
const SUPABASE_URL = readEnv("SUPABASE_URL");
// AI Gateway 与 Supabase 同域，默认走 ${SUPABASE_URL}/v1；若平台注入的是内网地址，可用该环境变量覆盖
const GATEWAY_BASE = readEnv("AI_GATEWAY_BASE") || `${SUPABASE_URL}/v1`;
const REST_BASE = `${SUPABASE_URL}/rest/v1`;
// 默认走速度更稳的 mini；需要更长思考时前端可指定 pro
const DEFAULT_MODEL = readEnv("GUIDE_MODEL") || "bytedance/doubao-seed-2.0-mini";
const PRO_MODEL = "bytedance/doubao-seed-2.1-pro";

// 站点的叙事底盘：让模型知道“这是哪儿、在讲什么”，回答才贴合页面
const SITE_CONTEXT = `网站名「春水留痕 · 李煜词境」，是一座关于南唐后主李煜的静态叙事站，用“一场梦”串起他的生平与词。
页面依次为：
1. 首页：书封开场，五幕换景，把读者带进词境；
2. 月色故人（pages/life.html）：937—978 年的时间轴，写他从皇子、国主到囚徒的一生；
3. 梦里词话（pages/ci.html）：四阕代表词，讲写作背景与心绪；
4. 帘外余音（pages/wanxiang.html）：历代绘画、戏曲、影视、游戏如何重写李煜；
5. 枕上低语（pages/listen.html）：诵读词作，并提供填词续写；
6. 水墨行迹（pages/map.html）：按他的足迹游南唐地图；
7. 终幕（pages/finale.html）：收束全站。
站点语气：克制、典雅、不煽情；解释史实时要区分“史实”与“传说/戏说”。`;

// 数字人设定：回答需短、雅、可核对
const PERSONA = `你是李煜的“数字分身”，寄居在这座词境网站里，陪读者走完这一程。
说话方式：
- 用现代汉语为主，可带一点浅近文言，不堆砌辞藻；
- 默认回答控制在 80—160 字，除非用户明确要求展开；
- 谈自己的词与身世时用第一人称，谈史实与文本分析时可退一步，用第三人称说明；
- 不编造年份、人物、典故；不确定就说“这一处史载不一”；
- 不回答与李煜、南唐、词学、本站内容无关的问题，礼貌地把话题带回词境；
- 遇到用户情绪低落，先接住情绪，再谈词，不做心理治疗式的说教。`;

// 规范化用户问题：去掉首尾空白并限制长度，防止超长请求拖垮模型
const normalize = (value: unknown, max = 800): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

// 调 PostgREST 的通用 GET（带服务端密钥）
const restGet = async (path: string): Promise<any[]> => {
  const res = await fetch(`${REST_BASE}/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`数据库查询失败：${res.status}`);
  return await res.json();
};

// 按 slug 取单首词，供“问某一首”的场景引用原文
const fetchPoem = async (slug: string) => {
  if (!slug) return null;
  const rows = await restGet(`poems?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`);
  return rows[0] ?? null;
};

// 词库很小（数十首），一次性读入实例内存后按关键词过滤，避免 REST 过滤参数的编码坑
let poemCache: any[] | null = null;
const loadPoems = async (): Promise<any[]> => {
  if (poemCache) return poemCache;
  poemCache = await restGet(
    "poems?select=slug,title,tune,year,phase,content,translation,background,keywords&order=year.asc.nullslast&limit=50",
  );
  return poemCache;
};

// 关键词检索：标题 / 正文 / 背景 / 关键词四路匹配，最多取 6 首
// 整句提问时先拆掉疑问词与标点，再按片段匹配，避免「李煜为什么亡国」这类长句一首也命中不了
const searchPoems = async (keyword: string) => {
  const cleaned = keyword
    .replace(/[%*(),。，？?！!、；;：:「」《》"'']/g, " ")
    .replace(/(为什么|为什么说|怎么|怎么样|什么|哪些|哪里|哪|如何|是否|是不是|能不能|可以|请问|帮我|告诉|一下|吗|呢|啊|吧|的|了|是|有|在|我|你|他|她)/g, " ")
    .trim();
  // 候选词：原句 → 去疑问词后的整段 → 各片段
  const candidates = [keyword.trim(), cleaned];
  cleaned.split(/\s+/).forEach((seg) => {
    if (seg.length >= 2) candidates.push(seg);
  });
  const all = await loadPoems();
  const hitSlugs = new Set<string>();
  const results: any[] = [];
  candidates.filter(Boolean).forEach((term) => {
    const lower = term.toLowerCase();
    all.forEach((p) => {
      if (hitSlugs.has(p.slug)) return;
      const haystack = [p.title, p.content, p.background, (p.keywords ?? []).join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (haystack.includes(lower)) {
        hitSlugs.add(p.slug);
        results.push(p);
      }
    });
  });
  return results.slice(0, 6);
};

// 把命中的词作压成给模型看的资料块（只保留必要字段，控制 token）
const buildSourceBlock = (poems: any[]): string => {
  if (!poems.length) return "";
  return poems
    .map((p) => {
      const bits = [
        `《${p.title}》${p.year ? `（约 ${p.year} 年）` : ""}`,
        `原文：${p.content}`,
        p.background ? `背景：${p.background}` : "",
      ].filter(Boolean);
      return bits.join("\n");
    })
    .join("\n\n");
};

// 调用 AI Gateway 的 OpenAI 兼容接口
const callGateway = async (
  messages: { role: string; content: string }[],
  options: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<{ text: string; model: string; usage: any }> => {
  const model = options.model || DEFAULT_MODEL;
  const controller = new AbortController();
  // 边缘函数有总超时，这里留出余量
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const res = await fetch(`${GATEWAY_BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 420,
        temperature: options.temperature ?? 0.75,
        // Doubao 系列默认会产出思考过程；站内问答不需要，关闭以降低延迟
        thinking: { type: "disabled" },
      }),
    });
    if (!res.ok) throw new Error(`AI 网关返回 ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return { text: String(text).trim(), model, usage: data?.usage ?? null };
  } finally {
    clearTimeout(timer);
  }
};

// 问答日志：写入失败不影响主流程
const logGuide = async (row: Record<string, unknown>) => {
  try {
    await fetch(`${REST_BASE}/guide_logs`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch (error) {
    console.warn("写入问答日志失败", error);
  }
};

// 简易限流：同一实例内按 IP 计数，防止被刷；跨实例不严格，但足以挡住误用
const hits = new Map<string, { count: number; resetAt: number }>();
const allowRequest = (ip: string): boolean => {
  const now = Date.now();
  const item = hits.get(ip);
  if (!item || item.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  item.count += 1;
  return item.count <= 20;
};

// 主入口
Deno.serve(async (req: Request) => {
  // CORS 预检
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowRequest(ip)) return jsonResponse({ error: "请求太频繁，稍等片刻再来。" }, 429);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "请求体不是合法 JSON" }, 400);
  }

  const action = normalize(body.action, 20) || "ask";
  const message = normalize(body.message, 800);
  const poemSlug = normalize(body.poemSlug, 80);
  const page = normalize(body.page, 40);
  const sessionId = normalize(body.sessionId, 80);
  // 只保留最近 6 轮历史，避免上下文无限增长
  const history = Array.isArray(body.history)
    ? body.history
        .slice(-6)
        .filter((m: any) => m && typeof m.content === "string")
        .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: normalize(m.content, 500) }))
    : [];

  try {
    // 检索：不需要模型，直接返回词库结果
    if (action === "search") {
      if (!message) return jsonResponse({ error: "请给出要检索的关键词。" }, 400);
      const rows = await searchPoems(message);
      return jsonResponse({
        action,
        answer: rows.length
          ? `在词库里找到 ${rows.length} 首相关的词。`
          : "词库里暂时没有直接对应的词作，换个意象试试，比如「春水」「西楼」「梧桐」。",
        sources: rows,
      });
    }

    // 定位当前情境：页面里的词作作为一手资料
    const poem = poemSlug ? await fetchPoem(poemSlug) : null;
    // 问答时也做一次轻检索，让模型“有据可依”
    const related = action === "ask" && message ? await searchPoems(message) : [];
    const contextPoems = [
      ...(poem ? [poem] : []),
      ...related.filter((p) => p.slug !== poem?.slug),
    ].slice(0, 4);
    const sourceBlock = buildSourceBlock(contextPoems);

    // 拼装系统提示：站点底盘 + 数字人设定 + 本轮资料 + 所在页面
    const systemParts = [SITE_CONTEXT, PERSONA];
    if (page) systemParts.push(`读者此刻在「${page}」页面。`);
    if (sourceBlock) systemParts.push(`可供引用的词作资料：\n${sourceBlock}`);
    const system = systemParts.join("\n\n");

    let instruction = message;
    let maxTokens = 420;
    let temperature = 0.75;

    if (action === "compose") {
      // 伴写：按李煜的语气，把用户写下的半句续下去
      instruction = `读者正在「枕上低语」页续写自己的句子：
「${message || "（空）"}」
请你以李煜的口吻，只输出接续的 1—2 句（合计 30—60 字），不要复述他已写下的部分，不要加引号，不要解释。`;
      maxTokens = 220;
      temperature = 0.9;
    } else if (action === "interpret") {
      // 解读：既可解读某首词，也可解读读者自己写的句子
      instruction = `请解读下面这段文字，说清它写了什么、情绪如何转折、哪一处字词最见功夫：
「${message || "（空）"}」
若它并非李煜原作，请把它当作读者习作来点评，不要强行归到李煜名下。控制在 120—200 字。`;
      maxTokens = 360;
      temperature = 0.6;
    } else if (!message) {
      // 空问题：给一句情境引导，不空耗模型
      return jsonResponse({ error: "请先写下你想问的话。" }, 400);
    }

    const messages = [
      { role: "system", content: system },
      ...history,
      { role: "user", content: instruction },
    ];

    const model = normalize(body.model, 40) === "pro" ? PRO_MODEL : DEFAULT_MODEL;
    const result = await callGateway(messages, { model, maxTokens, temperature });

    // 伴写兜底：模型偶尔仍会复述原句，这里把原句与引号剥掉，只留接续的部分
    let answer = result.text;
    if (action === "compose" && message) {
      answer = answer
        .replaceAll(`「${message}」`, "")
        .replaceAll(`“${message}”`, "")
        .replaceAll(message, "")
        .replace(/^[\s，。、；：:,.]+/, "")
        .trim();
      if (!answer) answer = result.text;
    }

    // 记录日志（不阻塞响应语义）
    logGuide({
      session_id: sessionId,
      mode: action,
      page,
      question: message,
      answer,
      model: result.model,
      tokens: result.usage?.total_tokens ?? null,
    });

    return jsonResponse({
      action,
      answer,
      model: result.model,
      usage: result.usage,
      // 只回传必要字段，避免把整份资料发给前端
      sources: contextPoems.map((p) => ({
        slug: p.slug,
        title: p.title,
        tune: p.tune,
        year: p.year,
        content: p.content,
      })),
    });
  } catch (error) {
    console.error("guide 处理失败", error);
    const messageText = error instanceof Error ? error.message : "未知错误";
    return jsonResponse({ error: `侍读暂时走神了：${messageText}` }, 500);
  }
});
