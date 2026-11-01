// 一江春水 · 本地 Node 服务
// 职责：① 托管静态站 ② 把 /api/guide 转给复用同一份业务代码（supabase/functions/guide/index.ts）
// 之所以复用那份 TS：设定、工具定义、Agent 循环都在里面，重写一遍只会漂移；这里只补一个 Deno 兼容壳。
// 运行：node server/index.mjs        （需先在 .env.local 里放 ZHIPU_API_KEY）
// 要求：Node 22.18+ / 24+（原生擦除 TypeScript 类型，直接 import .ts 文件）

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize as normPath } from "node:path";
import { fileURLToPath } from "node:url";

// 站点根目录：本文件在 <root>/server/ 下，向上一级即站点根
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ---------- 读 .env.local：key 只留在本地文件，不进代码库 ----------
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

// 业务代码沿用 GUIDE_API_KEY 这个名字，这里把 ZHIPU_API_KEY 映射过去
if (!process.env.GUIDE_API_KEY && process.env.ZHIPU_API_KEY) {
  process.env.GUIDE_API_KEY = process.env.ZHIPU_API_KEY;
}

const PORT = Number(process.env.PORT || 53422);

// ---------- Deno 兼容壳：让 index.ts 原样跑在 Node 上 ----------
// 只实现业务代码用到的两件事：读环境变量、注册 HTTP 处理函数
globalThis.Deno = {
  env: { get: (key) => process.env[key] },
  serve: (handler) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        // 静态文件：非 /api 前缀一律按站点根目录取文件
        if (!url.pathname.startsWith("/api/")) {
          await serveStatic(url.pathname, res);
          return;
        }
        // 读请求体 → 转成标准 Request → 交给业务处理函数 → 回写 Response
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
        });
        const response = await handler(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: `服务端异常：${error.message}` }));
      }
    });
    server.listen(PORT, () => {
      console.log(`一江春水已启动： http://localhost:${PORT}`);
    });
  },
};

// ---------- 静态文件 ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const serveStatic = async (pathname, res) => {
  let rel = decodeURIComponent(pathname);
  // 只对外开静态资源：密钥文件、日志、服务端代码、词画索引一律不通过 HTTP 暴露
  const isPrivate = /^\/\.|^\/(server|scripts|supabase|tests|logs)\/|^\/data\/paintings\/[^/]+\.json$/;
  if (isPrivate.test(rel)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }
  if (rel === "/") rel = "/index.html";
  // 防目录穿越：规范化后必须仍在站点根目录内
  const full = join(ROOT, normPath(rel));
  if (!full.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const info = await stat(full);
    const target = info.isDirectory() ? join(full, "index.html") : full;
    const buf = await readFile(target);
    res.writeHead(200, { "Content-Type": MIME[extname(target).toLowerCase()] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
};

// 最后加载业务代码：此时 Deno 壳与 env 都已就绪，模块顶层读取变量才不会拿到空值
try {
  await import("../supabase/functions/guide/index.ts");
} catch (error) {
  console.error("业务代码加载失败：", error.message);
  if (error.code === "ERR_UNKNOWN_FILE_EXTENSION" || /TypeScript/i.test(error.message)) {
    console.error("当前 Node 版本不支持直接加载 .ts，请升级到 Node 22.18+ 或 24+。");
  }
  process.exit(1);
}
