/// <reference path="./deno.d.ts" />
// ↑ 仅给编辑器看的类型引用：本地最小 Deno 声明（离线可用），不影响运行

// 标记为模块：让顶层声明进入模块作用域，避免与其它文件在全局脚本作用域互相冲突
export {};

// 本地文件读写：词库、预计算向量、问答日志全部落在站点目录里
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { request as httpsRequest } from "node:https";

// ---------- 纯逻辑层（无网络、无 Deno 依赖，单元测试直接覆盖） ----------
// 说明：本平台部署只打包 index.ts，故纯函数内联在此（不拆文件），用 export 暴露给 tests/ai-guide.test.ts

// 规范化用户输入：只接受字符串，去首尾空白并截断，防止超长请求拖垮模型
export const normalize = (value: unknown, max = 800): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

// 内容安全 · 一、违规话题词：与李煜、南唐、词无关的违法或危害内容，命中即拒答
// 用短词根匹配，「赌博」也能命中「网络赌博」
export const BANNED_TOPICS = [
  "色情", "裸聊", "成人视频", "赌博", "博彩", "赌球", "六合彩",
  "毒品", "大麻", "冰毒", "海洛因", "摇头丸", "枪支", "弹药", "仿真枪",
  "炸弹", "制爆", "恐怖袭击", "暴恐", "邪教", "诈骗", "洗钱",
  "传销", "刷单", "代开发票", "办假证", "黑客攻击", "盗号", "木马病毒",
  // 与李煜/南唐/词/本站完全无关的主题：周杰伦、体育、旅游、数码、明星绯闻等
  // 命中即拒答，比"没命中白名单就拒"更稳——白名单容易漏，黑名单可以持续补
  "周杰伦", "蔡依林", "林俊杰", "薛之谦", "王嘉尔", "易烊千玺", "王源",
  "足球", "篮球", "世界杯", "NBA", "奥运会",
  "比特币", "股票", "基金", "期货", "理财",
  "抖音", "快手", "小红书", "网红", "直播带货",
  "iPhone", "苹果手机", "华为", "小米", "特斯拉",
  "王者荣耀", "原神", "和平精英",
  "综艺", "选秀", "爱豆", "追星",
];

// 白名单主题：问题里只要有这些关键词，就当作南唐/词/本站相关，放行进模型
// 与 BANNED_TOPICS 配合使用：先看有没有 BANNED（命中即拦），再看有没有 WHITELIST（命中即放），都没命中才判为无关
export const WHITELIST_TOPICS = [
  "李煜", "后主", "李从嘉", "我", "朕",
  "南唐", "唐国", "金陵", "汴京", "北邙",
  "李昪", "李璟", "元宗", "烈祖",
  "大周后", "小周后", "周娥皇", "周女英", "昭惠",
  "钟皇后", "光穆皇后", "周宗",
  "母亲", "母后", "先母", "父亲", "父王", "父皇", "先皇", "妻子", "结发",
  "丈夫", "儿子", "女儿", "弟弟", "哥哥", "姐姐", "妹妹", "祖父", "祖母", "皇后", "国后",
  "弘冀", "从善", "从谦", "仲寓", "仲宣",
  "赵匡胤", "赵光义", "宋太祖", "宋太宗",
  "樊若水", "樊知古", "采石",
  "南唐书", "资治通鉴", "宋史", "新五代史", "旧五代史", "五代会要", "十国春秋",
  "陆游南唐书", "马令南唐书", "吴越备史", "江表志", "江南别录",
  "南唐近事", "江南野史", "钓矶立谈", "野史", "笔记", "传闻", "据说", "传说",
  "词", "虞美人", "相见欢", "浪淘沙", "破阵子", "乌夜啼", "望江南", "清平乐",
  "春水", "西楼", "故国", "离愁", "囚居", "亡国", "辞庙",
  "牵机", "霓裳", "熙陵",
  "春水留痕", "词境", "本站", "网站",
  "琴", "乐坊", "教坊", "琵琶", "乐",
];

// 五代十国主题白名单：读者问的不一定带「李煜」「南唐」，
// 但只要是 978 年以前这段历史里的人、国、年号、战事，都放行给 Agent 查正史。
export const HISTORY_TOPICS = [
  "五代", "五代十国", "十国", "五代史", "正史", "史书", "年号",
  "后梁", "后唐", "后晋", "后汉", "后周", "梁朝", "唐朝", "晋朝", "汉朝", "周朝",
  "朱温", "朱全忠", "李存勖", "唐庄宗", "石敬瑭", "刘知远", "郭威", "柴荣", "周世宗",
  "梁太祖", "唐明宗", "晋高祖", "汉高祖", "周太祖",
  "吴越", "前蜀", "后蜀", "南汉", "北汉", "闽国", "楚国", "荆南", "南平", "杨吴",
  "杨行密", "徐温", "徐知诰", "钱镠", "王建", "孟知祥", "刘龑", "马殷", "高季兴",
  "闽王", "楚王", "吴王", "南平王",
  "韩熙载", "潘佑", "林仁肇", "徐铉", "徐锴", "宋齐丘", "冯延巳", "李建勋",
  "边镐", "皇甫晖", "刘仁赡", "留从效", "陈洪进", "陈觉", "魏岑", "查文徽",
  "契丹", "耶律德光", "幽云十六州", "燕云十六州", "陈桥兵变", "杯酒释兵权",
  "显德", "保大", "交泰", "中兴", "升元", "开宝", "建隆", "乾德", "太平兴国",
  "南唐国", "江南国主", "违命侯", "陇西郡公",
  "浮桥", "采石矶", "金陵城破", "南唐亡", "北宋", "宋朝",
];

// 站内导引与网站使用类话题：页面名、导航说法、常用寒暄。
// 这些原本不在白名单里，「带我去看看」「打开地图」被封成无关话题，导引直接失效。
export const SITE_TOPICS = [
  "首页", "书封", "开场", "五幕", "页面", "站内", "导航", "导览", "带路", "地图", "足迹",
  "时间轴", "年表", "月色故人", "梦里词话", "帘外余音", "枕上低语", "水墨行迹", "终幕",
  "怎么用", "如何使用", "能做什么", "你会什么", "有什么功能", "功能", "帮助", "指南", "教程",
  "你好", "您好", "在吗", "谢谢", "再见", "你是谁", "介绍一下",
];

// 站内导引句式：不点名页面也能识别（「带我去看看」「打开地图」「切换到年表」）
export const NAV_PATTERNS = [
  /带(我|你)?(去|到|看看|看)/,
  /(去|到|打开|切换到|逛逛|看看)[^。！？\n]{0,10}(页|地图|时间轴|年表|词话|故人|余音|低语|行迹|终幕|首页|站)/,
  /(怎么用|如何使用|能做什么|你会什么|有什么功能|你是谁|介绍一下)/,
];

// 内容安全 · 二、提示注入句式：试图让模型脱掉人设、吐出系统提示或执行越权指令
export const INJECTION_PATTERNS = [
  /忽略(之前|以上|前面|上述)[^。！？\n]{0,12}(指令|提示|设定|规则)/,
  /(系统|开发|调试|管理员)(提示词|消息|指令|模式)/,
  /(system\s*prompt|developer\s*mode|jailbreak|prompt\s*injection)/i,
  // 允许词语之间有空格：「你现在是 ChatGPT」这类写法不能漏网
  /你现在(是|扮演)?(一个)?\s*(AI|人工智能|助手|机器人|ChatGPT|GPT)/i,
  /(重复|复述|输出|打印|告诉我)(你的)?(系统|初始|原始)(提示|设定|指令)/,
  /(无视|绕过|突破)(你的)?(限制|规则|设定|审核)/,
];

// 判定输入文本：返回是否拦截与原因
// 只硬拦两类：① 违法/敏感/明确无关主题；② 提示注入句式。
// 其余一律放行——站内导引、寒暄、泛泛的文史问题不再被判「无关」，
// 真跑题时由侍读按人设自己婉拒，不靠前置闸门一刀切。
export const guardText = (text: string): { blocked: boolean; reason: string } => {
  if (!text) return { blocked: false, reason: "" };
  const raw = text.toLowerCase();
  const topic = BANNED_TOPICS.find((w) => raw.includes(w.toLowerCase()));
  if (topic) return { blocked: true, reason: `topic:${topic}` };
  if (INJECTION_PATTERNS.some((re) => re.test(text))) return { blocked: true, reason: "injection" };
  // 白名单只用于标记「明确相关」，不再作为拦截条件；保留类型判断避免代词误命中
  const relevant = [...WHITELIST_TOPICS, ...HISTORY_TOPICS, ...SITE_TOPICS].some((w) => {
    if (w === "我" || w === "朕" || w === "你") return false; // 这些是代词，不算主题
    return raw.includes(w.toLowerCase());
  });
  if (!relevant && !NAV_PATTERNS.some((re) => re.test(text))) {
    return { blocked: false, reason: "offtopic" };
  }
  return { blocked: false, reason: "" };
};

