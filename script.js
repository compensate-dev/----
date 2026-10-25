(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    audio.autoplay = audioEnabled;
    if (!audioEnabled) audio.pause();
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
    document.addEventListener("pointerdown", (event) => {
      if (audioEnabled && audio.paused && !event.target.closest(".sound-toggle")) playBackgroundMusic();
    }, { once: true });
    document.addEventListener("keydown", (event) => {
      if (audioEnabled && audio.paused && !event.target.closest("input, textarea, button, a")) playBackgroundMusic();
    }, { once: true });
  }

  const bookOpening = document.querySelector(".book-opening");
  const bookOpenButton = document.querySelector(".book-open-button");
  const calligraphySequence = document.querySelector(".calligraphy-sequence");
  if (bookOpening && bookOpenButton && calligraphySequence) {
    const introStorageKey = "liyu-home-intro-completed";
    const calligraphyBackground = calligraphySequence.querySelector(".calligraphy-background");
    const inkInterlude = document.querySelector(".ink-interlude");
    const arrivalInterlude = document.querySelector(".arrival-interlude");
    const arrivalScroller = arrivalInterlude?.querySelector(".arrival-scroller");
    const arrivalEnterButton = arrivalInterlude?.querySelector(".arrival-enter-button");
    const arrivalSkipButton = arrivalInterlude?.querySelector(".arrival-skip-button");
    const arrivalChapterButtons = arrivalInterlude?.querySelectorAll("[data-arrival-scene]");
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
    const updateArrivalGlyphs = (progress) => {
      arrivalInterlude?.querySelectorAll(".arrival-copy").forEach((copy, index) => {
        const sceneProgress = Math.min(1, Math.max(0, progress * 3 - index));
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
    const updateArrivalProgress = () => {
      if (!arrivalScroller || !arrivalInterlude) return;
      const scrollRange = arrivalScroller.scrollHeight - arrivalScroller.clientHeight;
      const progress = scrollRange > 0 ? Math.min(1, Math.max(0, arrivalScroller.scrollTop / scrollRange)) : 1;
      const sceneIndex = Math.min(2, Math.floor(progress * 3));
      arrivalInterlude.style.setProperty("--arrival-progress", String(progress));
      arrivalInterlude.style.setProperty("--arrival-progress-width", `${progress * 100}%`);
      arrivalInterlude.style.setProperty("--arrival-landscape-y", `${-progress * 220}px`);
      arrivalInterlude.style.setProperty("--arrival-moon-y", `${progress * 130}px`);
      arrivalInterlude.style.setProperty("--arrival-figure-y", `${progress * 165}px`);
      arrivalInterlude.style.setProperty("--arrival-figure-rotate", `${progress * -8}deg`);
      arrivalInterlude.style.setProperty("--arrival-pine-y", `${progress * 34}px`);
      arrivalInterlude.style.setProperty("--arrival-copy-y", `${-progress * 68}px`);
      arrivalInterlude.dataset.scene = String(sceneIndex + 1);
      arrivalInterlude.style.setProperty("--arrival-camera-scale", String(1 + progress * 0.13));
      arrivalInterlude.style.setProperty("--arrival-landscape-scale", String(1.18 + progress * 0.2));
      arrivalInterlude.style.setProperty("--arrival-figure-scale", String(1.02 + progress * 0.15));
      arrivalInterlude.style.setProperty("--arrival-world-x", `${-progress * 48}px`);
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
      if (arrivalEnterButton) arrivalEnterButton.disabled = progress < 0.9;
    };
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
      prepareArrivalCopy();
      arrivalInterlude.removeAttribute("aria-hidden");
      arrivalInterlude.removeAttribute("inert");
      arrivalInterlude.classList.add("is-visible");
      arrivalScroller.addEventListener("scroll", updateArrivalProgress, { passive: true });
      arrivalEnterButton.addEventListener("click", finish);
      arrivalSkipButton.addEventListener("click", finish);
      arrivalChapterButtons?.forEach((button) => {
        button.addEventListener("click", () => {
          const chapter = Number(button.dataset.arrivalScene);
          const scrollRange = arrivalScroller.scrollHeight - arrivalScroller.clientHeight;
          const chapterProgress = chapter === 2 ? 0.95 : (chapter + 0.5) / 3;
          arrivalScroller.scrollTo({
            top: scrollRange * chapterProgress,
            behavior: reducedMotion ? "auto" : "smooth"
          });
        });
      });
      updateArrivalProgress();
      window.requestAnimationFrame(() => arrivalScroller.focus({ preventScroll: true }));
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
        await displayCalligraphyPromise;
        if (!inkInterlude) throw new Error("The ink interlude is missing.");
        await backgroundVideoEnded;
        calligraphySequence.classList.add("is-revealing");
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        calligraphySequence.remove();
        const interludeDuration = 4000;
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
        await revealHome();
        document.querySelector(".hero-actions a")?.focus({ preventScroll: true });
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
          arrivalInterlude?.remove();
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
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
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
  window.addEventListener("popstate", () => {
    if (location.protocol !== "file:" && location.pathname.endsWith(".html")) navigateTo(new URL(location.href), false);
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
    }, { threshold: 0.12 });
    revealTargets.forEach((element, index) => {
      element.classList.add("reveal-on-scroll");
      element.style.setProperty("--reveal-delay", `${(index % 3) * 75}ms`);
      revealObserver.observe(element);
    });
  };

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
        const caption = artwork.closest(".media-card")?.querySelector(".media-caption");
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

  const initializeDepthInteractions = () => {
    if (reducedMotion || window.innerWidth <= 700 || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    document.querySelectorAll(".poem-card, .timeline-card, .memory-line article, .media-card, .intro-card, .hero-art, .floating-verse, .sound-orbit, .recite-art").forEach((surface) => {
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
        const tiltX = -vertical * 1.6;
        const tiltY = horizontal * 1.6;
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

  function initializePageContent() {
  initializeScrollInteractions();
  updateTimelineNarrative();
  initializeDepthInteractions();
  initializeTimelineStories();
  initializeMemoryStories();
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
  }
  initializePageContent();
})();
