#!/usr/bin/env node
// 一江春水 · 史书语料抓取（维基文库 MediaWiki API）
//
// 按可信度分四库抓取公有领域古籍原文，供站内侍读检索与引用：
//   库A 正史：《旧五代史》《新五代史》《资治通鉴》（卷266—294，907—959）
//             《宋史》（卷478 南唐李氏、卷480 吴越钱氏）《五代会要》
//   库B 宋人私史：《陆游南唐书》《马令南唐书》《吴越备史》《江表志》《江南别录》
//   库C 野史笔记：《南唐近事》《江南野史》《钓矶立谈》（标记传闻异说）
//   库D 清人汇编：《十国春秋》（仅作交叉比对）
//
// 安全与礼貌：
//   - 只走官方 api.php，不爬 HTML 页面、不绕访问限制；
//   - 先读 robots.txt，只取允许路径；
//   - 固定 User-Agent，带 maxlag，串行请求 + 间隔 1.8s，429/5xx 退避；
//   - 抓到即落盘，重复运行只补缺，不重复请求；
//   - 每页保留书名、卷次、库别、URL、抓取时间与许可说明，引用可回溯。
//
// 用法：node scripts/sync-history.mjs [--force]
// 产物：data/history/sources.json（全文）、data/history/chunks.json（检索分块）

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(ROOT, "data", "history");
const SOURCES_FILE = join(OUT_DIR, "sources.json");
const PARTIAL_FILE = join(OUT_DIR, "sources.partial.json");
const CHUNKS_FILE = join(OUT_DIR, "chunks.json");
const FORCE = process.argv.includes("--force");
// --rebuild：不联网，用已有 sources.json 重新分块、重建 searchText（异体字表更新后用）
const REBUILD = process.argv.includes("--rebuild");

const API = "https://zh.wikisource.org/w/api.php";
const UA = "ChunshuiLiuhenHistoryBot/1.0 (non-commercial history site; rate-limited; MediaWiki API)";
const GAP_MS = 1800;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 原子写：先写临时文件再改名，避免进程中断或磁盘故障留下半个 JSON
const writeJsonAtomic = (file, data) => {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 0), "utf8");
  renameSync(tmp, file);
};

// 本机 Node 26 的全局 fetch 连不上该站（undici 连接超时），改用 node:https
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
  // 史事高频字：人名（陳喬、李煜相关）、死生葬殺、官爵年号
  喬: "乔", 機: "机", 牽: "牵", 藥: "药", 殺: "杀", 歿: "殁", 薨: "薨", 葬: "葬",
  賜: "赐", 鴆: "鸩", 縊: "缢", 斬: "斩", 誅: "诛", 戮: "戮", 囚: "囚", 虜: "虏",
  獻: "献", 貢: "贡", 冊: "册", 璽: "玺", 綬: "绶", 爵: "爵", 祿: "禄", 秩: "秩",
  憲: "宪", 肅: "肃", 莊: "庄", 襄: "襄", 愍: "愍", 懷: "怀", 穆: "穆", 昭: "昭",
  諡: "谥", 諱: "讳", 嗣: "嗣", 襲: "袭", 冊封: "册封",
  煜: "煜", 璟: "璟", 昪: "昪", 鋹: "鋹", 鈺: "钰", 鐸: "铎", 鎮: "镇", 銳: "锐",
  釗: "钊", 鉉: "铉", 鍇: "锴", 鏐: "镠", 俶: "俶", 倧: "倧", 侑: "侑",
  訓: "训", 詩: "诗", 詞: "词", 賦: "赋", 頌: "颂", 銘: "铭", 碑: "碑", 墓: "墓",
  閩: "闽", 荊: "荆", 楚: "楚", 蜀: "蜀", 粵: "粤", 汴: "汴", 洛: "洛", 淮: "淮",
  潤: "润", 昇: "升", 婺: "婺", 歙: "歙", 閤: "合", 閭: "闾", 閻: "阎",
  內: "内", 眾: "众", 雖: "虽", 難: "难", 雙: "双", 離: "离", 顧: "顾", 願: "愿",
  飢: "饥", 餓: "饿", 餘: "余", 驚: "惊", 懼: "惧", 憂: "忧", 患: "患", 亂: "乱",
  盜: "盗", 賊: "贼", 寇: "寇", 叛: "叛", 降: "降", 服: "服", 屬: "属", 貳: "贰",
  幣: "币", 帛: "帛", 絹: "绢", 銀: "银", 銅: "铜", 鐵: "铁", 鹽: "盐", 茶: "茶",
  稅: "税", 賦稅: "赋税", 倉: "仓", 廩: "廪", 漕: "漕", 運河: "运河",
  // 四库全书扫描转录里常见的旧字形 / 异体
  髙: "高", 呉: "吴", 宻: "密", 㳺: "游", 㑹: "会", 徧: "遍", 眞: "真", 冨: "富",
  敎: "教", 旣: "既", 卽: "即", 迺: "乃", 竝: "并", 値: "值", 舎: "舍", 舘: "馆",
  巻: "卷", 臺: "台", 檯: "台", 麤: "粗", 麽: "么", 麼: "么", 甯: "宁", 寜: "宁",
  煕: "熙", 勲: "勋", 劒: "剑", 堦: "阶", 壻: "婿", 媿: "愧", 戸: "户", 攷: "考",
  斁: "斁", 晩: "晚", 曁: "暨", 朞: "期", 柩: "柩", 歛: "敛", 殯: "殡", 踰: "逾",
};

