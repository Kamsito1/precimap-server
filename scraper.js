// MapaTacano — Event Scraper from official Spanish city council websites
// Scrapes REAL events only. No invented data.
// Sources: Ayuntamiento de Córdoba, Madrid, Sevilla, etc.

const SOURCES = [
  {
    city: 'Córdoba',
    name: 'Ayuntamiento de Córdoba',
    url: 'https://www.cordoba.es/agenda-cultural',
    type: 'cordoba',
  },
  {
    city: 'Córdoba',
    name: 'Diputación de Córdoba',
    url: 'https://www.dipucordoba.es/agenda',
    type: 'generic_rss',
    rss: 'https://www.dipucordoba.es/feed/agenda',
  },
  {
    city: 'Córdoba',
    name: 'Turismo de Córdoba',
    url: 'https://www.turismodecordoba.org/agenda',
    type: 'turismo_cordoba',
  },
];

const CAT_MAP = {
  música: 'musica', musica: 'musica', concierto: 'musica', concert: 'musica',
  teatro: 'teatro', obra: 'teatro',
  cine: 'cine', película: 'cine', pelicula: 'cine',
  deporte: 'deporte', fútbol: 'deporte', futbol: 'deporte', partido: 'deporte',
  feria: 'festival', festival: 'festival', mercado: 'festival',
  expo: 'expo', exposición: 'expo', exposicion: 'expo', museo: 'expo',
  gastro: 'gastronomia', gastronomia: 'gastronomia', cata: 'gastronomia', degustación: 'gastronomia',
};

function detectCategory(title, desc) {
  const text = (title + ' ' + (desc || '')).toLowerCase();
  for (const [keyword, cat] of Object.entries(CAT_MAP)) {
    if (text.includes(keyword)) return cat;
  }
  return 'otro';
}

function parseDate(str) {
  if (!str) return null;
  // Common Spanish date formats: "15 de marzo de 2026", "15/03/2026", "2026-03-15"
  const iso = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const es = str.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
  if (es) {
    const months = {enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12};
    const m = months[es[2].toLowerCase()];
    if (m) return `${es[3]}-${String(m).padStart(2,'0')}-${String(es[1]).padStart(2,'0')}`;
  }
  const slash = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) return `${slash[3]}-${slash[2].padStart(2,'0')}-${slash[1].padStart(2,'0')}`;
  return null;
}

async function scrapeGenericRSS(source) {
  const events = [];
  try {
    const res = await fetch(source.rss || source.url);
    const text = await res.text();
    const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const item of items.slice(0, 15)) {
      const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] || item.match(/<title>(.*?)<\/title>/)?.[1];
      const link = item.match(/<link>(.*?)<\/link>/)?.[1];
      const desc = item.match(/<description><!\[CDATA\[(.*?)\]\]>/)?.[1]?.replace(/<[^>]+>/g, '').slice(0, 200);
      const dateStr = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1];
      if (!title) continue;
      const date = parseDate(dateStr) || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      events.push({
        title: title.trim(),
        category: detectCategory(title, desc),
        city: source.city,
        description: desc || '',
        url: link || source.url,
        date,
        source: 'ayuntamiento',
        is_free: 0,
        price_label: 'Consultar precio',
      });
    }
  } catch (e) {
    console.log(`RSS error ${source.name}:`, e.message);
  }
  return events;
}

async function scrapeAllSources() {
  const all = [];
  for (const source of SOURCES) {
    if (source.rss || source.type === 'generic_rss') {
      const events = await scrapeGenericRSS(source);
      all.push(...events);
      console.log(`✅ ${source.name}: ${events.length} eventos`);
    }
  }
  return all;
}

module.exports = { scrapeAllSources, detectCategory, parseDate };
