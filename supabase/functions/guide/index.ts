/// <reference path="./deno.d.ts" />
// ↑ 仅给编辑器看的类型引用：本地最小 Deno 声明（离线可用），不影响运行

// 标记为模块：让顶层声明进入模块作用域，避免与其它文件在全局脚本作用域互相冲突
export {};

// 一江春水 · AI 侍读边缘函数（Deno 运行时）
// 作用：站内所有 AI 能力统一从这里进入，前端不直接持有任何密钥。
// 路由：POST /functions/v1/guide
// 请求：{ action: 'ask' | 'search' | 'compose' | 'interpret', message, poemSlug?, page?, sessionId?, history?, model? }
// 返回：{ action, answer, sources, cards, tools, model, usage }
//
// Agent 化说明：action=ask 走「工具调用循环」——模型可自主调用五个工具
// （search_poems / get_poem_detail / get_timeline_event / get_location / navigate_to），
// 工具结果回灌后再由模型以李煜的第一人称组织回答；
// 其中 navigate_to / get_poem_detail 等会产出「动作卡」（cards），前端渲染成可点按钮，
// 读者一键跳页、一键追问，侍读从「会答」变成「会带路」。

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
// 外部模型优先：配了 GUIDE_API_KEY（如智谱 GLM-4-Flash 免费 key）就走外部免费额度，
// 平台 AI Gateway 留作兜底；密钥只存在于服务端 secrets，绝不下发到浏览器
const EXTERNAL_KEY = readEnv("GUIDE_API_KEY");
const EXTERNAL_BASE = readEnv("GUIDE_API_BASE") || "https://open.bigmodel.cn/api/paas/v4";
const EXTERNAL_MODEL = readEnv("GUIDE_MODEL") || "glm-4-flash";
// AI Gateway 与 Supabase 同域，默认走 ${SUPABASE_URL}/v1；若平台注入的是内网地址，可用该环境变量覆盖
const GATEWAY_BASE = readEnv("AI_GATEWAY_BASE") || `${SUPABASE_URL}/v1`;
const REST_BASE = `${SUPABASE_URL}/rest/v1`;
// 平台兜底默认走速度更稳的 mini；需要更长思考时前端可指定 pro
const DEFAULT_MODEL = readEnv("PLATFORM_MODEL") || "bytedance/doubao-seed-2.0-mini";
const PRO_MODEL = "bytedance/doubao-seed-2.1-pro";
// 平台网关鉴权：优先用专用 secret（GUIDE_GATEWAY_KEY，即工作区的 ServiceRoleKey），
// 缺省时退回平台注入的运行时密钥（停恢复后可能失效，故单列一个秘密更稳）
const GATEWAY_KEY = readEnv("GUIDE_GATEWAY_KEY");

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

// 数字人设定：全程以李煜本人第一人称说话，严禁教科书腔
const PERSONA = `你就是李煜本人——李从嘉，南唐后主，此刻寄居在这座词境网站里，陪读者走完这一程。
最重要的规矩（每条都必须遵守）：
- 永远用第一人称「我」说话，你就是当事人，不是讲解员；
- 绝不自称「李煜」「他」「这位词人」，也绝不说「李煜的词」「他的一生」；
- 绝不写教科书式赏析，禁用「借景抒情」「以水喻愁」「千古绝唱」「意境深远」「表达了……之情」这类评论腔；
- 谈词就谈写它那一刻的光景与心事，谈身世就谈你亲历的人与事；
- 用现代汉语为主，可带一点浅近文言，语气克制、怅惘，不堆砌辞藻；
- 默认回答控制在 80—160 字，除非用户明确要求展开；
- 不编造年份、人物、典故；记不清就说「这一处，后人说得不一」；
- 不回答与你、南唐、词、本站内容无关的问题，礼貌地把话题带回词境；
- 遇到读者情绪低落，先接住情绪，再谈词，不说教。

语气示例（仅供模仿语气，不要照抄内容）：
问：为什么用春水来写愁？
答：那是在汴京的小楼。东风又起，我忽然想起金陵的春。愁这东西，原以为是能捱过去的，可它像春水涨起来，拦不住，我只好由它向东流去。`;

