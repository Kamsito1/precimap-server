// fix_images.js — Update deal images with VERIFIED working URLs
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Map ASIN -> verified working image URL (from actual Amazon.es scrape)
const VERIFIED_IMAGES = {
  'B09B8X9RGM': 'https://m.media-amazon.com/images/I/71seFofNnOL._AC_SX425_.jpg',
  'B0CJKTWTVT': 'https://m.media-amazon.com/images/I/61rGB28SHcL._AC_SX425_.jpg',
  'B0CW4HD359': 'https://m.media-amazon.com/images/I/61HPNpd+CsL._AC_SX425_.jpg',
  'B09TMF6742': 'https://m.media-amazon.com/images/I/71Unv1b-duL._AC_SX425_.jpg',
  'B0CHX3QXNR': 'https://m.media-amazon.com/images/I/41fBClHJsSL._AC_SX425_.jpg',
  'B09X7FXHVJ': 'https://m.media-amazon.com/images/I/81wwLOgkLgL._AC_SX425_.jpg',
  'B09P45WNMB': 'https://m.media-amazon.com/images/I/41dYQTGjtZL._AC_SX425_.jpg',
  'B0B469Q17H': 'https://m.media-amazon.com/images/I/51tTwQy3UpL._AC_SX425_.jpg',
  'B0CX23V2ZK': 'https://m.media-amazon.com/images/I/51bRXGfMOBL._AC_SX425_.jpg',
  'B07D3LHKNS': 'https://m.media-amazon.com/images/I/71WtwEvnVPL._AC_SX425_.jpg',
  'B07CMS5Q6P': 'https://m.media-amazon.com/images/I/61UxfXTUBPL._AC_SX425_.jpg',
  'B0C9PXF5QC': 'https://m.media-amazon.com/images/I/31vLmblqFGL._AC_SX425_.jpg',
};

async function fix() {
  const { data: deals } = await supabase.from('deals')
    .select('id, url, image_url')
    .eq('is_active', 1);

  let fixed = 0;
  for (const deal of (deals || [])) {
    // Extract ASIN from URL
    const match = deal.url?.match(/\/dp\/([A-Z0-9]{10})/i);
    if (!match) continue;
    const asin = match[1];
    const verified = VERIFIED_IMAGES[asin];
    if (!verified) continue;

    // Only update if current image is broken or different
    if (deal.image_url !== verified) {
      await supabase.from('deals').update({ image_url: verified }).eq('id', deal.id);
      console.log(`📷 Fixed #${deal.id}: ${asin} → ${verified.slice(-30)}`);
      fixed++;
    }
  }
  console.log(`\n✅ Fixed ${fixed} deal images`);
}

fix().catch(e => { console.error(e); process.exit(1); });
