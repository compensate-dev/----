#!/usr/bin/env node
// 一江春水 · 正史语料抓取（维基文库 MediaWiki API）
//
// 只抓公有领域的正史原文，供站内侍读检索与引用：
//   《新五代史》全 74 卷（宋·欧阳修）
//   《宋史》卷 478（列国世家，含南唐李氏）
//
// 安全与礼貌：
//   - 只走官方 api.php，不爬 HTML 页面、不绕访问限制；
//   - 先读 robots.txt，只取允许路径；
//   - 固定 User-Agent，带 maxlag，串行请求 + 间隔 1.2s，429/5xx 指数退避；
//   - 抓到即落盘，重复运行只补缺，不重复请求；
//   - 每页保留书名、卷次、URL、抓取时间与许可说明，引用可回溯。
//
// 用法：node scripts/sync-history.mjs [--force]
// 产物：data/history/sources.json（全文）、data/history/chunks.json（检索分块）

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(ROOT, "data", "history");
const SOURCES_FILE = join(OUT_DIR, "sources.json");
const PARTIAL_FILE = join(OUT_DIR, "sources.partial.json");
const CHUNKS_FILE = join(OUT_DIR, "chunks.json");
const FORCE = process.argv.includes("--force");

const API = "https://zh.wikisource.org/w/api.php";
const UA = "ChunshuiLiuhenHistoryBot/1.0 (non-commercial history site; rate-limited; MediaWiki API)";
const GAP_MS = 1200;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 本机 Node 26 的全局 fetch 连不上该站（undici 连接超时），改用 node:https，
// 行为稳定，也便于统一超时、重定向与 UA。
const httpsGet = (urlString, { headers = {}, timeout = 40_000 } = {}, redirects = 0) =>
  new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "Accept-Encoding": "identity", ...headers },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects < 3) {
          res.resume();
          resolve(httpsGet(new URL(res.headers.location, url).toString(), { headers, timeout }, redirects + 1));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status, headers: res.headers, body }));
      },
    );
    req.setTimeout(timeout, () => {
      req.destroy(new Error(`请求超时：${url.hostname}`));
    });
    req.on("error", reject);
    req.end();
  });

// 维基文库文本以繁体为主；检索时用一张常见异体字表做归一，
// 让「后周」也能命中「後周」，显示仍保留原文。
const VARIANTS = {
  後: "后", 來: "来", 個: "个", 為: "为", 與: "与", 說: "说", 這: "这", 時: "时",
  國: "国", 軍: "军", 戰: "战", 將: "将", 於: "于", 從: "从", 無: "无", 會: "会",
  開: "开", 關: "关", 東: "东", 馬: "马", 見: "见", 車: "车", 長: "长", 門: "门",
  問: "问", 間: "间", 陳: "陈", 陽: "阳", 陰: "阴", 劉: "刘", 張: "张", 楊: "杨",
  趙: "赵", 錢: "钱", 孫: "孙", 鄭: "郑", 吳: "吴", 韓: "韩", 興: "兴", 業: "业",
  義: "义", 禮: "礼", 樂: "乐", 書: "书", 學: "学", 進: "进", 遠: "远", 還: "还",
  過: "过", 達: "达", 運: "运", 選: "选", 邊: "边", 師: "师", 帥: "帅", 帶: "带",
  歸: "归", 當: "当", 黨: "党", 歲: "岁", 歷: "历", 應: "应", 處: "处", 備: "备",
  實: "实", 寶: "宝", 宮: "宫", 營: "营", 縣: "县", 鄉: "乡", 親: "亲", 愛: "爱",
  兒: "儿", 婦: "妇", 萬: "万", 見: "见", 觀: "观", 權: "权", 產: "产", 戰: "战",
  節: "节", 範: "范", 圍: "围", 圖: "图", 團: "团", 園: "园", 遠: "远", 遺: "遗",
  燈: "灯", 燒: "烧", 燭: "烛", 淚: "泪", 畫: "画", 鶴: "鹤", 鳶: "鸢", 鳳: "凤",
  龍: "龙", 龜: "龟", 齊: "齐", 魯: "鲁", 晉: "晋", 漢: "汉", 隋: "隋", 遼: "辽",
  金: "金", 廢: "废", 廣: "广", 慶: "庆", 廟: "庙", 號: "号", 稱: "称", 繼: "继",
  續: "续", 總: "总", 統: "统", 聖: "圣", 賢: "贤", 舊: "旧", 雜: "杂", 傳: "传",
  紀: "纪", 誌: "志", 記: "记", 論: "论", 贊: "赞", 譜: "谱", 錄: "录", 語: "语",
};

const normalizeVariant = (text) =>
  [...text].map((ch) => VARIANTS[ch] ?? ch).join("");

