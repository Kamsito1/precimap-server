// amazon_scraper.js — PreciMap
// Scraper de ofertas de Amazon.es con tag de afiliado automático
// Fuentes: Amazon Outlet, Ofertas del día, páginas de chollos públicas

const fetch = require('node-fetch');
const cheerio = require('cheerio');

const OUR_TAG = process.env.AMAZON_AFFILIATE_TAG || 'juanantonioex-21';

// Headers que simulan un navegador real (anti-bot básico)
function getHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'Upgrade-Insecure-Requests': '1',
  };
}

// Añade tag de afiliado a cualquier URL de Amazon
function addAffiliateTag(url) {
  try {
    if (!url) return url;
    if (!url.startsWith('http')) url = 'https://www.amazon.es' + url;
    const u = new URL(url);
    u.searchParams.set('tag', OUR_TAG);
    u.searchParams.set('linkCode', 'ur2');
    // Clean up tracking params but keep tag
    ['ref', 'ref_', 'pf_rd_p', 'pf_rd_r', 'sr'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch { return url; }
}

// Extrae ASIN de una URL de Amazon
function extractAsin(url) {
  const match = url?.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return match ? match[1] : null;
}

// Detecta categoría por título/keywords
function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (/(tv|televisor|monitor|tablet|laptop|portátil|auricular|altavoz|smartphone|móvil|cámara|teclado|ratón|impresora|ssd|disco|pendrive|cable|cargador|gaming|ps5|xbox|switch)/i.test(t)) return 'tecnologia';
  if (/(ropa|camiseta|pantalón|zapatilla|jersey|chaqueta|vestido|zapato|bolso|mochila)/i.test(t)) return 'moda';
  if (/(sofá|silla|mesa|armario|colchón|lámpara|aspirador|robot|freidora|cafetera|olla|sartén|jardín|herramienta)/i.test(t)) return 'hogar';
  if (/(libro|novel|kindle|comic|manga)/i.test(t)) return 'libros';
  if (/(creme|sérum|perfume|maquillaje|champú|crema|hidratante|afeitad)/i.test(t)) return 'belleza';
  if (/(bicicleta|running|fitness|deporte|pesas|yoga|natación|raqueta|balón)/i.test(t)) return 'deportes';
  if (/(arroz|aceite|café|leche|galleta|pasta|conserva|snack|chocolate|vino|cerveza)/i.test(t)) return 'alimentacion';
  if (/(vitamina|suplemento|proteína|colágeno|omega)/i.test(t)) return 'salud';
  return 'otros';
}

// ─── FUENTE 1: Amazon Ofertas del día ────────────────────────────────────────
async function scrapeAmazonDeals() {
  const results = [];
  const urls = [
    'https://www.amazon.es/deals?ref=nav_cs_gb',
    'https://www.amazon.es/s?i=outlet&rh=p_36%3A-5000&sort=price-desc-rank',
  ];

  for (const url of urls) {
    try {
      await sleep(2000 + Math.random() * 2000);
      const res = await fetch(url, { headers: getHeaders(), timeout: 15000 });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      // Selectors for deal cards on Amazon.es
      $('[data-component-type="s-search-result"], [data-deal-id], .DealCard, [class*="deal"]').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2, [class*="title"], .a-text-bold').first().text().trim();
        const priceText = $el.find('.a-price-whole, [class*="price"] .a-offscreen, .a-price').first().text().trim();
        const originalText = $el.find('.a-text-strike, [class*="oldPrice"], .a-price.a-text-price').first().text().trim();
        const imgSrc = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
        const link = $el.find('a[href*="/dp/"]').first().attr('href') || $el.find('a').first().attr('href');
        const discPct = $el.find('[class*="discount"], [class*="percent"], .savingsPercentage').first().text().trim();

        if (!title || !link) return;
        const price = parseFloat(priceText.replace(/[€.,\s]/g, '').replace(',', '.')) || null;
        const original = parseFloat(originalText.replace(/[€.,\s]/g, '').replace(',', '.')) || null;
        const disc = discPct ? parseInt(discPct.replace(/[^0-9]/g, '')) : 
          (price && original && original > price ? Math.round((1 - price/original)*100) : null);

        if (!price || price <= 0 || disc < 15) return; // min 15% descuento

        const asin = extractAsin(link);
        if (!asin) return;

        results.push({
          title: title.slice(0, 200),
          url: addAffiliateTag(`https://www.amazon.es/dp/${asin}`),
          deal_price: price,
          original_price: original,
          discount_percent: disc,
          image_url: imgSrc || null,
          store: 'Amazon',
          category: detectCategory(title),
          source: 'amazon_deals',
          asin,
        });
      });
    } catch(e) { console.error('Error scraping', url, e.message); }
  }
  return results;
}

