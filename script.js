// 一江春水 · 李煜词境 — 交互脚本 script.js
// 主要功能：点击落花特效 / 汉堡菜单 / 背景音乐面板(含本地文件替换) / 语音诵读 / 收藏 / 字数统计 / 心情与写词表单

(() => {
  // 是否开启系统“减弱动效”偏好：开启后跳过落花等动画
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // —— 点击落花特效：在光标处生成 6 片飘落花瓣 ——
  document.addEventListener("click", (event) => {
    // 减弱动效，或在可输入/媒体元素上点击时不触发
    if (reducedMotion || event.target.closest("input, textarea, select, audio, video")) return;
    const x = event.clientX;
    const y = event.clientY;
    // 点击坐标均为 0（键盘触发等）则忽略
    if (!x && !y) return;
    for (let i = 0; i < 6; i += 1) {
      const petal = document.createElement("span");
      petal.className = "petal"; // 花瓣元素（样式见 style.css 的 .petal）
      // 以点击点为中心做小幅随机偏移，避免花瓣完全重叠
      petal.style.left = `${x + (Math.random() - 0.5) * 42}px`;
      petal.style.top = `${y + (Math.random() - 0.5) * 18}px`;
      // 随机横向漂移距离与下落距离，写入 CSS 变量供 @keyframes 使用
      petal.style.setProperty("--drift", `${(Math.random() - 0.5) * 135}px`);
      petal.style.setProperty("--fall", `${90 + Math.random() * 115}px`);
      petal.style.animationDelay = `${Math.random() * 180}ms`; // 错峰出现
      document.body.append(petal);
      // 动画约 2.1s 结束后移除 DOM，避免无限堆积
      window.setTimeout(() => petal.remove(), 2100);
    }
  });

  // —— 汉堡菜单：移动端展开 / 收起主导航抽屉 ——
  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");
  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const open = nav.classList.toggle("open"); // 切换展开 / 收起
      // 同步无障碍状态与文案
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    });
  }

  // —— 背景音乐面板：开合 + 本地文件替换 ——
  const panel = document.querySelector(".audio-panel"); // 音乐面板容器
  // 点击声音开关：切换音乐面板显隐
  document.querySelectorAll(".sound-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      if (panel) panel.hidden = !panel.hidden;
    });
  });
  // 面板内“关闭”按钮：隐藏面板
  document.querySelector(".audio-close")?.addEventListener("click", () => {
    if (panel) panel.hidden = true;
  });
  // 背景音乐元素（兼容 .background-audio 与 #background-audio 两种写法）
  const audio = document.querySelector(".background-audio, #background-audio");
  // 本地音乐文件选择框（兼容 .audio-file 与 #audio-file）
  const fileInput = document.querySelector(".audio-file, #audio-file");
  let audioUrl = null; // 临时 ObjectURL，用于释放
  // 选择本地文件后用 ObjectURL 作为音频源并播放
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file || !audio) return;
    // 释放上一次创建的临时 URL，避免内存泄漏
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file);
    audio.src = audioUrl;
    audio.play().catch(() => {
      audio.controls = true; // 自动播放被拦截时退化为原生控件
    });
  });
  // 离开页面时释放临时 URL
  window.addEventListener("pagehide", () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });

  // —— 语音诵读：用浏览器 SpeechSynthesis 朗读词句 ——
  let speaking = false; // 是否正在朗读（防止多段叠加）
  document.querySelectorAll(".read-aloud").forEach((button) => {
    button.addEventListener("click", () => {
      // 浏览器不支持语音合成时给出提示
      if (!("speechSynthesis" in window)) {
        button.textContent = "此浏览器暂不支持语音诵读";
        return;
      }
      // 正在朗读则先取消上一段
      if (speaking) window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(button.dataset.poem || "");
      utterance.lang = "zh-CN";   // 中文
      utterance.rate = 0.82;      // 稍慢，更接近吟诵
      utterance.onstart = () => {
        speaking = true;
        button.textContent = "正在诵读　■";
      };
      utterance.onend = () => {
        speaking = false;
        button.textContent = "为我诵读　▶";
      };
      utterance.onerror = () => {
        speaking = false;
        button.textContent = "诵读未能播放，请重试";
      };
      window.speechSynthesis.speak(utterance);
    });
  });

  // —— 收藏按钮：用 localStorage 记住每首词的收藏状态 ——
  document.querySelectorAll(".favorite-button").forEach((button, index) => {
    // 以索引区分不同词，保证各自独立记忆
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

  // —— 字数计数器：为心情 / 写词输入框提供 “已输入 / 上限” 实时提示 ——
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

  // —— 心情表单提交：校验非空后给出反馈并清空 ——
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
  // —— 提示词按钮：把预设短句追加进“写一句”输入框 ——
  document.querySelectorAll(".prompt-words button").forEach((button) => {
    button.addEventListener("click", () => {
      const field = document.getElementById("my-line");
      field.value = `${field.value}${button.dataset.prompt}`;
      field.focus();
      // 手动触发 input 事件，刷新字数计数
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  // —— 写词表单提交：校验非空后给出反馈并清空 ——
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
})();
