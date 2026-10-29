// 全站交互总入口：整体包在一个立即执行函数里，避免向全局暴露变量。
// 各功能块按需自检元素是否存在，同一份脚本可被所有页面共用而互不打扰。
// 全站音频过渡工具：背景音乐、封面序曲与终幕配乐共用
// fadeTo 负责音量缓动（播放/暂停/交接时不出现突兀的断点）；
// createLoopingPlayer 用两条同源音轨在循环交界处交叉淡化，让长曲反复播放也听不出接缝。
(() => {
  const fades = new WeakMap();
  const players = new WeakMap();
  const clamp = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

  const fadeTo = (element, target, duration = 900) => {
    if (!element) return Promise.resolve();
    const to = clamp(target);
    const running = fades.get(element);
    if (running) {
      window.clearInterval(running.timer);
      fades.delete(element);
      running.resolve();
    }
    const from = clamp(element.volume);
    if (!(duration > 0) || Math.abs(to - from) < 0.004) {
      element.volume = to;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const startedAt = performance.now();
      const timer = window.setInterval(() => {
        const progress = Math.min(1, (performance.now() - startedAt) / duration);
        const eased = progress * progress * (3 - 2 * progress); // smoothstep，起落更柔
        element.volume = from + (to - from) * eased;
        if (progress < 1) return;
        window.clearInterval(timer);
        fades.delete(element);
        element.volume = to;
        resolve();
      }, 40);
      // 用定时器而非 rAF：标签页切到后台时音量过渡也能走完，不会停在半途
      fades.set(element, { timer, resolve });
    });
  };

  const createLoopingPlayer = (primary, options = {}) => {
    if (!primary) return null;
    const crossfade = Math.max(0, Number(options.crossfade) || 0);
    const source = primary.currentSrc || primary.src;
    primary.loop = false;
    primary.removeAttribute("loop");

    let active = primary;
    let standby = null;
    let target = clamp(primary.volume);
    let playing = false;
    let switching = false;
    let generation = 0;
    const timeListeners = [];

    // 备用音轨按需创建：临近循环点才加载，避免每次进站都预载整段音轨
    const ensureStandby = () => {
      if (standby) return standby;
      standby = new Audio(source);
      standby.preload = "auto";
      standby.volume = 0;
      standby.addEventListener("timeupdate", handleTime);
      standby.addEventListener("ended", handleEnded);
      return standby;
    };

    const crossfadeLoop = () => {
      switching = true;
      const token = generation;
      const next = ensureStandby();
      next.pause();
      next.currentTime = 0;
      next.volume = 0;
      const started = next.play();
      if (started && typeof started.catch === "function") started.catch(() => {});
      fadeTo(next, target, crossfade * 1000);
      fadeTo(active, 0, crossfade * 1000).then(() => {
        if (token !== generation || !playing) {
          switching = false;
          next.pause();
          return;
        }
        const finished = active;
        active = next;
        standby = finished;
        finished.pause();
        finished.currentTime = 0;
        finished.volume = 0;
        active.volume = target;
        switching = false;
      });
    };

    function handleTime() {
      if (!playing) return;
      const element = active;
      timeListeners.forEach((callback) => callback(element));
      if (switching || crossfade <= 0) return;
      const duration = element.duration;
      if (!Number.isFinite(duration) || duration < crossfade * 2.2) return;
      if (duration - element.currentTime <= crossfade) crossfadeLoop();
    }

    function handleEnded(event) {
      // 时长信息缺失导致没来得及交叉淡化时兜底：直接从下一段开头轻接上
      if (!playing || switching || event.target !== active) return;
      const next = ensureStandby();
      next.currentTime = 0;
      next.volume = 0;
      const started = next.play();
      if (started && typeof started.catch === "function") started.catch(() => {});
      fadeTo(next, target, 800);
      const finished = active;
      active = next;
      standby = finished;
      finished.volume = 0;
      active.volume = target;
    }

    primary.addEventListener("timeupdate", handleTime);
    primary.addEventListener("ended", handleEnded);

    const player = {
      play({ fade = 2400, restart = false } = {}) {
        if (playing && !active.paused) {
          if (!switching && active.volume < target) fadeTo(active, target, fade);
          return Promise.resolve();
        }
        generation += 1;
        playing = true;
        if (restart) active.currentTime = 0;
        active.volume = 0;
        const started = active.play();
        const ramp = () => {
          if (playing) fadeTo(active, target, fade);
        };
        if (started && typeof started.then === "function") {
          return started.then(ramp).catch((error) => {
            playing = false;
            throw error;
          });
        }
        ramp();
        return Promise.resolve();
      },
      pause({ fade = 900 } = {}) {
        generation += 1;
        const token = generation;
        playing = false;
        switching = false;
        const elements = [active, standby].filter(Boolean);
        return Promise.all(elements.map((element) => fadeTo(element, 0, fade))).then(() => {
          // 淡出途中若用户又点了开启（或再次暂停），交给最新一次操作收尾
          if (token !== generation) return;
          elements.forEach((element) => element.pause());
          active.volume = target;
          if (standby) standby.volume = 0;
        });
      },
      setVolume(value) {
        target = clamp(value);
        if (!playing) {
          active.volume = target;
          return;
        }
        if (!switching) fadeTo(active, target, 240);
      },
      seek(value) {
        if (active) active.currentTime = Math.max(0, value);
      },
      currentTime() {
        return active ? active.currentTime : 0;
      },
      isPlaying() {
        return playing;
      },
      onTime(callback) {
        timeListeners.push(callback);
      }
    };
    players.set(primary, player);
    return player;
  };

  // 离场淡出：交给播放器暂停，正在发声的那条音轨（含循环切换后的备用轨）都会淡出
  const fadeOut = (primary, duration = 400) => {
    const player = primary ? players.get(primary) : null;
    if (player) return player.pause({ fade: duration });
    return fadeTo(primary, 0, duration).then(() => primary?.pause());
  };

  window.liyuAudio = { fadeTo, fadeOut, clamp, createLoopingPlayer };
})();

