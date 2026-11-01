// 一江春水 · AI 侍读（前端组件）
// 职责：一枚可拖拽的「侍」印陪读全站——点开可问答/检索词库；
// 读到关键段落时，印章旁会浮出一句李煜本人的话，点「问问他」自动替你发问。
// 所有请求统一发到 guide 边缘函数，前端不接触任何密钥。
// 依赖：无（原生 JS），样式见 css/style.css 末尾的 .ai-guide 段。
(() => {
  // 边缘函数地址：workspace tough-lemon-8d35881h 的默认分支
  const ENDPOINT = "https://br-right-lynx-d7283c56.supabase.aidap-global.cn-beijing.volces.com/functions/v1/guide";

  // 会话标识：同一标签页内复用，便于把问答日志串起来（匿名，不含任何个人信息）
  let sessionId = "";
  try {
    sessionId = sessionStorage.getItem("liyu-ai-session") || "";
    if (!sessionId) {
      sessionId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem("liyu-ai-session", sessionId);
    }
  } catch (error) {
    sessionId = `s-${Date.now().toString(36)}`;
  }

  // sessionStorage 读写的小封装：隐私模式下不可用时静默降级为「每次都提示」
  const store = {
    get(key) {
      try { return sessionStorage.getItem(key); } catch (error) { return null; }
    },
    set(key, value) {
      try { sessionStorage.setItem(key, value); } catch (error) { /* 忽略 */ }
    },
  };

  // 按页面给出情境：页面名 + 开场白 + 三条最常问的引导 + 读到某处时的主动搭话
  // hints[].sel 是该处段落的选择器（取页面上第一个匹配元素）；
  // text 是印章旁浮出的话；question 是点「问问他」后自动替你发的问题
  const PAGES = {
    home: {
      name: "首页",
      greet: "我是李煜。这一程我陪你走——读到哪里，都可以问我。",
      lead: "我是李煜。这一程从一场梦开始，你想先问什么？",
      chips: ["用一句话介绍李煜", "他为什么被叫作词中之帝", "从哪一幕开始看比较好"],
      hints: [
        { sel: ".mood-form", text: "心里那句说不出的话，写在这里，我替你续。", question: "我心里有一句话却不知怎么落笔，帮我想个开头。" },
      ],
    },
    life: {
      name: "月色故人",
      greet: "937 到 978，一生不过四十二年。我陪你慢慢看。",
      lead: "937 到 978，一生不过四十二年。关于这段身世，你可以问我。",
      chips: ["937 到 978 发生了什么", "他为什么守不住南唐", "小周后是谁"],
      hints: [
        { sel: ".timeline-item", text: "937 年，我出生在金陵。往下走，是我的一生。", question: "你出生那年，南唐是什么样子？" },
        { sel: ".trail-guide", text: "故事到这里断了一截。剩下的路，你可以问我。", question: "978 年之后，你的故事是怎样的？" },
      ],
    },
    ci: {
      name: "词间春水",
      greet: "词是心里的话。这四阕，每一阕我都记得写它那晚。",
      lead: "词是心里的话。这里的每一阕，都能拆开细看。",
      chips: ["《虞美人》为什么被称作绝命词", "「春花秋月何时了」妙在哪", "这四阕词按什么选的"],
      hints: [
        { sel: ".works", text: "这四阕词，都是我当时的心境。哪一阕读不懂，问我。", question: "这四阕词，分别写于你人生的什么时候？" },
      ],
    },
    wanxiang: {
      name: "帘外余音",
      greet: "后人一直在重写我。戏台上那个我，有几分真，你看了再问我。",
      lead: "后人一直在重写我。戏台上的那个我，有几分真？",
      chips: ["戏曲里的李煜可信吗", "为什么后人反复写他", "《天上人间》演的是什么"],
      hints: [
        { sel: ".screen-world", text: "他们把我画了一遍又一遍。哪一幅像我，你说了算。", question: "后世这些演绎里，哪些最贴近真实的你？" },
      ],
    },
    listen: {
      name: "枕上低语",
      greet: "挑一阕词，让声音替你读。读不懂的地方，我在。",
      lead: "挑一阕词，让声音读完；也可以把没说完的那句，交给我续。",
      chips: ["《破阵子》写的是什么", "《乌夜啼》该怎么读", "帮我把这句续下去"],
      hints: [
        { sel: ".recite-card", text: "挑一阕，让人读给你听。读不懂的地方，我在。", question: "《破阵子》写的是什么？" },
        { sel: ".poem-form", text: "那句说不出的话，写下来，我替你续。", question: "帮我想一句开头，要有一点月色。" },
      ],
    },
    map: {
      name: "水墨行迹",
      greet: "地图上的每一处，我都走过。点一站，我讲给你听。",
      lead: "地图上的每一站，都是我真去过的地方。",
      chips: ["李煜一生去过哪些地方", "金陵为什么守不住", "北邙在哪儿"],
      hints: [
        { sel: ".map-guide-card", text: "按图索骥，顺着我的脚步走一遍南唐。", question: "按你的足迹，最该先看哪一站？" },
      ],
    },
    finale: {
      name: "终幕",
      greet: "梦到这里就醒了。还有想问的，最后问吧。",
      lead: "梦到这里，江山就远了。最后想问什么，都可以。",
      chips: ["用一句话总结这场梦", "他最想留下的是什么", "如果重来一次会怎样"],
      hints: [
        { sel: ".finale-scroll", text: "梦要醒了。还有想问的，最后问吧。", question: "如果重来一次，你最想改变什么？" },
      ],
    },
  };

  // 判断当前页：首页用 body 类，其余按路径文件名映射
  const resolvePageKey = () => {
    if (document.body.classList.contains("home-page")) return "home";
    const file = location.pathname.split("/").pop() || "index.html";
    const table = {
      "life.html": "life",
      "ci.html": "ci",
      "wanxiang.html": "wanxiang",
      "listen.html": "listen",
      "map.html": "map",
      "finale.html": "finale",
    };
    return table[file] || "home";
  };

  const pageKey = resolvePageKey();
  const page = PAGES[pageKey] || PAGES.home;

  // 对话历史：仅保存在内存，最多保留 6 条；刷新即清空
  const history = [];

  // ---------- 构建界面 ----------
  const root = document.createElement("div");
  root.className = "ai-guide-root";
  root.innerHTML = `
    <button class="ai-guide-seal" type="button" aria-expanded="false" aria-controls="aiGuidePanel" aria-label="打开 AI 侍读（可拖动）">
      <span class="ai-guide-seal-word">侍</span>
      <span class="ai-guide-seal-label">AI 侍读 · 可拖动</span>
    </button>
    <div class="ai-guide-bubble" role="status" hidden></div>
    <section class="ai-guide-panel" id="aiGuidePanel" role="dialog" aria-modal="false" aria-label="AI 侍读" hidden>
      <header class="ai-guide-head">
        <span class="ai-guide-mark" aria-hidden="true">煜</span>
        <div class="ai-guide-title"><b>李煜 · 侍读</b><small>问词 · 解梦 · 检索</small></div>
        <button class="ai-guide-close" type="button" aria-label="关闭 AI 侍读">×</button>
      </header>
      <div class="ai-guide-body" role="log" aria-live="polite">
        <p class="ai-guide-page">此刻在「${page.name}」</p>
      </div>
      <div class="ai-guide-chips" aria-label="你可以这样问"></div>
      <form class="ai-guide-form">
        <div class="ai-guide-modes" role="group" aria-label="回答方式">
          <button type="button" class="is-on" data-mode="ask">问答</button>
          <button type="button" data-mode="search">检索词库</button>
        </div>
        <div class="ai-guide-inputrow">
          <input class="ai-guide-input" type="text" maxlength="800" placeholder="问词、问人、问这一年……" aria-label="向李煜提问">
          <button class="ai-guide-send" type="submit">问</button>
        </div>
      </form>
      <p class="ai-guide-note">回答由 AI 生成，史实与原文以词库为准。</p>
    </section>
  `;
  document.body.append(root);

  const seal = root.querySelector(".ai-guide-seal");
  const panel = root.querySelector(".ai-guide-panel");
  const bubble = root.querySelector(".ai-guide-bubble");
  const body = root.querySelector(".ai-guide-body");
  const chips = root.querySelector(".ai-guide-chips");
  const form = root.querySelector(".ai-guide-form");
  const input = root.querySelector(".ai-guide-input");
  const send = root.querySelector(".ai-guide-send");
  const closeBtn = root.querySelector(".ai-guide-close");
  const modeButtons = root.querySelectorAll(".ai-guide-modes button");

  // 当前模式：问答 / 检索
  let mode = "ask";
  // 请求中标记，避免重复提交
  let busy = false;

  // ---------- 印章拖拽 ----------
  // 位置存 localStorage（跨页面保持），值是印章左上角的 left/top 坐标
  const POS_KEY = "liyu-ai-seal-pos";
  const SEAL_SIZE = 58;
  const EDGE_GAP = 10;

  // 把坐标收进可视范围内，防止拖到屏幕外或窗口缩放后丢失
  const clampPos = (x, y) => ({
    x: Math.min(Math.max(x, EDGE_GAP), Math.max(EDGE_GAP, window.innerWidth - SEAL_SIZE - EDGE_GAP)),
    y: Math.min(Math.max(y, EDGE_GAP), Math.max(EDGE_GAP, window.innerHeight - SEAL_SIZE - EDGE_GAP)),
  });

  // 应用坐标：从「右下角默认」切换为「显式定位」
  const applyPos = (x, y) => {
    const pos = clampPos(x, y);
    root.style.left = `${pos.x}px`;
    root.style.top = `${pos.y}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    return pos;
  };

  // 读取保存的位置；没有则用默认位（CSS 的 right/bottom）反推出坐标，便于统一处理
  const initPos = () => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch (error) { saved = null; }
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      applyPos(saved.x, saved.y);
      return;
    }
    const rect = seal.getBoundingClientRect();
    applyPos(rect.left, rect.top);
  };

  // 拖拽：pointer 事件，移动超过 6px 才算拖，否则视为点击
  let dragging = false;
  let dragMoved = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  seal.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragging = true;
    dragMoved = false;
    const rect = seal.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    seal.setPointerCapture(event.pointerId);
  });

  seal.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    if (!dragMoved && Math.hypot(event.movementX, event.movementY) < 1) {
      // 用累计位移判断更稳：下面用与起点的距离判定
    }
    const x = event.clientX - dragOffsetX;
    const y = event.clientY - dragOffsetY;
    const rect = seal.getBoundingClientRect();
    if (!dragMoved && Math.hypot(event.clientX - (rect.left + dragOffsetX), event.clientY - (rect.top + dragOffsetY)) < 6) return;
    if (!dragMoved) {
      dragMoved = true;
      root.classList.add("is-dragging");
      // 拖起时收起气泡，免得跟着跑
      hideBubble();
    }
    applyPos(x, y);
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("is-dragging");
    if (dragMoved) {
      const rect = seal.getBoundingClientRect();
      const pos = clampPos(rect.left, rect.top);
      applyPos(pos.x, pos.y);
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (error) { /* 忽略 */ }
      // 拖动结束后 suppress 紧接着的 click（否则会误开面板）
      event.preventDefault();
      event.stopPropagation();
      suppressClick = true;
      window.setTimeout(() => { suppressClick = false; }, 80);
    }
  };
  seal.addEventListener("pointerup", endDrag);
  seal.addEventListener("pointercancel", endDrag);

  // 窗口缩放时把印章收回来
  window.addEventListener("resize", () => {
    const rect = seal.getBoundingClientRect();
    const pos = clampPos(rect.left, rect.top);
    applyPos(pos.x, pos.y);
  });

  // ---------- 面板定位：以印章为锚，朝上优先、没地方就朝下 ----------
  const placePanel = () => {
    const rect = seal.getBoundingClientRect();
    const width = Math.min(392, window.innerWidth - 32);
    const height = Math.min(568, window.innerHeight - 128);
    // 水平：印章在右半屏则面板右缘对齐印章右缘，否则左缘对齐
    let left = rect.right - width;
    if (rect.left + rect.width / 2 < window.innerWidth / 2) left = rect.left;
    left = Math.min(Math.max(left, 12), Math.max(12, window.innerWidth - width - 12));
    // 垂直：优先在印章上方展开
    let top = rect.top - 16 - height;
    if (top < 12) top = Math.min(rect.bottom + 16, Math.max(12, window.innerHeight - height - 12));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
  };

  // ---------- 引导气泡 ----------
  // 一句话 + 「问问他」， anchored 到印章；同一时刻只出现一条，后来的排队
  let bubbleTimer = 0;
  const bubbleQueue = [];

  const placeBubble = () => {
    const rect = seal.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 32);
    bubble.style.width = `${width}px`;
    // 先量高度：短暂可见但不透明
    const bRect = bubble.getBoundingClientRect();
    let left = rect.right - width;
    if (rect.left + rect.width / 2 < window.innerWidth / 2) left = rect.left;
    left = Math.min(Math.max(left, 12), Math.max(12, window.innerWidth - width - 12));
    let top = rect.top - 14 - bRect.height;
    if (top < 12) top = rect.bottom + 14;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  };

  const hideBubble = () => {
    window.clearTimeout(bubbleTimer);
    bubble.classList.remove("is-on");
    window.setTimeout(() => { bubble.hidden = true; }, 220);
    // 当前这条没了，稍等放下一条
    window.setTimeout(flushBubbleQueue, 600);
  };

  const flushBubbleQueue = () => {
    if (!bubble.hidden || !bubbleQueue.length) return;
    // 面板开着时不打扰，等关上再说
    if (!panel.hidden) return;
    const item = bubbleQueue.shift();
    showBubbleNow(item.text, item.question);
  };

  const showBubbleNow = (text, question) => {
    bubble.innerHTML = "";
    const p = document.createElement("p");
    p.className = "ai-guide-bubble-text";
    p.textContent = text;
    const actions = document.createElement("div");
    actions.className = "ai-guide-bubble-actions";
    const askBtn = document.createElement("button");
    askBtn.type = "button";
    askBtn.className = "ai-guide-bubble-ask";
    askBtn.textContent = "问问他";
    askBtn.addEventListener("click", () => {
      hideBubble();
      open();
      input.value = question;
      submit("ask");
    });
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "ai-guide-bubble-dismiss";
    dismissBtn.setAttribute("aria-label", "知道了");
    dismissBtn.textContent = "知道了";
    dismissBtn.addEventListener("click", hideBubble);
    actions.append(askBtn, dismissBtn);
    bubble.append(p, actions);
    bubble.hidden = true;
    // 先 hidden 量高度再定位，最后淡入
    requestAnimationFrame(() => {
      bubble.hidden = false;
      bubble.style.visibility = "hidden";
      placeBubble();
      bubble.style.visibility = "";
      bubble.classList.add("is-on");
    });
    // 10 秒后自己收起来，不赖着不走
    window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(hideBubble, 10000);
  };

  // 每条引导只说一次（按 key 记忆）；面板打开时先入队
  const sayOnce = (key, text, question) => {
    if (store.get(key)) return;
    store.set(key, "1");
    if (bubble.hidden && panel.hidden) showBubbleNow(text, question);
    else bubbleQueue.push({ text, question });
  };

  // 追加一条消息气泡：who 为 me / seer（李煜） / system
  const appendMessage = (who, text) => {
    const wrap = document.createElement("div");
    wrap.className = `ai-guide-msg is-${who}`;
    const bubbleP = document.createElement("p");
    bubbleP.textContent = text;
    wrap.append(bubbleP);
    body.append(wrap);
    body.scrollTop = body.scrollHeight;
    return wrap;
  };

  // 检索结果卡：标题、年份、原句，点击可继续追问
  const appendSources = (title, sources) => {
    if (!sources || !sources.length) return;
    const group = document.createElement("div");
    group.className = "ai-guide-sources";
    const label = document.createElement("span");
    label.className = "ai-guide-sources-label";
    label.textContent = title;
    group.append(label);
    sources.forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ai-guide-source";
      const head = document.createElement("b");
      head.textContent = `《${item.title}》`;
      const meta = document.createElement("small");
      meta.textContent = item.year ? `${item.year} 年` : "";
      const line = document.createElement("em");
      line.textContent = (item.content || "").slice(0, 42) + ((item.content || "").length > 42 ? "……" : "");
      card.append(head, meta, line);
      // 点击词卡：把问题填进输入框并直接追问
      card.addEventListener("click", () => {
        input.value = `《${item.title}》写了什么？`;
        submit("ask");
      });
      group.append(card);
    });
    body.append(group);
    body.scrollTop = body.scrollHeight;
  };

  // 快捷追问：按当前页面给三条
  const renderChips = () => {
    chips.innerHTML = "";
    page.chips.forEach((text) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ai-guide-chip";
      chip.textContent = text;
      chip.addEventListener("click", () => {
        input.value = text;
        // 续写类问题自动走问答，其余保持当前模式
        submit(text.includes("续") ? "ask" : mode);
      });
      chips.append(chip);
    });
  };

  // 打开面板：收起时用 hidden 避免占位与误触
  const open = () => {
    hideBubble();
    placePanel();
    panel.hidden = false;
    // 下一帧加类，触发淡入与位移过渡
    requestAnimationFrame(() => panel.classList.add("is-on"));
    root.classList.add("is-open");
    seal.setAttribute("aria-expanded", "true");
    // 首次打开时放入开场白与快捷问题
    if (!body.dataset.ready) {
      appendMessage("seer", page.lead);
      renderChips();
      body.dataset.ready = "1";
    }
    window.setTimeout(() => input.focus({ preventScroll: true }), 120);
  };

  const close = () => {
    panel.classList.remove("is-on");
    root.classList.remove("is-open");
    seal.setAttribute("aria-expanded", "false");
    // 等过渡结束再隐藏
    window.setTimeout(() => {
      if (!root.classList.contains("is-open")) panel.hidden = true;
      flushBubbleQueue();
    }, 240);
    seal.focus({ preventScroll: true });
  };

  let suppressClick = false;
  seal.addEventListener("click", () => {
    // 拖拽刚结束时的那一次 click 不算数
    if (suppressClick) return;
    if (panel.hidden) open();
    else close();
  });
  closeBtn.addEventListener("click", close);

  // Esc 关闭（不打扰页面其他 Esc 行为，只在面板打开时生效）
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    close();
  });

  // 模式切换：检索只返回词库，不调用模型
  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.mode === "search" ? "search" : "ask";
      modeButtons.forEach((item) => item.classList.toggle("is-on", item === button));
      input.placeholder = mode === "search" ? "输入意象或词句，如「春水」「西楼」" : "问词、问人、问这一年……";
    });
  });

  // 发送问答：统一处理 loading、错误与结果渲染
  const submit = async (overrideMode) => {
    const text = input.value.trim();
    if (!text || busy) return;
    const action = overrideMode || mode;
    appendMessage("me", text);
    input.value = "";
    busy = true;
    send.disabled = true;
    const loading = appendMessage("system", "李煜正斟酌……");
    loading.classList.add("is-loading");

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          message: text,
          page: page.name,
          sessionId,
          // 检索模式不需要历史
          history: action === "ask" ? history.slice(-6) : [],
        }),
      });
      const data = await response.json();
      loading.remove();

      if (!response.ok) throw new Error(data.error || "请求失败");

      const answer = data.answer || "这一处我没有答上来。";
      appendMessage("seer", answer);
      if (action === "search") {
        appendSources(`检索到 ${(data.sources || []).length} 阕相关词作`, data.sources);
      } else {
        // 问答也附上引用的词作，便于顺着读下去
        appendSources("可继续读的词作", data.sources);
        // 记录上下文，供下一轮追问
        history.push({ role: "user", content: text }, { role: "assistant", content: answer });
        if (history.length > 6) history.splice(0, history.length - 6);
      }
    } catch (error) {
      loading.remove();
      appendMessage("system", `暂时没接上：${error.message}。稍后再问，或换一句试试。`);
    } finally {
      busy = false;
      send.disabled = false;
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  // 输入回车直接发送（输入框已是单行，天然支持）
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });

  // ---------- 两个写作区的 AI 伴写 / 解读 ----------
  // 首页「心情笺」与枕上低语「填词」共用同一套工具条：续一句 / 请李煜解读。
  // 结果先落在表单下方的小笺里，可一键采纳，不打断原有的「随风去」提交流程。
  const initWriteTools = () => {
    document.querySelectorAll(".mood-form, .poem-form").forEach((formEl) => {
      const field = formEl.querySelector("textarea");
      const feedback = formEl.querySelector(".mood-feedback, .poem-feedback");
      if (!field || !feedback) return;

      // 工具条：两枚小按钮，语气与站点一致
      const tools = document.createElement("div");
      tools.className = "ai-write-tools";
      tools.innerHTML = `
        <button type="button" data-ai-action="compose">让李煜续一句</button>
        <button type="button" data-ai-action="interpret">请李煜解读</button>
      `;
      // 结果笺：默认隐藏，拿到回答后再展开
      const resultBox = document.createElement("div");
      resultBox.className = "ai-write-result";
      resultBox.setAttribute("aria-live", "polite");
      resultBox.hidden = true;
      feedback.before(tools, resultBox);

      // 在结果笺里写一句轻提示（loading / error）
      const setHint = (text, isError) => {
        resultBox.hidden = false;
        resultBox.classList.toggle("is-error", Boolean(isError));
        resultBox.innerHTML = "";
        const p = document.createElement("p");
        p.className = "ai-write-hint";
        p.textContent = text;
        resultBox.append(p);
      };

      // 把回答渲染成小笺：正文 + 操作按钮
      const renderAnswer = (action, answer) => {
        resultBox.hidden = false;
        resultBox.classList.remove("is-error");
        resultBox.innerHTML = "";
        const tag = document.createElement("span");
        tag.className = "ai-write-tag";
        tag.textContent = action === "compose" ? "李煜续句" : "李煜解读";
        const text = document.createElement("p");
        text.className = "ai-write-text";
        text.textContent = answer;
        resultBox.append(tag, text);

        const actions = document.createElement("div");
        actions.className = "ai-write-actions";
        if (action === "compose") {
          // 采纳续句：接在原文之后，并把光标移回文本末尾
          const adopt = document.createElement("button");
          adopt.type = "button";
          adopt.textContent = "接上这句";
          adopt.addEventListener("click", () => {
            field.value = `${field.value.trim()}${answer}`;
            field.dispatchEvent(new Event("input", { bubbles: true }));
            field.focus();
            resultBox.hidden = true;
          });
          actions.append(adopt);
        }
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.textContent = "收起";
        dismiss.addEventListener("click", () => {
          resultBox.hidden = true;
        });
        actions.append(dismiss);
        resultBox.append(actions);
      };

      // 请求：动作由按钮 data-ai-action 决定
      const run = async (action) => {
        const text = field.value.trim();
        if (!text) {
          setHint("先写下一句，再交给李煜。", true);
          field.focus();
          return;
        }
        setHint(action === "compose" ? "李煜正在替你续这一句……" : "李煜正在读这一句……", false);
        tools.querySelectorAll("button").forEach((button) => (button.disabled = true));
        try {
          const response = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, message: text, page: page.name, sessionId }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "请求失败");
          renderAnswer(action, data.answer || "这一句我没有接上。");
        } catch (error) {
          setHint(`暂时没接上：${error.message}。稍后再试。`, true);
        } finally {
          tools.querySelectorAll("button").forEach((button) => (button.disabled = false));
        }
      };

      tools.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => run(button.dataset.aiAction));
      });
    });
  };

  // ---------- 引导：进站招呼 + 读到哪说到哪 ----------

  // 首页要翻开书封、印章可见之后才打招呼；其他页加载完即可
  const whenSealVisible = (callback) => {
    if (!document.body.classList.contains("home-page")) {
      callback();
      return;
    }
    if (document.body.classList.contains("book-opened")) {
      callback();
      return;
    }
    // 监听 body 类变化，等书封翻开
    const observer = new MutationObserver(() => {
      if (!document.body.classList.contains("book-opened")) return;
      observer.disconnect();
      callback();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  };

  // 进站招呼：每次会话每页只说一次，2.6 秒后轻声出现
  const initGreeting = () => {
    whenSealVisible(() => {
      window.setTimeout(() => {
        sayOnce(`liyu-ai-greet-${pageKey}`, page.greet, page.chips[0]);
      }, 2600);
    });
  };

  // 段落搭话：滚动到关键段落时，印章旁浮出一句话（每处每次会话只说一次）
  const initScrollHints = () => {
    if (!("IntersectionObserver" in window)) return;
    page.hints.forEach((hint, index) => {
      const target = document.querySelector(hint.sel);
      if (!target) return;
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.disconnect();
          sayOnce(`liyu-ai-hint-${pageKey}-${index}`, hint.text, hint.question);
        });
      }, { threshold: 0.35 });
      observer.observe(target);
    });
  };

  // ---------- 启动 ----------
  initPos();
  initWriteTools();
  initGreeting();
  initScrollHints();
})();