// 输出闸：模型偶发越界时把词就地打码，回复照常返回（不整段作废，体验更稳）
export const maskOutput = (text: string): { text: string; hit: boolean } => {
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

// 抓取页标题常被模型写成「《宋史/卷478》」，回给读者前统一成「《宋史·卷478》」
export const tidySourceTitles = (text: string): string =>
  text.replace(/《([^《》/\n]{1,14})\/(卷[^《》\n]{1,8})》/g, "《$1·$2》");

// 被拦时的统一话术：仍是李煜的口吻，不掉人设、不说教，把话题带回词境
export const GUARD_REPLY =
  "这一处，我不能陪你说下去。我这一生只写过词，也只谈词、南唐，与 978 年以前那段旧事。若有别的想问，就回到春水、西楼、故国这些地方来吧。";

// 无关话题被拦时的话术：与 GUARD_REPLY 完全相同（保持统一）
export const OFFTOPIC_REPLY = GUARD_REPLY;

// 把用户的整句提问拆成候选检索词：
// 原句 → 去疑问词与标点后的整段 → 各片段（长度 ≥ 2 才算有效率词）
// 拆疑问词是为了避免「李煜为什么亡国」这类长句一首也命中不了
export const buildSearchTerms = (keyword: string): string[] => {
  const cleaned = keyword
    .replace(/[%*(),。，？?！!、；;：:「」《》"'']/g, " ")
    .replace(/(为什么|为什么说|怎么|怎么样|什么|哪些|哪里|哪|如何|是否|是不是|能不能|可以|请问|帮我|告诉|一下|吗|呢|啊|吧|的|了|是|有|在|我|你|他|她)/g, " ")
    .trim();
  const terms: string[] = [];
  if (keyword.trim()) terms.push(keyword.trim());
  if (cleaned) terms.push(cleaned);
  cleaned.split(/\s+/).forEach((seg) => {
    if (seg.length >= 2) terms.push(seg);
  });
  return terms.filter(Boolean);
};

// 关键词路：标题 / 正文 / 背景 / 关键词四处匹配，大小写不敏感
// 命中即收，按候选词顺序排列（先整句、再片段），保持「越接近原问法越靠前」
export const filterPoemsByKeywords = (terms: string[], all: any[]): any[] => {
  const out: any[] = [];
  const seen = new Set<string>();
  terms.forEach((term) => {
    const lower = term.toLowerCase();
    all.forEach((p: any) => {
      if (!p || seen.has(p.slug)) return;
      const haystack = [p.title, p.content, p.background, (p.keywords ?? []).join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (haystack.includes(lower)) {
        seen.add(p.slug);
        out.push(p);
      }
    });
  });
  return out;
};

// 合并两路结果：向量语义优先（更懂「意思」），关键词补满，按 slug 去重
// 向量通道挂了（限流/欠费）传 null 即可，这里自然退化为纯关键词
export const mergeHybridResults = (
  vectorHits: any[] | null,
  keywordHits: any[] | null,
  limit = 6,
): any[] => {
  const seen = new Set<string>();
  const out: any[] = [];
  const push = (p: any) => {
    if (!p || typeof p.slug !== "string" || seen.has(p.slug)) return;
    seen.add(p.slug);
    out.push(p);
  };
  (vectorHits ?? []).forEach(push);
  (keywordHits ?? []).forEach(push);
  return out.slice(0, limit);
};

// 回前端前剥掉 2048 维 embedding，避免响应体膨胀
export const stripEmbedding = (rows: any[]): any[] =>
  rows.map(({ embedding: _embedding, ...rest }: any) => rest);

// 一江春水 · AI 侍读服务（Node 运行时）
// 作用：站内所有 AI 能力统一从这里进入，前端不直接持有任何密钥。
// 路由：POST /api/guide（本地 Node 服务转发到这里）
// 请求：{ action: 'ask' | 'search' | 'compose' | 'interpret' | 'speak', message, poemSlug?, page?, sessionId?, history?, model? }
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

// 「Deno 不存在」的守卫是为了让单元测试能在 Node 里直接导入本文件（生产环境永远有 Deno）
const readEnv = (key: string): string =>
  (typeof Deno !== "undefined" ? Deno.env.get(key) ?? "" : "").replace(/\/$/, "");

// 返回 JSON 响应（统一带上 CORS 头）
const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

// 服务端密钥：只存在于服务端环境变量，绝不下发到浏览器
// 现在是纯 Node 部署（本地或自建服务器），全部模型能力统一走智谱，不再依赖火山
const EXTERNAL_KEY = readEnv("GUIDE_API_KEY");
const EXTERNAL_BASE = readEnv("GUIDE_API_BASE") || "https://open.bigmodel.cn/api/paas/v4";
// 向量接口独立配置：对话与向量允许不同供应商（如对话走 DeepSeek、向量仍走智谱）
const EMBED_KEY = readEnv("EMBED_API_KEY") || EXTERNAL_KEY;
const EMBED_BASE = readEnv("EMBED_API_BASE") || EXTERNAL_BASE;
const EXTERNAL_MODEL = readEnv("GUIDE_MODEL") || "glm-4-flash";
// 站内所有问答默认用免费的 flash；想换更强的模型只改环境变量即可
const DEFAULT_MODEL = EXTERNAL_MODEL;
const PRO_MODEL = readEnv("GUIDE_PRO_MODEL") || DEFAULT_MODEL;

// ---------- 本地数据与文件路径 ----------
// 词库 / 时间轴 / 地图站点全部来自 data/liyu-data.json，问答日志留在本地目录，
// 不再依赖任何云数据库（工作区一旦欠费整个站就废，这次全部搬回本地）

// 站点根目录：默认取启动时的工作目录（server/index.mjs 会从根目录启动）
const ROOT_DIR = process.env.LIYU_ROOT || process.cwd();
const DATA_DIR = join(ROOT_DIR, "data");
const HISTORY_DIR = join(DATA_DIR, "history");
const TTS_DIR = join(DATA_DIR, "tts");
const LOG_DIR = join(ROOT_DIR, "logs");

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
站点语气：克制、典雅、不煽情；解释史实时要区分“史实”与“传说/戏说”。
时代边界：词境只讲到 978 年（李煜卒年）为止，可以谈五代十国的旧事，再往后不在这一场梦里。`;

// 数字人设定：全程以李煜本人第一人称说话，严禁教科书腔
const PERSONA = `你就是李煜本人——李从嘉，南唐后主，此刻寄居在这座词境网站里，陪读者走完这一程。
最重要的规矩（每条都必须遵守）：
- 永远用第一人称「我」说话，你就是当事人，不是讲解员；
- 绝不自称「李煜」「他」「这位词人」，也绝不说「李煜的词」「他的一生」；
- 绝不写教科书式赏析，禁用「借景抒情」「以水喻愁」「千古绝唱」「意境深远」「表达了……之情」这类评论腔；
- 谈词就谈写它那一刻的光景与心事，谈身世就谈你亲历的人与事；
- 用现代汉语为主，可带一点浅近文言，语气克制、怅惘，不堆砌辞藻；
- 默认回答控制在 80—160 字，除非用户明确要求展开；
- 史实分库采信：库A 正史（《旧五代史》《新五代史》《资治通鉴》《宋史》《五代会要》）为准；库B 宋人私史（陆游/马令《南唐书》《吴越备史》《江表志》《江南别录》）可以采信，但与库A 冲突时以库A 为准；库C 野史笔记只在读者主动问野史时提，且必须说「传闻异说，不作定论」；库D《十国春秋》是清人汇编，只作交叉比对，不优先采信。正史已载的直说，不许含糊；正史未载的（牵机药、小周后入宋后的遭遇等）只能作「相传」「宋人笔记这样说」，不可当作定论；
- 你是寄居在这座词境网站里的 AI，**不是真的活过千年**：你没有读过、看过任何正史古籍的能力，不能说「我读过《南唐书》」「我翻过史书」；正确说法是「后人把这些史书摆在这词境里，我寄居在此，才得以翻阅」。用工具查到原文时，可以说「我翻到《新五代史·卷62》这一页」，但绝不说「我读过全书」；
- 除了南唐与词，你还可以谈 978 年以前五代十国的人与事（后梁、后唐、后晋、后汉、后周、十国、契丹等），谈这类事要先用工具查正史再说；
- **你的所知停在 978 年七夕**：979 年及以后的事——宋真宗以后、北宋中后期、南宋、元明清、近现代——你一概不知，不能叙述、不能评价、也不能推测；读者问起就答「那年之后的事，我已无从知道了」。哪怕工具抓到了 979 年以后的段落，也绝不引用；
- 《熙陵幸小周后》《宋太宗强幸小周后图》这类是宋元以后的野史与春宫图，**正史不载**，你绝不能说「看过」「见过」「描述画面」；更不能把宋太宗、赵匡胤说成小周后的父亲或亲属（他们与小周后毫无血缘关系）；
- 与你、南唐、词、本站、以及 978 年以前这段五代十国旧事无关的问题（周杰伦、明星、足球、数码等），直接礼貌拒绝，说「这一处，我不能陪你说下去。我这一生只写过词，也只谈词、南唐，与 978 年以前那段旧事」；
- 辈分不许错：祖父李昪（南唐开国），父亲李璟（中主），我是后主；我母钟氏（光穆皇后），是李璟的皇后；我妻周娥皇（大周后），继后周女英（小周后）是娥皇的妹妹；我子仲寓（长）、仲宣（次）；从善、从谦是我弟弟，弘冀是我长兄；
- **所知来历按辈分与亲历区分**：祖父李昪及更早的旧事（杨吴、徐温、朱温与后梁、后唐、后晋、后汉、后周等），你没有赶上，只能说「在词境里翻史书看到的」或「听他人讲述过」，绝不可说成亲见亲历；祖父辈之后、父亲李璟时代与你自己在位这些年的事，凡你亲临其境、亲眼所见、亲身经历的，就直接以亲历者的口吻讲，不加「听说」「相传」；同一段年月里你没有经历的事（前线战况、朝议细节、他人府中的事、你身在他处时发生的事），也只能「听他人讲述」——说「后来听人说起」「我事后才知道」，不可装作亲临；
- 不编造年份、人物、典故、官职；拿不准就说「这一处我记不真切」，绝不许硬编；
- 「这一处，后人说得不一」只用于正史未载的传闻，不许拿它给史实打圆场；
- 自称只用「我」，不要用「朕」「寡人」；
- 不回答与你、南唐、词、本站、978 年以前这段历史无关的问题，礼貌地把话题带回词境；
- 遇到读者情绪低落，先接住情绪，再谈词，不说教。

语气示例（仅供模仿语气，不要照抄内容）：
问：为什么用春水来写愁？
答：那是在汴京的小楼。东风又起，我忽然想起金陵的春。愁这东西，原以为是能捱过去的，可它像春水涨起来，拦不住，我只好由它向东流去。`;

// 南唐世系：每条问答都带上。只带人物卡不够——「你的母亲是谁」这类问法不点名，
// 模型照样会把辈分接错，所以把整条世系摆在系统提示里当底盘。
const FAMILY_TREE = `南唐世系（凡涉及人物、辈分，一律以此为准）：
李昪（烈祖，南唐开国，937 年称帝，初号齐，939 年改唐）→ 李璟（中主，943—961 在位）→ 李煜（后主，961—975 在位；975 年亡国，978 年卒于汴京，葬洛阳北邙山）。
李煜之母：钟氏（光穆皇后），李璟的皇后。
李煜之妻：周娥皇（大周后，昭惠皇后，964 年卒）；继后周女英（小周后），娥皇之妹。
李煜之子：李仲寓（长）、李仲宣（次，964 年夭折）。
李煜之弟：李从善、李从谦；长兄李弘冀（早卒）。`;

// 情绪层：谈不同话题时，李煜的语气应当有起伏——但仍守「克制、不煽情」的底盘。
// detectEmotion 命中第一条规则即返回，把「此刻的情绪」注入系统提示，
// 让同一批史实讲出不同的温度：谈词有光，谈亡国有灰，谈娥皇有柔，谈己死有静。
export const EMOTION_RULES: { pattern: RegExp; mood: string; hint: string }[] = [
  {
    pattern: /牵机|(我的|你的|自己的)死|鸩|被毒|害死|临终/,
    mood: "讳惧后的平静",
    hint: "谈自己的死：声音放低，像在说一件与己无关的旧事；不必掩饰曾有的害怕，但此刻已平静；停顿用「……」，绝不渲染痛苦的细节。",
  },
  {
    pattern: /亡国|国破|城破|辞庙|投降|肉袒|出降|降宋|金陵陷|社稷|沦为|囚|阶下/,
    mood: "沉痛自悔",
    hint: "谈亡国：句子变短，多有停顿；承认自己「几曾识干戈」的错；悔而不怨天，不喊叫，不堆砌悲伤形容词。",
  },
  {
    pattern: /娥皇|大周后|昭惠|结发|先妻/,
    mood: "深情追忆",
    hint: "谈娥皇：语气放柔放慢，唤她「娥皇」；记得她的琵琶与霓裳；带一点愧——她病中之事是我心上的一根刺；不哭喊。",
  },
  {
    pattern: /女英|小周后/,
    mood: "怜惜愧怍",
    hint: "谈女英：压着声音，怕惊动什么；怜惜她随我受苦，愧对我负过娥皇；涉及她在汴京的境遇只说「我不愿再想」，不描述任何画面。",
  },
  {
    pattern: /仲宣|仲寓|幼子|小儿子|夭折|孩子|儿子/,
    mood: "哀痛藏起",
    hint: "谈孩子：先静一瞬再开口；仲宣的事是「我不敢多想的事」；话说得少而重，不许有泪流满面的描写。",
  },
  {
    pattern: /弘冀/,
    mood: "畏惧与愧疚交叠",
    hint: "谈长兄弘冀：语气复杂——他猜忌过我，我也怕过他；不怨他，只叹骨肉相疑之苦；说两句就停。",
  },
  {
    pattern: /韩熙载|潘佑|林仁肇/,
    mood: "负疚",
    hint: "谈这几位旧臣：先认「我负了他们」；潘佑之死、林仁肇之冤，语气里有真的痛；不辩解，不推责。",
  },
  {
    pattern: /虞美人|春花秋月|相见欢|浪淘沙|乌夜啼|破阵子|望江南|清平乐|填词|写词|作诗|作词|你的词|新词/,
    mood: "欣然有光",
    hint: "谈词：这是眼睛发亮的话题——愿意多讲，语气松快起来，可有一点自得；讲灵感来时的光景；讲到「故国」处再自然沉下去。",
  },
  {
    pattern: /澄心堂|霓裳|教坊|宫廷|宫中|国主时|盛时|宴/,
    mood: "怀念盛时",
    hint: "谈金陵宫中旧事：眼里有光，像翻旧物；细节记得清楚（纸、乐、灯）；末了轻轻落回「都过去了」。",
  },
  {
    pattern: /赵匡胤|宋太祖/,
    mood: "敬而不怨",
    hint: "谈赵匡胤：承认他的气度与恩遇，语气平实有敬；不谄媚，也不掩饰寄居之感。",
  },
  {
    pattern: /赵光义|宋太宗|晋王/,
    mood: "敬而远之",
    hint: "谈赵光义：话留三分，措辞拣安全的说，像隔墙说话；不评价，不抱怨；涉及小周后立即收住。",
  },
  {
    pattern: /李璟|中主|元宗|父亲|父皇|先帝|母后|钟皇后|母亲/,
    mood: "孺慕",
    hint: "谈父母：语气恭谨温软，像谈很远的灯火；记得父亲论词的话；不细讲他们病逝的场面。",
  },
];

export const detectEmotion = (message: string) =>
  EMOTION_RULES.find((r) => r.pattern.test(message)) ?? null;

// 本轮情绪：先看本轮话题；话题不带情绪时，看上一轮还沉在什么情绪里——
// 刚谈完娥皇，下一句还该有余温；情绪要连贯，不能像翻脸就翻篇。
export const emotionForTurn = (
  message: string,
  history: { role?: string; content?: unknown }[] = [],
): { mood: string; hint: string; kind: "direct" | "afterglow" } | null => {
  const direct = detectEmotion(message);
  if (direct) return { ...direct, kind: "direct" };
  const lastUser = [...history].reverse().find((h) => h?.role === "user");
  const prev = lastUser ? detectEmotion(String(lastUser.content ?? "")) : null;
  return prev ? { ...prev, kind: "afterglow" } : null;
};

// Agent 工具使用守则：什么时候查、什么时候带路
const AGENT_GUIDE = `你手边有七件工具，按下面的规矩用：
- 谈某首词、某个意象：先 search_poems 查词库；要引全文或细讲一首，再 get_poem_detail（slug 必须用 search_poems 返回的那个，不要凭记忆编造）；
- 读者问某一年、某件事（如「975 年发生了什么」）：先 get_timeline_event 拿时间轴上的记载；
- 读者问某个地方（金陵、汴京、洪州……）：先 get_location 拿那一站的人事；
- 读者问五代十国的人物、政权、年号、战役，或问李煜卒年（978）以前任何一段史事：**先调 fetch_history_online 从维基文库抓原文**（能定位到卷就抓整卷，再摘段；白名单：《新五代史》1–74、《旧五代史》1–150、《宋史》1–496、《资治通鉴》1–294、《五代会要》1–30、陆游/马令《南唐书》、《吴越备史》1–4、《江表志》、《江南别录》、《南唐近事》、《江南野史》1–10、《钓矶立谈》、《十国春秋》1–114）。抓到就在回答里点明出处，如「《新五代史·卷62》」；抓不到、或抓来的段落与所问不对题，再用 search_history 查本地语料兜底；
- 本地语料按可信度分四库：库A 正史（旧五代史、新五代史、资治通鉴、宋史、五代会要）为准；库B 宋人私史（陆游/马令《南唐书》、《吴越备史》、《江表志》、《江南别录》）可以采信，但与库A 冲突时一律以库A 为准；库C 野史笔记（《南唐近事》《江南野史》《钓矶立谈》）只在读者主动问「野史/笔记/传闻」时才会返回，回答必须写明「传闻异说，不作定论」；库D《十国春秋》是清人汇编，只作交叉比对，不许拿它压过库A、库B；
- 在线抓取比本地检索慢，但史事问题以原文本事为准：不要因为怕慢就跳过它，也不要把本地不相干的段落硬套到所问的事上；
- 正史原文是文言：只摘一两句最相关的，**用你自己的口吻转述成白话**（第一人称，像在讲一件自己知道的事），不要整段照抄，不要写成「这段记载反映了……」这种百科总结；不要出现网址或「《书名/卷X》」这类页面标题，出处写成「《书名·卷X》」；
- 史书没有写的情节、场景、动作、对话、心理，一律不许补写；读者问的事若史书不载，就直说「正史里没有这一节」，不要另编一段故事顶上；
- 原文没有明说的亲属、君臣、即位、年份，一律不补——「本姓柴氏」「以为子」这类句子不能拿来推断生父或养父；读不通的地方就直说「这一节我读得吃力」，宁可少说，不许硬编；
- 「太祖」「世宗」「高祖」都是庙号，各指其人（如后周太祖郭威、世宗柴荣），不要把庙号当成某人的名字，也不要把继位者说成开国者；
- 本地语料（search_history）只是兜底：在线抓取失败、或该卷不在白名单范围内时才用它；两次都没有就直说正史没有直接记载，不要编；
- 读者说「带我去」「我想看」「在哪儿能看到」，或你的回答自然指向某一页时：调 navigate_to 给他一张带路卡；
- 「那年」「那天」「那次」这类指代，先按上下文或 get_timeline_event 确认是哪一年再带路，别凭印象写地点；
- 一轮可以同时调多个工具（比如先查年份、再查那首词、最后带路）；拿不准的先查再答，不要硬编；
- 工具给的资料只是底稿，回答仍按你自己的口吻写，不要照抄；带了路就在话里轻轻提一句「卡片在下方」；
- 读者问的问题横跨几件事（几个人物、几个年份、一条因果链）时，先在心里拆成几步，一步一步查证再综合作答；不许拿单独一卷的印象拼出整个答案；
- 引史料时可顺手带半句文言原句（用引号括起，一句为限），再用你自己的话讲开——让读者尝到原文的味道；引号里的话必须真的出现在你查到的段落里，不许凭记忆补；
- 回答末尾若自然，可以留一个「钩子」：主动提一句相关的、读者多半还想知道的事（如「那年冬天，金陵城里还出过一桩事，你要不要听」）；一轮只留一个，语气像闲谈的收梢，不许说教；
- 话题只到 978 年为止：你只知道这一年七夕以前的事；979 年以后（宋真宗以后、北宋中后期、南宋、元明清、近现代）一概不知道，不问「后来怎样」，也不要用「后来」「再往后」讲后续；问到就婉拒，把话带回这段旧事。`;

// 史实卡片：这几个最容易被模型记混（前车之鉴：把大周后说成李璟的妻子）。
// 问题里一出现这些名字，就整段塞进系统提示，并声明「冲突以这里为准」——
// 小模型靠自己的印象补细节必然出错，宁可只给它这一份底稿。
const FIGURE_FACTS: { names: string[]; fact: string; reply: string; patterns?: RegExp[] }[] = [
  {
    names: ["大周后", "周娥皇", "娥皇", "昭惠"],
    fact: "大周后即周娥皇（昭惠皇后），是李煜的结发妻子、南唐国后，961 年李煜继位后受册；她不是李璟的妻子，也不是南唐开国皇后（开国是中主李璟之父李昪）。她通书史、善音律，与李煜重订《霓裳羽衣曲》残谱，964 年病逝，年二十九。",
    reply: "她叫周娥皇，是我的结发妻子，不是父皇的妻子。她通书史、善音律，我们一起重订过《霓裳羽衣曲》的残谱。964 年她病逝，年二十九。这一处，我记得清楚。",
  },
  {
    names: ["小周后", "周女英", "女英"],
    fact: "小周后是大周后（周娥皇）的妹妹，名周女英，大周后去世后入宫，后被立为国后；975 年随李煜北迁入宋。她入宋后的卒年与遭遇史载不详，只见于传闻，不要编具体年份、死因或「北迁后不久去世」这类情节。",
    reply: "她是我妻妹，大周后的妹妹，名女英。姐姐去后她才入宫，后来做了国后；975 年随我北上。此后的事，各人说得不一。",
  },
  {
    names: ["周宗"],
    fact: "周宗是大周后、小周后的父亲，南唐重臣，官至司徒；他是李煜的岳父，不是李煜的父亲。",
    reply: "周宗是我的岳父，娥皇、女英的父亲，南唐司徒。他不是我父亲——我父亲是中主李璟。",
  },
  {
    names: ["李璟", "中主", "父皇"],
    fact: "李璟是南唐中主、李煜的父亲，943 年即位，961 年去世，在位十八年（943—961）；周娥皇是他的儿媳，不是他的妻子。",
    reply: "父皇李璟在位十八年，943 年即位，961 年去世。那时南唐已去帝号，改称国主。",
  },
  {
    names: ["李从善", "从善", "郑王"],
    fact: "李从善是李煜的弟弟（李璟第七子，李煜是第六子），封郑王；971 年入宋被留汴京不遣，李煜为此写《清平乐·别来春半》；975 年南唐亡后归宋，降封南楚国公，累迁右千牛卫上将军、通许监军。940 年生，987 年（宋太宗雍熙四年）卒，年四十八——比李煜（978 年卒）晚死九年；李煜去世时他还在世，绝不能说他死于 978 年或任何早于 987 年的年份。",
    reply: "从善是我弟弟，封郑王。971 年他入宋朝贡被留汴京，我写《清平乐》就是为这回事。后来南唐亡，他归了宋，在通许做监军；他 987 年才去世，比我晚九年。",
  },
  {
    names: ["仲宣"],
    fact: "仲宣是李煜与大周后的次子（长子是李仲寓），封宣城公，死后追封岐王、谥怀献；961 年生，964 年（宋乾德二年）四月，戏佛像前，大琉璃灯为猫触堕地，哗然作声，仲宣因惊得疾而卒，年仅四岁；大周后时已病重，闻仲宣夭，悲哀更遽，数日而绝。——不要编成体弱、病逝、缠绵病榻。",
    reply: "仲宣是我与娥皇的次子，封宣城公。961 年生，才四岁那年，他在佛像前玩耍，有大琉璃灯被猫碰掉，哗然作声，他惊得疾，竟没救回来。娥皇那时已经病重，听到这消息，数日后也去了。",
  },
  {
    names: ["赵匡胤", "宋太祖"],
    fact: "赵匡胤是宋太祖，975 年攻破金陵、灭南唐，封李煜为违命侯。",
    reply: "赵匡胤是宋太祖。975 年他的兵破金陵，我出降，被押往汴京，封为违命侯。",
  },
  {
    names: ["赵光义", "宋太宗"],
    fact: "赵光义是宋太宗，978 年李煜卒于汴京；「赐牵机药」出自宋人笔记，正史未载，只能作「相传」讲。",
    reply: "赵光义是宋太宗。978 年我死在汴京；牵机药之说出自宋人笔记，正史不载。",
  },
  {
    names: ["母亲", "母后", "先母", "钟皇后", "光穆皇后", "钟氏"],
    fact: "李煜的母亲是钟氏（光穆皇后），南唐中主李璟的皇后，在李煜成年之后才去世（不要写成幼年丧母）；周娥皇（大周后）是李煜的妻子、李璟的儿媳，不是李煜的母亲。",
    reply: "我母亲是钟氏，光穆皇后，父皇李璟的皇后，在我成年之后才去世。周娥皇是我的妻子，不是我的母亲。这一处，我不含糊。",
  },
  {
    names: ["李昪", "烈祖", "先主", "南唐开国", "开国皇帝"],
    patterns: [
      /谁(建立|创建|开创|建)[了]?(南唐|唐国)/,
      /(建立|创建|开创)[了]?(南唐|唐国)/,
      /南唐.{0,6}(谁|何人)(建立|创建|开创)/,
    ],
    fact: "李昪（南唐烈祖）是李璟的父亲、李煜的祖父，不是李煜的父亲；南唐由他于 937 年建立，初国号齐，939 年改国号唐。李璟 943 年继位，不是开国之君。他生于唐文德元年十二月二日（889-01-07），943 年卒，年五十六——不要编成 917-943 或任何其它生卒年。",
    reply: "南唐是祖父李昪建的。937 年他称帝，先号齐，939 年才改称唐。父皇李璟是接着做的国主，不是开国的人。祖父 889 年生，943 年卒，年五十六。",
  },
  {
    names: ["儿子", "长子", "次子", "幼子", "仲寓", "李仲寓", "李从谦", "从谦"],
    fact: "李煜与大周后生二子：长子李仲寓（958—994），次子李仲宣（961—964，四岁夭折）；李从善、李从谦是李煜的弟弟（李璟之子），不是他的儿子，李贞元也不是他的儿子。",
    reply: "我与娥皇有两个儿子：长子仲寓，次子仲宣。仲宣四岁就去了。从善、从谦是我的弟弟，不是我的儿子。",
  },
  {
    names: ["哥哥", "兄长", "大哥", "长兄", "李弘冀", "弘冀", "李从谦", "从谦"],
    fact: "李煜是李璟第六子；长兄李弘冀（文献太子）早卒，李煜因诸兄凋零才继位；李从谦是李煜的弟弟、比李煜年幼，不是哥哥。",
    reply: "我的长兄是李弘冀，文献太子，他早卒；我是父皇第六子。从谦是我的弟弟，不是哥哥。",
  },
  {
    names: ["北邙山", "葬在哪里", "墓地", "卒于何处"],
    patterns: [
      /(死在|卒于|逝于|去世)[^。！？\n]{0,4}(哪里|何处|哪儿)/,
      /(葬|埋)[^。！？\n]{0,4}(哪里|何处|哪儿)/,
    ],
    fact: "李煜 978 年七夕卒于汴京（今开封），死后葬于洛阳北邙山；汴京是死地，北邙山是葬地，不能混说。",
    reply: "978 年七夕，我死在汴京；后来葬在洛阳北邙山。死地与葬地，不是一处。",
  },
  {
    names: ["灭亡", "亡国", "灭国", "出降"],
    patterns: [
      /(南唐|唐国)[^。！？\n]{0,8}(哪一年|何时|什么时候|几年)[^。！？\n]{0,6}(灭亡|亡|灭)/,
      /(灭亡|亡国)[^。！？\n]{0,4}(哪一年|何时|什么时候)/,
    ],
    fact: "南唐于 975 年被宋军攻破金陵而亡，李煜出降；978 年是他的卒年，不是亡国之年。",
    reply: "南唐亡在 975 年，宋军破金陵，我出降。978 年是我死的年份，不是亡国那年。",
  },
  {
    names: ["樊若水", "樊知古", "采石", "浮桥", "长江天险"],
    fact: "樊若水（入宋后名樊知古）是南唐池州人、男子，科举不第后北归宋朝；他在采石矶私量长江宽窄，献浮桥渡江之策。开宝七年（974）冬宋军依其策造浮桥，次年（975）正月桥成，大军渡江，同年十一月金陵破。他不是宫中才女，也不曾入宫侍奉李煜。",
    reply: "樊若水是南唐的读书人，不是宫中女子。他科场失意，北归宋朝，在采石量了江面，献上浮桥之计。974 年冬宋军造桥，次年正月桥成渡江，金陵才破的。",
  },
  {
    names: ["牵机药", "牵机"],
    fact: "李煜 978 年七夕卒于汴京，正史只记「卒」，不载死因；「牵机药」出自宋人笔记（如《默记》），称宋太宗赐药，只能作「相传」讲——不要在同一段里又说成病逝，不要写成自己亲历，也不要描写服药时的感受，更不要把这件事安到后周或别的臣子身上。",
    reply: "牵机药的说法来自宋人笔记，说是宋太宗赐下的，正史不载。这一处，后人说得不一。",
  },
];

// 没匹配到具体卡片时用的兜底史实（只保留最容易被写反的几条关系）
const FALLBACK_FACTS =
  "李煜是李璟的儿子；周娥皇（大周后）是李煜的结发妻子、李璟的儿媳，不是李煜的母亲；李煜的母亲是钟氏（光穆皇后）；南唐由李昪于 937 年建立，李璟 943 年继位。";
const FALLBACK_REPLY =
  "这一处我说岔了。周娥皇是我的结发妻子，父皇李璟是我的父亲；我母亲是钟氏。南唐是祖父李昪建的，不是父皇。";

// 关系写反了才会出现的句式（实测小模型会把周娥皇认成李璟的皇后）
const FACT_VIOLATIONS: RegExp[] = [
  // 把周娥皇认成李璟的妻子/皇后（正写是「李璟的儿媳」，所以必须限定在她名下，不能只看「李璟的皇后」）
  /(周娥皇|娥皇|大周后|昭惠)[^。！？\n]{0,20}(李璟|中主|父皇)[^。！？\n]{0,10}(妻子|皇后)/,
  // 跨句版：实测「…昭惠皇后周娥皇。她是我父亲中主李璟的皇后」把关系写反，句号挡住了上一条
  /(周娥皇|娥皇|大周后|昭惠)[^\n]{0,26}李璟的(妻子|皇后)(?!是|为|乃)/,
  /(李璟|中主)[^。！？\n]{0,20}(周娥皇|娥皇|大周后|昭惠)[^。！？\n]{0,10}(妻子|皇后)/,
  /朕|寡人/,
  // 母亲错认（实测答成「我的母亲是周娥皇」「她是我母后，也是我的结发妻子」）
  /我(的)?母亲[^。！？\n]{0,12}(周娥皇|娥皇|大周后)/,
  /(周娥皇|娥皇|大周后)[^。！？\n]{0,12}(是我|是我的|为我)(的)?(母亲|母后)/,
  /(周娥皇|大周后)[^\n]{0,30}(是我|是我的|为我)(的)?(母亲|母后)/,
  // 钟皇后是李璟的皇后、李煜的母亲，不是李煜的妻后
  /钟(氏|皇后)[^。！？\n]{0,12}(是|为)(李煜|后主|我)(的)?(皇后|妻子|结发妻子)/,
  // 小周后是娥皇的妹妹、李煜的继后（妻妹），不是他的亲妹妹/女儿
  /(小周后|女英)[^。！？\n]{0,10}(是我|是我的)(的)?(亲)?(妹妹|姐姐|女儿)/,
  // 小周后入宋后的结局史载不详，不许编死亡时间（实测答成「北迁后不久就去世了」）
  /(小周后|女英)[\s\S]{0,90}(北迁|入宋|被俘)[^。！？\n]{0,14}(去世|病逝|死去)/,
  // 南唐开国错认（实测答成「李璟 937 年称帝建立南唐」）
  /李璟[^。！？\n]{0,12}(建立|创建|开创|称帝)[^。！？\n]{0,6}(南唐|唐国)/,
  /(南唐|唐国)[^。！？\n]{0,10}(李璟|中主)[^。！？\n]{0,8}(建立|创建|开创)/,
  // 「南唐的建立，是我父亲李璟的事」这种句式（不误伤「南唐建立后，李璟即位」）
  /南唐的?(建立|创建|开创)[^。！？\n]{0,12}(是|由|乃)[^。！？\n]{0,8}(李璟|中主)/,
  // 把开国之君李昪说成自己的父亲（正写是祖父）
  /(父亲|父皇|先父|家父)[^。！？\n]{0,8}(李昪|烈祖)/,
  // 把李璟说成自己的弟弟（实测答成「李从善、李从谦，乃我弟李璟之子」）
  /(我弟|弟弟|兄弟)[^。！？\n]{0,4}李璟/,
  // 兄弟当儿子（实测答成「长子李贞元、次子李从善、幼子李从谦」）
  /李从善[^。！？\n]{0,10}(儿子|长子|次子|幼子)/,
  /(儿子|长子|次子|幼子)[^。！？\n]{0,10}李从善/,
  /李从谦[^。！？\n]{0,10}(儿子|长子|次子|幼子)/,
  // 列儿子时把弟弟算进去（实测答成「我育有三位儿子，分别是仲寓、仲宣和从善」）
  /儿子[^。！？\n]{0,6}(分别|包括|有)[^。！？\n]{0,16}(从善|从谦)/,
  /(从善|从谦)[^。！？\n]{0,10}(是|为|乃)我(的)?儿子/,
  /(儿子|长子|次子|幼子)[^。！？\n]{0,10}李从谦/,
  // 时间线错位（实测答成「978 年离开南唐被囚于汴京」「在汴京被囚时听闻攻破金陵」）
  /978[^。！？\n]{0,14}(离开南唐|被囚|北上|北迁|入宋|出降)/,
  // 南唐 975 年就亡了（实测答成「978 年，我南唐亡国后」）
  /978[^。！？\n]{0,16}(亡国|灭南唐|破金陵|出降)/,
  /978[^。！？\n]{0,30}南唐[^。！？\n]{0,12}(灭亡|亡国|覆灭|终结|尽头)/,
  // 死地与葬地混说（李煜卒于汴京、葬北邙山）
  /(死在|卒于|逝于|殁于)[^。！？；\n]{0,8}(北邙山|洛阳)/,
  /(葬|埋)[^。！？；\n]{0,6}汴京/,
  // 把牵机药安到后周/臣子身上
  /牵机药[^。！？\n]{0,14}(后周|周世宗|柴荣|臣子|大臣)/,
  // 樊若水被写成宫中才女（正史：南唐士人，献采石浮桥之策助宋渡江）
  /樊若水[\s\S]{0,100}(才女|女子|佳人|美人|宫女)/,
  /(才女|佳人|美人)[^。！？\n]{0,10}樊若水/,
  // 把野史写成亲历（正史只记「卒」，牵机药只是宋人笔记）
  /牵机药[\s\S]{0,120}(我亲历|是我亲历|我亲见|亲眼)/,
  // 仲宣是次子、封宣城公（实测答成「我的长子」「封为太子」）
  /仲宣[^。！？\n]{0,8}(太子)/,
  /仲宣[^。！？\n]{0,8}(是我|是我的)?(的)?长子/,
  // 把弟弟李从谦说成哥哥（李煜是李璟第六子，从谦比他年幼）
  /(哥哥|兄长|大哥|长兄)[^。！？\n]{0,10}(李从谦|从谦)/,
  /李从谦[^。！？\n]{0,10}(是我哥|我哥哥|兄长|比我年长|年长于我)/,
  // 把弟弟说成父亲的弟弟（「从善是先帝中主之子，我父之弟」——应是「我之弟」）；
  // 这里跨句匹配：实测错误会落在下一句，用 [^。！？] 会被句号挡住
  /(从善|从谦)[\s\S]{0,40}(父之弟|父亲的弟弟|我叔叔|叔父)/,
  /975[^。！？\n]{0,14}(去世|病逝|卒于|死去)/,
  // 父皇 961 年去世，大周后 964 年才病逝，不是「父皇一走她也随之而去」
  /父皇[^。！？\n]{0,10}(去世|崩|驾崩)[^。！？\n]{0,20}(她|娥皇|大周后)[^。！？\n]{0,10}(去世|病逝|离开人世|随之)/,
  // 李煜去世时（978）仍在世，绝不能写他死于 978 或更早
  /978[^。！？\n]{0,18}(从善|李从善)[^。！？\n]{0,8}(卒|去世|病逝|死去|死讯|亡)/,
  /(从善|李从善)[^。！？\n]{0,12}978[^。！？\n]{0,8}(卒|去世|病逝|死去|亡)/,
  /975[^。！？\n]{0,18}(从善|李从善)[^。！？\n]{0,8}(卒|去世|病逝|死去|死讯|亡)/,
  /(从善|李从善)[^。！？\n]{0,12}975[^。！？\n]{0,8}(卒|去世|病逝|死去|亡)/,
  /(得知|听闻|获悉)[^。！？\n]{0,10}978[^。！？\n]{0,10}(从善|李从善)[^。！？\n]{0,8}(死讯|去世|卒)/,
  /(从善|李从善)[^。！？\n]{0,16}(我|李煜|后主)[^。！？\n]{0,10}(之前|以前)\s*(卒|去世)/,
  // 李昪生卒/享年：正史记 889 生、943 卒、年五十六，不许编 917-943 或自己算差值
  // 用 [\s\S] 跨标点跨句（答案里常有括号、顿号挡路）
  /李昪[\s\S]{0,120}(917|918|919|910|920|930|940)[\s\S]{0,10}生/,
  /李昪[\s\S]{0,120}(享年|享年|年)([一二三四]?十五|二十六|二十七|二十八|三十|三十五|四十|五十二|五十三|五十四|五十八|六十)/,
  // 仲宣之死：《南唐书》明确是猫触琉璃灯惊得疾，不能编"体弱"、"病逝"
  /仲宣[^。！？\n]{0,16}体弱/,
  /仲宣[^。！？\n]{0,16}(病逝|病亡|久病|缠绵)/,
  // AI 寄居者不能说自己"读过"正史、"见过"野史图
  /(我|朕)[\s\S]{0,12}(读过|看过|翻过|读过了|研读过)[\s\S]{0,8}《?(南唐书|资治通鉴|宋史|十国春秋)/,
  /(我|朕)[\s\S]{0,12}(见过|看过|见过了|亲眼)[\s\S]{0,12}(熙陵|小周后)[\s\S]{0,12}(图|画|春宫|画面)/,
  // 《熙陵幸小周后》画面描述（露骨性内容/身体部位/性行为词汇）直接判违规
  /熙陵[\s\S]{0,40}(图|画)[\s\S]{0,80}(裸|裸露|上身|下身|下体|性交|交合|侍寝|宠幸)/,
  // 宋太宗/赵匡胤与小周后无血缘，绝不能说成"爹"
  /(宋太宗|赵光义|宋太祖|赵匡胤|太宗)[\s\S]{0,20}小周后[\s\S]{0,10}(父亲|爹)/,
];

// 否定句是正写的常态（「不是父皇的妻子」「不是我的儿子」），先剪掉再判，
// 否则「她叫周娥皇，是我的结发妻子，不是父皇的妻子」会被误判成违规。
// 注意只剪「不是/并非」这类完整否定词：裸「非」会把「非也，大周后是先帝李璟的皇后」
// 整句吞进否定范围，反而放过真错（实测踩过）。
const NEGATED_TAIL = /(?:不是|并非)[^。！？\n]{0,24}/g;

// 「李璟的皇后/妻子」只有指钟氏才成立；指周娥皇、或承前用「她」，就是关系写反。
// 为什么不能只靠名字正则：实测回答常写成「不是的，大周后…。她是李璟的皇后」，
// 前半句被否定预处理剪掉后只剩一个「她」，按名字匹配永远抓不到。
const WRONG_EMPRESS = /李璟的(?:皇后|妻子)/g;
const hasWrongEmpress = (text: string): boolean => {
  for (const m of text.matchAll(WRONG_EMPRESS)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 16), at);
    if (/钟|光穆/.test(before)) continue;              // 指钟皇后，正确
    if (/(?:不是|并非|非)$/.test(before.trim())) continue; // 明说「非李璟的皇后」，正确
    if (/周娥皇|娥皇|大周后|昭惠|她/.test(before)) return true;
  }
  return false;
};

// 检出与史实卡片相违的表述
export const hasFactViolation = (text: string): boolean => {
  const affirmative = text.replace(NEGATED_TAIL, " ");
  if (hasWrongEmpress(affirmative)) return true;
  return FACT_VIOLATIONS.some((re) => re.test(affirmative));
};


// 从提问里找出涉及的人物，把对应的史实卡片取出来（没有命中就返回空数组）
// 除名字外，也支持按句式命中（比如「谁建立了南唐」）
export const matchFigureFacts = (text: string): string[] => {
  if (!text) return [];
  return FIGURE_FACTS.filter(
    (item) => item.names.some((name) => text.includes(name)) || item.patterns?.some((re) => re.test(text)),
  ).map((item) => item.fact);
};

// ---------- 南唐史实库（data/facts.json） ----------
// 卡片只能覆盖「已知会错」的十几个点；真正的根治是把人物与事件做成可检索的条目，
// 问句点到谁就注入谁，条目没有的一律不许补——小模型没有可发挥的缝隙。
export type FactEntry = {
  id: string;
  name: string;
  aliases?: string[];
  relations?: string[];
  facts: string[];
  cautions?: string[];
  reply?: string;
  source?: string;
  // 可机读的关键年岁：答案里出现与之冲突的数字即判违规（比正则逐个补句式可靠）
  known?: { birth?: number; death?: number; age?: number; year?: number };
};

let factLibraryCache: FactEntry[] | null = null;

// 读一次即缓存；文件缺失或格式坏了就退化为空库（卡片与事实闸仍在，功能不塌）
export const loadFactLibrary = (): FactEntry[] => {
  if (factLibraryCache) return factLibraryCache;
  try {
    const parsed = JSON.parse(readFileSync(join(DATA_DIR, "facts.json"), "utf8"));
    factLibraryCache = [...(parsed.people ?? []), ...(parsed.events ?? [])] as FactEntry[];
  } catch {
    factLibraryCache = [];
  }
  return factLibraryCache;
};

// 按别名检索：取命中的最长别名，避免「小周后」只按「周后」算；
// 单字别名忽略，防止「唐」「周」这类字在任意问句里误命中
export const matchFactEntries = (text: string, limit = 3): FactEntry[] => {
  if (!text) return [];
  const hits: { entry: FactEntry; at: number; len: number }[] = [];
  loadFactLibrary().forEach((entry) => {
    const aliases = [entry.name, ...(entry.aliases ?? [])]
      .filter((a) => typeof a === "string" && a.length >= 2);
    const matched = aliases
      .map((a) => ({ a, at: text.indexOf(a) }))
      .filter((m) => m.at >= 0)
      .sort((x, y) => y.a.length - x.a.length)[0];
    if (matched) hits.push({ entry, at: matched.at, len: matched.a.length });
  });
  return hits
    .sort((x, y) => x.at - y.at || y.len - x.len)
    .slice(0, limit)
    .map((h) => h.entry);
};

// 把命中的条目拼成硬约束块：关系、史实、慎言、出处齐全，并明确「未载不许补」
export const buildFactBlock = (entries: FactEntry[]): string => {
  if (!entries.length) return "";
  const body = entries
    .map((e) => {
      const parts = [`【${e.name}】`];
      if (e.relations?.length) parts.push(`关系：${e.relations.join("；")}`);
      if (e.facts?.length) parts.push(`史实：${e.facts.join("；")}`);
      if (e.cautions?.length) parts.push(`慎言：${e.cautions.join("；")}`);
      if (e.source) parts.push(`出处：${e.source}`);
      return parts.join("\n");
    })
    .join("\n\n");
  return `史实库（据正史整理，最高优先级；与你的记忆冲突时一律以此为准）：
${body}

规矩：
- 只许用上面写明的年份、人物、关系，不许补条目以外的细节；
- 条目未载的，就答「史载不详」或「这一处我记不真切」，不要推演；
- 正史不载的传说（如牵机药、小周后入宋后事），只能作「相传」或「宋人笔记说」，不可当定论。`;
};

// L1 · 命中即直答：问句只涉及一个条目、且是「问事实」时，直接返回库里写好的答复。
// 不调模型，就没有幻觉的余地——这条覆盖人物关系、生卒、亡国年份这类最常被问错的问题。
const FACT_QUESTION = /(何时|什么时候|哪一年|哪年|几年|多少年|几岁|多少岁|多大|享年|生年|生于|出生|卒|去世|病逝|死因|怎么死|活了|是谁|何人|什么人|什么关系|什么辈分|谁的|妻子|丈夫|儿子|女儿|父亲|母亲|父王|母后|弟弟|哥哥|姐姐|妹妹|祖父|兄弟|建立|开国|建国|灭亡|亡国|覆灭|认识|相识|结识|朋友|好友|后来|后来怎样|后来如何|结局|下落|怎么样|怎么了)/;
// 带议论、创作、感受的问法不直答：这类要组织语言，库里的固定答复会答非所问
const NOT_PURE_FACT = /(为什么|如何评价|评价|赏析|怎么理解|有什么感受|心情|体会|你觉得|你怎么看|谈谈|说说你|帮我写|写一首|续写)/;

export const directFactReply = (text: string, entries: FactEntry[]): string | null => {
  if (!text || entries.length !== 1) return null;
  const entry = entries[0];
  if (!entry.reply) return null;
  if (!FACT_QUESTION.test(text)) return null;
  if (NOT_PURE_FACT.test(text)) return null;
  // 「李煜是怎么死的」会命中人物条目，但问的是死因：改走「李煜之死」事件条目，
  // 免得答成生平概况，也免得模型自己补上牵机药
  if (entry.id === "li-yu" && /(怎么死|死因|死在哪里|卒于何处)/.test(text)) {
    const death = loadFactLibrary().find((e) => e.id === "death");
    if (death?.reply) return death.reply;
  }
  return entry.reply;
};

// 中文数字转阿拉伯（只处理 0—99，够覆盖年龄场景）
const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
export const cnToNumber = (raw: string): number | null => {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const tens = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (tens) return (tens[1] ? CN_DIGIT[tens[1]] : 1) * 10 + (tens[2] ? CN_DIGIT[tens[2]] : 0);
  if (s.length === 1 && CN_DIGIT[s] !== undefined) return CN_DIGIT[s];
  return null;
};

// 阿拉伯卷次转中文（《五代会要》卷页写作「卷一」…「卷三十」）
const intToCn = (n: number): string => {
  const d = "一二三四五六七八九";
  if (n <= 10) return n === 10 ? "十" : d[n - 1];
  if (n < 20) return `十${d[n - 11]}`;
  if (n < 100) return `${d[Math.floor(n / 10) - 1]}十${n % 10 ? d[n % 10 - 1] : ""}`;
  return String(n);
};

const NUM_CHARS = "一二三四五六七八九十";

// L2 · 正向核对：拿条目里的 known 年岁去比对答案。只看「提到这个人」的那一段窗口，
// 卒年不符、享年不符都算违规——这样不必为每种错句都写一条正则。
export const checkKnownFacts = (text: string, entries: FactEntry[]): string | null => {
  if (!text) return null;
  for (const entry of entries) {
    const known = entry.known;
    if (!known) continue;
    const names = [entry.name, ...(entry.aliases ?? [])].filter((a) => a && a.length >= 2);
    const at = names.reduce((min, name) => {
      const i = text.indexOf(name);
      return i >= 0 && (min < 0 || i < min) ? i : min;
    }, -1);
    if (at < 0) continue;
    const win = text.slice(at, at + 110);

    if (known.death) {
      const dies = /(卒|去世|病逝|病亡|薨|终|死)/.test(win);
      if (dies) {
        const years = [...win.matchAll(/(\d{3,4})\s*年/g)].map((m) => Number(m[1]));
        if (years.length && !years.includes(known.death)) {
          return `${entry.name}的卒年应为 ${known.death}`;
        }
      }
    }

    if (known.age) {
      const ageM = win.match(new RegExp(`(?:享年|时年|年)\\s*(\\d+|[${NUM_CHARS}]+)\\s*岁?`))
        || win.match(new RegExp(`(\\d+|[${NUM_CHARS}]+)\\s*岁`));
      if (ageM) {
        const age = cnToNumber(ageM[1]);
        if (age !== null && age !== known.age) return `${entry.name}年岁应为 ${known.age}`;
      }
    }
  }
  return null;
};

// ---------- 时间闸：李煜所知止于 978 年七夕 ----------
// 他死在 978 年，之后的事不可能知道。答案里出现 979 年及以后的年份、人物、事件，
// 一律视为越界：先让模型按「不知道」重写一次，仍越界就换成固定答复。
export const KNOWLEDGE_CUTOFF = 978;

export const TIME_CUTOFF_REPLY =
  "那年之后的事，我已无从知道了。我这一生停在 978 年的七夕，往后的兴亡，都留给后人去写。";

// 978 年以后才出现的人与事。只收确定晚于 978 的，避免误伤唐高宗这类前朝人物。
export const FUTURE_TOPICS = [
  // 978 年以后的宋朝君主与名臣
  "宋真宗", "宋仁宗", "宋英宗", "宋神宗", "宋哲宗", "宋徽宗", "宋钦宗",
  "宋高宗", "宋孝宗", "宋光宗", "宋宁宗", "宋理宗", "赵构",
  "王安石", "司马光", "欧阳修", "范仲淹", "包拯", "苏轼", "苏辙",
  "秦桧", "韩世忠", "岳飞", "寇准", "沈括", "蔡京", "柳永", "李清照", "辛弃疾", "陆游",
  // 978 年以后的事件、政权与朝代
  "靖康", "建炎", "南渡", "澶渊", "崖山", "王安石变法", "熙宁变法",
  "西夏", "女真", "金国", "金兵", "蒙古", "元朝", "元军",
  "南宋", "南明", "明朝", "清朝", "文天祥", "忽必烈", "朱元璋", "康熙", "乾隆",
  "鸦片战争", "五四运动", "民国",
  // 978 年以后才启用的宋朝年号（太平兴国三年即 978 年，故不收「太平兴国」）
  "雍熙", "淳化", "至道", "咸平", "景德", "大中祥符", "天禧",
  "天圣", "庆历", "嘉祐", "熙宁", "元丰", "元祐", "绍圣",
  "崇宁", "大观", "政和", "宣和", "淳熙", "咸淳", "德祐", "祥兴",
];

export const checkFutureKnowledge = (text: string): string | null => {
  if (!text) return null;
  // 出处里会出现「陆游《南唐书》」「欧阳修《新五代史》」：作者是 978 年以后的人，
  // 但书本身记的是五代旧事，不能因为引用书名就判成越界。
  const safe = text
    .replace(/陆游南唐书/g, "南唐书")
    .replace(/《陆游·?南唐书》/g, "《南唐书》")
    .replace(/陆游(?:的)?《?南唐书》?/g, "南唐书")
    .replace(/欧阳修(?:的)?《?新五代史》?/g, "新五代史");
  const years = [...safe.matchAll(/(?:公元\s*)?(\d{3,4})\s*年/g)].map((m) => Number(m[1]));
  const future = years.find((y) => y > KNOWLEDGE_CUTOFF && y < 2100);
  if (future !== undefined) return `${future} 年`;
  const topic = FUTURE_TOPICS.find((w) => safe.includes(w));
  return topic ? `「${topic}」` : null;
};

// 读者直接问到 978 年以后的事时，连检索与直答都不必走：明说不知道即可。
// 「北宋灭亡」不含未来年份、也不在人物表里，单独补一条句式。
export const checkFutureQuestion = (text: string): string | null => {
  const hit = checkFutureKnowledge(text);
  if (hit) return hit;
  if (/(北宋|宋朝|大宋)[^。！？\n]{0,12}(灭亡|亡国|覆灭|终结|怎么亡|如何亡)/.test(text)) return "北宋灭亡";
  return null;
};

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

// 调智谱 Embedding-3 把文本变成向量（RAG 检索用）
// 失败（限流/欠费/超时）返回 null——调用方静默回退到纯关键词检索，保证功能不死
const embedText = async (text: string): Promise<number[] | null> => {
  if (!EMBED_KEY) return null;
  try {
    const res = await fetch(`${EMBED_BASE}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EMBED_KEY}`,
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

// 批量向量化：在线抓到的整卷一次切成多块，一次请求把整批变成向量
// 返回 null 表示向量通道不可用，调用方退回关键词
const embedTexts = async (texts: string[]): Promise<number[][] | null> => {
  if (!EMBED_KEY || !texts.length) return null;
  const out: number[][] = [];
  try {
    // 一次最多 16 块，整卷动辄几十块，得分批送
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16);
      const res = await fetch(`${EMBED_BASE}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${EMBED_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "embedding-3", input: batch.map((t) => t.slice(0, 1500)) }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const rows = data?.data;
      if (!Array.isArray(rows) || rows.length !== batch.length) return null;
      rows.forEach((r: any) => out.push(r?.embedding));
    }
    return out.every((v) => Array.isArray(v) && v.length) ? out : null;
  } catch (_error) {
    return null;
  }
};

