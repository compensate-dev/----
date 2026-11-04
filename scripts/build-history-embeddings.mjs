#!/usr/bin/env node
// 一江春水 · 史书语料向量化（智谱 embedding-3）
//
// 读 data/history/chunks.json，把每个分块变成向量，写入 data/history/vectors.json。
// 之后 search_history 的语义检索在本地做余弦比对，不再每次请求都调嵌入接口。
//
// 用法：node scripts/build-history-embeddings.mjs [--force]
// 说明：
//   - 需要 .env.local 里的 ZHIPU_API_KEY（或 GUIDE_API_KEY）；
//   - 支持断点续跑：已生成的分块跳过；
//   - 8 条一批；若上游不收数组，自动退回逐条；
//   - 失败只影响本次新增，旧向量保留。

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = join(ROOT, "data", "history");
const CHUNKS_FILE = join(DIR, "chunks.json");
const VECTORS_FILE = join(DIR, "vectors.json");
const FORCE = process.argv.includes("--force");

const BASE = (process.env.GUIDE_API_BASE || "https://open.bigmodel.cn/api/paas/v4").replace(/\/$/, "");
const MODEL = process.env.EMBED_MODEL || "embedding-3";

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

// 与抓取脚本同一套：本机 Node 的 fetch 连不上部分站点，统一走 node:https
const httpsPostJson = (urlString, payload, { headers = {}, timeout = 90_000 } = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = JSON.stringify(payload);
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Accept-Encoding": "identity",
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
      },
    );
    req.setTimeout(timeout, () => req.destroy(new Error("嵌入接口超时")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });

const embedBatch = async (texts, attempt = 0) => {
  try {
    const res = await httpsPostJson(`${BASE}/embeddings`, { model: MODEL, input: texts }, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * 2 ** attempt);
      return embedBatch(texts, attempt + 1);
    }
    if (res.status !== 200) throw new Error(`嵌入接口返回 ${res.status}：${res.body.slice(0, 200)}`);
    const data = JSON.parse(res.body);
    const rows = data?.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) {
      throw new Error(`返回条数不符：期望 ${texts.length}，实际 ${rows?.length ?? 0}`);
    }
    // API 可能乱序返回，用 index 归位
    return rows.sort((a, b) => a.index - b.index).map((row) => row.embedding);
  } catch (error) {
    if (attempt < (error.message.includes("条数不符") ? 2 : 4)) {
      await sleep(1200 * 2 ** attempt);
      return embedBatch(texts, attempt + 1);
    }
    throw error;
  }
};

const embedOne = async (text, attempt = 0) => {
  const vecs = await embedBatch([text], attempt);
  return vecs[0];
};

const main = async () => {
  const { chunks } = JSON.parse(readFileSync(CHUNKS_FILE, "utf8"));
  if (!chunks?.length) throw new Error("chunks.json 为空，先运行 scripts/sync-history.mjs");

  let previous = { meta: {}, vectors: {} };
  if (!FORCE && existsSync(VECTORS_FILE)) {
    try {
      previous = JSON.parse(readFileSync(VECTORS_FILE, "utf8"));
    } catch {
      previous = { meta: {}, vectors: {} };
    }
  }
  const vectors = { ...(previous.vectors ?? {}) };
  // 库D《十国春秋》只作交叉比对，默认不烧向量，走关键词检索即可；
  // 需要全量语义检索时加 --all。
  const includeAll = process.argv.includes("--all");
  const todo = chunks.filter((c) => !vectors[c.id] && (includeAll || c.tier !== "D"));
  if (!todo.length) {
    console.log(`已是最新：${chunks.length} 块均有向量`);
    return;
  }
  console.log(`待生成 ${todo.length}/${chunks.length} 块（模型 ${MODEL}${includeAll ? "，含库D" : "，库D 仅关键词"}）`);

  const batchSize = 8;
  // 每 200 块落一次盘：新语料有数千块，若每批都写整份 vectors.json，
  // 累计要写几百份上百 MB 的文件，磁盘会被拖垮。
  let unsaved = 0;
  // 原子写：先写临时文件再改名，避免进程中断留下半个 JSON（上次就是这么坏的）
  const atomicWrite = (payload) => {
    const tmp = `${VECTORS_FILE}.tmp`;
    writeFileSync(tmp, payload, "utf8");
    renameSync(tmp, VECTORS_FILE);
  };
  const save = () => {
    atomicWrite(JSON.stringify({
      meta: { model: MODEL, builtAt: new Date().toISOString(), count: Object.keys(vectors).length },
      vectors,
    }));
    unsaved = 0;
  };
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const texts = batch.map((c) => `《${c.book}·${c.juan}》${c.title ? ` ${c.title}` : ""}\n${c.text}`.slice(0, 1400));
    let vecs = [];
    try {
      vecs = await embedBatch(texts);
    } catch (error) {
      // 批量失败（多半是单条过长或上游不收数组）：退回逐条
      console.warn(`\n批量失败，改逐条：${error.message}`);
      for (const text of texts) vecs.push(await embedOne(text));
    }
    batch.forEach((chunk, index) => {
      if (Array.isArray(vecs[index]) && vecs[index].length) vectors[chunk.id] = vecs[index];
    });
    unsaved += batch.length;
    if (unsaved >= 200) save();
    const done = Math.min(i + batchSize, todo.length);
    process.stdout.write(`\r${done}/${todo.length}  ${batch[batch.length - 1].id}          `);
    await sleep(500);
  }
  process.stdout.write("\n");
  if (unsaved) save();

  const dims = new Set(Object.values(vectors).map((v) => v.length));
  if (dims.size !== 1) throw new Error(`向量维度不一致：${[...dims].join(", ")}`);
  atomicWrite(JSON.stringify({ meta: { model: MODEL, builtAt: new Date().toISOString(), count: Object.keys(vectors).length, dims: [...dims][0] }, vectors }));
  console.log(`完成：${Object.keys(vectors).length} 块，${[...dims][0]} 维`);
};

main().catch((error) => {
  console.error("\n生成向量失败：", error.message);
  process.exit(1);
});