(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 资源基址：script.js 位于 js/，会被根页面与 pages/ 子页共同引用；
  // 动态图片路径按脚本自身 URL 推导，避免相对页面 URL 在子页里解析失败（file:// 同样适用）
  const ASSET_IMAGE = new URL("../assets/image/", document.currentScript.src).href;
  // 点击互动可用的书法字条（assets/image 下的竖排透明字）
  const CLICK_GLYPHS = ["01", "02", "03", "04", "06", "08", "09", "11"];
  // 页面加载完成后闲时预载，避免首次点击时字条延迟出现（字条互动仅首页使用）
  if (document.body.classList.contains("home-page")) {
    window.addEventListener("load", () => {
      CLICK_GLYPHS.forEach((id) => { const img = new Image(); img.src = `${ASSET_IMAGE}calligraphy-added-${id}.png`; });
    });
  }

  document.addEventListener("click", (event) => {
    if (reducedMotion || event.target.closest("input, textarea, select, audio, video")) return;
    const link = event.target.closest("a[href]");
    if (link) {
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && url.pathname.endsWith(".html")
        && (url.pathname !== location.pathname || url.search !== location.search)) return;
    }
    const ripple = document.createElement("span");
    ripple.className = "click-ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.setProperty("--ripple-x", `${event.clientX}px`);
    ripple.style.setProperty("--ripple-y", `${event.clientY}px`);
    document.body.append(ripple);
    window.setTimeout(() => ripple.remove(), 1100);

    // 墨晕与书法字条仅属于首页叙事体验，其他页面保持原有点击反馈
    if (!document.body.classList.contains("home-page")) return;

    // 墨点晕染：一小团淡墨自落点散开，似笔落宣纸
    const ink = document.createElement("span");
    ink.className = "click-ink";
    ink.setAttribute("aria-hidden", "true");
    ink.style.setProperty("--ink-x", `${event.clientX}px`);
    ink.style.setProperty("--ink-y", `${event.clientY}px`);
    document.body.append(ink);
    window.setTimeout(() => ink.remove(), 1500);

    // 书法字条浮出：随机一列词中字自落点升起、缓缓散去
    const glyph = document.createElement("img");
    glyph.className = "click-glyph";
    glyph.src = `${ASSET_IMAGE}calligraphy-added-${CLICK_GLYPHS[Math.floor(Math.random() * CLICK_GLYPHS.length)]}.png`;
    glyph.alt = "";
    glyph.setAttribute("aria-hidden", "true");
    glyph.style.setProperty("--glyph-x", `${event.clientX}px`);
    glyph.style.setProperty("--glyph-y", `${event.clientY}px`);
    glyph.style.setProperty("--glyph-rot", `${(Math.random() * 10 - 5).toFixed(1)}deg`);
    glyph.style.setProperty("--glyph-drift", `${(Math.random() * 40 - 20).toFixed(0)}px`);
    document.body.append(glyph);
    window.setTimeout(() => glyph.remove(), 2200);
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
  const introAudio = document.querySelector(".intro-audio");
  const soundButtons = document.querySelectorAll(".sound-toggle");
  const volumeSlider = document.querySelector(".volume-slider");
  let audioEnabled = sessionStorage.getItem("liyu-audio-enabled") !== "false";
  // 封面入场尚未完成时，背景音乐不自动播放，等待音频一（intro-audio）结束后接续
  const coverIntroPending = Boolean(document.querySelector(".book-opening")) && sessionStorage.getItem("liyu-home-intro-completed-v2") !== "true";
  const updateSoundControls = (playing, message) => {
    soundButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", playing ? "关闭背景音乐" : "开启背景音乐");
      const status = button.querySelector(".sound-status");
      if (status) status.textContent = message || (playing ? "音乐开启" : "开启音乐");
    });
  };
  const musicVolume = () => Number(volumeSlider?.value ?? 0.32);
  // 背景音乐交由脚本接管：进站淡入、暂停淡出、循环交界交叉淡化
  const music = audio ? window.liyuAudio.createLoopingPlayer(audio, { crossfade: 3.2 }) : null;
  const startBackgroundMusic = () => {
    if (!music || !audioEnabled) return;
    music.play({ fade: 2600 }).then(() => {
      updateSoundControls(true);
    }).catch(() => {
      updateSoundControls(false, "点击开启");
    });
  };
  if (music) {
    // 关掉浏览器原生自动播放，统一从 0 音量淡入，避免一进页面就骤然出声
    audio.autoplay = false;
    audio.removeAttribute("autoplay");
    const savedVolume = sessionStorage.getItem("liyu-audio-volume");
    if (volumeSlider && savedVolume !== null) volumeSlider.value = savedVolume;
    music.setVolume(musicVolume());
    audio.muted = false;
    updateSoundControls(false, audioEnabled ? "点击开启" : "音乐关闭");
    audio.addEventListener("error", () => {
      updateSoundControls(false, "音频加载失败");
    });
    if (volumeSlider) {
      volumeSlider.addEventListener("input", () => {
        const value = Number(volumeSlider.value);
        music.setVolume(value);
        if (introAudio && !introAudio.paused) window.liyuAudio.fadeTo(introAudio, introVolume(value), 240);
        sessionStorage.setItem("liyu-audio-volume", volumeSlider.value);
      });
    }
    const restoreAudioPosition = () => {
      const savedTime = Number(sessionStorage.getItem("liyu-audio-time") || 0);
      if (savedTime > 0 && savedTime < (audio.duration || 0) - 1) music.seek(savedTime);
      if (audioEnabled && !coverIntroPending) startBackgroundMusic();
    };
    if (audio.readyState >= 1) restoreAudioPosition();
    else audio.addEventListener("loadedmetadata", restoreAudioPosition, { once: true });
    music.onTime((element) => {
      sessionStorage.setItem("liyu-audio-time", String(element.currentTime));
    });
    window.addEventListener("pagehide", () => {
      sessionStorage.setItem("liyu-audio-time", String(music.currentTime()));
    });
    soundButtons.forEach((button) => {
      button.addEventListener("click", () => {
        audioEnabled = !music.isPlaying();
        sessionStorage.setItem("liyu-audio-enabled", String(audioEnabled));
        if (audioEnabled) {
          startBackgroundMusic();
        } else {
          music.pause({ fade: 900 }).then(() => updateSoundControls(false));
        }
      });
    });
    document.addEventListener("pointerdown", (event) => {
      if (audioEnabled && !coverIntroPending && !music.isPlaying() && !event.target.closest(".sound-toggle") && !event.target.closest(".book-opening")) startBackgroundMusic();
    }, { once: true });
    document.addEventListener("keydown", (event) => {
      if (audioEnabled && !coverIntroPending && !music.isPlaying() && !event.target.closest("input, textarea, button, a")) startBackgroundMusic();
    }, { once: true });
  }
  // 音频一：封面点击后淡入，结束前与背景音乐交叉淡化接续
  const introVolume = (volume = musicVolume()) => Math.min(1, volume * 1.4);
  let introPlaying = false;
  let introHandingOff = false;
  const startIntroAudio = () => {
    if (!introAudio) {
      startBackgroundMusic();
      return;
    }
    introPlaying = true;
    introAudio.volume = 0;
    const fadeIntroIn = () => window.liyuAudio.fadeTo(introAudio, introVolume(), 1400);
    try {
      const playPromise = introAudio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.then(fadeIntroIn).catch(() => {
          introPlaying = false;
          startBackgroundMusic();
        });
      } else {
        fadeIntroIn();
      }
    } catch (error) {
      introPlaying = false;
      startBackgroundMusic();
    }
  };
  if (introAudio && !introAudio.dataset.introBound) {
    introAudio.dataset.introBound = "1";
    introAudio.addEventListener("timeupdate", () => {
      if (!introPlaying || introHandingOff) return;
      const remaining = introAudio.duration - introAudio.currentTime;
      if (!Number.isFinite(remaining) || remaining > 2.6) return;
      introHandingOff = true;
      introPlaying = false;
      // 序曲尾音淡出，背景音乐同时从零淡入，两段声音交叠而不留空拍
      window.liyuAudio.fadeTo(introAudio, 0, remaining * 1000 + 200);
      startBackgroundMusic();
    });
    introAudio.addEventListener("ended", () => {
      introPlaying = false;
      if (!introHandingOff) startBackgroundMusic();
    });
  }

  // 首页 hero 云雾：脱离首屏裁剪，以半速慢移越过边界，飘入第二部分（他把无常，写成了永恒）后消散
  (() => {
    const stage = document.querySelector(".cloud-stage");
    const hero = document.querySelector(".hero");
    const intro = document.querySelector(".intro");
    if (!stage || !hero) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let ticking = false;
    const measure = () => {
      stage.style.setProperty("--hero-h", `${hero.offsetHeight}px`);
    };
    const updateClouds = () => {
      ticking = false;
      const heroH = hero.offsetHeight;
      const introH = intro ? intro.offsetHeight : 0;
      const scroll = Math.min(heroH + introH, Math.max(0, -hero.getBoundingClientRect().top));
      if (reduce) {
        // 降级：云雾静止在首屏底部，随页面文档正常滚走，不做慢移与消散
        stage.style.setProperty("--cloud-ty", "0px");
        stage.style.setProperty("--cloud-tx", "0px");
        stage.style.setProperty("--cloud-fade", "0");
        return;
      }
      // 纵向：只以页面一半的速度上升，视觉上云雾滞留并飘入第二部分
      const ty = scroll * 0.5;
      // 消散区间：首屏滚过 62% 开始变淡，进入 intro 后散尽（窄屏区间更长）
      const fadeStart = heroH * 0.62;
      const fadeEnd = heroH + introH * (window.innerWidth <= 700 ? 0.55 : 0.42);
      const fadeRaw = Math.min(1, Math.max(0, (scroll - fadeStart) / Math.max(1, fadeEnd - fadeStart)));
      const fade = fadeRaw * fadeRaw * (3 - 2 * fadeRaw); // smoothstep
      // 行进中持续向两侧外飘，消散时再散开一些
      const travel = Math.min(1, scroll / heroH);
      const tx = travel * 34 + fade * 30;
      stage.style.setProperty("--cloud-ty", `${ty.toFixed(1)}px`);
      stage.style.setProperty("--cloud-tx", `${tx.toFixed(1)}px`);
      stage.style.setProperty("--cloud-fade", fade.toFixed(3));
    };
    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateClouds);
    };
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", () => { measure(); requestUpdate(); });
    measure();
    updateClouds();
  })();

  // 内页首屏「故事画」式钉合：首屏吸顶期间，下一区块从视口底上浮到顶的过程记为 0→1，
  // 写入 --hero-p 驱动视频慢推与标题褪色；reduced-motion 下不启用（CSS 自动恢复静态）
  (() => {
    const stages = Array.from(document.querySelectorAll(".subhero-stage"));
    if (!stages.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let ticking = false;
    const updateStages = () => {
      ticking = false;
      const vh = window.innerHeight || 1;
      stages.forEach((stage) => {
        const hero = stage.querySelector(".subhero");
        const cover = hero?.nextElementSibling;
        if (!hero || !cover) return;
        const top = cover.getBoundingClientRect().top;
        const p = Math.min(1, Math.max(0, 1 - top / vh));
        hero.style.setProperty("--hero-p", p.toFixed(4));
      });
    };
    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateStages);
    };
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    updateStages();
  })();

  // 词容万象「书影流转」3D 轮播（coverflow）：默认静态网格兜底，加 .media-deck-3d 启用 3D；
  // 滚入视口先叠摞再铺开入场；空闲自动流转（悬停/详情弹窗/页面隐藏时停摆）；桌面悬浮微倾+中心卡内部视差；
  // 鼠标与触摸拖拽均可翻页；键盘左右、箭头圆钮、点侧卡聚焦（捕获拦截），点中心卡交给大图弹窗
  (() => {
    const carousel = document.querySelector(".media-carousel");
    if (!carousel) return;
    const deck = carousel.querySelector(".media-deck");
    const slides = Array.from(deck.querySelectorAll(".media-slide"));
    const caps = Array.from(carousel.querySelectorAll(".media-carousel-info .media-caption"));
    const counter = carousel.querySelector(".media-carousel-count b");
    const storyDialog = document.querySelector(".memory-story-dialog");
    const n = slides.length;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      caps.forEach((cap) => cap.classList.add("is-active"));
      return;
    }
    carousel.classList.add("carousel-ready");
    deck.classList.add("media-deck-3d");
    let cur = 0;
    let started = false;
    const layout = (p) => {
      p = p || 0; // p 为拖拽跟手的连续偏移量（约 -1~1），0 即静止吸附态
      const w = slides[0].offsetWidth || 250; // 未变换布局宽度：getBoundingClientRect 会带 3D 投影，导致不同卡居中时铺开形态不一
      slides.forEach((slide, i) => {
        let d = ((i - cur) % n + n) % n;
        if (d > n / 2) d -= n;
        const t = d - p;
        slide.style.zIndex = String(20 - Math.round(Math.abs(t) * 4));
        slide.style.transform = "translateX(" + (t * w * 0.76).toFixed(1) + "px) translateZ(" + (-Math.abs(t) * 120).toFixed(1) + "px) rotateY(" + (-t * 32).toFixed(1) + "deg) scale(" + Math.max(.6, 1 - Math.abs(t) * .08).toFixed(3) + ")";
        slide.classList.toggle("is-center", d === 0 && !p);
      });
      caps.forEach((cap, i) => cap.classList.toggle("is-active", i === cur));
      if (counter) {
        counter.textContent = String(cur + 1).padStart(2, "0");
        counter.animate([{ opacity: 0, transform: "translateY(7px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "ease-out" });
      }
    };
    // 空闲自动流转：悬停、详情弹窗开启、页面隐藏时停摆，任何交互后重新计时
    let autoTimer = 0;
    const stopAuto = () => { if (autoTimer) { clearInterval(autoTimer); autoTimer = 0; } };
    const startAuto = () => {
      if (autoTimer || !started) return;
      autoTimer = setInterval(() => {
        if (document.hidden || deck.matches(":hover") || (storyDialog && storyDialog.open)) return;
        go(1);
      }, 5200);
    };
    const bumpAuto = () => { stopAuto(); startAuto(); };
    const go = (dir) => { cur = (cur + dir + n) % n; layout(); ritual(dir); };
    // 切换仪式：一句词自中心卡右侧竖排升起飘散，几粒淡墨朝翻页方向迸落（词与四图意境对应）
    const VERSES = ["往事已成空 还如一梦中", "寻春须是先春早 看花莫待花枝老", "帘外雨潺潺 春意阑珊", "世事漫随流水 算来一梦浮生"];
    const ritual = (dir) => {
      let verse = deck.querySelector(".media-verse-float");
      if (!verse) {
        verse = document.createElement("span");
        verse.className = "media-verse-float";
        verse.setAttribute("aria-hidden", "true");
        deck.appendChild(verse);
      }
      verse.classList.remove("is-rising");
      void verse.offsetWidth;
      verse.textContent = VERSES[cur] || "";
      verse.classList.add("is-rising");
      const burst = document.createElement("span");
      burst.className = "media-ink-burst is-bursting";
      burst.setAttribute("aria-hidden", "true");
      const spread = dir > 0 ? -1 : 1;
      for (let k = 0; k < 9; k++) {
        const dot = document.createElement("i");
        dot.style.setProperty("--mx", (spread * (46 + Math.random() * 104)).toFixed(0) + "px");
        dot.style.setProperty("--my", (-34 + Math.random() * 88).toFixed(0) + "px");
        dot.style.animationDelay = (Math.random() * .12).toFixed(2) + "s";
        burst.appendChild(dot);
      }
      deck.appendChild(burst);
      setTimeout(() => burst.remove(), 1400);
    };
    // 入场：先把四张叠摞成一摞，滚入视口后再铺开成 coverflow
    slides.forEach((slide, i) => {
      slide.style.zIndex = String(20 - i);
      slide.style.transform = "translateX(0) translateZ(0) rotateY(0deg) scale(1)";
    });
    const revealIO = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      revealIO.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        started = true;
        layout();
        ritual(1);
        startAuto();
      }));
    }, { threshold: 0.3 });
    revealIO.observe(deck);
    if (storyDialog) storyDialog.addEventListener("close", bumpAuto);
    // 鼠标/触摸拖拽跟手：卡片实时随位移流转，松手按位移+甩动速度弹性吸附（可甩页/回弹/连拖）
    let dragX = 0, dragP = 0, dragging = false, dragged = false, lastX = 0, lastT = 0, vel = 0;
    deck.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary) return;
      dragX = lastX = event.clientX; lastT = performance.now(); vel = 0; dragP = 0;
      dragging = true;
    });
    deck.addEventListener("pointermove", (event) => {
      if (!dragging || !event.isPrimary) return;
      const dx = event.clientX - dragX;
      const now = performance.now();
      if (now > lastT) vel = (event.clientX - lastX) / (now - lastT);
      lastX = event.clientX; lastT = now;
      if (!dragged && Math.abs(dx) > 6) {
        dragged = true;
        deck.classList.add("is-dragging");
      }
      if (dragged) {
        dragP = -dx / ((slides[0].offsetWidth || 250) * 0.76);
        layout(dragP);
      }
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (!dragged) return;
      deck.classList.remove("is-dragging");
      const flip = dragP > 0.32 || (dragP > 0.08 && vel < -0.45) ? 1 : dragP < -0.32 || (dragP < -0.08 && vel > 0.45) ? -1 : 0;
      if (flip) {
        cur = (cur + flip + n) % n;
        dragX = lastX; dragP = 0;
        layout(); ritual(flip); bumpAuto();
      } else layout();
      setTimeout(() => { dragged = false; }, 60);
    };
    deck.addEventListener("pointerup", endDrag);
    deck.addEventListener("pointercancel", endDrag);
    deck.addEventListener("click", (event) => {
      if (dragged) { event.stopPropagation(); event.preventDefault(); }
    }, true);
    carousel.querySelectorAll(".media-nav").forEach((btn) => btn.addEventListener("click", () => { go(Number(btn.dataset.dir)); bumpAuto(); }));
    deck.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); bumpAuto(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); go(1); bumpAuto(); }
    });
    slides.forEach((slide, i) => {
      slide.addEventListener("click", (event) => {
        if (i === cur) return;
        event.stopPropagation(); event.preventDefault();
        const prev = cur;
        cur = i; layout(); ritual(i > prev ? 1 : -1); bumpAuto();
      }, true);
    });
    // 桌面悬浮：书案随指针微倾，中心卡画面反向轻移（画中人望向指针）
    if (window.matchMedia("(hover:hover) and (pointer:fine)").matches) {
      let tiltRaf = 0, px = 0.5, py = 0.5;
      const applyTilt = () => {
        tiltRaf = 0;
        deck.style.transform = "rotateX(" + ((0.5 - py) * 4.6).toFixed(2) + "deg) rotateY(" + ((px - 0.5) * 6.4).toFixed(2) + "deg)";
        const img = slides[cur].querySelector("img");
        if (img) img.style.transform = "translate(" + ((0.5 - px) * 8).toFixed(1) + "px," + ((0.5 - py) * 6).toFixed(1) + "px)";
      };
      deck.addEventListener("pointermove", (event) => {
        if (event.pointerType !== "mouse") return;
        const rect = deck.getBoundingClientRect();
        px = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        py = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        if (!tiltRaf) tiltRaf = requestAnimationFrame(applyTilt);
      });
      deck.addEventListener("pointerleave", (event) => {
        if (event.pointerType !== "mouse") return;
        deck.classList.add("tilt-return");
        deck.style.transform = "";
        const img = slides[cur].querySelector("img");
        if (img) img.style.transform = "";
      });
      deck.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") deck.classList.remove("tilt-return");
      });
    }
    window.addEventListener("resize", () => { if (started) layout(); });
  })();

  // 书影流转区滚动视差：按区块进出视口进度写 --glide-p（0=刚进，1=将出），
  // 驱动巨字「影」/轮播/标题三层差速漂移；reduced-motion 不启用，CSS 走静态默认值
  (() => {
    const zone = document.querySelector(".screen-world");
    if (!zone) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = zone.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
      zone.style.setProperty("--glide-p", p.toFixed(4));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  })();

  // 两山开合：按各区块（ci 词作笺赏 / index 词牌卡 / wanxiang 记忆卡）进出视口进度
  // 各自写 --part-p（0=刚进，1=将出），驱动山影向两侧退开、渐隐消散；
  // reduced-motion 不启用，山影保持静态
  (() => {
    const zones = Array.from(document.querySelectorAll(".works, .feature-section, .memory-section, .finale-gate"));
    if (!zones.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("part-js");
    if (window.matchMedia("(pointer: fine)").matches) {
      let pRaf = 0, gx = 0, gy = 0;
      const writeG = () => {
        pRaf = 0;
        document.documentElement.style.setProperty("--part-px", gx.toFixed(3));
        document.documentElement.style.setProperty("--part-py", gy.toFixed(3));
      };
      window.addEventListener("pointermove", (event) => {
        gx = (event.clientX / window.innerWidth) * 2 - 1;
        gy = (event.clientY / window.innerHeight) * 2 - 1;
        if (!pRaf) pRaf = requestAnimationFrame(writeG);
      }, { passive: true });
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight || 1;
      for (const zone of zones) {
        const rect = zone.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
        zone.style.setProperty("--part-p", p.toFixed(4));
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  })();

  const bookOpening = document.querySelector(".book-opening");
  const bookOpenButton = document.querySelector(".book-open-button");
  const calligraphySequence = document.querySelector(".calligraphy-sequence");
  (() => {
    const host = document.querySelector(".calligraphy-inkmotes");
    if (!host || host.dataset.motesBound) return;
    host.dataset.motesBound = "1";
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    const context = canvas.getContext("2d");
    if (!context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    const resize = () => {
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const motes = [];
    const moteCount = window.innerWidth < 700 ? 16 : 30;
    for (let i = 0; i < moteCount; i++) {
      motes.push({
        x: Math.random(),
        y: 1 + Math.random() * 1.4,
        speed: 0.07 + Math.random() * 0.08,
        drift: (Math.random() < 0.5 ? -1 : 1) * (0.035 + Math.random() * 0.075),
        swirl: 0.35 + Math.random() * 0.85,
        phase: Math.random() * Math.PI * 2,
        size: (1.2 + Math.random() * 1.9) * (Math.random() < 0.12 ? 1.9 : 1),
        trail: []
      });
    }
    let last = performance.now();
    let frameIndex = 0;
    const stepInkMotes = (now) => {
      requestAnimationFrame(stepInkMotes);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      frameIndex += 1;
      if (!calligraphySequence.classList.contains("is-active")) return;
      context.clearRect(0, 0, width, height);
      motes.forEach((mote) => {
        mote.y -= mote.speed * dt;
        mote.phase += mote.swirl * dt;
        if (mote.y < -0.06) {
          mote.y = 1.06;
          mote.x = Math.random();
          mote.trail.length = 0;
        }
        const px = (mote.x + Math.sin(mote.phase) * mote.drift) * width;
        const py = mote.y * height;
        if (frameIndex % 2 === 0) {
          mote.trail.push([px, py]);
          if (mote.trail.length > 44) mote.trail.shift();
        }
        context.lineCap = "round";
        for (let t = 1; t < mote.trail.length; t++) {
          const k = t / mote.trail.length;
          context.beginPath();
          context.moveTo(mote.trail[t - 1][0], mote.trail[t - 1][1]);
          context.lineTo(mote.trail[t][0], mote.trail[t][1]);
          context.strokeStyle = `rgba(16,28,22,${(0.5 * k * k).toFixed(3)})`;
          context.lineWidth = Math.max(mote.size * 0.9 * k, 0.4);
          context.stroke();
        }
        const gradient = context.createRadialGradient(px - mote.size * 0.2, py - mote.size * 0.25, mote.size * 0.15, px, py, mote.size);
        gradient.addColorStop(0, "rgba(50,66,56,.95)");
        gradient.addColorStop(0.62, "rgba(12,20,16,.94)");
        gradient.addColorStop(1, "rgba(12,20,16,.3)");
        context.beginPath();
        context.fillStyle = gradient;
        context.arc(px, py, mote.size, 0, Math.PI * 2);
        context.fill();
      });
    };
    requestAnimationFrame(stepInkMotes);
  })();
  if (bookOpening && bookOpenButton && calligraphySequence) {
    const introStorageKey = "liyu-home-intro-completed-v2";
    const calligraphyBackground = calligraphySequence.querySelector(".calligraphy-background");
    const inkInterlude = document.querySelector(".ink-interlude");
    const arrivalInterlude = document.querySelector(".arrival-interlude");
    const arrivalTrack = arrivalInterlude?.querySelector(".arrival-track");
    const arrivalScroller = arrivalInterlude?.querySelector(".arrival-scroller");
    const arrivalEnterButton = arrivalInterlude?.querySelector(".arrival-enter-button");
    const arrivalSkipButton = arrivalInterlude?.querySelector(".arrival-skip-button");
    const arrivalChapterButtons = arrivalInterlude?.querySelectorAll("[data-arrival-scene]");
    const arrivalStage = arrivalInterlude?.querySelector(".arrival-stage");
    const arrivalInkWash = arrivalInterlude?.querySelector(".arrival-ink-wash");
    const inkCanvas = inkInterlude?.querySelector(".ink-canvas");
    const inkContext = inkCanvas?.getContext("2d");
    const prepareArrivalCopy = () => {
      arrivalInterlude?.querySelectorAll(".arrival-copy h1, .arrival-copy h2, .arrival-copy p, .arrival-whisper").forEach((element) => {
        if (element.dataset.glyphsPrepared === "true") return;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        let glyphIndex = 0;
        textNodes.forEach((textNode) => {
          const fragment = document.createDocumentFragment();
          for (const character of textNode.textContent) {
            if (/\s/.test(character)) {
              fragment.append(document.createTextNode(character));
              continue;
            }
            const glyph = document.createElement("span");
            glyph.className = "arrival-glyph";
            glyph.textContent = character;
            glyph.style.setProperty("--glyph-index", String(glyphIndex));
            fragment.append(glyph);
            glyphIndex += 1;
          }
          textNode.replaceWith(fragment);
        });
        element.style.setProperty("--glyph-count", String(glyphIndex));
        element.dataset.glyphsPrepared = "true";
      });
    };
    const spawnArrivalMotes = () => {
      const motesLayer = arrivalInterlude?.querySelector(".arrival-motes");
      if (!motesLayer || reducedMotion) return;
      const count = window.matchMedia("(max-width:700px)").matches ? 26 : 52;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i += 1) {
        const mote = document.createElement("i");
        const size = 2 + Math.random() * 5;
        mote.style.setProperty("--mote-x", `${Math.random() * 100}%`);
        mote.style.setProperty("--mote-size", `${size}px`);
        mote.style.setProperty("--mote-duration", `${9 + Math.random() * 14}s`);
        mote.style.setProperty("--mote-delay", `${-Math.random() * 20}s`);
        mote.style.setProperty("--mote-drift", `${(Math.random() - 0.5) * 120}`);
        mote.style.setProperty("--mote-opacity", `${(0.35 + Math.random() * 0.5).toFixed(2)}`);
        frag.append(mote);
      }
      motesLayer.append(frag);
    };
    const updateArrivalGlyphs = (progress) => {
      arrivalInterlude?.querySelectorAll(".arrival-copy").forEach((copy, index) => {
        let sceneProgress = Math.min(1, Math.max(0, progress * 3 - index));
        if (reducedMotion) sceneProgress = index === Math.min(2, Math.floor(progress * 3)) ? 1 : sceneProgress;
        copy.style.setProperty("--scene-progress", String(sceneProgress));
        const ranges = [[0, 0.38], [0.32, 0.78], [0.68, 1]];
        copy.querySelectorAll(".arrival-copy h1, .arrival-copy h2, .arrival-copy p, .arrival-whisper").forEach((element, textIndex) => {
          const [start, end] = ranges[textIndex] || [0, 1];
          let localProgress = Math.min(1, Math.max(0, (sceneProgress - start) / (end - start)));
          if (reducedMotion) localProgress = index === Math.floor(progress * 3) ? 1 : 0;
          else if (index === 0 && textIndex < 2) localProgress = 1;
          const glyphCount = Number(element.style.getPropertyValue("--glyph-count")) || 0;
          element.querySelectorAll(".arrival-glyph").forEach((glyph, glyphIndex) => {
            const reveal = Math.min(1, Math.max(0, localProgress * glyphCount - glyphIndex));
            glyph.style.setProperty("--glyph-reveal", String(reveal));
          });
        });
        const stroke = copy.querySelector(".arrival-ink-stroke path");
        if (stroke) stroke.style.strokeDashoffset = String(1 - sceneProgress);
      });
    };
    const calligraphyAssets = [
      ASSET_IMAGE + "calligraphy-flight-01.png",
      ASSET_IMAGE + "calligraphy-flight-03.png",
      ASSET_IMAGE + "calligraphy-flight-04.png",
      ASSET_IMAGE + "calligraphy-flight-05.png",
      ASSET_IMAGE + "calligraphy-flight-06.png",
      ASSET_IMAGE + "calligraphy-flight-07.png",
      ASSET_IMAGE + "calligraphy-flight-08.png",
      ASSET_IMAGE + "calligraphy-flight-09.png",
      ASSET_IMAGE + "calligraphy-flight-11.png",
      ASSET_IMAGE + "calligraphy-flight-13.png",
      ASSET_IMAGE + "calligraphy-flight-14.png",
      ASSET_IMAGE + "calligraphy-flight-15.png",
      ASSET_IMAGE + "calligraphy-flight-17.png",
      ASSET_IMAGE + "calligraphy-flight-19.png",
      ASSET_IMAGE + "calligraphy-added-01.png",
      ASSET_IMAGE + "calligraphy-added-02.png",
      ASSET_IMAGE + "calligraphy-added-03.png",
      ASSET_IMAGE + "calligraphy-added-04.png",
      ASSET_IMAGE + "calligraphy-added-06.png",
      ASSET_IMAGE + "calligraphy-added-08.png",
      ASSET_IMAGE + "calligraphy-added-09.png",
      ASSET_IMAGE + "calligraphy-added-11.png"
    ];
    const preloadCalligraphy = () => Promise.all(calligraphyAssets.map((src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(src);
      image.onerror = () => reject(new Error(`Unable to load calligraphy image: ${src}`));
      image.src = src;
    })));
    const shuffle = (items) => {
      const shuffled = [...items];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
      return shuffled;
    };
    const loadImageSource = (src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
      image.src = src;
    });
    const sampleOriginPoints = (image, targetCount) => {
      const maxSide = 260;
      const scale = Math.min(maxSide / image.naturalWidth, maxSide / image.naturalHeight, 1);
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      sampleCanvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
      sampleContext.drawImage(image, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const { data } = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
      const allPoints = [];
      for (let y = 0; y < sampleCanvas.height; y += 1) {
        for (let x = 0; x < sampleCanvas.width; x += 1) {
          const offset = (y * sampleCanvas.width + x) * 4;
          const red = data[offset];
          const green = data[offset + 1];
          const blue = data[offset + 2];
          const alpha = data[offset + 3];
          const brightness = (red + green + blue) / 3;
          if (alpha > 70 && brightness < 216) allPoints.push({ x, y, weight: 216 - brightness });
        }
      }
      if (!allPoints.length) {
        return Array.from({ length: targetCount }, () => ({
          x: Math.random() * sampleCanvas.width,
          y: Math.random() * sampleCanvas.height
        }));
      }
      const totalWeight = allPoints.reduce((sum, point) => sum + point.weight, 0);
      const points = [];
      for (let index = 0; index < targetCount; index += 1) {
        let pick = Math.random() * totalWeight;
        let chosen = allPoints[allPoints.length - 1];
        for (const point of allPoints) {
          pick -= point.weight;
          if (pick <= 0) {
            chosen = point;
            break;
          }
        }
        points.push({ x: chosen.x, y: chosen.y });
      }
      return { points, width: sampleCanvas.width, height: sampleCanvas.height };
    };
    const sampleTargetPoints = (image, targetCount, viewportWidth, viewportHeight) => {
      const coverScale = Math.max(viewportWidth / image.naturalWidth, viewportHeight / image.naturalHeight);
      const offsetX = (viewportWidth - image.naturalWidth * coverScale) / 2;
      const offsetY = (viewportHeight - image.naturalHeight * coverScale) / 2;
      const sampleSide = 300;
      const sampleScale = Math.min(sampleSide / image.naturalWidth, sampleSide / image.naturalHeight, 1);
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = Math.max(1, Math.round(image.naturalWidth * sampleScale));
      sampleCanvas.height = Math.max(1, Math.round(image.naturalHeight * sampleScale));
      const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
      sampleContext.drawImage(image, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const { data } = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
      const buckets = Array.from({ length: 10 }, () => []);
      for (let y = 0; y < sampleCanvas.height; y += 1) {
        for (let x = 0; x < sampleCanvas.width; x += 1) {
          const offset = (y * sampleCanvas.width + x) * 4;
          const alpha = data[offset + 3];
          if (alpha < 40) continue;
          const red = data[offset];
          const green = data[offset + 1];
          const blue = data[offset + 2];
          const brightness = (red + green + blue) / 3;
          const bucketIndex = Math.min(9, Math.floor(brightness / 25.6));
          buckets[bucketIndex].push({ x, y, red, green, blue });
        }
      }
      const points = [];
      for (let index = 0; index < targetCount; index += 1) {
        const threshold = Math.min(9, Math.max(0, Math.floor(Math.pow(Math.random(), 1.35) * 10)));
        let bucket = buckets[threshold];
        if (!bucket.length) bucket = buckets.flat();
        if (!bucket.length) {
          points.push({ x: viewportWidth / 2, y: viewportHeight / 2, red: 240, green: 236, blue: 226 });
          continue;
        }
        const chosen = bucket[Math.floor(Math.random() * bucket.length)];
        points.push({
          x: offsetX + (chosen.x / sampleCanvas.width) * image.naturalWidth * coverScale,
          y: offsetY + (chosen.y / sampleCanvas.height) * image.naturalHeight * coverScale,
          red: chosen.red,
          green: chosen.green,
          blue: chosen.blue
        });
      }
      return points;
    };
    const runGlyphParticleTransform = () => {
      const particleCanvas = calligraphySequence.querySelector(".calligraphy-particle-canvas");
      if (!particleCanvas) return Promise.resolve(false);
      if (location.protocol === "file:") return Promise.resolve(false);
      const context = particleCanvas.getContext("2d");
      if (!context) return Promise.resolve(false);
      const flights = [...calligraphySequence.querySelectorAll(".calligraphy-flight")].filter((flight) => flight.complete && flight.naturalWidth > 0);
      if (flights.length < 3) return Promise.resolve(false);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      particleCanvas.width = Math.round(viewportWidth * dpr);
      particleCanvas.height = Math.round(viewportHeight * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const particleCount = viewportWidth < 700 ? 1700 : 3400;
      const perFlight = Math.ceil(particleCount / flights.length);
      const originPoints = [];
      flights.forEach((flight) => {
        const rect = flight.getBoundingClientRect();
        const sampled = sampleOriginPoints(flight, perFlight);
        const scaleX = rect.width / sampled.width;
        const scaleY = rect.height / sampled.height;
        sampled.points.forEach((point) => {
          originPoints.push({
            x: rect.left + point.x * scaleX,
            y: rect.top + point.y * scaleY,
            tone: 36 + Math.random() * 52
          });
        });
      });
      if (originPoints.length < 600) return Promise.resolve(false);
      return loadImageSource(ASSET_IMAGE + "home-hero.jpg").then((heroImage) => {
        const targetPoints = sampleTargetPoints(heroImage, originPoints.length, viewportWidth, viewportHeight);
        const particles = originPoints.map((origin, index) => {
          const target = targetPoints[index] || targetPoints[targetPoints.length - 1];
          return {
            startX: origin.x + (Math.random() - 0.5) * 12,
            startY: origin.y + (Math.random() - 0.5) * 12,
            midX: origin.x + (Math.random() - 0.5) * viewportWidth * 0.5,
            midY: origin.y + (Math.random() - 0.5) * viewportHeight * 0.45 - viewportHeight * 0.06,
            targetX: target.x + (Math.random() - 0.5) * 5,
            targetY: target.y + (Math.random() - 0.5) * 5,
            size: 0.6 + Math.random() * 1.8,
            tone: origin.tone,
            red: target.red,
            green: target.green,
            blue: target.blue,
            delay: Math.random() * 0.18
          };
        });
        flights.forEach((flight) => flight.classList.add("is-shattering"));
        calligraphySequence.classList.add("is-particle-phase");
        const scatterDuration = 620;
        const gatherDuration = 2150;
        const holdDuration = 1350;
        const fadeDuration = 950;
        const startedAt = performance.now();
        const totalDuration = scatterDuration + gatherDuration + holdDuration + fadeDuration;
        const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const easeOut = (t) => 1 - Math.pow(1 - t, 3);
        return new Promise((resolve) => {
          const render = (now) => {
            const elapsed = now - startedAt;
            context.clearRect(0, 0, viewportWidth, viewportHeight);
            if (elapsed < scatterDuration + gatherDuration + holdDuration) {
              for (const particle of particles) {
                const local = Math.min(1, Math.max(0, (elapsed / scatterDuration - particle.delay) / (1 - particle.delay)));
                let x;
                let y;
                let red;
                let green;
                let blue;
                let alpha = 1;
                if (elapsed < scatterDuration) {
                  const t = easeOut(local);
                  x = particle.startX + (particle.midX - particle.startX) * t * 0.4;
                  y = particle.startY + (particle.midY - particle.startY) * t * 0.4;
                  red = green = blue = particle.tone;
                  alpha = 0.92;
                } else if (elapsed < scatterDuration + gatherDuration) {
                  const gatherElapsed = elapsed - scatterDuration;
                  const gatherLocal = Math.min(1, Math.max(0, (gatherElapsed / gatherDuration - particle.delay) / (1 - particle.delay)));
                  const t = easeInOut(gatherLocal);
                  const arc = Math.sin(t * Math.PI);
                  const fromX = particle.startX + (particle.midX - particle.startX) * 0.4;
                  const fromY = particle.startY + (particle.midY - particle.startY) * 0.4;
                  x = fromX + (particle.targetX - fromX) * t + (particle.midX - fromX) * arc * 0.55;
                  y = fromY + (particle.targetY - fromY) * t + (particle.midY - fromY) * arc * 0.55;
                  const mix = Math.min(1, t * 1.6);
                  red = particle.tone + (particle.red - particle.tone) * mix;
                  green = particle.tone + (particle.green - particle.tone) * mix;
                  blue = particle.tone + (particle.blue - particle.tone) * mix;
                  alpha = 0.94;
                } else {
                  const holdElapsed = elapsed - scatterDuration - gatherDuration;
                  x = particle.targetX + Math.sin((holdElapsed + particle.targetX * 7) * 0.004) * 0.8;
                  y = particle.targetY + Math.cos((holdElapsed + particle.targetY * 7) * 0.004) * 0.8;
                  red = particle.red;
                  green = particle.green;
                  blue = particle.blue;
                  alpha = 0.96;
                }
                context.fillStyle = `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${alpha})`;
                context.fillRect(x, y, particle.size, particle.size);
              }
            } else {
              const fadeProgress = Math.min(1, (elapsed - scatterDuration - gatherDuration - holdDuration) / fadeDuration);
              const eased = easeInOut(fadeProgress);
              context.globalAlpha = 1 - eased;
              const inset = eased * Math.min(viewportWidth, viewportHeight) * 0.085;
              context.drawImage(heroImage, inset, inset, viewportWidth - inset * 2, viewportHeight - inset * 2);
              context.globalAlpha = 1;
              if (fadeProgress >= 1) {
                resolve(true);
                return;
              }
            }
            window.requestAnimationFrame(render);
          };
          window.requestAnimationFrame(render);
        });
      }).catch(() => false);
    };
    const exitArrivalScene = (onComplete) => {
      const inkWash = arrivalStage?.querySelector(".arrival-ink-wash");
      const reveal = () => {
        if (!inkWash) { onComplete?.(); return; }
        inkWash.classList.remove("is-opening");
        inkWash.classList.add("is-active");
        window.setTimeout(() => {
          onComplete?.();
          inkWash.classList.remove("is-active");
          inkWash.classList.add("is-opening");
          window.setTimeout(() => inkWash.classList.remove("is-opening", "is-active"), 860);
        }, 640);
      };
      if (inkWashRunning) window.setTimeout(reveal, 320);
      else reveal();
    };
    const startInkAnimation = () => {
      if (!inkCanvas || !inkContext) throw new Error("The ink interlude canvas is unavailable.");
      const context = inkContext;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let width = 0;
      let height = 0;
      let frameId = 0;
      let previousFrame = 0;
      let time = 0;
      const mouse = { x: -9999, y: -9999 };
      const particleCount = window.innerWidth < 700 ? 42 : 90;
      const strokeCount = window.innerWidth < 700 ? 12 : 28;
      const random = (min, max) => min + Math.random() * (max - min);
      const resize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        inkCanvas.width = Math.round(width * dpr);
        inkCanvas.height = Math.round(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      const noise = (x, y, t) => (
        Math.sin(x * 0.003 + t * 0.4)
        + Math.cos(y * 0.0035 - t * 0.3)
        + Math.sin((x + y) * 0.002 + t * 0.15)
      ) / 3;
      const makeParticle = (initial = false) => {
        const maxLife = random(300, 900);
        return {
          x: Math.random() * width,
          y: initial ? Math.random() * height : height + Math.random() * 120,
          radius: random(30, 90),
          baseAlpha: random(0.025, 0.08),
          alpha: 0,
          life: initial ? Math.random() * maxLife : 0,
          maxLife,
          vx: 0,
          vy: random(-0.33, -0.08),
          hue: random(185, 215),
          saturation: random(3, 10),
          lightness: random(42, 62)
        };
      };
      const makeStroke = () => ({
        x: Math.random() * width,
        y: random(height * 0.2, height * 0.8),
        width: random(60, 200),
        height: random(10, 50),
        alpha: random(0.025, 0.065),
        vx: random(-0.075, 0.075),
        vy: random(-0.04, 0.04),
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: random(-0.001, 0.001),
        life: Math.random() * 1000,
        maxLife: random(400, 1200),
        currentAlpha: 0
      });
      resize();
      let particles = Array.from({ length: particleCount }, () => makeParticle(true));
      let strokes = Array.from({ length: strokeCount }, makeStroke);
      const onResize = () => {
        resize();
        particles = Array.from({ length: particleCount }, () => makeParticle(true));
        strokes = Array.from({ length: strokeCount }, makeStroke);
      };
      const onPointerMove = (event) => {
        mouse.x = event.clientX;
        mouse.y = event.clientY;
      };
      const drawParticle = (particle) => {
        if (particle.alpha <= 0.005) return;
        const gradient = context.createRadialGradient(
          particle.x, particle.y, 0,
          particle.x, particle.y, particle.radius
        );
        gradient.addColorStop(0, `hsla(${particle.hue}, ${particle.saturation}%, ${particle.lightness}%, ${particle.alpha})`);
        gradient.addColorStop(1, `hsla(${particle.hue}, ${particle.saturation}%, ${particle.lightness}%, 0)`);
        context.globalCompositeOperation = "screen";
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
      };
      const drawStroke = (stroke) => {
        if (stroke.currentAlpha < 0.005) return;
        context.save();
        context.translate(stroke.x, stroke.y);
        context.rotate(stroke.rotation);
        context.globalCompositeOperation = "screen";
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, stroke.width / 2);
        gradient.addColorStop(0, `rgba(115, 127, 132, ${stroke.currentAlpha})`);
        gradient.addColorStop(0.5, `rgba(87, 100, 108, ${stroke.currentAlpha * 0.6})`);
        gradient.addColorStop(1, "rgba(70, 80, 88, 0)");
        context.fillStyle = gradient;
        context.beginPath();
        context.ellipse(0, 0, stroke.width / 2, stroke.height / 2, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
      };
      const render = (now) => {
        const frameScale = previousFrame ? Math.min((now - previousFrame) / 16.67, 2) : 1;
        previousFrame = now;
        time += 0.01 * frameScale;
        context.globalCompositeOperation = "destination-out";
        context.fillStyle = "rgba(0, 0, 0, 0.12)";
        context.fillRect(0, 0, width, height);
        for (const particle of particles) {
          particle.life += frameScale;
          const field = noise(particle.x, particle.y, time);
          particle.vx += field * 0.02 * frameScale;
          particle.vy += Math.sin(time * 0.4 + particle.x * 0.01) * 0.005 * frameScale;
          particle.vx *= Math.pow(0.98, frameScale);
          particle.vy *= Math.pow(0.99, frameScale);
          const dx = particle.x - mouse.x;
          const dy = particle.y - mouse.y;
          const distance = Math.hypot(dx, dy);
          if (distance < 160 && distance > 0) {
            const force = (160 - distance) / 160 * frameScale * 0.18;
            particle.vx += dx / distance * force;
            particle.vy += dy / distance * force;
          }
          particle.x += particle.vx * frameScale;
          particle.y += particle.vy * frameScale;
          particle.alpha = particle.baseAlpha * Math.sin(Math.PI * particle.life / particle.maxLife);
          if (particle.life > particle.maxLife || particle.y < -particle.radius * 2) {
            Object.assign(particle, makeParticle());
          }
          drawParticle(particle);
        }
        for (const stroke of strokes) {
          stroke.life += frameScale;
          const field = noise(stroke.x, stroke.y, time * 0.7);
          stroke.vx += field * 0.008 * frameScale;
          stroke.vy += Math.cos(time * 0.3 + stroke.y * 0.005) * 0.004 * frameScale;
          stroke.vx *= Math.pow(0.99, frameScale);
          stroke.vy *= Math.pow(0.99, frameScale);
          stroke.x += stroke.vx * frameScale;
          stroke.y += stroke.vy * frameScale;
          stroke.rotation += stroke.rotationSpeed * frameScale;
          stroke.currentAlpha = stroke.alpha * Math.sin(Math.PI * stroke.life / stroke.maxLife);
          if (stroke.life > stroke.maxLife) Object.assign(stroke, makeStroke());
          drawStroke(stroke);
        }
        frameId = window.requestAnimationFrame(render);
      };
      window.addEventListener("resize", onResize);
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      frameId = window.requestAnimationFrame(render);
      return () => {
        window.cancelAnimationFrame(frameId);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("pointermove", onPointerMove);
      };
    };
    let arrivalSceneIndex = -1;
    let inkWashRunning = false;
    const playArrivalInkWash = () => {
      if (reducedMotion || !arrivalInkWash || inkWashRunning) return Promise.resolve();
      inkWashRunning = true;
      return new Promise((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          inkWashRunning = false;
          arrivalInkWash.classList.remove("is-active", "is-opening");
          resolve();
        };
        arrivalInkWash.classList.remove("is-active", "is-opening");
        void arrivalInkWash.offsetWidth;
        arrivalInkWash.classList.add("is-active");
        window.setTimeout(() => {
          arrivalInkWash.classList.remove("is-active");
          arrivalInkWash.classList.add("is-opening");
          window.setTimeout(settle, 860);
        }, 660);
        window.setTimeout(settle, 1900);
      });
    };
    const updateArrivalProgress = () => {
      if (!arrivalInterlude || !arrivalTrack) return;
      const viewportH = window.innerHeight;
      const scroller = arrivalScroller || null;
      const scrollRange = arrivalTrack.offsetHeight - (scroller ? scroller.clientHeight : viewportH);
      const scrolled = scroller ? scroller.scrollTop : 0;
      const progress = scrollRange > 0 ? Math.min(1, Math.max(0, scrolled / scrollRange)) : 1;
      const sceneIndex = Math.min(2, Math.floor(progress * 3));
      arrivalInterlude.style.setProperty("--arrival-progress", String(progress));
      arrivalInterlude.style.setProperty("--arrival-progress-width", `${progress * 100}%`);
      arrivalInterlude.style.setProperty("--arrival-landscape-y", `${-progress * 300}px`);
      arrivalInterlude.style.setProperty("--arrival-moon-y", `${progress * 180}px`);
      arrivalInterlude.style.setProperty("--arrival-pine-y", `${progress * 34}px`);
      arrivalInterlude.style.setProperty("--arrival-copy-y", `${-progress * 68}px`);
      arrivalInterlude.dataset.scene = String(sceneIndex + 1);
      arrivalInterlude.style.setProperty("--arrival-camera-scale", String(1 + progress * 0.13));
      arrivalInterlude.style.setProperty("--arrival-landscape-scale", String(1.04 + progress * 0.16));
      arrivalInterlude.style.setProperty("--arrival-world-x", `${-progress * 48}px`);
      arrivalInterlude.style.setProperty("--arrival-bloom", String(Math.sin(progress * Math.PI)));
      arrivalInterlude.style.setProperty("--arrival-river-y", `${progress * 110}px`);
      arrivalInterlude.style.setProperty("--arrival-mist-x", `${Math.sin(progress * Math.PI * 1.4) * 38}px`);
      arrivalInterlude.style.setProperty("--arrival-mist-y", `${progress * 56}px`);
      arrivalInterlude.style.setProperty("--arrival-hill-far-x", `${(-progress * 90).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-hill-far-y", `${(-progress * 34).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-hill-mid-x", `${(-progress * 190).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-shore-x", `${(-progress * 280).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-willow-x", `${(-progress * 330).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-boat-x", `${(-progress * 150 + Math.sin(progress * Math.PI * 2) * 10).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-boat-y", `${(Math.sin(progress * Math.PI * 3) * 7).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-boat-tilt", `${(Math.cos(progress * Math.PI * 2.4) * 2.4).toFixed(2)}deg`);
      arrivalInterlude.style.setProperty("--arrival-reed-x", `${(progress * 230).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-geese-x", `${(-progress * 420).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-geese-y", `${(-progress * 120).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-dolly", String(1 + progress * 0.07));
      arrivalChapterButtons?.forEach((button, index) => {
        button.setAttribute("aria-pressed", String(index === sceneIndex));
      });
      updateArrivalGlyphs(progress);
      arrivalInterlude.querySelectorAll(".arrival-copy").forEach((copy, index) => {
        const isCurrent = index === sceneIndex;
        copy.classList.toggle("is-current", isCurrent);
        if (isCurrent) copy.removeAttribute("aria-hidden");
        else copy.setAttribute("aria-hidden", "true");
      });
      const progressCount = arrivalInterlude.querySelector(".arrival-progress-label b");
      if (progressCount) progressCount.textContent = `${String(sceneIndex + 1).padStart(2, "0")} / 03`;
      if (arrivalEnterButton) arrivalEnterButton.disabled = false;
      if (arrivalSceneIndex !== -1 && sceneIndex !== arrivalSceneIndex && !reducedMotion && !inkWashRunning) playArrivalInkWash();
      arrivalSceneIndex = sceneIndex;
    };
    const spawnArrivalPetals = () => {
      const holder = arrivalInterlude?.querySelector(".arrival-petals");
      if (!holder || holder.childElementCount) return;
      const count = window.innerWidth < 700 ? 10 : 18;
      for (let index = 0; index < count; index += 1) {
        const petal = document.createElement("i");
        petal.style.setProperty("--petal-x", `${(Math.random() * 100).toFixed(1)}%`);
        petal.style.setProperty("--petal-size", `${(7 + Math.random() * 9).toFixed(1)}px`);
        petal.style.setProperty("--petal-duration", `${(9 + Math.random() * 8).toFixed(1)}s`);
        petal.style.setProperty("--petal-delay", `${(-Math.random() * 14).toFixed(1)}s`);
        petal.style.setProperty("--petal-drift", `${(-140 + Math.random() * 280).toFixed(0)}`);
        petal.style.setProperty("--petal-opacity", (0.4 + Math.random() * 0.4).toFixed(2));
        holder.appendChild(petal);
      }
    };
    const updateArrivalPointer = (event) => {
      if (reducedMotion || event.pointerType === "touch") return;
      const x = event.clientX / window.innerWidth - 0.5;
      const y = event.clientY / window.innerHeight - 0.5;
      arrivalInterlude.style.setProperty("--arrival-pointer-x", `${(x * 26).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-pointer-y", `${(y * 19).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-pointer-deep-x", `${(x * 46).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-pointer-deep-y", `${(y * 30).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-pointer-soft-x", `${(x * 12).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-pointer-soft-y", `${(y * 9).toFixed(1)}px`);
    };
    const showArrivalInterlude = () => new Promise((resolve, reject) => {
      if (!arrivalInterlude || !arrivalTrack || !arrivalScroller || !arrivalEnterButton || !arrivalSkipButton) {
        reject(new Error("The parallax arrival interlude is incomplete."));
        return;
      }
      let finished = false;
      let rafPending = false;
      /* ---------- 全屏下滑提示：入场稳定 1.1s 后弹出，滚动/点击即散去 ---------- */
      const arrivalHintVeil = arrivalInterlude.querySelector(".arrival-hint");
      // 弹出提示：仅在用户尚未开始滚动（scrollTop≈0）且提示未显示时触发
      let hintVeilUp = false;
      const raiseHint = () => {
        if (finished || hintVeilUp || !arrivalHintVeil) return;
        if (arrivalScroller.scrollTop > 4) return; // 已开始滚动就不再打扰
        hintVeilUp = true;
        arrivalHintVeil.classList.remove("is-hidden");
      };
      // 收起提示：故事一旦推进（滚动/点击/跳过）就永久散去，不重复打扰
      const dismissHint = () => {
        if (!hintVeilUp || !arrivalHintVeil) return;
        hintVeilUp = false;
        arrivalHintVeil.classList.add("is-hidden");
      };
      const onScroll = () => {
        if (rafPending) return;
        rafPending = true;
        window.requestAnimationFrame(() => {
          rafPending = false;
          dismissHint(); // 故事一旦推进，全屏提示即散去
          updateArrivalProgress();
        });
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        dismissHint();
        removeListeners();
        exitArrivalScene(() => {
          arrivalInterlude.classList.add("is-leaving");
          revealHome();
          window.scrollTo({ top: 0, behavior: "auto" });
          document.querySelector(".hero-actions a")?.focus({ preventScroll: true });
          resolve();
        });
      };
      const onWheel = (event) => {
        if (finished || event.deltaY <= 0) return;
        const scrollRange = arrivalTrack.offsetHeight - arrivalScroller.clientHeight;
        if (arrivalScroller.scrollTop >= scrollRange - 2) {
          event.preventDefault();
          finish();
        }
      };
      const enterOrAdvance = () => {
        if (finished) return;
        const scrollRange = arrivalTrack.offsetHeight - arrivalScroller.clientHeight;
        const progress = scrollRange > 0 ? arrivalScroller.scrollTop / scrollRange : 1;
        const currentScene = Math.min(2, Math.floor(progress * 3));
        if (currentScene >= 2) {
          finish();
          return;
        }
        // 第一、二幕：平滑滚入下一幕（越过场景分界点）
        const target = (scrollRange * (currentScene + 1)) / 3 + 6;
        arrivalScroller.scrollTo({ top: target, behavior: "smooth" });
      };
      const removeListeners = () => {
        arrivalScroller.removeEventListener("scroll", onScroll);
        window.removeEventListener("wheel", onWheel);
        document.body.classList.remove("arrival-lock");
      };
      prepareArrivalCopy();
      spawnArrivalMotes();
      spawnArrivalPetals();
      arrivalInterlude.removeAttribute("aria-hidden");
      arrivalInterlude.removeAttribute("inert");
      arrivalInterlude.classList.add("is-visible");
      document.body.classList.add("arrival-lock");
      arrivalScroller.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("wheel", onWheel, { passive: false });
      if (arrivalHintVeil) {
        arrivalHintVeil.addEventListener("click", dismissHint); // 点击空白处关闭
        arrivalHintVeil.addEventListener("wheel", (event) => { // 滚动即散去，手势直接推进故事
          if (finished || event.deltaY <= 0) return;
          event.preventDefault();
          dismissHint();
          arrivalScroller.scrollTop += event.deltaY;
        }, { passive: false });
      }
      window.setTimeout(raiseHint, 1100); // 入场过渡稳住后再全屏提示下滑
      window.addEventListener("pointermove", updateArrivalPointer, { passive: true });
      arrivalEnterButton.addEventListener("click", enterOrAdvance);
      arrivalSkipButton.addEventListener("click", finish);
      arrivalChapterButtons?.forEach((button) => {
        button.addEventListener("click", () => {
          const chapter = Number(button.dataset.arrivalScene);
          const scrollRange = arrivalTrack.offsetHeight - arrivalScroller.clientHeight;
          const chapterProgress = chapter === 2 ? 1 : (chapter + 0.5) / 3;
          arrivalScroller.scrollTo({ top: scrollRange * chapterProgress, behavior: reducedMotion ? "auto" : "smooth" });
        });
      });
      updateArrivalProgress();
      resolve();
    });
    const runCalligraphySequence = async (assetsReady, revealHome) => {
      const assets = await assetsReady;
      let backgroundVideoHasEnded = Boolean(calligraphyBackground?.ended);
      const backgroundVideoEnded = new Promise((resolve, reject) => {
        if (!calligraphyBackground) {
          reject(new Error("The calligraphy background video is missing."));
          return;
        }
        if (backgroundVideoHasEnded) {
          resolve();
          return;
        }
        calligraphyBackground.addEventListener("ended", () => {
          backgroundVideoHasEnded = true;
          resolve();
        }, { once: true });
        calligraphyBackground.addEventListener("error", () => {
          reject(new Error("The calligraphy background video could not be played."));
        }, { once: true });
      });
      const flightInterval = 180;
      const positions = shuffle(
        Array.from({ length: assets.length }, (_, index) => {
          const spread = window.innerWidth <= 700 ? 70 : 76;
          const margin = (100 - spread) / 2;
          return margin + index * (spread / (assets.length - 1));
        })
      );
      const displayCalligraphy = async () => {
        let index = 0;
        const shuffledAssets = shuffle(assets);
        while (!backgroundVideoHasEnded) {
          const image = document.createElement("img");
          image.className = "calligraphy-flight";
          image.src = shuffledAssets[index % shuffledAssets.length];
          image.alt = "";
          image.setAttribute("aria-hidden", "true");
          image.style.left = `${positions.pop()}%`;
          if (!positions.length) {
            positions.push(...shuffle(
              Array.from({ length: assets.length }, (_, positionIndex) => {
                const spread = window.innerWidth <= 700 ? 70 : 76;
                const margin = (100 - spread) / 2;
                return margin + positionIndex * (spread / (assets.length - 1));
              })
            ));
          }
          const duration = 600 + Math.random() * 2400;
          image.style.animationDuration = `${duration}ms`;
          image.addEventListener("animationend", () => image.remove(), { once: true });
          calligraphySequence.append(image);
          index += 1;
          await new Promise((resolve) => window.setTimeout(resolve, flightInterval));
        }
      };
      const showInterludeAfterCalligraphy = async () => {
        await backgroundVideoEnded;
        await Promise.race([
          runGlyphParticleTransform(),
          new Promise((resolve) => window.setTimeout(resolve, 8000))
        ]);
        calligraphySequence.classList.add("is-revealing");
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        calligraphySequence.remove();
        await displayCalligraphyPromise;
        const interludeDuration = 7000;
        const interludeFadeDuration = 600;
        const interludeStartedAt = performance.now();
        const stopInkAnimation = startInkAnimation();
        inkInterlude.classList.add("is-visible");
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
        const beforeFadeOut = interludeStartedAt + interludeDuration - interludeFadeDuration - performance.now();
        if (beforeFadeOut > 0) await new Promise((resolve) => window.setTimeout(resolve, beforeFadeOut));
        inkInterlude.classList.remove("is-visible");
        const untilTransition = interludeStartedAt + interludeDuration - performance.now();
        if (untilTransition > 0) await new Promise((resolve) => window.setTimeout(resolve, untilTransition));
        stopInkAnimation();
        inkInterlude.remove();
        await showArrivalInterlude();
      };
      const displayCalligraphyPromise = displayCalligraphy();
      await showInterludeAfterCalligraphy();
    };
    let homeRevealPromise;
    const revealHome = () => {
      if (homeRevealPromise) return homeRevealPromise;
      sessionStorage.setItem(introStorageKey, "true");
      calligraphySequence.classList.add("is-revealing");
      document.body.classList.add("book-opened");
      document.querySelectorAll("header[inert], main[inert], footer[inert], audio[inert]").forEach((element) => element.removeAttribute("inert"));
      homeRevealPromise = new Promise((resolve) => {
        window.setTimeout(() => {
          calligraphyBackground?.pause();
          calligraphySequence.remove();
          inkInterlude?.remove();
          bookOpening.remove();
          resolve();
        }, reducedMotion ? 0 : 1500);
      });
      return homeRevealPromise;
    };
    if (sessionStorage.getItem(introStorageKey) === "true") {
      document.body.classList.add("book-opened");
      bookOpening.remove();
      calligraphySequence.remove();
      inkInterlude?.remove();
      arrivalInterlude?.remove();
      document.querySelectorAll("header[inert], main[inert], footer[inert], audio[inert]").forEach((element) => element.removeAttribute("inert"));
      document.querySelector(".hero-actions a")?.focus({ preventScroll: true });
    } else {
      bookOpenButton.addEventListener("click", () => {
        bookOpenButton.disabled = true;
        startIntroAudio();
        if (reducedMotion) {
          revealHome();
          return;
        }
        const assetsReady = preloadCalligraphy();
        bookOpening.classList.add("is-opening");
        window.setTimeout(async () => {
          try {
            await assetsReady;
            bookOpening.classList.add("is-leaving");
            calligraphySequence.classList.add("is-active");
            calligraphyBackground?.play().catch((error) => {
              console.warn("The decorative calligraphy background video could not be played.", error);
            });
            window.setTimeout(() => bookOpening.remove(), 180);
            await runCalligraphySequence(assetsReady, revealHome);
          } catch (error) {
            console.error("The calligraphy intro could not be completed.", error);
            inkInterlude?.remove();
            arrivalInterlude?.remove();
            revealHome().then(() => {
              document.querySelector(".hero-actions a")?.focus({ preventScroll: true });
            });
          }
        }, 500);
      });
    }
  }

  let navigationVersion = 0;
  let activePageRipple = null;
  const startPageRipple = (origin = {}) => {
    if (reducedMotion) return { ready: Promise.resolve(), finish: () => {} };
    document.querySelectorAll(".page-ripple").forEach((ripple) => ripple.remove());
    const ripple = document.createElement("div");
    ripple.className = "page-ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.setProperty("--ripple-x", `${origin.x ?? window.innerWidth / 2}px`);
    ripple.style.setProperty("--ripple-y", `${origin.y ?? window.innerHeight / 2}px`);
    document.body.append(ripple);
    document.documentElement.classList.add("page-transitioning");
    activePageRipple = ripple;
    return {
      ready: new Promise((resolve) => window.setTimeout(resolve, 240)),
      finish: () => {
        if (activePageRipple !== ripple) {
          ripple.remove();
          return;
        }
        activePageRipple = null;
        document.documentElement.classList.remove("page-transitioning");
        window.setTimeout(() => ripple.remove(), 850);
      }
    };
  };
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
  const updateActiveNavigation = (url) => {
    document.querySelectorAll(".main-nav a").forEach((link) => {
      const active = new URL(link.href, location.href).pathname === url.pathname;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };
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
      if (version !== navigationVersion) return;
      ripple = startPageRipple(origin);
      await ripple.ready;
      if (version !== navigationVersion) {
        ripple.finish();
        return;
      }
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
      ripple.finish();
    } catch (error) {
      ripple?.finish();
      console.error("Unable to navigate without reloading:", error);
      location.assign(url.href);
    }
  };
  // 整页跳转前先让声音淡出，避免旧页音乐被瞬间掐断；新页面的音乐再从零淡入
  const fadeSiteAudioBeforeExit = (duration = 340) => {
    document.querySelectorAll(".background-audio, .finale-audio").forEach((element) => {
      window.liyuAudio.fadeOut(element, duration);
    });
  };
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self" || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith(".html")) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY };
    // 终幕页有独立的配乐与整页动效，进出都走整页加载，才能接上尾声曲并淡出旧曲
    const fullReload = location.protocol === "file:"
      || url.pathname.endsWith("finale.html")
      || Boolean(document.querySelector(".finale-audio"));
    if (fullReload) {
      sessionStorage.setItem("liyu-page-ripple-origin", `${origin.x},${origin.y}`);
      startPageRipple(origin);
      fadeSiteAudioBeforeExit();
      window.setTimeout(() => location.assign(url.href), 360);
      return;
    }
    navigateTo(url, true, origin);
  });
  window.addEventListener("popstate", () => {
    if (location.protocol !== "file:" && location.pathname.endsWith(".html")) {
      if (document.querySelector(".finale-audio")) {
        location.reload();
        return;
      }
      navigateTo(new URL(location.href), false);
    }
  });

  let timelineScrollTicking = false;
  const updateTimelineNarrative = () => {
    const timeline = document.querySelector(".timeline");
    if (!timeline) return;
    const items = [...timeline.querySelectorAll(".timeline-item")];
    if (!items.length) return;
    let progress = timeline.querySelector(".timeline-progress");
    if (!progress) {
      progress = document.createElement("span");
      progress.className = "timeline-progress";
      progress.setAttribute("aria-hidden", "true");
      timeline.append(progress);
    }
    const timelineBounds = timeline.getBoundingClientRect();
    const readingLine = window.innerHeight * 0.46;
    const progressAmount = Math.min(1, Math.max(0, (readingLine - timelineBounds.top) / timelineBounds.height));
    timeline.style.setProperty("--narrative-progress", String(progressAmount));
    let activeIndex = 0;
    let nearestDistance = Infinity;
    items.forEach((item, index) => {
      const bounds = item.getBoundingClientRect();
      const distance = Math.abs((bounds.top + bounds.bottom) / 2 - readingLine);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        activeIndex = index;
      }
    });
    items.forEach((item, index) => item.classList.toggle("is-active", index === activeIndex));
    const scene = document.querySelector(".timeline-scene");
    if (!scene || Number(scene.dataset.activeIndex) === activeIndex) return;
    scene.dataset.activeIndex = String(activeIndex);
    scene.dataset.chapter = String(activeIndex + 1);
    const activeItem = items[activeIndex];
    const year = activeItem.querySelector(".timeline-year")?.textContent.trim();
    scene.querySelectorAll(".timeline-scene-bg").forEach((bg) => bg.classList.toggle("is-active", bg.dataset.year === year));
    const label = activeItem.querySelector(".timeline-label")?.textContent.trim();
    const title = activeItem.querySelector(".timeline-card h3")?.textContent.trim();
    const quote = activeItem.querySelector(".timeline-quote")?.textContent.trim();
    const copy = scene.querySelector(".timeline-scene-copy");
    copy?.classList.add("is-changing");
    window.setTimeout(() => {
      scene.querySelector(".timeline-scene-year").textContent = year || "";
      scene.querySelector(".timeline-scene-label").textContent = label || "";
      scene.querySelector(".timeline-scene-copy h2").textContent = title || "";
      scene.querySelector(".timeline-scene-copy blockquote").textContent = quote || "";
      const count = scene.querySelector(".timeline-scene-count");
      count.firstChild.textContent = `${String(activeIndex + 1).padStart(2, "0")} `;
      count.querySelector("i").textContent = `/ ${String(items.length).padStart(2, "0")}`;
      scene.querySelector(".timeline-scene-kicker").textContent = `A LIFE IN VERSE · CHAPTER ${String(activeIndex + 1).padStart(2, "0")}`;
      scene.querySelectorAll(".timeline-scene-progress span").forEach((segment, index) => {
        segment.classList.toggle("is-current", index === activeIndex);
        segment.classList.toggle("is-complete", index < activeIndex);
      });
      copy?.classList.remove("is-changing");
    }, 120);
  };
  const scheduleTimelineNarrativeUpdate = () => {
    if (timelineScrollTicking) return;
    timelineScrollTicking = true;
    window.requestAnimationFrame(() => {
      updateTimelineNarrative();
      timelineScrollTicking = false;
    });
  };
  window.addEventListener("scroll", scheduleTimelineNarrativeUpdate, { passive: true });
  window.addEventListener("resize", scheduleTimelineNarrativeUpdate);

  let revealObserver;
  let scrollUiInitialized = false;
  let parallaxElements = [];
  let ciEntries = [];
  let ciTabs = [];
  let ciObserver;
  const initializeScrollInteractions = () => {
    let progress = document.querySelector(".reading-progress");
    let topButton = document.querySelector(".back-to-top");
    if (!progress) {
      progress = document.createElement("div");
      progress.className = "reading-progress";
      progress.setAttribute("aria-hidden", "true");
      document.body.append(progress);
    }
    if (!topButton) {
      topButton = document.createElement("button");
      topButton.className = "back-to-top";
      topButton.type = "button";
      topButton.setAttribute("aria-label", "回到页面顶部");
      topButton.title = "回到页面顶部";
      topButton.textContent = "↑";
      topButton.hidden = true;
      document.body.append(topButton);
      topButton.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" }));
    }
    if (!scrollUiInitialized) {
      let scrollTicking = false;
      const updateScrollUi = () => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.transform = `scaleX(${scrollable > 0 ? window.scrollY / scrollable : 0})`;
        topButton.hidden = window.scrollY < 420;
        const viewportCenter = window.innerHeight * 0.5;
        parallaxElements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const elementCenter = rect.top + rect.height * 0.5;
          const delta = elementCenter - viewportCenter;
          const speed = parseFloat(el.dataset.parallaxSpeed || "1");
          el.style.setProperty("--scroll-y", `${(delta * speed * 0.12).toFixed(1)}px`);
        });
        ciEntries.forEach((entry) => {
          const rect = entry.getBoundingClientRect();
          const entryProgress = Math.min(1, Math.max(0, (viewportCenter - rect.top) / rect.height));
          entry.style.setProperty("--entry-progress", entryProgress.toFixed(3));
          const lines = entry.querySelectorAll(".poem-line");
          const total = lines.length;
          if (total > 0) {
            lines.forEach((line, i) => {
              const reveal = Math.min(1, Math.max(0, (entryProgress * (total + 1.6) - i) / 1.6));
              line.style.setProperty("--line-reveal", reveal.toFixed(3));
            });
          }
        });
        const gallery = document.querySelector(".poem-gallery");
        if (gallery) {
          const gRect = gallery.getBoundingClientRect();
          const gProgress = (viewportCenter - gRect.top) / gRect.height;
          gallery.style.setProperty("--gallery-parallax", `${(gProgress * 60).toFixed(1)}px`);
        }
        scrollTicking = false;
      };
      window.addEventListener("scroll", () => {
        if (!scrollTicking) {
          window.requestAnimationFrame(updateScrollUi);
          scrollTicking = true;
        }
      }, { passive: true });
      window.addEventListener("resize", updateScrollUi);
      scrollUiInitialized = true;
      updateScrollUi();
    }

    revealObserver?.disconnect();
    // 首页词卡：在 reveal 绑定前包裹独立视差层，避免与卡片入场/hover 的 transform 冲突
    document.querySelectorAll(".poem-grid > .poem-card").forEach((card) => {
      if (card.parentElement?.classList.contains("poem-card-layer")) return;
      const layer = document.createElement("div");
      layer.className = "poem-card-layer";
      card.parentNode.insertBefore(layer, card);
      layer.appendChild(card);
    });
    const revealTargets = document.querySelectorAll(".timeline-item, .poem-card, .recite-card, .media-card, .memory-line article, .work-entry, .intro-card");
    if (reducedMotion || !("IntersectionObserver" in window)) {
      revealTargets.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: [0.08, 0.2], rootMargin: "0px 0px -9% 0px" });
    revealTargets.forEach((element, index) => {
      element.classList.add("reveal-on-scroll");
      element.style.setProperty("--reveal-delay", `${(index % 3) * 80}ms`);
      revealObserver.observe(element);
    });

    // 滚动视差：给标题与装饰层按视口位置施加 --scroll-y
    if (!reducedMotion) {
      const parallaxSelector = ".hero h1, .hero .eyebrow, .hero-art, .section-wrap h2, .section-kicker, .closing h2, .memory-lead h2, .work-number, .work-side, .work-main h3, .bg-parallax, .timeline-narrative .timeline, .timeline-scene, .intro, .story, .afterlife-section, .closing, .listen-content, .listen-interactive, .screen-world, .poet-portrait, .note-ornament, .echo-quote, .closing-pine, .recite-art";
      parallaxElements = Array.from(document.querySelectorAll(parallaxSelector)).map((el) => {
        let speed = "1";
        let cls = "scroll-parallax";
        if (el.classList.contains("work-side")) { speed = "0.32"; cls = "scroll-parallax-slow"; }
        else if (el.classList.contains("work-number")) { speed = "0.55"; cls = "scroll-parallax-slow"; }
        else if (el.matches(".work-main h3")) { speed = "0.7"; cls = "scroll-parallax-slow"; }
        else if (el.classList.contains("bg-parallax")) { speed = "0.35"; cls = "scroll-parallax-bg"; }
        else if (el.matches(".intro, .story, .afterlife-section, .closing, .listen-content, .listen-interactive, .screen-world, .recite-art")) { speed = "0.35"; cls = "bg-drift"; }
        else if (el.matches(".poet-portrait")) { speed = "0.5"; cls = "img-parallax"; }
        else if (el.matches(".note-ornament, .echo-quote")) { speed = "0.4"; cls = "scroll-parallax-slow"; }
        else if (el.classList.contains("closing-pine")) { speed = "0.6"; cls = "scroll-parallax"; }
        else if (el.classList.contains("hero-art")) { speed = "0.55"; cls = "hero-art-scroll"; }
        else if (el.classList.contains("timeline-scene")) { speed = "-0.5"; }
        else if (el.classList.contains("timeline")) { speed = "0.8"; }
        el.classList.add(cls);
        el.dataset.parallaxSpeed = speed;
        return el;
      });
      // 首页四张词卡：各异系数，滚动时如词笺错落浮起
      const cardSpeeds = ["0.35", "0.95", "0.15", "0.7"];
      document.querySelectorAll(".poem-card-layer").forEach((layer, index) => {
        layer.classList.add("scroll-parallax");
        layer.dataset.parallaxSpeed = cardSpeeds[index % cardSpeeds.length];
        parallaxElements.push(layer);
      });
      // 万象记忆卡：三张卡片错落系数，滚动时如卡片依次浮起
      const memorySpeeds = ["0.4", "0.85", "0.2"];
      document.querySelectorAll(".memory-line article").forEach((article, index) => {
        article.classList.add("scroll-parallax");
        article.dataset.parallaxSpeed = memorySpeeds[index % memorySpeeds.length];
        parallaxElements.push(article);
      });
    } else {
      parallaxElements = [];
    }
    initializeCiNarrative();
  };

  // 首页 hero：指针驱动多层视差（底景最慢、人物中速、灯笼前景最快）
  const initializeHeroPointerParallax = () => {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    // 立绘层按底图 object-fit:cover 的实际渲染矩形复位（源图 768 方图中的位置 130,46 545x660）
    const base = hero.querySelector(".hero-base");
    const figureLayer = hero.querySelector(".hero-figure-layer");
    if (base && figureLayer) {
      let layoutPending = false;
      const placeFigure = () => {
        layoutPending = false;
        const frame = figureLayer.parentElement.getBoundingClientRect();
        const natW = base.naturalWidth || 768;
        const natH = base.naturalHeight || 768;
        const scale = Math.max(frame.width / natW, frame.height / natH);
        const renderedW = natW * scale;
        const renderedH = natH * scale;
        const x0 = (frame.width - renderedW) / 2;
        const y0 = (frame.height - renderedH) / 2;
        figureLayer.style.left = `${(x0 + 130 * scale).toFixed(1)}px`;
        figureLayer.style.top = `${(y0 + 46 * scale).toFixed(1)}px`;
        figureLayer.style.width = `${(545 * scale).toFixed(1)}px`;
        figureLayer.style.height = `${(660 * scale).toFixed(1)}px`;
      };
      const schedulePlace = () => {
        if (!layoutPending) {
          layoutPending = true;
          window.requestAnimationFrame(placeFigure);
        }
      };
      if (base.complete) schedulePlace();
      else base.addEventListener("load", schedulePlace, { once: true });
      window.addEventListener("resize", schedulePlace);
    }
    if (reducedMotion || window.matchMedia("(pointer:coarse)").matches) return;
    let rafPending = false;
    let targetX = 0;
    let targetY = 0;
    const apply = () => {
      rafPending = false;
      hero.style.setProperty("--hero-px", targetX.toFixed(3));
      hero.style.setProperty("--hero-py", targetY.toFixed(3));
    };
    const schedule = () => {
      if (!rafPending) {
        rafPending = true;
        window.requestAnimationFrame(apply);
      }
    };
    hero.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" || event.pointerType === "pen") return;
      const rect = hero.getBoundingClientRect();
      targetX = Math.min(1, Math.max(-1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      targetY = Math.min(1, Math.max(-1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
      schedule();
    });
    hero.addEventListener("pointerleave", () => {
      targetX = 0;
      targetY = 0;
      schedule();
    });
  };

  const initializeCiNarrative = () => {
    const gallery = document.querySelector(".poem-gallery");
    if (!gallery) { ciEntries = []; ciTabs = []; ciObserver?.disconnect(); return; }
    ciEntries = Array.from(gallery.querySelectorAll(".work-entry"));
    ciTabs = Array.from(gallery.querySelectorAll(".poem-tabs a"));
    gallery.dataset.ciReady = "true";
    // 给条目编号水印，并把词作正文按句拆成独立行，便于逐行浮现；注入词牌大水印
    ciEntries.forEach((entry, idx) => {
      entry.dataset.index = String(idx + 1).padStart(2, "0");
      const poemText = entry.querySelector(".poem-text");
      if (poemText && !poemText.dataset.linesReady) {
        const raw = poemText.innerHTML;
        const segments = raw.split(/<br\s*\/?>/i).map((s) => s.trim()).filter((s) => s.length > 0);
        poemText.innerHTML = segments.map((seg, i) => {
          if (seg === "") return `<span class="poem-line-gap"></span>`;
          return `<span class="poem-line" data-line="${i}">${seg}</span>`;
        }).join("");
        poemText.dataset.linesReady = "true";
      }
      if (!entry.querySelector(".work-watermark")) {
        const h3 = entry.querySelector(".work-main h3");
        const title = (h3 ? h3.childNodes[0]?.textContent?.trim() : entry.id) || entry.id;
        const wm = document.createElement("span");
        wm.className = "work-watermark";
        wm.textContent = title;
        entry.appendChild(wm);
      }
    });
    const setActive = (activeEntry) => {
      if (!activeEntry) return;
      ciEntries.forEach((entry) => entry.classList.toggle("is-active", entry === activeEntry));
      const id = activeEntry.id;
      ciTabs.forEach((tab) => {
        const match = tab.getAttribute("href") === `#${id}`;
        tab.classList.toggle("is-active", match);
      });
    };
    ciObserver?.disconnect();
    ciObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]) setActive(visible[0].target);
    }, { threshold: [0.3, 0.5, 0.7], rootMargin: "-16% 0px -32% 0px" });
    ciEntries.forEach((entry) => ciObserver.observe(entry));
    ciTabs.forEach((tab) => {
      tab.addEventListener("click", (event) => {
        const id = tab.getAttribute("href")?.slice(1);
        const target = id ? document.getElementById(id) : null;
        if (target) {
          event.preventDefault();
          target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        }
      });
    });
  };

  const timelineStories = [
    {
      period: "937 · 金陵",
      title: "生于南唐，长于宫苑",
      paragraphs: [
        "李煜生于南唐都城金陵，初名从嘉，七夕之夜降于宫苑。祖父李昪代吴建唐，父李璟是为中主；南唐承接江南文脉，宫廷中诗书、音乐、书画相互滋养，烈祖、中主两代皆好文翰。",
        "他生得丰额骈齿、一目重瞳——史书称之为奇相，却也因这份「帝王之相」，招来长兄太子弘冀的猜忌。他因而自号「钟隐」「莲峰居士」，志在山水经籍，远离权力之侧。",
        "少年李煜的教养是全方位的：诗文、音律、书画、鉴赏无所不工。这份艺术修养之深，后来既成就了他的词，也常常被史家看作他不谙政事的注脚——才华与江山，从他出生起便同负一身。",
        "读他早期描写宫廷夜宴的词作，语言明丽、意象细密，声色光影如在目前。那些词不只是繁华的装饰，也保存了南唐宫廷审美的最后一段好时光。"
      ],
      poem: "红日已高三丈透，金炉次第添香兽。",
      poemNote: "《浣溪沙》"
    },
    {
      period: "954 · 金陵",
      title: "娥皇入府，丝竹正欢",
      paragraphs: [
        "十八岁那年，李煜迎娶周宗长女周娥皇。她通书史、善歌舞、尤工琵琶，史载中主曾赐焦桐琵琶以为贺——这桩婚姻起初是政治联姻，结局却成了难得的知音相守。",
        "两人最著名的一段佳话，是重订《霓裳羽衣曲》。这支盛唐大曲至南唐仅存残谱，娥皇凭残谱以琵琶弹奏补缀，使开元遗音复闻于世。宫中夜宴因此有了盛唐气象的余响。",
        "这一时期的词，几乎句句有光：晚妆、明肌、春殿、鱼贯的嫔娥，嚼碎了红茸笑向檀郎的闺中憨态。语言轻倩婉丽，情致旖旎而不失分寸。",
        "后世论者常以「艳科」轻视这些早期作品。但正是在这段安稳欢愉的岁月里，他把词的音律打磨得纯熟、把意象锤炼得精准——没有这份技艺的储蓄，便没有亡国后那些血泪之作。"
      ],
      poem: "烂嚼红茸，笑向檀郎唾。",
      poemNote: "《一斛珠》"
    },
    {
      period: "961 · 金陵",
      title: "仓促登上帝位",
      paragraphs: [
        "变故接连而至：959年，太子弘冀暴卒——他数月前刚刚毒杀叔父景遂，旋即病亡，史书多以为疑。储位之争烟消云散，李煜被改封吴王、居东宫，反而成了事实上的长子。",
        "961年二月，中主李璟迫于后周兵锋迁都洪州，立李煜为太子、留金陵监国；六月，中主病逝于洪州。二十五岁的李煜在金陵柩前即位，史称后主。",
        "他接手的南唐，已是去帝号、奉正朔、岁贡不绝的属国之局：北方的宋刚刚代周而立，兵锋所指，天下侧目。新君的一切举措，都在这架夹缝中的天平上称量。",
        "即位初期的词仍见宴游与柔美——春殿嫔娥、雪夜焚香。这不是不知愁，而是江南宫廷最后的从容。纸面越华丽，纸下的愁云便越值得细看。"
      ],
      poem: "晚妆初了明肌雪，春殿嫔娥鱼贯列。",
      poemNote: "《玉楼春》"
    },
    {
      period: "964 · 金陵",
      title: "大周后逝，仲宣夭折",
      paragraphs: [
        "964年，与他词曲相和十年的昭惠周后病重。相传病中她曾见小周后入宫，深受刺激；同年冬，次子仲宣——那个传说中五岁能诵《孝经》的神童——受惊夭折。雪上加霜，昭惠后于十一月病逝。",
        "李煜哀悼骨立，亲自撰写诔文，题为《昭惠周后诔》，洋洋数千言，落款不称帝号，自署「鳏夫煜」。一个国君以「鳏夫」自名，这是他一生最私人的哀恸。",
        "失去了音律上的知音与生活里的伴侣，他的词从此多了一层追忆与空凉。先前词中的欢愉是「进行时」的，此后却渐渐变成「回忆时」的——这个语感的变化，是理解他词风演进的关键。",
        "数年之后，其妹小周后入宫继立为后。宫中再次有了丝竹，但国势日蹙、旧痛未消，那点光亮照不进越来越紧的时代夹缝里。"
      ],
      poem: "别来春半，触目愁肠断。",
      poemNote: "《清平乐》"
    },
    {
      period: "971 · 金陵",
      title: "去唐号，称江南国主",
      paragraphs: [
        "971年，弟弟郑王李从善入贡汴京，被宋太祖扣留不归。这是明确的信号：宋已把南唐视作囊中之物，只待时日。",
        "李煜的反应是退让：上表削去「唐」国号，改称「江南国主」；贬损仪制、改易官名，宫殿去除鸱吻以示不敢僭越，岁贡规模只增不减。他几乎把一个政权能自我矮化的部分都做了。",
        "这些姿态换不来安全。宋的方针早已定下——「卧榻之侧，岂容他人鼾睡」。李煜的每一次退让，在宋的日程表里只是延缓了统一战争的日期，却改变不了结局。",
        "梦境成了唯一的还乡路：梦里的上苑车如流水马如龙，醒来却是对宋称臣的江南国主。梦里梦外的落差，后来成为他词中最动人的结构之一。"
      ],
      poem: "还似旧时游上苑，车如流水马如龙。",
      poemNote: "《忆江南》"
    },
    {
      period: "974 · 采石矶",
      title: "大军踏江，金陵成孤岛",
      paragraphs: [
        "宋人樊若水（后赐名知古）早年在南唐不得志，暗中以丝绳度江，精确测得采石矶江面宽度，随后入宋献策：于此处架浮桥，大军可如履平地渡江。",
        "974年冬，曹彬、潘美率军十万，战船相连、上铺竹筏，三日之内于采石矶江面架成浮桥。大军踏桥而渡，如履坦途——长江天险，一夜之间成了通途。",
        "采石矶一破，金陵顿成孤城。南唐君臣尚在议和、纳贡、乞延缓之间徘徊，而宋军的部署步步收紧。天险既失，所谓「三千里地山河」，在军事地图上只剩下一个被围困的圆点。",
        "后来李煜在词里追写这个王朝的底账：四十年的国祚、三千里的山河、凤阁龙楼的旧日——所有这些，都终结在一道浮桥踏江的冬天。"
      ],
      poem: "四十年来家国，三千里地山河。",
      poemNote: "《破阵子》"
    },
    {
      period: "975 · 金陵",
      title: "故国山河，一朝易主",
      paragraphs: [
        "围城自974年冬持续到975年冬，城中渐至米尽、愁思日深。975年十一月廿七，金陵城破；李煜肉袒出降——这是献俘之礼：袒露上身、口衔玉璧，以示自缚请罪。",
        "离宫之际，教坊乐工奏起别离的曲子，宫娥啼泣相送。他后来在《破阵子》里追写这一幕，几乎不作修饰，只把「仓皇」二字留给四十年家国的落幕。",
        "「垂泪对宫娥」历来聚讼纷纭：论者或责其不哭宗庙社稷、独对宫娥。但细读便知——宗庙、社稷在词人那里化作宫娥与教坊的具体面孔，国亡于是有了体温。这正是他作为词人与作为君主的不同。",
        "金陵的宫阙、钟山的林泉、秦淮的灯影，从此都只能出现在梦里。一叶舟载着他顺江而下、转道北上——那是他第一次以囚徒的身份看这条江。"
      ],
      poem: "最是仓皇辞庙日，教坊犹奏别离歌，垂泪对宫娥。",
      poemNote: "《破阵子·四十年来家国》"
    },
    {
      period: "976 · 汴京",
      title: "违命侯，泪洗面",
      paragraphs: [
        "976年正月，李煜被押至汴京，宋太祖封他为「违命侯」——这个封号本身就是羞辱：一生文雅，终以「违命」名世。同年十月，太祖崩，晋王赵光义即位，是为太宗。",
        "太宗即位后去其「违命侯」之号，改封陇西公。名分稍正，处境未改：府第有司看守，行动不获自由，与旧臣往来皆成禁忌。",
        "他在给金陵旧宫人的信里写道：「此中日夕，只以眼泪洗面。」昔日一国之主，如今以泪度日——这不是修辞，是他留给后世的实况自述。",
        "正是在这样的日子里，词成了他唯一的疆土。《相见欢》里无言独上西楼，月如弯钩，梧桐深院锁住的不只是清秋，也是一个失去了所有去处的灵魂。"
      ],
      poem: "无言独上西楼，月如钩。寂寞梧桐深院锁清秋。",
      poemNote: "《相见欢》"
    },
    {
      period: "978 · 汴京",
      title: "一江春水，词成人逝",
      paragraphs: [
        "978年七夕，是李煜四十二岁生日。囚居的生辰，他让故妓在府中作乐，写下《虞美人》：春花秋月何时了——以问句起头，以一江春水收束，把无尽的愁绪第一次写成了有方向、有流量的实体。",
        "词声闻于外，传到宋太宗耳中。史载是夜李煜暴卒，后世多传为太宗赐牵机药所致——牵机药发时，人头足相就如牵机状，其状至惨。此说细节或有传闻成分，但他的死与这首词直接相关，是历代史家的共识。",
        "《虞美人》因此被称作他的绝命词。六个字一句、九个字一句的往复，像不肯停下的追问；问君能有几多愁，问的哪里是愁，问的是一生。",
        "他死后，这个曾在江南设宗庙社稷的词人，只剩下一卷词集流传。而那卷词里最重的一页，恰恰写于生命最后一夜。"
      ],
      poem: "问君能有几多愁？恰似一江春水向东流。",
      poemNote: "《虞美人·春花秋月何时了》"
    },
    {
      period: "978 · 北邙",
      title: "王礼归葬，词心不朽",
      paragraphs: [
        "李煜死后，宋廷追封吴王，以王礼葬于洛阳北邙山——生于七夕，死于七夕，葬于北邙，他的一生在符号意义上都像一首词的结构。",
        "小周后哀毁骨立，不久亦逝，与后主相继归葬。江南旧臣有设奠相送者，旧宫人闻讯恸哭——他们送别的不只是故主，也是那个再也回不去的江南。",
        "千年来，他的词名愈盛：王国维《人间词话》说「词至李后主而眼界始大，感慨遂深，遂变伶工之词而为士大夫之词」，又说他的词「真所谓以血书者也」。一个亡国之君，最终以词在文学史上获得了另一种「国祚」。",
        "流水落花春去也，天上人间。北邙的孤冢挡不住这些句子——它们越过千年，仍在每一个春水东流的时刻，抵达新的读者。"
      ],
      poem: "流水落花春去也，天上人间。",
      poemNote: "《浪淘沙令》"
    }
  ];

  let timelineReturnFocus = null;
  const initializeTimelineStories = () => {
    const dialog = document.querySelector(".timeline-story-dialog");
    if (!dialog) return;
    const closeButton = dialog.querySelector(".timeline-story-close");
    const kicker = dialog.querySelector(".timeline-story-kicker");
    const title = dialog.querySelector("#timeline-story-title");
    const content = dialog.querySelector(".timeline-story-content");
    if (dialog.dataset.initialized !== "true") {
      const closeStory = () => {
        if (dialog.open) dialog.close();
      };
      closeButton.addEventListener("click", closeStory);
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeStory();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && dialog.open) {
          event.preventDefault();
          closeStory();
        }
      });
      dialog.addEventListener("close", () => {
        if (timelineReturnFocus?.isConnected) timelineReturnFocus.focus({ preventScroll: true });
      });
      dialog.dataset.initialized = "true";
    }
    document.querySelectorAll(".timeline-card[aria-haspopup='dialog']").forEach((card, index) => {
      const openStory = () => {
        const story = timelineStories[index];
        if (!story) return;
        timelineReturnFocus = card;
        kicker.textContent = story.period;
        title.textContent = story.title;
        content.replaceChildren();
        story.paragraphs.forEach((text) => {
          const paragraph = document.createElement("p");
          paragraph.textContent = text;
          content.append(paragraph);
        });
        const quote = document.createElement("blockquote");
        quote.textContent = `“${story.poem}”`;
        const attribution = document.createElement("span");
        attribution.className = "timeline-story-attribution";
        attribution.textContent = story.poemNote;
        content.append(quote, attribution);
        dialog.showModal();
        closeButton.focus();
      };
      card.addEventListener("click", openStory);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openStory();
        }
      });
    });
  };

  const memoryStories = [
    {
      kicker: "HISTORY · SOUTHERN TANG",
      title: "南唐末主：从金陵到汴京",
      paragraphs: [
        "李煜于961年继位。南唐当时已处于北宋持续扩张的压力之下，他以称臣、纳贡等方式求取喘息空间，但最终未能扭转国势。",
        "975年，宋军攻取金陵，南唐灭亡。李煜被俘后迁居汴京，曾受封违命侯。由君主成为异乡囚居者，这一身份与生活的骤变，构成理解其后期词作的重要背景。",
        "从史实看，政权覆亡有复杂的军事与政治原因，不宜简化为个人性格的结果。时间轴记录的是可考的大事；作品呈现的，则是这些变故如何转化为一个人的记忆与感受。"
      ]
    },
    {
      kicker: "POETRY · IMAGERY & VOICE",
      title: "词句中的他：把愁写成江水",
      paragraphs: [
        "李煜前期词多写宫廷宴乐、男女情思与日常感受，语言婉丽；南唐覆亡后，故国、往事与身世之痛进入作品，词境变得沉郁开阔。",
        "他善于把抽象情绪化成可感的景象：春花秋月让时间与往事浮现，深院梧桐衬出孤寂，流水则使愁绪有了方向与绵延感。",
        "《虞美人》结尾以“一江春水”比喻无尽愁绪，既是个人哀思，也因意象明白而富有余韵，成为后世反复传诵的名句。"
      ]
    },
    {
      kicker: "AFTERLIFE · READERS & ADAPTATIONS",
      title: "今人心中的他：被不断重新看见",
      paragraphs: [
        "李煜离开千年后，读者仍会在他的词里辨认离别、怀旧与无常。每个时代带着自己的经验阅读，因此会照见不同侧面的词人。",
        "舞台、影视、游戏与网络创作也不断重述李煜：有的突出帝王身份，有的聚焦亡国后的漂泊，也有的从他的词句出发，讲述普通人的离愁。",
        "这些当代形象属于艺术演绎，并非李煜真实容貌或生平史料的直接记录。把史实与想象区分开来，既能欣赏再创作，也能回到作品本身，继续读出新的理解。"
      ]
    }
  ];

  const initializeMemoryStories = () => {
    const dialog = document.querySelector(".memory-story-dialog");
    if (!dialog) return;
    const closeButton = dialog.querySelector(".memory-story-close");
    const kicker = dialog.querySelector(".memory-story-kicker");
    const title = dialog.querySelector("#memory-story-title");
    const content = dialog.querySelector(".memory-story-content");
    const image = dialog.querySelector(".memory-story-image");
    let returnFocus = null;

    if (document.documentElement.dataset.memoryDialogEscapeBound !== "true") {
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        const openDialog = document.querySelector(".memory-story-dialog[open]");
        if (!openDialog) return;
        event.preventDefault();
        openDialog.close();
      });
      document.documentElement.dataset.memoryDialogEscapeBound = "true";
    }

    if (dialog.dataset.initialized !== "true") {
      closeButton.addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
      dialog.addEventListener("close", () => {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      });
      dialog.dataset.initialized = "true";
    }

    const showStory = (story, trigger, artwork = null) => {
      returnFocus = trigger;
      kicker.textContent = story.kicker;
      title.textContent = story.title;
      content.replaceChildren();
      story.paragraphs.forEach((text) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        content.append(paragraph);
      });
      if (artwork) {
        image.src = artwork.src;
        image.alt = artwork.alt;
        image.hidden = false;
      } else {
        image.hidden = true;
        image.removeAttribute("src");
        image.alt = "";
      }
      dialog.showModal();
      closeButton.focus();
    };

    document.querySelectorAll(".memory-line article[aria-haspopup='dialog']").forEach((card, index) => {
      const openStory = () => {
        const story = memoryStories[index];
        if (!story) return;
        showStory(story, card);
      };
      card.addEventListener("click", (event) => {
        if (event.target.closest("a, button")) return;
        openStory();
      });
      card.addEventListener("keydown", (event) => {
        if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        openStory();
      });
    });

    document.querySelectorAll(".media-art[aria-haspopup='dialog']").forEach((artwork) => {
      const openArtwork = () => {
        const image = artwork.querySelector("img");
        const slide = artwork.closest(".media-slide");
        const caption = artwork.closest(".media-card")?.querySelector(".media-caption")
          || (slide ? document.querySelector('.media-carousel-info .media-caption[data-slide="' + slide.dataset.index + '"]') : null);
        const heading = caption?.querySelector("h3");
        if (!image || !caption || !heading) return;
        const paragraphs = [];
        const subheading = caption.querySelector("h4")?.textContent.trim();
        if (subheading) paragraphs.push(subheading);
        caption.querySelectorAll("p:not(.media-caption-note)").forEach((paragraph) => {
          if (paragraph.textContent.trim()) paragraphs.push(paragraph.textContent.trim());
        });
        const note = caption.querySelector(".media-caption-note")?.textContent.trim();
        if (note) paragraphs.push(note);
        showStory({
          kicker: caption.querySelector("span")?.textContent.trim() || "李煜 · 当代叙事",
          title: heading.textContent.trim(),
          paragraphs
        }, artwork, { src: image.currentSrc || image.src, alt: image.alt });
      };
      artwork.addEventListener("click", openArtwork);
      artwork.addEventListener("keydown", (event) => {
        if (event.target !== artwork || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        openArtwork();
      });
    });
  };

  const animateWrittenLineAway = (form, text) => {
    if (reducedMotion) return;
    form.querySelector(".wind-release")?.remove();
    const effect = document.createElement("div");
    effect.className = "wind-release";
    effect.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      const current = document.createElement("span");
      current.className = "wind-current";
      current.style.setProperty("--wind-index", String(index));
      current.style.setProperty("--wind-angle", `${index * -13}deg`);
      effect.append(current);
    }
    const phrase = document.createElement("span");
    phrase.className = "wind-phrase";
    Array.from(text).forEach((character, index) => {
      const glyph = document.createElement("span");
      glyph.className = "wind-glyph";
      glyph.textContent = character;
      glyph.style.setProperty("--wind-delay", `${Math.min(index, 50) * 12}ms`);
      glyph.style.setProperty("--wind-x", `${Math.round((Math.random() - 0.42) * 180)}px`);
      glyph.style.setProperty("--wind-y", `${Math.round(-45 + Math.random() * 105)}px`);
      glyph.style.setProperty("--wind-turn", `${Math.round((Math.random() - 0.5) * 300)}deg`);
      phrase.append(glyph);
    });
    effect.append(phrase);
    form.append(effect);
    window.setTimeout(() => effect.remove(), 1800);
  };

  const initializeBambooLeaves = () => {
    const canvas = document.querySelector(".bamboo-leaves");
    if (!canvas || reducedMotion || canvas.dataset.initialized === "true") return;
    canvas.dataset.initialized = "true";
    const context = canvas.getContext("2d");
    if (!context) return;
    let width = 0;
    let height = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const leafCount = window.innerWidth <= 700 ? 9 : 18;
    const rand = (min, max) => min + Math.random() * (max - min);
    const makeLeaf = (fromTop) => ({
      x: rand(-40, width + 40),
      y: fromTop ? rand(-120, -10) : rand(0, height),
      baseX: 0,
      vx: rand(-0.18, 0.18),
      vy: rand(0.32, 0.85),
      size: rand(16, 34),
      rotation: rand(0, Math.PI * 2),
      rotationSpeed: rand(-0.006, 0.006),
      opacity: rand(0.42, 0.82),
      phase: rand(0, Math.PI * 2),
      swingSpeed: rand(0.004, 0.012),
      swingAmp: rand(8, 26),
      flip: rand(0, Math.PI * 2),
      flipSpeed: rand(0.003, 0.011),
      hueShift: Math.random()
    });
    let leaves = Array.from({ length: leafCount }, () => makeLeaf(true));
    const drawLeaf = (leaf) => {
      context.save();
      context.translate(leaf.x, leaf.y);
      context.rotate(leaf.rotation);
      const flipScale = Math.abs(Math.cos(leaf.flip));
      context.scale(flipScale * 0.9 + 0.1, 1);
      const s = leaf.size;
      // 金竹渐变：根深、尖亮
      const gold = leaf.hueShift > 0.5 ? "#c7aa77" : "#b8955f";
      const goldLight = leaf.hueShift > 0.5 ? "#e7cc8e" : "#d9b974";
      const gradient = context.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
      gradient.addColorStop(0, goldLight);
      gradient.addColorStop(0.5, gold);
      gradient.addColorStop(1, "rgba(120,92,48,0.85)");
      context.fillStyle = gradient;
      context.globalAlpha = leaf.opacity;
      // 竹叶形：两端尖的细长梭形
      context.beginPath();
      context.moveTo(0, -s * 0.5);
      context.bezierCurveTo(s * 0.16, -s * 0.2, s * 0.16, s * 0.2, 0, s * 0.5);
      context.bezierCurveTo(-s * 0.16, s * 0.2, -s * 0.16, -s * 0.2, 0, -s * 0.5);
      context.closePath();
      context.fill();
      // 中脉
      context.globalAlpha = leaf.opacity * 0.5;
      context.strokeStyle = "rgba(90,66,28,0.7)";
      context.lineWidth = Math.max(0.5, s * 0.04);
      context.beginPath();
      context.moveTo(0, -s * 0.46);
      context.lineTo(0, s * 0.46);
      context.stroke();
      context.restore();
    };
    let running = true;
    let last = performance.now();
    const render = (now) => {
      if (!running) return;
      const dt = Math.min(48, now - last) / 16.67;
      last = now;
      context.clearRect(0, 0, width, height);
      leaves.forEach((leaf) => {
        leaf.phase += leaf.swingSpeed * dt;
        leaf.flip += leaf.flipSpeed * dt;
        leaf.x += (leaf.vx + Math.sin(leaf.phase) * leaf.swingAmp * 0.02) * dt;
        leaf.y += leaf.vy * dt;
        leaf.rotation += leaf.rotationSpeed * dt;
        if (leaf.y > height + 60 || leaf.x < -80 || leaf.x > width + 80) {
          Object.assign(leaf, makeLeaf(true));
          leaf.y = rand(-100, -20);
          leaf.x = rand(-20, width + 20);
        }
        drawLeaf(leaf);
      });
      window.requestAnimationFrame(render);
    };
    window.requestAnimationFrame(render);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        running = false;
      } else if (!running) {
        running = true;
        last = performance.now();
        window.requestAnimationFrame(render);
      }
    });
  };

  const initializeDepthInteractions = () => {
    if (reducedMotion || window.innerWidth <= 700 || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    document.querySelectorAll(".poem-card, .timeline-card, .memory-line article, .intro-card, .hero-art, .floating-verse, .sound-orbit, .recite-art").forEach((surface) => {
      if (surface.dataset.depthInitialized === "true") return;
      surface.dataset.depthInitialized = "true";
      surface.classList.add("depth-surface");
      const resetTilt = () => {
        surface.classList.remove("is-depth-active");
        surface.style.removeProperty("--depth-rotation");
      };
      surface.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch") return;
        const bounds = surface.getBoundingClientRect();
        const horizontal = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
        const vertical = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
        const tiltX = -vertical * 2.4;
        const tiltY = horizontal * 2.4;
        const angle = Math.hypot(tiltX, tiltY);
        const axisX = angle ? tiltX / angle : 0;
        const axisY = angle ? tiltY / angle : 1;
        surface.style.setProperty("--depth-rotation", `${axisX.toFixed(3)} ${axisY.toFixed(3)} 0 ${angle.toFixed(2)}deg`);
        surface.classList.add("is-depth-active");
      });
      surface.addEventListener("pointerleave", resetTilt);
      surface.addEventListener("pointercancel", resetTilt);
    });
  };

  const initializeMagneticButtons = () => {
    if (reducedMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    document.querySelectorAll(".button-dark, .book-open-button").forEach((button) => {
      if (button.dataset.magnetReady === "true") return;
      button.dataset.magnetReady = "true";
      const reset = () => {
        button.style.removeProperty("--mag-x");
        button.style.removeProperty("--mag-y");
      };
      button.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch") return;
        const bounds = button.getBoundingClientRect();
        const dx = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
        const dy = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
        button.style.setProperty("--mag-x", `${(dx * 3.4).toFixed(1)}px`);
        button.style.setProperty("--mag-y", `${(dy * 2.6).toFixed(1)}px`);
      });
      button.addEventListener("pointerleave", reset);
      button.addEventListener("pointercancel", reset);
    });
  };

  function initializePageContent() {
  initializeScrollInteractions();
  initializeHeroPointerParallax();
  updateTimelineNarrative();
  initializeBambooLeaves();
  initializeDepthInteractions();
  initializeMagneticButtons();
  initializeTimelineStories();
  initializeMemoryStories();
  let speaking = false;
  // f68 诵读呼吸：同一时刻只允许一枚诵读按钮处于 .is-speaking 态，切换前先统一清除
  const clearSpeakingButtons = () => {
    document.querySelectorAll(".read-aloud.is-speaking").forEach((b) => b.classList.remove("is-speaking"));
  };
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
        clearSpeakingButtons();
        button.classList.add("is-speaking"); // 当前诵读中的按钮挂呼吸态（CSS 让它朱砂色呼吸）
      };
      utterance.onend = () => {
        speaking = false;
        button.textContent = "为我诵读　▶";
        clearSpeakingButtons(); // 诵读结束，撤掉呼吸态
      };
      utterance.onerror = () => {
        speaking = false;
        button.textContent = "诵读未能播放，请重试";
        clearSpeakingButtons(); // 播报失败同样不能把按钮留在呼吸态
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
      // f68 收藏弹跳：仅在「收藏成功」瞬间播一次 .pop 动画（先移除再强制重排以重启动画）
      if (selected) {
        button.classList.remove("pop");
        void button.offsetWidth;
        button.classList.add("pop");
        button.addEventListener("animationend", () => button.classList.remove("pop"), { once: true });
      }
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

  /* ---------- f68 表单反馈：抖动 + 两态文案（ok 绿 / err 朱砂） + 轻浮入场 ---------- */
  // 抖动提示：移除→强制重排→重挂 shake 动画，保证连续点击也能重复播
  const shakeField = (field) => {
    field.classList.remove("shake");
    void field.offsetWidth;
    field.classList.add("shake");
    field.addEventListener("animationend", () => field.classList.remove("shake"), { once: true });
  };
  // 写入反馈文案并切换两态配色，支持 animate 的浏览器再补一段淡入上浮
  const showFeedback = (el, message, state) => {
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-ok", state === "ok");
    el.classList.toggle("is-err", state === "err");
    if (typeof el.animate === "function") {
      el.animate([{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "ease-out" });
    }
  };

  document.querySelector(".mood-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const field = document.getElementById("mood");
    const feedback = document.querySelector(".mood-feedback");
    if (!field.value.trim()) {
      showFeedback(feedback, "写下一点心情，再让它随春水而去。", "err");
      shakeField(field); // 空提交：抖动文本框 + 朱砂错误文案
      field.focus();
      return;
    }
    showFeedback(feedback, "收到了。愿这份心情，在词里找到回声。", "ok"); // 成功：墨绿文案 + 淡入上浮
    field.value = "";
    document.getElementById("mood-count").textContent = "0 / 80";
  });
  document.querySelectorAll(".prompt-words button").forEach((button) => {
    button.addEventListener("click", () => {
      const field = document.getElementById("my-line");
      field.value = `${field.value}${button.dataset.prompt}`;
      field.focus();
      field.dispatchEvent(new Event("input", { bubbles: true }));
      // f68 快捷词插入：文本框底色闪一下朱砂淡光，提示「已写入」
      if (typeof field.animate === "function") {
        field.animate([{ backgroundColor: "rgba(169,104,76,.14)" }, { backgroundColor: "transparent" }], { duration: 600, easing: "ease-out" });
      }
    });
  });
  document.querySelector(".poem-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const field = document.getElementById("my-line");
    const feedback = document.querySelector(".poem-feedback");
    if (!field.value.trim()) {
      showFeedback(feedback, "先写下一句心情，再让涟漪带走它。", "err");
      shakeField(field); // 词签表单同样抖动 + 朱砂错误态
      field.focus();
      return;
    }
    const writtenLine = field.value.trim();
    animateWrittenLineAway(event.currentTarget, writtenLine);
    showFeedback(feedback, `“${writtenLine}” —— 已随风带入词境。`, "ok");
    field.value = "";
    document.getElementById("line-count").textContent = "0 / 100";
  });

  // 文创笺铺：全站右侧滑出抽屉（概念展示，不存在任何真实下单/支付链路）
  (function initializeShopSidebar() {
    if (document.querySelector(".shop-tab")) return;
    const goods = [
      { img: ASSET_IMAGE + "shop-paper.jpg", alt: "浣花春水笺概念图：带春水暗纹的宣纸信笺", meta: "文房信笺 · 灵感《虞美人》", name: "浣花春水笺", desc: "一套八张的仿古宣笺，以「一江春水」波纹作暗纹，落梅点缀纸角。提笔写信时，愁绪也化作了东流的水。" },
      { img: ASSET_IMAGE + "shop-bookmark.jpg", alt: "月钩梧桐书签概念图：弯月梧桐造型的黄铜楠木书签", meta: "流苏书签 · 灵感《相见欢》", name: "月钩梧桐签", desc: "黄铜为钩月，楠木作梧桐，垂一缕墨色流苏。「无言独上西楼」的那夜月色，从此夹在正在读的那一页。" },
      { img: ASSET_IMAGE + "shop-scroll.jpg", alt: "春水东流卷轴概念图：绘有江山孤舟的中式水墨挂轴", meta: "卷轴壁纸 · 灵感《虞美人》", name: "春水东流卷", desc: "一款可打印的数字长卷壁纸，亦可装裱为案头小挂轴。远山、孤舟与东流江水展开在屏幕上，愁有了形状，也有了归处。" },
      { img: ASSET_IMAGE + "shop-postcard.jpg", alt: "春花秋月明信片概念图：四张一套的水墨词意明信片", meta: "词意明信片 · 灵感四阕代表作", name: "春花秋月帖", desc: "四阕词、四帧景：春水花月、深院梧桐、暮雨归梦、落梅春草。背面印词，正面入画，寄给此刻想念的人。" },
      { img: ASSET_IMAGE + "shop-tape.jpg", alt: "落花流水胶带概念图：绘有落花春水纹样的三卷和纸胶带", meta: "和纸胶带 · 灵感《浪淘沙令》", name: "落花流水纹", desc: "「流水落花春去也」化作两卷手账胶带：一卷落花，一卷水纹。贴在日记边角，给普通的一天盖上词的落款。" },
      { img: ASSET_IMAGE + "shop-seal.jpg", alt: "煜字朱砂闲章概念图：石质印章与朱砂拓印", meta: "朱砂闲章 · 灵感词帝之名", name: "「煜」字小印", desc: "一方朱文小印，刻他的名字，也刻「一江春水」四字作引首章。盖在书的扉页，像与千年前的词人同署了一页。" }
    ];
    const cardsHtml = goods.map((item) => `
      <article class="shop-card">
        <div class="shop-art"><img src="${item.img}" alt="${item.alt}" loading="lazy" decoding="async"><span class="shop-ribbon">概念 · 非卖</span></div>
        <div class="shop-body">
          <p class="shop-meta">${item.meta}</p>
          <h3>${item.name}</h3>
          <p>${item.desc}</p>
          <button class="concept-buy" type="button" data-name="${item.name}">立即选购 <span>↗</span></button>
        </div>
      </article>`).join("");

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "shop-tab";
    tab.setAttribute("aria-label", "打开文创笺铺侧边栏（概念展示，非真实售卖）");
    tab.setAttribute("aria-expanded", "false");
    tab.innerHTML = "文创笺铺<small>概念展示</small>";

    const mask = document.createElement("div");
    mask.className = "shop-mask";
    mask.setAttribute("aria-hidden", "true");

    const drawer = document.createElement("aside");
    drawer.className = "shop-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "文创笺铺：概念文创展示");
    drawer.innerHTML = `
      <div class="shop-drawer-head">
        <span class="shop-drawer-seal" aria-hidden="true">煜</span>
        <div><h2>文创笺铺</h2><small>CONCEPT GOODS · 概念文创</small></div>
        <button class="shop-drawer-close" type="button" aria-label="关闭文创笺铺">×</button>
      </div>
      <div class="shop-drawer-body">
        <div class="shop-drawer-notice" role="note">
          <b>概念展示 · 非卖品</b>
          <p>本栏为竞赛概念设计，所列文创均为虚拟方案，不设价格、订单与任何真实支付通道，仅呈现李煜文化 IP 的当代文创活化思路。</p>
        </div>
        ${cardsHtml}
        <div class="shop-drawer-idea">
          <h3>从一句词，到一件可以带走的物</h3>
          <ol>
            <li>取象于词：提取春水、钩月、梧桐、落梅等核心意象；</li>
            <li>转译于器：化作信笺、书签、卷轴等日常器物；</li>
            <li>活化于今：让宋词进入书写、阅读、手账等当代生活。</li>
          </ol>
        </div>
        <p class="shop-drawer-foot">图稿为设计意向示意 · 不代表真实在售商品</p>
      </div>`;

    const dialog = document.createElement("dialog");
    dialog.className = "shop-notice-dialog";
    dialog.setAttribute("aria-labelledby", "shop-notice-title");
    dialog.innerHTML = `
      <button class="shop-notice-close" type="button" aria-label="关闭提示">×</button>
      <span class="shop-notice-seal" aria-hidden="true">示</span>
      <span class="shop-notice-kicker">CONCEPT NOTICE · 概念说明</span>
      <h2 id="shop-notice-title">感谢关注<span data-shop-name></span></h2>
      <p class="shop-notice-message">此为竞赛概念设计，暂无真实售卖通道，仅展示文创转化思路。</p>
      <p class="shop-notice-sub">本栏所有「文创」均为虚拟概念方案，不产生价格、订单与支付。</p>
      <button class="shop-notice-ok" type="button">我知道了</button>`;

    document.body.append(tab, mask, drawer, dialog);

    let drawerOpen = false;
    let lastFocused = null;
    const openDrawer = () => {
      drawerOpen = true;
      lastFocused = document.activeElement;
      drawer.classList.add("is-open");
      mask.classList.add("is-open");
      tab.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      drawer.querySelector(".shop-drawer-close").focus();
      document.dispatchEvent(new Event("shop-drawer-open"));
    };
    const closeDrawer = () => {
      if (!drawerOpen) return;
      drawerOpen = false;
      drawer.classList.remove("is-open");
      mask.classList.remove("is-open");
      tab.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    };
    tab.addEventListener("click", () => (drawerOpen ? closeDrawer() : openDrawer()));
    mask.addEventListener("click", closeDrawer);
    drawer.querySelector(".shop-drawer-close").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawerOpen && !dialog.open) closeDrawer();
    });
    document.addEventListener("jy-drawer-open", closeDrawer);
    document.addEventListener("share-drawer-open", closeDrawer);

    const nameSlot = dialog.querySelector("[data-shop-name]");
    drawer.querySelectorAll(".concept-buy").forEach((button) => {
      button.addEventListener("click", () => {
        nameSlot.textContent = button.dataset.name ? `「${button.dataset.name}」` : "";
        if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      });
    });
    const closeDialog = () => {
      if (dialog.open) dialog.close();
      else dialog.removeAttribute("open");
    };
    dialog.querySelectorAll(".shop-notice-close, .shop-notice-ok").forEach((button) => {
      button.addEventListener("click", closeDialog);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });
  })();

  // 笺语留言：全站侧边弹出面板。交互原型——仅存 localStorage，无公共数据库，
  // 留言只在用户本机浏览器可见，不提供公开评论发布。
  (function initializeJianyuSidebar() {
    if (document.querySelector(".jy-tab")) return;
    const STORAGE_KEY = "liyu-jianyu-v1";
    const presets = [
      { name: "金陵访客", time: "示范笺语", text: "读到「一江春水向东流」，才知愁绪也可以这样浩浩荡荡，流过千年仍不歇。" },
      { name: "西楼听雨", time: "示范笺语", text: "无言独上西楼，月如钩。今夜案头重读，恍与词人同看一钩残月。" },
      { name: "江南旧客", time: "示范笺语", text: "流水落花春去也，天上人间。愿每个读词的人，都有一刻安宁。" }
    ];
    const loadMine = () => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
      catch { return []; }
    };
    const saveMine = (list) => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { }
    };
    const escapeHtml = (value) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "shop-tab jy-tab";
    tab.setAttribute("aria-label", "打开笺语留言侧边栏（本地存储，不公开发布）");
    tab.setAttribute("aria-expanded", "false");
    tab.innerHTML = "笺语留言<small>本地笺筒</small>";

    const mask = document.createElement("div");
    mask.className = "shop-mask";
    mask.setAttribute("aria-hidden", "true");

    const drawer = document.createElement("aside");
    drawer.className = "shop-drawer jy-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "笺语留言：本地笺筒");
    drawer.innerHTML = `
      <div class="shop-drawer-head">
        <span class="shop-drawer-seal" aria-hidden="true">笺</span>
        <div><h2>笺语留言</h2><small>LOCAL LETTERS · 本地笺筒</small></div>
        <button class="shop-drawer-close" type="button" aria-label="关闭笺语留言">×</button>
      </div>
      <div class="shop-drawer-body">
        <div class="jy-list" aria-live="polite"></div>
        <form class="jy-write">
          <label for="jy-input">提笔留一句</label>
          <textarea id="jy-input" maxlength="100" placeholder="此刻读到哪一句，心里有波澜？（100 字以内）"></textarea>
          <div class="jy-write-foot">
            <span class="jy-count">0 / 100 · 仅存本机</span>
            <button class="jy-submit" type="submit">留下笺语</button>
          </div>
        </form>
        <div class="jy-note" role="note">
          <b>原型说明</b>
          本留言模块为交互原型，采用浏览器本地存储实现，留言仅保存在用户本机，无公共数据存储服务器，不提供公开可见的评论发布，用于演示用户互动设计思路。
        </div>
      </div>`;

    const toast = document.createElement("div");
    toast.className = "jy-toast";
    toast.setAttribute("role", "status");
    toast.textContent = "已存入本地笺筒";

    document.body.append(tab, mask, drawer, toast);

    const listEl = drawer.querySelector(".jy-list");
    const renderList = () => {
      const mine = loadMine();
      const mineHtml = mine.map((item) => `
        <div class="jy-msg jy-msg-mine">
          <p class="jy-msg-text">${escapeHtml(item.text)}</p>
          <div class="jy-msg-meta"><span class="jy-msg-name">读词人<span class="jy-mine-tag">我的</span></span><span class="jy-msg-time">${escapeHtml(item.time)}</span></div>
        </div>`).join("");
      const presetHtml = presets.map((item) => `
        <div class="jy-msg">
          <p class="jy-msg-text">${item.text}</p>
          <div class="jy-msg-meta"><span class="jy-msg-name">${item.name}</span><span class="jy-msg-time">${item.time}</span></div>
        </div>`).join("");
      listEl.innerHTML = mineHtml + presetHtml;
    };
    renderList();

    let drawerOpen = false;
    let lastFocused = null;
    let toastTimer = null;
    const openDrawer = () => {
      drawerOpen = true;
      lastFocused = document.activeElement;
      drawer.classList.add("is-open");
      mask.classList.add("is-open");
      tab.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      drawer.querySelector(".shop-drawer-close").focus();
      document.dispatchEvent(new Event("jy-drawer-open"));
    };
    const closeDrawer = () => {
      if (!drawerOpen) return;
      drawerOpen = false;
      drawer.classList.remove("is-open");
      mask.classList.remove("is-open");
      tab.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    };
    tab.addEventListener("click", () => (drawerOpen ? closeDrawer() : openDrawer()));
    mask.addEventListener("click", closeDrawer);
    drawer.querySelector(".shop-drawer-close").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawerOpen) closeDrawer();
    });
    document.addEventListener("shop-drawer-open", closeDrawer);
    document.addEventListener("share-drawer-open", closeDrawer);

    const textarea = drawer.querySelector("#jy-input");
    const counter = drawer.querySelector(".jy-count");
    textarea.addEventListener("input", () => {
      counter.textContent = `${textarea.value.length} / 100 · 仅存本机`;
    });
    drawer.querySelector(".jy-write").addEventListener("submit", (event) => {
      event.preventDefault();
      const text = textarea.value.trim();
      if (!text) {
        textarea.focus();
        return;
      }
      const mine = loadMine();
      const now = new Date();
      const time = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
      mine.unshift({ text, time });
      saveMine(mine);
      renderList();
      textarea.value = "";
      counter.textContent = "0 / 100 · 仅存本机";
      clearTimeout(toastTimer);
      toast.classList.add("is-show");
      toastTimer = setTimeout(() => toast.classList.remove("is-show"), 2200);
    });
  })();

  // 分享词境：全站侧边栏。微信朋友圈无网页直连通道，采用「扫码后转发」；
  // QQ空间动态、QQ好友、微博使用官方分享页，另提供复制链接与系统分享。
  (function initializeShareSidebar() {
    if (document.querySelector(".share-tab")) return;
    const pageUrl = location.href.split("#")[0];
    const pageTitle = "春水留痕·李煜词境";
    const pageDesc = "以一江春水为引，走进南唐后主的词境：读词人故事，赏四阕词笺，听一段诵读，留一句笺语。";
    const isHttp = location.protocol === "http:" || location.protocol === "https:";
    const pagePic = isHttp ? location.origin + "/assets/image/plum-blossom.jpg" : "";
    const enc = encodeURIComponent;
    const shareLinks = {
      qzone: "https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=" + enc(pageUrl) + "&title=" + enc(pageTitle) + "&summary=" + enc(pageDesc) + (pagePic ? "&pics=" + enc(pagePic) : ""),
      qqFriend: "https://connect.qq.com/widget/shareqq/index.html?url=" + enc(pageUrl) + "&title=" + enc(pageTitle) + "&summary=" + enc(pageDesc),
      weibo: "https://service.weibo.com/share/share.php?url=" + enc(pageUrl) + "&title=" + enc(pageTitle) + (pagePic ? "&pic=" + enc(pagePic) : "")
    };

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "shop-tab share-tab";
    tab.setAttribute("aria-label", "打开分享词境侧边栏（分享到微信、QQ 或复制链接）");
    tab.setAttribute("aria-expanded", "false");
    tab.innerHTML = "分享词境<small>微信 · QQ</small>";

    const mask = document.createElement("div");
    mask.className = "shop-mask";
    mask.setAttribute("aria-hidden", "true");

    const qrHtml = isHttp
      ? `<div class="share-qr-img"><img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${enc(pageUrl)}" alt="当前页面地址二维码" loading="lazy" decoding="async"></div>
         <div class="share-qr-copy"><b>微信 · 扫码分享</b><p>手机微信扫码打开本站，点击右上角「…」即可转发到朋友圈或送给朋友。</p></div>`
      : `<div class="share-qr-copy" style="flex:1"><b>微信 · 扫码分享</b><p>当前为本地预览，暂无法生成二维码。通过本地服务器或部署上线后，这里会显示页面二维码。</p></div>`;

    const drawer = document.createElement("aside");
    drawer.className = "shop-drawer share-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "分享词境");
    drawer.innerHTML = `
      <div class="shop-drawer-head">
        <span class="shop-drawer-seal" aria-hidden="true">享</span>
        <div><h2>分享词境</h2><small>SHARE · 把这条春水送出去</small></div>
        <button class="shop-drawer-close" type="button" aria-label="关闭分享词境">×</button>
      </div>
      <div class="shop-drawer-body">
        <div class="share-qr">${qrHtml}</div>
        <div class="share-links">
          <button class="share-btn" type="button" data-share="qzone"><i>空</i>QQ空间动态</button>
          <button class="share-btn" type="button" data-share="qqFriend"><i>友</i>分享给QQ好友</button>
          <button class="share-btn" type="button" data-share="weibo"><i>博</i>分享到微博</button>
          <button class="share-btn" type="button" data-share="copy"><i>链</i>复制词境链接</button>
          <button class="share-btn share-btn-sys" type="button" data-share="system" hidden><i>享</i>更多分享方式（系统分享）</button>
        </div>
        <div class="jy-note" role="note">
          <b>分享说明</b>
          微信朋友圈不提供网页端直连接口，故采用「扫码 → 手机微信内转发」的通用方案；QQ 空间、QQ 好友与微博通过官方分享页调起，需登录对应账号。
        </div>
        <p class="share-footnote">本地演示时链接为本机地址 · 网站部署上线后分享的即是正式网址</p>
      </div>`;

    const toast = document.createElement("div");
    toast.className = "jy-toast";
    toast.setAttribute("role", "status");

    document.body.append(tab, mask, drawer, toast);

    let drawerOpen = false;
    let lastFocused = null;
    let toastTimer = null;
    const showToast = (message) => {
      toast.textContent = message;
      toast.classList.add("is-show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("is-show"), 2200);
    };
    const openDrawer = () => {
      drawerOpen = true;
      lastFocused = document.activeElement;
      drawer.classList.add("is-open");
      mask.classList.add("is-open");
      tab.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      drawer.querySelector(".shop-drawer-close").focus();
      document.dispatchEvent(new Event("share-drawer-open"));
    };
    const closeDrawer = () => {
      if (!drawerOpen) return;
      drawerOpen = false;
      drawer.classList.remove("is-open");
      mask.classList.remove("is-open");
      tab.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    };
    tab.addEventListener("click", () => (drawerOpen ? closeDrawer() : openDrawer()));
    mask.addEventListener("click", closeDrawer);
    drawer.querySelector(".shop-drawer-close").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawerOpen) closeDrawer();
    });
    document.addEventListener("shop-drawer-open", closeDrawer);
    document.addEventListener("jy-drawer-open", closeDrawer);

    const copyLink = async () => {
      try {
        await navigator.clipboard.writeText(pageUrl);
        showToast("词境链接已复制");
      } catch {
        const helper = document.createElement("textarea");
        helper.value = pageUrl;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        try { document.execCommand("copy"); showToast("词境链接已复制"); }
        catch { showToast("复制失败，请手动复制地址栏链接"); }
        helper.remove();
      }
    };
    drawer.querySelectorAll(".share-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.share;
        if (kind === "copy") { copyLink(); return; }
        if (kind === "system") {
          if (navigator.share) navigator.share({ title: pageTitle, text: pageDesc, url: pageUrl }).catch(() => { });
          return;
        }
        const target = shareLinks[kind];
        if (target) window.open(target, "_blank", "noopener,width=720,height=640");
      });
    });
    if (navigator.share) drawer.querySelector(".share-btn-sys").hidden = false;
  })();

  // 水墨行迹：词人故事页专属侧签。点击直接进入 map.html 新页面，加载后从右缘弹出。
  (function initializeMapTab() {
    if (!document.body.classList.contains("life-page")) return; // 仅词人故事页出现
    const mapTab = document.createElement("button");
    mapTab.type = "button";
    mapTab.className = "shop-tab map-tab";
    mapTab.setAttribute("aria-label", "词人故事专属板块：进入水墨行迹，云游李煜生平地图");
    mapTab.innerHTML = "<span class=\"map-tab-seal\" aria-hidden=\"true\">迹</span>词人故事<small>水墨行迹 · 云游生平</small>";
    mapTab.addEventListener("click", () => { location.href = "map.html?v=f58"; });
    document.body.appendChild(mapTab);
    setTimeout(() => mapTab.classList.add("is-in"), 150); // 跳出动画
  })();
  }
  initializePageContent();
})();

