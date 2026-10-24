(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.addEventListener("click", (event) => {
    if (reducedMotion || event.target.closest("input, textarea, select, audio, video")) return;
    const x = event.clientX;
    const y = event.clientY;
    if (!x && !y) return;
    const burst = document.createElement("span");
    burst.className = "petal-burst";
    burst.setAttribute("aria-hidden", "true");
    const particles = [
      ...Array.from({ length: 12 }, () => "petal-particle"),
      ...Array.from({ length: 14 }, () => "spark-particle")
    ];
    particles.forEach((className, index) => {
      const particle = document.createElement("span");
      const isPetal = className === "petal-particle";
      const groupIndex = isPetal ? index : index - 12;
      const groupSize = isPetal ? 12 : 14;
      const angle = (Math.PI * 2 * groupIndex) / groupSize + (Math.random() - 0.5) * 0.36;
      const distance = isPetal ? 12 + Math.random() * 30 : 18 + Math.random() * 50;
      const burstX = Math.cos(angle) * distance;
      const burstY = isPetal ? -10 + Math.random() * 26 : Math.sin(angle) * distance;
      const fall = isPetal ? 145 + Math.random() * 120 : Math.sin(angle) * distance * 0.65;
      const drift = isPetal ? (Math.random() - 0.5) * 105 : 0;
      const spin = Math.random() * 540 - 270;
      particle.className = className;
      particle.style.left = `${x}px`;
      particle.style.top = `${y}px`;
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
    window.setTimeout(() => burst.remove(), 2700);
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

  const audio = document.querySelector(".background-audio");
  const soundButtons = document.querySelectorAll(".sound-toggle");
  const volumeSlider = document.querySelector(".volume-slider");
  let audioEnabled = sessionStorage.getItem("liyu-audio-enabled") !== "false";
  const updateSoundControls = (playing, message) => {
    soundButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", playing ? "关闭背景音乐" : "开启背景音乐");
      const status = button.querySelector(".sound-status");
      if (status) status.textContent = message || (playing ? "音乐开启" : "开启音乐");
    });
  };
  const playBackgroundMusic = () => {
    if (!audio || !audioEnabled) return;
    audio.play().then(() => {
      updateSoundControls(true);
    }).catch(() => {
      updateSoundControls(false, "点击开启");
    });
  };
  if (audio) {
    const savedVolume = sessionStorage.getItem("liyu-audio-volume");
    if (volumeSlider && savedVolume !== null) volumeSlider.value = savedVolume;
    audio.volume = Number(volumeSlider?.value || 0.32);
    audio.muted = false;
    audio.addEventListener("error", () => {
      updateSoundControls(false, "音频加载失败");
    });
    if (volumeSlider) {
      volumeSlider.addEventListener("input", () => {
        audio.volume = Number(volumeSlider.value);
        sessionStorage.setItem("liyu-audio-volume", volumeSlider.value);
      });
    }
    const restoreAudioPosition = () => {
      const savedTime = Number(sessionStorage.getItem("liyu-audio-time") || 0);
      if (savedTime > 0 && savedTime < audio.duration - 1) audio.currentTime = savedTime;
      if (audioEnabled) playBackgroundMusic();
    };
    if (audio.readyState >= 1) restoreAudioPosition();
    else audio.addEventListener("loadedmetadata", restoreAudioPosition, { once: true });
    audio.addEventListener("timeupdate", () => {
      sessionStorage.setItem("liyu-audio-time", String(audio.currentTime));
    });
    window.addEventListener("pagehide", () => {
      sessionStorage.setItem("liyu-audio-time", String(audio.currentTime));
    });
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
    document.addEventListener("pointerdown", (event) => {
      if (audioEnabled && audio.paused && !event.target.closest(".sound-toggle")) playBackgroundMusic();
    }, { once: true });
    document.addEventListener("keydown", (event) => {
      if (audioEnabled && audio.paused && !event.target.closest("input, textarea, button, a")) playBackgroundMusic();
    }, { once: true });
  }

  let navigationVersion = 0;
  const updateActiveNavigation = (url) => {
    document.querySelectorAll(".main-nav a").forEach((link) => {
      const active = new URL(link.href, location.href).pathname === url.pathname;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };
  const navigateTo = async (url, addHistory = true) => {
    const version = ++navigationVersion;
    try {
      const response = await fetch(url.href, { headers: { "X-Requested-With": "fetch" } });
      if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);
      const nextPage = new DOMParser().parseFromString(await response.text(), "text/html");
      const nextMain = nextPage.querySelector("main");
      const currentMain = document.querySelector("main");
      if (!nextMain || !currentMain) throw new Error("The destination page is missing its main content.");
      if (version !== navigationVersion) return;
      currentMain.replaceWith(nextMain);
      document.title = nextPage.title;
      document.body.classList.toggle("home-page", nextPage.body.classList.contains("home-page"));
      updateActiveNavigation(url);
      document.querySelector(".main-nav")?.classList.remove("open");
      document.querySelector(".menu-toggle")?.setAttribute("aria-expanded", "false");
      if (addHistory) history.pushState({}, "", url.href);
      initializePageContent();
      if (url.hash) {
        requestAnimationFrame(() => {
          const anchor = document.getElementById(decodeURIComponent(url.hash.slice(1)));
          if (anchor) anchor.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
        });
      } else {
        window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
      }
    } catch (error) {
      console.error("Unable to navigate without reloading:", error);
      location.assign(url.href);
    }
  };
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self" || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith(".html")) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    if (location.protocol === "file:") return;
    event.preventDefault();
    navigateTo(url);
  });
  window.addEventListener("popstate", () => {
    if (location.protocol !== "file:" && location.pathname.endsWith(".html")) navigateTo(new URL(location.href), false);
  });

  function initializePageContent() {
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
  }
  initializePageContent();
})();
