/*
 * 一江春水 · 李煜词境 — 全站交互脚本
 * 统一接管：开场动画 / 背景音乐 / 无刷新翻页 /
 * 时间线·记忆弹窗 / 滚动渐显 / 各类微交互。
 */
(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 读取系统“减弱动效”偏好；开启后跳过粒子/水墨/视差等重动画，仅保留必要过渡
  document.addEventListener("click", (event) => {
    /* —— 全局点击涟漪：在点击处生成一圈扩散水波（.click-ripple） —— */
    // 跳过表单控件与媒体，避免干扰输入/播放
    if (reducedMotion || event.target.closest("input, textarea, select, audio, video")) return;
    const link = event.target.closest("a[href]");
    if (link) {
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && url.pathname.endsWith(".html")
        && (url.pathname !== location.pathname || url.search !== location.search)) return;
    }
    // 生成 .click-ripple 元素并交由 CSS 动画自行消散
    const ripple = document.createElement("span");
    ripple.className = "click-ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.setProperty("--ripple-x", `${event.clientX}px`);
    ripple.style.setProperty("--ripple-y", `${event.clientY}px`);
    document.body.append(ripple);
    window.setTimeout(() => ripple.remove(), 1100);
  });

  /* —— 顶部导航：汉堡菜单开合 —— */
  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");
  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    });
  }

  /* —— 背景音乐：自动播放策略 + sessionStorage 记忆 —— */
  const audio = document.querySelector(".background-audio");
  // 开场引子音频：翻开书封时播放的引子（intro-audio.aac），播完自动接力背景音乐
  const introAudio = document.querySelector(".intro-audio");
  const soundButtons = document.querySelectorAll(".sound-toggle");
  const volumeSlider = document.querySelector(".volume-slider");
  let audioEnabled = sessionStorage.getItem("liyu-audio-enabled") !== "false";
  // 默认开启；若用户曾关闭则记为 false
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
  // 尝试播放背景音乐；失败则提示“点击开启”
  const playBackgroundMusic = () => {
    if (!audio || !audioEnabled) return;
    audio.play().then(() => {
      updateSoundControls(true);
    }).catch(() => {
      updateSoundControls(false, "点击开启");
    });
  };
  if (audio) {
    // 引子待播期间不自动开背景音乐（HTML 的 autoplay/inert 已移除，改由这里控制起播时机）
    audio.autoplay = audioEnabled && !coverIntroPending;
    if (!audioEnabled || coverIntroPending) audio.pause();
    const savedVolume = sessionStorage.getItem("liyu-audio-volume");
    if (volumeSlider && savedVolume !== null) volumeSlider.value = savedVolume;
    audio.volume = Number(volumeSlider?.value || 0.32);
    audio.muted = false;
    updateSoundControls(!audio.paused, audio.paused ? (audioEnabled ? "点击开启" : "音乐关闭") : "音乐开启");
    audio.addEventListener("error", () => {
      updateSoundControls(false, "音频加载失败");
    });
    if (volumeSlider) {
      volumeSlider.addEventListener("input", () => {
        audio.volume = Number(volumeSlider.value);
        sessionStorage.setItem("liyu-audio-volume", volumeSlider.value);
      });
    }
    // 重新进入页面时恢复上次播放进度
    const restoreAudioPosition = () => {
      const savedTime = Number(sessionStorage.getItem("liyu-audio-time") || 0);
      if (savedTime > 0 && savedTime < audio.duration - 1) audio.currentTime = savedTime;
      if (audioEnabled && !audio.autoplay) playBackgroundMusic();
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
    // 首次交互（点击）时若音乐被暂停则尝试续播（书封内的点击除外，避免打断引子音频）
    document.addEventListener("pointerdown", (event) => {
      if (audioEnabled && audio.paused && !event.target.closest(".sound-toggle") && !event.target.closest(".book-opening")) playBackgroundMusic();
    }, { once: true });
    document.addEventListener("keydown", (event) => {
      // 键盘首次交互也尝试续播（排除输入/按钮/链接）
      if (audioEnabled && audio.paused && !event.target.closest("input, textarea, button, a")) playBackgroundMusic();
    }, { once: true });
  }

  /* —— 开场引子音频：翻开书封时播放，播完无缝接力背景音乐 —— */
  // 音频一：封面点击后立即播放，播放结束后自动接续原有背景音乐
  const startIntroAudio = () => {
    // 无引子音频元素时（其他子页），直接进入背景音乐
    if (!introAudio) {
      playBackgroundMusic();
      return;
    }
    // 引子音量在背景音乐音量基础上略放大（上限 1），保证开场听感清晰
    introAudio.volume = Math.min(1, (audio ? audio.volume : Number(volumeSlider?.value || 0.32)) * 1.4);
    try {
      const playPromise = introAudio.play();
      // 被浏览器拦截时降级为直接播放背景音乐
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => playBackgroundMusic());
      }
    } catch (error) {
      playBackgroundMusic();
    }
  };
  // 引子播完自动接上背景音乐；dataset.introBound 防重复绑定
  if (introAudio && !introAudio.dataset.introBound) {
    introAudio.dataset.introBound = "1";
    introAudio.addEventListener("ended", () => playBackgroundMusic());
  }

  // 首页 hero 云雾：脱离首屏裁剪，以半速慢移越过边界，飘入第二部分（他把无常，写成了永恒）后消散
  (() => {
    // .cloud-stage 是首屏与云气的共同定位参照系；缺任一节点则整套跳过
    const stage = document.querySelector(".cloud-stage");
    const hero = document.querySelector(".hero");
    const intro = document.querySelector(".intro");
    if (!stage || !hero) return;
    // 减弱动效偏好：云雾改为静态贴底，随文档正常滚走
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // ticking 节流标记：滚动事件高频触发，合并到每帧只算一次
    let ticking = false;
    // 量取首屏实际高度写入 --hero-h，供 CSS 把云气定位到首屏下缘之外（不依赖硬编码高度）
    const measure = () => {
      stage.style.setProperty("--hero-h", `${hero.offsetHeight}px`);
    };
    const updateClouds = () => {
      ticking = false;
      const heroH = hero.offsetHeight;
      const introH = intro ? intro.offsetHeight : 0;
      // 已滚动距离：把「首屏高度 + 介绍区高度」作为上限，避免滚过整段后仍在累加
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
      // 夹取到 0～1，防止弹性回滚或短页面时溢出
      const fadeRaw = Math.min(1, Math.max(0, (scroll - fadeStart) / Math.max(1, fadeEnd - fadeStart)));
      const fade = fadeRaw * fadeRaw * (3 - 2 * fadeRaw); // smoothstep，后段加速消散
      // 行进中持续向两侧外飘，消散时再散开一些
      const travel = Math.min(1, scroll / heroH);
      const tx = travel * 34 + fade * 30;
      stage.style.setProperty("--cloud-ty", `${ty.toFixed(1)}px`);
      stage.style.setProperty("--cloud-tx", `${tx.toFixed(1)}px`);
      stage.style.setProperty("--cloud-fade", fade.toFixed(3));
    };
    // 用 requestAnimationFrame 合并同帧内的多次滚动触发
    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateClouds);
    };
    window.addEventListener("scroll", requestUpdate, { passive: true });
    // 尺寸变化会改变首屏高度，需先重新量取再重算
    window.addEventListener("resize", () => { measure(); requestUpdate(); });
    // 初始化时先量一次、算一次，保证刷新后停在页面中部时云气状态正确
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
        // 紧跟首屏之后的那个区块即「覆盖面板」
        const cover = hero?.nextElementSibling;
        if (!hero || !cover) return;
        // 覆盖面板顶部从视口底（p=0）升到视口顶（p=1）
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
    // 卡组、四张卡、四段说明、页码、详情弹窗，均在本段内取用，缺任何一项都不会影响其他页面
    const deck = carousel.querySelector(".media-deck");
    const slides = Array.from(deck.querySelectorAll(".media-slide"));
    const caps = Array.from(carousel.querySelectorAll(".media-carousel-info .media-caption"));
    const counter = carousel.querySelector(".media-carousel-count b");
    const storyDialog = document.querySelector(".memory-story-dialog");
    const n = slides.length;
    // 减弱动效：不启用 3D，直接把四段说明全部点亮（CSS 那边退回静态网格）
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      caps.forEach((cap) => cap.classList.add("is-active"));
      return;
    }
    carousel.classList.add("carousel-ready");
    deck.classList.add("media-deck-3d");
    let cur = 0;
    let started = false;
    // 核心排布：按「与当前卡的相对位次 t」算位移、纵深、角度与缩放，再把说明与页码同步到 cur
    const layout = (p) => {
      p = p || 0; // p 为拖拽跟手的连续偏移量（约 -1~1），0 即静止吸附态
      const w = slides[0].offsetWidth || 250; // 未变换布局宽度：getBoundingClientRect 会带 3D 投影，导致不同卡居中时铺开形态不一
      slides.forEach((slide, i) => {
        // 环形取最短距离：把 -n/2 ~ n/2 之外的值折回来，末张与首张之间不会绕远路
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
      // 词句节点只建一次，之后复用；重新触发动画靠「摘类名 → 强制回流 → 加类名」
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
      // 墨点：九粒随机散开，横向按翻页方向（右翻往左、左翻往右）铺，纵向上下随机
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
      // 连等两帧再铺开，保证浏览器已完成首帧布局，过渡才不会被跳过
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
      // 甩动速度：用相邻两次移动的位移/时间差估算，松手时参与判页
      if (now > lastT) vel = (event.clientX - lastX) / (now - lastT);
      lastX = event.clientX; lastT = now;
      // 超过 6px 才算「真的在拖」，避免误触把点击当拖拽
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
      // 判页阈值：拖过 0.32 张即翻；或拖过 0.08 张且甩得够快（< -0.45 / > 0.45）也翻
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
    // 拖拽结束时拦下这次 click，免得松开手顺带触发卡片上的大图弹窗
    deck.addEventListener("click", (event) => {
      if (dragged) { event.stopPropagation(); event.preventDefault(); }
    }, true);
    carousel.querySelectorAll(".media-nav").forEach((btn) => btn.addEventListener("click", () => { go(Number(btn.dataset.dir)); bumpAuto(); }));
    deck.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); bumpAuto(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); go(1); bumpAuto(); }
    });
    // 点两侧卡片即翻到那张（用捕获阶段先拦下，避免顺带打开大图）；点中心卡不拦，交给弹窗
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
        // 指针在卡组里的归一化坐标（0~1），用视口矩形换算，同帧只算一次
        const rect = deck.getBoundingClientRect();
        px = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        py = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        if (!tiltRaf) tiltRaf = requestAnimationFrame(applyTilt);
      });
      // 指针离开：清掉内联倾斜，并临时挂 tilt-return 让回位带缓动
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
    // 进度 =（视口底 - 区块顶）/（视口高 + 区块高），区块完全进入时为 0.5 左右
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

  // 两山开合：按各区块（ci 词作笺赏 / index 词牌卡 / wanxiang 记忆卡 / listen 终幕引子）进出视口进度
  // 各自写 --part-p（0=刚进，1=将出），驱动山影向两侧退开、渐隐消散；终幕引子用它驱动逐层晕开；
  // 同时挂 part-js 并在精确指针设备写 --part-px/--part-py（-1~1）供引子巨字/雾团视差；
  // reduced-motion 不启用，山影保持静态
  (() => {
    const zones = Array.from(document.querySelectorAll(".works, .feature-section, .memory-section, .finale-gate"));
    if (!zones.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("part-js");
    // 指针视差：光标位置归一到 -1~1 → --part-px/--part-py（rAF 节流，挂在 html 上全局共用）
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
    // 进度 =（视口底 - 区块顶）/（视口高 + 区块高），与 --glide-p 同一套公式
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

  /* ============================================================
   * 开场链路：翻书封面 → 书法飞落序列 → 水墨间奏 → 抵达视差
   * ============================================================ */
  const bookOpening = document.querySelector(".book-opening");
  const bookOpenButton = document.querySelector(".book-open-button");
  const calligraphySequence = document.querySelector(".calligraphy-sequence");
  // 书法幕墨点：用 canvas 逐帧绘制上浮的墨珠（带拖尾与左右旋绕），替代原先由 CSS 变量驱动的 <i> 列表
  (() => {
    // 墨点容器：HTML 里只留一个空壳 div，画布在运行时插入，避免手写 30 个节点
    const host = document.querySelector(".calligraphy-inkmotes");
    // 容器不存在或已绑定过（防重复初始化）就直接退出
    if (!host || host.dataset.motesBound) return;
    host.dataset.motesBound = "1";
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    const context = canvas.getContext("2d");
    // 拿不到 2D 上下文（极旧浏览器）则放弃绘制
    if (!context) return;
    // 设备像素比上限压到 2，兼顾高分屏清晰度与绘制开销
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    // 尺寸同步：CSS 尺寸决定逻辑坐标，画布像素按 dpr 放大后再整体缩放坐标系
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
    // 移动端减少数量：窄屏 16 粒，桌面 30 粒
    const moteCount = window.innerWidth < 700 ? 16 : 30;
    for (let i = 0; i < moteCount; i++) {
      // 每粒墨点：x 用 0-1 归一化坐标；y 从 1~2.4 起步（屏幕下方），画布内随尺寸缩放
      motes.push({
        x: Math.random(),
        y: 1 + Math.random() * 1.4,
        speed: 0.07 + Math.random() * 0.08,
        drift: (Math.random() < 0.5 ? -1 : 1) * (0.035 + Math.random() * 0.075),
        swirl: 0.35 + Math.random() * 0.85,
        phase: Math.random() * Math.PI * 2,
        // size 为墨珠半径（整体比上版更细小），约 12% 概率放大到 1.9 倍，做出大小错落
        size: (1.2 + Math.random() * 1.9) * (Math.random() < 0.12 ? 1.9 : 1),
        // trail 存最近若干帧的坐标，用来画拖尾
        trail: []
      });
    }
    let last = performance.now();
    let frameIndex = 0;
    // 逐帧循环：先排下一帧，再推进当前帧，保证长时间运行不中断
    const stepInkMotes = (now) => {
      requestAnimationFrame(stepInkMotes);
      // dt 截断到 0.05s，避免切回标签页时因超大时间差导致墨点瞬移
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      frameIndex += 1;
      // 只有书法幕处于激活态才绘制，其余时间空转省性能
      if (!calligraphySequence.classList.contains("is-active")) return;
      context.clearRect(0, 0, width, height);
      motes.forEach((mote) => {
        // 上浮：y 递减；越过顶部后回到画面底部并重新随机横向位置
        mote.y -= mote.speed * dt;
        mote.phase += mote.swirl * dt;
        if (mote.y < -0.06) {
          mote.y = 1.06;
          mote.x = Math.random();
          mote.trail.length = 0;
        }
        // 横向位置 = 基准 x + 正弦摆动，形成左右旋绕的飘移感
        const px = (mote.x + Math.sin(mote.phase) * mote.drift) * width;
        const py = mote.y * height;
        // 隔帧采样一次轨迹，最多保留 44 个点
        if (frameIndex % 2 === 0) {
          mote.trail.push([px, py]);
          if (mote.trail.length > 44) mote.trail.shift();
        }
        context.lineCap = "round";
        // 拖尾：从旧到新逐段连线，越靠近墨珠越粗越浓（k 的平方衰减）
        for (let t = 1; t < mote.trail.length; t++) {
          const k = t / mote.trail.length;
          context.beginPath();
          context.moveTo(mote.trail[t - 1][0], mote.trail[t - 1][1]);
          context.lineTo(mote.trail[t][0], mote.trail[t][1]);
          context.strokeStyle = `rgba(16,28,22,${(0.5 * k * k).toFixed(3)})`;
          context.lineWidth = Math.max(mote.size * 0.9 * k, 0.4);
          context.stroke();
        }
        // 墨珠本体：径向渐变（左上高光 → 中心浓墨 → 边缘渐透），模拟纸上的墨点
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
    // 是否已看过开场动画的本地标记，避免每次刷新重播
    const calligraphyBackground = calligraphySequence.querySelector(".calligraphy-background");
    const inkInterlude = document.querySelector(".ink-interlude");
    const arrivalInterlude = document.querySelector(".arrival-interlude");
    // 行程轨道：滚动内容总高约 390svh，用其高度与容器可视高度换算进度
    const arrivalTrack = arrivalInterlude?.querySelector(".arrival-track");
    // 内层滚动容器：抵达幕回到「固定层 + 内部滚动」模型，行程在 .arrival-scroller 内推进
    const arrivalScroller = arrivalInterlude?.querySelector(".arrival-scroller");
    const arrivalEnterButton = arrivalInterlude?.querySelector(".arrival-enter-button");
    const arrivalSkipButton = arrivalInterlude?.querySelector(".arrival-skip-button");
    const arrivalChapterButtons = arrivalInterlude?.querySelectorAll("[data-arrival-scene]");
    const arrivalStage = arrivalInterlude?.querySelector(".arrival-stage");
    const arrivalInkWash = arrivalInterlude?.querySelector(".arrival-ink-wash");
    const inkCanvas = inkInterlude?.querySelector(".ink-canvas");
    const inkContext = inkCanvas?.getContext("2d");
    /* 抵达幕：把文案逐字拆为 .arrival-glyph，供逐字显现 */
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
    // 浮尘：向 .arrival-motes 注入若干光点，位置/大小/时长/延迟/横向漂移/透明度全部随机
    // 具体运动交给 CSS 的 arrival-mote-rise 动画，脚本只负责「撒点」
    const spawnArrivalMotes = () => {
      const motesLayer = arrivalInterlude?.querySelector(".arrival-motes");
      // 没有容器或用户要求减弱动效时直接不撒
      if (!motesLayer || reducedMotion) return;
      // 移动端减半，避免小屏上光点过密
      const count = window.matchMedia("(max-width:700px)").matches ? 26 : 52;
      // 用片段批量插入，只触发一次重排
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i += 1) {
        const mote = document.createElement("i");
        const size = 2 + Math.random() * 5;
        // --mote-x：横向落点（百分比）；--mote-size：光点直径
        mote.style.setProperty("--mote-x", `${Math.random() * 100}%`);
        mote.style.setProperty("--mote-size", `${size}px`);
        // --mote-duration：上升一轮耗时；--mote-delay 取负值，让首帧就已错落分布
        mote.style.setProperty("--mote-duration", `${9 + Math.random() * 14}s`);
        mote.style.setProperty("--mote-delay", `${-Math.random() * 20}s`);
        // --mote-drift：横向漂移量；--mote-opacity：该粒的峰值透明度
        mote.style.setProperty("--mote-drift", `${(Math.random() - 0.5) * 120}`);
        mote.style.setProperty("--mote-opacity", `${(0.35 + Math.random() * 0.5).toFixed(2)}`);
        frag.append(mote);
      }
      motesLayer.append(frag);
    };
    // 依据滚动进度计算每幕文案的逐字显现比例
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
    // 书法飞落所用字稿图片清单（按文件名预加载）
    const calligraphyAssets = [
      "calligraphy-flight-01.png",
      "calligraphy-flight-03.png",
      "calligraphy-flight-04.png",
      "calligraphy-flight-05.png",
      "calligraphy-flight-06.png",
      "calligraphy-flight-07.png",
      "calligraphy-flight-08.png",
      "calligraphy-flight-09.png",
      "calligraphy-flight-11.png",
      "calligraphy-flight-13.png",
      "calligraphy-flight-14.png",
      "calligraphy-flight-15.png",
      "calligraphy-flight-17.png",
      "calligraphy-flight-19.png",
      "calligraphy-added-01.png",
      "calligraphy-added-02.png",
      "calligraphy-added-03.png",
      "calligraphy-added-04.png",
      "calligraphy-added-06.png",
      "calligraphy-added-08.png",
      "calligraphy-added-09.png",
      "calligraphy-added-11.png"
    ];
    // 预加载全部书法字稿，全部成功才进入序列
    const preloadCalligraphy = () => Promise.all(calligraphyAssets.map((src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(src);
      image.onerror = () => reject(new Error(`Unable to load calligraphy image: ${src}`));
      image.src = src;
    })));
    // Fisher–Yates 洗牌：随机打乱数组顺序
    const shuffle = (items) => {
      const shuffled = [...items];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
      return shuffled;
    };
    // 通用：以 Promise 形式加载一张图片
    const loadImageSource = (src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
      image.src = src;
    });
    // 采样书法字稿的“墨色”像素作为粒子起点（越深越重越易选中）
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
    // 采样“月下人”主图像素作为粒子终点（按亮度分桶取色）
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
    /* 字化飞墨：把飞落字稿的像素化为粒子，聚成月下人主图 */
    const runGlyphParticleTransform = () => {
      const particleCanvas = calligraphySequence.querySelector(".calligraphy-particle-canvas");
      if (!particleCanvas) return Promise.resolve(false);
      // file: 协议下无法读取 canvas 像素，直接跳过粒子动画
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
      return loadImageSource("home-hero.jpg").then((heroImage) => {
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
    /* 离场收场：以水墨晕染(.arrival-ink-wash)柔和收束入场场景，替代早先的碎裂层；若水墨动画仍在进行则稍候再揭示主页 */
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
    /* 水墨间奏：canvas 上的墨点 + 墨痕粒子场 */
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
      // 生成单个墨点粒子（初值与再生时复用）
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
        // 每帧绘制：先淡出旧帧，再更新并绘制墨点/墨痕
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
    /* 抵达幕进度：滚动驱动的视差、逐字显现与指针视差 */
    let arrivalSceneIndex = -1;
    let inkWashRunning = false;
    // 场景切换时短暂铺一层水墨晕染（.arrival-ink-wash）
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
    // 根据抵达幕内层滚动容器的滚动位置计算整体进度与各图层位移
    const updateArrivalProgress = () => {
      if (!arrivalInterlude || !arrivalTrack) return;
      // 可视高度：轨道被撑到约 390svh，多出来的部分才是真正的行程
      const viewportH = window.innerHeight;
      // 兼容取内层滚动容器；缺失时回退为页面滚动模型
      const scroller = arrivalScroller || null;
      // 行程总长 = 轨道高度 - 可视高度（有内层容器用容器高，否则用一屏高）
      const scrollRange = arrivalTrack.offsetHeight - (scroller ? scroller.clientHeight : viewportH);
      // 已滚过的行程：内层容器直接读 scrollTop，页面滚动则用轨道顶边位移
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
      // 雾气横移取正弦（1.4 个周期，来回起伏而非单向直线），纵向下压；两者共同撑开纵深
      arrivalInterlude.style.setProperty("--arrival-mist-x", `${Math.sin(progress * Math.PI * 1.4) * 38}px`);
      arrivalInterlude.style.setProperty("--arrival-mist-y", `${progress * 56}px`);
      // 远景山峦：横向慢移（90px）+ 纵向缓升（34px），最远层视差
      arrivalInterlude.style.setProperty("--arrival-hill-far-x", `${(-progress * 90).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-hill-far-y", `${(-progress * 34).toFixed(1)}px`);
      // 中景山峦：横移更快（190px），与远山拉开层次
      arrivalInterlude.style.setProperty("--arrival-hill-mid-x", `${(-progress * 190).toFixed(1)}px`);
      // 江岸：横移量再加大（280px），承接山与水面，形成第三层纵深
      arrivalInterlude.style.setProperty("--arrival-shore-x", `${(-progress * 280).toFixed(1)}px`);
      // 垂柳：前景框景，横移最快（330px），左右两条柳枝共用同一变量
      arrivalInterlude.style.setProperty("--arrival-willow-x", `${(-progress * 330).toFixed(1)}px`);
      // 孤舟：横移（150px）叠加正弦漂浮（±10px 横向、±7px 纵向），并按余弦轻微倾斜（±2.4°）
      arrivalInterlude.style.setProperty("--arrival-boat-x", `${(-progress * 150 + Math.sin(progress * Math.PI * 2) * 10).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-boat-y", `${(Math.sin(progress * Math.PI * 3) * 7).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-boat-tilt", `${(Math.cos(progress * Math.PI * 2.4) * 2.4).toFixed(2)}deg`);
      // 芦苇：向右横移（230px），与向左的山峦形成反向视差
      arrivalInterlude.style.setProperty("--arrival-reed-x", `${(progress * 230).toFixed(1)}px`);
      // 雁阵：随进度斜向掠过（横 420px、纵 120px）
      arrivalInterlude.style.setProperty("--arrival-geese-x", `${(-progress * 420).toFixed(1)}px`);
      arrivalInterlude.style.setProperty("--arrival-geese-y", `${(-progress * 120).toFixed(1)}px`);
      // 推镜：舞台整体由 1 缓慢放大到 1.07，模拟镜头向前
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
      // 进入按钮不做「进度到 90% 才解禁」的设卡：始终可点，点击即走收场流程进入首页
      if (arrivalEnterButton) arrivalEnterButton.disabled = false;
      if (arrivalSceneIndex !== -1 && sceneIndex !== arrivalSceneIndex && !reducedMotion && !inkWashRunning) playArrivalInkWash();
      arrivalSceneIndex = sceneIndex;
    };
    // 撒一层落花：向 .arrival-petals 注入若干花瓣 <i>（窄屏 10 粒 / 桌面 18 粒），
    // 已有花瓣则跳过；各粒随机写 --petal-x/size/duration/delay/drift/opacity，飘落节奏全由 CSS 动画驱动
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
    // 指针视差：把鼠标位置映射为 soft / deep / 基础 三档位移变量
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
    /* 展示抵达幕：全屏固定层 + 内层滚动容器模型。滚动在容器内推进进度，
       滚到底后继续下滚（wheel 判底）即触发水墨收场并进入首页 */
    const showArrivalInterlude = () => new Promise((resolve, reject) => {
      // 固定层模型下内层容器是必需的，缺失即视为结构不完整
      if (!arrivalInterlude || !arrivalTrack || !arrivalScroller || !arrivalEnterButton || !arrivalSkipButton) {
        reject(new Error("The parallax arrival interlude is incomplete."));
        return;
      }
      // 收场标记：保证 finish 只执行一次（滚到底 / 点按钮都可能触发）
      let finished = false;
      // 滚动合并到一帧处理（rAF 节流）：滚动事件很密，避免每个像素都重算图层与逐字显现
      let rafPending = false;
      const onScroll = () => {
        if (rafPending) return;
        rafPending = true;
        window.requestAnimationFrame(() => {
          rafPending = false;
          updateArrivalProgress();
        });
      };
      // 统一出口：先播水墨收场，再淡出抵达幕、揭开首页并回到顶端
      const finish = () => {
        if (finished) return;
        finished = true;
        removeListeners();
        exitArrivalScene(() => {
          arrivalInterlude.classList.add("is-leaving");
          revealHome();
          window.scrollTo({ top: 0, behavior: "auto" });
          document.querySelector(".hero-actions a")?.focus({ preventScroll: true });
          resolve();
        });
      };
      // 滚轮判底：行程已滚满还继续下滚时，拦截本次滚动并直接收场
      const onWheel = (event) => {
        if (finished || event.deltaY <= 0) return;
        const scrollRange = arrivalTrack.offsetHeight - arrivalScroller.clientHeight;
        if (arrivalScroller.scrollTop >= scrollRange - 2) {
          event.preventDefault();
          finish();
        }
      };
      // 「继续」按钮：按当前幕位分两步走 —— 未到末幕就平滑滚入下一幕，已在第三幕才真正收场
      const enterOrAdvance = () => {
        if (finished) return;
        // 行程可滚动距离：内层容器高度减去可视高度（与滚动监听同一套换算式）
        const scrollRange = arrivalTrack.offsetHeight - arrivalScroller.clientHeight;
        // 当前进度 0～1：行程为空时按满进度处理
        const progress = scrollRange > 0 ? arrivalScroller.scrollTop / scrollRange : 1;
        // 进度切成三幕：0 / 1 / 2（上限夹到 2，防止浮点误差越界）
        const currentScene = Math.min(2, Math.floor(progress * 3));
        // 已在末幕：无需再滚，直接走统一出口收场
        if (currentScene >= 2) {
          finish();
          return;
        }
        // 第一、二幕：平滑滚入下一幕（越过场景分界点）
        const target = (scrollRange * (currentScene + 1)) / 3 + 6;
        arrivalScroller.scrollTo({ top: target, behavior: "smooth" });
      };
      // 解绑全部监听并解除页面滚动锁
      const removeListeners = () => {
        arrivalScroller.removeEventListener("scroll", onScroll);
        window.removeEventListener("wheel", onWheel);
        document.body.classList.remove("arrival-lock");
      };
      prepareArrivalCopy();
      // 撒一层浮尘光点（只做一次，后续靠 CSS 动画循环）
      spawnArrivalMotes();
      // 再撒一层落花花瓣（同样只做一次）
      spawnArrivalPetals();
      arrivalInterlude.removeAttribute("aria-hidden");
      arrivalInterlude.removeAttribute("inert");
      arrivalInterlude.classList.add("is-visible");
      // 锁住页面本身滚动：行程只在内层容器里推进
      document.body.classList.add("arrival-lock");
      arrivalScroller.addEventListener("scroll", onScroll, { passive: true });
      // wheel 用非 passive，才能在判底时 preventDefault 拦下这次滚动
      window.addEventListener("wheel", onWheel, { passive: false });
      window.addEventListener("pointermove", updateArrivalPointer, { passive: true });
      arrivalEnterButton.addEventListener("click", enterOrAdvance);
      arrivalSkipButton.addEventListener("click", finish);
      arrivalChapterButtons?.forEach((button) => {
        button.addEventListener("click", () => {
          const chapter = Number(button.dataset.arrivalScene);
          const scrollRange = arrivalTrack.offsetHeight - arrivalScroller.clientHeight;
          // 末幕直接取 1：内层容器 scrollTo 贴边不会再差半格
          const chapterProgress = chapter === 2 ? 1 : (chapter + 0.5) / 3;
          arrivalScroller.scrollTo({ top: scrollRange * chapterProgress, behavior: reducedMotion ? "auto" : "smooth" });
        });
      });
      // 先按当前滚动位置算一次，避免首帧无进度导致文案不亮
      updateArrivalProgress();
      resolve();
    });
    /* 书法序列主流程：等视频结束 → 字化飞墨 → 水墨间奏 → 抵达幕 */
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
      // 循环从底部飞落书法字稿，直到背景视频播完
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
      // 视频结束后：字化飞墨 → 水墨间奏 → 抵达幕 → 揭幕
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
        const interludeDuration = 7000; // 墨迹插页展示时长（ms）：拉长到 7 秒，给水墨晕染更多停留
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
        // 进入首页的动作（revealHome / 聚焦）已移入抵达幕的 finish() 收场回调
        await showArrivalInterlude();
      };
      const displayCalligraphyPromise = displayCalligraphy();
      await showInterludeAfterCalligraphy();
    };
    /* 揭幕：移除开场层、解锁 header/main/footer，进入首页 */
    let homeRevealPromise;
    // 标记开场已完成；解锁页面；延迟后清理各开场层
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
    // 已看过开场：直接显示首页，跳过动画
    if (sessionStorage.getItem(introStorageKey) === "true") {
      document.body.classList.add("book-opened");
      bookOpening.remove();
      calligraphySequence.remove();
      inkInterlude?.remove();
      arrivalInterlude?.remove();
      document.querySelectorAll("header[inert], main[inert], footer[inert], audio[inert]").forEach((element) => element.removeAttribute("inert"));
      document.querySelector(".hero-actions a")?.focus({ preventScroll: true });
    } else {
      // 点击“翻开词境”后启动开场动画
      bookOpenButton.addEventListener("click", () => {
        bookOpenButton.disabled = true;
        // 翻开书封即启动引子音频，铺满开场动画的前半程
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

  /* ============================================================
   * 无刷新翻页（SPA）：fetch + 替换 main，配水波过渡
   * ============================================================ */
  let navigationVersion = 0;
  let activePageRipple = null;
  // 创建一次页面级水波（.page-ripple）并锁定过渡状态
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
    // file: 协议下无法 fetch，退化为整页跳转并用 sessionStorage 还原水波原点
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
  // 高亮当前页面对应的导航项
  const updateActiveNavigation = (url) => {
    document.querySelectorAll(".main-nav a").forEach((link) => {
      const active = new URL(link.href, location.href).pathname === url.pathname;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };
  /* 核心：拉取目标页 → 替换 main → 更新标题/导航/历史 → 定位 */
  const navigateTo = async (url, addHistory = true, origin) => {
    const version = ++navigationVersion;
    let ripple;
    try {
      // 以 fetch 拉取目标页 HTML（带自定义头，便于后端区分）
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
      // 用新页面的 <main> 就地替换，无需整页刷新
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
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    /* 拦截站内 .html 链接改为无刷新跳转；其余放行 */
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self" || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith(".html")) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY };
    if (location.protocol === "file:") {
      sessionStorage.setItem("liyu-page-ripple-origin", `${origin.x},${origin.y}`);
      startPageRipple(origin);
      window.setTimeout(() => location.assign(url.href), 240);
      return;
    }
    navigateTo(url, true, origin);
  });
  // 浏览器前进/后退时同步无刷新切换页面
  window.addEventListener("popstate", () => {
    if (location.protocol !== "file:" && location.pathname.endsWith(".html")) navigateTo(new URL(location.href), false);
  });

  /* ============================================================
   * 生平时间线：滚动驱动的叙述进度条 + 场景联动
   * ============================================================ */
  let timelineScrollTicking = false;
  // 计算滚动位置对应时间线的“阅读线”，更新进度与场景文案
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
    // 按当前章节年份切换对应场景背景图：给匹配 data-year 的层加 is-active，其余移除（实现旧图渐隐、新图渐显）
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
  // 以 rAF 节流滚动更新，避免频繁重排
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
  /* 滚动视差元素集合：由 initializeScrollInteractions 在初始化时填充，updateScrollUi 据此写入 --scroll-y */
  let parallaxElements = [];
  /* 词作笺赏(poem-gallery)叙事状态：各词卡、顶部标签与交叉观察器，随滚动高亮当前词并联动标签 */
  let ciEntries = [];
  let ciTabs = [];
  let ciObserver;
  /* 阅读进度条 + 返回顶部按钮（缺失时自动创建）+ 滚动渐显 */
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
        // 词作笺赏：按视口中心位置计算每首词的阅读进度，写入 --entry-progress 供 CSS 联动高亮
        ciEntries.forEach((entry) => {
          const rect = entry.getBoundingClientRect();
          const entryProgress = Math.min(1, Math.max(0, (viewportCenter - rect.top) / rect.height));
          entry.style.setProperty("--entry-progress", entryProgress.toFixed(3));
          // 词句逐行浮现：把每首词的正文各句按阅读进度依次点亮（--line-reveal 0→1）
          const lines = entry.querySelectorAll(".poem-line");
          // 句数即分母，决定每句分到的进度区间长度
          const total = lines.length;
          // 若无分行（纯文本结构）则跳过，保持原样
          if (total > 0) {
            lines.forEach((line, i) => {
              // 当前句的显现比例：进度越靠后，越靠后的句子依次浮现；
              // 1.6 为相邻句之间的错开量，使整首词呈波浪式浮现而非同时亮起
              const reveal = Math.min(1, Math.max(0, (entryProgress * (total + 1.6) - i) / 1.6));
              // 写入 CSS 变量，交由 style.css 的 .poem-line 消费（透明度 / 位移）
              line.style.setProperty("--line-reveal", reveal.toFixed(3));
            });
          }
        });
        // 词作长廊整体视差：随长廊相对视口的位置做低速位移（--gallery-parallax）
        const gallery = document.querySelector(".poem-gallery");
        if (gallery) {
          // 长廊外框：用于计算它相对视口中心的推进比例
          const gRect = gallery.getBoundingClientRect();
          // 推进比例可小于 0 或大于 1（尚未进入 / 已越过），越界部分交由 CSS 自行吸收
          // 该值只在 updateScrollUi 内使用，不写回全局状态
          const gProgress = (viewportCenter - gRect.top) / gRect.height;
          // 最多 60px 的缓慢位移，让长廊与逐行显现形成轻微纵深差
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
      // 已包过层的（重复初始化）直接跳过
      if (card.parentElement?.classList.contains("poem-card-layer")) return;
      // 新建 .poem-card-layer 包住卡片，滚动视差只作用于外层
      const layer = document.createElement("div");
      layer.className = "poem-card-layer";
      card.parentNode.insertBefore(layer, card);
      layer.appendChild(card);
    });
    const revealTargets = document.querySelectorAll(".timeline-item, .poem-card, .recite-card, .media-card, .memory-line article, .work-entry, .intro-card");
    // 减弱动效或不支持 IntersectionObserver 时直接全部显示
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
        // 默认归入标准视差档；各特殊元素按各自速度/类名分流
        let cls = "scroll-parallax";
        if (el.classList.contains("work-side")) { speed = "0.32"; cls = "scroll-parallax-slow"; }
        else if (el.classList.contains("work-number")) { speed = "0.55"; cls = "scroll-parallax-slow"; }
        else if (el.matches(".work-main h3")) { speed = "0.7"; cls = "scroll-parallax-slow"; }
        // 独立背景视差层：慢速漂移
        else if (el.classList.contains("bg-parallax")) { speed = "0.35"; cls = "scroll-parallax-bg"; }
        // 整块区块（含其 ::before 背景层）：统一 0.35 的轻微背景漂移
        else if (el.matches(".intro, .story, .afterlife-section, .closing, .listen-content, .listen-interactive, .screen-world, .recite-art")) { speed = "0.35"; cls = "bg-drift"; }
        // 区块内的配图：半速下沉，与文字拉开层次
        else if (el.matches(".poet-portrait")) { speed = "0.5"; cls = "img-parallax"; }
        // 细碎装饰：轻缓半速，避免抢主体视线
        else if (el.matches(".note-ornament, .echo-quote")) { speed = "0.4"; cls = "scroll-parallax-slow"; }
        // 结尾松枝：中速位移，营造风过枝摇
        else if (el.classList.contains("closing-pine")) { speed = "0.6"; cls = "scroll-parallax"; }
        // 首页主视觉配图框：换成专属 hero-art-scroll 档（在居中位移上叠加滚动量）
        else if (el.classList.contains("hero-art")) { speed = "0.55"; cls = "hero-art-scroll"; }
        // life 页时间线场景框：反向视差（-0.5，比滚动慢半拍制造纵深）
        else if (el.classList.contains("timeline-scene")) { speed = "-0.5"; }
        // life 页时间线列表：轻速正向视差
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
    // 初始化词作笺赏的滚动叙事（当前词高亮 + 标签联动）
    initializeCiNarrative();
  };

  /* 首页 hero：指针驱动多层视差（底景最慢、人物中速、灯笼前景最快） */
  const initializeHeroPointerParallax = () => {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    // 立绘层按底图 object-fit:cover 的实际渲染矩形复位（源图 768 方图中的位置 130,46 545x660）
    const base = hero.querySelector(".hero-base");
    const figureLayer = hero.querySelector(".hero-figure-layer");
    if (base && figureLayer) {
      let layoutPending = false;
      // 按底图 cover 后的缩放比，把人物在白底图里的原始矩形换算成屏幕像素并写回
      const placeFigure = () => {
        layoutPending = false;
        const frame = figureLayer.parentElement.getBoundingClientRect();
        const natW = base.naturalWidth || 768;
        const natH = base.naturalHeight || 768;
        const scale = Math.max(frame.width / natW, frame.height / natH);
        const renderedW = natW * scale;
        const renderedH = natH * scale;
        // cover 居中留白偏移：底图超出容器的部分左右/上下均分
        const x0 = (frame.width - renderedW) / 2;
        const y0 = (frame.height - renderedH) / 2;
        figureLayer.style.left = `${(x0 + 130 * scale).toFixed(1)}px`;
        figureLayer.style.top = `${(y0 + 46 * scale).toFixed(1)}px`;
        figureLayer.style.width = `${(545 * scale).toFixed(1)}px`;
        figureLayer.style.height = `${(660 * scale).toFixed(1)}px`;
      };
      // 同一帧内只排一次布局计算，避免连续 resize 造成抖动
      const schedulePlace = () => {
        if (!layoutPending) {
          layoutPending = true;
          window.requestAnimationFrame(placeFigure);
        }
      };
      // 底图已缓存则立即定位，否则等 load 后再算一次真实尺寸
      if (base.complete) schedulePlace();
      else base.addEventListener("load", schedulePlace, { once: true });
      window.addEventListener("resize", schedulePlace);
    }
    // 减弱动效偏好或触屏（指针不精确）时，不再绑定位移，静止即最优
    if (reducedMotion || window.matchMedia("(pointer:coarse)").matches) return;
    let rafPending = false;
    let targetX = 0;
    let targetY = 0;
    // 把 -1~1 的指针位置写入 CSS 变量，各层用 calc() 自行换算位移量
    const apply = () => {
      rafPending = false;
      hero.style.setProperty("--hero-px", targetX.toFixed(3));
      hero.style.setProperty("--hero-py", targetY.toFixed(3));
    };
    // 指针移动频繁，合并到每帧只写一次，减少样式重算
    const schedule = () => {
      if (!rafPending) {
        rafPending = true;
        window.requestAnimationFrame(apply);
      }
    };
    hero.addEventListener("pointermove", (event) => {
      // 触摸/触控笔不参与指针视差，避免与滚动冲突
      if (event.pointerType === "touch" || event.pointerType === "pen") return;
      const rect = hero.getBoundingClientRect();
      targetX = Math.min(1, Math.max(-1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      targetY = Math.min(1, Math.max(-1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
      schedule();
    });
    // 指针离开首屏：各层回到原位
    hero.addEventListener("pointerleave", () => {
      targetX = 0;
      targetY = 0;
      schedule();
    });
  };

  /* 词作笺赏叙事：用交叉观察器高亮当前可见词卡，并让顶部标签与之联动；点击标签平滑滚动到对应词 */
  const initializeCiNarrative = () => {
    const gallery = document.querySelector(".poem-gallery");
    if (!gallery) { ciEntries = []; ciTabs = []; ciObserver?.disconnect(); return; }
    ciEntries = Array.from(gallery.querySelectorAll(".work-entry"));
    ciTabs = Array.from(gallery.querySelectorAll(".poem-tabs a"));
    // 标记词作叙事已就绪，CSS 可据此启用分层、水印等增强样式
    gallery.dataset.ciReady = "true";
    // 给条目编号水印，并把词作正文按句拆成独立行，便于逐行浮现；注入词牌大水印
    ciEntries.forEach((entry, idx) => {
      // 01 / 02 / 03… 序号，供 CSS 的装饰性编号使用
      entry.dataset.index = String(idx + 1).padStart(2, "0");
      // 词作正文容器；页面结构不同则跳过拆句
      const poemText = entry.querySelector(".poem-text");
      // 已拆过就不再处理，避免翻页回访时二次包裹
      if (poemText && !poemText.dataset.linesReady) {
        // 取原 innerHTML，以 <br> 为界切分到“句”级
        const raw = poemText.innerHTML;
        // trim + 过滤空片段（连续 <br> 或首尾换行会产生空串）
        const segments = raw.split(/<br\s*\/?>/i).map((s) => s.trim()).filter((s) => s.length > 0);
        // 每句包一层 .poem-line 并按序编号，供逐行显现使用
        poemText.innerHTML = segments.map((seg, i) => {
          if (seg === "") return `<span class="poem-line-gap"></span>`;
          return `<span class="poem-line" data-line="${i}">${seg}</span>`;
        }).join("");
        // 记录已拆句，防止重复进入时再次包裹
        poemText.dataset.linesReady = "true";
      }
      // 首次进入时注入词牌大水印（.work-watermark），作背景大字装饰
      if (!entry.querySelector(".work-watermark")) {
        // 取标题节点，作为水印文案来源
        const h3 = entry.querySelector(".work-main h3");
        // 优先取 <h3> 首个文本节点（即词牌名），否则退回元素 id
        const title = (h3 ? h3.childNodes[0]?.textContent?.trim() : entry.id) || entry.id;
        // 用 span 而非伪元素，便于复用同一份词牌文本
        const wm = document.createElement("span");
        wm.className = "work-watermark";
        wm.textContent = title;
        // 追加到词卡末尾，由 CSS 绝对定位到背景层
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
    // 当前词判定：词卡有 30% / 50% / 70% 进入“视口中段”即视为正在阅读；rootMargin 上下各收缩，避免边缘词抢占
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

  /* ============================================================
   * 生平故事弹窗：四条生平（937→978）数据 + 原生 <dialog>
   * ============================================================ */
  const timelineStories = [
    {
      period: "937 · 金陵",
      title: "生于南唐，长于宫苑",
      paragraphs: [
        "李煜生于南唐都城金陵，初名从嘉。南唐承接江南文脉，宫廷中诗书、音乐、书画相互滋养；他自幼浸润其中，逐渐显露出对文学与艺术的敏锐感受。",
        "他并非以治国抱负闻名的储君形象。后世记述常以温和、好学、多才来描绘他，但其少年生活的具体细节并不都能确证。可以确定的是，南唐宫廷的审美经验，为他早期词作提供了熟悉的场景与声色。",
        "《玉楼春》等作品写宫廷宴乐、妆饰与春夜，语言明丽，意象细密。读这些词，可以看到一位熟悉宫廷生活的创作者；也能看出他后来转向故国之思之前，词艺已相当成熟。"
      ],
      poem: "晚妆初了明肌雪，春殿嫔娥鱼贯列。",
      poemNote: "《玉楼春》"
    },
    {
      period: "961 · 南唐",
      title: "仓促登上帝位",
      paragraphs: [
        "961年，李煜继位，成为南唐后主。此时北方宋朝日益强盛，南唐处境受到挤压。新君面对的不只是宫廷事务，也包括如何在强邻压力下维持政权。",
        "李煜在位期间，南唐对宋采取称臣、纳贡等方式求取喘息空间。关于他的政治决断，后世评价不一；若回到当时局势，便能看见一个文化气息浓厚的江南政权，正处在不断收缩的时代夹缝中。",
        "早期词作多写宴饮、歌舞、离情与宫廷生活，风格婉丽。《玉楼春》中的春殿与嫔娥，并非单纯的繁华装饰，也保存了南唐宫廷日常审美的一角。"
      ],
      poem: "晚妆初了明肌雪，春殿嫔娥鱼贯列。",
      poemNote: "《玉楼春》"
    },
    {
      period: "975 · 金陵",
      title: "故国山河，一朝易主",
      paragraphs: [
        "975年，宋军攻取金陵，南唐灭亡。李煜出降后被带往北方，结束了作为一国之君的生活。对于宫城、宗庙与旧日臣民而言，这是政权更替；对李煜个人而言，则是身份、居所与生活秩序同时断裂。",
        "后来的词作把这种巨变写成可以感知的细节：离开宗庙时的仓皇、梦中不知身为客、凭栏时望不尽的江山。作品并不是史书式的战事记录，而是把失去之后的记忆与情绪留在词句中。",
        "《破阵子》追写离开金陵的场景，短短数句让告别的仓促与哀痛凝在一起。读者由此听见的，不只是一个君主的失国，也是一个人回望故园时无从挽回的怅惘。"
      ],
      poem: "最是仓皇辞庙日，教坊犹奏别离歌。",
      poemNote: "《破阵子·四十年来家国》"
    },
    {
      period: "978 · 汴京",
      title: "春水东流，词心不朽",
      paragraphs: [
        "被俘之后，李煜居于汴京。远离金陵的日子里，故国不再是眼前的疆土，而成为记忆、梦境与词中的意象。后期作品因此呈现出更深的身世之感，也将个人愁绪写成读者能够共感的生命经验。",
        "《虞美人》以春花秋月起兴，从追问往事写到故国不堪回首，最后把愁绪比作东流春水。它没有铺陈繁复典故，而用日常可见的季节、月色与流水，形成绵延不尽的情感力量。",
        "李煜于978年在汴京去世，年四十二（传统虚岁说法）。关于其生命终结的具体经过，史籍记载与后世叙述并不完全一致；不宜把传闻当作定论。可以确定的是，他的词作跨越了南唐兴亡，持续影响后世词体与读者。"
      ],
      poem: "问君能有几多愁？恰似一江春水向东流。",
      poemNote: "《虞美人·春花秋月何时了》"
    }
  ];

  // 记录打开弹窗前的焦点元素，关闭后归还（可访问性）
  let timelineReturnFocus = null;
  // 绑定时间线卡片（role=button）→ 打开对应生平故事弹窗
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

  /* ============================================================
   * 记忆/当代叙事弹窗：史实 · 词境 · 今人 三重叙述
   * ============================================================ */
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

  // 同时支持 .memory-line 卡片与 .media-art 作品卡打开弹窗
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

  /* 写词互动：把提交的一句词化作随风飘散的字（.wind-release）*/
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

  /* 金竹飘落：在 .bamboo-leaves 画布上绘制缓缓飘落的竹叶，含 DPR 适配、resize 重建、页面隐藏时暂停；减弱动效时不启动 */
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

  /* 3D 倾斜：指针悬停时让卡片随指针轻微立体偏转 */
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

  /* ============================================================
   * 磁吸按钮：深色主按钮 / 封面翻开按钮随指针轻微吸附
   * 触屏设备与「减弱动效」用户直接跳过；效果通过写入
   * --mag-x / --mag-y 两个 CSS 变量驱动 translate，松手即归位
   * ============================================================ */
  const initializeMagneticButtons = () => {
    if (reducedMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    document.querySelectorAll(".button-dark, .book-open-button").forEach((button) => {
      if (button.dataset.magnetReady === "true") return;
      button.dataset.magnetReady = "true";
      // 指针离开/取消时移除变量，按钮回到原位
      const reset = () => {
        button.style.removeProperty("--mag-x");
        button.style.removeProperty("--mag-y");
      };
      button.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch") return;
        // 把指针在按钮内的位置归一化到 [-1,1]，再按比例换算吸附位移
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

  /* ============================================================
   * 页面内容初始化（每次翻页后重调）：渐显/弹窗/诵读/收藏/表单
   * ============================================================ */
  function initializePageContent() {
  initializeScrollInteractions();
  // 首屏指针视差（底景 / 人物 / 灯笼三层随鼠标微动）
  initializeHeroPointerParallax();
  updateTimelineNarrative();
  initializeBambooLeaves();
  initializeDepthInteractions();
  initializeMagneticButtons();
  initializeTimelineStories();
  initializeMemoryStories();
  let speaking = false;
  // 为我诵读：调用 SpeechSynthesis 朗读 data-poem
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

  // 收藏：以 localStorage 记忆每首词的收藏状态
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

  // 字数计数器：实时显示“已输入 / 上限”
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

  // 心情表单：提交后清空并给出温柔反馈
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
  // 填词提示词：点击把预设词缀接到输入框
  document.querySelectorAll(".prompt-words button").forEach((button) => {
    button.addEventListener("click", () => {
      const field = document.getElementById("my-line");
      field.value = `${field.value}${button.dataset.prompt}`;
      field.focus();
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  // 写词表单：提交后触发“随风飘散”动效并反馈
  document.querySelector(".poem-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const field = document.getElementById("my-line");
    const feedback = document.querySelector(".poem-feedback");
    if (!field.value.trim()) {
      feedback.textContent = "先写下一句心情，再让涟漪带走它。";
      field.focus();
      return;
    }
    const writtenLine = field.value.trim();
    animateWrittenLineAway(event.currentTarget, writtenLine);
    feedback.textContent = `“${writtenLine}” —— 已随风带入词境。`;
    field.value = "";
    document.getElementById("line-count").textContent = "0 / 100";
  });

  // 文创笺铺：全站右侧滑出抽屉（概念展示，不存在任何真实下单/支付链路）
  (function initializeShopSidebar() {
    // 已注入过则不重复挂载（防重复初始化）
    if (document.querySelector(".shop-tab")) return;
    // 概念文创清单：每件取一阕词的核心意象转译为器物
    const goods = [
      { img: "shop-paper.jpg", alt: "浣花春水笺概念图：带春水暗纹的宣纸信笺", meta: "文房信笺 · 灵感《虞美人》", name: "浣花春水笺", desc: "一套八张的仿古宣笺，以「一江春水」波纹作暗纹，落梅点缀纸角。提笔写信时，愁绪也化作了东流的水。" },
      { img: "shop-bookmark.jpg", alt: "月钩梧桐书签概念图：弯月梧桐造型的黄铜楠木书签", meta: "流苏书签 · 灵感《相见欢》", name: "月钩梧桐签", desc: "黄铜为钩月，楠木作梧桐，垂一缕墨色流苏。「无言独上西楼」的那夜月色，从此夹在正在读的那一页。" },
      { img: "shop-scroll.jpg", alt: "春水东流卷轴概念图：绘有江山孤舟的中式水墨挂轴", meta: "卷轴壁纸 · 灵感《虞美人》", name: "春水东流卷", desc: "一款可打印的数字长卷壁纸，亦可装裱为案头小挂轴。远山、孤舟与东流江水展开在屏幕上，愁有了形状，也有了归处。" },
      { img: "shop-postcard.jpg", alt: "春花秋月明信片概念图：四张一套的水墨词意明信片", meta: "词意明信片 · 灵感四阕代表作", name: "春花秋月帖", desc: "四阕词、四帧景：春水花月、深院梧桐、暮雨归梦、落梅春草。背面印词，正面入画，寄给此刻想念的人。" },
      { img: "shop-tape.jpg", alt: "落花流水胶带概念图：绘有落花春水纹样的三卷和纸胶带", meta: "和纸胶带 · 灵感《浪淘沙令》", name: "落花流水纹", desc: "「流水落花春去也」化作两卷手账胶带：一卷落花，一卷水纹。贴在日记边角，给普通的一天盖上词的落款。" },
      { img: "shop-seal.jpg", alt: "煜字朱砂闲章概念图：石质印章与朱砂拓印", meta: "朱砂闲章 · 灵感词帝之名", name: "「煜」字小印", desc: "一方朱文小印，刻他的名字，也刻「一江春水」四字作引首章。盖在书的扉页，像与千年前的词人同署了一页。" }
    ];
    // 商品卡 HTML 片段：左图 + 角标 + 右文（元信息/名/描述/概念按钮）
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

    // 侧缘竖排小签（入口按钮）
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "shop-tab";
    tab.setAttribute("aria-label", "打开文创笺铺侧边栏（概念展示，非真实售卖）");
    tab.setAttribute("aria-expanded", "false");
    tab.innerHTML = "文创笺铺<small>概念展示</small>";

    // 遮罩层
    const mask = document.createElement("div");
    mask.className = "shop-mask";
    mask.setAttribute("aria-hidden", "true");

    // 抽屉本体（role=dialog + aria-modal，开启时焦点进入）
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

    // 概念说明弹窗（点「立即选购」只此提示，不产生交易）
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
    // 开抽屉：记下原焦点、锁 body 滚动、焦点移到关闭键
    const openDrawer = () => {
      drawerOpen = true;
      lastFocused = document.activeElement;
      drawer.classList.add("is-open");
      mask.classList.add("is-open");
      tab.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      drawer.querySelector(".shop-drawer-close").focus();
      // 广播「文创笺铺抽屉已打开」事件，供笺语留言抽屉联动互斥
      document.dispatchEvent(new Event("shop-drawer-open"));
    };
    // 关抽屉：复原状态与滚动，焦点还给原元素
    const closeDrawer = () => {
      if (!drawerOpen) return;
      drawerOpen = false;
      drawer.classList.remove("is-open");
      mask.classList.remove("is-open");
      tab.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    };
    // 入口键切换开合
    tab.addEventListener("click", () => (drawerOpen ? closeDrawer() : openDrawer()));
    // 点遮罩关闭
    mask.addEventListener("click", closeDrawer);
    // 点关闭键关闭
    drawer.querySelector(".shop-drawer-close").addEventListener("click", closeDrawer);
    // Esc 关闭抽屉（但概念弹窗打开时交给弹窗自己处理）
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawerOpen && !dialog.open) closeDrawer();
    });
    // 笺语留言抽屉打开时，联动关闭文创笺铺抽屉（两抽屉互斥）
    document.addEventListener("jy-drawer-open", closeDrawer);
    // 分享词境抽屉打开时，联动关闭文创笺铺抽屉（三抽屉互斥）
    document.addEventListener("share-drawer-open", closeDrawer);

    const nameSlot = dialog.querySelector("[data-shop-name]");
    // 每张卡片的「立即选购」：把商品名填进弹窗标题并弹出
    drawer.querySelectorAll(".concept-buy").forEach((button) => {
      button.addEventListener("click", () => {
        nameSlot.textContent = button.dataset.name ? `「${button.dataset.name}」` : "";
        if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      });
    });
    // 关弹窗（兼容不支持 showModal 的降级 open 属性）
    const closeDialog = () => {
      if (dialog.open) dialog.close();
      else dialog.removeAttribute("open");
    };
    // 关闭键 / 「我知道了」都关弹窗
    dialog.querySelectorAll(".shop-notice-close, .shop-notice-ok").forEach((button) => {
      button.addEventListener("click", closeDialog);
    });
    // 点弹窗外的 backdrop 区域也关
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });
  })();

  // 笺语留言：全站侧边弹出面板。交互原型——仅存 localStorage，无公共数据库，
  // 留言只在用户本机浏览器可见，不提供公开评论发布。
  (function initializeJianyuSidebar() {
    if (document.querySelector(".jy-tab")) return;
    const STORAGE_KEY = "liyu-jianyu-v1";
        // 三条示范笺语：预置展示内容，让面板不空场
const presets = [
      { name: "金陵访客", time: "示范笺语", text: "读到「一江春水向东流」，才知愁绪也可以这样浩浩荡荡，流过千年仍不歇。" },
      { name: "西楼听雨", time: "示范笺语", text: "无言独上西楼，月如钩。今夜案头重读，恍与词人同看一钩残月。" },
      { name: "江南旧客", time: "示范笺语", text: "流水落花春去也，天上人间。愿每个读词的人，都有一刻安宁。" }
    ];
        // 本地笺筒读写与 HTML 转义（防注入）
const loadMine = () => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
      catch { return []; }
    };
    const saveMine = (list) => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { }
    };
    const escapeHtml = (value) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

        // 注入四节点：竖签 / 遮罩 / 抽屉 / 轻提示
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

        // 渲染留言列表：我的留言置顶，示范笺语垫底
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

        // 开合状态：锁 body 滚动、焦点返还、Esc/遮罩关闭
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
    // 分享词境抽屉打开时，联动关闭笺语留言抽屉
    document.addEventListener("share-drawer-open", closeDrawer);

        // 输入计数与提交：留言仅存本机 localStorage
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
        // 分享参数：当前页地址、标题、描述与配图
const pageUrl = location.href.split("#")[0];
    const pageTitle = "春水留痕·李煜词境";
    const pageDesc = "以一江春水为引，走进南唐后主的词境：读词人故事，赏四阕词笺，听一段诵读，留一句笺语。";
    const isHttp = location.protocol === "http:" || location.protocol === "https:";
    const pagePic = isHttp ? location.origin + "/plum-blossom.jpg" : "";
    const enc = encodeURIComponent;
        // 各平台官方一键分享链接（微信无网页直连接口，走扫码）
const shareLinks = {
      qzone: "https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=" + enc(pageUrl) + "&title=" + enc(pageTitle) + "&summary=" + enc(pageDesc) + (pagePic ? "&pics=" + enc(pagePic) : ""),
      qqFriend: "https://connect.qq.com/widget/shareqq/index.html?url=" + enc(pageUrl) + "&title=" + enc(pageTitle) + "&summary=" + enc(pageDesc),
      weibo: "https://service.weibo.com/share/share.php?url=" + enc(pageUrl) + "&title=" + enc(pageTitle) + (pagePic ? "&pic=" + enc(pagePic) : "")
    };

        // 注入四节点：竖签 / 遮罩 / 抽屉 / 轻提示
const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "shop-tab share-tab";
    tab.setAttribute("aria-label", "打开分享词境侧边栏（分享到微信、QQ 或复制链接）");
    tab.setAttribute("aria-expanded", "false");
    tab.innerHTML = "分享词境<small>微信 · QQ</small>";

    const mask = document.createElement("div");
    mask.className = "shop-mask";
    mask.setAttribute("aria-hidden", "true");

        // 微信二维码：HTTP(S) 下用 qrserver 生成，本地预览降级为文字提示
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

        // 开合状态：锁 body 滚动、焦点返还、Esc/遮罩关闭
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

        // 复制链接：clipboard API 失败时降级 execCommand
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
        // 分发点击：复制 / 系统分享 / 各平台新窗口打开
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
        // 支持系统分享时显示「更多分享方式」按钮
if (navigator.share) drawer.querySelector(".share-btn-sys").hidden = false;
  })();
  }
  initializePageContent();
// 首屏：初始化页面内容
})();

// 终幕页 finale.html：滚动叙事进度 + 指针视差
// 滚动进度写 .finale-scroll 的 --finale-p（0→1，驱动月亮升起/逐行晕开/场景缓推/归于寂静）；
// 精确指针设备上写 --px/--py（-1~1，驱动雾层/巨字/月亮视差）。reduced-motion 不启用。
(() => {
  const scrollBox = document.querySelector(".finale-scroll");
  // 非终幕页（无 .finale-scroll）或减弱动效时不启用
  if (!scrollBox) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let raf = 0;
  // 滚动进度：页面滚动占比 → --finale-p
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
  // 指针视差：光标位置归一到 -1~1 → --px/--py（rAF 节流）
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

// 终幕页尾声配乐：finale.html 不挂全站背景音乐（.background-audio），进入即播独立尾声曲；
// 原背景音乐在跳转离开上一页时随页面销毁立刻停止。音量沿用全站滑杆设置，页头开关同样可控；
// 尊重全局静音（liyu-audio-enabled=false 则不自动播，显示"点击开启"）；不写背景音乐进度键，
// 返回首页后原曲仍从上次进度接续。浏览器自动播放策略拦截时由首次点击/按键兜底触发。
(() => {
  const finaleAudio = document.querySelector(".finale-audio");
  // 非终幕页（无 .finale-audio）不启用
  if (!finaleAudio) return;
  const finaleButtons = document.querySelectorAll(".sound-toggle");
  const finaleSlider = document.querySelector(".volume-slider");
  // 读取全局静音标记（false = 用户上次主动关掉了声音）
  const finaleEnabled = sessionStorage.getItem("liyu-audio-enabled") !== "false";
  // 同步页头开关状态与文案（aria-pressed / aria-label / 状态字）
  const updateFinale = (playing, message) => {
    finaleButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", playing ? "关闭背景音乐" : "开启背景音乐");
      const status = button.querySelector(".sound-status");
      if (status) status.textContent = message || (playing ? "音乐开启" : "音乐关闭");
    });
  };
  // 恢复上次音量并赋给尾声曲（未存过则用默认 0.32）
  const savedFinaleVolume = sessionStorage.getItem("liyu-audio-volume");
  if (finaleSlider && savedFinaleVolume !== null) finaleSlider.value = savedFinaleVolume;
  finaleAudio.volume = Number(finaleSlider?.value || 0.32);
  const playFinale = () => {
    // 播放成功→更新为开启态；被自动播放策略拦截→显示「点击开启」待兜底
    finaleAudio.play().then(() => updateFinale(true)).catch(() => updateFinale(false, "点击开启"));
  };
  if (finaleEnabled) playFinale();
  else updateFinale(false, "点击开启");
  // 兜底：自动播放被拦截时，首次点击 / 按键即补播
  document.addEventListener("pointerdown", () => {
    if (finaleEnabled && finaleAudio.paused) playFinale();
  }, { once: true });
  document.addEventListener("keydown", (event) => {
    if (finaleEnabled && finaleAudio.paused && !event.target.closest("input, textarea, button, a")) playFinale();
  }, { once: true });
  // 音量滑杆：实时调音量并写入会话存储
  if (finaleSlider) finaleSlider.addEventListener("input", () => {
    finaleAudio.volume = Number(finaleSlider.value);
    sessionStorage.setItem("liyu-audio-volume", finaleSlider.value);
  });
  // 页头开关：暂停/续播并记录到会话存储（跨页记忆）
  finaleButtons.forEach((button) => button.addEventListener("click", () => {
    const enabled = finaleAudio.paused;
    sessionStorage.setItem("liyu-audio-enabled", String(enabled));
    if (enabled) playFinale();
    else { finaleAudio.pause(); updateFinale(false); }
  }));
})();
