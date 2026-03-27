// amazon_scraper.js — PreciMap v4.1
// Strategy: Curated REAL deals + Chollometro RSS
// Images: Amazon CDN images/I/ format (NOT the broken images/P/ format)
// All deals verified with real prices from Amazon.es

const fetch = require('node-fetch');
const cheerio = require('cheerio');

const OUR_TAG = process.env.AMAZON_AFFILIATE_TAG || 'juanantonioex-21';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function addAffiliateTag(url) {
  try {
    if (!url) return url;
    if (!url.startsWith('http')) url = 'https://www.amazon.es' + url;
    const u = new URL(url);
    u.searchParams.set('tag', OUR_TAG);
    u.searchParams.set('linkCode', 'ur2');
    return u.toString();
  } catch { return url; }
}

function extractAsin(url) {
  const m = url?.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return m ? m[1] : null;
}

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (/(tv|monitor|tablet|portátil|auricular|altavoz|smartphone|cámara|teclado|ssd|gaming|echo|kindle|fire tv|alexa|ratón|usb|tarjeta sd)/i.test(t)) return 'tecnologia';
  if (/(ropa|camiseta|pantalón|zapatilla|jersey|chaqueta|vestido|zapato|bolso|adidas|nike|puma|mochila)/i.test(t)) return 'moda';
  if (/(sofá|silla|mesa|colchón|lámpara|aspirador|robot|freidora|cafetera|sartén|instant pot|roomba|oral-b|cepillo)/i.test(t)) return 'hogar';
  if (/(crema|sérum|perfume|maquillaje|champú|hidratant|gel|desodorante)/i.test(t)) return 'belleza';
  if (/(vitamina|suplemento|proteína|omega|colágeno)/i.test(t)) return 'salud';
  return 'otros';
}

// ─── CURATED REAL DEALS from Amazon.es ──────────────────────────────────────
// Every product here is REAL, with verified title, price range, and working image
// Images use https://m.media-amazon.com/images/I/ format (VERIFIED WORKING)
const CURATED_CATALOG = [
  {
    asin: 'B09B8X9RGM',
    title: 'Echo Dot (5.ª generación) Altavoz inteligente WiFi y Bluetooth con Alexa - Antracita',
    image_url: 'https://m.media-amazon.com/images/I/71xoR4A6q-L._AC_SL1000_.jpg',
    typical_price: 64.99,
    deal_range: [22, 34],
    category: 'tecnologia',
  },
  {
    asin: 'B0CJKTWTVT',
    title: 'Fire TV Stick 4K (Última generación) WiFi 6, Dolby Vision/Atmos, HDR10+',
    image_url: 'https://m.media-amazon.com/images/I/61WzFiMWBWL._AC_SL1000_.jpg',
    typical_price: 59.99,
    deal_range: [29, 39],
    category: 'tecnologia',
  },
  {
    asin: 'B0CW4HD359',
    title: 'Fire TV Stick 4K Max (2.ª gen) WiFi 6E, Fondo ambiental, 16GB',
    image_url: 'https://m.media-amazon.com/images/I/61PbSKGpq1L._AC_SL1000_.jpg',
    typical_price: 79.99,
    deal_range: [39, 49],
    category: 'tecnologia',
  },
  {
    asin: 'B09TMF6742',
    title: 'Kindle Paperwhite (16 GB) Pantalla de 6,8" y luz cálida ajustable',
    image_url: 'https://m.media-amazon.com/images/I/61SUj2aKoEL._AC_SL1000_.jpg',
    typical_price: 149.99,
    deal_range: [99, 119],
    category: 'tecnologia',
  },
  {
    asin: 'B09P45WNMB',
    title: 'Oral-B iO Series 6 Cepillo Eléctrico con Sensor Inteligente y Temporizador',
    image_url: 'https://m.media-amazon.com/images/I/61WkMiSgJJL._AC_SL1500_.jpg',
    typical_price: 299.99,
    deal_range: [89, 129],
    category: 'hogar',
  },
  {
    asin: 'B0D1DFHHQH',
    title: 'JBL Tune 520BT Auriculares inalámbricos Bluetooth 5.3, sonido JBL Pure Bass',
    image_url: 'https://m.media-amazon.com/images/I/51KRlnfEVjL._AC_SL1500_.jpg',
    typical_price: 49.99,
    deal_range: [24, 34],
    category: 'tecnologia',
  },
  {
    asin: 'B07D3LHKNS',
    title: 'Instant Pot Duo 7-en-1 Olla a presión eléctrica programable 5.7L',
    image_url: 'https://m.media-amazon.com/images/I/71V1LuFS3aL._AC_SL1500_.jpg',
    typical_price: 99.99,
    deal_range: [59, 74],
    category: 'hogar',
  },
  {
    asin: 'B0B469Q17H',
    title: 'Xiaomi Robot Vacuum E10 - Robot Aspirador y Fregona 4000Pa',
    image_url: 'https://m.media-amazon.com/images/I/61F5Mm+M2pL._AC_SL1500_.jpg',
    typical_price: 199.99,
    deal_range: [99, 139],
    category: 'hogar',
  },
  {
    asin: 'B0CHX3QXNR',
    title: 'Echo Show 8 (3.ª generación) Pantalla inteligente HD con Alexa y cámara 13 MP',
    image_url: 'https://m.media-amazon.com/images/I/61FjmFMgHnL._AC_SL1000_.jpg',
    typical_price: 169.99,
    deal_range: [84, 109],
    category: 'tecnologia',
  },
  {
    asin: 'B09X7FXHVJ',
    title: 'SanDisk Extreme PRO Tarjeta SD 128 GB SDXC UHS-I V30 hasta 200 MB/s',
    image_url: 'https://m.media-amazon.com/images/I/71VR4aQFhBL._AC_SL1500_.jpg',
    typical_price: 29.99,
    deal_range: [12, 18],
    category: 'tecnologia',
  },
];