// ─── FUENTE 2: Chollos.es RSS (público) ──────────────────────────────────────
async function scrapeChollosRSS() {
  const results = [];
  const RSS_URLS = [
    'https://www.chollometro.com/rss/visitas/1',
    'https://www.chollos.com/feed/rss2',
  ];

  for (const rssUrl of RSS_URLS) {
    try {
      await sleep(1500);
      const res = await fetch(rssUrl, { headers: { ...getHeaders(), 'Accept': 'application/rss+xml,application/xml,text/xml,*/*' }, timeout: 10000 });
      if (!res.ok) continue;
      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });

      $('item').each((_, item) => {
        const $item = $(item);
        const title = $item.find('title').text().trim().replace(/<!\[CDATA\[|\]\]>/g, '');
        const link = $item.find('link').text().trim() || $item.find('guid').text().trim();
        const desc = $item.find('description').text().trim().replace(/<!\[CDATA\[|\]\]>/g, '');

        // Only Amazon.es links
        if (!link.includes('amazon.es') && !link.includes('amzn.to') && !link.includes('amzn.eu')) return;

        // Extract price from title/description
        const priceMatch = (title + ' ' + desc).match(/(\d+[,.]?\d*)\s*€/);
        const origMatch = (title + ' ' + desc).match(/(?:antes|original|pvp|precio anterior)[:\s]+(\d+[,.]?\d*)/i);
        const discMatch = (title + ' ' + desc).match(/[-–](\d+)%/);

        const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;
        const original = origMatch ? parseFloat(origMatch[1].replace(',', '.')) : null;
        const disc = discMatch ? parseInt(discMatch[1]) : (price && original ? Math.round((1-price/original)*100) : null);

        if (!price || price <= 0) return;
        if (disc && disc < 20) return; // min 20% desde RSS

        const asin = extractAsin(link);
        const finalUrl = asin 
          ? addAffiliateTag(`https://www.amazon.es/dp/${asin}`)
          : addAffiliateTag(link);

        // Extract image from description
        const imgMatch = desc.match(/<img[^>]+src="([^"]+)"/i);
        const imgUrl = imgMatch ? imgMatch[1] : null;

        results.push({
          title: title.slice(0, 200),
          url: finalUrl,
          deal_price: price,
          original_price: original,
          discount_percent: disc,
          image_url: imgUrl,
          store: 'Amazon',
          category: detectCategory(title),
          source: 'rss_chollos',
          asin: asin || null,
        });
      });
    } catch(e) { console.error('RSS error', rssUrl, e.message); }
  }
  return results;
}

// ─── VERIFICAR OFERTAS ACTIVAS — Detecta cuando acaba el chollo ──────────────
async function verifyActiveBotDeals(supabase, botUserId) {
  console.log('🔍 Verificando ofertas activas del bot...');
  try {
    // Obtener todos los chollos activos del bot
    const { data: activeDeals } = await supabase
      .from('deals')
      .select('id, title, url, deal_price, original_price, discount_percent, asin')
      .eq('reported_by', botUserId)
      .eq('is_active', 1)
      .not('url', 'is', null);

    if (!activeDeals?.length) { console.log('No hay chollos activos del bot'); return 0; }
    console.log(`Verificando ${activeDeals.length} chollos activos...`);

    let expired = 0;
    for (const deal of activeDeals) {
      try {
        await sleep(2000 + Math.random() * 2000);
        // Extraer ASIN directamente de la URL (columna asin no existe en DB)
        const asin = extractAsin(deal.url);
        if (!asin) continue;

        // Verificar precio actual en Amazon España (también obtiene imagen y título)
        const product = await checkAmazonProduct(asin);
        if (!product || product.price === null) continue; // error de red, no actuar
        const currentPrice = product.price;

        const originalPrice = deal.original_price || deal.deal_price * 1.3;
        const stillOnSale = currentPrice <= deal.deal_price * 1.05; // tolerancia 5%
        const priceTooHigh = currentPrice >= originalPrice * 0.95; // precio casi normal

        if (!stillOnSale || priceTooHigh) {
          await supabase.from('deals').update({ is_active: 0 }).eq('id', deal.id);
          console.log(`❌ Expirado: "${deal.title.slice(0,50)}" — ${deal.deal_price}€ → ${currentPrice}€`);
          expired++;
        } else {
          // Actualizar imagen si no la tenía
          const updates = {};
          if (!deal.image_url && product.image_url) updates.image_url = product.image_url;
          if (Object.keys(updates).length > 0) {
            await supabase.from('deals').update(updates).eq('id', deal.id);
            console.log(`📷 Imagen añadida a: "${deal.title.slice(0,40)}"`);
          } else {
            console.log(`✅ Activo: "${deal.title.slice(0,40)}" — ${currentPrice}€`);
          }
        }
      } catch(e) { console.error('Error verificando deal', deal.id, e.message); }
    }
    console.log(`Verificación completada: ${expired} chollos expirados`);
    return expired;
  } catch(e) { console.error('verifyActiveBotDeals error:', e.message); return 0; }
}