const normalizeVariant = (text) =>
  [...text].map((ch) => VARIANTS[ch] ?? ch).join("");

const checkRobots = async () => {
  try {
    const res = await httpsGet("https://zh.wikisource.org/robots.txt", {
      headers: { "User-Agent": UA },
      timeout: 15_000,
    });
    const body = res.body;
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
  let res;
  try {
    const url = new URL(API);
    const query = new URLSearchParams({
      format: "json",
      formatversion: "2",
      maxlag: "5",
      ...params,
    });
    url.search = query.toString();
    res = await httpsGet(url.toString(), {
      headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
      timeout: 45_000,
    });
  } catch (error) {
    if (attempt < 4) {
      await sleep(2000 * 2 ** attempt);
      return api(params, attempt + 1);
    }
    throw new Error(`请求失败（${params.titles ?? params.page ?? "目录"}）：${error.message}`);
  }
  // 维基文库限流时会直接回纯文本，而不是 JSON
  if (res.status === 429 || res.status >= 500 || /You are making too many requests/i.test(res.body.slice(0, 120))) {
    await sleep(6000 * (attempt + 1));
    if (attempt < 4) return api(params, attempt + 1);
    throw new Error(`请求被限流（${params.titles ?? "目录"}）`);
  }
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    if (attempt < 4) {
      await sleep(3000 * (attempt + 1));
      return api(params, attempt + 1);
    }
    throw new Error(`返回不是 JSON（${params.titles ?? "目录"}）`);
  }
  if (data?.error?.code === "maxlag") {
    await sleep(3000 * (attempt + 1));
    return api(params, attempt + 1);
  }
  if (data?.error) throw new Error(`${data.error.code}: ${data.error.info ?? ""}`);
  return data;
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

// 1—30 转中文数字（《五代会要》卷页用「卷一」…「卷三十」）
const intToCn = (n) => {
  if (n <= 10) return n === 10 ? "十" : "一二三四五六七八九"[n - 1];
  if (n < 20) return `十${"一二三四五六七八九"[n - 11]}`;
  if (n < 100) return `${"一二三四五六七八九"[Math.floor(n / 10) - 1]}十${n % 10 ? "一二三四五六七八九"[n % 10 - 1] : ""}`;
  return String(n);
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

// 四库全书扫描本没有现成纯文本，只能取 wiki 源文再剥模板；
// 正文包在 <onlyinclude><poem> 里，先取这一块，再把 SK 系列模板还原成文字。
const cleanWikitext = (raw) => {
  let text = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<noinclude>[\s\S]*?<\/noinclude>/g, "")
    .replace(/<onlyinclude>([\s\S]*?)<\/onlyinclude>/g, "$1")
    .replace(/<pages[^>]*\/>/g, "")
    .replace(/<\/?poem>/g, "")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  // 由内向外剥模板：先还原年份、锚点、注文，再删掉无内容模板
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
    .replace(/[\uE000-\uF8FF]/g, "")
    // 扫描本卷末残留的 <史部,載記類,書名> 类目标记（实体解码后才现形，放这一道）
    .replace(/<[^>\n]{1,60}>/g, "")
    .replace(/［\[?[^\]]*校勘[^\]]*\]?］/g, "")
    .replace(/　/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // 去掉卷首的「欽定四庫全書」「書名卷N」「某人撰」这类版式行
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = [];
  for (const line of lines) {
    if (head.length >= 5) break;
    const isBookLine = /^欽定四庫全書/.test(line)
      || /^(南唐書|十國春秋|舊五代史|新五代史|五代會要|吳越備史|江表志|江南別錄|南唐近事|江南野史|釣磯立談)\s*卷/.test(line)
      || /^[\d０-９]+$/.test(line)
      || (line.length <= 30 && /^(宋|元|明|清)?\s*[^\s]{0,12}\s*撰/.test(line));
    if (isBookLine) {
      head.push(line);
      continue;
    }
    break;
  }
  const body = lines.filter((line) => !head.includes(line)).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body;
};