// 终幕页 finale.html：滚动叙事进度 + 指针视差
// 滚动进度写 .finale-scroll 的 --finale-p（0→1，驱动月亮升起/逐行晕开/场景缓推/归于寂静）；
// 精确指针设备上写 --px/--py（-1~1，驱动雾层/巨字/月亮视差）。reduced-motion 不启用。
(() => {
  const scrollBox = document.querySelector(".finale-scroll");
  if (!scrollBox) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight || 1;
    const p = Math.min(1, Math.max(0, window.scrollY / max));
    scrollBox.style.setProperty("--finale-p", p.toFixed(4));
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
  if (window.matchMedia("(pointer: fine)").matches) {
    let pRaf = 0, px = 0, py = 0;
    const writeP = () => {
      pRaf = 0;
      scrollBox.style.setProperty("--px", px.toFixed(3));
      scrollBox.style.setProperty("--py", py.toFixed(3));
    };
    window.addEventListener("pointermove", (event) => {
      px = (event.clientX / window.innerWidth) * 2 - 1;
      py = (event.clientY / window.innerHeight) * 2 - 1;
      if (!pRaf) pRaf = requestAnimationFrame(writeP);
    }, { passive: true });
  }
})();

// 终幕页尾声配乐：finale.html 不挂全站背景音乐（.background-audio），进入即淡入独立尾声曲；
// 循环交界交叉淡化，页头开关淡出/淡入，音量沿用全站滑杆设置；
// 尊重全局静音（liyu-audio-enabled=false 则不自动播，显示"点击开启"）；不写背景音乐进度键，
// 返回首页后原曲仍从上次进度接续。浏览器自动播放策略拦截时由首次点击/按键兜底触发。
(() => {
  const finaleAudio = document.querySelector(".finale-audio");
  if (!finaleAudio) return;
  const finaleButtons = document.querySelectorAll(".sound-toggle");
  const finaleSlider = document.querySelector(".volume-slider");
  const finaleEnabled = sessionStorage.getItem("liyu-audio-enabled") !== "false";
  const updateFinale = (playing, message) => {
    finaleButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", playing ? "关闭背景音乐" : "开启背景音乐");
      const status = button.querySelector(".sound-status");
      if (status) status.textContent = message || (playing ? "音乐开启" : "音乐关闭");
    });
  };
  const savedFinaleVolume = sessionStorage.getItem("liyu-audio-volume");
  if (finaleSlider && savedFinaleVolume !== null) finaleSlider.value = savedFinaleVolume;
  const finaleMusic = window.liyuAudio.createLoopingPlayer(finaleAudio, { crossfade: 3 });
  finaleMusic.setVolume(Number(finaleSlider?.value || 0.32));
  const playFinale = () => {
    finaleMusic.play({ fade: 3000 }).then(() => updateFinale(true)).catch(() => updateFinale(false, "点击开启"));
  };
  if (finaleEnabled) playFinale();
  else updateFinale(false, "点击开启");
  document.addEventListener("pointerdown", () => {
    if (finaleEnabled && !finaleMusic.isPlaying()) playFinale();
  }, { once: true });
  document.addEventListener("keydown", (event) => {
    if (finaleEnabled && !finaleMusic.isPlaying() && !event.target.closest("input, textarea, button, a")) playFinale();
  }, { once: true });
  if (finaleSlider) finaleSlider.addEventListener("input", () => {
    finaleMusic.setVolume(Number(finaleSlider.value));
    sessionStorage.setItem("liyu-audio-volume", finaleSlider.value);
  });
  finaleButtons.forEach((button) => button.addEventListener("click", () => {
    const enabled = !finaleMusic.isPlaying();
    sessionStorage.setItem("liyu-audio-enabled", String(enabled));
    if (enabled) playFinale();
    else finaleMusic.pause({ fade: 900 }).then(() => updateFinale(false));
  }));
})();

