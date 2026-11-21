#!/usr/bin/env node
'use strict';

/**
 * Hypixel SkyBlock 净值（Networth）查询工具
 * 数据：Hypixel 官方 API（需 API Key） + SkyHelper-Networth 本地计算
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

const ROOT = __dirname;
let apiKey = '';
let ProfileNetworthCalculator = null;

/**
 * 延迟加载计算库：库在 require 时会立即请求 Hypixel 的 items 数据并启动 12h 定时器，
 * 所以必须在 API Key 就绪、拦截器挂好之后再加载。
 */
function loadCalculator() {
  if (ProfileNetworthCalculator) return ProfileNetworthCalculator;
  axios.interceptors.request.use((cfg) => {
    if (apiKey && cfg.url && cfg.url.includes('api.hypixel.net')) {
      cfg.headers = cfg.headers || {};
      cfg.headers['API-Key'] = apiKey;
    }
    return cfg;
  });
  ({ ProfileNetworthCalculator } = require('skyhelper-networth'));
  return ProfileNetworthCalculator;
}
const HYPIXEL = 'https://api.hypixel.net';
const PRICE_URLS = [
  'https://raw.githubusercontent.com/SkyHelperBot/Prices/main/pricesV2.json',
  'https://cdn.jsdelivr.net/gh/SkyHelperBot/Prices@main/pricesV2.json',
];
const PRICE_CACHE = path.join(os.tmpdir(), 'skyblock-nw-prices.json');
const PRICE_TTL = 5 * 60 * 1000;

// 库内部用 axios 拉数据（无超时/无鉴权），这里统一兜底
axios.defaults.timeout = 20000;

// ---------- 终端样式 ----------
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const ansi = (code) => (s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = ansi('1');
const dim = ansi('2');
const red = ansi('31');
const green = ansi('32');
const yellow = ansi('33');
const magenta = ansi('35');
const cyan = ansi('36');
const gray = ansi('90');

// 进度只在 TTY 上原地刷新，重定向时不污染输出
const STEP_TTY = !!process.stderr.isTTY;
function step(msg) {
  if (STEP_TTY) process.stderr.write('\r\x1b[K' + gray(msg));
  else process.stderr.write(msg + '\n');
}
function endStep() {
  if (STEP_TTY) process.stderr.write('\r\x1b[K');
}

// ---------- 基础工具 ----------
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--list') o.list = true;
    else if (a === '--fresh') o.fresh = true;
    else if (a === '--no-museum') o.museum = false;
    else if (a.startsWith('--profile=')) o.profile = a.slice('--profile='.length);
    else if (a === '--profile') o.profile = argv[++i];
    else if (a.startsWith('--key=')) o.key = a.slice('--key='.length);
    else if (a === '--key') o.key = argv[++i];
    else if (a.startsWith('--top=')) o.top = Number(a.slice('--top='.length)) || 0;
    else if (a === '--top') o.top = Number(argv[++i]) || 0;
    else if (a.startsWith('-')) throw new Error(`未知参数：${a}`);
    else o._.push(a);
  }
  return o;
}

const HELP = `
用法: node nw.js <玩家名|UUID> [选项]

选项:
  --profile <名称|ID>   指定档案（如 Apple / 00912956-3fd6-...），默认取游戏内选中档案
  --list                只列出该玩家所有档案，不算净值
  --top <n>             显示最贵物品数量，默认 8，0 关闭
  --no-museum           跳过博物馆数据（更快，净值会略低）
  --json                输出机器可读 JSON
  --fresh               强制刷新价格缓存
  --key <key>           临时指定 Hypixel API Key（也可用 HYPIXEL_API_KEY 或 .env）
  -h, --help            显示帮助

示例:
  node nw.js Refraction
  node nw.js Refraction --profile Apple
  node nw.js 4855c53ee4fb4100997600a92fc50984 --json --top 20
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, { headers = {}, timeout = 20000, retries = 2, label = '' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      if (!res.ok) {
        const detail =
          typeof data === 'string' ? data.slice(0, 200) : data.cause || data.detail || JSON.stringify(data).slice(0, 200);
        const err = new Error(`${label || url} 返回 HTTP ${res.status}：${detail}`);
        err.status = res.status;
        err.body = data;
        // 4xx 除 429 外重试没有意义
        if (res.status < 500 && res.status !== 429) throw err;
        lastErr = err;
        throw err;
      }
      return data;
    } catch (e) {
      lastErr = e;
      const fatal = e.status && e.status < 500 && e.status !== 429;
      if (fatal || attempt === retries) break;
      await sleep(700 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ---------- UUID ----------
const RE_UNDASHED = /^[0-9a-f]{32}$/i;
const RE_DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toDashed = (u) => {
  const s = u.replace(/-/g, '').toLowerCase();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

async function resolvePlayer(input) {
  if (RE_DASHED.test(input)) return { uuid: input.toLowerCase(), name: null };
  if (RE_UNDASHED.test(input)) return { uuid: toDashed(input), name: null };

  const name = input.trim();
  try {
    const d = await getJson(`https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(name)}`, {
      retries: 0,
      label: 'Mojang 玩家查询',
    });
    return { uuid: toDashed(d.id), name: d.name };
  } catch (e) {
    if (e.status !== 404 && e.status !== 400) throw e;
  }
  try {
    const d = await getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, {
      retries: 0,
      label: 'Mojang 玩家查询',
    });
    return { uuid: toDashed(d.id), name: d.name };
  } catch (e) {
    if (e.status === 404 || e.status === 400) {
      throw new Error(`找不到名为 "${name}" 的 Minecraft 玩家（大小写、改名都会影响查询）`);
    }
    throw e;
  }
}

async function fetchNameByUuid(uuid) {
  try {
    const d = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, '')}`, {
      retries: 0,
      timeout: 8000,
    });
    return d.name || null;
  } catch {
    return null;
  }
}

