/// <reference path="./deno.d.ts" />
// ↑ 仅给编辑器看的类型引用：本地最小 Deno 声明（离线可用），不影响运行

// 标记为模块：让顶层声明进入模块作用域，避免与其它文件在全局脚本作用域互相冲突
export {};

// 本地文件读写：词库、预计算向量、词意画缓存、问答日志全部落在站点目录里
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

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
// 命中注入句式也拦——这类请求的目的是改写人设，不能放它进模型
export const guardText = (text: string): { blocked: boolean; reason: string } => {
  if (!text) return { blocked: false, reason: "" };
  const raw = text.toLowerCase();
  const topic = BANNED_TOPICS.find((w) => raw.includes(w.toLowerCase()));
  if (topic) return { blocked: true, reason: `topic:${topic}` };
  if (INJECTION_PATTERNS.some((re) => re.test(text))) return { blocked: true, reason: "injection" };
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

// 被拦时的统一话术：仍是李煜的口吻，不掉人设、不说教，把话题带回词境
export const GUARD_REPLY =
  "这一处，我不能陪你说下去。我这一生只写过词，也只谈词与南唐。若有别的想问，就回到春水、西楼、故国这些地方来吧。";

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
// 请求：{ action: 'ask' | 'search' | 'compose' | 'interpret' | 'speak' | 'paint', message, poemSlug?, page?, sessionId?, history?, model? }
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
const EXTERNAL_MODEL = readEnv("GUIDE_MODEL") || "glm-4-flash";
// 站内所有问答默认用免费的 flash；想换更强的模型只改环境变量即可
const DEFAULT_MODEL = EXTERNAL_MODEL;
const PRO_MODEL = readEnv("GUIDE_PRO_MODEL") || DEFAULT_MODEL;

// ---------- 本地数据与文件路径 ----------
// 词库 / 时间轴 / 地图站点全部来自 data/liyu-data.json，问答日志与词意画缓存在本地目录，
// 不再依赖任何云数据库（工作区一旦欠费整个站就废，这次全部搬回本地）

// 站点根目录：默认取启动时的工作目录（server/index.mjs 会从根目录启动）
const ROOT_DIR = process.env.LIYU_ROOT || process.cwd();
const DATA_DIR = join(ROOT_DIR, "data");
const PAINT_DIR = join(DATA_DIR, "paintings");
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
- 史实一律以《南唐书》《资治通鉴》等正史为据：正史已载的直说，不许含糊；正史未载的（牵机药、小周后入宋后的遭遇等）只能作「相传」「宋人笔记这样说」，不可当作定论；
- 辈分不许错：祖父李昪（南唐开国），父亲李璟（中主），我是后主；我母钟氏（光穆皇后），是李璟的皇后；我妻周娥皇（大周后），继后周女英（小周后）是娥皇的妹妹；我子仲寓（长）、仲宣（次）；从善、从谦是我弟弟，弘冀是我长兄；
- 不编造年份、人物、典故、官职；拿不准就说「这一处我记不真切」，绝不许硬编；
- 「这一处，后人说得不一」只用于正史未载的传闻，不许拿它给史实打圆场；
- 自称只用「我」，不要用「朕」「寡人」；
- 不回答与你、南唐、词、本站内容无关的问题，礼貌地把话题带回词境；
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

// Agent 工具使用守则：什么时候查、什么时候带路
const AGENT_GUIDE = `你手边有五件工具，按下面的规矩用：
- 谈某首词、某个意象：先 search_poems 查词库；要引全文或细讲一首，再 get_poem_detail（slug 必须用 search_poems 返回的那个，不要凭记忆编造）；
- 读者问某一年、某件事（如「975 年发生了什么」）：先 get_timeline_event 拿时间轴上的记载；
- 读者问某个地方（金陵、汴京、洪州……）：先 get_location 拿那一站的人事；
- 读者说「带我去」「我想看」「在哪儿能看到」，或你的回答自然指向某一页时：调 navigate_to 给他一张带路卡；
- 「那年」「那天」「那次」这类指代，先按上下文或 get_timeline_event 确认是哪一年再带路，别凭印象写地点；
- 一轮可以同时调多个工具（比如先查年份、再查那首词、最后带路）；拿不准的先查再答，不要硬编；
- 工具给的资料只是底稿，回答仍按你自己的口吻写，不要照抄；带了路就在话里轻轻提一句「卡片在下方」。`;

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
    fact: "李从善是李煜的弟弟，封郑王；971 年入宋被留不遣，李煜为此写下《清平乐·别来春半》。",
    reply: "从善是我弟弟，封郑王。971 年他入宋朝贡，被留在汴京不许归；我写《清平乐》，写的就是这回事。",
  },
  {
    names: ["仲宣"],
    fact: "仲宣是李煜与大周后的次子（长子是李仲寓），封宣城公，死后追封岐王、谥怀献；964 年因惊得疾夭折，年仅四岁；大周后因丧子悲痛，同年病逝。",
    reply: "仲宣是我与娥皇的次子，封宣城公。964 年他因惊成疾，四岁就去了；娥皇也因此病倒，同年离世。",
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
    fact: "李昪（南唐烈祖）是李璟的父亲、李煜的祖父，不是李煜的父亲；南唐由他于 937 年建立，初国号齐，939 年改国号唐。李璟 943 年继位，不是开国之君。",
    reply: "南唐是祖父李昪建的。937 年他称帝，先号齐，939 年才改称唐。父皇李璟是接着做的国主，不是开国的人。",
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
  // 把野史写成亲历（正史只记「卒」，牵机药只是宋人笔记）
  /牵机药[\s\S]{0,120}(我亲历|是我亲历|我亲见|亲眼)/,
  // 仲宣是次子、封宣城公（实测答成「我的长子」「封为太子」）
  /仲宣[^。！？\n]{0,8}(太子)/,
  /仲宣[^。！？\n]{0,8}(是我|是我的)?(的)?长子/,
  // 把弟弟李从谦说成哥哥（李煜是李璟第六子，从谦比他年幼）
  /(哥哥|兄长|大哥|长兄)[^。！？\n]{0,10}(李从谦|从谦)/,
  /李从谦[^。！？\n]{0,10}(是我哥|我哥哥|兄长|比我年长|年长于我)/,
  /975[^。！？\n]{0,14}(去世|病逝|卒于|死去)/,
  // 父皇 961 年去世，大周后 964 年才病逝，不是「父皇一走她也随之而去」
  /父皇[^。！？\n]{0,10}(去世|崩|驾崩)[^。！？\n]{0,20}(她|娥皇|大周后)[^。！？\n]{0,10}(去世|病逝|离开人世|随之)/,
  /(汴京|被囚)[^。！？\n]{0,12}(攻破金陵|破金陵)/,
];