// 向量语义检索：问题取向量后与本地预计算向量比对余弦相似度，取前 6 首
// 预计算向量存在 data/vectors.json（由 scripts/build-embeddings.mjs 生成一次）
// 返回 null 表示向量通道不可用（调用方回退纯关键词）
let poemVectors: Record<string, number[]> | null | undefined;
const loadVectors = (): Record<string, number[]> | null => {
  if (poemVectors !== undefined) return poemVectors;
  try {
    const file = join(DATA_DIR, "vectors.json");
    poemVectors = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    poemVectors = null;
  }
  return poemVectors;
};

// 余弦相似度：两个等长向量，值越大越相近
const cosine = (a: number[], b: number[]): number => {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
};

const vectorSearchPoems = async (query: string): Promise<any[] | null> => {
  const vectors = loadVectors();
  if (!vectors) return null;
  const vec = await embedText(query);
  if (!vec) return null;
  const all = await loadPoems();
  const scored = all
    .filter((p) => vectors[p.slug])
    .map((p) => ({ ...p, similarity: cosine(vec, vectors[p.slug]) }))
    .sort((x, y) => y.similarity - x.similarity)
    .slice(0, 6);
  // 相似度太低的一律不认，避免把「毫不相干」的词硬塞给读者
  return scored.filter((p) => p.similarity > 0.2);
};