// ---------- Hypixel ----------
function hypixelGet(pathname, key) {
  return getJson(`${HYPIXEL}${pathname}`, {
    headers: { 'API-Key': key, 'User-Agent': 'skyblock-networth-cli/1.0' },
    timeout: 25000,
    retries: 1,
    label: 'Hypixel API',
  });
}

function explainHypixelError(e) {
  const cause = e.body && e.body.cause ? String(e.body.cause) : '';
  if (/missing api-key/i.test(cause) || e.status === 401) {
    return 'Hypixel 需要 API Key：在 https://developer.hypixel.net 创建一个，然后写入 .env 的 HYPIXEL_API_KEY=xxx';
  }
  if (/invalid api key/i.test(cause) || (e.status === 403 && /key/i.test(cause))) {
    return 'API Key 无效或已失效，请到 developer.hypixel.net 重新生成';
  }
  if (e.status === 429) return '触发 Hypixel 限流（300 次/分钟），稍等再试';
  if (e.status === 404) return '玩家或档案不存在（也可能是从未进过 SkyBlock）';
  if (cause) return `Hypixel 返回：${cause}`;
  return e.message;
}

// ---------- 价格 ----------
async function loadPrices(fresh) {
  if (!fresh) {
    try {
      const cached = JSON.parse(fs.readFileSync(PRICE_CACHE, 'utf8'));
      if (Date.now() - cached.t < PRICE_TTL && cached.p) return cached.p;
    } catch {
      /* 无缓存 */
    }
  }
  let lastErr;
  for (const url of PRICE_URLS) {
    try {
      const prices = await getJson(url, { timeout: 30000, retries: 1, label: '价格数据' });
      try {
        fs.writeFileSync(PRICE_CACHE, JSON.stringify({ t: Date.now(), p: prices }));
      } catch {
        /* 缓存写失败不影响查询 */
      }
      return prices;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`拿不到 SkyHelper 价格数据（网络问题）：${lastErr.message}`);
}

// ---------- 档案 ----------
function pickProfile(profiles, memberKey, wanted) {
  const usable = profiles.filter((p) => p.members && p.members[memberKey]);
  if (!usable.length) return null;

  if (wanted) {
    const w = wanted.toLowerCase().replace(/-/g, '');
    const hit = usable.find(
      (p) => String(p.cute_name || '').toLowerCase() === wanted.toLowerCase() || p.profile_id.replace(/-/g, '') === w,
    );
    if (!hit) {
      const names = usable.map((p) => `${p.cute_name}(${p.game_mode || 'normal'})`).join('、');
      throw new Error(`该玩家没有名为 "${wanted}" 的档案，可选：${names}`);
    }
    return hit;
  }

  const selected = usable.find((p) => p.selected);
  if (selected) return selected;
  return usable.sort((a, b) => (b.members[memberKey].last_save || 0) - (a.members[memberKey].last_save || 0))[0];
}

// ---------- 输出 ----------
const toNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v && typeof v === 'object' && typeof v.balance === 'number') return v.balance;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 库会用 `profile.bank_account` 直接参与加法，若该字段是对象会拼成字符串，
 * 这里统一收敛为数字，必要时用分类合计重算总额。
 */
function normalizeResult(r) {
  const types = {};
  for (const [k, v] of Object.entries(r.types || {})) {
    types[k] = { ...v, total: toNum(v.total), unsoulboundTotal: toNum(v.unsoulboundTotal) };
  }
  const purse = toNum(r.purse);
  const bank = toNum(r.bank);
  const personalBank = toNum(r.personalBank);
  const sum = Object.values(types).reduce((a, b) => a + b.total, 0) + purse + bank + personalBank;
  const networth = typeof r.networth === 'number' && Number.isFinite(r.networth) ? r.networth : sum;
  const unsoulbound = typeof r.unsoulboundNetworth === 'number' && Number.isFinite(r.unsoulboundNetworth) ? r.unsoulboundNetworth : sum;
  return { ...r, networth, unsoulboundNetworth: unsoulbound, purse, bank, personalBank, types };
}