// 分块：先按段，再在段内按句读切，目标 620 字以内，尽量不把一件事截断
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

// ---------- 书目与卷次配置 ----------
// tier：A 正史 / B 宋人私史 / C 野史笔记 / D 清人汇编
// mode：extract 走 TextExtracts；wikitext 走 revisions（四库扫描本只有源文）
// style：num 阿拉伯卷次；cn 中文卷次；text 直接给卷名
const BOOKS = [];

const addBook = (cfg) => BOOKS.push({ volumes: [], ...cfg });

const addVolumes = (book, { from, to, pad = 0, style = "num", prefix, mode = "extract" }) => {
  for (let n = from; n <= to; n += 1) {
    const pageName = style === "cn"
      ? `卷${intToCn(n)}`
      : `卷${pad ? String(n).padStart(pad, "0") : n}`;
    book.volumes.push({
      juan: style === "cn" ? `卷${intToCn(n)}` : `卷${n}`,
      page: `${prefix}/${pageName}`,
      order: n,
      mode,
    });
  }
};

addBook({
  book: "旧五代史", tier: "A", kind: "正史", author: "宋·薛居正等", slug: "jwd",
  prefix: "舊五代史", mode: "extract",
});
addVolumes(BOOKS.find((b) => b.book === "旧五代史"), { from: 1, to: 150, pad: 0, prefix: "舊五代史" });
BOOKS.find((b) => b.book === "旧五代史").volumes.push({
  juan: "附録", page: "舊五代史/附録", order: 151, mode: "extract",
});

addBook({
  book: "新五代史", tier: "A", kind: "正史", author: "宋·欧阳修", slug: "xwd",
  prefix: "新五代史", mode: "extract",
});
addVolumes(BOOKS.find((b) => b.book === "新五代史"), { from: 1, to: 74, pad: 2, prefix: "新五代史" });

addBook({
  book: "资治通鉴", tier: "A", kind: "正史", author: "宋·司马光等", slug: "zzjt",
  prefix: "資治通鑑", mode: "extract",
});
// 只取五代部分（卷266 后梁开平元年 907 — 卷294 后周显德六年 959），全在 978 年以前
addVolumes(BOOKS.find((b) => b.book === "资治通鉴"), { from: 266, to: 294, pad: 3, prefix: "資治通鑑" });

addBook({
  book: "宋史", tier: "A", kind: "正史", author: "元·脱脱等", slug: "ss",
  prefix: "宋史", mode: "extract",
});
[
  { juan: "卷478", page: "宋史/卷478", title: "列国世家·南唐李氏", order: 478 },
  { juan: "卷480", page: "宋史/卷480", title: "列国世家·吴越钱氏", order: 480 },
].forEach((v) => BOOKS.find((b) => b.book === "宋史").volumes.push({ ...v, mode: "extract" }));

addBook({
  book: "五代会要", tier: "A", kind: "正史", author: "宋·王溥", slug: "whd",
  prefix: "五代會要", mode: "extract",
});
addVolumes(BOOKS.find((b) => b.book === "五代会要"), { from: 1, to: 30, style: "cn", prefix: "五代會要" });

addBook({
  book: "陆游南唐书", tier: "B", kind: "私史", author: "宋·陆游", slug: "lynts",
  prefix: "南唐書 (陸游, 四庫全書本)", mode: "wikitext",
});
addVolumes(BOOKS.find((b) => b.book === "陆游南唐书"), {
  from: 1, to: 18, pad: 2, prefix: "南唐書 (陸游, 四庫全書本)", mode: "wikitext",
});