// 首页「词间一戏 · 拾字成句」：字笺按原句次序拾取，三阕皆圆后开启词作笺赏入口。
// 仅存在于首页（.verse-game 为判据），不触碰入场动画与既有交互。
(() => {
  const game = document.querySelector(".verse-game");
  if (!game) return;
  const ROUNDS = [
    { name: "第一阕 · 虞美人", title: "虞美人", caption: "春花秋月何时了，往事知多少。", tiles: ["春花", "秋月", "何时了", "往事", "知多少"] },
    { name: "第二阕 · 相见欢", title: "相见欢", caption: "剪不断，理还乱，是离愁。别是一般滋味在心头。", tiles: ["剪不断", "理还乱", "是离愁", "别是", "一般滋味", "在心头"] },
    { name: "第三阕 · 浪淘沙令", title: "浪淘沙令", caption: "流水落花春去也，天上人间。", tiles: ["流水", "落花", "春去也", "天上", "人间"] }
  ];
  const stage = game.querySelector(".verse-stage");
  const roundName = game.querySelector(".verse-round-name");
  const dots = Array.from(game.querySelectorAll(".verse-round-dots i"));
  const assemble = game.querySelector(".verse-assemble");
  const pool = game.querySelector(".verse-pool");
  const feedback = game.querySelector(".verse-feedback");
  const doneList = game.querySelector(".verse-done");
  const gameLink = game.querySelector(".verse-game-link");
  const shuffleButton = game.querySelector(".verse-shuffle");
  const restartButton = game.querySelector(".verse-restart");
  if (!stage || !roundName || !assemble || !pool) return;

  let roundIndex = 0;
  let picked = 0;
  let locked = false;
  let roundToken = 0;

  const setFeedback = (message, state) => {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("is-ok", state === "ok");
    feedback.classList.toggle("is-err", state === "err");
  };
  const shuffled = (list) => {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const renderDots = () => {
    dots.forEach((dot, i) => dot.classList.toggle("is-on", i < roundIndex || (i === roundIndex && roundIndex < ROUNDS.length)));
  };
  const renderRound = () => {
    const round = ROUNDS[roundIndex];
    picked = 0;
    locked = false;
    roundName.textContent = round.name;
    assemble.classList.remove("is-complete");
    assemble.innerHTML = "";
    pool.innerHTML = "";
    shuffled(round.tiles.map((text, order) => ({ text, order }))).forEach(({ text, order }) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "verse-tile";
      tile.textContent = text;
      tile.dataset.order = String(order);
      tile.addEventListener("click", () => pickTile(tile));
      pool.appendChild(tile);
    });
    renderDots();
    setFeedback("", "");
  };
  const completeRound = () => {
    locked = true;
    assemble.classList.add("is-complete");
    const round = ROUNDS[roundIndex];
    if (doneList) {
      const item = document.createElement("li");
      const title = document.createElement("b");
      title.textContent = round.title;
      item.append(title, document.createTextNode(round.caption));
      doneList.appendChild(item);
    }
    dots.forEach((dot, i) => dot.classList.toggle("is-on", i <= roundIndex));
    if (roundIndex >= ROUNDS.length - 1) {
      roundName.textContent = "三阕皆圆 · 词心已拾回";
      setFeedback("三阕皆圆。词里的春天，已经还给他了。", "ok");
      if (gameLink) gameLink.hidden = false;
      return;
    }
    setFeedback("一阕已圆——下一句，还在水面等你。", "ok");
    const token = ++roundToken;
    window.setTimeout(() => {
      if (token !== roundToken) return;
      roundIndex += 1;
      renderRound();
    }, 1400);
  };
  const pickTile = (tile) => {
    if (locked || tile.classList.contains("is-taken")) return;
    const round = ROUNDS[roundIndex];
    if (Number(tile.dataset.order) !== picked) {
      tile.classList.remove("is-wrong");
      void tile.offsetWidth;
      tile.classList.add("is-wrong");
      tile.addEventListener("animationend", () => tile.classList.remove("is-wrong"), { once: true });
      setFeedback("顺序还差一点——再读一遍这句词。", "err");
      return;
    }
    tile.classList.add("is-taken");
    tile.disabled = true;
    const placed = document.createElement("span");
    placed.className = "verse-placed";
    placed.textContent = round.tiles[picked];
    assemble.appendChild(placed);
    picked += 1;
    setFeedback(picked < round.tiles.length ? "落字成句。" : "", "ok");
    if (picked >= round.tiles.length) completeRound();
  };
  shuffleButton?.addEventListener("click", () => {
    if (locked) return;
    const remaining = Array.from(pool.querySelectorAll(".verse-tile:not(.is-taken)"));
    shuffled(remaining).forEach((tile) => pool.appendChild(tile));
    setFeedback("字笺已随水重洗。", "");
  });
  restartButton?.addEventListener("click", () => {
    roundToken += 1;
    roundIndex = 0;
    if (doneList) doneList.innerHTML = "";
    if (gameLink) gameLink.hidden = true;
    renderRound();
    setFeedback("从首阕重来。", "");
  });
  renderRound();
})();