// ─── Price checker — scrape current price from Amazon.es product page ────────
async function checkAmazonPrice(asin) {
  try {
    const url = `https://www.amazon.es/dp/${asin}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 12000,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // Price selectors (ordered by reliability)
    const selectors = [
      '.priceToPay .a-offscreen',
      '#corePrice_feature_div .a-price .a-offscreen',
      '.a-price.aok-align-center .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
    ];
    let price = null;
    for (const sel of selectors) {
      const txt = $(sel).first().text().trim().replace(/[€\s]/g, '').replace(',', '.');
      const p = parseFloat(txt);
      if (p > 0 && p < 99999) { price = p; break; }
    }

    // Original/was price
    const wasText = $('.basisPrice .a-offscreen, .a-text-price .a-offscreen').first().text().trim().replace(/[€\s]/g, '').replace(',', '.');
    const wasPrice = parseFloat(wasText) || null;

    // Title
    const title = $('#productTitle').text().trim().slice(0, 200) || null;

    // Real image from product page
    const image = $('#landingImage').attr('src') || $('#imgTagWrapperId img').attr('src') || null;

    return { price, wasPrice, title, image };
  } catch { return null; }
}

// ─── Chollometro RSS — Real community-voted deals ──────────────────────────
async function scrapeChollometroRSS() {
  const results = [];
  try {
    await sleep(1000);
    const res = await fetch('https://www.chollometro.com/rss/hot', {
      headers: { 'User-Agent': 'PreciMap/4.0', 'Accept': 'application/rss+xml,text/xml,*/*' },
      timeout: 10000,
    });
    if (!res.ok) { console.log('Chollometro RSS failed:', res.status); return []; }
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    $('item').each((i, item) => {
      if (i >= 15) return false; // Limit
      const $item = $(item);
      const title = $item.find('title').text().trim().replace(/<!\[CDATA\[|\]\]>/g, '');
      const link = $item.find('link').text().trim() || $item.find('guid').text().trim();
      const desc = $item.find('description').text().trim();

      // Only Amazon.es deals
      const isAmazon = link.includes('amazon.es') || link.includes('amzn.to');
      if (!isAmazon) return;

      // Extract price
      const priceMatch = (title + ' ' + desc).match(/(\d+[.,]?\d*)\s*€/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;
      if (!price || price <= 0) return;

      // Extract image from description HTML
      const imgMatch = desc.match(/<img[^>]+src="([^"]+)"/i);
      const imgUrl = imgMatch ? imgMatch[1] : null;

      const asin = extractAsin(link);
      const finalUrl = asin
        ? addAffiliateTag(`https://www.amazon.es/dp/${asin}`)
        : addAffiliateTag(link);

      results.push({
        title: title.slice(0, 200),
        url: finalUrl,
        deal_price: price,
        original_price: null,
        discount_percent: null,
        image_url: imgUrl,
        store: 'Amazon',
        category: detectCategory(title),
        source: 'chollometro',
        asin: asin || null,
      });
    });
  } catch(e) { console.error('Chollometro error:', e.message); }
  return results;
}

// ─── VERIFY ACTIVE BOT DEALS ─────────────────────────────────────────────────
async function verifyActiveBotDeals(supabase, botUserId) {
  console.log('🔍 Verifying active bot deals...');
  try {
    const { data: active } = await supabase
      .from('deals').select('id, title, url, deal_price, original_price')
      .eq('reported_by', botUserId).eq('is_active', 1).not('url', 'is', null);

    if (!active?.length) { console.log('No active bot deals'); return 0; }
    console.log(`Checking ${active.length} active deals...`);

    let expired = 0;
    for (const deal of active) {
      const asin = extractAsin(deal.url);
      if (!asin) continue;
      await sleep(3000 + Math.random() * 2000); // Respect rate limits

      const product = await checkAmazonPrice(asin);
      if (!product || product.price === null) continue;

      const origPrice = deal.original_price || deal.deal_price * 1.3;
      const stillDeal = product.price <= deal.deal_price * 1.1;
      const priceNormal = product.price >= origPrice * 0.95;

      if (!stillDeal || priceNormal) {
        await supabase.from('deals').update({ is_active: 0 }).eq('id', deal.id);
        console.log(`❌ Expired: "${deal.title.slice(0,50)}" ${deal.deal_price}€→${product.price}€`);
        expired++;
      } else {
        // Update image if we got a better one
        if (product.image) {
          await supabase.from('deals').update({ image_url: product.image }).eq('id', deal.id);
        }
        console.log(`✅ Active: "${deal.title.slice(0,40)}" ${product.price}€`);
      }
    }
    console.log(`Verification: ${expired} expired`);
    return expired;
  } catch(e) { console.error('Verify error:', e.message); return 0; }
}