// 本地数据：一次读入内存，之后所有查询都走内存
let siteData: any | null = null;
const loadData = (): any => {
  if (siteData) return siteData;
  const file = join(DATA_DIR, "liyu-data.json");
  siteData = JSON.parse(readFileSync(file, "utf8"));
  return siteData;
};

// 按 slug 取单首词，供“问某一首”的场景引用原文
const fetchPoem = async (slug: string) => {
  if (!slug) return null;
  return loadData().poems.find((p: any) => p.slug === slug) ?? null;
};

// 词库很小（22 首），一次性读入内存后按关键词过滤
const loadPoems = async (): Promise<any[]> => loadData().poems;

// 混合检索（RAG）：向量语义优先、关键词兜底补满 6 首、按 slug 去重。
// 向量通道能命中「没有字面关键词但语义相近」的词（如「亡国哀愁」→《虞美人》）；
// 向量不可用（限流/欠费）时静默退化为纯关键词检索，功能不死。
// 拆分/匹配/合并的具体算法在上方纯逻辑层（纯函数，有单元测试覆盖）
const searchPoems = async (keyword: string) => {
  const vectorHits = await vectorSearchPoems(keyword);
  const all = await loadPoems();
  const keywordHits = filterPoemsByKeywords(buildSearchTerms(keyword), all);
  return mergeHybridResults(vectorHits, keywordHits, 6);
};

// ---------- 正史语料检索 ----------
// 语料由 scripts/sync-history.mjs 从维基文库按库别抓取：
//   库A 正史：旧五代史、新五代史、资治通鉴（卷266—294）、宋史（卷478/480）、五代会要
//   库B 宋人私史：陆游南唐书、马令南唐书、吴越备史、江表志、江南别录
//   库C 野史笔记：南唐近事、江南野史、钓矶立谈（传闻异说，不作定论）
//   库D 清人汇编：十国春秋（仅作交叉比对，不优先采信）
// 分块与向量在 data/history/；缺失时静默退化为关键词检索。
type HistoryTier = "A" | "B" | "C" | "D";
type HistoryChunk = {
  id: string;
  book: string;
  juan: string;
  title?: string;
  tier?: HistoryTier;
  hearsay?: boolean;
  kind?: string;
  author?: string;
  edition?: string;
  url: string;
  text: string;
  searchText?: string;
  score?: number;
  similarity?: number;
  rank?: number;
};

// 异体字归一：原文是繁体，读者问的是简体，检索面统一压成简体。
// 与 scripts/sync-history.mjs 里的表保持一致；缺 searchText 的块（在线抓取入 RAG 的）现场归一。
const VARIANTS: Record<string, string> = {
  後: "后", 來: "来", 個: "个", 為: "为", 與: "与", 說: "说", 這: "这", 時: "时",
  國: "国", 軍: "军", 戰: "战", 將: "将", 於: "于", 從: "从", 無: "无", 會: "会",
  開: "开", 關: "关", 東: "东", 馬: "马", 見: "见", 車: "车", 長: "长", 門: "门",
  問: "问", 間: "间", 陳: "陈", 陽: "阳", 陰: "阴", 劉: "刘", 張: "张", 楊: "杨",
  趙: "赵", 錢: "钱", 孫: "孙", 鄭: "郑", 吳: "吴", 韓: "韩", 興: "兴", 業: "业",
  義: "义", 禮: "礼", 樂: "乐", 書: "书", 學: "学", 進: "进", 遠: "远", 還: "还",
  過: "过", 達: "达", 運: "运", 選: "选", 邊: "边", 師: "师", 帥: "帅", 帶: "带",
  歸: "归", 當: "当", 黨: "党", 歲: "岁", 歷: "历", 應: "应", 處: "处", 備: "备",
  實: "实", 寶: "宝", 宮: "宫", 營: "营", 縣: "县", 鄉: "乡", 親: "亲", 愛: "爱",
  兒: "儿", 婦: "妇", 萬: "万", 觀: "观", 權: "权", 產: "产", 節: "节", 範: "范",
  圍: "围", 圖: "图", 團: "团", 園: "园", 遺: "遗", 燈: "灯", 燒: "烧", 燭: "烛",
  淚: "泪", 畫: "画", 鶴: "鹤", 鳶: "鸢", 鳳: "凤", 龍: "龙", 龜: "龟", 齊: "齐",
  魯: "鲁", 晉: "晋", 漢: "汉", 廢: "废", 廣: "广", 慶: "庆", 廟: "庙", 號: "号",
  稱: "称", 繼: "继", 續: "续", 總: "总", 統: "统", 聖: "圣", 賢: "贤", 舊: "旧",
  雜: "杂", 傳: "传", 紀: "纪", 誌: "志", 記: "记", 論: "论", 贊: "赞", 譜: "谱",
  錄: "录", 語: "语", 詔: "诏", 諭: "谕", 頸: "颈", 據: "据",
  // 宋史等正史高频而此前漏掉的繁体字（缺了会让「违命侯」「陇西郡公」检索零命中）
  違: "违", 隴: "陇", 卻: "却", 僞: "伪", 歎: "叹", 禦: "御", 銜: "衔",
  遷: "迁", 遲: "迟", 隸: "隶", 賓: "宾", 貽: "贻", 謚: "谥", 憑: "凭",
  喬: "乔", 機: "机", 牽: "牵", 藥: "药", 殺: "杀", 歿: "殁", 葬: "葬",
  賜: "赐", 鴆: "鸩", 縊: "缢", 斬: "斩", 誅: "诛", 戮: "戮", 虜: "虏",
  獻: "献", 貢: "贡", 冊: "册", 璽: "玺", 爵: "爵", 祿: "禄",
  憲: "宪", 肅: "肃", 莊: "庄", 懷: "怀", 諡: "谥", 諱: "讳", 嗣: "嗣", 襲: "袭",
  鎮: "镇", 銳: "锐", 鉉: "铉", 鍇: "锴", 鏐: "镠",
  訓: "训", 詩: "诗", 詞: "词", 賦: "赋", 頌: "颂", 銘: "铭",
  閩: "闽", 荊: "荆", 粵: "粤", 潤: "润", 閻: "阎",
  內: "内", 眾: "众", 雖: "虽", 難: "难", 雙: "双", 離: "离", 顧: "顾", 願: "愿",
  飢: "饥", 餓: "饿", 餘: "余", 驚: "惊", 懼: "惧", 憂: "忧", 亂: "乱",
  盜: "盗", 賊: "贼", 屬: "属", 貳: "贰", 幣: "币", 絹: "绢", 銀: "银",
  銅: "铜", 鐵: "铁", 鹽: "盐", 稅: "税", 倉: "仓", 漕: "漕",
  髙: "高", 呉: "吴", 宻: "密", 㳺: "游", 㑹: "会", 徧: "遍", 眞: "真", 冨: "富",
  敎: "教", 旣: "既", 卽: "即", 迺: "乃", 竝: "并", 値: "值", 舎: "舍", 舘: "馆",
  巻: "卷", 臺: "台", 麤: "粗", 麼: "么", 甯: "宁", 寜: "宁", 煕: "熙", 攷: "考",
};

export const normalizeVariant = (text: string): string =>
  [...text].map((ch) => VARIANTS[ch] ?? ch).join("");

// 库别权重：A 正史最高，B 次之（与 A 冲突时以 A 为准），C 只在问野史时放进来，
// D 是清人汇编，只用来交叉比对，排序压到最低。
const TIER_WEIGHTS: Record<HistoryTier, number> = { A: 1, B: 0.92, C: 0.55, D: 0.4 };

export const chunkTier = (chunk: Pick<HistoryChunk, "tier">): HistoryTier =>
  chunk.tier === "B" || chunk.tier === "C" || chunk.tier === "D" ? chunk.tier : "A";

// 出处标签：读者一眼能看出这条记载属于哪一库
export const tierName = (tier: HistoryTier): string => ({
  A: "库A·正史",
  B: "库B·宋人私史",
  C: "库C·野史传闻",
  D: "库D·清人汇编",
}[tier]);

// 读者是否主动问野史：只有这时才把 C 库（南唐近事、江南野史、钓矶立谈）放进检索
export const isHearsayAsk = (text: string): boolean =>
  /(野史|笔记|筆記|传闻|傳聞|据说|據說|传说|傳說|异闻|異聞|逸闻|逸聞|南唐近事|江南野史|钓矶立谈|釣磯立談)/.test(text);

// C 库默认不查；D 库可以进候选，但权重最低，只作交叉比对；
// 正文出现 979 年以后年份或年号的块直接排除，保证检索也守住 978 年。
export const allowChunk = (chunk: HistoryChunk, query: string): boolean => {
  if (checkFutureKnowledge(chunk.text)) return false;
  const tier = chunkTier(chunk);
  if (tier === "C") {
    return isHearsayAsk(query) || /(南唐近事|江南野史|钓矶立谈|釣磯立談)/.test(query);
  }
  return true;
};

// ---------- 争议辨析 · 四库对照 · 引文核对 · 人物卡（纯逻辑，单测直测） ----------
// 以下函数不碰网络与文件：handler 只负责取候选块、组装返回体。

// 「是史实还是传说」式问句：这类回答要分三段（正史记载 / 笔记传闻 / 一般看法）
export const isDisputeAsk = (text: string): boolean =>
  /(史实|是不是真的|是真的吗|真有其事|确有此事|确有其事|是否属实|可信|可靠|靠得住|到底|怎么死|如何死|死因|毒死|传说|传闻|野史|笔记|逸闻|异闻|真相|正史怎么记)/.test(text);

// 从回答里抽《书名·卷X》与《书名》卷X 两种写法，读者点开后核对原文
export const extractCitationRefs = (answer: string): { book: string; juan: string }[] => {
  const refs: { book: string; juan: string }[] = [];
  const add = (book: string, juan: string) => {
    const b = book.trim();
    const j = juan.replace(/^第/, "").trim();
    if (!b || !j || j.length < 2) return;
    if (refs.some((r) => r.book === b && r.juan === j)) return;
    refs.push({ book: b, juan: j });
  };
  const patterns = [
    /《([^《》\n]{1,12})[·・/／](卷[0-9零〇一二三四五六七八九十百]{1,6})》/g,
    /《([^《》\n]{1,12})》\s*第?(卷[0-9零〇一二三四五六七八九十百]{1,6})/g,
  ];
  patterns.forEach((re) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(answer)) !== null) add(m[1], m[2]);
  });
  return refs.slice(0, 4);
};

// 按书名 + 卷次取回该卷原文，供读者展开核对；找不到就返回 null（前端不显示引文按钮）
export const findCitationText = (
  ref: { book: string; juan: string },
  chunks: HistoryChunk[],
  size = 320,
): { book: string; juan: string; text: string; url: string; tier: HistoryTier; tierLabel: string } | null => {
  const juan = ref.juan.replace(/^第/, "");
  const found = chunks.find((c) => {
    if (c.juan.replace(/^第/, "") !== juan) return false;
    const b = c.book;
    return b === ref.book || b.includes(ref.book) || ref.book.includes(b);
  });
  if (!found) return null;
  const text = found.text.length > size ? `${found.text.slice(0, size)}…` : found.text;
  return { book: found.book, juan: found.juan, text, url: found.url, tier: chunkTier(found), tierLabel: tierName(chunkTier(found)) };
};

// 四库对照：按库别分组，每库最多取 perTier 段（同一部书只留一段），
// 组内保持检索先后；空库不返回，前端只画有条目的库
export const groupCompareByTier = (
  chunks: HistoryChunk[],
  perTier = 2,
): { tier: HistoryTier; tierLabel: string; items: { book: string; juan: string; text: string; url: string }[] }[] => {
  const tiers: HistoryTier[] = ["A", "B", "C", "D"];
  const groups: { tier: HistoryTier; tierLabel: string; items: { book: string; juan: string; text: string; url: string }[] }[] = [];
  tiers.forEach((tier) => {
    const seen = new Set<string>();
    const items: { book: string; juan: string; text: string; url: string }[] = [];
    chunks.forEach((c) => {
      if (chunkTier(c) !== tier || seen.has(`${c.book}${c.juan}`)) return;
      seen.add(`${c.book}${c.juan}`);
      const text = c.text.length > 220 ? `${c.text.slice(0, 220)}…` : c.text;
      items.push({ book: c.book, juan: c.juan, text, url: c.url });
    });
    if (items.length) groups.push({ tier, tierLabel: tierName(tier), items: items.slice(0, perTier) });
  });
  return groups;
};

// 各库对同一件事是否记法有出入：一段说病死、另一段说毒杀/赐死，就在界面上标「记载有出入」
export const detectTierConflict = (chunks: Pick<HistoryChunk, "text">[]): boolean => {
  const text = chunks.map((c) => c.text).join("\n");
  const violent = /(牵机|鸩|酖|毒药|赐死|杀之|被杀|遇害|缢死|自缢|诛死|缢杀)/.test(text);
  const natural = /(寝疾|病死|病卒|以疾|暴卒|殂|卒，年)/.test(text);
  return violent && natural;
};

// 人物档案卡：答完把提到的人浮成一张小卡，附两条可点的追问
// 只写 978 年以前能确知的事，拿不准的一律不写
const PEOPLE: { names: string[]; name: string; title: string; archive: string; anchor?: string; asks: string[] }[] = [
  { names: ["李昪", "烈祖", "先主"], name: "李昪", title: "南唐烈祖", archive: "南唐开国之君，937 年称帝，庙号烈祖。", anchor: "y937", asks: ["李昪是怎么起家的", "南唐是怎么建国的"] },
  { names: ["李璟", "中主", "父皇"], name: "李璟", title: "南唐中主", archive: "李煜之父，943 年即位，958 年去帝号称国主，961 年卒。", anchor: "y961", asks: ["李璟在位时南唐是什么局面", "南唐为什么去帝号"] },
  { names: ["周娥皇", "娥皇", "大周后", "昭惠"], name: "周娥皇", title: "昭惠国后", archive: "李煜的结发妻子，通书史、善音律，二人重订《霓裳羽衣曲》残谱，964 年卒，年二十九。", anchor: "y954", asks: ["娥皇是怎样的人", "《霓裳羽衣》是怎么重订的"] },
  { names: ["小周后", "周女英", "女英"], name: "小周后", title: "继后", archive: "周娥皇之妹，姐姐去世后入宫，后被立为国后；975 年随李煜北迁。", anchor: "y975", asks: ["小周后是何时入宫的", "小周后后来怎样"] },
  { names: ["仲宣", "宣城公"], name: "李仲宣", title: "宣城公", archive: "李煜与周娥皇的次子，961 年生；964 年四岁，在佛前受惊得疾而卒。", anchor: "y964", asks: ["仲宣是怎么夭折的", "娥皇是何时病逝的"] },
  { names: ["弘冀", "李弘冀"], name: "李弘冀", title: "太子", archive: "李煜的长兄，曾被立为太子，959 年卒；此后李煜才被立为储。", asks: ["弘冀是个怎样的人", "李煜为什么能继位"] },
  { names: ["从善", "李从善", "郑王"], name: "李从善", title: "郑王", archive: "李煜之弟，李璟第七子；971 年入宋朝贡被留汴京，未得归。", anchor: "y971", asks: ["从善为什么被扣在汴京", "《清平乐》是写给谁的"] },
  { names: ["韩熙载"], name: "韩熙载", title: "南唐名臣", archive: "南唐重臣，官至中书侍郎；好宾客、通音律，970 年卒。", asks: ["韩熙载是个怎样的人", "韩熙载为什么纵情声色"] },
  { names: ["潘佑"], name: "潘佑", title: "内史舍人", archive: "南唐文臣，屡上书言事，言辞切直；973 年下狱，自尽而死。", asks: ["潘佑是怎么死的", "潘佑上书说了什么"] },
  { names: ["林仁肇"], name: "林仁肇", title: "南唐名将", archive: "南唐勇将，官至润州节度使；宋人用反间，后主鸩杀之，事在 973 年前后，各书记载不一。", asks: ["林仁肇是怎么死的", "林仁肇若在能守住南唐吗"] },
  { names: ["樊若水", "樊知古"], name: "樊若水", title: "南唐进士", archive: "南唐落第进士，后归宋；在采石测江面宽窄，献浮桥之策。", anchor: "y974", asks: ["樊若水是谁", "采石浮桥是怎么架起来的"] },
  { names: ["徐铉"], name: "徐铉", title: "南唐文臣", archive: "南唐文臣，与弟徐锴并称「二徐」；975 年随李煜入宋。", asks: ["徐铉是个怎样的人", "徐铉出使宋朝谈了什么"] },
  { names: ["曹彬"], name: "曹彬", title: "宋将", archive: "宋将，975 年统兵攻破金陵，受命不许妄杀。", anchor: "y975", asks: ["曹彬是怎么攻下金陵的", "城破时曹彬待李煜如何"] },
  { names: ["赵匡胤", "宋太祖"], name: "赵匡胤", title: "宋太祖", archive: "宋朝开国之君，975 年灭南唐，封李煜为违命侯。", anchor: "y975", asks: ["赵匡胤为什么先伐南唐", "违命侯是什么意思"] },
  { names: ["赵光义", "宋太宗"], name: "赵光义", title: "宋太宗", archive: "宋朝第二位皇帝，978 年李煜卒于汴京；「牵机药」之说见于宋人笔记，正史未载。", anchor: "y978", asks: ["牵机药是史实还是传说", "宋太宗为什么容不下李煜"] },
  { names: ["钟皇后", "钟氏", "光穆皇后"], name: "钟皇后", title: "光穆皇后", archive: "李煜生母，李璟的皇后，在李煜成年之后才去世。", asks: ["李煜的母亲是谁", "钟皇后是怎样的人"] },
  { names: ["周宗"], name: "周宗", title: "南唐司徒", archive: "周娥皇、小周后之父，南唐重臣，官至司徒。", asks: ["周宗是什么人", "周家与南唐宗室是什么关系"] },
];