// 首页叙事主线「五折引子」：滚动入视淡入 + 墨线描边。独立于既有 reveal 体系，仅作用于 .narrative-thread。
(() => {
  const threads = document.querySelectorAll(".narrative-thread");
  if (!threads.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    threads.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.35, rootMargin: "0px 0px -6% 0px" });
  threads.forEach((el) => observer.observe(el));
})();

// 首页结尾「心情河灯」：mood 表单投递成功时，放一盏载有心事的灯顺水流去。
// capture 阶段监听，抢在既有处理清空文本框之前读取内容；reduced-motion 不放灯。
(() => {
  const moodForm = document.querySelector(".mood-form");
  const river = document.querySelector(".closing-river");
  if (!moodForm || !river) return;
  moodForm.addEventListener("submit", () => {
    const field = document.getElementById("mood");
    const text = (field?.value || "").trim();
    if (!text) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lantern = document.createElement("span");
    lantern.className = "mood-lantern";
    const img = document.createElement("img");
    img.src = "assets/image/hero-lantern-7.png";
    img.alt = "";
    const label = document.createElement("b");
    label.textContent = text.length > 14 ? `${text.slice(0, 14)}…` : text;
    lantern.append(img, label);
    lantern.style.setProperty("--ml-dur", `${(11 + Math.random() * 4).toFixed(1)}s`);
    lantern.style.bottom = `${(8 + Math.random() * 16).toFixed(0)}px`;
    river.appendChild(lantern);
    lantern.addEventListener("animationend", () => lantern.remove());
  }, true);
})();