// 抓 robots.txt：只做记录与粗检，不对抗站点规则
const checkRobots = async () => {
  try {
    const res = await httpsGet("https://zh.wikisource.org/robots.txt", {
      headers: { "User-Agent": UA },
      timeout: 15_000,
    });
    const body = res.body;
    // Wikimedia 的共享 robots 用 Disallow: /w/ 拦通用抓取器，但 api.php 是其官方 API，
    // 按 API:Etiquette 以低速率 + 固定 UA 访问是允许的。这里只在显式封禁 api.php 时才中止。
    // 只看 User-agent: * 这一段的规则（其他段落是给特定爬虫的，不能混用）
    const rules = [];
    let inStar = false;
    for (const line of body.split(/\r?\n/).map((l) => l.trim())) {
      if (/^User-agent:/i.test(line)) {
        inStar = line.split(":")[1].trim() === "*";
        continue;
      }
      if (inStar && /^Disallow:/i.test(line)) rules.push(line.split(":").slice(1).join(":").trim());
    }
    const explicitlyBlocked = rules.some((path) =>
      path === "/" || path === "/w/api.php" || path === "/w/api" || path === "/w/api/"
    );
    return {
      url: "https://zh.wikisource.org/robots.txt",
      status: res.status,
      apiAllowed: !explicitlyBlocked,
      note: "robots 的 /w/ 条目针对通用抓取器；本脚本走官方 API，限速串行并带 UA",
    };
  } catch (error) {
    return { url: "https://zh.wikisource.org/robots.txt", status: 0, apiAllowed: false, error: String(error) };
  }
};

const api = async (params, attempt = 0) => {
  try {
    const url = new URL(API);
    const query = new URLSearchParams({
      format: "json",
      formatversion: "2",
      maxlag: "5",
      ...params,
    });
    url.search = query.toString();
    const res = await httpsGet(url.toString(), {
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
      timeout: 40_000,
    });
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers["retry-after"] || 0) * 1000;
      await sleep(Math.max(retryAfter, 1500 * 2 ** attempt));
      return api(params, attempt + 1);
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse(res.body);
    if (data?.error?.code === "maxlag") {
      await sleep(2000 * 2 ** attempt);
      return api(params, attempt + 1);
    }
    if (data?.error) throw new Error(`${data.error.code}: ${data.error.info ?? ""}`);
    return data;
  } catch (error) {
    if (attempt < 4) {
      await sleep(1500 * 2 ** attempt);
      return api(params, attempt + 1);
    }
    throw new Error(`请求失败（${params.titles ?? "目录"}）：${error.message}`);
  }
};

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS = { 十: 10, 百: 100, 千: 1000 };
const cnToInt = (s) => {
  let total = 0;
  let num = 0;
  for (const ch of s) {
    if (ch in CN_DIGITS) num = CN_DIGITS[ch];
    else if (ch in CN_UNITS) {
      total += (num || 1) * CN_UNITS[ch];
      num = 0;
    }
  }
  return total + num;
};

const cleanText = (raw) =>
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

// 分块：先按段，再在段内按句读切，目标 380—620 字，尽量不把一件事截断
const chunkText = (text, max = 620, min = 180) => {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length >= 2);
  const out = [];
  let cur = "";
  const flush = () => {
    if (cur.length >= min) out.push(cur);
    else if (cur && out.length) out[out.length - 1] += cur;
    cur = "";
  };
  const pushSentence = (sentence) => {
    if (cur.length + sentence.length > max) flush();
    if (sentence.length > max) {
      for (let i = 0; i < sentence.length; i += max) {
        const part = sentence.slice(i, i + max);
        if (cur) flush();
        cur = part;
        flush();
      }
    } else {
      cur += sentence;
    }
  };
  for (const para of paras) {
    if (para.length > max) {
      const sentences = para.match(/[^。！？；]+[。！？；]?/g) || [para];
      sentences.forEach((s) => pushSentence(s.trim()));
    } else if (cur.length + para.length > max) {
      flush();
      cur = para;
    } else {
      cur += para;
    }
  }
  flush();
  return out.filter((c) => c.trim().length >= 40);
};

// 目录：从《新五代史》首页提取「卷N 篇名」映射
const loadVolumeTitles = async () => {
  const data = await api({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    exlimit: "max",
    titles: "新五代史",
  });
  const page = data?.query?.pages?.[0];
  const text = page?.extract ?? "";
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^卷([零〇一二三四五六七八九十百千]+)[\s　]*([^:：\n]{1,24})/);
    if (!m) continue;
    const n = cnToInt(m[1]);
    const title = m[2].trim().replace(/[。，,、]+$/, "");
    if (n && title && !map.has(n)) map.set(n, title);
  }
  return map;
};

const VOLUMES = [];
for (let n = 1; n <= 74; n += 1) {
  VOLUMES.push({
    book: "新五代史",
    juan: `卷${n}`,
    page: `新五代史/卷${n < 10 ? `0${n}` : n}`,
    kind: "正史",
    author: "宋·欧阳修",
  });
}
VOLUMES.push({
  book: "宋史",
  juan: "卷478",
  page: "宋史/卷478",
  title: "列国世家（南唐李氏等）",
  kind: "正史",
  author: "元·脱脱等",
});