// Comprueba el precio actual de un ASIN en Amazon.es
// Returns { price, image_url, title } — or null on error
async function checkAmazonProduct(asin) {
  try {
    const url = `https://www.amazon.es/dp/${asin}`;
    await sleep(1000);
    const res = await fetch(url, { headers: getHeaders(), timeout: 10000 });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // Extract price
    const priceSelectors = [
      '.a-price.aok-align-center .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '.a-price-whole',
      '#corePrice_feature_div .a-price .a-offscreen',
      '.priceToPay .a-offscreen',
    ];
    let price = null;
    for (const sel of priceSelectors) {
      const priceText = $(sel).first().text().trim().replace(/[€\s]/g, '').replace(',', '.');
      const p = parseFloat(priceText);
      if (p > 0 && p < 99999) { price = p; break; }
    }

    // Extract main image
    const image_url =
      $('#landingImage').attr('src') ||
      $('#imgTagWrapperId img').attr('src') ||
      $('#main-image-container img').attr('src') ||
      $('img#imgBlkFront').attr('src') ||
      null;

    // Extract title
    const title = $('#productTitle').text().trim().slice(0, 200) || null;

    // Out of stock = expire
    const outOfStock = html.includes('actualmente no disponible') ||
      html.includes('not available') || html.includes('temporalmente sin stock');
    if (outOfStock) return { price: 999999, image_url, title };

    return { price, image_url, title };
  } catch(_) { return null; }
}

// Legacy wrapper — returns just price
async function checkAmazonCurrentPrice(asin) {
  const result = await checkAmazonProduct(asin);
  return result?.price ?? null;
}

// ─── FUENTE 3: Amazon Outlet España ──────────────────────────────────────────
async function scrapeAmazonOutlet() {
  const results = [];
  const pages = [
    'https://www.amazon.es/s?i=outlet&bbn=599364031&rh=p_36%3A-8000&sort=date-desc-rank',
    'https://www.amazon.es/s?k=ofertas+del+dia&i=aps&rh=p_36%3A-10000',
  ];

  for (const url of pages) {
    try {
      await sleep(3000 + Math.random() * 2000);
      const res = await fetch(url, { headers: getHeaders(), timeout: 15000 });
      if (!res.ok) { console.log('Outlet fetch failed:', res.status); continue; }
      const html = await res.text();
      const $ = cheerio.load(html);

      $('[data-component-type="s-search-result"]').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2 span, h2 a span').first().text().trim();
        const priceWhole = $el.find('.a-price-whole').first().text().replace(/[.,\s]/g, '');
        const priceFrac = $el.find('.a-price-fraction').first().text().replace(/[.,\s]/g, '') || '00';
        const strikePrice = $el.find('.a-text-strike .a-offscreen, .a-price.a-text-price .a-offscreen').first().text();
        const link = $el.find('a.a-link-normal[href*="/dp/"]').first().attr('href');
        const imgSrc = $el.find('img.s-image').first().attr('src');
        const badge = $el.find('.a-badge-text, [class*="badge"]').first().text().trim();

        if (!title || !link || !priceWhole) return;
        const price = parseFloat(`${priceWhole}.${priceFrac}`);
        const original = strikePrice ? parseFloat(strikePrice.replace(/[€\s]/g, '').replace(',', '.')) : null;
        const disc = original && original > price ? Math.round((1 - price/original) * 100) : 
          (badge.includes('%') ? parseInt(badge.replace(/[^0-9]/g,'')) : null);

        if (!price || price <= 0) return;
        if (disc && disc < 20) return;

        const asin = extractAsin(link);
        if (!asin) return;

        results.push({
          title: title.slice(0, 200),
          url: addAffiliateTag(`https://www.amazon.es/dp/${asin}`),
          deal_price: price,
          original_price: original,
          discount_percent: disc,
          image_url: imgSrc || null,
          store: 'Amazon',
          category: detectCategory(title),
          source: 'amazon_outlet',
          asin,
        });
      });
    } catch(e) { console.error('Outlet error:', e.message); }
  }
  return results;
}

