// 一江春水 · AI 梦客（前端组件）
// 职责：一枚可拖拽的「梦」印陪读全站——点开可问答/检索词库；
// 读到关键段落时，印章旁会浮出一句李煜本人的话，点「问问他」自动替你发问。
// 所有请求统一发到站内的 /api/guide（由 Node 服务代理到智谱），前端不接触任何密钥。
// 依赖：无（原生 JS），样式见 css/style.css 末尾的 .ai-guide 段。
(() => {
  // 保持同源请求，让下载版由本地服务安全转发，线上版则由 Railway 直接处理。
  const ENDPOINT = window.LIYU_AI_ENDPOINT || "/api/guide";

  // 直接打开文件不会运行本地 API 服务，因此提示评委用启动脚本进入页面。
  const explainError = (error) => {
    if (location.protocol === "file:") {
      return "AI 需要本地页面服务：请运行 scripts\\start.ps1，再从 http://localhost:53422 打开本站。";
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(error?.message || "")) {
      return "无法连接 AI 服务，请确认本地服务仍在运行且网络可用。";
    }
    return (error && error.message) || "未知错误";
  };

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

  // sessionStorage 读写的小封装：隐私模式下不可用时静默降级为「每次都提示」
  const store = {
    get(key) {
      try { return sessionStorage.getItem(key); } catch (error) { return null; }
    },
    set(key, value) {
      try { sessionStorage.setItem(key, value); } catch (error) { /* 忽略 */ }
    },
  };

  // 按页面给出情境：页面名 + 开场白 + 三条最常问的引导 + 读到某处时的主动搭话
  // hints[].sel 是该处段落的选择器（取页面上第一个匹配元素）；
  // text 是印章旁浮出的话；question 是点「问问他」后自动替你发的问题
  const PAGES = {
    home: {
      name: "首页",
      greet: "我是李煜。这一程我陪你走——读到哪里，都可以问我。",
      lead: "我是李煜。这一程从一场梦开始，你想先问什么？",
      chips: ["用一句话介绍李煜", "你为什么被叫作词中之帝", "从哪一幕开始看比较好", "南唐是个什么样的国家", "你是怎样一步步失去南唐的"],
      hints: [
        { sel: ".mood-form", text: "心里那句说不出的话，写在这里，我替你续。", question: "我心里有一句话却不知怎么落笔，帮我想个开头。" },
      ],
    },
    life: {
      name: "月色故人",
      greet: "937 到 978，一生不过四十二年。我陪你慢慢看。",
      lead: "937 到 978，一生不过四十二年。关于这段身世，你可以问我。",
      chips: ["937 到 978 发生了什么", "你为什么守不住南唐", "小周后是个怎样的人", "韩熙载是个怎样的人", "潘佑是怎么死的"],
      hints: [
        { sel: ".timeline-item", text: "937 年，我出生在金陵。往下走，是我的一生。", question: "你出生那年，南唐是什么样子？" },
        { sel: ".trail-guide", text: "故事到这里断了一截。剩下的路，你可以问我。", question: "978 年之后，你的故事是怎样的？" },
      ],
      // 段落语境：读到哪一段，快捷问题与解读就跟到哪一段（sel 指向时间轴各节点）
      sections: [
        { sel: "#y937", key: "937", chips: ["重瞳是怎么回事", "你出生时南唐是什么样子", "小时候在宫里读什么书", "南唐是怎么建国的", "你的祖父李昪是个怎样的人"],
          interpret: "我生在七夕。宫里人说重瞳是圣人之相，可排行第六的孩子，原轮不到江山。", question: "你出生时，真的一目重瞳吗？" },
        { sel: "#y954", key: "954", chips: ["娥皇是怎样的人", "《霓裳羽衣》是怎么重订的", "那时候的宫宴是什么样子", "娥皇和你差了几岁", "《霓裳羽衣》原本是残谱吗"],
          interpret: "娥皇嫁进来那年，我十八岁。我们一起把《霓裳羽衣》的残谱一段段补回去，那是最亮的日子。", question: "大周后娥皇是怎样的人？" },
        { sel: "#y961", key: "961", chips: ["你不是长子为什么继位", "即位那年宋朝已经多强", "父亲为什么迁都洪州", "弘冀是怎么死的", "父亲留给你的是怎样的南唐"],
          interpret: "父亲在洪州去了，我二十五岁，在灵前接的这个位子。说是皇帝，其实已经要对北边称臣。", question: "你即位时南唐的处境有多难？" },
        { sel: "#y964", key: "964", chips: ["娥皇病重时你在做什么", "仲宣那时候怎么样了", "小周后是那时候进宫的吗", "你为娥皇写过挽辞吗", "娥皇死后你过着什么日子"],
          interpret: "昭惠走的那年，仲宣也没保住。我写诔文，落款是「鳏夫煜」——那是我第一次知道，词救不了人。", question: "大周后病逝对你意味着什么？" },
        { sel: "#y971", key: "971", chips: ["从善为什么被扣在汴京", "江南国主和皇帝差在哪", "那几年为什么还要岁贡", "为什么派从善去朝贡", "去国号是哪一年的事"],
          interpret: "从善被扣在汴京回不来。我上表削了唐号，改叫江南国主——名分这种东西，是让出去的。", question: "削去唐号是哪一年的事？" },
        { sel: "#y974", key: "974", chips: ["樊若水是谁", "长江天险为什么没守住", "金陵被围了多久", "林仁肇是怎么死的", "皇甫继勋瞒了什么"],
          interpret: "樊若水把江面量给宋人看，浮桥一架，天险就成了路。三千里山河，输在一道桥上。", question: "采石浮桥是怎么一回事？" },
        { sel: "#y975", key: "975", chips: ["《破阵子》写的是这一天吗", "辞庙是什么意思", "城破后宫里人去了哪里", "曹彬是怎么待你的", "城破那天你在哪里"],
          interpret: "城破那天，我肉袒出降。教坊的乐工还在奏别离歌，我听着，直到听不见。", question: "金陵城破那天是怎样的？" },
        { sel: "#y976", key: "976", chips: ["「违命侯」是什么意思", "只以眼泪洗面是真的吗", "《相见欢》写于汴京吗", "汴京的日子是怎么过的", "赵匡胤对你怎样"],
          interpret: "「违命侯」三个字，是人家给的院子，也是给的罪名。西楼的月亮，我在汴京看了三年。", question: "汴京囚居的日子是怎样的？" },
        { sel: "#y978", key: "978", chips: ["牵机药是史实还是传说", "《虞美人》哪句惹怒了宋太宗", "最后一夜还有谁在场", "七夕对你意味着什么", "你预感到那一夜了吗"],
          interpret: "七夕，我四十二岁。故伎唱了《虞美人》，词传到墙外。那一夜的事，你们都知道了。", question: "《虞美人》为什么成了绝命词？" },
        { sel: "#y978b", key: "978b", chips: ["小周后后来怎样", "北邙山为什么是名士归处", "后人怎么凭吊你", "《虞美人》是最后一首词吗", "徐铉最后见过你吗"],
          interpret: "北邙山下，他们以王礼葬我。洛阳往北，再也望不见金陵——好在词替我回去了。", question: "你葬在北邙山哪里？" },
      ],
    },
    ci: {
      name: "词间春水",
      greet: "词是心里的话。这四阕，每一阕我都记得写它那晚。",
      lead: "词是心里的话。这里的每一阕，都能拆开细看。",
      chips: ["《虞美人》为什么被称作绝命词", "「春花秋月何时了」妙在哪", "这四阕词按什么选的"],
      hints: [
        { sel: ".works", text: "这四阕词，都是我当时的心境。哪一阕读不懂，问我。", question: "这四阕词，分别写于你人生的什么时候？" },
      ],
      // 段落语境：滚到哪一阕，快捷问题与解读就跟到哪一阕（id 用属性选择器，兼容中文 id）
      sections: [
        { sel: '[id="虞美人"]', key: "yumeiren", chips: ["《虞美人》为什么被称作绝命词", "「一江春水」为什么写愁", "这首写在哪一年"],
          interpret: "这一阕是汴京小楼上写的。春花秋月年年照旧，只是我不在金陵了。", question: "《虞美人》为什么成了绝命词？" },
        { sel: '[id="相见欢"]', key: "xiangjianhuan", chips: ["西楼在哪一座城", "「剪不断，理还乱」怎么读", "为什么写梧桐"],
          interpret: "无言独上西楼——那晚我不想说话，月亮只剩一钩。深院里的梧桐，锁住了整个秋天。", question: "「剪不断，理还乱」妙在哪里？" },
        { sel: '[id="浪淘沙令"]', key: "langtaosha", chips: ["「身是客」指的是什么", "梦里贪欢是哪一段日子", "「天上人间」怎么解"],
          interpret: "帘外雨声一直到五更，衾被薄得挡不住寒。梦里我还当自己是江南国主。", question: "「梦里不知身是客」是什么意思？" },
        { sel: '[id="清平乐"]', key: "qingpingyue", chips: ["这首是写给谁的", "「落梅如雪」的画面", "为什么用春草写离恨"],
          interpret: "砌下落梅像雪，拂掉了又落满一身——那年春天，我等的人没来。", question: "「离恨恰如春草」好在哪里？" },
      ],
    },
    wanxiang: {
      name: "帘外余音",
      greet: "后人一直在重写我。戏台上那个我，有几分真，你看了再问我。",
      lead: "后人一直在重写我。戏台上的那个我，有几分真？",
      chips: ["戏曲里的李煜可信吗", "为什么后人反复写你", "《天上人间》演的是什么"],
      hints: [
        { sel: ".screen-world", text: "他们把我画了一遍又一遍。哪一幅像我，你说了算。", question: "后世这些演绎里，哪些最贴近真实的你？" },
      ],
      // 段落语境：这一页是三种目光 → 五场重写 → 余音未绝，按块推进
      sections: [
        { sel: "#many-views", key: "views", chips: ["史书里的你是什么样", "为什么后人读出的你各不相同", "哪一种更接近真实的你"],
          interpret: "他们看我的目光分三种：史书里是失国的君主，词里是把愁写成江水的人，如今又成了被反复重画的影子。", question: "后世眼中的你和真实的你差多少？" },
        { sel: "#screen-world", key: "screen", chips: ["戏台上的李煜可信吗", "《天上人间》演的是什么", "为什么游戏总把你画得很风流"],
          interpret: "一幅旧画像，四场当代的重逢。画上的我都不是我，可每一笔都照见了画的人。", question: "这些演绎里，哪个最接近我？" },
        { sel: ".living-echo", key: "echo", chips: ["为什么至今还有人写你", "词为什么能活得比人久", "后人续写的句子像你吗"],
          interpret: "词没有写完，后来的人替我续。他们写的不是我，是我留下的那点余音。", question: "为什么这么多年过去，还有人写我？" },
      ],
    },
    listen: {
      name: "枕上低语",
      greet: "挑一阕词，让声音替你读。读不懂的地方，我在。",
      lead: "挑一阕词，让声音读完；也可以把没说完的那句，交给我续。",
      chips: ["《破阵子》写的是什么", "《乌夜啼》该怎么读", "帮我把这句续下去"],
      hints: [
        { sel: ".recite-card", text: "挑一阕，让人读给你听。读不懂的地方，我在。", question: "《破阵子》写的是什么？" },
        { sel: ".poem-form", text: "那句说不出的话，写下来，我替你续。", question: "帮我想一句开头，要有一点月色。" },
      ],
      // 段落语境：五张诵读卡各自一段，往下是填词区与终幕引子
      sections: [
        { sel: ".recite-list .recite-card:nth-child(1)", key: "yumeiren", chips: ["这首读起来该慢还是快", "「一江春水」为什么写愁", "诵读时哪一句最重"],
          interpret: "读这一阕，前两句要慢。到「一江春水向东流」，气别断——愁是流不完的。", question: "《虞美人》该怎么读？" },
        { sel: ".recite-list .recite-card:nth-child(2)", key: "xiangjianhuan", chips: ["「月如钩」该怎么念", "这首的节奏为什么短", "梧桐为什么代表愁"],
          interpret: "「剪不断，理还乱」六个字，一拍一拍地顿。中间那口气，恰恰是缠住人的地方。", question: "《相见欢》该怎么读？" },
        { sel: ".recite-list .recite-card:nth-child(3)", key: "langtaosha", chips: ["「帘外雨潺潺」的雨声感", "梦里贪欢是哪一段日子", "「天上人间」怎么收"],
          interpret: "开篇像雨声渐近，越读越轻。收尾「天上人间」，像一扇门轻轻合上。", question: "《浪淘沙令》该怎么读？" },
        { sel: ".recite-list .recite-card:nth-child(4)", key: "pozhenzi", chips: ["《破阵子》写的是哪一天", "「教坊犹奏别离歌」的画面", "为什么说这是亡国之痛"],
          interpret: "「最是仓皇辞庙日」——那天的记忆我一直记得。念到这里，声音是要抖的。", question: "《破阵子》写的是什么？" },
        { sel: ".recite-list .recite-card:nth-child(5)", key: "wuyeti", chips: ["「林花谢了春红」的伤春", "「胭脂泪」指的是什么", "「长恨水长东」怎么落"],
          interpret: "「太匆匆」三字最急，往后一路慢下来。人生长恨，水却只是一直向东。", question: "《乌夜啼》该怎么读？" },
        { sel: ".listen-interactive", key: "write", chips: ["帮我续一句带月色的", "「故园」这个意象怎么用", "我想写想念却不直说"],
          interpret: "写不出的时候，先挑一个意象。月色、春雨、故园、春水——都是能替你说话的东西。", question: "帮我想一句开头，要有一点月色。" },
        { sel: ".finale-gate", key: "gate", chips: ["终幕里会发生什么", "为什么用「归」字收尾", "故事到这儿就结束了吗"],
          interpret: "灯还亮着，江上还有一盏。别急着走——终幕那一页，是给读到最后的人的。", question: "终幕讲的是什么？" },
      ],
    },
    map: {
      name: "水墨行迹",
      greet: "地图上的每一处，我都走过。点一站，我讲给你听。",
      lead: "地图上的每一站，都是我真去过的地方。",
      chips: ["你一生去过哪些地方", "金陵为什么守不住", "北邙在哪儿"],
      hints: [
        { sel: ".map-guide-card", text: "按图索骥，顺着我的脚步走一遍南唐。", question: "按你的足迹，最该先看哪一站？" },
      ],
      // 地图页没有滚动段落：当前「读到的地方」= 笺卡上展开的站点（match 匹配站点名）
      sections: [
        { match: "金陵", key: "jinling", chips: ["金陵宫苑是什么样子", "975 年金陵城怎么破的", "今天的南京还有南唐遗迹吗"],
          interpret: "金陵是我一辈子的开头和结尾。宫苑、城破、辞庙，都在这一城。", question: "金陵对你来说意味着什么？" },
        { match: "钟山", key: "zhongshan", chips: ["钟山在哪里", "南唐人游山是什么景象", "你写过钟山吗"],
          interpret: "钟山在金陵城外。我当年登高远望的地方，如今只剩一片青。", question: "钟山和南唐有什么关系？" },
        { match: "洪州", key: "hongzhou", chips: ["洪州是现在的哪里", "迁都没起到作用吗", "父亲是个怎样的君主"],
          interpret: "父亲把都城迁去洪州，说是避其锋芒。他死在那里，我从那里被抬回金陵即位。", question: "南唐为什么迁都洪州？" },
        { match: "采石", key: "caishi", chips: ["采石矶在哪", "浮桥渡江有多快", "当时守军在做什么"],
          interpret: "采石矶的江面最窄。樊若水就在那里，替宋人量出了一条浮桥。", question: "采石矶之战是怎么输的？" },
        { match: "江舟", key: "jiangzhou", chips: ["北上走了多久", "《望江南》是在江上写的吗", "随行的还有谁"],
          interpret: "辞庙北上那条船，走的就是这段江。两岸还是江南，我已经不是江南国主了。", question: "辞庙北上时你在船上想什么？" },
        { match: "汴京", key: "bianjing", chips: ["违命侯府在哪里", "为什么囚居反而词写得最好", "宋太宗对你怎样"],
          interpret: "汴京的宅子叫府，其实是笼子。我的好词，多半是在那三年里熬出来的。", question: "汴京囚居的日子是怎样的？" },
        { match: "北邙", key: "beimang", chips: ["北邙山葬了哪些名人", "墓今天还在吗", "洛阳和金陵哪个更像归宿"],
          interpret: "北邙山多的是王侯将相的土。我添了一座，挨着洛阳。", question: "你为什么会葬在北邙山？" },
      ],
    },
    finale: {
      name: "终幕",
      greet: "梦到这里就醒了。还有想问的，最后问吧。",
      lead: "梦到这里，江山就远了。最后想问什么，都可以。",
      chips: ["用一句话总结这场梦", "你最想留下的是什么", "如果重来一次会怎样"],
      hints: [
        { sel: ".finale-scroll", text: "梦要醒了。还有想问的，最后问吧。", question: "如果重来一次，你最想改变什么？" },
      ],
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
  // 「梦客」印章素材：按本 JS 的位置解析资源路径，首页与 pages/ 子目录都能用
  const SEAL_IMG = new URL("../assets/image/mengke-seal.png", document.currentScript.src).href;
  const root = document.createElement("div");
  root.className = "ai-guide-root";
  root.innerHTML = `
    <button class="ai-guide-seal" type="button" aria-expanded="false" aria-controls="aiGuidePanel" aria-label="打开 AI 梦客（可拖动）">
      <img class="ai-guide-seal-img" src="${SEAL_IMG}" alt="" aria-hidden="true">
      <span class="ai-guide-seal-label">AI 梦客 · 可拖动</span>
    </button>
    <div class="ai-guide-bubble" role="status" hidden></div>
    <section class="ai-guide-panel" id="aiGuidePanel" role="dialog" aria-modal="false" aria-label="AI 梦客" hidden>
      <header class="ai-guide-head">
        <span class="ai-guide-mark" aria-hidden="true">煜</span>
        <div class="ai-guide-title"><b>李煜 · 梦客</b><small>问词 · 解梦 · 检索</small></div>
        <button class="ai-guide-close" type="button" aria-label="关闭 AI 梦客">×</button>
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
      <section class="ai-guide-leaf" aria-label="引文原文" hidden>
        <header class="ai-guide-leaf-head">
          <b class="ai-guide-leaf-title">原文</b>
          <button class="ai-guide-leaf-close" type="button" aria-label="收起原文">×</button>
        </header>
        <p class="ai-guide-leaf-meta"></p>
        <p class="ai-guide-leaf-text"></p>
        <footer class="ai-guide-leaf-foot">
          <a class="ai-guide-leaf-link" href="#" target="_blank" rel="noopener">维基文库 ↗</a>
        </footer>
      </section>
    </section>
  `;
  document.body.append(root);

  const seal = root.querySelector(".ai-guide-seal");
  const panel = root.querySelector(".ai-guide-panel");
  const bubble = root.querySelector(".ai-guide-bubble");
  const body = root.querySelector(".ai-guide-body");
  const chips = root.querySelector(".ai-guide-chips");
  const form = root.querySelector(".ai-guide-form");
  const input = root.querySelector(".ai-guide-input");
  const send = root.querySelector(".ai-guide-send");
  const closeBtn = root.querySelector(".ai-guide-close");
  const modeButtons = root.querySelectorAll(".ai-guide-modes button");
  const leaf = root.querySelector(".ai-guide-leaf");
  const leafTitle = root.querySelector(".ai-guide-leaf-title");
  const leafMeta = root.querySelector(".ai-guide-leaf-meta");
  const leafText = root.querySelector(".ai-guide-leaf-text");
  const leafLink = root.querySelector(".ai-guide-leaf-link");
  const leafClose = root.querySelector(".ai-guide-leaf-close");

  // 当前模式：问答 / 检索
  let mode = "ask";
  // 请求中标记，避免重复提交
  let busy = false;

  // ---------- 印章拖拽 ----------
  // 位置只记在本次浏览（sessionStorage）：新开一次网站仍回右下角，页内拖动不丢
  const POS_KEY = "liyu-ai-seal-pos";
  const SEAL_SIZE = 58;
  const EDGE_GAP = 10;

  // 把坐标收进可视范围内，防止拖到屏幕外或窗口缩放后丢失
  const clampPos = (x, y) => ({
    x: Math.min(Math.max(x, EDGE_GAP), Math.max(EDGE_GAP, window.innerWidth - SEAL_SIZE - EDGE_GAP)),
    y: Math.min(Math.max(y, EDGE_GAP), Math.max(EDGE_GAP, window.innerHeight - SEAL_SIZE - EDGE_GAP)),
  });

  // 应用坐标：从「右下角默认」切换为「显式定位」
  const applyPos = (x, y) => {
    const pos = clampPos(x, y);
    root.style.left = `${pos.x}px`;
    root.style.top = `${pos.y}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    return pos;
  };

  // 读取本次浏览里拖到的位置；没有则用默认位（CSS 的 right/bottom）反推出坐标，便于统一处理
  const initPos = () => {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(POS_KEY) || "null"); } catch (error) { saved = null; }
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      applyPos(saved.x, saved.y);
      return;
    }
    const rect = seal.getBoundingClientRect();
    // 首页开卷前印章是 display:none，量出来是 0×0；此时不要写成 left:0/top:0，
    // 保留 CSS 的 right/bottom，等正式进入主页时自然出现在右下角
    if (!rect.width || !rect.height) return;
    applyPos(rect.left, rect.top);
  };

  // 拖拽：pointer 事件，移动超过 6px 才算拖，否则视为点击
  let dragging = false;
  let dragMoved = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  seal.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragging = true;
    dragMoved = false;
    const rect = seal.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    seal.setPointerCapture(event.pointerId);
  });

  seal.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    if (!dragMoved && Math.hypot(event.movementX, event.movementY) < 1) {
      // 用累计位移判断更稳：下面用与起点的距离判定
    }
    const x = event.clientX - dragOffsetX;
    const y = event.clientY - dragOffsetY;
    const rect = seal.getBoundingClientRect();
    if (!dragMoved && Math.hypot(event.clientX - (rect.left + dragOffsetX), event.clientY - (rect.top + dragOffsetY)) < 6) return;
    if (!dragMoved) {
      dragMoved = true;
      root.classList.add("is-dragging");
      // 拖起时收起气泡，免得跟着跑
      hideBubble();
    }
    applyPos(x, y);
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("is-dragging");
    if (dragMoved) {
      const rect = seal.getBoundingClientRect();
      const pos = clampPos(rect.left, rect.top);
      applyPos(pos.x, pos.y);
      try { sessionStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (error) { /* 忽略 */ }
      // 拖动结束后 suppress 紧接着的 click（否则会误开面板）
      event.preventDefault();
      event.stopPropagation();
      suppressClick = true;
      window.setTimeout(() => { suppressClick = false; }, 80);
    }
  };
  seal.addEventListener("pointerup", endDrag);
  seal.addEventListener("pointercancel", endDrag);

  // 窗口缩放时把印章收回来
  window.addEventListener("resize", () => {
    const rect = seal.getBoundingClientRect();
    if (!rect.width || !rect.height) return; // 隐藏时（首页未开卷）不量位置，保持右下角默认
    const pos = clampPos(rect.left, rect.top);
    applyPos(pos.x, pos.y);
  });

  // ---------- 面板定位：以印章为锚，朝上优先、没地方就朝下 ----------
  const placePanel = () => {
    const rect = seal.getBoundingClientRect();
    const width = Math.min(392, window.innerWidth - 32);
    const height = Math.min(568, window.innerHeight - 128);
    // 水平：印章在右半屏则面板右缘对齐印章右缘，否则左缘对齐
    let left = rect.right - width;
    if (rect.left + rect.width / 2 < window.innerWidth / 2) left = rect.left;
    left = Math.min(Math.max(left, 12), Math.max(12, window.innerWidth - width - 12));
    // 垂直：优先在印章上方展开
    let top = rect.top - 16 - height;
    if (top < 12) top = Math.min(rect.bottom + 16, Math.max(12, window.innerHeight - height - 12));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
  };

  // ---------- 引导气泡 ----------
  // 一句话 + 「问问他」， anchored 到印章；同一时刻只出现一条，后来的排队
  let bubbleTimer = 0;
  const bubbleQueue = [];

  const placeBubble = () => {
    const rect = seal.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 32);
    bubble.style.width = `${width}px`;
    // 先量高度：短暂可见但不透明
    const bRect = bubble.getBoundingClientRect();
    let left = rect.right - width;
    if (rect.left + rect.width / 2 < window.innerWidth / 2) left = rect.left;
    left = Math.min(Math.max(left, 12), Math.max(12, window.innerWidth - width - 12));
    let top = rect.top - 14 - bRect.height;
    if (top < 12) top = rect.bottom + 14;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  };

  const hideBubble = () => {
    window.clearTimeout(bubbleTimer);
    bubble.classList.remove("is-on");
    window.setTimeout(() => { bubble.hidden = true; }, 220);
    // 当前这条没了，稍等放下一条
    window.setTimeout(flushBubbleQueue, 600);
  };

  const flushBubbleQueue = () => {
    if (!bubble.hidden || !bubbleQueue.length) return;
    // 面板开着时不打扰，等关上再说
    if (!panel.hidden) return;
    const item = bubbleQueue.shift();
    showBubbleNow(item.text, item.question);
  };

  const showBubbleNow = (text, question) => {
    bubble.innerHTML = "";
    const p = document.createElement("p");
    p.className = "ai-guide-bubble-text";
    p.textContent = text;
    const actions = document.createElement("div");
    actions.className = "ai-guide-bubble-actions";
    const askBtn = document.createElement("button");
    askBtn.type = "button";
    askBtn.className = "ai-guide-bubble-ask";
    askBtn.textContent = "问问他";
    askBtn.addEventListener("click", () => {
      hideBubble();
      open();
      input.value = question;
      submit("ask");
    });
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "ai-guide-bubble-dismiss";
    dismissBtn.setAttribute("aria-label", "知道了");
    dismissBtn.textContent = "知道了";
    dismissBtn.addEventListener("click", hideBubble);
    actions.append(askBtn, dismissBtn);
    bubble.append(p, actions);
    bubble.hidden = true;
    // 先 hidden 量高度再定位，最后淡入
    requestAnimationFrame(() => {
      bubble.hidden = false;
      bubble.style.visibility = "hidden";
      placeBubble();
      bubble.style.visibility = "";
      bubble.classList.add("is-on");
    });
    // 10 秒后自己收起来，不赖着不走
    window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(hideBubble, 10000);
  };

  // 每条引导只说一次（按 key 记忆）；面板打开时先入队
  const sayOnce = (key, text, question) => {
    if (store.get(key)) return;
    store.set(key, "1");
    if (bubble.hidden && panel.hidden) showBubbleNow(text, question);
    else bubbleQueue.push({ text, question });
  };

  // 语境解读专用：面板没开就直接顶掉当前气泡（如进站招呼），不排队。
  // 读者已经停在某一段，这段的解读比泛泛的招呼更要紧；面板开着则照常入队不打扰
  const sayNow = (key, text, question) => {
    if (store.get(key)) return;
    store.set(key, "1");
    if (panel.hidden) showBubbleNow(text, question);
    else bubbleQueue.push({ text, question });
  };

  // 追加一条消息气泡：who 为 me / seer（李煜） / system
  const appendMessage = (who, text) => {
    const wrap = document.createElement("div");
    wrap.className = `ai-guide-msg is-${who}`;
    const bubbleP = document.createElement("p");
    bubbleP.textContent = text;
    wrap.append(bubbleP);
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

  // ---------- Agent 动作卡 ----------
  // 后端 guide 函数的 Agent 循环会产出两类卡：
  //   navigate：带路卡（跳某一页 / life 年份锚点 / map 站点直达）
  //   poem：词卡（点击自动追问这首词）
  const inPages = /\/pages\//.test(location.pathname);

  // 跟随带路卡：同页走平滑交互（不整页刷新），跨页拼相对站点根的路径
  const followNavigate = (card) => {
    if (card.page === pageKey) {
      // 同在月色故人：滚到对应年份段落
      if (card.page === "life" && card.anchor) {
        const el = document.getElementById(card.anchor);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
      // 同在水墨行迹：直接触发该站的镜头飞行（等同点朱砂点）
      if (card.page === "map" && card.spot) {
        const dot = document.querySelector(`.dot-btn[data-go="${card.spot}"]`);
        if (dot) {
          dot.click();
          return;
        }
      }
    }
    let href = (inPages ? "../" : "") + (card.href || "index.html");
    if (card.page === "map" && card.spot) href += `#spot=${card.spot}`;
    else if (card.anchor) href += `#${card.anchor}`;
    location.href = href;
  };

  // 渲染动作卡组：排在回答之后、来源词之前
  const appendCards = (cards) => {
    if (!Array.isArray(cards) || !cards.length) return;
    const group = document.createElement("div");
    group.className = "ai-guide-cards";
    cards.forEach((card) => {
      if (!card || typeof card !== "object") return;
      if (card.type === "person") {
        group.append(buildPersonCard(card));
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      const label = document.createElement("span");
      label.className = "ai-guide-card-label";
      const arrow = document.createElement("i");
      if (card.type === "navigate") {
        btn.className = "ai-guide-card is-navigate";
        label.textContent = card.label || "去看看";
        arrow.textContent = "↗";
        btn.append(label, arrow);
        btn.addEventListener("click", () => followNavigate(card));
      } else if (card.type === "poem") {
        btn.className = "ai-guide-card is-poem";
        label.textContent = `读《${card.title}》`;
        arrow.textContent = card.year ? `${card.year} 年` : "";
        btn.append(label, arrow);
        // 词卡：把追问写进输入框并直接发问
        btn.addEventListener("click", () => {
          input.value = `《${card.title}》写了什么？`;
          submit("ask");
        });
      } else {
        return; // 未知卡型直接跳过
      }
      group.append(btn);
    });
    if (!group.children.length) return;
    body.append(group);
    body.scrollTop = body.scrollHeight;
  };

  // ---------- Agent 步骤与正史出处 ----------
  // 后端把每次工具调用记成一步（tool / args / hits），这里折成一行小字，
  // 让读者看见「梦客查过什么」；查到正史的，再附上可回溯的出处链接。
  const TOOL_LABELS = {
    search_poems: "词库",
    get_poem_detail: "词卡",
    get_timeline_event: "年表",
    get_location: "行迹",
    navigate_to: "带路",
    search_history: "正史",
    fetch_history_online: "在线",
  };

  const appendSteps = (steps, history) => {
    const rows = (Array.isArray(steps) ? steps : []).filter((step) => step && step.tool);
    const cites = (Array.isArray(history) ? history : []).filter((item) => item && item.book);
    if (!rows.length && !cites.length) return;
    const group = document.createElement("div");
    group.className = "ai-guide-steps";
    const label = document.createElement("span");
    label.className = "ai-guide-steps-label";
    label.textContent = "梦客查过";
    group.append(label);
    rows.slice(0, 6).forEach((step) => {
      const chip = document.createElement("span");
      chip.className = "ai-guide-step" + (step.ok === false ? " is-miss" : "");
      const name = TOOL_LABELS[step.tool] || "工具";
      const arg = step.args ? `「${step.args}」` : "";
      const result = step.ok === false ? "未查到" : `${step.hits} 条`;
      chip.textContent = `${name}${arg} · ${result}`;
      group.append(chip);
    });
    cites.slice(0, 3).forEach((item) => {
      const link = document.createElement("a");
      link.className = "ai-guide-cite";
      link.href = item.url || "#";
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `《${item.book}·${item.juan}》`;
      link.title = item.title ? `《${item.book}》${item.juan} · ${item.title}` : `《${item.book}》${item.juan}`;
      group.append(link);
    });
    body.append(group);
    body.scrollTop = body.scrollHeight;
  };

  // ---------- 引文展卷 / 四库对照 / 人物卡 ----------
  // 引文侧栏：点回答里点名的《书名·卷X》，从右侧展开这一卷的原文与文库出处
  const closeLeaf = () => {
    leaf.classList.remove("is-on");
    window.setTimeout(() => {
      if (!leaf.classList.contains("is-on")) leaf.hidden = true;
    }, 220);
  };

  const openLeaf = (title, meta, text, url) => {
    leafTitle.textContent = title || "原文";
    leafMeta.textContent = meta || "";
    leafText.textContent = text || "这一卷原文没有取到。";
    leafLink.href = url || "#";
    leafLink.hidden = !url;
    leaf.hidden = false;
    requestAnimationFrame(() => leaf.classList.add("is-on"));
  };

  leafClose.addEventListener("click", closeLeaf);

  // 滚轮：在窗头、快捷问、输入区上滚动也带着会话区走；会话区滚到尽头就放行给页面
  panel.addEventListener("wheel", (event) => {
    if (event.deltaY === 0) return;
    if (event.target.closest && event.target.closest(".ai-guide-body, .ai-guide-leaf")) return; // 正文/侧栏原生滚动
    const max = body.scrollHeight - body.clientHeight;
    if (max <= 1) return;
    const atTop = body.scrollTop <= 0 && event.deltaY < 0;
    const atEnd = body.scrollTop >= max - 1 && event.deltaY > 0;
    if (atTop || atEnd) return; // 尽头交给页面，继续滚动不会被吞掉
    body.scrollTop += event.deltaY;
    event.preventDefault();
  }, { passive: false });

  // 引文条目：回答里点名的卷，点一下展开原文，读者可自行核对
  const appendCitations = (citations) => {
    const list = (Array.isArray(citations) ? citations : []).filter((c) => c && c.text);
    if (!list.length) return;
    const group = document.createElement("div");
    group.className = "ai-guide-cites";
    const label = document.createElement("span");
    label.className = "ai-guide-cites-label";
    label.textContent = "原文核对";
    group.append(label);
    list.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-guide-quote";
      btn.textContent = `《${c.book}·${c.juan}》`;
      btn.title = "展开这一卷的原文";
      btn.addEventListener("click", () => openLeaf(`《${c.book}·${c.juan}》`, c.tierLabel || "", c.text, c.url));
      group.append(btn);
    });
    body.append(group);
    body.scrollTop = body.scrollHeight;
  };

  // 四库对照：折叠区里按库别并排，每条都可点开原文
  const appendCompare = (groups, conflict) => {
    const list = (Array.isArray(groups) ? groups : []).filter((g) => g && Array.isArray(g.items) && g.items.length);
    if (!list.length) return;
    const box = document.createElement("details");
    box.className = "ai-guide-compare";
    const head = document.createElement("summary");
    head.textContent = `四库对照 · ${list.length} 库`;
    box.append(head);
    if (conflict) {
      const note = document.createElement("p");
      note.className = "ai-guide-compare-note";
      note.textContent = "各库对同一事的记法有出入，可逐条比对。";
      box.append(note);
    }
    list.forEach((g) => {
      const row = document.createElement("div");
      row.className = `ai-guide-tier is-${String(g.tier || "A").toLowerCase()}`;
      const tag = document.createElement("span");
      tag.className = "ai-guide-tier-tag";
      tag.textContent = g.tierLabel || `库${g.tier}`;
      row.append(tag);
      g.items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-guide-tier-item";
        const book = document.createElement("b");
        book.textContent = `《${item.book}·${item.juan}》`;
        const text = document.createElement("em");
        text.textContent = item.text || "";
        btn.append(book, text);
        btn.addEventListener("click", () => openLeaf(`《${item.book}·${item.juan}》`, g.tierLabel || "", item.text, item.url));
        row.append(btn);
      });
      box.append(row);
    });
    body.append(box);
    body.scrollTop = body.scrollHeight;
  };

  // 争议辨析徽标：本轮按「正史记载 / 笔记传闻 / 一般看法」三层作答
  const appendDispute = () => {
    const tag = document.createElement("p");
    tag.className = "ai-guide-dispute";
    tag.textContent = "争议辨析 · 正史记载 / 笔记传闻 / 一般看法";
    body.append(tag);
    body.scrollTop = body.scrollHeight;
  };

  // 人物档案卡：一句话档案 + 两条可点追问（有年份锚点的可直达时间轴）
  const buildPersonCard = (card) => {
    const box = document.createElement("div");
    box.className = "ai-guide-person";
    const head = document.createElement("p");
    head.className = "ai-guide-person-head";
    const name = document.createElement("b");
    name.textContent = card.name || "";
    const title = document.createElement("small");
    title.textContent = card.title || "";
    head.append(name, title);
    const archive = document.createElement("p");
    archive.className = "ai-guide-person-archive";
    archive.textContent = card.archive || "";
    const asks = document.createElement("div");
    asks.className = "ai-guide-person-asks";
    (card.asks || []).slice(0, 3).forEach((q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = q;
      btn.addEventListener("click", () => {
        input.value = q;
        submit("ask");
      });
      asks.append(btn);
    });
    if (card.anchor) {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "ai-guide-person-go";
      go.textContent = "看这一年 ↗";
      go.addEventListener("click", () => followNavigate({ page: "life", href: "pages/life.html", anchor: card.anchor }));
      asks.append(go);
    }
    box.append(head, archive, asks);
    return box;
  };

  // 快捷追问：默认按当前页面给三条；读到具体段落时换成该段的语境关键词
  // liveChips 由「段落语境」模块维护：null = 用页面默认
  let liveChips = null;
  const renderChips = (list) => {
    chips.innerHTML = "";
    (list || liveChips || page.chips).forEach((text) => {
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
    hideBubble();
    placePanel();
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
      flushBubbleQueue();
    }, 240);
    seal.focus({ preventScroll: true });
  };

  let suppressClick = false;
  seal.addEventListener("click", () => {
    // 拖拽刚结束时的那一次 click 不算数
    if (suppressClick) return;
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
      // 争议辨析徽标 → 引文核对 → 四库对照，再交代查过什么与动作卡
      if (action === "ask" && data.dispute) appendDispute();
      if (action === "ask") appendCitations(data.citations);
      if (action === "ask") appendCompare(data.compare, data.compareConflict);
      if (action === "ask") appendSteps(data.steps, data.history);
      if (action === "search") {
        appendSources(`检索到 ${(data.sources || []).length} 阕相关词作`, data.sources);
      } else {
        // Agent 动作卡（带路 / 词卡）排在来源词之前
        appendCards(data.cards);
        // 问答也附上引用的词作，便于顺着读下去
        appendSources("可继续读的词作", data.sources);
        // 记录上下文，供下一轮追问
        history.push({ role: "user", content: text }, { role: "assistant", content: answer });
        if (history.length > 6) history.splice(0, history.length - 6);
      }
    } catch (error) {
      loading.remove();
      appendMessage("system", `暂时没接上：${explainError(error)}`);
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

  // 站内其它模块（文创卡、正文入口）可派发 ai-guide-ask 事件，
  // 把一句预设问题直接交给梦客：打开面板、填入、发问
  document.addEventListener("ai-guide-ask", (event) => {
    const question = event.detail?.question;
    if (!question) return;
    if (panel.hidden) open();
    input.value = question;
    submit("ask");
  });

  // ---------- 两个写作区的 AI 伴写 / 解读 ----------
  // 首页「心情笺」与枕上低语「填词」共用同一套工具条：续成一首词 / 请李煜解读。
  // 结果先落在表单下方的小笺里，可一键采纳，不打断原有的「随风去」提交流程。
  const initWriteTools = () => {
    document.querySelectorAll(".mood-form, .poem-form").forEach((formEl) => {
      const field = formEl.querySelector("textarea");
      const feedback = formEl.querySelector(".mood-feedback, .poem-feedback");
      if (!field || !feedback) return;

      // 工具条：两枚小按钮，语气与站点一致
      const tools = document.createElement("div");
      tools.className = "ai-write-tools";
      tools.innerHTML = `
        <button type="button" data-ai-action="compose">让李煜续成一首词</button>
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
        tag.textContent = action === "compose" ? "李煜续写" : "李煜解读";
        const text = document.createElement("p");
        text.className = "ai-write-text";
        text.textContent = answer;
        resultBox.append(tag, text);

        const actions = document.createElement("div");
        actions.className = "ai-write-actions";
        if (action === "compose") {
          // 采纳续写：另起一行接在读者开头之后，并把光标移回文本末尾
          const adopt = document.createElement("button");
          adopt.type = "button";
          adopt.textContent = "接在开头后面";
          adopt.addEventListener("click", () => {
            const base = field.value.trim();
            field.value = base ? `${base}\n${answer}` : answer;
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
        setHint(action === "compose" ? "李煜正在顺着这句续下去……" : "李煜正在读这一句……", false);
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
          setHint(`暂时没接上：${explainError(error)}`, true);
        } finally {
          tools.querySelectorAll("button").forEach((button) => (button.disabled = false));
        }
      };

      tools.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => run(button.dataset.aiAction));
      });
    });
  };

  // ---------- 引导：进站招呼 + 读到哪说到哪 ----------

  // 首页要翻开书封、印章可见之后才打招呼；其他页加载完即可
  const whenSealVisible = (callback) => {
    if (!document.body.classList.contains("home-page")) {
      callback();
      return;
    }
    if (document.body.classList.contains("book-opened")) {
      callback();
      return;
    }
    // 监听 body 类变化，等书封翻开
    const observer = new MutationObserver(() => {
      if (!document.body.classList.contains("book-opened")) return;
      observer.disconnect();
      callback();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  };

  // 进站招呼：每次会话每页只说一次，2.6 秒后轻声出现
  const initGreeting = () => {
    whenSealVisible(() => {
      window.setTimeout(() => {
        sayOnce(`liyu-ai-greet-${pageKey}`, page.greet, page.chips[0]);
      }, 2600);
    });
  };

  // 段落搭话：滚动到关键段落时，印章旁浮出一句话（每处每次会话只说一次）
  const initScrollHints = () => {
    if (!("IntersectionObserver" in window)) return;
    page.hints.forEach((hint, index) => {
      const target = document.querySelector(hint.sel);
      if (!target) return;
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.disconnect();
          sayOnce(`liyu-ai-hint-${pageKey}-${index}`, hint.text, hint.question);
        });
      }, { threshold: 0.35 });
      observer.observe(target);
    });
  };

  // ---------- 段落语境：读到哪一段，关键词与解读跟到哪一段 ----------
  // life 等长页：取「离视口中心最近」的段落为正在读的段落；
  // map 页没有滚动段落：取笺卡上展开的站点名为正在读的段落。
  // 进入段落时立即换快捷问题；在同一段停留 1.2 秒以上，印章旁才浮出这段的解读
  //（停留门槛防止快速划过时气泡连珠炮；解读内容本地预写，零延迟零花费）
  const initSectionGuide = () => {
    const sections = page.sections;
    if (!sections || !sections.length) return;
    let activeKey = "";
    let dwellTimer = 0;

    const applySection = (sec) => {
      if (!sec || sec.key === activeKey) return;
      activeKey = sec.key;
      liveChips = sec.chips;
      // 面板开过客才需要即时刷新快捷问题；没开过则等首次打开时自然生效
      if (body.dataset.ready) renderChips();
      window.clearTimeout(dwellTimer);
      dwellTimer = window.setTimeout(() => {
        if (activeKey === sec.key) {
          sayNow(`liyu-ai-sec-${pageKey}-${sec.key}`, sec.interpret, sec.question);
        }
      }, 1200);
    };

    // 地图页：监听笺卡上的站点名变化
    if (pageKey === "map") {
      const nameEl = document.querySelector("[data-spot-name]");
      if (!nameEl) return;
      const sync = () => {
        const name = (nameEl.textContent || "").trim();
        if (!name) return;
        const sec = sections.find((s) => name.includes(s.match));
        if (sec) applySection(sec);
      };
      new MutationObserver(sync).observe(nameEl, { childList: true, characterData: true, subtree: true });
      sync();
      return;
    }

    // 长页：滚动时找离视口中心最近的段落
    const items = sections
      .map((s) => ({ ...s, el: document.querySelector(s.sel) }))
      .filter((s) => s.el);
    if (!items.length) return;
    let ticking = false;
    const check = () => {
      ticking = false;
      const mid = window.innerHeight / 2;
      let best = null;
      let bestDist = Infinity;
      items.forEach((s) => {
        const rect = s.el.getBoundingClientRect();
        const dist = Math.abs(rect.top + rect.height / 2 - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = s;
        }
      });
      // 最近的段落也得在大半屏之内才算「正在读」；都不在就恢复页面默认关键词
      if (best && bestDist < window.innerHeight * 0.75) {
        applySection(best);
      } else if (activeKey) {
        activeKey = "";
        liveChips = null;
        if (body.dataset.ready) renderChips();
      }
    };
    window.addEventListener("scroll", () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(check);
      }
    }, { passive: true });
    check();
  };

  // ---------- 启动 ----------
  initPos();
  initWriteTools();
  initGreeting();
  initScrollHints();
  initSectionGuide();
})();
