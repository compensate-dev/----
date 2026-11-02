#!/usr/bin/env node
// 一江春水 · 搜狗百科条目抓取（绕过 GFW 可通的链路）
// 用法：node scripts/sync-sogou.mjs 李煜 李从善 樊若水

const args = process.argv.slice(2);
if (!args.length) {
  console.error("用法：node scripts/sync-sogou.mjs 条目1 条目2 ...");
  process.exit(1);
}

// 搜狗百科移动端页面；页面里的 JSON 脚本藏着正文字段
const fetchMobile = async (q) => {
  const url = `https://baike.sogou.com/m/${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // 搜狗的正文在 <div class="abstract"> / <div class="lemma-summary"> 里
    const abs = html.match(/class="abstract"[^>]*>([\s\S]*?)<\/div>/i)
      || html.match(/class="lemma-summary"[^>]*>([\s\S]*?)<\/div>/i);
    const desc = html.match(/class="lemma-desc"[^>]*>([\s\S]*?)<\/div>/i);
    const textOf = (s) => (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return {
      title: (html.match(/<title>([^<]+)<\/title>/) || [])[1],
      abstract: textOf(abs?.[1]).slice(0, 500),
      desc: textOf(desc?.[1]),
    };
  } catch (e) {
    return null;
  }
};

const main = async () => {
  for (const q of args) {
    const r = await fetchMobile(q);
    if (!r) { console.log(`[${q}] 未抓到`); continue; }
    console.log(`\n—— ${q} ——`);
    console.log(`  标题: ${r.title}`);
    if (r.desc) console.log(`  分类: ${r.desc}`);
    if (r.abstract) console.log(`  摘要: ${r.abstract}`);
  }
};

main();
