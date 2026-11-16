# 一江春水 · 李煜词境

> 一个以李煜（937—978）为叙事主体的中文沉浸式站点。
> 它不做「词人百科」，而是让读者以第一人称的「梦客」视角，从一首词走进一个人、一段国史与一张行迹地图；站内的 AI 侍读同样以李煜口吻作答，答必给出处，无据则说「史料未载」。

- 在线演示：<https://web-production-e6033138.up.railway.app>（免登录，评审期保持可用）
- 代码仓库：<https://github.com/compensate-dev/---->
- 技术文档：[docs/技术文档.pdf](docs/技术文档.pdf)
- 赛事：传智杯大赛 · 主选方向「RAG 知识问答系统」，兼具「AI Agent 智能助手」

---

## 一、项目介绍

### 1.1 创作理念

**问题意识：名句流传，人被压扁。** 「问君能有几多愁」几乎人人会背，但李煜的四十一年常被压缩成「亡国之君」一个标签，词里的情绪被抽干成考点；网络叙述又真假混杂，「牵机药」究竟是正史还是宋人笔记，少有人分辨。

**设计哲学：让词回到它的处境。** 项目不做词人百科，而把词、史、地、人放回同一条 937—978 的时间线，让读者「走过」而不是「知道」李煜的一生。「梦客」是一个从 978 年后回望的第一人称叙述者——可以有情绪，但视角严格限定在史料可证的范围内：沉浸感来自第一人称，可信度来自第一人称的自我克制。

**技术信念：AI 应是「带出处的向导」，不是答案机器。** 大模型最擅长流畅，也最擅长流畅地编造。在历史题材里，一次无据的回答胜过十次沉默的伤害。因此每条史实必须落到某书某卷，落不到就说「史料未载」；各书记载不一时，把分歧摆出来而不是替读者裁决。四库分级检索、点名式引文核对、争议三层辨析、过程透明，都是为这条原则服务的工程约束。

**文化立场：数字化要重建阅读关系，而不是搬运古籍。** 项目追求三种新关系——**可问**（任何一处都能向当事人追问）、**可走**（一句词跳到那一年的地图与人事）、**可核对**（每条答案点开即见原典）。可信与可亲，可以同时成立。

内容规模：**词** 24 首（原文、译意、背景、意象）；**史** 470 卷四库语料、5059 个切块，按正史/别史杂史/野史/十国春秋四层分级；**地** 金陵、钟山、洪州、采石矶、江舟、汴京、北邙山七站水墨地图；**人** 17 位人物档案卡。

### 1.2 内容立场

| 原则 | 具体做法 |
| --- | --- |
| 史实优先 | 叙事截止 978 年；模型不得编造词句与史实，无据时明确回答「史料未载」 |
| 出处可查 | 回答中点了哪一卷，才核对并展示哪一卷的原文，绝不拿不相干的卷凑引用 |
| 争议分层 | 遇「牵机药」这类争议，按「正史 / 笔记 / 一般看法」三层作答，并标注各层性质 |
| 文创克制 | 文创只做概念陈列：不卖、不标价、不导购、无购买入口 |
| 隐私克制 | 留言只上传用户点下的那一条，不上传整板内容 |

### 1.3 页面构成

| 页面 | 文件 | 作用 |
| --- | --- | --- |
| 首页 | `index.html` | 水墨场景、印章入口、夜航船式引导 |
| 词作 | `pages/ci.html` | 词作列表、原文与译意、收藏 |
| 生平 | `pages/life.html` | 937—978 时间轴，支持年份锚点定位 |
| 万象 | `pages/wanxiang.html` | 意象图谱，页末通向「从词到物」 |
| 听词 | `pages/listen.html` | 音频朗读与词境氛围 |
| 行迹 | `pages/map.html` | Three.js 水墨地图，七站可飞达 |
| 终幕 | `pages/finale.html` | 978 年七夕的滚动叙事 |
| 笺语墙 | `pages/jianyu.html` | 读者回笺、提笔、分享 |
| 文创 | `pages/wenwu.html` | 六张概念卡，每卡可「问梦客」 |

### 1.4 参赛方向与评分对照（摘要）

对照传智杯推荐方向：主选 **② RAG 知识问答系统** 与 **① AI Agent 智能助手**；延展 **③ 多模态创意**、**⑨ AI 安全与内容治理**、**⑩ AI 社交社区**。