function fmt(n) {
  if (!Number.isFinite(n) || n === 0) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

const LABELS = {
  armor: '护甲',
  equipment: '装备',
  wardrobe: '衣柜',
  inventory: '背包',
  enderchest: '末影箱',
  accessories: '饰品',
  personal_vault: '个人金库',
  fishing_bag: '鱼袋',
  potion_bag: '药水袋',
  sacks_bag: '麻袋背包',
  sacks: '麻袋',
  candy_inventory: '糖果袋',
  carnival_mask_inventory: '嘉年华面具',
  storage: '箱子仓库',
  museum: '博物馆',
  essence: '精华',
  pets: '宠物',
  quiver: '箭袋',
  farming_toolkit: '农耕工具箱',
  hunting_toolkit: '狩猎工具箱',
};

const MODE = { ironman: '铁人', bingo: 'Bingo', stranded: '荒岛', isle: '普通' };

const padEnd = (s, n) => s + ' '.repeat(Math.max(0, n - [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0)));
const padStart = (s, n) => ' '.repeat(Math.max(0, n - [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0))) + s;

function render({ name, uuid, profile, data, normal, nonCosmetic, top, topN }) {
  const line = gray('─'.repeat(52));
  const out = [];
  const gamemode = MODE[profile.game_mode] || '普通';
  const saved = data.last_save ? ` · 存档于 ${new Date(data.last_save).toLocaleString('zh-CN', { hour12: false })}` : '';

  out.push('');
  out.push(`  ${bold(name || '未知玩家')}  ${gray(uuid)}`);
  out.push(`  ${gray('档案')} ${cyan(profile.cute_name)} ${gray(`· ${gamemode}模式${saved}`)}`);
  out.push('  ' + line);
  out.push('');

  out.push(`  ${gray('总净值')}        ${bold(yellow(fmt(normal.networth)))}`);
  out.push(`  ${gray('不含魂绑')}      ${cyan(fmt(normal.unsoulboundNetworth))}`);
  out.push(`  ${gray('不含化妆品')}    ${cyan(fmt(nonCosmetic.networth))}`);
  out.push('');
  out.push(`  ${gray('钱包')}          ${cyan(fmt(normal.purse))}`);
  out.push(`  ${gray('银行')}          ${cyan(fmt(normal.bank))}`);
  if (normal.personalBank) out.push(`  ${gray('个人银行')}      ${cyan(fmt(normal.personalBank))}`);
  out.push('');

  const types = Object.entries(normal.types || {})
    .filter(([, v]) => v && v.total > 0)
    .sort((a, b) => b[1].total - a[1].total);

  if (types.length) {
    out.push(`  ${bold('分类明细')}`);
    const total = normal.networth || 1;
    for (const [k, v] of types) {
      const pct = ((v.total / total) * 100).toFixed(0);
      out.push(`    ${padEnd(LABELS[k] || k, 14)}${padStart(fmt(v.total), 10)}  ${gray(pct + '%')}`);
    }
    out.push('');
  }

  if (topN > 0 && top.length) {
    out.push(`  ${bold('最贵物品')} ${gray(`Top ${Math.min(topN, top.length)}`)}`);
    top.slice(0, topN).forEach((it, i) => {
      const n = String(i + 1).padStart(2, ' ');
      const cnt = it.count > 1 ? gray(` x${it.count}`) : '';
      out.push(`    ${gray(n + '.')} ${padEnd(it.name, 30)}${padStart(fmt(it.price), 9)}${cnt}`);
    });
    out.push('');
  }

  if (normal.noInventory) {
    out.push(`  ${red('注意')} 该玩家关闭了 API 设置，背包/末影箱等库存未计入净值`);
    out.push('');
  }

  return out.join('\n');
}

// ---------- 主流程 ----------
async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args._.length && !args.list)) {
    console.log(HELP);
    return;
  }

  const key = args.key || process.env.HYPIXEL_API_KEY || process.env.HYPIXEL_KEY;
  const input = args._[0];
  if (!input) throw new Error('请提供玩家名或 UUID');
  if (!key) {
    throw new Error(
      '缺少 Hypixel API Key。\n' +
        '  1) 打开 https://developer.hypixel.net 用你的 Hypixel 账号创建 Key\n' +
        '  2) 在本目录 .env 写入 HYPIXEL_API_KEY=你的key（或设置同名环境变量）',
    );
  }

  apiKey = key;

  step('解析玩家…');
  const player = await resolvePlayer(input);
  if (!player.name) player.name = await fetchNameByUuid(player.uuid);
  const uuid = player.uuid;
  // Hypixel 的 members 用不带横线的 UUID 作为键
  const memberKey = uuid.replace(/-/g, '');

  step('拉取 SkyBlock 档案…');
  let profilesRes;
  try {
    profilesRes = await hypixelGet(`/v2/skyblock/profiles?uuid=${uuid}`, key);
  } catch (e) {
    throw new Error(explainHypixelError(e));
  }
  const profiles = profilesRes.profiles || [];
  if (!profiles.length) throw new Error(`${player.name || uuid} 没有 SkyBlock 档案`);

  if (args.list) {
    const list = profiles
      .filter((p) => p.members && p.members[memberKey])
      .map((p) => ({
        id: p.profile_id,
        cute_name: p.cute_name,
        game_mode: p.game_mode || 'normal',
        selected: !!p.selected,
        last_save: p.members[memberKey].last_save || null,
      }));

    if (args.json) {
      endStep();
      console.log(JSON.stringify({ player: { name: player.name, uuid }, profiles: list }, null, 2));
      return;
    }

    console.log('');
    console.log(`  ${bold(player.name || uuid)}  ${gray(uuid)}`);
    console.log('');
    for (const p of profiles.filter((p) => p.members && p.members[memberKey])) {
      const d = p.members[memberKey];
      const tag = p.selected ? green(' ● 选中') : '';
      const mode = MODE[p.game_mode] || '普通';
      const saved = d.last_save ? new Date(d.last_save).toLocaleString('zh-CN', { hour12: false }) : '-';
      console.log(`  ${padEnd(p.cute_name, 12)} ${gray(mode)}  ${gray(saved)}  ${gray(p.profile_id)}${tag}`);
    }
    console.log('');
    return;
  }

  const profile = pickProfile(profiles, memberKey, args.profile);
  if (!profile) throw new Error('找不到该玩家可读取的档案');
  const data = profile.members[memberKey];

  let museumData;
  if (args.museum !== false) {
    step('拉取博物馆…');
    try {
      const museum = await hypixelGet(`/v2/skyblock/museum?profile=${profile.profile_id}`, key);
      museumData = museum.members ? museum.members[memberKey] : undefined;
    } catch (e) {
      endStep();
      process.stderr.write(yellow(`! 博物馆数据不可用（${explainHypixelError(e)}），净值会略低\n`));
    }
  }

  step('获取价格…');
  const prices = await loadPrices(args.fresh);

  step('计算净值…');
  const bank = toNum(profile.banking && profile.banking.balance);
  const Calculator = loadCalculator();
  const calc = new Calculator(data, museumData, bank);
  const [raw, rawNonCosmetic] = await Promise.all([calc.getNetworth({ prices }), calc.getNonCosmeticNetworth({ prices })]);
  const normal = normalizeResult(raw);
  const nonCosmetic = normalizeResult(rawNonCosmetic);

  const merged = new Map();
  for (const inv of Object.values(normal.types || {})) {
    for (const it of inv.items || []) {
      const k = it.name;
      const cur = merged.get(k) || { name: it.name, price: 0, count: 0 };
      cur.price += it.price || 0;
      cur.count += it.count || 1;
      merged.set(k, cur);
    }
  }
  const top = [...merged.values()].sort((a, b) => b.price - a.price);

  if (args.json) {
    endStep();
    console.log(
      JSON.stringify(
        {
          player: { name: player.name, uuid },
          profile: {
            id: profile.profile_id,
            cute_name: profile.cute_name,
            game_mode: profile.game_mode || 'normal',
            selected: !!profile.selected,
            last_save: data.last_save || null,
          },
          networth: normal.networth,
          unsoulboundNetworth: normal.unsoulboundNetworth,
          nonCosmeticNetworth: nonCosmetic.networth,
          purse: normal.purse,
          bank: normal.bank,
          personalBank: normal.personalBank,
          noInventory: normal.noInventory,
          types: Object.fromEntries(
            Object.entries(normal.types || {})
              .filter(([, v]) => v.total > 0)
              .map(([k, v]) => [k, { total: v.total, unsoulboundTotal: v.unsoulboundTotal }]),
          ),
          topItems: top.slice(0, args.top === 0 ? 0 : args.top || 8),
        },
        null,
        2,
      ),
    );
    return;
  }

  endStep();
  console.log(render({ name: player.name, uuid, profile, data, normal, nonCosmetic, top, topN: args.top === 0 ? 0 : args.top || 8 }));
}

main()
  .then(() => new Promise((resolve) => process.stdout.write('', resolve)))
  .then(() => process.exit(0))
  .catch((e) => {
    endStep();
    console.error(red('✖ ') + e.message);
    process.exit(1);
  });