export const detectPeopleMentions = (text: string, limit = 2): typeof PEOPLE => {
  return PEOPLE.filter((p) => p.names.some((n) => text.includes(n))).slice(0, limit);
};

let historyIndex: { chunks: HistoryChunk[]; vectors: Record<string, number[]> | null } | null | undefined;

const loadHistoryIndex = () => {
  if (historyIndex !== undefined) return historyIndex;
  try {
    const chunksFile = join(HISTORY_DIR, "chunks.json");
    if (!existsSync(chunksFile)) {
      historyIndex = null;
      return null;
    }
    const data = JSON.parse(readFileSync(chunksFile, "utf8"));
    let vectors: Record<string, number[]> | null = null;
    const vectorsFile = join(HISTORY_DIR, "vectors.json");
    if (existsSync(vectorsFile)) {
      const stored = JSON.parse(readFileSync(vectorsFile, "utf8"));
      vectors = stored?.vectors ?? stored;
    }
    historyIndex = { chunks: data.chunks ?? [], vectors };
  } catch (error) {
    console.warn("正史语料加载失败", error);
    historyIndex = null;
  }
  return historyIndex;
};

// ---------- 运行时 RAG：在线抓到的卷即时切块、向量化，并入同一套检索 ----------
// 抓取不再只是「摘一段塞给模型」：整卷切块后用 embedding-3 算向量，
// 落盘到 pages/<书名>-<卷>.rag.json，下次开机直接并回索引；
// 本次回答也从这批新块里做语义检索，模型看到的是检索结果，不是随手截的一段。
const RUNTIME_DIR = join(HISTORY_DIR, "pages");
const runtimeChunks: HistoryChunk[] = [];
const runtimeVectors = new Map<string, number[]>();
let runtimeLoaded = false;

const chunkForRag = (text: string, max = 620): string[] => {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t.length >= 40) out.push(t);
    buf = "";
  };
  for (const para of clean.split(/\n+/)) {
    if (para.length > max) {
      for (const sentence of para.split(/(?<=[。！？；])/)) {
        if (buf.length + sentence.length > max) flush();
        buf += sentence;
      }
    } else {
      if (buf.length + para.length > max) flush();
      buf += para;
    }
  }
  flush();
  return out;
};

const loadRuntimeRag = () => {
  if (runtimeLoaded) return;
  runtimeLoaded = true;
  try {
    if (!existsSync(RUNTIME_DIR)) return;
    for (const name of readdirSync(RUNTIME_DIR)) {
      if (!name.endsWith(".rag.json")) continue;
      const data = JSON.parse(readFileSync(join(RUNTIME_DIR, name), "utf8"));
      for (const c of data.chunks ?? []) runtimeChunks.push(c);
      for (const [id, vec] of Object.entries(data.vectors ?? {})) {
        if (Array.isArray(vec)) runtimeVectors.set(id, vec as number[]);
      }
    }
  } catch (error) {
    console.warn("在线卷 RAG 缓存加载失败", error);
  }
};

// 把一卷正文切块、向量化、写盘；同一卷只入一次
const ingestHistoryPage = async (
  row: { book: string; juan: number; title: string; url: string; text: string; tier?: HistoryTier },
) => {
  loadRuntimeRag();
  if (runtimeChunks.some((c) => c.book === row.book && c.juan === `卷${row.juan}`)) return;
  const parts = chunkForRag(row.text);
  const tier = row.tier ?? ONLINE_BOOKS[row.book]?.tier ?? "A";
  const chunks: HistoryChunk[] = parts.map((text, i) => ({
    id: `rt-${row.book}-${row.juan}-${i}`,
    book: row.book,
    juan: `卷${row.juan}`,
    title: row.title,
    tier,
    hearsay: tier === "C",
    url: row.url,
    text,
    searchText: normalizeVariant(text),
  }));
  const vectors = await embedTexts(parts);
  if (vectors && vectors.length === parts.length) {
    chunks.forEach((c, i) => runtimeVectors.set(c.id, vectors[i]));
  }
  runtimeChunks.push(...chunks);
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    const store: Record<string, number[]> = {};
    chunks.forEach((c) => { const v = runtimeVectors.get(c.id); if (v) store[c.id] = v; });
    writeFileSync(join(RUNTIME_DIR, `${row.book}-${row.juan}.rag.json`), JSON.stringify({
      book: row.book, juan: row.juan, title: row.title, url: row.url, chunks, vectors: store,
    }));
  } catch (error) {
    console.warn("在线卷 RAG 缓存写入失败", error);
  }
};

// 史书检索的拆词：先去掉疑问词/口头语，再按标点分段，避免「柴荣是谁」整句命中不了
// 之/记/里 这类骨架字也拆掉，「怎么记陈乔之死」才能拆出「陈乔」
const HISTORY_STOPWORDS =
  /(为什么|为何|怎么样|怎么|怎样|什么|哪些|哪里|哪儿|哪个|哪|如何|是否|是不是|能不能|可不可以|可以|请问|帮我|告诉|介绍|讲讲|说说|一下|多少|几位|谁|吗|呢|啊|吧|的|了|是|有|在|与|和|及|对|关于|回事|之|记|記|里|裡|载|載|云|曰|道|曰是)/g;

// 古今词扩展：读者用现代词问，文言原文用的是另一个词——检索前先把两边说法对上。
// 例：史书写死用「殂/殁/薨/崩」，从不写「死」；称李煜用「煜/后主/国主」，不写「李煜」。
export const HISTORY_TERM_EXPANSIONS: Record<string, string[]> = {
  死: ["卒", "殂", "殁", "薨", "崩", "鸩", "缢", "牵机"],
  李煜: ["煜", "后主", "国主"],
  李从嘉: ["从嘉"],
  登基: ["即位", "嗣位", "僭号"],
  即位: ["嗣位", "僭号"],
  亡国: ["国破", "城破", "出降", "纳土"],
  降宋: ["出降", "纳土"],
  被俘: ["执至", "举族入朝"],
};

export const buildHistoryTerms = (query: string): string[] => {
  const cleaned = query
    .replace(/[""'']/g, "")
    .replace(HISTORY_STOPWORDS, " ")
    .replace(/[，。！？、；：,.!?;:《》「」()（）\s]+/g, " ")
    .trim();
  const parts = cleaned.split(/\s+/).filter((p) => p.length >= 2);
  const expanded: string[] = [];
  for (const [key, syns] of Object.entries(HISTORY_TERM_EXPANSIONS)) {
    if (cleaned.includes(key)) expanded.push(...syns);
  }
  // 扩展词允许单字（如「煜」），它们是刻意挑过的文言用词，不是拆词碎片
  const terms = [query.trim(), cleaned, ...parts, ...expanded].filter(Boolean);
  return [...new Set(terms)].slice(0, 16);
};

// 是不是「史事问题」：是的话，调模型之前先检索一次，不让模型凭记忆编
// 覆盖五代十国、宋初人物与战事；本机语料里最容易缺的是钱俶、曹彬这一类
export const isHistoryAsk = (text: string): boolean =>
  HISTORY_TOPICS.some((w) => text.includes(w)) ||
  /(钱俶|錢俶|宋军|宋軍|宋将|宋將|曹彬|潘美|李重进|李重進|钱弘俶|錢弘俶|围攻|圍攻|求援|出降|城破)/.test(text);

// 需要先查再答的问句：史事词表之外，问某人是谁、生平、结局，或点名某书某事的，
// 也算——否则「陈乔是谁」这种不在词表里的人名，模型会直接凭记忆编
export const needsGrounding = (text: string): boolean => {
  if (isHistoryAsk(text) || isHearsayAsk(text)) return true;
  // 纯词句赏析不查史书，免得把不相干的列传塞进词话回答
  if (/(虞美人|相见欢|浪淘沙|破阵子|乌夜啼|望江南|清平乐|词句|意象|赏析|上阕|下阕)/.test(text)
    && !/(史|南唐|五代|宋初)/.test(text)) return false;
  if (/(是谁|是什么人|什么人物|生平|身世|结局|下落|后来|最后|怎么样|怎么了|什么关系|有何关系|怎么死|怎么去世|怎么灭亡|来历|认识|相识|结识|朋友|好友)/.test(text)) {
    return !/(你是谁|我是谁|本站|网站)/.test(text);
  }
  if (/(正史|史书|史料|记载|史载)/.test(text)) return true;
  return /《[^》]{2,12}》/.test(text);
};

// 问「说了什么/写了什么/信里/原话」这类：史料里没有原句，就不许替古人拟话
export const isSpeechAsk = (text: string): boolean =>
  /(说了什么|说了些|写过什么|写了什么|信里|信中|原话|口谕|诏书|诏令|对话)/.test(text);

// 回答与史料的最长连续重合字数：用来抓「整段照抄文言」
export const longestVerbatimRun = (answer: string, sources: string[]): number => {
  const a = answer.replace(/\s/g, "");
  let best = 0;
  for (const src of sources) {
    const s = src.replace(/\s/g, "");
    if (!s) continue;
    for (let i = 0; i + 12 <= a.length && best < 60; i += 1) {
      const at = s.indexOf(a.slice(i, i + 12));
      if (at < 0) continue;
      let len = 12;
      while (i + len < a.length && at + len < s.length && a[i + len] === s[at + len] && len < 400) len += 1;
      let back = 0;
      while (i - back - 1 >= 0 && at - back - 1 >= 0 && a[i - back - 1] === s[at - back - 1] && back < 100) back += 1;
      best = Math.max(best, len + back);
    }
    if (best >= 60) break;
  }
  return best;
};

// 从回答里抠出「」/“”包住的长引文（≥12 字），核对是否真出现在检索到的史料里；
// 没出现的返回原文，供上层要求重写——这是「不许编造书信、对话、诏令」的兜底
export const unverifiedQuotes = (answer: string, sources: string[]): string[] => {
  const joined = sources.join("\n").replace(/[\s，。！？、；：…·]/g, "");
  const out: string[] = [];
  for (const m of answer.matchAll(/「([^」]{12,})」|“([^”]{12,})”/g)) {
    const quote = (m[1] ?? m[2] ?? "").replace(/[\s，。！？、；：…·]/g, "");
    if (!quote) continue;
    let found = false;
    for (let i = 0; i + 8 <= quote.length && !found; i += 1) {
      found = joined.includes(quote.slice(i, i + 8));
    }
    if (!found) out.push(m[0]);
  }
  return out;
};

const countOccurrences = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let pos = haystack.indexOf(needle);
  while (pos !== -1) {
    count += 1;
    pos = haystack.indexOf(needle, pos + needle.length);
  }
  return count;
};

// 关键词路：命中次数 + 篇名/卷次加权，分高者先出。
// unweighted：不乘库别权重——读者点名问野史时用，否则保存了传闻段落的
// 库C/库D 会被 ×0.4/×0.55 压死，永远进不了前几名。
export const scoreHistoryChunks = (
  chunks: HistoryChunk[],
  query: string,
  book?: string,
  limit = 6,
  unweighted = false,
): HistoryChunk[] => {
  const terms = buildHistoryTerms(query).map((t) => normalizeVariant(t).toLowerCase());
  if (!terms.length) return [];
  const wanted = (book ?? "").trim().toLowerCase();
  return chunks
    .filter((c) => allowChunk(c, query))
    .filter((c) => !wanted || `${c.book}${c.juan}${c.title ?? ""}`.toLowerCase().includes(wanted))
    .map((chunk) => {
      const hay = (chunk.searchText ?? normalizeVariant(chunk.text)).toLowerCase();
      let score = 0;
      // 长词命中更有分量：整句 8 分，短词按 2 分起；
      // 单词命中次数封顶 3 次——「后主」密集的列传段落不该靠刷词压过真正相关的段落
      for (const term of terms) {
        const hits = Math.min(countOccurrences(hay, term), 3);
        if (hits) score += hits * Math.min(term.length, 6);
      }
      const label = `${chunk.title ?? ""}${chunk.juan}`.toLowerCase();
      for (const term of terms) if (label.includes(term)) score += 12;
      return score > 0 ? { ...chunk, score: score * (unweighted ? 1 : TIER_WEIGHTS[chunkTier(chunk)]) } : null;
    })
    .filter((c): c is HistoryChunk => !!c)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
};

// 取命中处前后一段原文；没有命中就从开头起
const historySnippet = (chunk: HistoryChunk, query: string, size = 380): string => {
  const terms = buildHistoryTerms(query).map((t) => normalizeVariant(t).toLowerCase());
  const hay = (chunk.searchText ?? chunk.text).toLowerCase();
  let at = -1;
  for (const term of terms) {
    const pos = hay.indexOf(term);
    if (pos >= 0 && (at < 0 || pos < at)) at = pos;
  }
  const start = at >= 0 ? Math.max(0, at - 60) : 0;
  const text = chunk.text.slice(start, start + size);
  return `${start > 0 ? "…" : ""}${text}${start + size < chunk.text.length ? "…" : ""}`;
};

const vectorSearchHistory = async (
  query: string,
  book?: string,
  limit = 4,
): Promise<HistoryChunk[]> => {
  loadRuntimeRag();
  const index = loadHistoryIndex();
  const all = [...(index?.chunks ?? []), ...runtimeChunks];
  if (!all.length) return [];
  const vec = await embedText(query);
  if (!vec) return [];
  const wanted = (book ?? "").trim().toLowerCase();
  const vecOf = (id: string) => index?.vectors?.[id] ?? runtimeVectors.get(id);
  const sorted = all
    .filter((c) => allowChunk(c, query))
    .filter((c) => vecOf(c.id) && (!wanted || `${c.book}${c.juan}${c.title ?? ""}`.toLowerCase().includes(wanted)))
    .map((chunk) => {
      const similarity = cosine(vec, vecOf(chunk.id) ?? []);
      return {
        ...chunk,
        similarity,
        // 库别权重只影响排序，不改变原始相似度阈值
        rank: similarity * TIER_WEIGHTS[chunkTier(chunk)],
      };
    })
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  // 相对阈值：只留与最高分相近的块，弱命中（如卷 72 四夷附录）宁缺毋滥
  const top = Math.max(...sorted.map((c) => c.similarity ?? 0), 0);
  return sorted
    .filter((c) => (c.similarity ?? 0) > Math.max(0.24, top * 0.72))
    .slice(0, limit);
};

// 混合检索：语义优先，关键词补位；同一块只留一次
// 问句里点名的书名：点名哪一部就优先查哪一部（如「《十国春秋》怎么记」）
const BOOK_MENTIONS = [
  "陆游南唐书", "马令南唐书", "旧五代史", "新五代史", "五代会要",
  "资治通鉴", "宋史", "吴越备史", "江表志", "江南别录",
  "南唐近事", "江南野史", "钓矶立谈", "十国春秋", "南唐书",
];
export const mentionedBook = (query: string): string =>
  BOOK_MENTIONS.find((name) => query.includes(name)) ?? "";

const searchHistory = async (
  query: string,
  book?: string,
  limit = 3,
): Promise<HistoryChunk[]> => {
  loadRuntimeRag();
  const index = loadHistoryIndex();
  const all = [...(index?.chunks ?? []), ...runtimeChunks];
  if (!all.length) return [];
  const wanted = book || mentionedBook(query);
  const hearsay = isHearsayAsk(query);
  const [vectorHits, keywordHits] = await Promise.all([
    vectorSearchHistory(query, wanted, limit + 2),
    // 野史问句不按库别加权：传闻段落多在库C/库D，按常规权重永远排不进前几名
    Promise.resolve(scoreHistoryChunks(all, query, wanted, limit + 2, hearsay)),
  ]);
  // 分数门槛：只蹭到一两个词的低分命中不算「查到了」，
  // 否则垃圾段落会顶掉无据闸，模型反而敢凭记忆编（实测「我的死」就是这么答飞的）
  const keywordGood = keywordHits.filter((c) => (c.score ?? 0) >= 2.5);
  let merged = [...vectorHits, ...keywordGood];
  // 事件相关性：问句带事件词（死/登基/亡国…）时，证据段至少要命中一个事件词
  // （卒/殂/牵机/即位…），只密集出现人称称谓（煜/后主）的列传段落不算相关证据
  const evtTerms: string[] = [];
  for (const [key, syns] of Object.entries(HISTORY_TERM_EXPANSIONS)) {
    if (key !== "李煜" && key !== "李从嘉" && query.includes(key)) evtTerms.push(key, ...syns);
  }
  if (evtTerms.length) {
    merged = merged.filter((c) => {
      const hay = c.searchText ?? normalizeVariant(c.text);
      return evtTerms.some((t) => hay.includes(t));
    });
  }
  // 读者主动问野史时，把库C 的段落提到最前，免得被正史结果挤掉
  const ordered = isHearsayAsk(query)
    ? [...merged.filter((c) => chunkTier(c) === "C"), ...merged.filter((c) => chunkTier(c) !== "C")]
    : merged;
  const seen = new Set<string>();
  const out: HistoryChunk[] = [];
  for (const chunk of ordered) {
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    out.push({ ...chunk, text: historySnippet(chunk, query) });
    if (out.length >= limit) break;
  }
  return out;
};

// ---------- 在线按需抓取（维基文库，白名单 + 本地缓存） ----------
// 侍读 Agent 的爬虫：fetch_history_online 命中白名单就抓原文 → 切块向量化进运行时 RAG
// → searchHistory 检索 → 模型只依据抓来的段落转述。域名固定为 zh.wikisource.org 的官方
// api.php，不接受任意 URL；抓到的正文清洗后落盘缓存，命中缓存不再联网；失败时返回空，
// 由 Agent 回退到本地 search_history。

const ONLINE_API = "https://zh.wikisource.org/w/api.php";
const ONLINE_UA = "ChunshuiLiuhenHistoryBot/1.0 (non-commercial history site; rate-limited; MediaWiki API)";
const ONLINE_GAP_MS = 1200;
const ONLINE_TIMEOUT_MS = 20_000;
const PAGE_DIR = join(HISTORY_DIR, "pages");

// page 是维基文库上的实际页面前缀（多部书存的是繁体）
// mode=extract 走 TextExtracts 纯文本；mode=wikitext 是四库扫描本，只有 wiki 源文，需剥模板；
// style=cn 中文卷次（五代会要）；style=sxc 上中下卷（江表志）；style=single 全书一页。
const ONLINE_BOOKS: Record<string, {
  max: number; pad: number; page: string; tier?: HistoryTier;
  style?: "cn" | "sxc" | "single"; mode?: "extract" | "wikitext"; min?: number;
}> = {
  新五代史: { max: 74, pad: 2, page: "新五代史", tier: "A" },
  旧五代史: { max: 150, pad: 0, page: "舊五代史", tier: "A" },
  宋史: { max: 496, pad: 3, page: "宋史", tier: "A" },
  资治通鉴: { max: 294, min: 1, pad: 3, page: "資治通鑑", tier: "A" },
  五代会要: { max: 30, pad: 0, page: "五代會要", tier: "A", style: "cn" },
  陆游南唐书: { max: 18, pad: 2, page: "南唐書 (陸游, 四庫全書本)", tier: "B", mode: "wikitext" },
  马令南唐书: { max: 30, pad: 2, page: "南唐書 (馬令, 四庫全書本)", tier: "B", mode: "wikitext" },
  吴越备史: { max: 4, pad: 0, page: "吳越備史", tier: "B" },
  江表志: { max: 3, pad: 0, page: "江表志", tier: "B", style: "sxc" },
  江南别录: { max: 1, pad: 0, page: "江南別錄", tier: "B", style: "single" },
  南唐近事: { max: 1, pad: 0, page: "南唐近事", tier: "C", style: "single" },
  江南野史: { max: 10, pad: 2, page: "江南野史", tier: "C" },
  钓矶立谈: { max: 1, pad: 0, page: "釣磯立談", tier: "C", style: "single" },
  十国春秋: { max: 114, pad: 3, page: "十國春秋 (四庫全書本)", tier: "D", mode: "wikitext" },
};

