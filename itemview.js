'use strict';

/**
 * 把 skyhelper-networth 返回的物品对象整理成前端可直接渲染的结构。
 * 保留带 § 颜色代码的原始文本，由浏览器端解析，避免服务端拼 HTML。
 */

const TYPE_LABELS = {
  ENCHANTMENT: '附魔',
  REFORGE: '重铸',
  GEMSTONE: '宝石',
  RECOMBOBULATOR_3000: '重铸成神话',
  SILEX: '精炼石',
  DRILL_PART: '钻头部件',
  DIVAN_POWDER_COATING: '粉末涂层',
  HOT_POTATO_BOOK: '热土豆书',
  FUMING_POTATO_BOOK: '烟熏土豆书',
  ART_OF_WAR: '战争艺术',
  ABILITY_SCROLL: '能力卷轴',
  RUNE: '符文',
  ATTRIBUTE: '属性',
  STAR: '星级',
  ENCHANTMENT_UPGRADE: '附魔升级',
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
const roman = (n) => ROMAN[n] || `x${n}`;

const pretty = (id = '') =>
  String(id)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

const RARITY_BY_COLOR = { f: 'COMMON', a: 'UNCOMMON', 9: 'RARE', 5: 'EPIC', 6: 'LEGENDARY', d: 'MYTHIC', b: 'DIVINE', c: 'SPECIAL', 4: 'SPECIAL' };

function rarityOf(it) {
  const tooltip = it.item?.components?.['minecraft:tooltip_style'] || '';
  const m = /hypixel_skyblock:(\w+)/.exec(tooltip);
  if (m) return m[1].toUpperCase();
  const name = it.item?.tag?.display?.Name || it.loreName || '';
  const color = (/§(.)/.exec(name) || [])[1];
  return RARITY_BY_COLOR[String(color).toLowerCase()] || '';
}

function stripColors(s = '') {
  return String(s).replace(/§./g, '');
}

function normalizeItem(it, container) {
  const tag = it.item?.tag || {};
  const ea = tag.ExtraAttributes || {};
  const display = tag.display || {};
  const comp = it.item?.components || {};

  const enchants = Object.entries(ea.enchantments || {}).map(([key, level]) => ({
    key,
    name: pretty(key),
    level: Number(level) || 1,
    label: `${pretty(key)} ${roman(Number(level) || 1)}`,
  }));

  const attributes = Object.entries(ea.attributes || {}).map(([key, level]) => ({
    key,
    name: pretty(key),
    level: Number(level) || 1,
  }));

  const runes = Object.entries(ea.runes || {}).map(([key, level]) => ({ key, name: pretty(key), level: Number(level) || 1 }));

  const stars = Math.max(Number(ea.dungeon_item_level) || 0, Number(ea.upgrade_level) || 0);
  const cleanName = stripColors(display.Name || it.loreName || it.name || '');

  return {
    id: it.id,
    name: it.name,
    displayName: display.Name || it.loreName || it.name,
    lore: Array.isArray(display.Lore) ? display.Lore : [],
    container,
    count: it.count || 1,
    price: Math.round(it.price || 0),
    unitPrice: Math.round((it.price || 0) / Math.max(1, it.count || 1)),
    basePrice: Math.round(it.basePrice || 0),
    soulbound: !!it.soulbound,
    cosmetic: !!it.cosmetic,
    rarity: rarityOf(it),
    recombobulated: Number(ea.rarity_upgrades) > 0 || /recombobulated/i.test(JSON.stringify(comp)),
    reforge: ea.modifier ? pretty(ea.modifier) : '',
    stars,
    hotPotatoBooks: Number(ea.hot_potato_count) || 0,
    artOfWar: Number(ea.art_of_war_count) || 0,
    enchants,
    attributes,
    runes,
    pet: it.petData
      ? {
          type: pretty(it.petData.type || ''),
          tier: String(it.petData.tier || '').toUpperCase(),
          exp: Math.round(it.petData.exp || 0),
          heldItem: it.petData.heldItem ? pretty(it.petData.heldItem.replace(/^PET_ITEM_/, '')) : '',
          candyUsed: it.petData.candyUsed || 0,
          active: !!it.petData.active,
        }
      : null,
    calculation: (it.calculation || []).map((c) => ({
      type: c.type,
      label: TYPE_LABELS[c.type] || pretty(c.type),
      id: c.id,
      name: pretty(String(c.id).replace(/_\d+$/, '')),
      price: Math.round(c.price || 0),
      count: c.count || 1,
    })),
    wiki: cleanName ? `https://wiki.hypixel.net/${encodeURIComponent(cleanName.replace(/\s+/g, '_'))}` : '',
  };
}

function normalizeItems(types) {
  const out = [];
  for (const [container, inv] of Object.entries(types || {})) {
    for (const it of inv.items || []) {
      if (!it) continue;
      out.push(normalizeItem(it, container));
    }
  }
  return out.sort((a, b) => b.price - a.price);
}

module.exports = { normalizeItems, normalizeItem, TYPE_LABELS };
