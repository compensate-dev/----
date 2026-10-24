// ============================================================
// 一江春水 · 李煜词境 — 交互脚本 script.js
// 说明：本文件仅在原脚本基础上新增中文注释，未改动任何逻辑。
// 主要功能：
//   1) 点击花瓣/星火粒子特效   2) 移动端汉堡菜单
//   3) 背景音乐(自动播放/音量/记忆)  4) 无刷新翻页(水波过渡 + SPA 导航)
//   5) 页面内交互(语音诵读/收藏/字数统计/心情表单)
// ============================================================
(() => {
  // 是否开启“减弱动效”：开启则跳过花瓣、水波等动画
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 1. 点击花瓣 / 星火粒子特效 ---------- */
  document.addEventListener("click", (event) => {
    // 减弱动效、或在可输入元素/媒体上点击时，不触发粒子
    if (reducedMotion || event.target.closest("input, textarea, select, audio, video")) return;
    const x = event.clientX;
    const y = event.clientY;
    if (!x && !y) return; // 键盘触发的点击(坐标为0)不处理
    const burst = document.createElement("span");
    burst.className = "petal-burst";
    burst.setAttribute("aria-hidden", "true");
    // 12 片花瓣 + 14 颗星火，混合成一组粒子
    const particles = [
      ...Array.from({ length: 12 }, () => "petal-particle"),
      ...Array.from({ length: 14 }, () => "spark-particle")
    ];
    particles.forEach((className, index) => {
      const particle = document.createElement("span");
      const isPetal = className === "petal-particle";
      const groupIndex = isPetal ? index : index - 12;
      const groupSize = isPetal ? 12 : 14;
      // 在圆周上均匀取角度(花瓣/星火各自一组)，并加随机抖动
      const angle = (Math.PI * 2 * groupIndex) / groupSize + (Math.random() - 0.5) * 0.36;
      const distance = isPetal ? 12 + Math.random() * 30 : 18 + Math.random() * 50;
      const burstX = Math.cos(angle) * distance;                       // 起始爆发横向位移
      const burstY = isPetal ? -10 + Math.random() * 26 : Math.sin(angle) * distance; // 起始爆发纵向位移
      const fall = isPetal ? 145 + Math.random() * 120 : Math.sin(angle) * distance * 0.65; // 最终下落距离
      const drift = isPetal ? (Math.random() - 0.5) * 105 : 0;        // 花瓣横向漂移
      const spin = Math.random() * 540 - 270;                         // 旋转角度
      particle.className = className;
      particle.style.left = `${x}px`;
      particle.style.top = `${y}px`;
      // 把各阶段位移/旋转写入 CSS 变量，供 @keyframes petal-fall / sparkle-fade 读取
      particle.style.setProperty("--burst-x", `${burstX}px`);
      particle.style.setProperty("--burst-y", `${burstY}px`);
      particle.style.setProperty("--mid-x", `${burstX + drift * 0.35}px`);
      particle.style.setProperty("--mid-y", `${burstY + fall * 0.35}px`);
      particle.style.setProperty("--mid-spin", `${spin * 0.45}deg`);
      particle.style.setProperty("--end-x", `${burstX + drift}px`);
      particle.style.setProperty("--end-y", `${burstY + fall}px`);
      particle.style.setProperty("--spin", `${spin}deg`);
      particle.style.setProperty("--delay", `${Math.random() * 120}ms`);
      if (isPetal) {
        const width = 8 + Math.random() * 5;
        particle.style.setProperty("--petal-width", `${width}px`);
        particle.style.animationDuration = `${1.8 + Math.random() * 0.5}s`;
      } else {
        particle.style.setProperty("--spark-size", `${2 + Math.random() * 2.5}px`);
      }
      burst.append(particle);
    });
    document.body.append(burst);
    window.setTimeout(() => burst.remove(), 2700); // 动画结束后清理 DOM
  });

  /* ---------- 2. 移动端汉堡菜单 ---------- */
  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");
  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const open = nav.classList.toggle("open"); // 切换下拉展开/收起
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    });
  }

  /* ---------- 3. 背景音乐：开关 / 音量 / 进度记忆 ---------- */
  const audio = document.querySelector(".background-audio");
  const soundButtons = document.querySelectorAll(".sound-toggle");
  const volumeSlider = document.querySelector(".volume-slider");
  // 用 sessionStorage 记忆开关状态(默认开启)
  let audioEnabled = sessionStorage.getItem("liyu-audio-enabled") !== "false";
  // 同步所有声音按钮的“开启/关闭”视觉与无障碍状态
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
    audio.volume = Number(volumeSlider?.value || 0.32);
    audio.muted = false;
    // 音频加载失败提示
    audio.addEventListener("error", () => {
      updateSoundControls(false, "音频加载失败");
    });
    // 拖动音量条：实时调节 + 记忆
    if (volumeSlider) {
      volumeSlider.addEventListener("input", () => {
        audio.volume = Number(volumeSlider.value);
        sessionStorage.setItem("liyu-audio-volume", volumeSlider.value);
      });
    }
    // 恢复播放进度(避免每次刷新从头播)
    const restoreAudioPosition = () => {
      const savedTime = Number(sessionStorage.getItem("liyu-audio-time") || 0);
      if (savedTime > 0 && savedTime < audio.duration - 1) audio.currentTime = savedTime;
      if (audioEnabled) playBackgroundMusic();
    };
    if (audio.readyState >= 1) restoreAudioPosition();
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
    // 首次交互(点击/按键)后尝试自动续播一次
    document.addEventListener("pointerdown", (event) => {
      if (audioEnabled && audio.paused && !event.target.closest(".sound-toggle")) playBackgroundMusic();
    }, { once: true });
    document.addEventListener("keydown", (event) => {
      if (audioEnabled && audio.paused && !event.target.closest("input, textarea, button, a")) playBackgroundMusic();
    }, { once: true });
  }

  /* ---------- 4. 无刷新翻页(水波过渡 + SPA 导航) ---------- */
  let navigationVersion = 0;     // 导航版本号，防止并发/过时请求误替换
  let activePageRipple = null;   // 当前进行中的水波层
  // 从点击点(origin)展开水波，返回 ready(过渡就绪) 与 finish(收尾) 两个钩子
  const startPageRipple = (origin = {}) => {
    if (reducedMotion) return { ready: Promise.resolve(), finish: () => {} };
    document.querySelectorAll(".page-ripple").forEach((ripple) => ripple.remove());
    const ripple = document.createElement("div");
    ripple.className = "page-ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.setProperty("--ripple-x", `${origin.x ?? window.innerWidth / 2}px`);
    ripple.style.setProperty("--ripple-y", `${origin.y ?? window.innerHeight / 2}px`);
    document.body.append(ripple);
    document.documentElement.classList.add("page-transitioning"); // 触发主体淡出
    activePageRipple = ripple;
    return {
      ready: new Promise((resolve) => window.setTimeout(resolve, 240)), // 等水波铺开
      finish: () => {
        if (activePageRipple !== ripple) { ripple.remove(); return; }
        activePageRipple = null;
        document.documentElement.classList.remove("page-transitioning");
        window.setTimeout(() => ripple.remove(), 850); // 水波收尾后移除
      }
    };
  };
  // 根据当前 URL 高亮对应导航项
  const updateActiveNavigation = (url) => {
    document.querySelectorAll(".main-nav a").forEach((link) => {
      const active = new URL(link.href, location.href).pathname === url.pathname;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };
  // 核心：拉取目标页 HTML，替换 <main>，并同步标题/导航/历史记录
  const navigateTo = async (url, addHistory = true, origin) => {
    const version = ++navigationVersion;
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
      if (version !== navigationVersion) { ripple.finish(); return; }
      currentMain.replaceWith(nextMain);                 // 就地替换主体，无整页刷新
      document.title = nextPage.title;
      document.body.classList.toggle("home-page", nextPage.body.classList.contains("home-page"));
      updateActiveNavigation(url);
      document.querySelector(".main-nav")?.classList.remove("open");           // 翻页后收起移动端菜单
      document.querySelector(".menu-toggle")?.setAttribute("aria-expanded", "false");
      if (addHistory) history.pushState({}, "", url.href);
      initializePageContent();                            // 重新绑定新页面内的交互
      if (url.hash) {
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
      location.assign(url.href); // 失败时回退到原生整页跳转
    }
  };
  // 拦截站内链接的默认跳转，改用无刷新导航(仅限同站 .html 链接、非修饰键)
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self" || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith(".html")) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    if (location.protocol === "file:") return; // file:// 下 fetch 受限，退回普通跳转
    event.preventDefault();
    navigateTo(url, true, { x: event.clientX, y: event.clientY });
  });
  // 浏览器前进/后退：同样走无刷新导航
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
        if (speaking) window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(button.dataset.poem || "");
        utterance.lang = "zh-CN";
        utterance.rate = 0.82;
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

    // 5c. 字数计数器(心情/写句共用)
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
