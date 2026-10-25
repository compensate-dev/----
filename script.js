// 一江春水 · 李煜词境 — 交互脚本 script.js
// 主要功能模块：
//   1) 点击水波涟漪特效   2) 移动端汉堡菜单
//   3) 背景音乐(开关 / 音量 / 进度记忆)
//   4) 首页翻书落地页(翻开封面)
//   5) 无刷新翻页(水波过渡 + SPA 式导航，含 file:// 回退)
//   6) 阅读进度条 / 返回顶部 / 滚动渐显
//   7) 时间线故事弹窗(点击时间线卡片展开长篇故事)
//   8) 页面内交互(语音诵读 / 收藏 / 字数统计 / 心情与填词表单)

(() => {
  // 是否开启“减弱动效”偏好：开启后跳过花瓣、水波等动画
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 1. 点击水波涟漪特效 ---------- */
  // 全局点击：在点击坐标处生成一层水波涟漪(装饰层，自动清理)；站内链接点击交由翻页逻辑处理，不在此重复生成
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
    // 与按钮上的 autoplay 属性保持一致：会话中被关闭过就立刻暂停，避免自动播放
    audio.autoplay = audioEnabled;
    if (!audioEnabled) audio.pause();
    // 恢复上次保存的音量
    const savedVolume = sessionStorage.getItem("liyu-audio-volume");
    if (volumeSlider && savedVolume !== null) volumeSlider.value = savedVolume;
    audio.volume = Number(volumeSlider?.value || 0.32); // 默认音量 0.32
    audio.muted = false;
    // 初始化按钮文案：若因自动播放策略未能播放，提示"点击开启"
    updateSoundControls(!audio.paused, audio.paused ? (audioEnabled ? "点击开启" : "音乐关闭") : "音乐开启");
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
      // 仅在需要手动播放(浏览器拦截了自动播放)时补一次 play
      if (audioEnabled && !audio.autoplay) playBackgroundMusic();
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

  /* ---------- 4. 首页开场：翻书落地页 + 书法飞落序列 ---------- */
  // 点击「翻开词境」：禁用按钮 → 加 is-opening 触发翻书动画 → 封面淡出 → 书法字按节奏持续飞落(约 4 秒) → 序列层淡出并揭开首页
  const bookOpening = document.querySelector(".book-opening");
  const bookOpenButton = document.querySelector(".book-open-button");
  const calligraphySequence = document.querySelector(".calligraphy-sequence");
  if (bookOpening && bookOpenButton && calligraphySequence) {
    // 开场是否已播放过的标记键：写入 sessionStorage，保证同一次会话内首页开场动画只演一次
    const introStorageKey = "liyu-home-intro-completed";
    // 序列层里的背景视频(书法意象)：揭开首页时暂停播放
    const calligraphyBackground = calligraphySequence.querySelector(".calligraphy-background");
    // 墨迹插页层：书法飞落之后、正式揭开首页之前的过渡页(内含水墨画布)
    const inkInterlude = document.querySelector(".ink-interlude");
    // 视差入场段：滚动驱动的开场场景（远山 / 月 / 人物 / 松），需滚动到一定进度才能「继续」
    const arrivalInterlude = document.querySelector(".arrival-interlude");
    const arrivalScroller = arrivalInterlude?.querySelector(".arrival-scroller");
    const arrivalEnterButton = arrivalInterlude?.querySelector(".arrival-enter-button");
    const arrivalSkipButton = arrivalInterlude?.querySelector(".arrival-skip-button");
    const inkCanvas = inkInterlude?.querySelector(".ink-canvas");
    const inkContext = inkCanvas?.getContext("2d");
    // 书法素材库：显式列出实际存在的 22 张图（14 张飞落 PNG + 8 张新增 PNG），序列期间随机取用
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
    // 预加载全部书法图：任一张缺失即 reject，交给 catch 分支兜底进入首页
    const preloadCalligraphy = () => Promise.all(calligraphyAssets.map((src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(src);
      image.onerror = () => reject(new Error(`Unable to load calligraphy image: ${src}`));
      image.src = src;
    })));
    // Fisher-Yates 洗牌：返回新数组，不改动原数组
    const shuffle = (items) => {
      const shuffled = [...items];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
      return shuffled;
    };
    // 墨迹画布动画：在插页层上绘制缓慢上浮的墨色粒子与横向笔触；指针靠近时粒子被推开
    // 返回一个停止函数，供插页结束或出错时调用以释放 rAF 与事件监听
    const startInkAnimation = () => {
      if (!inkCanvas || !inkContext) throw new Error("The ink interlude canvas is unavailable.");
      const context = inkContext;
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // 高分屏最多 2 倍像素，控制绘制开销
      let width = 0;
      let height = 0;
      let frameId = 0;
      let previousFrame = 0;
      let time = 0;
      const mouse = { x: -9999, y: -9999 }; // 初始放到画面外，避免开场就被指针影响
      const particleCount = window.innerWidth < 700 ? 42 : 90; // 手机端减少粒子数
      const strokeCount = window.innerWidth < 700 ? 12 : 28;   // 手机端减少笔触数
      const random = (min, max) => min + Math.random() * (max - min);
      // 按当前视口尺寸重设画布像素，并应用 dpr 缩放
      const resize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        inkCanvas.width = Math.round(width * dpr);
        inkCanvas.height = Math.round(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      // 简易噪声场：由两组正弦叠加而成，用于给粒子施加缓慢的横向漂移
      const noise = (x, y, t) => (
        Math.sin(x * 0.003 + t * 0.4)
        + Math.cos(y * 0.0035 - t * 0.3)
        + Math.sin((x + y) * 0.002 + t * 0.15)
      ) / 3;
      // 生成一个墨色粒子：initial 为 true 时随机分布于屏幕内(用于初始化)
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
          vy: random(-0.33, -0.08), // 缓慢上浮
          hue: random(185, 215),
          saturation: random(3, 10),
          lightness: random(42, 62)
        };
      };
      // 生成一道横向墨迹笔触
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
      // 视口变化时重建画布与全部粒子、笔触
      const onResize = () => {
        resize();
        particles = Array.from({ length: particleCount }, () => makeParticle(true));
        strokes = Array.from({ length: strokeCount }, makeStroke);
      };
      // 记录指针位置，用于粒子避让
      const onPointerMove = (event) => {
        mouse.x = event.clientX;
        mouse.y = event.clientY;
      };
      // 绘制单个粒子：径向渐变 + screen 混合，模拟墨色晕开
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
      // 绘制一道笔触：旋转的椭圆径向渐变
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
      // 主渲染循环：按帧推进粒子与笔触，帧间隔做归一化以免不同刷新率下速度不一
      const render = (now) => {
        const frameScale = previousFrame ? Math.min((now - previousFrame) / 16.67, 2) : 1;
        previousFrame = now;
        time += 0.01 * frameScale;
        // 每帧用 destination-out 淡出一层，形成墨迹消散的拖尾
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
          // 指针 160px 半径内的粒子被推开
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
          particle.alpha = particle.baseAlpha * Math.sin(Math.PI * particle.life / particle.maxLife); // 生命期内淡入淡出
          if (particle.life > particle.maxLife || particle.y < -particle.radius * 2) {
            Object.assign(particle, makeParticle()); // 生命周期结束则在底部重新生成
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
    // 视差入场：按滚动进度写入 --arrival-* 变量（山景上移、月亮下沉、人物上浮、文案上移淡出）
    const updateArrivalProgress = () => {
      if (!arrivalScroller || !arrivalInterlude) return;
      const scrollRange = arrivalScroller.scrollHeight - arrivalScroller.clientHeight;
      const progress = scrollRange > 0 ? Math.min(1, Math.max(0, arrivalScroller.scrollTop / scrollRange)) : 1;
      arrivalInterlude.style.setProperty("--arrival-progress", String(progress));
      arrivalInterlude.style.setProperty("--arrival-progress-width", `${progress * 100}%`);
      arrivalInterlude.style.setProperty("--arrival-landscape-y", `${-progress * 95}px`);
      arrivalInterlude.style.setProperty("--arrival-moon-y", `${progress * 36}px`);
      arrivalInterlude.style.setProperty("--arrival-figure-y", `${progress * 82}px`);
      arrivalInterlude.style.setProperty("--arrival-copy-y", `${-progress * 38}px`);
      arrivalInterlude.style.setProperty("--arrival-copy-opacity", String(1 - progress * 0.24));
      // 进度不足 72% 时「继续」按钮保持禁用，逼迫用户滚动或选择跳过
      if (arrivalEnterButton) arrivalEnterButton.disabled = progress < 0.72;
    };
    // 视差入场：显示入场段并等待用户「继续」或「跳过」，返回 Promise 供开场链路串联
    const showArrivalInterlude = () => new Promise((resolve, reject) => {
      if (!arrivalInterlude || !arrivalScroller || !arrivalEnterButton || !arrivalSkipButton) {
        reject(new Error("The parallax arrival interlude is incomplete."));
        return;
      }
      let finished = false;
      const finish = () => {
        if (finished) return;
        if (arrivalEnterButton.disabled && document.activeElement === arrivalEnterButton) return;
        finished = true;
        arrivalScroller.removeEventListener("scroll", updateArrivalProgress);
        arrivalEnterButton.removeEventListener("click", finish);
        arrivalSkipButton.removeEventListener("click", finish);
        arrivalInterlude.classList.add("is-leaving");
        window.setTimeout(() => {
          arrivalInterlude.remove();
          resolve();
        }, 600);
      };
      arrivalScroller.scrollTop = 0;
      arrivalInterlude.removeAttribute("aria-hidden");
      arrivalInterlude.removeAttribute("inert");
      arrivalInterlude.classList.add("is-visible");
      arrivalScroller.addEventListener("scroll", updateArrivalProgress, { passive: true });
      arrivalEnterButton.addEventListener("click", finish);
      arrivalSkipButton.addEventListener("click", finish);
      updateArrivalProgress();
      window.requestAnimationFrame(() => arrivalScroller.focus({ preventScroll: true }));
    });
    // 飞落主循环：把全部书法素材按 scheduleSpan 的时间窗均匀错峰投下，形成自上而下的连绵雨幕
    const runCalligraphySequence = async (assetsReady, revealHome) => {
      const assets = await assetsReady;
      // 等待背景视频播放结束：视频不再循环，播完即进入墨迹插页
      let backgroundVideoHasEnded = Boolean(calligraphyBackground?.ended); // 视频是否已播完
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
          backgroundVideoHasEnded = true; // 标记已播完，飞落循环随之停止
          resolve();
        }, { once: true });
        calligraphyBackground.addEventListener("error", () => {
          reject(new Error("The calligraphy background video could not be played."));
        }, { once: true });
      });
      const flightInterval = 180; // 两次投放之间的间隔(毫秒)，越小飞落越密集
      // 横向落点池：按素材数量在屏幕中部均分铺开再打乱；手机端收窄，避免飞出屏幕
      const positions = shuffle(
        Array.from({ length: assets.length }, (_, index) => {
          const spread = window.innerWidth <= 700 ? 70 : 76;
          const margin = (100 - spread) / 2;
          return margin + index * (spread / (assets.length - 1));
        })
      );
      // 持续投放：每 180ms 投下一张，循环往复直到背景视频播完，形成连绵不断的书法雨
      const displayCalligraphy = async () => {
        let index = 0;
        const shuffledAssets = shuffle(assets);
        while (!backgroundVideoHasEnded) {
          const image = document.createElement("img");
          image.className = "calligraphy-flight";
          image.src = shuffledAssets[index % shuffledAssets.length];
          image.alt = "";
          image.setAttribute("aria-hidden", "true"); // 纯装饰，对读屏隐藏
          image.style.left = `${positions.pop()}%`;
          // 落点用完后重新生成一轮，保证整段飞落始终铺满屏幕中部
          if (!positions.length) {
            positions.push(...shuffle(
              Array.from({ length: assets.length }, (_, positionIndex) => {
                const spread = window.innerWidth <= 700 ? 70 : 76;
                const margin = (100 - spread) / 2;
                return margin + positionIndex * (spread / (assets.length - 1));
              })
            ));
          }
          const duration = 600 + Math.random() * 2400; // 每张时长随机，避免节奏呆板
          image.style.animationDuration = `${duration}ms`;
          // 动画结束后自行移除，避免元素堆积
          image.addEventListener("animationend", () => image.remove(), { once: true });
          calligraphySequence.append(image);
          index += 1;
          await new Promise((resolve) => window.setTimeout(resolve, flightInterval));
        }
      };
      // 书法飞落结束后：等背景视频播完 → 淡出并移除序列层 → 显现墨迹插页(4 秒) → 淡出插页 → 揭开首页
      const showInterludeAfterCalligraphy = async () => {
        await displayCalligraphyPromise;                                   // 等投放结束
        if (!inkInterlude) throw new Error("The ink interlude is missing.");
        await backgroundVideoEnded;                                        // 等背景视频播完
        // 先让书法飞落层整体淡出并移除，插页作为独立的过渡画面出现
        calligraphySequence.classList.add("is-revealing");
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        calligraphySequence.remove();
        const interludeDuration = 4000;      // 插页停留总时长
        const interludeFadeDuration = 600;   // 插页淡出预留时间
        const interludeStartedAt = performance.now();
        const stopInkAnimation = startInkAnimation(); // 启动墨迹画布动画
        inkInterlude.classList.add("is-visible");       // 显现插页
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
        const beforeFadeOut = interludeStartedAt + interludeDuration - interludeFadeDuration - performance.now();
        if (beforeFadeOut > 0) await new Promise((resolve) => window.setTimeout(resolve, beforeFadeOut));
        inkInterlude.classList.remove("is-visible");     // 插页淡出
        const untilTransition = interludeStartedAt + interludeDuration - performance.now();
        if (untilTransition > 0) await new Promise((resolve) => window.setTimeout(resolve, untilTransition));
        stopInkAnimation();   // 停止画布动画
        inkInterlude.remove(); // 移除插页层
        await showArrivalInterlude(); // 墨迹插页之后进入视差入场段（需滚动或跳过才继续）
        await revealHome();    // 插页结束后才揭开首页
        document.querySelector(".hero-actions a")?.focus({ preventScroll: true }); // 焦点交回首屏按钮
      };
      const displayCalligraphyPromise = displayCalligraphy();
      await showInterludeAfterCalligraphy();
    };
    // 首页揭开：只执行一次；序列层淡出后解除首页隐藏（焦点交由调用方在动画结束后处理）
    let homeRevealPromise;
    const revealHome = () => {
      if (homeRevealPromise) return homeRevealPromise;
      sessionStorage.setItem(introStorageKey, "true"); // 记下"开场已演过"，后续进入首页直接跳过
      calligraphySequence.classList.add("is-revealing"); // 序列层整体淡出(书法字随层一同隐去)
      document.body.classList.add("book-opened");
      document.querySelectorAll("header[inert], main[inert], footer[inert], audio[inert]").forEach((element) => element.removeAttribute("inert"));
      homeRevealPromise = new Promise((resolve) => {
        window.setTimeout(() => {
          calligraphyBackground?.pause();              // 暂停背景视频，释放解码资源
          calligraphySequence.remove();                // 移除序列层
          inkInterlude?.remove();                      // 移除墨迹插页
          arrivalInterlude?.remove();                  // 移除视差入场段
          bookOpening.remove();                        // 移除封面
          resolve();
        }, reducedMotion ? 0 : 1500);                 // 等淡出动画播完再清理
      });
      return homeRevealPromise;
    };
    // 分支一：本次会话已看过开场 → 跳过封面与飞落序列，直接显示首页
    if (sessionStorage.getItem(introStorageKey) === "true") {
      document.body.classList.add("book-opened");
      bookOpening.remove();      // 移除封面
      calligraphySequence.remove(); // 移除飞落序列层
      inkInterlude?.remove();      // 移除墨迹插页
      arrivalInterlude?.remove();  // 移除视差入场段
      document.querySelectorAll("header[inert], main[inert], footer[inert], audio[inert]").forEach((element) => element.removeAttribute("inert"));
      document.querySelector(".hero-actions a")?.focus({ preventScroll: true }); // 焦点交回首屏按钮
    } else {
      // 分支二：首次进入 → 绑定「翻开词境」按钮，走完整的翻书 + 书法飞落 + 墨迹插页开场
      bookOpenButton.addEventListener("click", () => {
        bookOpenButton.disabled = true;
        if (reducedMotion) {
          revealHome(); // 减弱动效：跳过整段开场，直接进入首页
          return;
        }
        const assetsReady = preloadCalligraphy();
        bookOpening.classList.add("is-opening"); // 触发 CSS 翻书动画(book-page-turn-up，0.5s)
        window.setTimeout(async () => {
          try {
            await assetsReady; // 等素材就绪，再揭开封面，避免飞落层空白
            bookOpening.classList.add("is-leaving");    // 封面淡出
            calligraphySequence.classList.add("is-active"); // 显现书法飞落层
            // 播放序列层背景视频(不循环)，播完即进入墨迹插页；失败不阻断开场
            calligraphyBackground?.play().catch((error) => {
              console.warn("The decorative calligraphy background video could not be played.", error);
            });
            window.setTimeout(() => bookOpening.remove(), 180); // 淡出后彻底移除封面
            await runCalligraphySequence(assetsReady, revealHome);
          } catch (error) {
            // 素材加载失败也要保证能进入首页，不阻断浏览
            console.error("The calligraphy intro could not be completed.", error);
            inkInterlude?.remove(); // 清掉可能已插入的墨迹插页
            arrivalInterlude?.remove(); // 清掉可能已插入的视差入场段
            revealHome().then(() => {
              document.querySelector(".hero-actions a")?.focus({ preventScroll: true });
            });
          }
        }, 500);
      });
    }
  }

  /* ---------- 5. 无刷新翻页(水波过渡 + SPA 式导航，含 file:// 回退) ---------- */
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
        if (activePageRipple !== ripple) { // 已被更新的导航接管
          ripple.remove();
          return;
        }
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
      if (version !== navigationVersion) { // 期间被新导航抢占
        ripple.finish();
        return;
      }
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

  /* ---------- 5-1. 生平时间线叙事进度(滚动时高亮当前段落) ---------- */
  // 滚动节流标记：避免同一帧内重复计算
  let timelineScrollTicking = false;
  // 计算时间线阅读进度：依据视口"阅读线"(屏幕 46% 处)与时间线的相对位置
  const updateTimelineNarrative = () => {
    const timeline = document.querySelector(".timeline");
    if (!timeline) return; // 非生平页无此模块
    const items = [...timeline.querySelectorAll(".timeline-item")];
    if (!items.length) return;
    // 进度条元素：不存在则动态创建并挂到时间线末尾
    let progress = timeline.querySelector(".timeline-progress");
    if (!progress) {
      progress = document.createElement("span");
      progress.className = "timeline-progress";
      progress.setAttribute("aria-hidden", "true"); // 纯装饰，对读屏软件隐藏
      timeline.append(progress);
    }
    const timelineBounds = timeline.getBoundingClientRect();
    const readingLine = window.innerHeight * 0.46; // 阅读线取视口偏上位置
    // 进度比例：时间线顶端进入阅读线之前为 0，末端之后为 1
    const progressAmount = Math.min(1, Math.max(0, (readingLine - timelineBounds.top) / timelineBounds.height));
    timeline.style.setProperty("--narrative-progress", String(progressAmount));
    // 找出离阅读线最近的段落，标记为当前段落
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
    // 章节侧栏(.timeline-scene)联动：把当前段落的年份 / 地名 / 标题 / 词句同步到侧栏
    const scene = document.querySelector(".timeline-scene");
    if (!scene || Number(scene.dataset.activeIndex) === activeIndex) return; // 侧栏不存在或章节未变化则不处理
    scene.dataset.activeIndex = String(activeIndex);
    scene.dataset.chapter = String(activeIndex + 1);
    const activeItem = items[activeIndex];
    const year = activeItem.querySelector(".timeline-year")?.textContent.trim();
    const label = activeItem.querySelector(".timeline-label")?.textContent.trim();
    const title = activeItem.querySelector(".timeline-card h3")?.textContent.trim();
    const quote = activeItem.querySelector(".timeline-quote")?.textContent.trim();
    const copy = scene.querySelector(".timeline-scene-copy");
    copy?.classList.add("is-changing"); // 先淡出旧文案
    window.setTimeout(() => {
      scene.querySelector(".timeline-scene-year").textContent = year || "";
      scene.querySelector(".timeline-scene-label").textContent = label || "";
      scene.querySelector(".timeline-scene-copy h2").textContent = title || "";
      scene.querySelector(".timeline-scene-copy blockquote").textContent = quote || "";
      // 章节计数：形如 "01 / 04"
      const count = scene.querySelector(".timeline-scene-count");
      count.firstChild.textContent = `${String(activeIndex + 1).padStart(2, "0")} `;
      count.querySelector("i").textContent = `/ ${String(items.length).padStart(2, "0")}`;
      scene.querySelector(".timeline-scene-kicker").textContent = `A LIFE IN VERSE · CHAPTER ${String(activeIndex + 1).padStart(2, "0")}`;
      // 底部进度段：当前段高亮，已读段标为完成
      scene.querySelectorAll(".timeline-scene-progress span").forEach((segment, index) => {
        segment.classList.toggle("is-current", index === activeIndex);
        segment.classList.toggle("is-complete", index < activeIndex);
      });
      copy?.classList.remove("is-changing"); // 再淡入新文案
    }, 120);
  };
  // 滚动 / 缩放时以 requestAnimationFrame 节流更新
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

  /* ---------- 6. 阅读进度条 / 返回顶部 / 滚动渐显 ---------- */
  // IntersectionObserver 实例(换页后需重新接管新的目标元素)
  let revealObserver;
  // 进度条与返回顶部按钮只绑定一次滚动监听(避免换页后重复叠加)
  let scrollUiInitialized = false;
  const initializeScrollInteractions = () => {
    // 顶部阅读进度条：不存在则动态创建
    let progress = document.querySelector(".reading-progress");
    let topButton = document.querySelector(".back-to-top");
    if (!progress) {
      progress = document.createElement("div");
      progress.className = "reading-progress";
      progress.setAttribute("aria-hidden", "true");
      document.body.append(progress);
    }
    // 右下角返回顶部按钮：不存在则动态创建并绑定点击
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
    // 滚动监听只装一次：用 requestAnimationFrame 节流，避免高频重排
    if (!scrollUiInitialized) {
      let scrollTicking = false;
      const updateScrollUi = () => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        // 进度条按已滚动比例横向缩放
        progress.style.transform = `scaleX(${scrollable > 0 ? window.scrollY / scrollable : 0})`;
        // 滚动超过 420px 才显示返回顶部按钮
        topButton.hidden = window.scrollY < 420;
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

    // 换页后先断开旧的观察器，再对新的卡片重新观察
    revealObserver?.disconnect();
    // 需要渐显的卡片类型：时间线、词作、诵读、媒体卡、记忆条目、词条、首页导语卡
    const revealTargets = document.querySelectorAll(".timeline-item, .poem-card, .recite-card, .media-card, .memory-line article, .work-entry, .intro-card");
    // 减弱动效或浏览器不支持时：直接全部显示
    if (reducedMotion || !("IntersectionObserver" in window)) {
      revealTargets.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target); // 只需触发一次
        }
      });
    }, { threshold: 0.12 });
    revealTargets.forEach((element, index) => {
      element.classList.add("reveal-on-scroll");
      // 同组内按序错开 0/75/150ms 延迟，形成自然的层叠入场
      element.style.setProperty("--reveal-delay", `${(index % 3) * 75}ms`);
      revealObserver.observe(element);
    });
  };

  /* ---------- 7. 时间线故事弹窗(点击卡片展开长篇故事) ---------- */
  // 四段生平故事的完整文本：与时间线上的年份卡片一一对应
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

  // 弹窗关闭后把焦点还给触发卡片(无障碍：焦点不丢失)
  let timelineReturnFocus = null;
  const initializeTimelineStories = () => {
    const dialog = document.querySelector(".timeline-story-dialog");
    if (!dialog) return;
    const closeButton = dialog.querySelector(".timeline-story-close");
    const kicker = dialog.querySelector(".timeline-story-kicker");
    const title = dialog.querySelector("#timeline-story-title");
    const content = dialog.querySelector(".timeline-story-content");
    // 弹窗自身的关闭行为只绑定一次(用 data 标记，换页重绑也不会重复)
    if (dialog.dataset.initialized !== "true") {
      const closeStory = () => {
        if (dialog.open) dialog.close();
      };
      closeButton.addEventListener("click", closeStory);
      // 点击背板(弹窗本体以外区域)也可关闭
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeStory();
      });
      // Esc 键关闭
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && dialog.open) {
          event.preventDefault();
          closeStory();
        }
      });
      // 关闭后把焦点还给来时的卡片
      dialog.addEventListener("close", () => {
        if (timelineReturnFocus?.isConnected) timelineReturnFocus.focus({ preventScroll: true });
      });
      dialog.dataset.initialized = "true";
    }
    // 每张时间线卡片按索引对应一段故事：点击或按 Enter / 空格展开
    document.querySelectorAll(".timeline-card[aria-haspopup='dialog']").forEach((card, index) => {
      const openStory = () => {
        const story = timelineStories[index];
        if (!story) return;
        timelineReturnFocus = card;
        kicker.textContent = story.period;   // 年代 · 地点
        title.textContent = story.title;     // 故事标题
        content.replaceChildren();           // 清空旧内容，避免换页后残留
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
        dialog.showModal();                  // 原生模态弹窗(自带焦点陷阱与 ::backdrop)
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

  // 词容万象页·三张视角卡的详情文案（按卡片顺序：历史中的他 / 词句中的他 / 今人心中的他）
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

  // 词容万象页·详情弹窗：点击视角卡展开故事；点击配图则展开该图的大图与说明
  const initializeMemoryStories = () => {
    const dialog = document.querySelector(".memory-story-dialog");
    if (!dialog) return;
    const closeButton = dialog.querySelector(".memory-story-close");
    const kicker = dialog.querySelector(".memory-story-kicker");
    const title = dialog.querySelector("#memory-story-title");
    const content = dialog.querySelector(".memory-story-content");
    const image = dialog.querySelector(".memory-story-image"); // 弹窗内的大图(视角卡场景不显示)
    let returnFocus = null; // 记录打开弹窗的卡片，关闭后归还焦点

    // Esc 键关闭：全局只绑一次(用 html 上的 data 标记，换页重绑也不会重复叠加)
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

    // 弹窗自身的关闭行为只绑定一次(用 data 标记，换页重绑也不会重复)
    if (dialog.dataset.initialized !== "true") {
      closeButton.addEventListener("click", () => dialog.close());
      // 点击背板(弹窗本体以外区域)也可关闭
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
      // 关闭后把焦点还给来时的卡片
      dialog.addEventListener("close", () => {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      });
      dialog.dataset.initialized = "true";
    }

    // 统一填充并展示弹窗：artwork 为空则只显示文字，否则同时显示大图
    const showStory = (story, trigger, artwork = null) => {
      returnFocus = trigger;
      kicker.textContent = story.kicker; // 弹窗小标
      title.textContent = story.title;   // 弹窗标题
      content.replaceChildren();         // 清空旧内容，避免换页后残留
      story.paragraphs.forEach((text) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        content.append(paragraph);
      });
      if (artwork) {
        image.src = artwork.src;   // 大图地址
        image.alt = artwork.alt;   // 大图替代文本
        image.hidden = false;      // 显示大图
      } else {
        image.hidden = true;                    // 无图场景：隐藏
        image.removeAttribute("src");          // 同时清掉地址，避免残留上一次的大图
        image.alt = "";
      }
      dialog.showModal();          // 原生模态弹窗(自带焦点陷阱与 ::backdrop)
      closeButton.focus();
    };

    // 三张视角卡按索引对应一段故事
    document.querySelectorAll(".memory-line article[aria-haspopup='dialog']").forEach((card, index) => {
      const openStory = () => {
        const story = memoryStories[index];
        if (!story) return;
        showStory(story, card);
      };
      card.addEventListener("click", (event) => {
        // 卡片内的页面链接与按钮仍可直接跳转，不触发弹窗
        if (event.target.closest("a, button")) return;
        openStory();
      });
      card.addEventListener("keydown", (event) => {
        if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        openStory();
      });
    });

    // 四张配图：点击后展开该图大图，并把图注内容搬进弹窗正文
    document.querySelectorAll(".media-art[aria-haspopup='dialog']").forEach((artwork) => {
      const openArtwork = () => {
        const image = artwork.querySelector("img");
        const caption = artwork.closest(".media-card")?.querySelector(".media-caption");
        const heading = caption?.querySelector("h3");
        if (!image || !caption || !heading) return;
        const paragraphs = [];
        const subheading = caption.querySelector("h4")?.textContent.trim(); // 小标题(如「纸上君王，笔底春愁」)
        if (subheading) paragraphs.push(subheading);
        caption.querySelectorAll("p:not(.media-caption-note)").forEach((paragraph) => {
          if (paragraph.textContent.trim()) paragraphs.push(paragraph.textContent.trim());
        });
        const note = caption.querySelector(".media-caption-note")?.textContent.trim(); // 免责/考辨说明
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

  // 写句随风飘散：把刚写下的一句拆成单字逐个随风散去，并伴随三道风痕横扫
  const animateWrittenLineAway = (form, text) => {
    if (reducedMotion) return; // 减弱动效时不做飞散，直接由反馈文案交代结果
    form.querySelector(".wind-release")?.remove(); // 若上一次风动层仍在，先移除避免叠加
    const effect = document.createElement("div");
    effect.className = "wind-release";
    effect.setAttribute("aria-hidden", "true"); // 纯装饰层，对读屏软件隐藏
    // 三道风痕：宽窄与深浅不同，依次扫过
    for (let index = 0; index < 3; index += 1) {
      const current = document.createElement("span");
      current.className = "wind-current";
      current.style.setProperty("--wind-index", String(index));
      current.style.setProperty("--wind-angle", `${index * -13}deg`);
      effect.append(current);
    }
    // 词句整体：逐字拆分为 .wind-glyph，交由 CSS 关键帧完成飞散
    const phrase = document.createElement("span");
    phrase.className = "wind-phrase";
    Array.from(text).forEach((character, index) => {
      const glyph = document.createElement("span");
      glyph.className = "wind-glyph";
      glyph.textContent = character;
      glyph.style.setProperty("--wind-delay", `${Math.min(index, 50) * 12}ms`); // 逐字延迟起风，形成连绵感
      glyph.style.setProperty("--wind-x", `${Math.round((Math.random() - 0.42) * 180)}px`); // 横向随机飘散
      glyph.style.setProperty("--wind-y", `${Math.round(-45 + Math.random() * 105)}px`);  // 纵向随机飘散
      glyph.style.setProperty("--wind-turn", `${Math.round((Math.random() - 0.5) * 300)}deg`); // 随机翻转角度
      phrase.append(glyph);
    });
    effect.append(phrase);
    form.append(effect);
    window.setTimeout(() => effect.remove(), 1800); // 动画播完后清理节点
  };

  /* ---------- 7-1. 立体悬停交互(卡片随指针轻微转动) ---------- */
  const initializeDepthInteractions = () => {
    // 减弱动效、移动端窄屏、触屏设备均不启用
    if (reducedMotion || window.innerWidth <= 700 || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    // 需要立体感的表面：词卡 / 时间线卡 / 记忆卡 / 媒体卡 / 介绍卡 / 首屏图 / 浮词圈 / 声波圈 / 诵读图
    document.querySelectorAll(".poem-card, .timeline-card, .memory-line article, .media-card, .intro-card, .hero-art, .floating-verse, .sound-orbit, .recite-art").forEach((surface) => {
      if (surface.dataset.depthInitialized === "true") return; // 换页后同一元素不重复绑定
      surface.dataset.depthInitialized = "true";
      surface.classList.add("depth-surface"); // 供 CSS 挂 3D 透视与过渡
      // 复位：移出时撤销转动
      const resetTilt = () => {
        surface.classList.remove("is-depth-active");
        surface.style.removeProperty("--depth-rotation");
      };
      // 指针移动：按指针相对卡片中心的偏移量算出转轴与角度
      surface.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch") return;
        const bounds = surface.getBoundingClientRect();
        const horizontal = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2; // 水平方向归一化到 -1 ~ 1
        const vertical = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;   // 垂直方向归一化到 -1 ~ 1
        const tiltX = -vertical * 1.6; // 上下偏移 → 绕 X 轴
        const tiltY = horizontal * 1.6; // 左右偏移 → 绕 Y 轴
        const angle = Math.hypot(tiltX, tiltY); // 总转角
        const axisX = angle ? tiltX / angle : 0; // 转轴 X 分量
        const axisY = angle ? tiltY / angle : 1; // 转轴 Y 分量
        surface.style.setProperty("--depth-rotation", `${axisX.toFixed(3)} ${axisY.toFixed(3)} 0 ${angle.toFixed(2)}deg`);
        surface.classList.add("is-depth-active");
      });
      surface.addEventListener("pointerleave", resetTilt);
      surface.addEventListener("pointercancel", resetTilt);
    });
  };

  /* ---------- 8. 页面内交互(每次换页后重新初始化) ---------- */
  function initializePageContent() {
    // 8a. 滚动进度条 / 返回顶部 / 渐显入场
    initializeScrollInteractions();
    // 8a-1. 时间线叙事进度(当前段落高亮)
    updateTimelineNarrative();
    // 8a-2. 立体悬停绑定
    initializeDepthInteractions();
    // 8b. 时间线故事弹窗绑定
    initializeTimelineStories();
    // 8b-2. 词容万象页·视角卡详情弹窗绑定
    initializeMemoryStories();
    // 8c. 语音诵读(为我诵读)
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

    // 8d. 收藏按钮(按索引分别记忆到 localStorage)
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

    // 8e. 字数计数器(心情 / 写句共用)：实时显示 “已输入 / 上限”
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

    // 8f. 首页“此刻心情”表单提交
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
    // 8g. 互动区：点击提示词直接填入“写一句”
    document.querySelectorAll(".prompt-words button").forEach((button) => {
      button.addEventListener("click", () => {
        const field = document.getElementById("my-line");
        field.value = `${field.value}${button.dataset.prompt}`;
        field.focus();
        field.dispatchEvent(new Event("input", { bubbles: true })); // 触发字数刷新
      });
    });
    // 8h. 互动区“写一句”表单提交
    document.querySelector(".poem-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const field = document.getElementById("my-line");
      const feedback = document.querySelector(".poem-feedback");
      if (!field.value.trim()) {
        feedback.textContent = "先写下一句心情，再让涟漪带走它。";
        field.focus();
        return;
      }
      // 先取出所写的一句（清空前取词，供风动层逐字使用）
      const writtenLine = field.value.trim();
      animateWrittenLineAway(event.currentTarget, writtenLine); // 让这一句随风飘散
      feedback.textContent = `“${writtenLine}” —— 已随风带入词境。`;
      field.value = "";
      document.getElementById("line-count").textContent = "0 / 100";
    });
  }
  initializePageContent(); // 首屏初始化
})();