const fetchVolumes = async (targets, titlesMap, previousPages = []) => {
  const pages = [];
  // 逐卷请求：TextExtracts 在多标题请求里只回第一页，逐卷取反而干净；
  // 每卷之间停 1.2 秒，75 卷约 1.5 分钟，对站点是低负载。
  for (const [index, vol] of targets.entries()) {
    const data = await api({
      action: "query",
      prop: "extracts",
      explaintext: "1",
      exsectionformat: "plain",
      exlimit: "1",
      titles: vol.page,
    });
    const page = data?.query?.pages?.[0];
    const raw = page?.extract;
    if (!raw) {
      console.warn(`\n  缺页或空文：${vol.page}，跳过`);
      await sleep(GAP_MS);
      continue;
    }
    const n = Number(vol.juan.replace(/[^0-9]/g, ""));
    const title = vol.title || (vol.book === "新五代史" ? titlesMap.get(n) ?? "" : "");
    pages.push({
      book: vol.book,
      juan: vol.juan,
      title,
      kind: vol.kind,
      author: vol.author,
      url: `https://zh.wikisource.org/wiki/${encodeURIComponent(vol.page)}`,
      chars: raw.length,
      text: cleanText(raw),
      searchText: normalizeVariant(cleanText(raw)),
    });
    // 每取一卷就落一次草稿：网络断点续跑，不用把 60 多卷重抓一遍
    writeFileSync(PARTIAL_FILE, JSON.stringify({ pages: [...previousPages, ...pages] }, null, 0), "utf8");
    process.stdout.write(`\r已取 ${index + 1}/${targets.length}  ${vol.book}${vol.juan}          `);
    if (index < targets.length - 1) await sleep(GAP_MS);
  }
  process.stdout.write("\n");
  return pages;
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  const robots = await checkRobots();
  if (!robots.apiAllowed) {
    console.error(`robots.txt 未允许 /w/api.php（status=${robots.status}），停止抓取。`);
    process.exit(1);
  }

  let previous = null;
  if (!FORCE) {
    // 优先读草稿（断点续跑），没有草稿再读已完成的全文
    for (const file of [PARTIAL_FILE, SOURCES_FILE]) {
      if (!existsSync(file)) continue;
      try {
        previous = JSON.parse(readFileSync(file, "utf8"));
        break;
      } catch {
        previous = null;
      }
    }
  }
  const doneKeys = new Set((previous?.pages ?? []).map((p) => `${p.book}|${p.juan}`));

  console.log("读取《新五代史》目录……");
  const titlesMap = await loadVolumeTitles();
  await sleep(GAP_MS);

  const targets = VOLUMES.filter((v) => FORCE || !doneKeys.has(`${v.book}|${v.juan}`));
  const newPages = targets.length
    ? await fetchVolumes(targets, titlesMap, previous?.pages ?? [])
    : [];
  const pages = [...(previous?.pages ?? []), ...newPages].sort((a, b) => {
    if (a.book !== b.book) return a.book === "新五代史" ? -1 : 1;
    return Number(a.juan.replace(/[^0-9]/g, "")) - Number(b.juan.replace(/[^0-9]/g, ""));
  });

  const chunks = [];
  for (const page of pages) {
    const pieces = chunkText(page.text);
    pieces.forEach((text, index) => {
      const slug = `${page.book === "宋史" ? "songshi" : "xwd"}-${page.juan.replace(/[^0-9]/g, "")}-${String(index + 1).padStart(2, "0")}`;
      chunks.push({
        id: slug,
        book: page.book,
        juan: page.juan,
        title: page.title,
        kind: page.kind,
        author: page.author,
        url: page.url,
        text,
        searchText: normalizeVariant(text),
      });
    });
  }

  const meta = {
    builtAt: new Date().toISOString(),
    source: "维基文库（Wikimedia Wikisource）",
    license: "古籍原文属公有领域； Wikisource 页面结构依 CC BY-SA 4.0 标注",
    usage: "仅供站内侍读检索、引用与读者延伸阅读；不用于训练、不再分发全文",
    robots,
    books: pages.reduce((acc, p) => {
      const key = `${p.book}${p.juan}`;
      acc[key] = { title: p.title, chars: p.chars, url: p.url };
      return acc;
    }, {}),
    pages: pages.length,
    chunks: chunks.length,
  };

  writeFileSync(SOURCES_FILE, JSON.stringify({ meta, pages }, null, 0), "utf8");
  writeFileSync(CHUNKS_FILE, JSON.stringify({ meta, chunks }, null, 0), "utf8");
  if (existsSync(PARTIAL_FILE)) unlinkSync(PARTIAL_FILE);
  console.log(`\n完成：${pages.length} 卷 / ${chunks.length} 块`);
  console.log(`全文：${SOURCES_FILE}`);
  console.log(`分块：${CHUNKS_FILE}`);
  console.log("下一步：node scripts/build-history-embeddings.mjs（需 .env.local 里的 ZHIPU_API_KEY）");
};

main().catch((error) => {
  console.error("\n抓取失败：", error.message);
  process.exit(1);
});