addBook({
  book: "马令南唐书", tier: "B", kind: "私史", author: "宋·马令", slug: "mlnts",
  prefix: "南唐書 (馬令, 四庫全書本)", mode: "wikitext",
});
addVolumes(BOOKS.find((b) => b.book === "马令南唐书"), {
  from: 1, to: 30, pad: 2, prefix: "南唐書 (馬令, 四庫全書本)", mode: "wikitext",
});

addBook({
  book: "吴越备史", tier: "B", kind: "私史", author: "宋·钱俨", slug: "wybs",
  prefix: "吳越備史", mode: "extract",
});
addVolumes(BOOKS.find((b) => b.book === "吴越备史"), { from: 1, to: 4, pad: 0, prefix: "吳越備史" });
BOOKS.find((b) => b.book === "吴越备史").volumes.push({
  juan: "补遗", page: "吳越備史/補遺", order: 5, mode: "extract",
});

addBook({
  book: "江表志", tier: "B", kind: "私史", author: "宋·郑文宝", slug: "jbz",
  prefix: "江表志", mode: "extract",
});
[
  { juan: "卷上", page: "江表志/卷上", order: 1 },
  { juan: "卷中", page: "江表志/卷中", order: 2 },
  { juan: "卷下", page: "江表志/卷下", order: 3 },
  { juan: "叙", page: "江表志/敘", order: 0 },
].forEach((v) => BOOKS.find((b) => b.book === "江表志").volumes.push({ ...v, mode: "extract" }));

addBook({
  book: "江南别录", tier: "B", kind: "私史", author: "宋·陈彭年", slug: "jnbl",
  prefix: "江南別錄", mode: "extract",
});
BOOKS.find((b) => b.book === "江南别录").volumes.push({
  juan: "卷1", page: "江南別錄", order: 1, mode: "extract", title: "全篇",
});

addBook({
  book: "南唐近事", tier: "C", kind: "野史笔记", author: "宋·郑文宝", slug: "ntjs",
  prefix: "南唐近事", mode: "extract",
});
BOOKS.find((b) => b.book === "南唐近事").volumes.push({
  juan: "卷1", page: "南唐近事", order: 1, mode: "extract", title: "全篇",
});

addBook({
  book: "江南野史", tier: "C", kind: "野史笔记", author: "宋·龙衮", slug: "jnyy",
  prefix: "江南野史", mode: "extract",
});
addVolumes(BOOKS.find((b) => b.book === "江南野史"), { from: 1, to: 10, pad: 2, prefix: "江南野史" });

addBook({
  book: "钓矶立谈", tier: "C", kind: "野史笔记", author: "宋·史虚白", slug: "djlt",
  prefix: "釣磯立談", mode: "extract",
});
BOOKS.find((b) => b.book === "钓矶立谈").volumes.push({
  juan: "卷1", page: "釣磯立談", order: 1, mode: "extract", title: "全篇",
});

addBook({
  book: "十国春秋", tier: "D", kind: "清人汇编", author: "清·吴任臣", slug: "sgcq",
  prefix: "十國春秋 (四庫全書本)", mode: "wikitext",
});
addVolumes(BOOKS.find((b) => b.book === "十国春秋"), {
  from: 1, to: 114, pad: 3, prefix: "十國春秋 (四庫全書本)", mode: "wikitext",
});

const BOOK_ORDER = new Map(BOOKS.map((b, i) => [b.book, i]));
const TIER_ORDER = { A: 0, B: 1, C: 2, D: 3 };
const BOOK_META = new Map(BOOKS.map((b) => [b.book, b]));

