// 一江春水 · 本地 Node 服务
// 职责：① 托管静态站 ② 把 /api/guide 转给复用同一份业务代码（supabase/functions/guide/index.ts）
// 之所以复用那份 TS：设定、工具定义、Agent 循环都在里面，重写一遍只会漂移；这里只补一个 Deno 兼容壳。
// 运行：node server/index.mjs        （需先在 .env.local 里放 ZHIPU_API_KEY）
// 要求：Node 22.18+ / 24+（原生擦除 TypeScript 类型，直接 import .ts 文件）

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync, createReadStream } from "node:fs";
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
          await serveStatic(url.pathname, req, res);
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
  // 音频：浏览器 <audio> 依赖正确 Content-Type 与 Range 才能流式播放，缺失会报 ERR_ABORTED
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// 解析 Range 头，返回 { start, end } 或 null（无合法 Range）
// 仅支持 "bytes=start-end" 单段形式，浏览器媒体加载只用这种
const parseRange = (rangeHeader, total) => {
  if (!rangeHeader || typeof rangeHeader !== "string") return null;
  const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const [, a, b] = m;
  // 形如 "bytes=-500" 表示取末尾 500 字节
  if (a === "" && b !== "") {
    const suffix = Math.min(Number(b), total);
    return { start: total - suffix, end: total - 1 };
  }
  let start = a === "" ? 0 : Number(a);
  let end = b === "" ? total - 1 : Number(b);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (start > end || start >= total) return null;
  end = Math.min(end, total - 1);
  return { start, end };
};

const serveStatic = async (pathname, req, res) => {
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
    const fileInfo = await stat(target);
    const total = fileInfo.size;
    const type = MIME[extname(target).toLowerCase()] || "application/octet-stream";
    const isHead = req.method === "HEAD";

    // 解析 Range；HEAD 也要算好头信息
    const range = parseRange(req.headers.range, total);

    // 没有合法 Range：返回完整内容，但仍声明支持 Range，方便浏览器后续 seek
    if (!range) {
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": total,
        "Accept-Ranges": "bytes",
      });
      if (!isHead) {
        // 直接把文件流接入响应，避免把大文件（如 2.4MB 背景音乐）整段读进内存
        createReadStream(target).pipe(res);
      } else {
        res.end();
      }
      return;
    }

    // 合法 Range：返回 206 Partial Content，让 <audio> 能分段加载、拖动进度
    const { start, end } = range;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${total}`,
    });
    if (!isHead) {
      createReadStream(target, { start, end }).pipe(res);
    } else {
      res.end();
    }
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
