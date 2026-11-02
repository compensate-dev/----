#!/usr/bin/env node
// 一江春水 · 维基百科条目抓取 & 合并进 facts.json
// 用法：node scripts/sync-facts.mjs [条目1 条目2 ...]
// 例：node scripts/sync-facts.mjs 李从善 李煜 樊若水 南唐 (不传参数时用默认书单)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(root, "data", "facts.json");

// 默认书单：facts.json 里已有的人名，缺生卒、缺正史事实的优先
const DEFAULT_PAGES = [
  "李昪", "李璟", "李煜", "钟皇后", "周娥皇", "小周后", "周宗",
  "李弘冀", "李从善", "李从谦", "李仲寓", "李仲宣",
  "赵匡胤", "赵光义", "樊若水",
  "南唐",
];

const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PAGES;

// 维基 REST API：简单条目直接拿 summary（带 extract 摘要、thumbnail 等）
// 用专门的 User-Agent 才能过 CORS（API 官方推荐）
const UA = "YiJiangChunShui-Bot/1.0 (https://localhost; guide sync)";

const fetchWiki = async (title) => {
  const enc = encodeURIComponent(title);
  const url = `https://zh.wikipedia.org/api/rest_v1/page/summary/${enc}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const j = await res.json();
    return j.title
      ? {
          title: j.title,
          extract: j.extract ?? "",
          description: j.description ?? "",
          birthDate: j.birth_date ?? null,
          deathDate: j.death_date ?? null,
          firstParagraph: (j.extract_html ?? "")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .trim()
            .slice(0, 400),
        }
      : null;
  } catch (e) {
    return null;
  }
};

// 中文维基常把卒年写成「雍熙四年」「开宝八年」之类的年号，需要转一下
// 这里只做最常见的几个，够用就行；脚本本身不是正史，只是辅助核对
const ERA_MAP = {
  "开宝": 967, "雍熙": 984, "端拱": 988, "淳化": 990, "至道": 995,
  "咸平": 998, "景德": 1004, "大中祥符": 1008, "天禧": 1017, "乾兴": 1022,
  "明道": 1032, "景祐": 1034, "宝元": 1038, "康定": 1040, "庆历": 1041,
  "治平": 1064, "熙宁": 1068, "元丰": 1078, "元祐": 1086, "绍圣": 1094,
  "元符": 1098, "建中靖国": 1101, "崇宁": 1102, "大观": 1107, "政和": 1111,
  "宣和": 1119, "靖康": 1126, "建炎": 1127, "绍兴": 1131,
  "太平兴国": 976,
};

// 年号 + 数字 → 公历；例：「雍熙四年」→ 987
const yearFromEra = (text) => {
  const m = text.match(/([\u4e00-\u9fa5]+)(\d+)年/);
  if (!m) return null;
  const base = ERA_MAP[m[1]];
  if (!base) return null;
  return base + (Number(m[2]) - 1);
};

const eraPattern = /(?:生于|生於|卒于|卒於|死于|死於|去世于|去世於)([^，。；\s]{2,30})/g;
const parseKeyDates = (text) => {
  const out = { birth: null, death: null };
  // ISO 风格
  const isoBirth = text.match(/出生于[^，。；\s]{0,8}(\d{3,4})年?[^，。；\s]{0,6}月?[^，。；\s]{0,6}日?/);
  if (isoBirth) out.birth = isoBirth[1];
  const isoDeath = text.match(/卒于[^，。；\s]{0,8}(\d{3,4})年/);
  if (isoDeath) out.death = isoDeath[1];
  if (!out.birth) {
    const m = text.match(/出生于[^，。；\s]{0,6}([\u4e00-\u9fa5]+\d+)年/);
    if (m) {
      const y = yearFromEra(m[1] + "年");
      if (y) out.birth = String(y);
    }
  }
  if (!out.death) {
    const m = text.match(/卒于[^，。；\s]{0,6}([\u4e00-\u9fa5]+\d+)年/);
    if (m) {
      const y = yearFromEra(m[1] + "年");
      if (y) out.death = String(y);
    }
  }
  return out;
};

const main = async () => {
  console.log("=== 维基同步脚本（仅供核对，不自动写回 facts.json）===\n");
  const existing = JSON.parse(readFileSync(DATA, "utf8"));
  const known = new Set([
    ...(existing.people ?? []).map((p) => p.name),
    ...(existing.events ?? []).map((e) => e.name),
    ...(existing.people ?? []).flatMap((p) => p.aliases ?? []),
  ]);

  for (const t of pages) {
    const data = await fetchWiki(t);
    if (!data) {
      console.log(`[${t}] 未抓取到（可能是重定向或条目不存在）`);
      continue;
    }
    const dates = parseKeyDates(data.extract);
    const inLibrary = known.has(t) ? "✓" : "✗";
    console.log(`\n—— ${t} ${inLibrary} ——`);
    if (dates.birth || dates.death) console.log(`  生卒（脚本解析）: ${dates.birth ?? "?"} — ${dates.death ?? "?"}`);
    if (data.description) console.log(`  描述: ${data.description}`);
    console.log(`  摘要: ${data.firstParagraph}`);
  }

  console.log("\n=== 核对完毕。有差异请手动合并进 data/facts.json ===");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