// ─── FUENTE 4: ASINs curados — siempre populares en España ──────────────────
// Productos con alta rotación y ofertas frecuentes en Amazon.es
const CURATED_ASINS = [
  // Tech
  'B09B8RVKJ8', // Echo Dot 5
  'B0BNS9C1GH', // Fire TV Stick 4K Max
  'B09TMF6742', // Kindle Paperwhite 16GB
  'B0CHX3QXNR', // Echo Show 8
  'B09JSPN9X8', // Fire TV Stick 4K
  // Hogar
  'B07D3LHKNS', // Instant Pot Duo
  'B09P45WNMB', // Oral-B iO Series 6
  'B09P2SCZJQ', // Roomba j7+
  // Salud
  'B0006VDVMC', // Solgar VM-75
  'B07CTHFQGQ', // Omega-3 Solgar
  // Gaming/Libros
  'B09X7FXHVJ', // Amazon Basics ratón
  'B07ZWJ3KBG', // Audible 3 meses
];

async function scrapeCuratedAsins() {
  const results = [];
  for (const asin of CURATED_ASINS) {
    try {
      await sleep(1500 + Math.random() * 1000);
      // Single fetch for price + image + title
      const product = await checkAmazonProduct(asin);
      if (!product || !product.price || product.price <= 0 || product.price >= 999999) continue;

      const { price, image_url: imgSrc, title: rawTitle } = product;
      const url = `https://www.amazon.es/dp/${asin}`;

      // Get original/discount if not in product
      const res = await fetch(url, { headers: getHeaders(), timeout: 12000 }).catch(() => null);
      let original = null, disc = null;
      if (res?.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        const strikeEl = $('.a-text-price .a-offscreen').first().text().replace(/[€\s]/g,'').replace(',','.');
        original = parseFloat(strikeEl) || null;
        disc = original && original > price ? Math.round((1 - price/original) * 100) : null;
      }
      if (disc && disc < 15) continue;

      const title = rawTitle || `Oferta Amazon ${asin}`;

      results.push({
        title: title.slice(0, 200),
        url: addAffiliateTag(url),
        deal_price: price,
        original_price: original,
        discount_percent: disc,
        image_url: imgSrc || null,
        store: 'Amazon',
        category: detectCategory(title),
        source: 'curated',
        asin,
      });
    } catch(_) { /* skip */ }
  }
  return results;
}

// ─── MAIN: Run all scrapers & save to DB ─────────────────────────────────────
async function runAmazonScraper(supabase, botUserId) {
  console.log('🤖 Amazon scraper starting...');
  const all = [];

  // Run all scrapers
  const [deals, rss, outlet, curated] = await Promise.allSettled([
    scrapeAmazonDeals(),
    scrapeChollosRSS(),
    scrapeAmazonOutlet(),
    scrapeCuratedAsins(),
  ]);

  if (deals.status === 'fulfilled') all.push(...deals.value);
  if (rss.status === 'fulfilled') all.push(...rss.value);
  if (outlet.status === 'fulfilled') all.push(...outlet.value);
  if (curated.status === 'fulfilled') all.push(...curated.value);

  console.log(`Found ${all.length} potential deals from all sources`);

  // Deduplicate by ASIN/URL and filter
  const seen = new Set();
  const unique = all.filter(d => {
    const key = d.asin || d.url.split('?')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return d.deal_price > 0 && d.deal_price < 5000; // sanity check
  });

  console.log(`${unique.length} unique deals after dedup`);

  let saved = 0;
  for (const deal of unique) {
    try {
      // Check if already in DB (by ASIN or URL)
      let existing = null;
      if (deal.asin) {
        const { data } = await supabase.from('deals')
          .select('id, image_url').ilike('url', `%${deal.asin}%`).eq('is_active', 1).limit(1);
        existing = data?.[0];
      }
      if (existing) {
        // Update image if we now have one and it was missing
        if (deal.image_url && existing.id) {
          const { data: ex } = await supabase.from('deals').select('image_url').eq('id', existing.id).single().catch(() => ({ data: null }));
          if (ex && !ex.image_url) {
            await supabase.from('deals').update({ image_url: deal.image_url }).eq('id', existing.id);
            console.log(`📷 Imagen actualizada para deal id:${existing.id}`);
          }
        }
        continue; // skip duplicate insert
      }

      // Insert deal with bot user
      const expires = new Date(Date.now() + 7 * 24 * 3600000).toISOString(); // 7 días
      await supabase.from('deals').insert({
        title: deal.title,
        url: deal.url,
        deal_price: deal.deal_price,
        original_price: deal.original_price || null,
        discount_percent: deal.discount_percent || null,
        image_url: deal.image_url || null,
        store: deal.store,
        category: deal.category,
        reported_by: botUserId,
        is_active: 1,
        expires_at: expires,
        hot_score: 0,
        votes_up: 0,
        votes_down: 0,
      });
      saved++;
      await sleep(200); // Rate limit DB writes
    } catch(e) { console.error('DB insert error:', e.message); }
  }

  console.log(`✅ Amazon scraper done: ${saved} new deals saved`);
  return { found: all.length, unique: unique.length, saved };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { runAmazonScraper, verifyActiveBotDeals, addAffiliateTag };
