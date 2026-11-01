// 一江春水 · AI 侍读（前端组件）
// 职责：在每一页右下角放一枚「侍」印，点开是一方纸色小窗；可问答、可检索词库。
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

  // 按页面给出情境：页面名 + 三条最常问的引导
  const PAGES = {
    home: {
      name: "首页",
      lead: "我是李煜。这一程从一场梦开始，你想先问什么？",
      chips: ["用一句话介绍李煜", "他为什么被叫作词中之帝", "从哪一幕开始看比较好"],
    },
    life: {
      name: "月色故人",
      lead: "937 到 978，一生不过四十二年。关于这段身世，你可以问我。",
      chips: ["937 到 978 发生了什么", "他为什么守不住南唐", "小周后是谁"],
    },
    ci: {
      name: "词间春水",
      lead: "词是心里的话。这里的每一阕，都能拆开细看。",
      chips: ["《虞美人》为什么被称作绝命词", "「春花秋月何时了」妙在哪", "这四阕词按什么选的"],
    },
    wanxiang: {
      name: "帘外余音",
      lead: "后人一直在重写我。戏台上的那个我，有几分真？",
      chips: ["戏曲里的李煜可信吗", "为什么后人反复写他", "《天上人间》演的是什么"],
    },
    listen: {
      name: "枕上低语",
      lead: "挑一阕词，让声音读完；也可以把没说完的那句，交给我续。",
      chips: ["《破阵子》写的是什么", "《乌夜啼》该怎么读", "帮我把这句续下去"],
    },
    map: {
      name: "水墨行迹",
      lead: "地图上的每一站，都是我真去过的地方。",
      chips: ["李煜一生去过哪些地方", "金陵为什么守不住", "北邙在哪儿"],
    },
    finale: {
      name: "终幕",
      lead: "梦到这里，江山就远了。最后想问什么，都可以。",
      chips: ["用一句话总结这场梦", "他最想留下的是什么", "如果重来一次会怎样"],
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
    <button class="ai-guide-seal" type="button" aria-expanded="false" aria-controls="aiGuidePanel" aria-label="打开 AI 侍读">
      <span class="ai-guide-seal-word">侍</span>
      <span class="ai-guide-seal-label">AI 侍读</span>
    </button>
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

  // 追加一条消息气泡：who 为 me / seer（李煜） / system
  const appendMessage = (who, text) => {
    const wrap = document.createElement("div");
    wrap.className = `ai-guide-msg is-${who}`;
    const bubble = document.createElement("p");
    bubble.textContent = text;
    wrap.append(bubble);
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
    }, 240);
    seal.focus({ preventScroll: true });
  };

  seal.addEventListener("click", () => {
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
    document.querySelectorAll(".mood-form, .poem-form").forEach((form) => {
      const field = form.querySelector("textarea");
      const feedback = form.querySelector(".mood-feedback, .poem-feedback");
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

  // 表单在页面加载时就已存在，直接初始化；首页舞台切幕不影响已注入的节点
  initWriteTools();
})();
