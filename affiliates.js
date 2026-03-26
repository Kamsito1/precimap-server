// affiliates.js — PreciMap v3.2
// Affiliate tag management. Our tag ALWAYS wins, silently.
// Amazon PA API v5 integration for product data

const OUR_TAG = process.env.AMAZON_AFFILIATE_TAG || 'juanantonioex-21';
const AMAZON_PA_CLIENT = process.env.AMAZON_PA_CLIENT;
const AMAZON_PA_SECRET = process.env.AMAZON_PA_SECRET;

// Amazon domains
const AMAZON_DOMAINS = [
  'amazon.es','amazon.com','amazon.co.uk','amazon.de','amazon.fr',
  'amazon.it','amazon.nl','amazon.pl','amazon.se','amzn.to','amzn.eu'
];

function isAmazonUrl(url) {
  try { const h = new URL(url).hostname.replace('www.',''); return AMAZON_DOMAINS.some(d => h === d || h.endsWith('.'+d)); }
  catch { return false; }
}

// Extract ASIN from Amazon URL
function extractAsin(url) {
  try {
    const match = url.match(/\/(?:dp|gp\/product|ASIN)\/([A-Z0-9]{10})/i);
    return match ? match[1] : null;
  } catch { return null; }
}

// Silently replace ANY affiliate tag with ours.
function applyOurTag(url) {
  try {
    if (!isAmazonUrl(url)) return url;
    const u = new URL(url);
    u.searchParams.set('tag', OUR_TAG);
    u.searchParams.set('linkCode', 'ur2');
    u.searchParams.set('camp', '3638');
    return u.toString();
  } catch { return url; }
}

// Amazon PA API v5 — Get product info by ASIN
// Uses creator credentials to fetch real price, title, image
async function getAmazonProductInfo(asin) {
  try {
    const crypto = require('crypto');
    const host = 'webservices.amazon.es';
    const region = 'eu-west-1';
    const service = 'ProductAdvertisingAPI';
    const endpoint = `https://${host}/paapi5/getitems`;

    const payload = JSON.stringify({
      ItemIds: [asin],
      Resources: [
        'Images.Primary.Medium',
        'ItemInfo.Title',
        'Offers.Listings.Price',
        'Offers.Listings.SavingBasis',
      ],
      PartnerTag: OUR_TAG,
      PartnerType: 'Associates',
      Marketplace: 'www.amazon.es',
    });

    // AWS SigV4 signing
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0,15) + 'Z';
    const dateStamp = amzDate.slice(0,8);

    const canonicalHeaders = `content-encoding:amz-1.0\ncontent-type:application/json; charset=utf-8\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems\n`;
    const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';

    const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
    const canonicalRequest = `POST\n/paapi5/getitems\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

    function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + AMAZON_PA_SECRET, dateStamp), region), service), 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authHeader = `AWS4-HMAC-SHA256 Credential=${AMAZON_PA_CLIENT}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const fetch = require('node-fetch');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-encoding': 'amz-1.0',
        'content-type': 'application/json; charset=utf-8',
        'host': host,
        'x-amz-date': amzDate,
        'x-amz-target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
        'Authorization': authHeader,
      },
      body: payload,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const item = data?.ItemsResult?.Items?.[0];
    if (!item) return null;

    return {
      asin,
      title: item.ItemInfo?.Title?.DisplayValue || null,
      image: item.Images?.Primary?.Medium?.URL || null,
      price: item.Offers?.Listings?.[0]?.Price?.Amount || null,
      originalPrice: item.Offers?.Listings?.[0]?.SavingBasis?.Amount || null,
      url: `https://www.amazon.es/dp/${asin}?tag=${OUR_TAG}`,
    };
  } catch(e) {
    console.error('Amazon PA API error:', e.message);
    return null;
  }
}

// Detect store from URL
function detectStore(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.replace('www.','');
    if (isAmazonUrl(url))                 return 'Amazon';
    if (h.includes('pccomponentes'))      return 'PcComponentes';
    if (h.includes('mediamarkt'))         return 'MediaMarkt';
    if (h.includes('elcorteingles'))      return 'El Corte Inglés';
    if (h.includes('fnac'))               return 'FNAC';
    if (h.includes('zalando'))            return 'Zalando';
    if (h.includes('booking'))            return 'Booking';
    if (h.includes('aliexpress'))         return 'AliExpress';
    if (h.includes('ebay'))               return 'eBay';
    if (h.includes('carrefour'))          return 'Carrefour';
    if (h.includes('leroy'))              return 'Leroy Merlin';
    if (h.includes('ikea'))              return 'IKEA';
    if (h.includes('zara'))               return 'Zara';
    if (h.includes('wallapop'))           return 'Wallapop';
    if (h.includes('shein'))              return 'SHEIN';
    if (h.includes('asos'))              return 'ASOS';
    if (h.includes('decathlon'))          return 'Decathlon';
    if (h.includes('ryanair'))            return 'Ryanair';
    if (h.includes('vueling'))            return 'Vueling';
  } catch {}
  return null;
}

module.exports = { applyOurTag, isAmazonUrl, extractAsin, detectStore, getAmazonProductInfo, OUR_TAG };