// ================= 首页纯叙事重塑（f75）：滚轮一幕幕 + 纵深飞入切幕 + three.js 氛围长卷 + 拖动墨痕 =================
// 只作用于首页（.home-page）；入场动画、既有区块、样式与链接全部保留，其他页面不受影响。
// 幕序：hero → 折子一/intro → 折子二/feature → 折子三/verse-game → 折子四/afterlife → 折子五/closing → footer。
// 换幕时新幕自 Z 轴深处（顺读）或近处（回读）飞来落定，幕内标题/正文/卡片错落跟进（见 style.css f75 段）。
(() => {
  const body = document.body;
  if (!body.classList.contains("home-page")) return;
  const main = document.getElementById("main-content");
  if (!main) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const desktopLayout = window.matchMedia("(min-width: 761px)").matches;

  /* ---------- 一、停点与幕 ---------- */
  const stops = Array.from(main.querySelectorAll(".hero, .narrative-thread, .intro, .feature-section, .verse-game, .afterlife-section, .closing"));
  const footer = document.querySelector(".site-footer");
  if (footer) stops.push(footer);
  if (stops.length < 3) return;
  // 幕编号：0 月色 / 1 识人 / 2 读词 / 3 拾句(水) / 4 回响(灯) / 5 留笔(江)；折子引子归入其后的那一幕
  const actOfSection = (el) => {
    if (el.classList.contains("hero")) return 0;
    if (el.classList.contains("intro")) return 1;
    if (el.classList.contains("feature-section")) return 2;
    if (el.classList.contains("verse-game")) return 3;
    if (el.classList.contains("afterlife-section")) return 4;
    return 5;
  };
  stops.forEach((el, i) => {
    el.dataset.act = String(el.classList.contains("narrative-thread") ? actOfSection(stops[i + 1] || el) : actOfSection(el));
  });
  const measureStops = () => stops.map((el) => ({ el, top: el.getBoundingClientRect().top + window.scrollY, height: el.offsetHeight, act: Number(el.dataset.act) }));
  // 入场（翻书/抵达序章）期间不接管任何叙事互动：书已翻开且抵达序章落幕才算就绪
  const narrativeReady = () => body.classList.contains("book-opened") && !body.classList.contains("arrival-lock");

  /* ---------- 二、氛围基调（每幕一种水色墨意） ---------- */
  const MOODS = [
    { a: 0xaebfb2, b: 0xe3e9de, speed: 0.8, dirY: 0.10, opacity: 0.75, size: 1.0 },   // 0 月色 · 静
    { a: 0xc2ac8a, b: 0xe9dfc8, speed: 0.6, dirY: 0.06, opacity: 0.65, size: 0.9 },   // 1 识人 · 纸暖
    { a: 0x7e9385, b: 0xd3dcd0, speed: 0.9, dirY: 0.12, opacity: 0.8, size: 1.0 },    // 2 读词 · 墨绿
    { a: 0x8aa69e, b: 0xd2e1d9, speed: 1.2, dirY: -0.16, opacity: 0.85, size: 0.95 }, // 3 拾句 · 水流
    { a: 0xc9a26f, b: 0xead9b6, speed: 0.7, dirY: 0.34, opacity: 0.8, size: 0.8 },    // 4 回响 · 灯上浮
    { a: 0x93a5ad, b: 0xd9e0e1, speed: 1.05, dirY: -0.4, opacity: 0.85, size: 0.9 }   // 5 留笔 · 江下行
  ];
  let moodTarget = MOODS[0];
  let activeIdx = -1;
  let lastFlyAt = 0;

  /* ---------- 二之一、一幕幕飞来：新幕自画卷深处（顺读）或近处（回读）落定，幕内字句错落跟进 ---------- */
  const FLY_CHILD_SEL = ".eyebrow, h1, h2, .hero-intro, .hero-actions, .hero-art, .nt-kicker, .nt-line, .nt-glyph, .intro-poet, .intro-heading, .intro-card, .feature-head, .poem-card, .verse-game-head, .verse-stage, .verse-scroll, .afterlife-copy, .closing-pine, .mood-form, .site-footer .brand, .site-footer > span, .site-footer > a";
  const collectFlyChildren = (el) => {
    const all = Array.from(el.querySelectorAll(FLY_CHILD_SEL));
    const tops = all.filter((node) => !all.some((other) => other !== node && other.contains(node)));
    return tops.slice(0, 8);
  };
  const flyScene = (el, dir) => {
    if (el._flyTimer) { clearTimeout(el._flyTimer); el._flyTimer = 0; }
    if (el._flyKids) el._flyKids.forEach((k) => { k.classList.remove("fly-child"); k.style.removeProperty("--i"); });
    el.classList.remove("fly-scene", "fly-deep", "fly-near", "fly-land");
    const kids = collectFlyChildren(el);
    kids.forEach((k, i) => { k.style.setProperty("--i", String(i)); k.classList.add("fly-child"); });
    el._flyKids = kids;
    el.classList.add("fly-scene", dir >= 0 ? "fly-deep" : "fly-near");
    void el.offsetWidth; // 先落定起始态，再开启动画
    el.classList.add("fly-land");
    // three.js 氛围层同步一振：云雾向后掠去再归于平静
    pulse = Math.min(1, pulse + 0.5);
    wind.y += dir >= 0 ? -0.24 : 0.2;
    wind.x += (Math.random() - 0.5) * 0.08;
    el._flyTimer = setTimeout(() => {
      el.classList.remove("fly-scene", "fly-deep", "fly-near", "fly-land");
      kids.forEach((k) => { k.classList.remove("fly-child"); k.style.removeProperty("--i"); });
      el._flyKids = null;
      el._flyTimer = 0;
    }, 1450 + kids.length * 75);
  };

  const updateActiveScene = () => {
    const y = window.scrollY;
    const vh = window.innerHeight;
    const list = measureStops();
    let idx = 0;
    for (let i = 0; i < list.length; i++) { if (list[i].top <= y + vh * 0.38) idx = i; else break; }
    if (idx === activeIdx) return;
    const prevIdx = activeIdx;
    activeIdx = idx;
    body.dataset.act = String(list[idx].act);
    moodTarget = MOODS[list[idx].act];
    // 就绪后换幕才播飞入；初次定位（入场序章交接）不播，避免与既有入场过渡重复
    if (prevIdx >= 0 && narrativeReady()) {
      const now = performance.now();
      const since = now - lastFlyAt;
      const target = list[idx].el;
      if (since > 650) {
        lastFlyAt = now;
        flyScene(target, idx > prevIdx ? 1 : -1);
      } else {
        // 快速连跨多幕时，被防抖吞掉的幕在停稳后补播，保证最终一幕一定飞来
        clearTimeout(updateActiveScene._defer);
        updateActiveScene._defer = setTimeout(() => {
          if (narrativeReady()) { lastFlyAt = performance.now(); flyScene(target, 1); }
        }, 700 - since);
      }
    }
  };
  let activeRaf = false;
  const scheduleActive = () => {
    if (activeRaf) return;
    activeRaf = true;
    window.requestAnimationFrame(() => { activeRaf = false; updateActiveScene(); });
  };
  window.addEventListener("scroll", scheduleActive, { passive: true });
  updateActiveScene();

  /* ---------- 三、滚轮一幕幕（桌面端；高幕内部保留自由阅读滚动） ---------- */
  const wipe = document.createElement("div");
  wipe.className = "scene-wipe";
  wipe.setAttribute("aria-hidden", "true");
  body.appendChild(wipe);
  const playWipe = () => {
    wipe.classList.remove("is-active");
    void wipe.offsetWidth;
    wipe.classList.add("is-active");
  };

  let gliding = false;
  let lastGlideEnd = 0;
  const glideTo = (target) => {
    gliding = true;
    playWipe();
    const root = document.documentElement;
    const prevBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto"; // 关闭 CSS smooth，逐帧手动缓动
    const startY = window.scrollY;
    const dist = target - startY;
    const duration = Math.min(1150, 620 + Math.abs(dist) * 0.28);
    const t0 = performance.now();
    const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, Math.round(startY + dist * ease(p)));
      if (p < 1) {
        window.requestAnimationFrame(step);
      } else {
        root.style.scrollBehavior = prevBehavior;
        gliding = false;
        lastGlideEnd = performance.now();
        updateActiveScene();
      }
    };
    window.requestAnimationFrame(step);
  };
  const tryAdvance = (dir) => {
    const y = window.scrollY;
    const vh = window.innerHeight;
    const maxScroll = document.documentElement.scrollHeight - vh;
    const list = measureStops();
    let idx = 0;
    for (let i = 0; i < list.length; i++) { if (list[i].top <= y + vh * 0.5) idx = i; else break; }
    const cur = list[idx];
    if (cur.height > vh * 1.22) {
      // 高幕：内部先自由滚动，读到底/顶后再换幕
      const innerBottom = cur.top + cur.height - vh;
      if (dir > 0 && y < innerBottom - 4) return false;
      if (dir < 0 && y > cur.top + 4) return false;
    } else if (dir < 0 && y > cur.top + 4 && cur.height > vh * 0.85) {
      return false; // 接近满屏的幕：向上先回到幕首
    }
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= list.length) return false;
    let target = list[nextIdx].top;
    if (list[nextIdx].height < vh * 0.6) target -= (vh - list[nextIdx].height) / 2; // 短过场居中呈现
    target = Math.max(0, Math.min(maxScroll, target));
    if ((dir > 0 && target <= y + 2) || (dir < 0 && target >= y - 2)) return false;
    glideTo(target);
    return true;
  };
  /* 输入：滚轮 / 键盘 / 触控 / 右侧章节 */
  if (desktopLayout && finePointer) {
    window.addEventListener("wheel", (event) => {
      if (!narrativeReady()) return; // 入场动画期间不接管
      if (event.ctrlKey || !event.deltaY) return;
      if (gliding || performance.now() - lastGlideEnd < 100) { event.preventDefault(); return; }
      if (tryAdvance(event.deltaY > 0 ? 1 : -1)) event.preventDefault();
    }, { passive: false });
    window.addEventListener("keydown", (event) => {
      if (!narrativeReady() || gliding) return;
      if (event.target.closest("input, textarea, select, [contenteditable]")) return;
      const dir = event.key === "PageDown" || event.key === "ArrowDown" || event.key === " " ? 1
        : event.key === "PageUp" || event.key === "ArrowUp" ? -1 : 0;
      if (!dir) return;
      if (tryAdvance(dir)) event.preventDefault();
    });
  }

  /* ---------- 四、three.js 氛围长卷：随幕换调的淡墨云雾 ---------- */
  const wind = { x: 0, y: 0 };
  const pointerTarget = { x: 0, y: 0 };
  const pointerLerp = { x: 0, y: 0 };
  let pulse = 0;
  let atmosphere = null;
  if (typeof THREE !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.className = "scene-atmosphere";
      canvas.setAttribute("aria-hidden", "true");
      body.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
      camera.position.z = 1;
      const count = desktopLayout ? 260 : 120;
      const positions = new Float32Array(count * 3);
      const seeds = new Float32Array(count);
      const scales = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = Math.random() * 2.2 - 1.1;
        positions[i * 3 + 1] = Math.random() * 2.2 - 1.1;
        positions[i * 3 + 2] = 0;
        seeds[i] = Math.random();
        scales[i] = i % 5 < 2 ? 0.5 + Math.random() * 0.5 : 0.06 + Math.random() * 0.34; // 四成云雾、六成细尘
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      geometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
      const uniforms = {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(0, 0) },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uPulse: { value: 0 },
        uColorA: { value: new THREE.Color(MOODS[0].a) },
        uColorB: { value: new THREE.Color(MOODS[0].b) },
        uOpacity: { value: MOODS[0].opacity },
        uSpeed: { value: MOODS[0].speed },
        uDirY: { value: MOODS[0].dirY },
        uSizeMul: { value: MOODS[0].size },
        uPix: { value: Math.min(window.devicePixelRatio || 1, 1.75) }
      };
      const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexShader: `
          attribute float aSeed;
          attribute float aScale;
          uniform float uTime, uPulse, uSpeed, uDirY, uSizeMul, uPix;
          uniform vec2 uWind, uPointer;
          varying float vSeed, vScale, vTw;
          void main() {
            vSeed = aSeed; vScale = aScale;
            vec2 p = position.xy;
            float t = uTime * uSpeed;
            p.x += sin(t * 0.11 + aSeed * 19.0) * 0.055;
            p.y += cos(t * 0.08 + aSeed * 31.0) * 0.04;
            p.y = mod(p.y + t * uDirY * 0.05 + 1.1, 2.2) - 1.1;
            p.x = mod(p.x + t * 0.011 + 1.15, 2.3) - 1.15;
            p += uWind * (0.25 + aScale * 0.9);
            p += uPointer * (0.015 + aScale * 0.05);
            vTw = 0.72 + 0.28 * sin(t * 0.6 + aSeed * 43.0);
            gl_Position = vec4(p, 0.0, 1.0);
            gl_PointSize = mix(14.0, 132.0, aScale) * uSizeMul * uPix * (1.0 + uPulse * 0.45);
          }`,
        fragmentShader: `
          precision mediump float;
          uniform vec3 uColorA, uColorB;
          uniform float uOpacity, uPulse;
          varying float vSeed, vScale, vTw;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float a = smoothstep(1.0, 0.1, d);
            a *= a;
            float alpha = a * mix(0.05, 0.15, vScale) * vTw * uOpacity * (1.0 + uPulse * 0.5);
            gl_FragColor = vec4(mix(uColorA, uColorB, vSeed), alpha);
          }`
      });
      scene.add(new THREE.Points(geometry, material));
      atmosphere = { renderer, scene, camera, uniforms };
      const onResize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        uniforms.uPix.value = Math.min(window.devicePixelRatio || 1, 1.75);
      };
      window.addEventListener("resize", onResize);
      onResize();
    } catch (error) {
      atmosphere = null; // WebGL 不可用时静默退回静态页面
    }
  }

  /* ---------- 五、拖动墨痕（鼠标/触控笔按住拖动，留下渐淡的墨） ---------- */
  const brush = document.createElement("canvas");
  brush.className = "brush-trail";
  brush.setAttribute("aria-hidden", "true");
  body.appendChild(brush);
  const brushCtx = brush.getContext("2d");
  let drawing = false;
  let lastX = 0;
  let lastY = 0;
  let brushUntil = 0;
  const sizeBrush = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    brush.width = Math.round(window.innerWidth * dpr);
    brush.height = Math.round(window.innerHeight * dpr);
    brushCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener("resize", sizeBrush);
  sizeBrush();
  const brushStamp = (x, y, px, py) => {
    const dx = x - px;
    const dy = y - py;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.floor(dist / 5));
    for (let i = 1; i <= steps; i++) {
      const sx = px + (dx * i) / steps;
      const sy = py + (dy * i) / steps;
      const r = Math.max(2.2, 8 - dist * 0.05) * (0.8 + Math.random() * 0.5);
      brushCtx.fillStyle = "rgba(38,56,47,0.10)";
      brushCtx.beginPath();
      brushCtx.arc(sx, sy, r, 0, 6.2832);
      brushCtx.fill();
      if (Math.random() < 0.3) {
        brushCtx.fillStyle = "rgba(30,45,38,0.13)";
        brushCtx.beginPath();
        brushCtx.arc(sx + (Math.random() - 0.5) * 7, sy + (Math.random() - 0.5) * 7, r * 0.4, 0, 6.2832);
        brushCtx.fill();
      }
    }
    brushUntil = performance.now() + 1800;
  };
  if (finePointer) {
    window.addEventListener("pointerdown", (event) => {
      if (!narrativeReady()) return;
      if (event.target.closest("input, textarea, select, [contenteditable], a, button, img")) return;
      drawing = true;
      lastX = event.clientX;
      lastY = event.clientY;
    }, { passive: true });
    window.addEventListener("pointerup", () => { drawing = false; }, { passive: true });
    window.addEventListener("pointercancel", () => { drawing = false; }, { passive: true });
  }
  window.addEventListener("pointermove", (event) => {
    pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointerTarget.y = -((event.clientY / window.innerHeight) * 2 - 1);
    if (!drawing) return;
    wind.x += (event.movementX || 0) * 0.0004;
    wind.y += -(event.movementY || 0) * 0.0004;
    brushStamp(event.clientX, event.clientY, lastX, lastY);
    lastX = event.clientX;
    lastY = event.clientY;
  }, { passive: true });
  // 点击时墨色一振：雾粒轻轻鼓起（DOM 侧的墨晕与字条由既有全局点击互动负责）
  window.addEventListener("click", () => {
    if (!narrativeReady()) return;
    pulse = Math.min(1, pulse + 0.55);
    wind.x += (Math.random() - 0.5) * 0.05;
  }, { passive: true });

  /* ---------- 六、主循环：风、脉冲、幕间色调全部缓动 ---------- */
  const lerp = (from, to, k) => from + (to - from) * k;
  const tick = (now) => {
    window.requestAnimationFrame(tick);
    if (document.hidden || !narrativeReady()) return;
    wind.x *= 0.93;
    wind.y *= 0.93;
    pulse *= 0.94;
    pointerLerp.x = lerp(pointerLerp.x, pointerTarget.x, 0.06);
    pointerLerp.y = lerp(pointerLerp.y, pointerTarget.y, 0.06);
    // 指针缓慢追随：插值平滑后写入 three.js 氛围着色器 uPointer，让雾粒光晕跟着鼠标轻轻游移
    if (atmosphere) {
      const u = atmosphere.uniforms;
      const sizeBase = Math.min(1, 0.55 + window.innerWidth / 2400);
      u.uTime.value = now * 0.001;
      u.uWind.value.set(wind.x, wind.y);
      u.uPointer.value.set(pointerLerp.x, pointerLerp.y);
      u.uPulse.value = pulse;
      u.uSpeed.value = lerp(u.uSpeed.value, moodTarget.speed, 0.045);
      u.uDirY.value = lerp(u.uDirY.value, moodTarget.dirY, 0.045);
      u.uOpacity.value = lerp(u.uOpacity.value, moodTarget.opacity, 0.045);
      u.uSizeMul.value = lerp(u.uSizeMul.value, moodTarget.size * sizeBase, 0.045);
      u.uColorA.value.lerp(new THREE.Color(moodTarget.a), 0.045);
      u.uColorB.value.lerp(new THREE.Color(moodTarget.b), 0.045);
      atmosphere.renderer.render(atmosphere.scene, atmosphere.camera);
    }
    if (now < brushUntil) {
      brushCtx.globalCompositeOperation = "destination-out";
      brushCtx.fillStyle = "rgba(0,0,0,0.05)";
      brushCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      brushCtx.globalCompositeOperation = "source-over";
    }
  };
  window.requestAnimationFrame(tick);
})();
