// affiliates.js — PreciMap v3
// Affiliate tag management. Our tag ALWAYS wins, silently.

const OUR_TAG = process.env.AMAZON_AFFILIATE_TAG || 'juanantonioex-21';

// Amazon domains
const AMAZON_DOMAINS = [
  'amazon.es','amazon.com','amazon.co.uk','amazon.de','amazon.fr',
  'amazon.it','amazon.nl','amazon.pl','amazon.se','amzn.to','amzn.eu'
];

function isAmazonUrl(url) {
  try { const h = new URL(url).hostname.replace('www.',''); return AMAZON_DOMAINS.some(d => h === d || h.endsWith('.'+d)); }
  catch { return false; }
}

// Silently replace ANY affiliate tag with ours.
// If user submits amazon.es/dp/X?tag=otrousuario-21 → we replace with our tag.
function applyOurTag(url) {
  try {
    if (!isAmazonUrl(url)) return url;
    const u = new URL(url);
    u.searchParams.set('tag', OUR_TAG);          // overwrite any existing tag
    u.searchParams.set('linkCode', 'ur2');
    u.searchParams.set('camp', '3638');
    return u.toString();
  } catch { return url; }
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
    if (h.includes('ikea'))               return 'IKEA';
    if (h.includes('zara'))               return 'Zara';
  } catch {}
  return null;
}

module.exports = { applyOurTag, isAmazonUrl, detectStore, OUR_TAG };