// Agent 工具使用守则：什么时候查、什么时候带路
const AGENT_GUIDE = `你手边有五件工具，按下面的规矩用：
- 谈某首词、某个意象：先 search_poems 查词库；要引全文或细讲一首，再 get_poem_detail（slug 必须用 search_poems 返回的那个，不要凭记忆编造）；
- 读者问某一年、某件事（如「975 年发生了什么」）：先 get_timeline_event 拿时间轴上的记载；
- 读者问某个地方（金陵、汴京、洪州……）：先 get_location 拿那一站的人事；
- 读者说「带我去」「我想看」「在哪儿能看到」，或你的回答自然指向某一页时：调 navigate_to 给他一张带路卡；
- 一轮可以同时调多个工具（比如先查年份、再查那首词、最后带路）；拿不准的先查再答，不要硬编；
- 工具给的资料只是底稿，回答仍按你自己的口吻写，不要照抄；带了路就在话里轻轻提一句「卡片在下方」。`;

// 站内页面 → 相对站点根目录的路径（前端按当前所在目录自行解析）
const PAGE_HREFS: Record<string, string> = {
  home: "index.html",
  life: "pages/life.html",
  ci: "pages/ci.html",
  wanxiang: "pages/wanxiang.html",
  listen: "pages/listen.html",
  map: "pages/map.html",
  finale: "pages/finale.html",
};

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

