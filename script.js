// 一江春水 · 李煜词境 — 交互脚本 script.js
// 主要功能模块：
//   1) 点击花瓣 / 星火粒子特效   2) 移动端汉堡菜单
//   3) 背景音乐(开关 / 音量 / 进度记忆)
//   4) 无刷新翻页(水波过渡 + SPA 式导航，含 file:// 回退)
//   5) 页面内交互(语音诵读 / 收藏 / 字数统计 / 心情与填词表单)

(() => {
  // 是否开启“减弱动效”偏好：开启后跳过花瓣、水波等动画
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 1. 点击花瓣 / 星火粒子特效 ---------- */
  // 全局点击：在鼠标坐标处生成一组花瓣(8) + 星火(5)，飘落后自动清理
  document.addEventListener("click", (event) => {
    // 减弱动效，或在可输入/媒体元素上点击时不触发
    if (reducedMotion || event.target.closest("input, textarea, select, audio, video")) return;
    const x = event.clientX;
    const y = event.clientY;
    if (!x && !y) return; // 键盘触发的点击(坐标为 0,0)不处理
    const petals = document.createElement("span");
    petals.className = "petal-burst";
    petals.setAttribute("aria-hidden", "true"); // 纯装饰，对读屏隐藏

    // 1a. 8 片花瓣：每片随机大小、下落距离、横向漂移、旋转、延迟
    for (let index = 0; index < 8; index += 1) {
      const petal = document.createElement("span");
      const startX = (Math.random() - 0.5) * 42;        // 起始横向散布
      const sway = (Math.random() - 0.5) * 110;         // 整体漂移幅度
      const duration = 5.5 + Math.random() * 1.7;       // 每片飘落时长(秒)
      const spin = (Math.random() - 0.5) * 520;         // 总旋转角度
      petal.className = "petal-particle";
      petal.style.left = `${x + startX}px`;
      petal.style.top = `${y + (Math.random() - 0.5) * 20}px`;
      const width = 8 + Math.random() * 6;              // 花瓣宽
      // —— 把各阶段尺寸写入 CSS 变量(供 @keyframes petal-fall 读取)——
      petal.style.setProperty("--petal-width", `${width}px`);
      petal.style.setProperty("--petal-height", `${width * 1.45}px`); // 高约为宽的 1.45 倍
      // 四个下落关键帧的纵向位移(以视口高度为基准，越往后落得越远)
      petal.style.setProperty("--fall-a", `${window.innerHeight * 0.24}px`);
      petal.style.setProperty("--fall-b", `${window.innerHeight * 0.52}px`);
      petal.style.setProperty("--fall-c", `${window.innerHeight * 0.8}px`);
      petal.style.setProperty("--fall-d", `${window.innerHeight * 0.8}px`);
      petal.style.setProperty("--fall-end", `${window.innerHeight + 80}px`); // 最终落到视口下方
      // 三段横向漂移(正弦式左右摇摆)
      petal.style.setProperty("--sway-a", `${sway * 0.35}px`);
      petal.style.setProperty("--sway-b", `${-sway * 0.45}px`);
      petal.style.setProperty("--sway-c", `${sway * 0.6}px`);
      petal.style.setProperty("--sway-end", `${-sway * 0.2}px`);
      // 三段旋转(旋转量逐步累加)
      petal.style.setProperty("--spin-a", `${spin * 0.25}deg`);
      petal.style.setProperty("--spin-b", `${spin * 0.6}deg`);
      petal.style.setProperty("--spin-c", `${spin * 0.85}deg`);
      petal.style.setProperty("--spin-end", `${spin}deg`);
      petal.style.setProperty("--delay", `${Math.random() * 520}ms`); // 错峰出现
      petal.style.animationDuration = `${duration}s`;
      petals.append(petal);
    }

    // 1b. 5 颗星火：在点击点附近随机散布，向上飘并淡出
    for (let index = 0; index < 5; index += 1) {
      const spark = document.createElement("span");
      spark.className = "spark-particle";
      spark.style.left = `${x + (Math.random() - 0.5) * 46}px`;
      spark.style.top = `${y + (Math.random() - 0.5) * 42}px`;
      spark.style.setProperty("--spark-size", `${1.5 + Math.random() * 2}px`);   // 星火大小
      spark.style.setProperty("--spark-drift-x", `${(Math.random() - 0.5) * 24}px`); // 横向漂移
      spark.style.setProperty("--spark-drift-y", `${-14 - Math.random() * 30}px`);  // 纵向向上漂移
      spark.style.setProperty("--delay", `${Math.random() * 460}ms`);
      petals.append(spark);
    }

    document.body.append(petals);
    window.setTimeout(() => petals.remove(), 8400); // 动画最长约 8.4s，结束后清理 DOM
  });

  /* ---------- 2. 移动端汉堡菜单 ---------- */
  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");
  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const open = nav.classList.toggle("open"); // 切换下拉展开 / 收起
      menuButton.setAttribute("aria-expanded", String(open)); // 无障碍状态
      menuButton.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    });
  }

  /* ---------- 3. 背景音乐：开关 / 音量 / 进度记忆 ---------- */
  const audio = document.querySelector(".background-audio");
  const soundButtons = document.querySelectorAll(".sound-toggle");
  const volumeSlider = document.querySelector(".volume-slider");
  // 用 sessionStorage 记忆开关状态(默认开启；仅当显式存 "false" 才关闭)
  let audioEnabled = sessionStorage.getItem("liyu-audio-enabled") !== "false";
  // 同步所有声音按钮的“开启 / 关闭”视觉与无障碍文案
  const updateSoundControls = (playing, message) => {
    soundButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", playing ? "关闭背景音乐" : "开启背景音乐");
      const status = button.querySelector(".sound-status");
      if (status) status.textContent = message || (playing ? "音乐开启" : "开启音乐");
    });
  };
  // 尝试播放；失败(多为浏览器自动播放限制)则提示“点击开启”
  const playBackgroundMusic = () => {
    if (!audio || !audioEnabled) return;
    audio.play().then(() => {
      updateSoundControls(true);
    }).catch(() => {
      updateSoundControls(false, "点击开启");
    });
  };
  if (audio) {
    // 恢复上次保存的音量
    const savedVolume = sessionStorage.getItem("liyu-audio-volume");
    if (volumeSlider && savedVolume !== null) volumeSlider.value = savedVolume;
    audio.volume = Number(volumeSlider?.value || 0.32); // 默认音量 0.32
    audio.muted = false;
    // 音频加载失败提示
    audio.addEventListener("error", () => {
      updateSoundControls(false, "音频加载失败");
    });
    // 拖动音量条：实时调节 + 写入 sessionStorage
    if (volumeSlider) {
      volumeSlider.addEventListener("input", () => {
        audio.volume = Number(volumeSlider.value);
        sessionStorage.setItem("liyu-audio-volume", volumeSlider.value);
      });
    }
    // 恢复播放进度(刷新后不从头播)
    const restoreAudioPosition = () => {
      const savedTime = Number(sessionStorage.getItem("liyu-audio-time") || 0);
      if (savedTime > 0 && savedTime < audio.duration - 1) audio.currentTime = savedTime;
      if (audioEnabled) playBackgroundMusic();
    };
    if (audio.readyState >= 1) restoreAudioPosition(); // 元数据已就绪
    else audio.addEventListener("loadedmetadata", restoreAudioPosition, { once: true });
    // 持续记录播放进度
    audio.addEventListener("timeupdate", () => {
      sessionStorage.setItem("liyu-audio-time", String(audio.currentTime));
    });
    // 离开页面前保存进度
    window.addEventListener("pagehide", () => {
      sessionStorage.setItem("liyu-audio-time", String(audio.currentTime));
    });
    // 声音按钮点击：开启则播放，关闭则暂停
    soundButtons.forEach((button) => {
      button.addEventListener("click", () => {
        audioEnabled = audio.paused;
        sessionStorage.setItem("liyu-audio-enabled", String(audioEnabled));
        if (audioEnabled) {
          playBackgroundMusic();
        } else {
          audio.pause();
          updateSoundControls(false);
        }
      });
    });
    // 首次交互(点击 / 按键)后，借自动播放策略尝试续播一次
    document.addEventListener("pointerdown", (event) => {
      if (audioEnabled && audio.paused && !event.target.closest(".sound-toggle")) playBackgroundMusic();
    }, { once: true });
    document.addEventListener("keydown", (event) => {
      if (audioEnabled && audio.paused && !event.target.closest("input, textarea, button, a")) playBackgroundMusic();
    }, { once: true });
  }

  /* ---------- 4. 无刷新翻页(水波过渡 + SPA 式导航，含 file:// 回退) ---------- */
  let navigationVersion = 0;     // 导航版本号，防止并发 / 过时请求误替换
  let activePageRipple = null;   // 当前进行中的水波层
  // 从点击点(origin)展开水波，返回 ready(过渡就绪) 与 finish(收尾) 两个钩子
  const startPageRipple = (origin = {}) => {
    if (reducedMotion) return { ready: Promise.resolve(), finish: () => {} }; // 减弱动效则无动画
    document.querySelectorAll(".page-ripple").forEach((ripple) => ripple.remove()); // 清掉上一个
    const ripple = document.createElement("div");
    ripple.className = "page-ripple";
    ripple.setAttribute("aria-hidden", "true");
    // 水波圆心 = 点击坐标(缺省屏幕中心)
    ripple.style.setProperty("--ripple-x", `${origin.x ?? window.innerWidth / 2}px`);
    ripple.style.setProperty("--ripple-y", `${origin.y ?? window.innerHeight / 2}px`);
    document.body.append(ripple);
    document.documentElement.classList.add("page-transitioning"); // 触发 <main> 淡出模糊
    activePageRipple = ripple;
    return {
      ready: new Promise((resolve) => window.setTimeout(resolve, 240)), // 等水波铺开再换页
      finish: () => {
        if (activePageRipple !== ripple) { ripple.remove(); return; } // 已被更新的导航接管
        activePageRipple = null;
        document.documentElement.classList.remove("page-transitioning");
        window.setTimeout(() => ripple.remove(), 850); // 水波收尾后移除
      }
    };
  };
  // —— file:// 协议特例：本页加载时若有暂存的点击原点，补播一次水波，使跨页跳转仍有过渡感 ——
  if (location.protocol === "file:") {
    const savedOrigin = sessionStorage.getItem("liyu-page-ripple-origin");
    if (savedOrigin) {
      sessionStorage.removeItem("liyu-page-ripple-origin");
      const [x, y] = savedOrigin.split(",").map(Number);
      const ripple = startPageRipple({
        x: Number.isFinite(x) ? x : window.innerWidth / 2,
        y: Number.isFinite(y) ? y : window.innerHeight / 2
      });
      window.setTimeout(ripple.finish, 240);
    }
  }
  // 根据目标 URL 高亮对应导航项(并标注 aria-current)
  const updateActiveNavigation = (url) => {
    document.querySelectorAll(".main-nav a").forEach((link) => {
      const active = new URL(link.href, location.href).pathname === url.pathname;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };
  // 核心：拉取目标页 HTML → 取出 <main> → 就地替换；同步标题 / 导航 / 历史
  const navigateTo = async (url, addHistory = true, origin) => {
    const version = ++navigationVersion; // 标记本次导航
    let ripple;
    try {
      const response = await fetch(url.href, { headers: { "X-Requested-With": "fetch" } });
      if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);
      const nextPage = new DOMParser().parseFromString(await response.text(), "text/html");
      const nextMain = nextPage.querySelector("main");
      const currentMain = document.querySelector("main");
      if (!nextMain || !currentMain) throw new Error("The destination page is missing its main content.");
      if (version !== navigationVersion) return; // 已有更新的导航，放弃本次
      ripple = startPageRipple(origin);
      await ripple.ready;
      if (version !== navigationVersion) { ripple.finish(); return; } // 期间被新导航抢占
      currentMain.replaceWith(nextMain);                 // 无整页刷新的关键：替换主体
      document.title = nextPage.title;
      document.body.classList.toggle("home-page", nextPage.body.classList.contains("home-page"));
      updateActiveNavigation(url);
      document.querySelector(".main-nav")?.classList.remove("open");           // 翻页后收起移动端菜单
      document.querySelector(".menu-toggle")?.setAttribute("aria-expanded", "false");
      if (addHistory) history.pushState({}, "", url.href); // 更新地址栏(不刷新)
      initializePageContent();                            // 重新绑定新页面内的交互
      if (url.hash) {
        // 带锚点：滚动到对应区块
        requestAnimationFrame(() => {
          const anchor = document.getElementById(decodeURIComponent(url.hash.slice(1)));
          if (anchor) anchor.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
        });
      } else {
        window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
      }
      ripple.finish();
    } catch (error) {
      ripple?.finish();
      console.error("Unable to navigate without reloading:", error);
      location.assign(url.href); // 失败回退到原生整页跳转
    }
  };
  // 拦截站内链接的默认跳转，改用无刷新导航(仅限同站 .html、左键、无修饰键)
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self" || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith(".html")) return; // 仅处理站内 html
    if (url.pathname === location.pathname && url.search === location.search) return; // 同页不处理
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY };
    // file:// 下 fetch 受限：先播水波并将原点暂存，再整页跳转(新页加载时补播)
    if (location.protocol === "file:") {
      sessionStorage.setItem("liyu-page-ripple-origin", `${origin.x},${origin.y}`);
      startPageRipple(origin);
      window.setTimeout(() => location.assign(url.href), 240);
      return;
    }
    navigateTo(url, true, origin);
  });
  // 浏览器前进 / 后退：同样走无刷新导航
  window.addEventListener("popstate", () => {
    if (location.protocol !== "file:" && location.pathname.endsWith(".html")) navigateTo(new URL(location.href), false);
  });

  /* ---------- 5. 页面内交互(每次换页后重新初始化) ---------- */
  function initializePageContent() {
    // 5a. 语音诵读(为我诵读)
    let speaking = false;
    document.querySelectorAll(".read-aloud").forEach((button) => {
      button.addEventListener("click", () => {
        if (!("speechSynthesis" in window)) {
          button.textContent = "此浏览器暂不支持语音诵读";
          return;
        }
        if (speaking) window.speechSynthesis.cancel(); // 打断上一段
        const utterance = new SpeechSynthesisUtterance(button.dataset.poem || "");
        utterance.lang = "zh-CN";   // 中文
        utterance.rate = 0.82;      // 稍慢，更接近吟诵
        utterance.onstart = () => { speaking = true; button.textContent = "正在诵读　■"; };
        utterance.onend = () => { speaking = false; button.textContent = "为我诵读　▶"; };
        utterance.onerror = () => { speaking = false; button.textContent = "诵读未能播放，请重试"; };
        window.speechSynthesis.speak(utterance);
      });
    });

    // 5b. 收藏按钮(按索引分别记忆到 localStorage)
    document.querySelectorAll(".favorite-button").forEach((button, index) => {
      const key = `liyu-favorite-${index}`;
      const saved = localStorage.getItem(key) === "true";
      button.setAttribute("aria-pressed", String(saved));
      button.textContent = saved ? "♥ 已收藏" : "♡ 收藏这首";
      button.addEventListener("click", () => {
        const selected = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(selected));
        button.textContent = selected ? "♥ 已收藏" : "♡ 收藏这首";
        localStorage.setItem(key, String(selected));
      });
    });

    // 5c. 字数计数器(心情 / 写句共用)：实时显示 “已输入 / 上限”
    const setupCounter = (fieldId, countId, max) => {
      const field = document.getElementById(fieldId);
      const count = document.getElementById(countId);
      if (!field || !count) return;
      const update = () => { count.textContent = `${field.value.length} / ${max}`; };
      field.addEventListener("input", update);
      update();
    };
    setupCounter("mood", "mood-count", 80);
    setupCounter("my-line", "line-count", 100);

    // 5d. 首页“此刻心情”表单提交
    document.querySelector(".mood-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const field = document.getElementById("mood");
      const feedback = document.querySelector(".mood-feedback");
      if (!field.value.trim()) {
        feedback.textContent = "写下一点心情，再让它随春水而去。";
        field.focus();
        return;
      }
      feedback.textContent = "收到了。愿这份心情，在词里找到回声。";
      field.value = "";
      document.getElementById("mood-count").textContent = "0 / 80";
    });

    // 5e. 互动区：点击提示词直接填入“写一句”
    document.querySelectorAll(".prompt-words button").forEach((button) => {
      button.addEventListener("click", () => {
        const field = document.getElementById("my-line");
        field.value = `${field.value}${button.dataset.prompt}`;
        field.focus();
        field.dispatchEvent(new Event("input", { bubbles: true })); // 触发字数刷新
      });
    });

    // 5f. 互动区“写一句”表单提交
    document.querySelector(".poem-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const field = document.getElementById("my-line");
      const feedback = document.querySelector(".poem-feedback");
      if (!field.value.trim()) {
        feedback.textContent = "先写一句心情，再让花瓣带走它。";
        field.focus();
        return;
      }
      feedback.textContent = `“${field.value.trim()}” —— 已随花瓣飘入词境。`;
      field.value = "";
      document.getElementById("line-count").textContent = "0 / 100";
    });
  }
  initializePageContent(); // 首屏初始化
})();