| 评分维度（权重） | 本项目对应能力 |
| --- | --- |
| AI 技术深度 35% | 可切换 LLM + 精巧提示词（8%）；7 工具 Function Calling、4 轮 Agent 规划（8%）；四库分级 RAG + 双通道召回（6%）；文本/语音/图像/视频/3D 五模态（5%）；双层闸门与六级降级（4%）；工具集成五类数据源（4%） |
| 创新性 25% | 选题：可信的第一人称文史对话（10%）；方案：分级 RAG、点名式引文、运行时 RAG（8%）；交互：动作卡、思考可视化、争议三层（7%） |
| 前端工程质量 10% | TypeScript 业务核心 + 136 项断言；三层脚本解耦；懒加载、Range 流式、零 CDN |
| 实用性 10% | 三类真实用户、四个具体场景；对比百科与通用大模型的可核对优势 |
| 用户体验 10% | 统一水墨设计系统、响应式、思考状态可视化、优雅降级 |
| 社会价值与商业潜力 10% | 古籍活化与普惠教育；文博授权、校本课程、文创延展三条路径 |

> 完整逐项对照（含分值与文档章节定位）见技术文档 §1.5。

---

## 二、技术架构

### 2.1 总览

```
浏览器（多页静态站 + 原生 JS + Three.js）
        │  same-origin fetch：POST /api/guide
        ▼
Node 服务（server/index.mjs，单进程、零第三方依赖）
        ├── 静态托管：Range 请求、MIME、私有路径拦截
        └── /api/guide ──► supabase/functions/guide/index.ts（业务主体）
                              ├── 输入闸门（白/黑名单、注入检测、长度）
                              ├── Agent 工具循环（7 个工具，默认 4 轮）
                              ├── 四库 RAG（余弦相似度 + 分级权重 + 关键词兜底）
                              ├── 输出闸门（打码、审计日志）
                              └── 引文核对 / 四库对照 / 争议辨析 / 人物卡
        │
        ▼
模型服务：对话 GUIDE_MODEL（deepseek-chat / glm-4-flash）、向量 embedding-3
```

### 2.2 关键设计取舍

- **同一份业务代码，本地与云端一致**：AI 逻辑写在 `supabase/functions/guide/index.ts`，Node 侧用一个极薄的 Deno 兼容壳（`globalThis.Deno` 的 `env` / `serve`）直接 `import` 同一文件，避免「本地能跑、线上走样」。
- **零运行时依赖**：服务端只用 Node 内置模块，`npm install` 实际不装任何包，镜像构建秒级完成。
- **RAG 不引入向量数据库**：语料规模为 5059 块，直接用内存索引 + 余弦相似度即可，省去部署与运维成本。
- **密钥不下发**：浏览器只请求同源 `/api/guide`，所有模型密钥留在服务端变量中。

### 2.3 数据

| 文件 | 规模 | 说明 |
| --- | --- | --- |
| `data/liyu-data.json` | 30 KB | 词作库 |
| `data/facts.json` | 20 KB | 史实事实库 |
| `data/history/chunks.json` | 16.4 MB | 四库切块，5059 块 |
| `data/history/sources.json` | 15.1 MB | 470 卷全文与来源 |
| `data/history/vectors.json` | 97 MB | 3949 条 × 2048 维向量（D 库按设计不向量化） |

---

## 三、环境配置

### 3.1 环境变量

模板见 [`.env.example`](.env.example)，复制为 `.env.local` 后填写。`.env.local` 已在 `.gitignore` 中忽略。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `GUIDE_API_KEY` | 是 | 对话模型密钥（服务端专用） |
| `GUIDE_API_BASE` | 是 | OpenAI 兼容接口地址，需支持 `function calling` |
| `GUIDE_MODEL` | 否 | 对话模型名，缺省 `glm-4-flash`；线上使用 `deepseek-chat` |
| `EMBED_API_KEY` | 否 | 向量模型密钥；缺省时退化为关键词检索 |
| `EMBED_API_BASE` | 否 | 向量接口地址，模型固定 `embedding-3` |
| `AGENT_ROUNDS` | 否 | Agent 工具轮数，2—5，缺省 4 |
| `TTS_PROVIDER` | 否 | 设为 `glm` 时优先 GLM-TTS |
| `PORT` | 否 | 监听端口，缺省 53422；云平台由平台注入 |

### 3.2 依赖清单