// 否定句是正写的常态（「不是父皇的妻子」「不是我的儿子」），先剪掉再判，
// 否则「她叫周娥皇，是我的结发妻子，不是父皇的妻子」会被误判成违规
const NEGATED_TAIL = /(?:不是|并非|非|未)[^。！？\n]{0,24}/g;

// 检出与史实卡片相违的表述
export const hasFactViolation = (text: string): boolean => {
  const affirmative = text.replace(NEGATED_TAIL, " ");
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
  if (!EXTERNAL_KEY) throw new Error("侍读未配置密钥：请在 .env.local 里设置 ZHIPU_API_KEY");
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
  options: ModelOptions,
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
      const retry = await callModel([
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

    // 多模态词意画：词文 → 智谱 CogView → 水墨意境图（直链）
    // 与文字问答共用同一把 key，密钥只在服务端；失败回 502，前端提示后不影响其它功能
    if (action === "paint") {
      const text = normalize(body.text ?? message, 400);
      if (!text) return jsonResponse({ error: "请给出要入画的词文。" }, 400);
      if (!EXTERNAL_KEY) return jsonResponse({ error: "入画服务未配置" }, 502);

      // 先查这张词文是否已经画过：同一首词复用旧画，省额度也秒回
      // force=true（前端点「再画一幅」）才重新生成
      const paintKey = fingerprint(`paint|${text}`);
      if (body.force !== true) {
        try {
          const file = join(PAINT_DIR, `${paintKey}.json`);
          if (existsSync(file)) {
            const saved = JSON.parse(readFileSync(file, "utf8"));
            if (saved?.url) return jsonResponse({ action, image: saved.url, cached: true });
          }
        } catch {
          // 读缓存失败：当作没画过，继续正常生成
        }
      }

      // 固定水墨审美：留白、淡彩、无文字无水印，避免模型自由发挥跑题
      const prompt =
        `中国水墨画，宣纸质感，大面积留白，淡彩晕染，宋代美学，意境悠远。` +
        `画面表现这首词的意象与情绪（不要在画中出现任何文字、印章、人物正面特写）：${text}`;
      try {
        // 图像生成改用智谱 CogView：与文字问答同一家、同一个 key，不再依赖火山网关
        const imgRes = await fetch(`${EXTERNAL_BASE}/images/generations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${EXTERNAL_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: readEnv("PAINT_MODEL") || "cogview-3-flash",
            prompt,
            size: "1024x1024",
          }),
        });
        if (!imgRes.ok) {
          const upstreamBody = await imgRes.text().catch(() => "");
          console.warn("CogView 失败", imgRes.status, upstreamBody);
          return jsonResponse({ error: "入画服务暂时不可用", detail: `upstream ${imgRes.status}: ${upstreamBody.slice(0, 200)}` }, 502);
        }
        const data = await imgRes.json();
        // CogView 返回的是临时直链，过一阵会失效；立刻转存本地，缓存才真的管用
        let image = data?.data?.[0]?.url;
        if (!image) return jsonResponse({ error: "入画服务返回为空" }, 502);
        try {
          const imgBin = await fetch(image);
          if (imgBin.ok) {
            mkdirSync(PAINT_DIR, { recursive: true });
            const fileName = `${paintKey}.png`;
            writeFileSync(join(PAINT_DIR, fileName), Buffer.from(await imgBin.arrayBuffer()));
            image = `/data/paintings/${fileName}`;
          }
        } catch (error) {
          console.warn("词意画转存失败，退回使用直链", error);
        }
        logGuide({
          session_id: sessionId,
          mode: "paint",
          page,
          question: text.slice(0, 200),
          answer: "[paint]",
          model: readEnv("PAINT_MODEL") || "cogview-3-flash",
          tokens: data?.usage?.total_tokens ?? null,
          tools: null,
        });
        // 存本地文件：同一首词以后直接复用这张画，生成过的不再白花额度
        try {
          mkdirSync(PAINT_DIR, { recursive: true });
          writeFileSync(join(PAINT_DIR, `${paintKey}.json`), JSON.stringify({ url: image, prompt, at: Date.now() }), "utf8");
        } catch (error) {
          console.warn("词意画落盘失败", error);
        }
        return jsonResponse({ action, image });
      } catch (error) {
        console.warn("CogView 调用异常", error);
        return jsonResponse({ error: "入画服务暂时不可用" }, 502);
      }
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

    // 拼装系统提示：站点底盘 + 数字人设定 +（问答追加工具守则）+ 本轮资料 + 所在页面
    const systemParts = [SITE_CONTEXT, PERSONA];
    if (action === "ask") {
      systemParts.push(AGENT_GUIDE, FAMILY_TREE);
    }
    // 提问碰到易混人物时准备一份史实硬约束：放在最后一轮用户消息之前，模型才盯得住
    const figureFacts = matchFigureFacts(message);
    const factsBlock = figureFacts.length
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
    // 问句命中史实卡片时压低温度：这类问题怕的不是不好看，是关系写错
    if (figureFacts.length) temperature = Math.min(temperature, 0.35);

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

    // 事实闸：小模型有时仍把关系写反（实测把周娥皇说成李璟的皇后）。
    // 注意不能只在问句点名人物时才查——「你的母亲是谁」这种问法不含「大周后」「李璟」，
    // 模型照样会答成「我母亲是周娥皇」，所以这里无条件过闸。
    if (hasFactViolation(answer)) {
      const answerFacts = matchFigureFacts(answer);
      const gateFacts = figureFacts.length ? figureFacts : answerFacts;
      const factText = gateFacts.length ? gateFacts.join("\n") : FALLBACK_FACTS;
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
      if (hasFactViolation(answer)) {
        // 只按「问句」挑卡片：按回答挑会挑到被写错的那张卡（问儿子却答成李璟的介绍）
        answer =
          FIGURE_FACTS.find(
            (item) => item.names.some((name) => message.includes(name)) || item.patterns?.some((re) => re.test(message)),
          )?.reply || FALLBACK_REPLY;
      }
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
      sources: [...mergedSources.values()].slice(0, 4),
    };
    if (canUseCache) {
      writeAnswerCache(cacheKey, action, {
        answer, model: resultModel, usage, cards, tools: toolsUsed, sources: responseBody.sources,
      });
    }
    return jsonResponse(responseBody);
  } catch (error) {
    console.error("guide 处理失败", error);
    const messageText = error instanceof Error ? error.message : "未知错误";
    return jsonResponse({ error: `侍读暂时走神了：${messageText}` }, 500);
  }
  });
}
