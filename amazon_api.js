// ─── AMAZON PA-API INTEGRATION ────────────────────────────────────────────────
// Requires: Access Key ID + Secret Access Key from Amazon Associates
// Get them at: affiliate-program.amazon.es → Herramientas → API de publicidad
//
// USAGE: Set env vars AMAZON_ACCESS_KEY and AMAZON_SECRET_KEY
// Affiliate tag (juanantonioex-21) is already configured in AMAZON_AFFILIATE_TAG

const crypto = require('crypto');

const AMAZON_TAG       = process.env.AMAZON_AFFILIATE_TAG || 'juanantonioex-21';
const AMAZON_ACCESS_KEY = process.env.AMAZON_ACCESS_KEY || null;
const AMAZON_SECRET_KEY = process.env.AMAZON_SECRET_KEY || null;
const AMAZON_HOST      = 'webservices.amazon.es';
const AMAZON_REGION    = 'eu-west-1';
const AMAZON_ENDPOINT  = `https://${AMAZON_HOST}/paapi5/searchitems`;

// ─── SIGN REQUEST (AWS Signature V4) ──────────────────────────────────────────
function signRequest(payload) {
  if (!AMAZON_ACCESS_KEY || !AMAZON_SECRET_KEY) return null;

  const now = new Date();
  const dateStamp  = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStamp  = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const payloadStr = JSON.stringify(payload);
  const payloadHash = crypto.createHash('sha256').update(payloadStr).digest('hex');

  const headers = {
    'content-encoding': 'amz-1.0',
    'content-type': 'application/json; charset=utf-8',
    'host': AMAZON_HOST,
    'x-amz-date': timeStamp,
    'x-amz-target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems',
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}`).join('\n') + '\n';
  const canonicalRequest = `POST\n/paapi5/searchitems\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credScope = `${dateStamp}/${AMAZON_REGION}/ProductAdvertisingAPI/aws4_request`;
  const strToSign = `AWS4-HMAC-SHA256\n${timeStamp}\n${credScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${AMAZON_SECRET_KEY}`, dateStamp), AMAZON_REGION), 'ProductAdvertisingAPI'), 'aws4_request');
  const signature = crypto.createHmac('sha256', sigKey).update(strToSign).digest('hex');

  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${AMAZON_ACCESS_KEY}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, body: payloadStr };
}

// ─── SEARCH DEALS ON AMAZON ───────────────────────────────────────────────────
async function searchAmazonDeals(keywords = 'ofertas del día', maxResults = 10) {
  if (!AMAZON_ACCESS_KEY || !AMAZON_SECRET_KEY) {
    console.log('[Amazon] API keys not configured — set AMAZON_ACCESS_KEY and AMAZON_SECRET_KEY');
    return [];
  }

  const payload = {
    Keywords: keywords,
    PartnerTag: AMAZON_TAG,
    PartnerType: 'Associates',
    Marketplace: 'www.amazon.es',
    Resources: [
      'ItemInfo.Title',
      'ItemInfo.Features',
      'Offers.Listings.Price',
      'Offers.Listings.SavingBasis',
      'Offers.Listings.Promotions',
      'Images.Primary.Large',
      'BrowseNodeInfo.BrowseNodes',
    ],
    ItemCount: maxResults,
    MinSavingPercent: 15,
    DeliveryFlags: ['FreeShipping'],
  };

  const signed = signRequest(payload);
  if (!signed) return [];

  try {
    const res = await fetch(AMAZON_ENDPOINT, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
    });
    const data = await res.json();
    if (!data.SearchResult?.Items) return [];

    return data.SearchResult.Items
      .filter(item => item.Offers?.Listings?.[0]?.Price)
      .map(item => {
        const listing = item.Offers.Listings[0];
        const price = listing.Price?.Amount;
        const original = listing.SavingBasis?.Amount;
        const discount = original && price ? Math.round((1 - price / original) * 100) : null;
        const url = `https://www.amazon.es/dp/${item.ASIN}?tag=${AMAZON_TAG}`;

        return {
          title: item.ItemInfo.Title?.DisplayValue || 'Oferta Amazon',
          deal_price: price,
          original_price: original,
          discount_percent: discount,
          url,
          image_url: item.Images?.Primary?.Large?.URL || null,
          store: 'Amazon',
          cat: 'tecnologia',
          description: `Oferta Amazon: ${discount ? `-${discount}%` : 'precio especial'}`,
          source: 'amazon_api',
          asin: item.ASIN,
        };
      });
  } catch (err) {
    console.error('[Amazon] API error:', err.message);
    return [];
  }
}

// ─── AUTO-PUBLISH DEALS TO DB ─────────────────────────────────────────────────
async function autoPublishAmazonDeals(supabase) {
  const SEARCHES = [
    'ofertas tecnología',
    'chollos amazon',
    'oferta del día amazon',
    'descuentos electrodomésticos',
  ];

  let published = 0;
  for (const query of SEARCHES) {
    const deals = await searchAmazonDeals(query, 5);
    for (const deal of deals) {
      if (!deal.discount_percent || deal.discount_percent < 15) continue;

      // Check if already in DB (by ASIN)
      const { data: existing } = await supabase
        .from('deals')
        .select('id')
        .eq('asin', deal.asin)
        .single();
      if (existing) continue;

      // Insert
      const { error } = await supabase.from('deals').insert({
        title: deal.title,
        deal_price: deal.deal_price,
        original_price: deal.original_price,
        discount_percent: deal.discount_percent,
        url: deal.url,
        image_url: deal.image_url,
        store: deal.store,
        cat: deal.cat,
        description: deal.description,
        asin: deal.asin,
        source: 'amazon_api',
        is_verified: true,
        user_id: null, // system deal
      });
      if (!error) published++;
    }
  }
  console.log(`[Amazon] Auto-published ${published} new deals`);
  return published;
}

module.exports = { searchAmazonDeals, autoPublishAmazonDeals };