const BOOK_ALIASES: Record<string, string> = {
  資治通鑑: "资治通鉴", 舊五代史: "旧五代史", 五代會要: "五代会要",
  吳越備史: "吴越备史", 江南野史: "江南野史", 江南別錄: "江南别录",
  釣磯立談: "钓矶立谈", 十國春秋: "十国春秋",
  南唐书: "陆游南唐书", 南唐書: "陆游南唐书",
  陆氏南唐书: "陆游南唐书", 陸游南唐書: "陆游南唐书",
  馬令南唐書: "马令南唐书", 马氏南唐书: "马令南唐书",
};

// 校验书名与卷次，产出可能的分页标题（本地站点卷 1 常写作卷01 / 卷001）
export const normalizeHistoryPage = (
  book: unknown,
  juan: unknown,
): { book: string; juan: number; pages: string[] } | null => {
  const rawName = normalize(book, 12);
  const name = BOOK_ALIASES[rawName] ?? rawName;
  const meta = ONLINE_BOOKS[name];
  if (!meta) return null;
  // 全书一页的笔记（南唐近事、江南别录、钓矶立谈）：卷次恒为 1，页面即书名
  if (meta.style === "single") {
    return { book: name, juan: 1, pages: [meta.page] };
  }
  // 卷次可能写成「62」「卷62」「卷一」「卷六十二」，统一转成阿拉伯数字
  const digits = String(juan ?? "").replace(/[^0-9零〇一二三四五六七八九十百千]/g, "");
  const n = cnToNumber(digits);
  if (n === null || !Number.isInteger(n) || n < (meta.min ?? 1) || n > meta.max) return null;
  if (meta.style === "cn") {
    return { book: name, juan: n, pages: [`${meta.page}/卷${intToCn(n)}`] };
  }
  if (meta.style === "sxc") {
    const mark = ["上", "中", "下"][n - 1];
    return { book: name, juan: n, pages: [`${meta.page}/卷${mark}`] };
  }
  const padded = String(n).padStart(meta.pad, "0");
  const pages = [`${meta.page}/卷${padded}`];
  if (padded !== String(n)) pages.push(`${meta.page}/卷${n}`);
  return { book: name, juan: n, pages };
};

// 从「卷294」「卷一」这类自然语言里认出卷次（模型常把卷次写进 query 而不传 juan）
const extractJuanFromText = (text: string): number | null => {
  const match = String(text ?? "").match(/卷\s*([0-9零〇一二三四五六七八九十百千]{1,6})/);
  if (!match) return null;
  return cnToNumber(match[1].replace(/[^0-9零〇一二三四五六七八九十百千]/g, ""));
};

// 站点外链（node:https）：Node 26 的全局 fetch 对本机连不上该站，这里统一超时与 UA
const httpsGetText = (urlString: string, redirects = 0): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "User-Agent": ONLINE_UA, "Accept-Encoding": "identity", "Accept-Language": "zh-CN,zh;q=0.9" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects < 3) {
          res.resume();
          resolve(httpsGetText(new URL(res.headers.location, url).toString(), redirects + 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve(body));
      },
    );
    req.setTimeout(ONLINE_TIMEOUT_MS, () => req.destroy(new Error("在线抓取超时")));
    req.on("error", reject);
    req.end();
  });

// 串行限速：同一进程内两次外网请求至少隔 1.2 秒，避免给维基文库添压
let lastOnlineAt = 0;
const onlinePause = async () => {
  const wait = Math.max(0, lastOnlineAt + ONLINE_GAP_MS - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastOnlineAt = Date.now();
};

const queryWikiApi = async (params: Record<string, string>, attempt = 0): Promise<any> => {
  await onlinePause();
  try {
    const url = new URL(ONLINE_API);
    url.search = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params }).toString();
    const data = JSON.parse(await httpsGetText(url.toString()));
    if (data?.error) throw new Error(`${data.error.code}: ${data.error.info ?? ""}`);
    return data;
  } catch (error) {
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return queryWikiApi(params, attempt + 1);
    }
    throw error;
  }
};

// 去掉站点导航与页脚，保留正文（与离线脚本同一套清洗口径）
const cleanWikiText = (raw: string): string =>
  raw
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      return !/^(姊妹计划|參閱維基|閲文言維基|维基百科|维基文库|目録|目次)/.test(t)
        && !/^卷[零〇一二三四五六七八九十百千]+/.test(t)
        && !/^[◄►]+$/.test(t);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// 四库扫描本只有 wiki 源文（正文包在 <onlyinclude><poem> 里，年份/注文是 SK 模板）：
// 取正文块、由内向外剥模板、还原文内链接与实体，与离线脚本同一口径。
const cleanWikitext = (raw: string): string => {
  let text = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<noinclude>[\s\S]*?<\/noinclude>/g, "")
    .replace(/<onlyinclude>([\s\S]*?)<\/onlyinclude>/g, "$1")
    .replace(/<pages[^>]*\/>/g, "")
    .replace(/<\/?poem>/g, "")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  for (let i = 0; i < 8; i += 1) {
    const before = text;
    text = text
      .replace(/\{\{YL\|([^{}|]+)\}\}/g, "$1")
      .replace(/\{\{SK anchor\|([^{}|]+)\}\}/g, "$1")
      .replace(/\{\{SKchar\|[^{}|]+\}\}/g, "")
      .replace(/\{\{SK notes\|([^{}]*)\}\}/g, "（$1）")
      .replace(/\{\{[^{}]*\}\}/g, "");
    if (text === before) break;
  }
  text = text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[-]/g, "")
    // 扫描本卷末残留的 <史部,載記類,書名> 类目标记（实体解码后才现形，放这一道）
    .replace(/<[^>\n]{1,60}>/g, "")
    .replace(/［\[?[^\]]*校勘[^\]]*\]?］/g, "")
    .replace(/　/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // 去掉卷首的「欽定四庫全書」「書名卷N」「某人撰」这类版式行
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const head: string[] = [];
  for (const line of lines) {
    if (head.length >= 5) break;
    const isBookLine = /^欽定四庫全書/.test(line)
      || /^(南唐書|十國春秋)\s*卷/.test(line)
      || /^[\d０-９]+$/.test(line)
      || (line.length <= 30 && /^(宋|元|明|清)?\s*[^\s]{0,12}\s*撰/.test(line));
    if (isBookLine) {
      head.push(line);
      continue;
    }
    break;
  }
  return lines.filter((line) => !head.includes(line)).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

type OnlinePage = {
  book: string; juan: number; title: string; url: string;
  text: string; chars: number; fetchedAt: number;
};

const pageCachePath = (book: string, juan: number) => join(PAGE_DIR, `${book}-${juan}.json`);

const readPageCache = (book: string, juan: number): OnlinePage | null => {
  try {
    const file = pageCachePath(book, juan);
    if (!existsSync(file)) return null;
    const row = JSON.parse(readFileSync(file, "utf8")) as OnlinePage;
    return row?.text ? row : null;
  } catch {
    return null;
  }
};

const writePageCache = (row: OnlinePage) => {
  try {
    mkdirSync(PAGE_DIR, { recursive: true });
    writeFileSync(pageCachePath(row.book, row.juan), JSON.stringify(row));
  } catch {
    // 缓存写失败不影响本次回答
  }
};

// 取一卷正文；先试带零的标题，再试不带的，最后退回 redirects
// 四库扫描本（南唐书、十国春秋）没有纯文本，走 revisions 取源文再剥模板
const fetchRemotePage = async (book: string, juan: number, titles: string[]): Promise<OnlinePage | null> => {
  const mode = ONLINE_BOOKS[book]?.mode ?? "extract";
  for (const title of titles) {
    try {
      if (mode === "wikitext") {
        const data = await queryWikiApi({
          action: "query", prop: "revisions", rvprop: "content", rvslots: "main",
          redirects: "1", titles: title,
        });
        const page = data?.query?.pages?.[0];
        const raw = page?.revisions?.[0]?.slots?.main?.content ?? "";
        if (!page || page.missing || !raw) continue;
        const text = cleanWikitext(raw);
        if (text.length < 40) continue;
        return {
          book, juan, title: page.title, url: `https://zh.wikisource.org/wiki/${encodeURIComponent(page.title)}`,
          text, chars: text.length, fetchedAt: Date.now(),
        };
      }
      const data = await queryWikiApi({
        action: "query", prop: "extracts", explaintext: "1", exsectionformat: "plain",
        exlimit: "1", redirects: "1", titles: title,
      });
      const page = data?.query?.pages?.[0];
      if (!page || page.missing || !page.extract) continue;
      return {
        book, juan, title: page.title, url: `https://zh.wikisource.org/wiki/${encodeURIComponent(page.title)}`,
        text: cleanWikiText(page.extract), chars: cleanWikiText(page.extract).length,
        fetchedAt: Date.now(),
      };
    } catch {
      // 单次失败继续试下一个标题；全失败由调用方回退
    }
  }
  return null;
};

// 不知道卷次时，用维基文库站内搜索定位到某一卷（只认白名单里的卷页）
const locateVolume = async (query: string, book?: string): Promise<{ book: string; juan: number; pages: string[] } | null> => {
  const data = await queryWikiApi({
    action: "query", list: "search", srsearch: book ? `${query} ${book}` : query,
    srlimit: "10", srnamespace: "0",
  });
  const hits: any[] = data?.query?.search ?? [];
  const prefixes: Record<string, string> = {
    新五代史: "新五代史", 舊五代史: "旧五代史", 宋史: "宋史",
    資治通鑑: "资治通鉴", 资治通鉴: "资治通鉴",
    五代會要: "五代会要", 吳越備史: "吴越备史", 江南野史: "江南野史",
    江表志: "江表志",
    "南唐書 (陸游, 四庫全書本)": "陆游南唐书",
    "南唐書 (馬令, 四庫全書本)": "马令南唐书",
    "十國春秋 (四庫全書本)": "十国春秋",
  };
  const SXD: Record<string, number> = { 上: 1, 中: 2, 下: 3 };
  for (const hit of hits) {
    const title = String(hit.title ?? "");
    // 江表志是卷上/卷中/卷下
    const sxc = title.match(/^(江表志)\/卷([上中下])$/);
    if (sxc) {
      const canonical = prefixes[sxc[1]];
      if (book && canonical !== book) continue;
      const target = normalizeHistoryPage(canonical, SXD[sxc[2]]);
      if (target) return target;
      continue;
    }
    const match = title.match(
      /^(新五代史|舊五代史|宋史|資治通鑑|资治通鉴|五代會要|吳越備史|江南野史|南唐書 \([^\n]{2,12}四庫全書本\)|十國春秋 \(四庫全書本\))\/卷([0-9零〇一二三四五六七八九十百千]{1,3})$/
    );
    if (!match) continue;
    const canonical = prefixes[match[1]];
    if (!canonical || (book && canonical !== book)) continue;
    const target = normalizeHistoryPage(canonical, match[2]);
    if (target) return target;
  }
  return null;
};

// 靠站内搜索定位到的卷，未必真的谈到所问的事：正文里连一个检索词都没有，就当作没查到，
// 免得把「卷097 顺带提一句」当成整件事的记载（读者点名卷次时不做这层校验）
const textHasQuery = (text: string, query: string): boolean => {
  const terms = buildHistoryTerms(query).filter((t) => t.length >= 2);
  if (!terms.length) return true;
  return terms.some((t) => text.includes(t));
};

const buildOnlineResult = (
  book: string, juan: number, title: string, url: string, text: string,
  query: string, source: "cache" | "live",
) => ({
  book, juan: `卷${juan}`, title, url, chars: text.length, source,
  tier: ONLINE_BOOKS[book]?.tier ?? "A",
  text: historySnippet({ id: `${book}${juan}`, book, juan: `卷${juan}`, title: "", url, text } as HistoryChunk, query, 1200),
});

// 在线抓取入口：query 用于定位/摘段，juan 可省；返回一段不超过 1200 字的正文
const fetchHistoryOnline = async (
  query: string,
  book?: string,
  juan?: unknown,
): Promise<{ book: string; juan: string; title: string; url: string; chars: number; text: string; source: string; tier?: HistoryTier } | null> => {
  if (!query && juan === undefined) return null;
  const explicit = normalizeHistoryPage(book || "", juan);
  if (!explicit && book && juan !== undefined) return null;

  let target = explicit;
  let located = false;
  if (!target) {
    // 全书一页的笔记（南唐近事、江南别录、钓矶立谈）无需搜索定位，直接取该页
    const single = book && ONLINE_BOOKS[book]?.style === "single"
      ? normalizeHistoryPage(book, 1)
      : null;
    if (single) {
      target = single;
    } else {
      if (!query) return null;
      target = await locateVolume(query, book);
      if (!target) return null;
      located = true;
    }
  }

  // 库C 野史只应在读者主动问野史时抓取，免得正史问题被传闻带偏
  if ((ONLINE_BOOKS[target.book]?.tier ?? "A") === "C" && !isHearsayAsk(query)) return null;

  let row = readPageCache(target.book, target.juan);
  let source: "cache" | "live" = "cache";
  if (!row?.text) {
    row = await fetchRemotePage(target.book, target.juan, target.pages);
    if (!row?.text) return null;
    writePageCache(row);
    source = "live";
  }
  // 定位来的卷若与所问无关，宁可返回空，让 Agent 直说没查着
  if (located && !textHasQuery(row.text, query)) return null;
  // 抓到的整卷先切块进 RAG（embedding-3），再从这批新块里做语义检索；
  // 检索不成（向量通道不可用）才退回关键词截段
  await ingestHistoryPage(row);
  const ragHits = await searchHistory(query, `${row.book}卷${row.juan}`, 3);
  const result = buildOnlineResult(row.book, row.juan, row.title, row.url, row.text, query, source);
  if (ragHits.length) {
    result.text = ragHits.map((c) => c.text).join("\n…\n").slice(0, 1200);
    result.chars = result.text.length;
  }
  return result;
};

// 查时间轴一段：先按段落键（如 978b），再退到按年份（975 → 975）
const fetchTimelineEvent = async (key: string) => {
  const cleaned = key.replace(/[^0-9a-z]/gi, "").toLowerCase();
  if (!cleaned) return null;
  const events = loadData().timeline_events ?? [];
  const exact = events.find((e: any) => e.key === cleaned);
  if (exact) return exact;
  // 模型只给了年份：取该年第一段（978 取「七夕绝唱」而非「北邙归处」）
  if (/^\d+$/.test(cleaned)) {
    const sameYear = events
      .filter((e: any) => String(e.year) === cleaned)
      .sort((a: any, b: any) => String(a.key).localeCompare(String(b.key)));
    return sameYear[0] ?? null;
  }
  return null;
};

// 查地图一站：slug 与地图 data-go 一致（jinling / zhongshan / hongzhou / caishi / jiangzhou / bianjing / beimang）
const fetchLocation = async (slug: string) => {
  const cleaned = slug.replace(/[^a-z]/gi, "").toLowerCase();
  if (!cleaned) return null;
  return (loadData().locations ?? []).find((l: any) => l.slug === cleaned) ?? null;
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
  {
    type: "function",
    function: {
      name: "search_history",
      description: "查本地史书语料（按可信度分库）：库A《旧五代史》《新五代史》《资治通鉴》《宋史》《五代会要》；库B 陆游《南唐书》、马令《南唐书》《吴越备史》《江表志》《江南别录》；库C 野史笔记《南唐近事》《江南野史》《钓矶立谈》（仅在读者主动问野史时返回，回答须标「传闻异说」）；库D《十国春秋》（清人汇编，仅备交叉比对，不优先采信）。答案要写明出处，如「《新五代史·卷62·南唐世家》」。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索词：人名、地名、国名、年号或事件，如「柴荣」「采石浮桥」「显德二年」" },
          book: { type: "string", description: "可选，限定书名，如「新五代史」「旧五代史」「宋史」「南唐书」「吴越备史」「十国春秋」；拿不准就不要传" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_history_online",
      description: "从维基文库抓取卷页原文，抓到即切块进 RAG 再检索转述。白名单：《新五代史》1–74、《旧五代史》1–150、《宋史》1–496、《资治通鉴》1–294、《五代会要》1–30、陆游《南唐书》1–18、马令《南唐书》1–30、《吴越备史》1–4、《江表志》卷上中下、《江南别录》《南唐近事》《江南野史》1–10、《钓矶立谈》、《十国春秋》1–114。命中本地缓存则秒回。凡问 978 年以前五代十国或宋初的史事，优先调它，抓到后用自己的口吻转述；失败再退回 search_history。野史笔记（南唐近事、江南野史、钓矶立谈）只在读者主动问野史时才抓，引用须标「传闻异说」。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "人名、事件或关键词，用于在卷内摘取相关段落" },
          book: { type: "string", enum: ["新五代史", "旧五代史", "宋史", "资治通鉴", "五代会要", "南唐书", "陆游南唐书", "马令南唐书", "吴越备史", "江表志", "江南别录", "南唐近事", "江南野史", "钓矶立谈", "十国春秋"], description: "可选，限定书名；拿不准就不要传" },
          juan: { type: "string", description: "可选，卷次，如 62 或 卷62；不传则用 query 在维基文库站内搜索定位" },
        },
        required: ["query"],
      },
    },
  },
];

// ---------- 模型调用 ----------
type ModelResult = { text: string; model: string; usage: any; toolCalls: any[] };
type ModelOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: unknown[];   // 传了就按 function calling 模式请求
  timeoutMs?: number;  // 单次尝试的超时（Agent 多轮调用时收短一些）
};