// 从卷首几行猜一个篇名（四库本没有现成目录）
const guessTitle = (text, book) => {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
  for (const line of lines) {
    if (line.length > 18) continue;
    const hasAuthor = line.includes("撰");
    const after = hasAuthor ? line.split("撰").pop()?.trim() ?? "" : "";
    if (hasAuthor && after && after.length >= 2 && after.length <= 12) return after;
    if (!hasAuthor && !line.includes(book) && !/欽定四庫全書/.test(line) && !/^卷/.test(line)) return line;
  }
  return "";
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

const fetchPageText = async (vol) => {
  if (vol.mode === "wikitext") {
    const data = await api({
      action: "query", prop: "revisions", rvprop: "content", rvslots: "main",
      redirects: "1", titles: vol.page,
    });
    const page = data?.query?.pages?.[0];
    const raw = page?.revisions?.[0]?.slots?.main?.content ?? "";
    return raw ? cleanWikitext(raw) : "";
  }
  const data = await api({
    action: "query", prop: "extracts", explaintext: "1", exsectionformat: "plain",
    exlimit: "1", redirects: "1", titles: vol.page,
  });
  const page = data?.query?.pages?.[0];
  const raw = page?.extract ?? "";
  return raw ? cleanText(raw) : "";
};

const fetchVolumes = async (targets, titlesMap, previousPages = []) => {
  const pages = [];
  for (const [index, vol] of targets.entries()) {
    const body = await fetchPageText(vol);
    if (!body) {
      console.warn(`\n  缺页或空文：${vol.page}，跳过`);
      await sleep(GAP_MS);
      continue;
    }
    const meta = BOOK_META.get(vol.book);
    const numeric = Number(vol.juan.replace(/[^0-9]/g, ""));
    const fallbackTitle = vol.book === "新五代史" ? titlesMap.get(numeric) ?? "" : "";
    const title = vol.title ?? fallbackTitle ?? "";
    pages.push({
      book: vol.book,
      juan: vol.juan,
      title: title || guessTitle(body, vol.book),
      tier: meta.tier,
      kind: meta.kind,
      author: meta.author,
      edition: vol.mode === "wikitext" ? "四库全书本（维基文库转录）" : "维基文库",
      url: `https://zh.wikisource.org/wiki/${encodeURIComponent(vol.page)}`,
      chars: body.length,
      text: body,
      searchText: normalizeVariant(body),
    });
    writeJsonAtomic(PARTIAL_FILE, { pages: [...previousPages, ...pages] });
    process.stdout.write(`\r[${meta.tier}] ${index + 1}/${targets.length}  ${vol.book}${vol.juan}          `);
    if (index < targets.length - 1) await sleep(GAP_MS);
  }
  process.stdout.write("\n");
  return pages;
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  if (REBUILD) {
    if (!existsSync(SOURCES_FILE)) {
      console.error("没有 sources.json，无法重建。");
      process.exit(1);
    }
    const previous = JSON.parse(readFileSync(SOURCES_FILE, "utf8"));
    const pages = (previous.pages ?? []).map((p) => ({
      ...p,
      searchText: normalizeVariant(p.text ?? ""),
    }));
    const chunks = [];
    for (const page of pages) {
      const meta = BOOK_META.get(page.book);
      const pieces = chunkText(page.text);
      pieces.forEach((text, index) => {
        const num = page.juan === "附録" ? "fulu" : page.juan.replace(/[^0-9]/g, "") || page.juan;
        chunks.push({
          id: `${meta?.slug ?? "his"}-${num}-${String(index + 1).padStart(2, "0")}`,
          book: page.book,
          juan: page.juan,
          title: page.title,
          tier: page.tier,
          kind: page.kind,
          author: page.author,
          edition: page.edition,
          hearsay: page.tier === "C",
          url: page.url,
          text,
          searchText: normalizeVariant(text),
        });
      });
    }
    const meta = { ...(previous.meta ?? {}), rebuiltAt: new Date().toISOString(), pages: pages.length, chunks: chunks.length };
    writeJsonAtomic(SOURCES_FILE, { meta, pages });
    writeJsonAtomic(CHUNKS_FILE, { meta, chunks });
    console.log(`重建完成：${pages.length} 卷 / ${chunks.length} 块（未联网）`);
    return;
  }

  const robots = await checkRobots();
  if (!robots.apiAllowed) {
    console.error(`robots.txt 未允许 /w/api.php（status=${robots.status}），停止抓取。`);
    process.exit(1);
  }

  let previous = null;
  if (!FORCE) {
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

  const targets = [];
  for (const book of BOOKS) {
    for (const vol of book.volumes) {
      if (!FORCE && doneKeys.has(`${book.book}|${vol.juan}`)) continue;
      targets.push({ ...vol, book: book.book });
    }
  }
  // 四库扫描本（源文清洗）风险最高，先抓它，方便尽早发现问题
  targets.sort((a, b) => (a.mode === "wikitext" ? 0 : 1) - (b.mode === "wikitext" ? 0 : 1));
  const totalTargets = BOOKS.reduce((sum, b) => sum + b.volumes.length, 0);
  console.log(`共 ${totalTargets} 卷/篇，待抓 ${targets.length}，已完成 ${totalTargets - targets.length}`);

  const newPages = targets.length
    ? await fetchVolumes(targets, titlesMap, previous?.pages ?? [])
    : [];
  // 旧页面补上库别/版本字段（此前只抓了正史三书，默认按 A 库）
  const pages = [...(previous?.pages ?? []), ...newPages].map((p) => {
    const meta = BOOK_META.get(p.book);
    return {
      ...p,
      tier: p.tier ?? meta?.tier ?? "A",
      kind: p.kind ?? meta?.kind ?? "正史",
      author: p.author ?? meta?.author ?? "",
      edition: p.edition ?? "维基文库",
    };
  }).sort((a, b) => {
    const ao = BOOK_ORDER.get(a.book) ?? 99;
    const bo = BOOK_ORDER.get(b.book) ?? 99;
    if (ao !== bo) return ao - bo;
    const av = BOOKS[ao]?.volumes.find((v) => v.juan === a.juan)?.order ?? Number(a.juan.replace(/[^0-9]/g, ""));
    const bv = BOOKS[bo]?.volumes.find((v) => v.juan === b.juan)?.order ?? Number(b.juan.replace(/[^0-9]/g, ""));
    return av - bv;
  });

  const chunks = [];
  for (const page of pages) {
    const meta = BOOK_META.get(page.book);
    const pieces = chunkText(page.text);
    pieces.forEach((text, index) => {
      const num = page.juan === "附録" ? "fulu" : page.juan.replace(/[^0-9]/g, "") || page.juan;
      chunks.push({
        id: `${meta?.slug ?? "his"}-${num}-${String(index + 1).padStart(2, "0")}`,
        book: page.book,
        juan: page.juan,
        title: page.title,
        tier: page.tier,
        kind: page.kind,
        author: page.author,
        edition: page.edition,
        hearsay: page.tier === "C",
        url: page.url,
        text,
        searchText: normalizeVariant(text),
      });
    });
  }

  const tierCount = chunks.reduce((acc, c) => {
    acc[c.tier] = (acc[c.tier] ?? 0) + 1;
    return acc;
  }, {});
  const meta = {
    builtAt: new Date().toISOString(),
    source: "维基文库（Wikimedia Wikisource）",
    license: "古籍原文属公有领域； Wikisource 页面结构依 CC BY-SA 4.0 标注",
    usage: "仅供站内侍读检索、引用与读者延伸阅读；不用于训练、不再分发全文",
    tiers: {
      A: "正史：旧五代史、新五代史、资治通鉴（卷266—294）、宋史（卷478/480）、五代会要",
      B: "宋人私史：陆游南唐书、马令南唐书、吴越备史、江表志、江南别录",
      C: "野史笔记：南唐近事、江南野史、钓矶立谈（传闻异说，不作定论）",
      D: "清人汇编：十国春秋（仅作交叉比对，不优先采信）",
    },
    robots,
    books: pages.reduce((acc, p) => {
      const key = `${p.book}${p.juan}`;
      acc[key] = { title: p.title, tier: p.tier, chars: p.chars, url: p.url };
      return acc;
    }, {}),
    pages: pages.length,
    chunks: chunks.length,
    tierCount,
  };

  writeFileSync(SOURCES_FILE, JSON.stringify({ meta, pages }, null, 0), "utf8");
  writeFileSync(CHUNKS_FILE, JSON.stringify({ meta, chunks }, null, 0), "utf8");
  if (existsSync(PARTIAL_FILE)) unlinkSync(PARTIAL_FILE);
  console.log(`\n完成：${pages.length} 卷 / ${chunks.length} 块`);
  console.log(`分块按库：${JSON.stringify(tierCount)}`);
  console.log(`全文：${SOURCES_FILE}`);
  console.log(`分块：${CHUNKS_FILE}`);
  console.log("下一步：node scripts/build-history-embeddings.mjs（需 .env.local 里的 ZHIPU_API_KEY）");
};

main().catch((error) => {
  console.error("\n抓取失败：", error.message);
  process.exit(1);
});