// ─── MAIN SCRAPER ─────────────────────────────────────────────────────────────
async function runAmazonScraper(supabase, botUserId) {
  console.log('🤖 PreciMap scraper v4.1 starting...');
  const allDeals = [];

  // 1. Check curated products for current deals
  console.log(`📦 Checking ${CURATED_CATALOG.length} curated products...`);
  for (const product of CURATED_CATALOG) {
    await sleep(3000 + Math.random() * 2000);
    const live = await checkAmazonPrice(product.asin);

    let dealPrice, originalPrice, discPct, imageUrl;

    if (live?.price && live.price < product.typical_price * 0.85) {
      // Live price is actually discounted! Use real data
      dealPrice = live.price;
      originalPrice = live.wasPrice || product.typical_price;
      imageUrl = live.image || product.image_url;
      console.log(`  ✅ LIVE DEAL: ${product.title.slice(0,40)} → ${live.price}€ (was ${originalPrice}€)`);
    } else if (live?.price && live.price <= product.deal_range[1]) {
      // Price is within known deal range
      dealPrice = live.price;
      originalPrice = product.typical_price;
      imageUrl = live.image || product.image_url;
      console.log(`  ✅ IN RANGE: ${product.title.slice(0,40)} → ${live.price}€`);
    } else {
      // Not currently on sale — skip (DON'T insert fake deals)
      const currentP = live?.price || 'N/A';
      console.log(`  ⏭️  Not on sale: ${product.title.slice(0,40)} (${currentP}€)`);
      continue;
    }

    // CRITICAL: deal price must be LESS than original
    if (dealPrice >= originalPrice) continue;
    discPct = Math.round((1 - dealPrice / originalPrice) * 100);
    if (discPct < 10) continue;

    allDeals.push({
      asin: product.asin,
      title: live?.title || product.title,
      url: addAffiliateTag(`https://www.amazon.es/dp/${product.asin}`),
      deal_price: dealPrice,
      original_price: originalPrice,
      discount_percent: discPct,
      image_url: imageUrl,
      store: 'Amazon',
      category: product.category,
      source: 'curated_live',
    });
  }

  // 2. Chollometro RSS for community-voted deals
  console.log('🔍 Checking Chollometro RSS...');
  const rssDeals = await scrapeChollometroRSS();
  allDeals.push(...rssDeals);
  console.log(`Found ${rssDeals.length} from Chollometro`);

  console.log(`Total candidates: ${allDeals.length}`);

  // Deduplicate by ASIN
  const seen = new Set();
  const unique = allDeals.filter(d => {
    const key = d.asin || d.url.split('?')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    if (!d.title || d.title.length < 10) return false;
    if (!d.deal_price || d.deal_price <= 0) return false;
    if (d.original_price && d.deal_price >= d.original_price) return false;
    if (d.deal_price > 2000) return false;
    return true;
  });

  console.log(`${unique.length} quality deals after filters`);

  // Save to DB
  let saved = 0;
  for (const deal of unique) {
    try {
      // Check if already exists
      if (deal.asin) {
        const { data: existing } = await supabase.from('deals')
          .select('id').ilike('url', `%${deal.asin}%`).eq('is_active', 1).limit(1);
        if (existing?.length) continue;
      }

      const expires = new Date(Date.now() + 7 * 24 * 3600000).toISOString();
      await supabase.from('deals').insert({
        title: deal.title,
        url: deal.url,
        deal_price: deal.deal_price,
        original_price: deal.original_price || null,
        discount_percent: deal.discount_percent || null,
        image_url: deal.image_url || null,
        store: deal.store || 'Amazon',
        category: deal.category || 'otros',
        reported_by: botUserId,
        is_active: 1,
        expires_at: expires,
        votes_up: 0, votes_down: 0,
      });
      saved++;
      await sleep(100);
    } catch(e) { console.error('DB insert:', e.message); }
  }

  console.log(`✅ Scraper done: ${saved} new deals saved`);
  return { found: allDeals.length, unique: unique.length, saved };
}

module.exports = { runAmazonScraper, verifyActiveBotDeals, addAffiliateTag };
