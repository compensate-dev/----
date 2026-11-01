// 本地最小 Deno 类型声明（仅声明本项目用到的 API）
// 为什么不用官方的远程类型引用（esm.sh）：VS Code 需要联网下载，
// 一旦下载失败就满屏「找不到名称 Deno」；本地声明离线可用、零依赖。
// 这只是给编辑器看的类型，Deno 运行时自带的 Deno 全局不受它影响。

declare namespace Deno {
  // 环境变量读取（本项目只用 get）
  export const env: {
    get(key: string): string | undefined;
  };
  // 启动 HTTP 服务：handler 收 Request、回 Response（可异步）
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
  ): void;
}
