// cleanup_deals.js — One-time script to fix bad bot deals
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function cleanup() {
  console.log('🧹 Cleaning up bad bot deals...');
  
  // 1. Deactivate ALL deals with broken images (SCLZZZZZZZ pattern)
  const { data: broken, error: e1 } = await supabase
    .from('deals')
    .update({ is_active: 0 })
    .ilike('image_url', '%SCLZZZZZZZ%')
    .eq('is_active', 1)
    .select('id');
  console.log(`Fixed broken images: ${broken?.length || 0} deals deactivated`);

  // 2. Deactivate deals where deal_price >= original_price (inverted)
  const { data: inverted } = await supabase
    .from('deals')
    .select('id, title, deal_price, original_price')
    .eq('is_active', 1)
    .not('original_price', 'is', null);
  
  let invertedCount = 0;
  for (const d of (inverted || [])) {
    if (d.deal_price >= d.original_price) {
      await supabase.from('deals').update({ is_active: 0 }).eq('id', d.id);
      invertedCount++;
    }
  }
  console.log(`Fixed inverted prices: ${invertedCount} deals deactivated`);

  // 3. Deactivate deals with very short titles (< 15 chars = just brand name)
  const { data: short } = await supabase
    .from('deals')
    .select('id, title')
    .eq('is_active', 1);
  
  let shortCount = 0;
  for (const d of (short || [])) {
    if ((d.title || '').length < 15) {
      await supabase.from('deals').update({ is_active: 0 }).eq('id', d.id);
      shortCount++;
    }
  }
  console.log(`Fixed short titles: ${shortCount} deals deactivated`);

  // 4. Count remaining active deals
  const { count } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', 1);
  console.log(`\n✅ Remaining active deals: ${count}`);
  
  console.log('🧹 Cleanup complete!');
}

cleanup().catch(e => { console.error(e); process.exit(1); });