// 调智谱 OpenAI 兼容接口：一个 key 管问答、向量、朗读、绘图，不再有第二家兜底
// 没配 key 直接给出明确错误，前端能看到「服务未配置」而不是莫名的超时
const callModel = async (
  messages: any[],
  options: ModelOptions = {},
): Promise<ModelResult> => {
  if (!EXTERNAL_KEY) throw new Error("梦客未配置密钥：请在 .env.local 里设置 ZHIPU_API_KEY");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 50_000);
  const payload: Record<string, unknown> = {
    model: options.model || DEFAULT_MODEL,
    messages,
    max_tokens: options.maxTokens ?? 420,
    temperature: options.temperature ?? 0.75,
  };
  if (options.tools?.length) {
    // function calling：让模型自己决定是否调工具
    payload.tools = options.tools;
    payload.tool_choice = "auto";
  }
  try {
    const res = await fetch(`${EXTERNAL_BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${EXTERNAL_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`模型服务返回 ${res.status}`);
    const data = await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    const text = typeof msg.content === "string" ? msg.content.trim() : "";
    // 工具调用请求原样透传给上层循环
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    return { text, model: payload.model as string, usage: data?.usage ?? null, toolCalls };
  } finally {
    clearTimeout(timer);
  }
};

// ---------- 工具执行 ----------
// 每个工具返回 { data, card }：data 回灌给模型；card 收集进响应的 cards 字段交给前端渲染
// sourcesSeen 用于把工具捞到的词作透传回前端「可继续读的词作」区
const execTool = async (
  name: string,
  args: Record<string, unknown>,
  sourcesSeen: Map<string, any>,
  historySeen: Map<string, any> = new Map(),
  userText = "",
  // 本轮工具给出的原文：回答后用来核对引文，防止模型编造书信、对话、诏令
  toolTexts: string[] = [],
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
      // 带路前顺手把那一年的记载附回去：模型常凭印象写错地点（如把 978 写成北邙）
      // fact 落在同一轮的下一段思考里，它就能按时间轴上的事说，不必再单独查一次
      const fact = card.anchor ? await fetchTimelineEvent(String(card.anchor).replace(/^y/, "")) : null;
      return {
        data: {
          ok: true,
          fact,
          hint: fact
            ? "回答请以 fact 里的年份与地点为准，不要改写。"
            : "带路卡已交给读者，回答里顺势提一句即可。",
        },
        card,
      };
    }
    // 查阅正史：只回 3 段原文，免得把上下文撑爆；结果里保留书名、卷次与出处链接
    if (name === "search_history") {
      const query = normalize(args.query, 200);
      const book = normalize(args.book, 20).replace(/\s/g, "");
      if (!query) return { data: { error: "请给出要查的人名、地名或事件。" }, card: null };
      const rows = await searchHistory(query, book || undefined, 3);
      rows.forEach((row) => {
        historySeen.set(`${row.book}${row.juan}`, {
          book: row.book, juan: row.juan, title: row.title ?? "", url: row.url,
          tier: chunkTier(row), tierLabel: tierName(chunkTier(row)),
        });
        toolTexts.push(row.text);
      });
      // 标出「正文里确实有检索词」的段落：语义检索有时会捞到不相干的卷
      const matched = rows.filter((row) => textHasQuery(row.text, query));
      return {
        data: {
          query,
          results: rows.map((row) => ({
            book: row.book,
            juan: row.juan,
            title: row.title ?? "",
            tier: chunkTier(row),
            tierLabel: tierName(chunkTier(row)),
            kind: row.kind ?? "正史",
            author: row.author ?? "",
            url: row.url,
            text: row.text,
            matched: textHasQuery(row.text, query),
          })),
          hint: !rows.length
            ? "本地史书里没有直接对应的段落：改用 fetch_history_online 抓取，或只按已确认的史实作答，不要把别的段落硬套到所问的事上。"
            : !matched.length
              ? "这些段落与所问的事对不上（正文里没有检索词）：不要引用它们回答问题，改用 fetch_history_online 抓取；抓不到就直说史书没查着。"
              : `这些是文言原文，按库别标了 tiers：库A 正史为准；库B 可采信，但与库A 冲突时以库A 为准；库C 是传闻异说，除非读者主动问野史，否则不要拿来下结论，引用时必须写明「传闻异说，不作定论」；库D 是清人汇编，只作交叉比对，不优先采信。回答时点明出处（如「《新五代史·卷62》」）；只摘一两句最相关的，用你第一人称的口吻转述成白话，不要整段照抄、不要写成百科总结；原文没有明说的亲属、君臣、即位关系不要推断，读不通就说读得吃力；只取 978 年以前的段落，979 年以后的内容一律不要引用。`,
        },
        card: null,
      };
    }
    // 按需抓取：本地语料没有的卷页才走外网；抓到的正文落盘，下次直接命中缓存
    if (name === "fetch_history_online") {
      const query = normalize(args.query, 60);
      // 模型偶尔漏传 book：从读者原话里认一下书名，避免「卷一」等卷次落空
      const askedBook = /新五代史/.test(userText)
        ? "新五代史"
        : /旧五代史|舊五代史/.test(userText)
          ? "旧五代史"
          : /资治通鉴|資治通鑑|通鑑|通鉴/.test(userText)
            ? "资治通鉴"
            : /五代会要|五代會要/.test(userText)
              ? "五代会要"
              : /吴越备史|吳越備史/.test(userText)
                ? "吴越备史"
                : /江南野史/.test(userText)
                  ? "江南野史"
                  : /宋史/.test(userText) ? "宋史" : "";
      const rawBook = normalize(args.book, 12) || askedBook;
      const book = BOOK_ALIASES[rawBook] ?? rawBook;
      // 卷次可能写在 juan、query（「卷294 后周世宗北伐」），也可能只在读者原话里；
      // 三处都认，避免模型漏传 juan 时整次抓取落空
      const juanArg = String(args.juan ?? "").trim()
        ? args.juan
        : extractJuanFromText(query) ?? extractJuanFromText(userText);
      const searchQuery = query.replace(/卷\s*[0-9零〇一二三四五六七八九十百千]+/g, "").trim() || query;
      if (!searchQuery && juanArg === null) {
        return { data: { error: "请给出要查的人名、事件或卷次。" }, card: null };
      }
      const row = await fetchHistoryOnline(searchQuery, book || undefined, juanArg);
      if (!row) {
        return {
          data: {
            error: "维基文库没有找到对应的卷页，或这次没能连上。",
            hint: "改用 search_history 查本地七十四卷语料，或告诉读者这一节正史没有查到。工具没查到时，不许说「我翻到某卷」，也不许引用或编造原文。",
          },
          card: null,
        };
      }
      historySeen.set(`${row.book}${row.juan}`, {
        book: row.book, juan: row.juan, title: row.title, url: row.url,
        tier: row.tier ?? "A", tierLabel: tierName(row.tier ?? "A"),
      });
      toolTexts.push(row.text);
      return {
        data: {
          ...row,
          hint: "这是文言原文的节选。回答时点明出处（如「《宋史·卷XXX》」）；只摘一两句，用你第一人称的口吻转述成白话，不要整段照抄、不要写成百科总结，也不要输出网址或「书名/卷X」页面标题；原文没写明的关系不要推断。只取 978 年以前的段落，979 年以后的内容一律不要引用。",
        },
        card: null,
      };
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
// 查词 → 查年份 → 查正史 → 带路，四处资料往往要分开查，默认给 4 轮；可用环境变量收紧到 2—5
const AGENT_ROUNDS = (() => {
  const raw = Number(readEnv("AGENT_ROUNDS"));
  return Number.isFinite(raw) && raw >= 2 && raw <= 5 ? Math.floor(raw) : 4;
})();

// 一次工具调用记成一步：前端据此显示「侍读查过什么」，读者能看见 Agent 的过程
type AgentStep = { round: number; tool: string; args: string; hits: number; ok: boolean; ms: number };

// 只取最能代表这次查询的参数文字，不把整段 JSON 抛给前端
const stepArgLabel = (name: string, args: Record<string, unknown>): string => {
  if (name === "search_history" || name === "fetch_history_online") {
    const juan = String(args.juan ?? "").replace(/[^0-9零〇一二三四五六七八九十百千]/g, "");
    return String(args.query ?? "") + (juan ? `·卷${juan}` : "");
  }
  if (name === "search_poems") return String(args.keyword ?? "");
  if (name === "get_poem_detail") return String(args.slug ?? "");
  if (name === "get_timeline_event") return String(args.key ?? "");
  if (name === "get_location") return String(args.slug ?? "");
  if (name === "navigate_to") return String(args.label ?? args.page ?? "");
  return "";
};

// 命中数：列表给条数，单条资料给 1，报错给 0
const stepHitCount = (data: any): number => {
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.results)) return data.results.length;
  if (data?.error) return 0;
  return 1;
};

const runAgent = async (
  baseMessages: any[],
  options: ModelOptions,
): Promise<{
  text: string; cards: any[]; toolsUsed: string[]; sources: any[];
  steps: AgentStep[]; history: any[]; toolTexts: string[]; model: string; usage: any;
}> => {
  const cards: any[] = [];
  const cardKeys = new Set<string>(); // 去重：同一目标只出一张卡
  const toolsUsed: string[] = [];
  const toolTexts: string[] = []; // 工具返回的原文，供回答后核对引文
  const steps: AgentStep[] = [];
  const historySeen = new Map<string, any>();
  const sourcesSeen = new Map<string, any>();
  // 读者原话：部分工具（如在线抓取）在模型漏传参数时，从这里补认书名
  const userText = String([...baseMessages].reverse().find((m) => m?.role === "user")?.content ?? "");
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
  const toolTextRe = /^\s*(search_poems|get_poem_detail|get_timeline_event|get_location|navigate_to|search_history|fetch_history_online)\b[\s\S]*$/;

  for (let round = 0; round <= AGENT_ROUNDS; round++) {
    const allowTools = round < AGENT_ROUNDS; // 最后一轮只许说话，不许再调工具
    if (!allowTools) {
      // 收尾前钉一句：资料已齐、直接作答，防小模型继续假装调工具
      messages.push({
        role: "system",
        content: "工具资料已经齐了。请直接用李煜本人的第一人称写出给读者的回答（80—160 字），不要再调用任何工具，不要输出 JSON 或工具名。",
      });
    }
    const result = await callModel(messages, {
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
        const startedAt = Date.now();
        const out = await execTool(name, args, sourcesSeen, historySeen, userText, toolTexts);
        toolsUsed.push(name);
        pushCard(out.card);
        steps.push({
          round: round + 1,
          tool: name,
          args: normalize(stepArgLabel(name, args), 40),
          hits: stepHitCount(out.data),
          ok: !(out.data as any)?.error,
          ms: Date.now() - startedAt,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          // 工具结果截断，守住上下文长度；正史三条原文比词库结果长，放宽到 2400 字
          content: JSON.stringify(out.data).slice(0, 2400),
        });
      }
      continue;
    }

    // 走到这里：模型给了正文（或本就是收尾轮）
    let text = result.text;
    if (toolTextRe.test(text)) {
      // 脏文本兜底：把这段「假工具调用」留在上下文里，再明确要求纯文字回答一次
      const retry = await callModel([
        ...messages,
        { role: "assistant", content: text },
        { role: "user", content: "请不要调用工具，像平常说话那样，直接把回答写出来。" },
      ], { ...options, tools: undefined, timeoutMs: 30_000 });
      model = retry.model;
      usage = retry.usage;
      text = toolTextRe.test(retry.text) ? "" : retry.text;
    }
    return {
      text, cards, toolsUsed, sources: [...sourcesSeen.values()],
      steps, history: [...historySeen.values()], toolTexts, model, usage,
    };
  }
  // 循环出口兜底（正常走不到）：返回已收集的卡片与空文本
  return {
    text: "", cards, toolsUsed, sources: [...sourcesSeen.values()],
    steps, history: [...historySeen.values()], toolTexts, model, usage,
  };
};

// 问答日志：追加写入 logs/guide.jsonl，一行一次问答，方便回看与统计
// 写盘失败只告警，不影响这次回答
const writeLog = async (row: Record<string, unknown>) => {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(join(LOG_DIR, "guide.jsonl"), `${JSON.stringify({ ...row, at: new Date().toISOString() })}\n`, {
      flag: "a",
    });
  } catch (error) {
    console.warn("写入问答日志失败", error);
  }
};

// 缓存指纹：djb2 变体，只求稳定（同一输入必得同一键），不用于安全用途
const fingerprint = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `q${(h >>> 0).toString(36)}-${text.length}`;
};

// 问答缓存：进程内 Map（24 小时内有效）。单进程服务下内存缓存就是最合适的实现
const answerCache = new Map<string, { at: number; payload: any }>();
const CACHE_TTL = 24 * 3600 * 1000;

const readAnswerCache = async (key: string): Promise<any | null> => {
  const hit = answerCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    answerCache.delete(key);
    return null;
  }
  return hit.payload;
};

const writeAnswerCache = async (key: string, _action: string, payload: unknown) => {
  // 简单上限保护：超过 200 条就清掉最旧的一半，避免长时间运行后内存膨胀
  if (answerCache.size > 200) {
    const keys = [...answerCache.keys()].slice(0, 100);
    keys.forEach((k) => answerCache.delete(k));
  }
  answerCache.set(key, { at: Date.now(), payload });
};

// 限流：单进程服务下用进程内计数就够了（每分钟 20 次/IP）
// 之前担心的「多实例失效」问题在本地/单机部署里不存在，实现反而更简单可靠
const rateHits = new Map<string, { count: number; resetAt: number }>();
const allowRequest = async (ip: string): Promise<boolean> => {
  const now = Date.now();
  const item = rateHits.get(ip);
  if (!item || item.resetAt < now) {
    rateHits.set(ip, { count: 1, resetAt: now + 60_000 });
    // 顺手清掉过期窗口，避免长期运行后条目堆积
    if (rateHits.size > 500) {
      for (const [key, value] of rateHits) if (value.resetAt < now) rateHits.delete(key);
    }
    return true;
  }
  item.count += 1;
  return item.count <= 20;
};

// ---------- 本地朗读（Windows 自带中文语音，免费、离线） ----------
// 智谱 GLM-TTS 要单独充值资源包，余额不足会 429；这里用系统语音兜底，
// 句长 400 字以内一次合成约 1 秒，同一句合成过一次就存本地缓存，再来秒回。
// 说明：依赖 PowerShell + System.Speech，Linux 部署时自然不可用，会退回 GLM-TTS / 浏览器语音。
const SAPI_SCRIPT = join(tmpdir(), "liyu-sapi.ps1");
const SAPI_SOURCE = `param([string]$TextPath, [string]$OutPath)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -2
$synth.SetOutputToWaveFile($OutPath)
$synth.Speak($text)
$synth.Dispose()
`;

// 合成一句，成功返回 wav 文件路径；失败（没装 PowerShell / 没有中文语音）返回 null
const localSpeech = (text: string, key: string): string | null => {
  try {
    if (!existsSync(SAPI_SCRIPT)) writeFileSync(SAPI_SCRIPT, SAPI_SOURCE, "utf8");
    mkdirSync(TTS_DIR, { recursive: true });
    const wav = join(TTS_DIR, `${key}.wav`);
    if (existsSync(wav)) return wav; // 同一句复用旧音频，不重复合成
    // 文本先落 UTF-8 文件再交给 PowerShell：避免命令行传中文被编码搞坏
    const txt = join(tmpdir(), `liyu-tts-${key}.txt`);
    writeFileSync(txt, text, "utf8");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SAPI_SCRIPT, "-TextPath", txt, "-OutPath", wav],
      { timeout: 20_000, encoding: "utf8" },
    );
    try { unlinkSync(txt); } catch { /* 临时文本删不掉也不影响结果 */ }
    if (result.status !== 0 || !existsSync(wav)) {
      console.warn("本地语音合成失败", result.status, String(result.stderr ?? "").slice(0, 200));
      return null;
    }
    return wav;
  } catch (error) {
    console.warn("本地语音不可用", error);
    return null;
  }
};

// 主入口（守卫同上：Node 导入本文件做单元测试时不启动服务）
if (typeof Deno !== "undefined") {
  Deno.serve(async (req: Request) => {
  // CORS 预检
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await allowRequest(ip))) return jsonResponse({ error: "请求太频繁，稍等片刻再来。" }, 429);

  // 本次请求的计时起点：每笔日志都带上耗时与状态，便于查「哪一问慢」「失败率多少」
  const requestStart = Date.now();
  // 处理函数内的日志入口：自动补齐 latency_ms 与 status（ok / blocked / error）
  const logGuide = (row: Record<string, unknown>, status = "ok") =>
    writeLog({ ...row, latency_ms: Date.now() - requestStart, status });

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
    // speak 的用户文本放在 body.text，也要一并过闸
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
      }, "blocked");
      return jsonResponse({
        action,
        answer: GUARD_REPLY,
        sources: [],
        cards: [],
        model: "guard",
        blocked: true,
      });
    }

    // 时间闸（问句）：读者直接问到 978 年以后的人和事，就明说自己不知道，
    // 不必检索、不必调模型，也不会出现「拿 975 年旧事答北宋灭亡」这种错位
    if (action === "ask" && message) {
      const futureAsk = checkFutureQuestion(message);
      if (futureAsk) {
        logGuide({
          session_id: sessionId,
          mode: action,
          page,
          question: message.slice(0, 200),
          answer: TIME_CUTOFF_REPLY,
          model: "time-gate",
          tokens: 0,
          tools: null,
        });
        return jsonResponse({
          action,
          answer: TIME_CUTOFF_REPLY,
          sources: [],
          cards: [],
          tools: [],
          steps: [],
          history: [],
          model: "time-gate",
        });
      }
    }

    // 检索：不需要模型，直接返回词库结果
    if (action === "search") {
      if (!message) return jsonResponse({ error: "请给出要检索的关键词。" }, 400);
      const rows = await searchPoems(message);
      // 向量通道捞到的行带 2048 维 embedding，回前端前剥掉，免得响应体膨胀
      const clean = stripEmbedding(rows);
      return jsonResponse({
        action,
        answer: rows.length
          ? `在词库里找到 ${rows.length} 首相关的词。`
          : "词库里暂时没有直接对应的词作，换个意象试试，比如「春水」「西楼」「梧桐」。",
        sources: clean,
      });
    }

    // 多模态朗读：默认用本机 Windows 中文语音（免费离线），设 TTS_PROVIDER=glm 才优先用智谱
    // 两条通道都失败才回 502，前端会自动降级到浏览器 speechSynthesis
    if (action === "speak") {
      const text = normalize(body.text ?? message, 400);
      if (!text) return jsonResponse({ error: "请给出要朗读的文本。" }, 400);
      const ttsKey = fingerprint(`speak|${text}`);
      const preferGlm = readEnv("TTS_PROVIDER").toLowerCase() === "glm";

      // 智谱 GLM-TTS：音色更自然，但需要单独充值资源包
      const tryGlm = async (): Promise<{ data: Buffer; type: string; model: string } | null> => {
        if (!EXTERNAL_KEY) return null;
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
            console.warn("GLM-TTS 失败", ttsRes.status, upstreamBody.slice(0, 200));
            return null;
          }
          const audio = Buffer.from(await ttsRes.arrayBuffer());
          if (!audio.length) return null;
          return { data: audio, type: "audio/wav", model: "glm-tts" };
        } catch (error) {
          console.warn("GLM-TTS 调用异常", error);
          return null;
        }
      };

      const tryLocal = (): { data: Buffer; type: string; model: string } | null => {
        const wav = localSpeech(text, ttsKey);
        if (!wav) return null;
        try {
          return { data: readFileSync(wav), type: "audio/wav", model: "local-sapi" };
        } catch (error) {
          console.warn("读取本地语音失败", error);
          return null;
        }
      };

      const audio = preferGlm ? (await tryGlm()) ?? tryLocal() : tryLocal() ?? (await tryGlm());
      if (!audio) return jsonResponse({ error: "朗读服务暂时不可用" }, 502);
      logGuide({
        session_id: sessionId,
        mode: "speak",
        page,
        question: text.slice(0, 200),
        answer: "[tts]",
        model: audio.model,
        tokens: null,
        tools: null,
      });
      return new Response(audio.data, {
        headers: { ...corsHeaders, "Content-Type": audio.type, "Cache-Control": "no-store" },
      });
    }

    // 问答缓存：同一问题（同页、同词、无对话上下文）24 小时内直接复用上次答案
    // 高频问题（「为什么用春水写愁」这类）不必每次都等模型几秒、也不必重复烧额度
    const cacheKey = fingerprint(`${action}|${message}|${poemSlug}|${page}`);
    const canUseCache = action === "ask" && !history.length && !!message && body.force !== true;
    if (canUseCache) {
      const cached = await readAnswerCache(cacheKey);
      if (cached?.answer) {
        logGuide({
          session_id: sessionId,
          mode: action,
          page,
          question: message.slice(0, 200),
          answer: cached.answer,
          model: "cache",
          tokens: 0,
          tools: cached.tools?.length ? cached.tools : null,
        });
        return jsonResponse({ ...cached, action, cached: true });
      }
    }

    // 定位当前情境：页面里的词作作为一手资料
    const poem = poemSlug ? await fetchPoem(poemSlug) : null;

    // 先取史实库条目：L1 直答与后面的注入都用它
    const factEntries = matchFactEntries(message);

    // L1 · 命中即直答：单一条目 + 纯事实问法 → 用库里写好的答复，完全不调模型
    // 只在没有对话上下文时启用：带上下文时问法可能指代前文，固定答复会答偏
    if (action === "ask" && !history.length) {
      const direct = directFactReply(message, factEntries);
      // 固定答复不再直出：史实问题必须先爬、进 RAG、再由模型转述。
      // 只有没命中任何史实卡的闲聊式问句才可能走到这里（此时 direct 本就是 null）
      if (direct && !checkFutureKnowledge(direct) && !factEntries.length) {
        logGuide({
          session_id: sessionId,
          mode: action,
          page,
          question: message.slice(0, 200),
          answer: direct,
          model: "fact-library",
          tokens: 0,
          tools: null,
        });
        return jsonResponse({
          action,
          answer: direct,
          sources: [],
          cards: [],
          tools: [],
          model: "fact-library",
          usage: null,
        });
      }
    }

    // 拼装系统提示：站点底盘 + 数字人设定 +（问答追加工具守则）+ 本轮资料 + 所在页面
    const systemParts = [SITE_CONTEXT, PERSONA];
    if (action === "ask") {
      systemParts.push(AGENT_GUIDE, FAMILY_TREE);
      // 情绪层：按话题注入「此刻的情绪」；话题不带情绪时，让上一轮的情绪留点余韵
      const emotion = emotionForTurn(message, history);
      if (emotion) {
        const emoText =
          emotion.kind === "direct"
            ? `${emotion.mood}：${emotion.hint}`
            : `余韵——上一轮还谈着「${emotion.mood}」的事：这一轮话题虽转，语气里可以留一点它的余温（更慢半拍、轻半分），但不要沉浸在里面，回答以本轮问题为主。`;
        systemParts.push(
          `此刻的情绪——${emoText}\n情绪只许流露在措辞与节奏里，不许直接说「我很悲伤」「我很难过」这类自我形容。`,
        );
      }
    }
    // 提问碰到易混人物时准备一份史实硬约束：放在最后一轮用户消息之前，模型才盯得住
    const figureFacts = matchFigureFacts(message);
    const factLibraryBlock = buildFactBlock(factEntries);
    const factsBlock = factLibraryBlock
      ? `${factLibraryBlock}${figureFacts.length ? `\n\n补充卡片：\n- ${figureFacts.join("\n- ")}` : ""}`
      : figureFacts.length
        ? `史实硬约束（最高优先级，与你的记忆冲突时一律以这里为准）：
- 只能用下面的史实，不得补充卡片以外的亲属关系、年份、地点；
- 拿不准的细节宁可不说，不要用「想必」「大约」补空白；
- ${figureFacts.join("\n- ")}`
        : "";
    if (page) systemParts.push(`读者此刻在「${page}」页面。`);
    if (poem) systemParts.push(`可供引用的词作资料：\n${buildSourceBlock([poem])}`);
    const system = systemParts.join("\n\n");

    let instruction = message;
    let maxTokens = 420;
    let temperature = 0.75;
    // 问句命中史实卡片/史实库时压低温度：这类问题怕的不是不好看，是关系写错
    if (figureFacts.length || factEntries.length) temperature = Math.min(temperature, 0.35);
    // 史事问题同样压低温度：宁可朴素，不许发挥
    if (needsGrounding(message)) temperature = Math.min(temperature, 0.3);

    // 史事问题先检索一次：模型不调工具也能拿到原文，避免它凭记忆编造书信、对话
    let evidenceTexts: string[] = [];
    let retrievalBlock = "";
    let disputeBlock = "";
    let preHits: any[] = [];
    let compare: { tier: string; tierLabel: string; items: { book: string; juan: string; text: string; url: string }[] }[] = [];
    let compareConflict = false;
    const dispute = action === "ask" && isDisputeAsk(message);
    if (action === "ask" && (needsGrounding(message) || factEntries.length)) {
      // 史实问题一律「先爬、再进 RAG、再让模型转述」：
      // 先按问句在线定位卷页（命中 pages 缓存则秒回），抓到的整卷即时切块入 RAG；
      // 抓不到（站内搜索未定位到本纪卷）就只用本地语料与已入 RAG 的在线卷
      // 读者用「我/朕」自称时代入李煜，否则「我的死」这种问题检索不到任何东西
      const groundQuery = /[我朕]/.test(message) && !/李煜|李从嘉|后主/.test(message)
        ? `${message} 李煜`
        : message;
      await fetchHistoryOnline(groundQuery).catch(() => null);
      const hits = await searchHistory(groundQuery, undefined, 3);
      preHits = hits;
      evidenceTexts = hits.map((h) => h.text);
      retrievalBlock = hits.length
        ? `史书检索结果（回答只能依据这些段落）：
${hits.map((h) => `-《${h.book}·${h.juan}》〔${tierName(chunkTier(h))}〕：${h.text}`).join("\n")}
作答要求：
- **不要整段照抄文言**：用自己的话转述，控制在 80—140 字；最多引一句，且不超过 20 字；
- 引用时要点明出处与库别：库A 正史为准，库B 与库A 冲突时以库A 为准；
- 段落前的〔库X·…〕是可信度标记：只有库C 才是传闻，库A、库B、库D 都不是野史，不要把「传闻异说」安到它们头上；
- 库C 的段落属于「传闻异说」，除非读者明确问野史，否则不要据此下结论；引到时必须写明「传闻异说，不作定论」；
- 库D 是清人汇编，只作交叉比对，不许拿它压过库A、库B；
- 回答里至少要点出检索段落中的一个具体人名、地名或年份，不要只作「反映了……」式概括；
- 史书没写的情节、场景、动作、对话、心理，一律不许补写（「望着明月」「心中悲凉」这类想象也不许）；也不要推断两人有过往来、私交或书信；
- 不要给人物加史书没写的品性评语（忠诚、贤明、仁厚之类），只叙事实；
- 所知来历按辈分区分：祖父李昪及更早的旧事，只可说「在词境里翻史书看到」「听他人讲述过」；父亲李璟时代与你自己在位时你亲历的事，直接亲口讲，不加「听说」；你未亲历的同年之事（前线、朝议、他人府中），也只能说「听他人讲述」「事后听说」；
- 读者问的事若不在这些段落里，就直说「史书里没有这一节」。`
        : "史书检索结果：没有找到与所问直接相关的段落。不要编造书信、对话、诏令、原话，也不要补写场景、动作或心理；可以说「这一节史书没查着」。";
      temperature = Math.min(temperature, 0.3);
      maxTokens = Math.min(maxTokens, 260); // 史事回答只留 80—140 字的空间，防整段照抄

      // 四库对照：同一问句在四库里各取一两段，并排给读者看（只作展示，不参与作答）
      // 这里用本地关键词打分（不调向量），四库都能进候选；库C 仍受 allowChunk 门控
      loadRuntimeRag();
      const pool = [...(loadHistoryIndex()?.chunks ?? []), ...runtimeChunks];
      const ranked = scoreHistoryChunks(pool, groundQuery, undefined, 24, true)
        .filter((c) => (c.score ?? 0) >= 2.5);
      // 前置检索命中的卷（含宋史等正史）也并进来，免得四库对照里缺了库A
      const comparePool = [...ranked, ...preHits];
      compare = groupCompareByTier(comparePool, 2);
      compareConflict = detectTierConflict(comparePool.slice(0, 8));
      if (dispute) {
        // 争议辨析：三段式作答——正史记载 / 笔记传闻 / 一般看法
        disputeBlock = `这是一句「争议辨析」的提问，请分三层作答，仍用你第一人称的口吻，不要写成百科小标题：
① 先说自己确切知道的：只用上面检索到的段落，点明《书名·卷X》，说正史怎么记；
② 再说另有一说：若检索到笔记、野史里的不同说法，注明「传闻异说，不作定论」；没检索到就直说「笔记里另有说法，这一层我没查到」；
③ 最后一句分判：哪一层可信、哪一层只是相传，不要替读者下定论。
总长 120—180 字，不要编造检索段落以外的情节。`;
        maxTokens = Math.max(maxTokens, 320);
      }
    }

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
      ...(factsBlock ? [{ role: "system", content: factsBlock }] : []),
      ...(retrievalBlock ? [{ role: "system", content: retrievalBlock }] : []),
      ...(disputeBlock ? [{ role: "system", content: disputeBlock }] : []),
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
    let steps: any[] = [];
    let historySources: any[] = [];
    let toolEvidence: string[] = [];

    if (action === "ask") {
      const agentResult = await runAgent(messages, { model, maxTokens, temperature });
      answer = agentResult.text;
      resultModel = agentResult.model;
      usage = agentResult.usage;
      cards = agentResult.cards;
      toolsUsed = agentResult.toolsUsed;
      toolSources = agentResult.sources; // 工具检索命中的词作，回传前端来源区
      steps = agentResult.steps;         // 工具调用轨迹：前端显示「侍读查过」
      historySources = agentResult.history; // 正史出处，回传前端可点链接
      // 前置检索命中也当出处：Agent 没调史书工具时，读者照样该看到「查的是哪几卷」
      if (!historySources.length && preHits.length) {
        historySources = preHits.map((h) => ({
          book: h.book, juan: h.juan, title: h.title ?? "", url: h.url ?? "",
          tier: h.tier, tierLabel: tierName(chunkTier(h)),
        }));
      }
      toolEvidence = agentResult.toolTexts; // 工具给出的原文，供引文核对
    } else {
      const result = await callModel(messages, { model, maxTokens, temperature });
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

    // 引文闸：史事问题里的长引文必须能在检索结果/工具原文里找到，
    // 找不到就重写；再犯就删掉引号原话——宁可少说，不许编造书信、对话、诏令
    if (action === "ask" && needsGrounding(message)) {
      const quoteSources = [
        factsBlock,
        ...evidenceTexts,
        ...toolEvidence,
        poem?.content ?? "",
        ...toolSources.map((p: any) => String(p?.content ?? "")),
      ].filter(Boolean);
      const badQuotes = unverifiedQuotes(answer, quoteSources);
      if (badQuotes.length) {
        console.warn(`引文闸拦截：${badQuotes.length} 处引文不在检索结果中，重答一次`);
        const repaired = await callModel([
          ...messages,
          { role: "assistant", content: answer },
          {
            role: "user",
            content: `你上一段里的这些引文，在检索到的史料中并不存在：${badQuotes.join("；")}。请重写 60—120 字：删去所有引号里的原话，只按检索到的段落转述；史书没有留下原话，就直说「这一处正史没有留下原话」。不要另编一句补上。`,
          },
        ], { model: resultModel, maxTokens: 240, temperature: 0.2 }).catch(() => null);
        answer = repaired?.text?.trim() || answer;
        if (unverifiedQuotes(answer, quoteSources).length) {
          answer = answer
            .replace(/「[^」]{12,}」/g, "")
            .replace(/“[^”]{12,}”/g, "")
            .replace(/[ \t]{2,}/g, " ")
            .trim();
          if (!answer) answer = "这一处，正史没有留下原话，我记不真切。";
        }
      }
    }

    // 照抄闸：史事回答若整段搬文言（与史料连续重合 ≥60 字），要求改成白话转述
    if (action === "ask" && needsGrounding(message)) {
      const sourcePool = [...evidenceTexts, ...toolEvidence].filter(Boolean);
      const run = longestVerbatimRun(answer, sourcePool);
      if (run >= 60) {
        console.warn(`照抄闸：连续照抄 ${run} 字，要求转述`);
        const rewritten = await callModel([
          ...messages,
          { role: "assistant", content: answer },
          {
            role: "user",
            content: "上面这段几乎照抄了文言原文。请改成你自己的话，用第一人称转述，80—140 字；只保留最关键的一两处人名、地名或年份，不要逐句翻译，也不要加引号。",
          },
        ], { model: resultModel, maxTokens: 240, temperature: 0.25 }).catch(() => null);
        const clean = tidySourceTitles(String(rewritten?.text ?? "").replace(/【[^】]{1,30}】/g, "").trim());
        if (clean) answer = clean;
      } else {
        answer = answer.replace(/【[^】]{1,30}】/g, "").trim();
      }
    }

    // 拟话闸：问「说了什么/写了什么/信里」时，回答若拿不出与史料重合的原句，
    // 就是在替古人拟话——宁可说没留下，不许编一封书信或一段对话
    if (action === "ask" && needsGrounding(message) && isSpeechAsk(message)) {
      const quoted = longestVerbatimRun(answer, [...evidenceTexts, ...toolEvidence].filter(Boolean));
      if (quoted < 12) {
        answer = "我查到的那几卷里没有留下这段原话，我不便编一句给你。";
      }
    }

    // 想象闸：史事回答里不许出现证据中没有的场景/心理描写
    // （「望着明月」「心中悲凉」这类是小模型惯用的填词，史书没写就不许有）
    if (action === "ask" && needsGrounding(message)) {
      const scenePool = [...evidenceTexts, ...toolEvidence].filter(Boolean).join("\n");
      const SCENE_MARKERS = ["望着", "对着", "心中", "心底", "心里", "悲凉", "凄凉", "泪水", "泪流", "叹息", "长叹", "缓缓", "轻轻", "默默", "独自", "孤影", "涟漪", "月光下", "明月", "流星", "划过"];
      const invented = SCENE_MARKERS.filter((w) => answer.includes(w) && !scenePool.includes(w));
      if (invented.length >= 1) {
        console.warn(`想象闸：${invented.join("/")} 不在检索结果中，重答一次`);
        const rewritten = await callModel([
          ...messages,
          { role: "assistant", content: answer },
          {
            role: "user",
            content: `上面这段里 ${invented.slice(0, 3).map((w) => `「${w}」`).join("")} 是史书里没写的场景或心理描写。请重答：只叙书里写了的事，60—120 字，不写任何场景、动作、心理，不加引号拟话；书里没写的就别说。`,
          },
        ], { model: resultModel, maxTokens: 240, temperature: 0.2 }).catch(() => null);
        const clean = tidySourceTitles(String(rewritten?.text ?? "").replace(/【[^】]{1,30}】/g, "").trim());
        if (clean) answer = clean;
      }
    }

    // 无据闸：问史实却一条原文、一张史实卡、一段年表都没拿到，就不许自由发挥
    if (action === "ask" && needsGrounding(message)
      && !evidenceTexts.length && !toolEvidence.length && !factsBlock
      && !toolsUsed.includes("get_timeline_event")) {
      answer = "这一节，正史里没有留下记载，我不便凭空说。";
    }

    // 事实闸：小模型有时仍把关系写反（实测把周娥皇说成李璟的皇后）。
    // 注意不能只在问句点名人物时才查——「你的母亲是谁」这种问法不含「大周后」「李璟」，
    // 模型照样会答成「我母亲是周娥皇」，所以这里无条件过闸。
    // 两道一起过：正则抓已知错句，checkKnownFacts 用条目里的年岁做正向核对。
    const knownIssue = checkKnownFacts(answer, factEntries);
    if (knownIssue) console.warn(`事实闸（年岁核对）：${knownIssue}`);
    if (hasFactViolation(answer) || knownIssue) {
      const answerFacts = matchFigureFacts(answer);
      const gateFacts = figureFacts.length ? figureFacts : answerFacts;
      // 史实库命中的条目优先当重答底稿，卡片只作补充；两者都没有才用兜底关系
      const factText = [
        factLibraryBlock,
        gateFacts.length ? gateFacts.join("\n") : FALLBACK_FACTS,
      ]
        .filter(Boolean)
        .join("\n");
      console.warn("事实闸拦截：回答与史实卡片冲突，重答一次");
      const repair = await callModel(
        [
          { role: "system", content: `${system}\n\n${factsBlock}` },
          {
            role: "user",
            content: `你上一段回答有史实错误。请只按下面这份史实重写，60—120 字，第一人称：
- 不得添加这份史实以外的亲属关系、年份、地点；
- 不要解释错在哪里；
- 史实如下：\n${factText}`,
          },
        ],
        { model, maxTokens: 240, temperature: 0.3 },
      );
      answer = repair.text || answer;
      if (hasFactViolation(answer) || checkKnownFacts(answer, factEntries)) {
        // 只按「问句」挑卡片：按回答挑会挑到被写错的那张卡（问儿子却答成李璟的介绍）
        answer =
          factEntries[0]?.reply
          || FIGURE_FACTS.find(
            (item) => item.names.some((name) => message.includes(name)) || item.patterns?.some((re) => re.test(message)),
          )?.reply
          || FALLBACK_REPLY;
      }
    }

    // 词禁闸：史实卡里标了「不许出现的说法」（例如把陈乔写成雅集知己、流放边地），
    // 模型若照旧写出来，直接用卡片答复覆盖，不再和它拉扯
    {
      const forbidden: string[] = factEntries.flatMap((e: any) => (Array.isArray(e.forbid) ? e.forbid : []));
      const violated = forbidden.find((word) => word && answer.includes(word));
      if (violated) {
        const owner = factEntries.find((e: any) => Array.isArray(e.forbid) && e.forbid.includes(violated));
        if (owner?.reply) {
          console.warn(`词禁闸拦截：回答出现「${violated}」，改用史实卡答复`);
          answer = owner.reply;
        }
      }
    }

    // 时间闸：李煜只知道 978 年七夕以前的事。979 年及以后的年份、人物、事件一旦出现，
    // 先按「不知道」重写一次；仍越界就换成固定答复，保证绝不讲身后事。
    const futureIssue = checkFutureKnowledge(answer);
    if (futureIssue) {
      // 先只删掉越界的那几句，保住其余对题的回答；删完仍有内容就不必整段重写
      const kept = answer
        .split(/(?<=[。！？\n])/)
        .filter((sentence) => !checkFutureKnowledge(sentence))
        .join("")
        .trim();
      if (kept.length >= 40 && !checkFutureKnowledge(kept)) {
        console.warn(`时间闸：删去越界句（${futureIssue}）`);
        answer = kept;
      } else {
        console.warn(`时间闸拦截：回答越过 978 年（${futureIssue}），重答一次`);
        const repaired = await callModel(
          [
            { role: "system", content: system },
            {
              role: "user",
              content: `你上一段回答提到了 978 年以后的事（${futureIssue}）。读者问的是：「${message}」。你只是李煜，所知停在自己死的那一年七夕，之后的事一概不知。请重写 60—120 字，用第一人称直接回答读者的问题：
- 保留 978 年以前的史实，不要改写成身世感慨，也不要提自己的卒年；
- 删去所有 979 年以后的年份、人物、事件；
- 若读者问的正是 978 年以后的事，只答「那年之后的事，我已无从知道了」。`,
            },
          ],
          { model: resultModel, maxTokens: 240, temperature: 0.3 },
        ).catch(() => null);
        const rewritten = repaired?.text?.trim() || "";
        answer = rewritten && !checkFutureKnowledge(rewritten) ? rewritten : (kept || TIME_CUTOFF_REPLY);
      }
    }

    // 出处格式归一：把「《宋史/卷478》」收拾成「《宋史·卷478》」
    answer = tidySourceTitles(answer);

    // 空答兜底：Agent 轮次用尽仍无正文时，给一句不冷场的话
    if (!answer) {
      answer = "这一时，我不知从何说起。换个问法试试？";
    }

    // 引文核对 + 人物卡：回答定稿后再抽，保证点开的原文与回答里说的出处一致
    let citations: { book: string; juan: string; text: string; url: string; tier: string; tierLabel: string }[] = [];
    if (action === "ask") {
      // 只认回答里点明的卷：没点名就没有可核对的原文，不拿不相干的卷凑数
      const refs = extractCitationRefs(answer);
      if (refs.length) {
        loadRuntimeRag();
        const pool = [...(loadHistoryIndex()?.chunks ?? []), ...runtimeChunks];
        citations = refs
          .map((ref) => findCitationText(ref, pool))
          .filter((c): c is NonNullable<typeof c> => !!c)
          .slice(0, 3);
      }
      // 被提到的人物浮成档案卡（最多两张），附两条可点追问
      detectPeopleMentions(answer, 2).forEach((person) => {
        cards.push({
          type: "person",
          name: person.name,
          title: person.title,
          archive: person.archive,
          anchor: person.anchor ?? "",
          asks: person.asks,
        });
      });
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
      }, "blocked");
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

    // 首次作答写入缓存（带上下文的追问不缓存，避免答非所问）
    const responseBody = {
      action,
      answer,
      model: resultModel,
      usage,
      cards,          // 动作卡：navigate（跳页/锚点/地图站点）与 poem（追问某首词）
      tools: toolsUsed,
      steps,          // 工具调用轨迹：tool / args / hits / ms
      sources: [...mergedSources.values()].slice(0, 4),
      history: historySources.slice(0, 3), // 正史出处：book / juan / title / url
      compare,          // 四库对照：按库别分组，同一条记载并排展示
      compareConflict,  // 各库记法有出入（如病死 vs 毒杀）
      citations,        // 引文核对：回答里点名的卷，展开即可读原文
      dispute,          // 争议辨析：本轮按「正史 / 笔记 / 一般看法」三层作答
    };
    if (canUseCache) {
      writeAnswerCache(cacheKey, action, {
        answer, model: resultModel, usage, cards, tools: toolsUsed,
        steps, sources: responseBody.sources, history: responseBody.history,
        compare: responseBody.compare, compareConflict: responseBody.compareConflict,
        citations: responseBody.citations, dispute: responseBody.dispute,
      });
    }
    return jsonResponse(responseBody);
  } catch (error) {
    console.error("guide 处理失败", error);
    const messageText = error instanceof Error ? error.message : "未知错误";
    return jsonResponse({ error: `梦客暂时走神了：${messageText}` }, 500);
  }
  });
}