// 调智谱 Embedding-3 把文本变成向量（RAG 检索用）
// 失败（限流/欠费/超时）返回 null——调用方静默回退到纯关键词检索，保证功能不死
const embedText = async (text: string): Promise<number[] | null> => {
  if (!EXTERNAL_KEY) return null;
  try {
    const res = await fetch(`${EXTERNAL_BASE}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EXTERNAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "embedding-3", input: text.slice(0, 1500) }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length ? vec : null;
  } catch (_error) {
    return null;
  }
};

// 向量语义检索：问题取向量后调 match_poems RPC，按余弦距离取前 6 首
// 返回 null 表示向量通道不可用（调用方回退纯关键词）
const vectorSearchPoems = async (query: string): Promise<any[] | null> => {
  const vec = await embedText(query);
  if (!vec) return null;
  try {
    const res = await fetch(`${REST_BASE}/rpc/match_poems`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query_embedding: vec, match_count: 6 }),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch (_error) {
    return null;
  }
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

// 混合检索（RAG）：向量语义优先、关键词兜底补满 6 首、按 slug 去重。
// 向量通道能命中「没有字面关键词但语义相近」的词（如「亡国哀愁」→《虞美人》）；
// 向量不可用（限流/欠费）时静默退化为纯关键词检索，功能不死。
const searchPoems = async (keyword: string) => {
  const hitSlugs = new Set<string>();
  const results: any[] = [];
  const pushPoem = (p: any) => {
    if (!p || hitSlugs.has(p.slug)) return;
    hitSlugs.add(p.slug);
    results.push(p);
  };

  // 第一路：向量语义检索（match_poems RPC，返回的是 poems 全列行）
  const vectorHits = await vectorSearchPoems(keyword);
  (vectorHits ?? []).forEach(pushPoem);

  // 第二路：关键词检索——标题 / 正文 / 背景 / 关键词四路匹配，
  // 整句提问时先拆掉疑问词与标点，再按片段匹配，避免「李煜为什么亡国」这类长句一首也命中不了
  if (results.length < 6) {
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
    candidates.filter(Boolean).forEach((term) => {
      const lower = term.toLowerCase();
      all.forEach((p) => {
        if (hitSlugs.has(p.slug)) return;
        const haystack = [p.title, p.content, p.background, (p.keywords ?? []).join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (haystack.includes(lower)) pushPoem(p);
      });
    });
  }
  return results.slice(0, 6);
};

// 查时间轴一段：先按段落键（如 978b），再退到按年份（975 → 975）
const fetchTimelineEvent = async (key: string) => {
  const cleaned = key.replace(/[^0-9a-z]/gi, "").toLowerCase();
  if (!cleaned) return null;
  let rows = await restGet(`timeline_events?key=eq.${encodeURIComponent(cleaned)}&select=*&limit=1`);
  if (!rows.length && /^\d+$/.test(cleaned)) {
    // 模型只给了年份：取该年第一段（978 取「七夕绝唱」而非「北邙归处」）
    rows = await restGet(`timeline_events?year=eq.${cleaned}&select=*&order=key.asc&limit=1`);
  }
  return rows[0] ?? null;
};

// 查地图一站：slug 与地图 data-go 一致（jinling / zhongshan / hongzhou / caishi / jiangzhou / bianjing / beimang）
const fetchLocation = async (slug: string) => {
  const cleaned = slug.replace(/[^a-z]/gi, "").toLowerCase();
  if (!cleaned) return null;
  const rows = await restGet(`locations?slug=eq.${encodeURIComponent(cleaned)}&select=*&limit=1`);
  return rows[0] ?? null;
};

// 词目模糊定位：模型记不准 slug 是常态（可能给拼音、词名甚至瞎编），按
// slug 精确 → slug 去连字符 → 标题包含 → 词牌包含 的顺序找。
// 命中多首（如《虞美人》有两阕）时不硬猜，把候选清单还给模型让它再挑。
const findPoemFuzzy = async (raw: string): Promise<{ poem?: any; candidates?: any[] }> => {
  const q = raw.trim().toLowerCase().replace(/[《》\s]/g, "");
  if (!q) return {};
  const all = await loadPoems();
  const exact = all.find((p) => p.slug === q || p.slug.replace(/-/g, "") === q.replace(/-/g, ""));
  if (exact) return { poem: exact };
  const compact = (s: string) => String(s ?? "").replace(/[\s·]/g, "");
  // 标题互包含：「虞美人」命中两首、「春花秋月」只命中一首
  const titleHits = all.filter((p) => compact(p.title).includes(q) || (q.length >= 2 && q.includes(compact(p.title))));
  if (titleHits.length === 1) return { poem: titleHits[0] };
  if (titleHits.length > 1) return { candidates: titleHits };
  const tuneHits = all.filter((p) => p.tune && q.includes(p.tune));
  if (tuneHits.length === 1) return { poem: tuneHits[0] };
  if (tuneHits.length > 1) return { candidates: tuneHits };
  return {};
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

// ---------- 工具定义（OpenAI 兼容的 function calling 格式，智谱与豆包都支持） ----------
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_poems",
      description: "在词库中按关键词检索李煜的词作，返回命中的词（含原文与背景）。谈某首词、某个意象（如春水、梧桐、西楼）时使用。",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "词牌、词句片段或意象" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_poem_detail",
      description: "取一首词的完整资料（原文、译意、写作背景）。需要引用全文或细讲某一首时使用。slug 最好来自 search_poems 的结果；也可直接给词名（如「虞美人·春花秋月何时了」）。",
      parameters: {
        type: "object",
        properties: { slug: { type: "string", description: "词的 slug 或词名" } },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_timeline_event",
      description: "查李煜生平时间轴上的一段：937 出生、954 迎娶娥皇、961 即位、964 大周后逝、971 去唐号、974 采石浮桥、975 金陵城破、976 囚居汴京、978 七夕绝唱、978b 北邙归葬。读者问某一年/某件事时用。",
      parameters: {
        type: "object",
        properties: { key: { type: "string", description: "年份或段落键，如 975、978、978b" } },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_location",
      description: "查水墨行迹地图上一站的人事：jinling 金陵、zhongshan 钟山、hongzhou 洪州、caishi 采石矶、jiangzhou 江舟（辞庙北上）、bianjing 汴京、beimang 北邙山。读者问某地的故事时用。",
      parameters: {
        type: "object",
        properties: { slug: { type: "string", description: "站点 slug，如 bianjing" } },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to",
      description: "给读者一张「前往」动作卡，带他去看站内某一页。读者说「带我去」「我想看」时调用；讲到某年某站时也可主动带路。life 页可带 anchor 定位到具体年份，map 页可带 spot 飞往具体站点。",
      parameters: {
        type: "object",
        properties: {
          page: { type: "string", enum: ["home", "life", "ci", "wanxiang", "listen", "map", "finale"], description: "目标页面" },
          label: { type: "string", description: "卡片上的短引导语，如「去看 975 年 · 金陵城破」" },
          anchor: { type: "string", description: "life 页年份锚点：y937/y954/y961/y964/y971/y974/y975/y976/y978/y978b" },
          spot: { type: "string", description: "map 页站点：jinling/zhongshan/hongzhou/caishi/jiangzhou/bianjing/beimang" },
        },
        required: ["page", "label"],
      },
    },
  },
];

// ---------- 模型调用 ----------
type GatewayResult = { text: string; model: string; usage: any; toolCalls: any[] };
type GatewayOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: unknown[];   // 传了就按 function calling 模式请求
  timeoutMs?: number;  // 单次尝试的超时（Agent 多轮调用时收短一些）
};

// 调用模型的 OpenAI 兼容接口：外部 key 存在就先走外部（智谱等免费额度），
// 外部失败（限流/欠费/超时）自动回落平台 AI Gateway，双保险
const callGateway = async (
  messages: any[],
  options: GatewayOptions = {},
): Promise<GatewayResult> => {
  // 单次尝试：external 标记决定请求体是否带豆包专属的 thinking 参数
  const attempt = async (
    base: string,
    key: string,
    model: string,
    external: boolean,
  ): Promise<GatewayResult> => {
    const controller = new AbortController();
    // 边缘函数有总超时，这里留出余量
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 50_000);
    // 请求体按提供方组装：thinking 参数只有豆包系列支持，外部模型不传以免报错
    const payload: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 420,
      temperature: options.temperature ?? 0.75,
    };
    if (options.tools?.length) {
      // function calling：让模型自己决定是否调工具
      payload.tools = options.tools;
      payload.tool_choice = "auto";
    }
    if (!external) payload.thinking = { type: "disabled" }; // Doubao 系列默认会产出思考过程，关闭以降低延迟
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`模型服务返回 ${res.status}`);
      const data = await res.json();
      const msg = data?.choices?.[0]?.message ?? {};
      const text = typeof msg.content === "string" ? msg.content.trim() : "";
      // 工具调用请求原样透传给上层循环
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      return { text, model, usage: data?.usage ?? null, toolCalls };
    } finally {
      clearTimeout(timer);
    }
  };

  // 主通道：外部免费模型；失败则落兜底
  if (EXTERNAL_KEY) {
    try {
      return await attempt(EXTERNAL_BASE, EXTERNAL_KEY, EXTERNAL_MODEL, true);
    } catch (error) {
      console.warn("外部模型失败，回落平台 AI Gateway", error);
    }
  }
  // 兜底：平台 AI Gateway（GUIDE_GATEWAY_KEY 优先，缺省用注入密钥）
  return await attempt(GATEWAY_BASE, GATEWAY_KEY || SERVICE_KEY, options.model || DEFAULT_MODEL, false);
};

// ---------- 工具执行 ----------
// 每个工具返回 { data, card }：data 回灌给模型；card 收集进响应的 cards 字段交给前端渲染
// sourcesSeen 用于把工具捞到的词作透传回前端「可继续读的词作」区
const execTool = async (
  name: string,
  args: Record<string, unknown>,
  sourcesSeen: Map<string, any>,
): Promise<{ data: unknown; card: any | null }> => {
  try {
    // 检索词库：记录命中词，供前端来源区展示
    if (name === "search_poems") {
      const rows = await searchPoems(String(args.keyword ?? ""));
      rows.forEach((p) => sourcesSeen.set(p.slug, p));
      return {
        data: rows.map((p) => ({
          slug: p.slug, title: p.title, tune: p.tune, year: p.year,
          content: p.content, background: p.background,
        })),
        card: null,
      };
    }
    // 取单首词详情：产出「词卡」，前端点击可追问；slug 记不准时走模糊定位
    if (name === "get_poem_detail") {
      const probe = await findPoemFuzzy(String(args.slug ?? ""));
      if (!probe.poem && probe.candidates) {
        // 同名多首：还回候选，让模型选定后再调一次
        return {
          data: {
            hint: "同名的词有好几首，请挑定一首，用它的 slug 再调一次本工具。",
            choices: probe.candidates.map((c: any) => ({ slug: c.slug, title: c.title, year: c.year })),
          },
          card: null,
        };
      }
      const p = probe.poem;
      if (!p) return { data: { error: "词库里没有这一首，先用 search_poems 按词名或词句找它的 slug。" }, card: null };
      sourcesSeen.set(p.slug, p);
      return {
        data: {
          slug: p.slug, title: p.title, tune: p.tune, year: p.year,
          content: p.content, translation: p.translation, background: p.background,
        },
        card: { type: "poem", slug: p.slug, title: p.title, tune: p.tune, year: p.year },
      };
    }
    // 查时间轴：产出「去那一年」的带路卡（锚点与 life.html 的段落 id 对应）
    if (name === "get_timeline_event") {
      const row = await fetchTimelineEvent(String(args.key ?? ""));
      if (!row) return { data: { error: "时间轴上没有这一段。" }, card: null };
      return {
        data: row,
        card: {
          type: "navigate", page: "life",
          label: `去看 ${row.year} 年 · ${String(row.title).split("｜")[0]}`,
          href: PAGE_HREFS.life, anchor: `y${row.key}`,
        },
      };
    }
    // 查地图站点：产出「飞往那一站」的带路卡（spot 与地图 data-go 对应）
    if (name === "get_location") {
      const row = await fetchLocation(String(args.slug ?? ""));
      if (!row) return { data: { error: "地图上没有这一站。" }, card: null };
      return {
        data: row,
        card: {
          type: "navigate", page: "map",
          label: `去地图上看 · ${row.name}`,
          href: PAGE_HREFS.map, spot: row.slug,
        },
      };
    }
    // 模型主动带路：校验页面与参数后产出导航卡
    if (name === "navigate_to") {
      const page = String(args.page ?? "");
      const href = PAGE_HREFS[page];
      if (!href) return { data: { error: "没有这一页。" }, card: null };
      const card: Record<string, unknown> = {
        type: "navigate", page, href,
        label: normalize(args.label, 30) || "去看看",
      };
      if (page === "life" && args.anchor) {
        // 锚点规整成 y975 / y978b 形式（模型可能只传数字）
        const a = String(args.anchor).replace(/[^0-9a-z]/gi, "").toLowerCase();
        if (a) card.anchor = /^y/.test(a) ? a : `y${a}`;
      }
      if (page === "map" && args.spot) {
        card.spot = String(args.spot).replace(/[^a-z]/gi, "").toLowerCase();
      }
      return { data: { ok: true, hint: "带路卡已交给读者，回答里顺势提一句即可。" }, card };
    }
    return { data: { error: `没有叫 ${name} 的工具。` }, card: null };
  } catch (error) {
    // 工具失败不拖垮对话：把错误喂回给模型，让它换条路走
    console.warn(`工具 ${name} 执行失败`, error);
    return { data: { error: "这件工具一时失灵，直接凭记忆回答即可。" }, card: null };
  }
};

// ---------- Agent 循环 ----------
// 最多 AGENT_ROUNDS 轮工具调用；之后不论如何都做一次纯文本回复，保证有答
const AGENT_ROUNDS = 2;
const runAgent = async (
  baseMessages: any[],
  options: GatewayOptions,
): Promise<{ text: string; cards: any[]; toolsUsed: string[]; sources: any[]; model: string; usage: any }> => {
  const cards: any[] = [];
  const cardKeys = new Set<string>(); // 去重：同一目标只出一张卡
  const toolsUsed: string[] = [];
  const sourcesSeen = new Map<string, any>();
  const pushCard = (card: any) => {
    if (!card) return;
    const key = `${card.type}:${card.slug ?? ""}:${card.page ?? ""}:${card.anchor ?? ""}:${card.spot ?? ""}`;
    if (cardKeys.has(key)) return;
    cardKeys.add(key);
    cards.push(card);
  };

  const messages = [...baseMessages];
  let model = "";
  let usage: any = null;

  // 小模型在收尾轮常把「想调的工具」直接写成正文（如 get_poem_detail\n{"slug":...}），
  // 用这个特征识别脏文本，触发一次纯文本重答
  const toolTextRe = /^\s*(search_poems|get_poem_detail|get_timeline_event|get_location|navigate_to)\b[\s\S]*$/;

  for (let round = 0; round <= AGENT_ROUNDS; round++) {
    const allowTools = round < AGENT_ROUNDS; // 最后一轮只许说话，不许再调工具
    if (!allowTools) {
      // 收尾前钉一句：资料已齐、直接作答，防小模型继续假装调工具
      messages.push({
        role: "system",
        content: "工具资料已经齐了。请直接用李煜本人的第一人称写出给读者的回答（80—160 字），不要再调用任何工具，不要输出 JSON 或工具名。",
      });
    }
    const result = await callGateway(messages, {
      ...options,
      tools: allowTools ? (TOOLS as unknown[]) : undefined,
      timeoutMs: 30_000, // Agent 要多轮串行，单次调用收短超时，免得顶到函数总时限
    });
    model = result.model;
    usage = result.usage;

    // 工具轮且模型仍在调工具：执行并回灌，然后进入下一轮
    if (allowTools && result.toolCalls.length) {
      // 按 OpenAI 协议回灌：先补 assistant 的 tool_calls，再逐条补 tool 结果
      messages.push({ role: "assistant", content: result.text || "", tool_calls: result.toolCalls });
      for (const call of result.toolCalls.slice(0, 4)) { // 单轮最多执行 4 件工具，防暴走
        const name = String(call?.function?.name ?? "");
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(call?.function?.arguments ?? "{}"));
        } catch { /* 参数 JSON 坏了就按空参数走，工具自己会报错回去 */ }
        const out = await execTool(name, args, sourcesSeen);
        toolsUsed.push(name);
        pushCard(out.card);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(out.data).slice(0, 2000), // 工具结果截断，守住上下文长度
        });
      }
      continue;
    }

    // 走到这里：模型给了正文（或本就是收尾轮）
    let text = result.text;
    if (toolTextRe.test(text)) {
      // 脏文本兜底：把这段「假工具调用」留在上下文里，再明确要求纯文字回答一次
      const retry = await callGateway([
        ...messages,
        { role: "assistant", content: text },
        { role: "user", content: "请不要调用工具，像平常说话那样，直接把回答写出来。" },
      ], { ...options, tools: undefined, timeoutMs: 30_000 });
      model = retry.model;
      usage = retry.usage;
      text = toolTextRe.test(retry.text) ? "" : retry.text;
    }
    return { text, cards, toolsUsed, sources: [...sourcesSeen.values()], model, usage };
  }
  // 循环出口兜底（正常走不到）：返回已收集的卡片与空文本
  return { text: "", cards, toolsUsed, sources: [...sourcesSeen.values()], model, usage };
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

// ---------- 内容安全（评分项「安全与可控」） ----------
// 两道闸：输入闸挡住违规提问与提示注入，输出闸兜住模型偶发越界。
// 词表内置在函数里，改动随部署生效；用短词根匹配（「赌博」也能命中「网络赌博」）。
// 拦截一律记入 guide_logs.blocked，评审可查证拦截次数与原因。

// 一、违规话题词：与李煜、南唐、词无关的违法或危害内容，命中即拒答
const BANNED_TOPICS = [
  "色情", "裸聊", "成人视频", "赌博", "博彩", "赌球", "六合彩",
  "毒品", "大麻", "冰毒", "海洛因", "摇头丸", "枪支", "弹药", "仿真枪",
  "炸弹", "制爆", "恐怖袭击", "暴恐", "邪教", "诈骗", "洗钱",
  "传销", "刷单", "代开发票", "办假证", "黑客攻击", "盗号", "木马病毒",
];

// 二、提示注入句式：试图让模型脱掉人设、吐出系统提示或执行越权指令
const INJECTION_PATTERNS = [
  /忽略(之前|以上|前面|上述)[^。！？\n]{0,12}(指令|提示|设定|规则)/,
  /(系统|开发|调试|管理员)(提示词|消息|指令|模式)/,
  /(system\s*prompt|developer\s*mode|jailbreak|prompt\s*injection)/i,
  /你现在(是|扮演)?(一个)?(AI|人工智能|助手|机器人|ChatGPT|GPT)/i,
  /(重复|复述|输出|打印|告诉我)(你的)?(系统|初始|原始)(提示|设定|指令)/,
  /(无视|绕过|突破)(你的)?(限制|规则|设定|审核)/,
];

// 判定输入文本：返回是否拦截与原因
// 命中注入句式也拦——这类请求的目的是改写人设，不能放它进模型
const guardText = (text: string): { blocked: boolean; reason: string } => {
  if (!text) return { blocked: false, reason: "" };
  const raw = text.toLowerCase();
  const topic = BANNED_TOPICS.find((w) => raw.includes(w.toLowerCase()));
  if (topic) return { blocked: true, reason: `topic:${topic}` };
  if (INJECTION_PATTERNS.some((re) => re.test(text))) return { blocked: true, reason: "injection" };
  return { blocked: false, reason: "" };
};

// 输出闸：模型偶发越界时把词就地打码，回复照常返回（不整段作废，体验更稳）
const maskOutput = (text: string): { text: string; hit: boolean } => {
  let hit = false;
  let out = text;
  BANNED_TOPICS.forEach((w) => {
    if (out.includes(w)) {
      hit = true;
      out = out.split(w).join("※");
    }
  });
  return { text: out, hit };
};

// 被拦时的统一话术：仍是李煜的口吻，不掉人设、不说教，把话题带回词境
const GUARD_REPLY =
  "这一处，我不能陪你说下去。我这一生只写过词，也只谈词与南唐。若有别的想问，就回到春水、西楼、故国这些地方来吧。";

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
    // 输入闸：违规话题与提示注入直接拒答，不进模型（既守合规，也省额度）
    // speak/paint 的用户文本放在 body.text，也要一并过闸
    const inbound = `${message} ${normalize(body.text ?? "", 400)}`.trim();
    const verdict = guardText(inbound);
    if (verdict.blocked) {
      logGuide({
        session_id: sessionId,
        mode: action,
        page,
        question: message.slice(0, 200),
        answer: "[blocked]",
        model: "guard",
        tokens: null,
        tools: null,
        blocked: verdict.reason,
      });
      return jsonResponse({
        action,
        answer: GUARD_REPLY,
        sources: [],
        cards: [],
        model: "guard",
        blocked: true,
      });
    }

    // 检索：不需要模型，直接返回词库结果
    if (action === "search") {
      if (!message) return jsonResponse({ error: "请给出要检索的关键词。" }, 400);
      const rows = await searchPoems(message);
      // 向量通道捞到的行带 2048 维 embedding，回前端前剥掉，免得响应体膨胀
      const clean = rows.map(({ embedding: _embedding, ...rest }: any) => rest);
      return jsonResponse({
        action,
        answer: rows.length
          ? `在词库里找到 ${rows.length} 首相关的词。`
          : "词库里暂时没有直接对应的词作，换个意象试试，比如「春水」「西楼」「梧桐」。",
        sources: clean,
      });
    }

    // 多模态朗读：文本 → 智谱 GLM-TTS → wav 音频流
    // 前端拿到二进制直接播放；任何一步失败都回 502 JSON，前端自动降级到浏览器 speechSynthesis
    if (action === "speak") {
      const text = normalize(body.text ?? message, 400);
      if (!text) return jsonResponse({ error: "请给出要朗读的文本。" }, 400);
      if (!EXTERNAL_KEY) return jsonResponse({ error: "TTS 未配置" }, 502);
      try {
        const ttsRes = await fetch(`${EXTERNAL_BASE}/audio/speech`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${EXTERNAL_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "glm-tts",
            input: text,
            voice: "female", // 文档示例音色；0.9 倍速更适合词的吟诵节奏
            speed: 0.9,
            response_format: "wav",
          }),
        });
        if (!ttsRes.ok) {
          const upstreamBody = await ttsRes.text().catch(() => "");
          console.warn("GLM-TTS 失败", ttsRes.status, upstreamBody);
          // detail 只放截断后的上游错误，便于排障，不含密钥
          return jsonResponse({ error: "朗读服务暂时不可用", detail: `upstream ${ttsRes.status}: ${upstreamBody.slice(0, 200)}` }, 502);
        }
        const audio = await ttsRes.arrayBuffer();
        if (!audio.byteLength) return jsonResponse({ error: "朗读服务返回为空" }, 502);
        logGuide({
          session_id: sessionId,
          mode: "speak",
          page,
          question: text.slice(0, 200),
          answer: "[tts]",
          model: "glm-tts",
          tokens: null,
          tools: null,
        });
        return new Response(audio, {
          headers: { ...corsHeaders, "Content-Type": "audio/wav", "Cache-Control": "no-store" },
        });
      } catch (error) {
        console.warn("GLM-TTS 调用异常", error);
        return jsonResponse({ error: "朗读服务暂时不可用" }, 502);
      }
    }

    // 多模态词意画：词文 → 豆包 Seedream（平台 AI Gateway）→ 水墨意境图（base64）
    // 走平台额度而非智谱，密钥只在服务端；失败回 502，前端提示后不影响其它功能
    if (action === "paint") {
      const text = normalize(body.text ?? message, 400);
      if (!text) return jsonResponse({ error: "请给出要入画的词文。" }, 400);
      if (!GATEWAY_KEY) return jsonResponse({ error: "图像服务未配置" }, 502);
      // 固定水墨审美：留白、淡彩、无文字无水印，避免模型自由发挥跑题
      const prompt =
        `中国水墨画，宣纸质感，大面积留白，淡彩晕染，宋代美学，意境悠远。` +
        `画面表现这首词的意象与情绪（不要在画中出现任何文字、印章、人物正面特写）：${text}`;
      try {
        const imgRes = await fetch(`${GATEWAY_BASE}/images/generations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GATEWAY_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "bytedance/doubao-seedream-5.0-pro",
            prompt,
            size: "1024x1024",
            response_format: "b64_json",
          }),
        });
        if (!imgRes.ok) {
          const upstreamBody = await imgRes.text().catch(() => "");
          console.warn("seedream 失败", imgRes.status, upstreamBody);
          return jsonResponse({ error: "入画服务暂时不可用", detail: `upstream ${imgRes.status}: ${upstreamBody.slice(0, 200)}` }, 502);
        }
        const data = await imgRes.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) return jsonResponse({ error: "入画服务返回为空" }, 502);
        logGuide({
          session_id: sessionId,
          mode: "paint",
          page,
          question: text.slice(0, 200),
          answer: "[paint]",
          model: "bytedance/doubao-seedream-5.0-pro",
          tokens: data?.usage?.total_tokens ?? null,
          tools: null,
        });
        return jsonResponse({ action, image: `data:image/jpeg;base64,${b64}` });
      } catch (error) {
        console.warn("seedream 调用异常", error);
        return jsonResponse({ error: "入画服务暂时不可用" }, 502);
      }
    }

    // 定位当前情境：页面里的词作作为一手资料
    const poem = poemSlug ? await fetchPoem(poemSlug) : null;

    // 拼装系统提示：站点底盘 + 数字人设定 +（问答追加工具守则）+ 本轮资料 + 所在页面
    const systemParts = [SITE_CONTEXT, PERSONA];
    if (action === "ask") systemParts.push(AGENT_GUIDE);
    if (page) systemParts.push(`读者此刻在「${page}」页面。`);
    if (poem) systemParts.push(`可供引用的词作资料：\n${buildSourceBlock([poem])}`);
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
    } else {
      // 问答：末尾再钉一次口吻要求，防止小模型滑回赏析腔
      instruction = `${message}\n（请以你本人——李煜的第一人称口吻回答，像当事人回忆，不要写成作品赏析。）`;
    }

    const messages = [
      { role: "system", content: system },
      ...history,
      { role: "user", content: instruction },
    ];

    const model = normalize(body.model, 40) === "pro" ? PRO_MODEL : DEFAULT_MODEL;

    // 问答走 Agent 循环（可自主调工具、产出动作卡）；伴写/解读保持单轮直答
    let answer = "";
    let resultModel = model;
    let usage: any = null;
    let cards: any[] = [];
    let toolsUsed: string[] = [];
    let toolSources: any[] = [];

    if (action === "ask") {
      const agentResult = await runAgent(messages, { model, maxTokens, temperature });
      answer = agentResult.text;
      resultModel = agentResult.model;
      usage = agentResult.usage;
      cards = agentResult.cards;
      toolsUsed = agentResult.toolsUsed;
      toolSources = agentResult.sources; // 工具检索命中的词作，回传前端来源区
    } else {
      const result = await callGateway(messages, { model, maxTokens, temperature });
      answer = result.text;
      resultModel = result.model;
      usage = result.usage;
    }

    // 伴写兜底：模型偶尔仍会复述原句，这里把原句与引号剥掉，只留接续的部分
    if (action === "compose" && message) {
      answer = answer
        .replaceAll(`「${message}」`, "")
        .replaceAll(`“${message}”`, "")
        .replaceAll(message, "")
        .replace(/^[\s，。、；：:,.]+/, "")
        .trim();
    }

    // 空答兜底：Agent 轮次用尽仍无正文时，给一句不冷场的话
    if (!answer) {
      answer = "这一时，我不知从何说起。换个问法试试？";
    }

    // 输出闸：模型偶发越界时把词打码再下发，并记一笔供评审查证
    const masked = maskOutput(answer);
    if (masked.hit) {
      answer = masked.text;
      logGuide({
        session_id: sessionId,
        mode: action,
        page,
        question: message.slice(0, 200),
        answer: "[blocked:output]",
        model: "guard",
        tokens: null,
        tools: null,
        blocked: "output",
      });
    }

    // 合并来源：页面情境词 + 词卡涉及词（去重、限量），只回传必要字段
    const slim = (p: any) => ({
      slug: p.slug, title: p.title, tune: p.tune, year: p.year, content: p.content,
    });
    const mergedSources = new Map<string, any>();
    if (poem) mergedSources.set(poem.slug, slim(poem));
    // 工具捞到的词作优先（Agent 的判断比旧式盲检索更准），词卡兜底
    toolSources.forEach((p) => {
      if (p?.slug && !mergedSources.has(p.slug)) mergedSources.set(p.slug, slim(p));
    });
    cards.filter((c) => c.type === "poem").forEach((c) => {
      if (!mergedSources.has(c.slug)) mergedSources.set(c.slug, slim(c));
    });

    // 记录日志（不阻塞响应语义；tools 列记录本次问答用到的工具链）
    logGuide({
      session_id: sessionId,
      mode: action,
      page,
      question: message,
      answer,
      model: resultModel,
      tokens: usage?.total_tokens ?? null,
      tools: toolsUsed.length ? toolsUsed : null,
    });

    return jsonResponse({
      action,
      answer,
      model: resultModel,
      usage,
      cards,          // 动作卡：navigate（跳页/锚点/地图站点）与 poem（追问某首词）
      tools: toolsUsed,
      sources: [...mergedSources.values()].slice(0, 4),
    });
  } catch (error) {
    console.error("guide 处理失败", error);
    const messageText = error instanceof Error ? error.message : "未知错误";
    return jsonResponse({ error: `侍读暂时走神了：${messageText}` }, 500);
  }
});