| 类别 | 依赖 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 22.18（推荐 22 LTS / 24） | 原生擦除 TypeScript 类型，直接 `import` `.ts` |
| 服务端 | 无第三方包 | 仅 `node:http`、`node:fs`、`node:path` 等内置模块 |
| 前端 | 原生 JS + Three.js（已内置 `js/three.min.js`） | 无需构建、无需 CDN |
| 外部服务 | 对话模型、embedding 模型（OpenAI 兼容） | 未配置时站点仍可浏览，AI 降级 |

> 注：`scripts/` 下的语料同步与向量化脚本只用于离线重建数据，不参与线上运行。

### 3.3 本地运行

```powershell
# 1) 准备密钥
copy .env.example .env.local
# 编辑 .env.local，填入真实密钥

# 2) 启动（Node 未加入 PATH 时用全路径）
node server/index.mjs
# 或
npm start

# 3) 打开
# http://localhost:53422
```

---

## 四、测试

```powershell
# 单元测试：AI 后端纯逻辑（人格、闸门、检索、引文、争议判定等 136 项断言）
node --test tests/ai-guide.test.ts

# 冒烟测试：起服务后跑首页与 /api/guide
node tests/smoke.mjs
```

线上实测（2026-11-17）：

| 检查项 | 结果 |
| --- | --- |
| 首页 `GET /` | 200，38.5 KB |
| 静态资源 `js/ai-guide.js`、`data/liyu-data.json` | 200 |
| `POST /api/guide` `search` | 命中 6 首词 |
| `POST /api/guide` `ask` | `deepseek-chat` 正常作答 |
| 史料引文 / 四库对照 | `citations` 1 条、`compare` 2 条，语料生效 |

---

## 五、部署（Railway）

```powershell
# 1) 登录并建项目（首次）
railway login
railway init --name yijiang-chunshui
railway add --service web

# 2) 写入服务变量（逐项，勿写进仓库）
railway variables --set "GUIDE_API_KEY=..."
railway variables --set "EMBED_API_KEY=..."

# 3) 部署
railway up --service web

# 4) 生成域名并绑定端口（必须与 PORT 一致）
railway domain --service web
railway domain update <domain-id> --port 53422
```

注意事项：

- 上传遵守 [`.railwayignore`](.railwayignore)：排除 `.env.local`、`node_modules/`、`logs/`、本地运行时产物，但**必须包含** `data/history/`，否则引文与四库对照失效。
- 忽略规则中的目录名要写成 `/functions/` 这种带前导斜杠的形式，否则会连带排除 `supabase/functions/`，导致 AI 业务代码缺失、服务启动即退出。
- 平台只需注入 `PORT`，服务端已按该变量监听。

---

## 六、团队信息

| 项目 | 内容 |
| --- | --- |
| 赛事 | 传智杯 · AI WEB 网页开发挑战赛 |
| 参赛方向 | RAG 知识问答系统（主）／AI Agent 智能助手（兼具） |
| 团队名称 | 前端要秃头（团队编号 44071，B 组，3 人） |
| 所属院校 | 四川工商学院（眉山校区） |
| 指导老师 | 邱敏 |
| 队长 | 胡建铭（参赛编号 2084908，计算机科学与技术，本科） |
| 队员 | 文骏豪、雷吴玲 |
| 联系邮箱 | sc159515@qq.com |
| 分工 | 胡建铭：独立完成项目设计与全部开发（选题与史料整理、前端页面、AI 侍读 RAG/Agent、服务端、部署、技术文档）；雷吴玲：提供前端修改建议与 DeepSeek API |

---

## 七、目录结构

```
一江春水/
├── index.html                 首页
├── pages/                     8 个子页面
├── css/style.css              全局样式与响应式
├── js/
│   ├── script.js              首页场景、印章、抽屉、朗读降级
│   ├── ai-guide.js            AI 侍读交互（ask/search/compose/interpret/reply/share/speak）
│   ├── map-textures.js        地图纹理数据
│   └── three.min.js           Three.js 运行时
├── assets/                    字体、图像、音频、视频（130.8 MB）
├── data/                      词库、事实库、四库语料与向量
├── server/index.mjs           静态托管 + /api/guide
├── supabase/functions/guide/  AI 业务主体
├── scripts/                   语料同步与向量化（离线）
├── tests/                     单元测试与冒烟
├── .env.example               环境变量模板
├── .railwayignore             云端上传忽略规则
└── railway.json               Railway 构建与启动配置
```

---

## 八、声明

- 站内所有词作、史实引用均来自公开古籍语料，仅用于研究与展示。
- 文创页为概念设计，不构成任何商品或服务要约。
- AI 生成内容仅供阅读辅助，涉及史实处请以原典为准。
