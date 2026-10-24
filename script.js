(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.addEventListener("click", (event) => {
    if (reducedMotion || event.target.closest("input, textarea, select, audio, video")) return;
    const x = event.clientX;
    const y = event.clientY;
    if (!x && !y) return;
    for (let i = 0; i < 6; i += 1) {
      const petal = document.createElement("span");
      petal.className = "petal";
      petal.style.left = `${x + (Math.random() - 0.5) * 42}px`;
      petal.style.top = `${y + (Math.random() - 0.5) * 18}px`;
      petal.style.setProperty("--drift", `${(Math.random() - 0.5) * 135}px`);
      petal.style.setProperty("--fall", `${90 + Math.random() * 115}px`);
      petal.style.animationDelay = `${Math.random() * 180}ms`;
      document.body.append(petal);
      window.setTimeout(() => petal.remove(), 2100);
    }
  });

  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");
  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    });
  }

  const panel = document.querySelector(".audio-panel");
  document.querySelectorAll(".sound-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      if (panel) panel.hidden = !panel.hidden;
    });
  });
  document.querySelector(".audio-close")?.addEventListener("click", () => {
    if (panel) panel.hidden = true;
  });
  const audio = document.querySelector(".background-audio, #background-audio");
  const fileInput = document.querySelector(".audio-file, #audio-file");
  let audioUrl = null;
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file || !audio) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file);
    audio.src = audioUrl;
    audio.play().catch(() => {
      audio.controls = true;
    });
  });
  window.addEventListener("pagehide", () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });

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
  document.querySelectorAll(".prompt-words button").forEach((button) => {
    button.addEventListener("click", () => {
      const field = document.getElementById("my-line");
      field.value = `${field.value}${button.dataset.prompt}`;
      field.focus();
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
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
