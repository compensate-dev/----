// 一次性脚本：用智谱 Embedding-3 把词库里的每一首词变成向量，存进 data/vectors.json
// 之后 search 时的语义检索就在本地做余弦比对，不再每次请求都调嵌入接口、也不再需要数据库。
// 用法：node scripts/build-embeddings.mjs         （读 .env.local 里的 ZHIPU_API_KEY）
// 词库有改动（新增/修改词作）时重跑一次即可；已生成的向量不会丢，只会更新。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA_DIR = join(ROOT, "data");
const OUT_FILE = join(DATA_DIR, "vectors.json");
const BASE = process.env.GUIDE_API_BASE || "https://open.bigmodel.cn/api/paas/v4";

// 读 .env.local（与 server/index.mjs 同一套规则）
const loadEnv = () => {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) return;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
};
loadEnv();

const KEY = process.env.GUIDE_API_KEY || process.env.ZHIPU_API_KEY || "";
if (!KEY) {
  console.error("缺少密钥：请在 .env.local 里写 ZHIPU_API_KEY=...");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 一首词取哪些文字去嵌入：词牌/标题 + 关键词 + 背景 + 原文，兼顾「意象」与「故事」
const buildInput = (poem) =>
  [
    poem.title,
    (poem.keywords ?? []).join("、"),
    poem.background,
    poem.content,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);

const embed = async (text, retry = 0) => {
  const res = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "embedding-3", input: text }),
  });
  if (res.status === 429 && retry < 4) {
    // 限流：指数退避，别把免费额度一次耗光
    await sleep(1500 * 2 ** retry);
    return embed(text, retry + 1);
  }
  if (!res.ok) throw new Error(`嵌入接口返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || !vec.length) throw new Error("嵌入接口返回为空");
  return vec;
};

const main = async () => {
  const data = JSON.parse(readFileSync(join(DATA_DIR, "liyu-data.json"), "utf8"));
  const poems = data.poems ?? [];
  if (!poems.length) throw new Error("词库为空，先检查 data/liyu-data.json");

  const vectors = {};
  for (const [index, poem] of poems.entries()) {
    const vec = await embed(buildInput(poem));
    vectors[poem.slug] = vec;
    process.stdout.write(`\r${index + 1}/${poems.length}  ${poem.slug}           `);
    // 顺序调用 + 轻微间隔：免费额度下更稳，22 首整体也就一两分钟
    if (index < poems.length - 1) await sleep(400);
  }
  process.stdout.write("\n");

  // 维度一致性检查：所有向量必须等长，否则余弦比对会全部失效
  const dims = new Set(Object.values(vectors).map((v) => v.length));
  if (dims.size !== 1) throw new Error(`向量维度不一致：${[...dims].join(", ")}`);

  writeFileSync(OUT_FILE, JSON.stringify(vectors), "utf8");
  console.log(`已写入 ${OUT_FILE}：${Object.keys(vectors).length} 首词，${[...dims][0]} 维`);
};

main().catch((error) => {
  console.error("\n生成向量失败：", error.message);
  process.exit(1);
});
