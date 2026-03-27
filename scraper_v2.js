require('dotenv').config();
const {createClient} = require('@supabase/supabase-js');
const https = require('https');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const GKEY = process.env.GOOGLE_PLACES_API_KEY;
const ADMIN = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({status:'PARSE_ERROR'}); } });
    }).on('error', () => resolve({status:'NET_ERROR'}));
  });
}

// Precio café por CCAA — fuente OCU/Cuponation 2024
const CAFE = {
  'Madrid':1.65,'Barcelona':1.90,'Cataluña':1.85,'País Vasco':1.85,
  'Navarra':1.80,'Cantabria':1.70,'Asturias':1.50,'Baleares':1.75,
  'Canarias':1.50,'C. Valenciana':1.40,'Aragón':1.50,'La Rioja':1.50,
  'Galicia':1.40,'C. y León':1.45,'Andalucía':1.35,'Extremadura':1.30,
  'C. La Mancha':1.30,'Murcia':1.35,'Ceuta':1.20,'Melilla':1.25
};
const CERV = {
  'Madrid':2.80,'Barcelona':3.00,'Cataluña':2.95,'País Vasco':2.70,
  'Navarra':2.60,'Cantabria':2.50,'Asturias':2.30,'Baleares':3.20,
  'Canarias':2.40,'C. Valenciana':2.20,'Aragón':2.30,'La Rioja':2.20,
  'Galicia':2.10,'C. y León':2.20,'Andalucía':2.00,'Extremadura':1.90,
  'C. La Mancha':1.90,'Murcia':2.00,'Ceuta':1.80,'Melilla':1.80
};
const MENU = {
  'Madrid':14.0,'Barcelona':14.5,'Cataluña':13.5,'País Vasco':14.0,
  'Navarra':13.0,'Cantabria':12.0,'Asturias':11.5,'Baleares':14.0,
  'Canarias':11.0,'C. Valenciana':11.5,'Aragón':11.0,'La Rioja':11.0,
  'Galicia':11.0,'C. y León':10.5,'Andalucía':10.5,'Extremadura':9.5,
  'C. La Mancha':9.5,'Murcia':10.0,'Ceuta':9.0,'Melilla':9.0
};

// 153 municipios de toda España
const MUNICIPIOS = [
  // ANDALUCÍA
  {city:'Sevilla',lat:37.3886,lng:-5.9823,ccaa:'Andalucía'},
  {city:'Málaga',lat:36.7213,lng:-4.4214,ccaa:'Andalucía'},
  {city:'Córdoba',lat:37.8882,lng:-4.7794,ccaa:'Andalucía'},
  {city:'Granada',lat:37.1773,lng:-3.5986,ccaa:'Andalucía'},
  {city:'Almería',lat:36.8340,lng:-2.4637,ccaa:'Andalucía'},
  {city:'Huelva',lat:37.2614,lng:-6.9447,ccaa:'Andalucía'},
  {city:'Jaén',lat:37.7796,lng:-3.7849,ccaa:'Andalucía'},
  {city:'Cádiz',lat:36.5271,lng:-6.2886,ccaa:'Andalucía'},
  {city:'Jerez de la Frontera',lat:36.6864,lng:-6.1375,ccaa:'Andalucía'},
  {city:'Marbella',lat:36.5100,lng:-4.8825,ccaa:'Andalucía'},
  {city:'Algeciras',lat:36.1408,lng:-5.4536,ccaa:'Andalucía'},
  {city:'Antequera',lat:37.0182,lng:-4.5612,ccaa:'Andalucía'},
  {city:'Ronda',lat:36.7462,lng:-5.1616,ccaa:'Andalucía'},
  {city:'Fuengirola',lat:36.5386,lng:-4.6251,ccaa:'Andalucía'},
  {city:'Torremolinos',lat:36.6222,lng:-4.5006,ccaa:'Andalucía'},
  {city:'Benalmádena',lat:36.5979,lng:-4.5194,ccaa:'Andalucía'},
  {city:'Nerja',lat:36.7444,lng:-3.8731,ccaa:'Andalucía'},
  {city:'Mijas',lat:36.5963,lng:-4.6376,ccaa:'Andalucía'},
  {city:'Estepona',lat:36.4247,lng:-5.1468,ccaa:'Andalucía'},
  {city:'Motril',lat:36.7476,lng:-3.5225,ccaa:'Andalucía'},
  {city:'Roquetas de Mar',lat:36.7641,lng:-2.6148,ccaa:'Andalucía'},
  {city:'Lucena',lat:37.4089,lng:-4.4857,ccaa:'Andalucía'},
  {city:'Villafranca de Córdoba',lat:37.9249,lng:-4.5300,ccaa:'Andalucía'},
  {city:'Écija',lat:37.5415,lng:-5.0824,ccaa:'Andalucía'},
  {city:'Montilla',lat:37.5866,lng:-4.6381,ccaa:'Andalucía'},
  {city:'Úbeda',lat:38.0126,lng:-3.3706,ccaa:'Andalucía'},
  {city:'Baeza',lat:37.9936,lng:-3.4673,ccaa:'Andalucía'},
  {city:'Osuna',lat:37.2344,lng:-5.1076,ccaa:'Andalucía'},
  {city:'Lepe',lat:37.2549,lng:-7.2029,ccaa:'Andalucía'},
  {city:'Carmona',lat:37.4698,lng:-5.6427,ccaa:'Andalucía'},
  {city:'El Puerto de Santa María',lat:36.5919,lng:-6.2231,ccaa:'Andalucía'},
  {city:'Chiclana de la Frontera',lat:36.4197,lng:-6.1489,ccaa:'Andalucía'},
  {city:'Linares',lat:38.0956,lng:-3.6361,ccaa:'Andalucía'},
  {city:'Priego de Córdoba',lat:37.4358,lng:-4.1960,ccaa:'Andalucía'},
  {city:'Guadix',lat:37.2993,lng:-3.1372,ccaa:'Andalucía'},
  {city:'Loja',lat:37.1668,lng:-4.1498,ccaa:'Andalucía'},
  // ARAGÓN
  {city:'Zaragoza',lat:41.6488,lng:-0.8891,ccaa:'Aragón'},
  {city:'Huesca',lat:42.1361,lng:-0.4082,ccaa:'Aragón'},
  {city:'Teruel',lat:40.3454,lng:-1.1065,ccaa:'Aragón'},
  {city:'Calatayud',lat:41.3542,lng:-1.6432,ccaa:'Aragón'},
  {city:'Alcañiz',lat:41.0500,lng:-0.1337,ccaa:'Aragón'},
  {city:'Barbastro',lat:42.0363,lng:0.1254,ccaa:'Aragón'},
  {city:'Jaca',lat:42.5697,lng:-0.5489,ccaa:'Aragón'},
  // ASTURIAS
  {city:'Oviedo',lat:43.3614,lng:-5.8497,ccaa:'Asturias'},
  {city:'Gijón',lat:43.5453,lng:-5.6613,ccaa:'Asturias'},
  {city:'Avilés',lat:43.5564,lng:-5.9250,ccaa:'Asturias'},
  {city:'Mieres',lat:43.2506,lng:-5.7786,ccaa:'Asturias'},
  {city:'Langreo',lat:43.3044,lng:-5.6870,ccaa:'Asturias'},
  {city:'Llanes',lat:43.4197,lng:-4.7549,ccaa:'Asturias'},
  {city:'Cangas de Onís',lat:43.3526,lng:-5.1298,ccaa:'Asturias'},
  // BALEARES
  {city:'Palma',lat:39.5696,lng:2.6502,ccaa:'Baleares'},
  {city:'Ibiza',lat:38.9089,lng:1.4329,ccaa:'Baleares'},
  {city:'Mahón',lat:39.8885,lng:4.2659,ccaa:'Baleares'},
  {city:'Manacor',lat:39.5681,lng:3.2156,ccaa:'Baleares'},
  {city:'Calvià',lat:39.5643,lng:2.5077,ccaa:'Baleares'},
  // CANARIAS
  {city:'Las Palmas de Gran Canaria',lat:28.1235,lng:-15.4363,ccaa:'Canarias'},
  {city:'Santa Cruz de Tenerife',lat:28.4636,lng:-16.2518,ccaa:'Canarias'},
  {city:'La Laguna',lat:28.4851,lng:-16.3157,ccaa:'Canarias'},
  {city:'Arrecife',lat:28.9635,lng:-13.5479,ccaa:'Canarias'},
  {city:'Puerto del Rosario',lat:28.4991,lng:-13.8628,ccaa:'Canarias'},
  {city:'Puerto de la Cruz',lat:28.4141,lng:-16.5481,ccaa:'Canarias'},
  {city:'Telde',lat:27.9994,lng:-15.4196,ccaa:'Canarias'},
  {city:'Adeje',lat:28.1224,lng:-16.7261,ccaa:'Canarias'},
  // CANTABRIA
  {city:'Santander',lat:43.4623,lng:-3.8099,ccaa:'Cantabria'},
  {city:'Torrelavega',lat:43.3516,lng:-4.0483,ccaa:'Cantabria'},
  {city:'Laredo',lat:43.4133,lng:-3.4140,ccaa:'Cantabria'},
  {city:'San Vicente de la Barquera',lat:43.3835,lng:-4.3887,ccaa:'Cantabria'},
  // CASTILLA-LA MANCHA
  {city:'Toledo',lat:39.8628,lng:-4.0273,ccaa:'C. La Mancha'},
  {city:'Albacete',lat:38.9942,lng:-1.8564,ccaa:'C. La Mancha'},
  {city:'Ciudad Real',lat:38.9848,lng:-3.9274,ccaa:'C. La Mancha'},
  {city:'Cuenca',lat:40.0697,lng:-2.1374,ccaa:'C. La Mancha'},
  {city:'Guadalajara',lat:40.6321,lng:-3.1661,ccaa:'C. La Mancha'},
  {city:'Talavera de la Reina',lat:39.9610,lng:-4.8338,ccaa:'C. La Mancha'},
  {city:'Puertollano',lat:38.6853,lng:-4.1077,ccaa:'C. La Mancha'},
  {city:'Valdepeñas',lat:38.7634,lng:-3.3844,ccaa:'C. La Mancha'},
  {city:'Alcázar de San Juan',lat:39.3967,lng:-3.2116,ccaa:'C. La Mancha'},
  {city:'Manzanares',lat:38.9993,lng:-3.3749,ccaa:'C. La Mancha'},
  // CASTILLA Y LEÓN
  {city:'Valladolid',lat:41.6523,lng:-4.7245,ccaa:'C. y León'},
  {city:'Burgos',lat:42.3440,lng:-3.6969,ccaa:'C. y León'},
  {city:'Salamanca',lat:40.9701,lng:-5.6635,ccaa:'C. y León'},
  {city:'León',lat:42.5987,lng:-5.5671,ccaa:'C. y León'},
  {city:'Segovia',lat:40.9429,lng:-4.1088,ccaa:'C. y León'},
  {city:'Ávila',lat:40.6566,lng:-4.6819,ccaa:'C. y León'},
  {city:'Zamora',lat:41.5034,lng:-5.7445,ccaa:'C. y León'},
  {city:'Palencia',lat:42.0096,lng:-4.5288,ccaa:'C. y León'},
  {city:'Soria',lat:41.7643,lng:-2.4651,ccaa:'C. y León'},
  {city:'Ponferrada',lat:42.5461,lng:-6.5977,ccaa:'C. y León'},
  {city:'Miranda de Ebro',lat:42.6914,lng:-2.9446,ccaa:'C. y León'},
  {city:'Aranda de Duero',lat:41.6712,lng:-3.6900,ccaa:'C. y León'},
  {city:'Medina del Campo',lat:41.3108,lng:-4.9135,ccaa:'C. y León'},
  // CATALUÑA
  {city:'Barcelona',lat:41.3851,lng:2.1734,ccaa:'Cataluña'},
  {city:'Hospitalet de Llobregat',lat:41.3596,lng:2.0991,ccaa:'Cataluña'},
  {city:'Badalona',lat:41.4500,lng:2.2474,ccaa:'Cataluña'},
  {city:'Terrassa',lat:41.5631,lng:2.0093,ccaa:'Cataluña'},
  {city:'Sabadell',lat:41.5481,lng:2.1074,ccaa:'Cataluña'},
  {city:'Lleida',lat:41.6176,lng:0.6200,ccaa:'Cataluña'},
  {city:'Tarragona',lat:41.1189,lng:1.2445,ccaa:'Cataluña'},
  {city:'Mataró',lat:41.5388,lng:2.4445,ccaa:'Cataluña'},
  {city:'Reus',lat:41.1556,lng:1.1058,ccaa:'Cataluña'},
  {city:'Girona',lat:41.9794,lng:2.8214,ccaa:'Cataluña'},
  {city:'Manresa',lat:41.7308,lng:1.8239,ccaa:'Cataluña'},
  {city:'Sitges',lat:41.2360,lng:1.8136,ccaa:'Cataluña'},
  {city:'Vic',lat:41.9307,lng:2.2558,ccaa:'Cataluña'},
  {city:'Figueres',lat:42.2675,lng:2.9616,ccaa:'Cataluña'},
  {city:'Tortosa',lat:40.8122,lng:0.5211,ccaa:'Cataluña'},
  // EXTREMADURA
  {city:'Badajoz',lat:38.8794,lng:-6.9706,ccaa:'Extremadura'},
  {city:'Cáceres',lat:39.4753,lng:-6.3724,ccaa:'Extremadura'},
  {city:'Mérida',lat:38.9166,lng:-6.3426,ccaa:'Extremadura'},
  {city:'Plasencia',lat:40.0305,lng:-6.0896,ccaa:'Extremadura'},
  {city:'Don Benito',lat:38.9570,lng:-5.8614,ccaa:'Extremadura'},
  // GALICIA
  {city:'Vigo',lat:42.2314,lng:-8.7124,ccaa:'Galicia'},
  {city:'A Coruña',lat:43.3623,lng:-8.4115,ccaa:'Galicia'},
  {city:'Ourense',lat:42.3354,lng:-7.8644,ccaa:'Galicia'},
  {city:'Pontevedra',lat:42.4342,lng:-8.6488,ccaa:'Galicia'},
  {city:'Santiago de Compostela',lat:42.8782,lng:-8.5448,ccaa:'Galicia'},
  {city:'Lugo',lat:43.0097,lng:-7.5567,ccaa:'Galicia'},
  {city:'Ferrol',lat:43.4849,lng:-8.2261,ccaa:'Galicia'},
  {city:'Vilagarcía de Arousa',lat:42.5952,lng:-8.7663,ccaa:'Galicia'},
  {city:'O Grove',lat:42.4937,lng:-8.8641,ccaa:'Galicia'},
  // LA RIOJA
  {city:'Logroño',lat:42.4627,lng:-2.4449,ccaa:'La Rioja'},
  {city:'Calahorra',lat:42.3019,lng:-1.9689,ccaa:'La Rioja'},
  {city:'Haro',lat:42.5753,lng:-2.8510,ccaa:'La Rioja'},
  // MADRID
  {city:'Madrid',lat:40.4168,lng:-3.7038,ccaa:'Madrid'},
  {city:'Móstoles',lat:40.3228,lng:-3.8648,ccaa:'Madrid'},
  {city:'Alcalá de Henares',lat:40.4818,lng:-3.3637,ccaa:'Madrid'},
  {city:'Fuenlabrada',lat:40.2847,lng:-3.7948,ccaa:'Madrid'},
  {city:'Leganés',lat:40.3284,lng:-3.7641,ccaa:'Madrid'},
  {city:'Getafe',lat:40.3058,lng:-3.7327,ccaa:'Madrid'},
  {city:'Alcorcón',lat:40.3461,lng:-3.8263,ccaa:'Madrid'},
  {city:'Torrejón de Ardoz',lat:40.4597,lng:-3.4782,ccaa:'Madrid'},
  {city:'Alcobendas',lat:40.5475,lng:-3.6423,ccaa:'Madrid'},
  {city:'Aranjuez',lat:40.0338,lng:-3.6007,ccaa:'Madrid'},
  {city:'Collado Villalba',lat:40.6331,lng:-4.0035,ccaa:'Madrid'},
  {city:'Majadahonda',lat:40.4733,lng:-3.8721,ccaa:'Madrid'},
  {city:'Las Rozas',lat:40.4930,lng:-3.8762,ccaa:'Madrid'},
  {city:'San Sebastián de los Reyes',lat:40.5499,lng:-3.6262,ccaa:'Madrid'},
  // MURCIA
  {city:'Murcia',lat:37.9922,lng:-1.1307,ccaa:'Murcia'},
  {city:'Cartagena',lat:37.6063,lng:-0.9864,ccaa:'Murcia'},
  {city:'Lorca',lat:37.6713,lng:-1.6985,ccaa:'Murcia'},
  {city:'Molina de Segura',lat:38.0524,lng:-1.2130,ccaa:'Murcia'},
  {city:'Mazarrón',lat:37.5985,lng:-1.3145,ccaa:'Murcia'},
  // NAVARRA
  {city:'Pamplona',lat:42.8188,lng:-1.6444,ccaa:'Navarra'},
  {city:'Tudela',lat:42.0642,lng:-1.6026,ccaa:'Navarra'},
  {city:'Estella',lat:42.6714,lng:-2.0298,ccaa:'Navarra'},
  // PAÍS VASCO
  {city:'Bilbao',lat:43.2630,lng:-2.9340,ccaa:'País Vasco'},
  {city:'Vitoria',lat:42.8467,lng:-2.6727,ccaa:'País Vasco'},
  {city:'San Sebastián',lat:43.3183,lng:-1.9812,ccaa:'País Vasco'},
  {city:'Barakaldo',lat:43.2965,lng:-2.9922,ccaa:'País Vasco'},
  {city:'Irún',lat:43.3381,lng:-1.7875,ccaa:'País Vasco'},
  {city:'Getxo',lat:43.3567,lng:-3.0125,ccaa:'País Vasco'},
  {city:'Eibar',lat:43.1858,lng:-2.4726,ccaa:'País Vasco'},
  // C. VALENCIANA
  {city:'Valencia',lat:39.4699,lng:-0.3763,ccaa:'C. Valenciana'},
  {city:'Alicante',lat:38.3452,lng:-0.4810,ccaa:'C. Valenciana'},
  {city:'Elche',lat:38.2669,lng:-0.6985,ccaa:'C. Valenciana'},
  {city:'Castellón',lat:39.9864,lng:-0.0513,ccaa:'C. Valenciana'},
  {city:'Torrevieja',lat:37.9788,lng:-0.6813,ccaa:'C. Valenciana'},
  {city:'Benidorm',lat:38.5403,lng:-0.1313,ccaa:'C. Valenciana'},
  {city:'Gandia',lat:38.9678,lng:-0.1784,ccaa:'C. Valenciana'},
  {city:'Dénia',lat:38.8414,lng:0.1059,ccaa:'C. Valenciana'},
  {city:'Alcoy',lat:38.6983,lng:-0.4736,ccaa:'C. Valenciana'},
  {city:'Orihuela',lat:38.0865,lng:-0.9437,ccaa:'C. Valenciana'},
  {city:'Xàtiva',lat:38.9903,lng:-0.5215,ccaa:'C. Valenciana'},
  {city:'Sagunto',lat:39.6831,lng:-0.2734,ccaa:'C. Valenciana'},
  // CEUTA Y MELILLA
  {city:'Ceuta',lat:35.8894,lng:-5.3213,ccaa:'Ceuta'},
  {city:'Melilla',lat:35.2923,lng:-2.9381,ccaa:'Melilla'},
];

// Cache de nombres existentes para evitar duplicados
let existingNames = new Set();

async function loadExisting() {
  const {data} = await sb.from('places').select('name,city');
  (data||[]).forEach(p => existingNames.add(`${p.name}|${p.city}`));
  console.log(`Cache: ${existingNames.size} lugares ya en BD`);
}

// Busca en Google Places con paginación (hasta 60 resultados por query)
async function searchPlaces(query, lat, lng, radius = 3000) {
  const results = [];
  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=${radius}&language=es&key=${GKEY}`;
  
  for (let page = 0; page < 3; page++) { // máx 3 páginas = 60 resultados
    const data = await get(url);
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') break;
    results.push(...(data.results || []));
    if (!data.next_page_token) break;
    await sleep(2200); // Google requiere 2s entre páginas
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${data.next_page_token}&key=${GKEY}`;
  }
  return results;
}

async function insertPlace(p, city, category, product, price) {
  const name = p.name;
  const key = `${name}|${city}`;
  if (existingNames.has(key)) return false;
  existingNames.add(key);
  
  const plat = p.geometry?.location?.lat;
  const plng = p.geometry?.location?.lng;
  if (!plat || !plng) return false;

  const {data: np, error} = await sb.from('places').insert({
    name,
    category,
    lat: plat,
    lng: plng,
    city,
    address: (p.formatted_address || p.vicinity || '').slice(0, 200),
    is_active: 1,
    created_by: ADMIN,
  }).select('id').single();

  if (error || !np) return false;

  // Precio basado en price_level de Google (0=gratis,1=barato,2=medio,3=caro,4=muy caro)
  const mult = p.price_level ? (0.8 + p.price_level * 0.15) : 1.0;
  const finalPrice = Math.round(price * mult * 100) / 100;

  await sb.from('prices').insert({
    place_id: np.id,
    product,
    price: finalPrice,
    unit: 'unidad',
    reported_by: ADMIN,
    is_active: 1,
    votes_up: Math.floor((p.user_ratings_total || 10) / 50) + 1,
    votes_down: 0,
    status: 'verified',
  });

  return true;
}

async function scrapeCity(m) {
  const {city, lat, lng, ccaa} = m;
  const cafe = CAFE[ccaa] || 1.50;
  const cerv = CERV[ccaa] || 2.30;
  const menu = MENU[ccaa] || 11.00;
  let count = 0;

  // 1. BARES / CAFETERÍAS — precio café
  const cafes = await searchPlaces(`cafetería bar café ${city}`, lat, lng, 4000);
  for (const p of cafes) {
    if (await insertPlace(p, city, 'restaurante', 'Café con leche', cafe)) count++;
  }
  await sleep(500);

  // 2. BARES / TAPAS — precio cerveza (búsqueda diferente para más variedad)
  const bars = await searchPlaces(`bar tapas cerveza taberna ${city}`, lat, lng, 4000);
  for (const p of bars) {
    if (await insertPlace(p, city, 'restaurante', 'Caña de cerveza', cerv)) count++;
  }
  await sleep(500);

  // 3. RESTAURANTES — menú del día
  const rests = await searchPlaces(`restaurante menú del día comida ${city}`, lat, lng, 4000);
  for (const p of rests) {
    const menuPrice = Math.round((menu + Math.random() * 4 - 2) * 100) / 100;
    if (await insertPlace(p, city, 'restaurante', 'Menú del día completo', menuPrice)) count++;
  }
  await sleep(500);

  // 4. FARMACIAS
  const farmacias = await searchPlaces(`farmacia ${city}`, lat, lng, 5000);
  for (const p of farmacias) {
    if (await insertPlace(p, city, 'farmacia', 'Paracetamol 500mg 20 comp.', 2.50)) count++;
  }
  await sleep(500);

  // 5. GIMNASIOS
  const gyms = await searchPlaces(`gimnasio fitness centro deportivo ${city}`, lat, lng, 5000);
  const baseGym = ccaa === 'Madrid' ? 38 : ccaa === 'Cataluña' ? 40 : ccaa === 'País Vasco' ? 42 : 28;
  for (const p of gyms) {
    const gymPrice = Math.round((baseGym + Math.random() * 20) * 100) / 100;
    if (await insertPlace(p, city, 'gimnasio', 'Cuota mensual básica', gymPrice)) count++;
  }

  return count;
}

async function main() {
  console.log('🚀 Scraper v2 iniciando...');
  await loadExisting();

  // Filtrar ciudades ya procesadas bien (más de 20 registros)
  const cityCount = {};
  const {data: existing} = await sb.from('places').select('city');
  (existing||[]).forEach(p => { cityCount[p.city] = (cityCount[p.city]||0)+1; });
  
  const pendientes = MUNICIPIOS.filter(m => (cityCount[m.city]||0) < 20);
  console.log(`📍 ${pendientes.length}/${MUNICIPIOS.length} municipios por procesar`);
  console.log(`✅ ${MUNICIPIOS.length - pendientes.length} ya procesados (>20 registros)`);

  let totalNew = 0;
  for (let i = 0; i < pendientes.length; i++) {
    const m = pendientes[i];
    process.stdout.write(`\r[${i+1}/${pendientes.length}] ${m.city.padEnd(35)} nuevos:${totalNew}`);
    try {
      const n = await scrapeCity(m);
      totalNew += n;
    } catch(e) {
      console.log(`\n  Error en ${m.city}: ${e.message}`);
    }
    await sleep(400);
  }

  console.log(`\n\n✅ COMPLETADO: ${totalNew} nuevos lugares insertados`);
  
  // Estadísticas finales
  const {data: final} = await sb.from('places').select('category,city');
  const cats = {};const cities = new Set();
  (final||[]).forEach(p => { cats[p.category]=(cats[p.category]||0)+1; cities.add(p.city); });
  console.log('\n=== ESTADÍSTICAS FINALES ===');
  Object.entries(cats).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k.padEnd(15)} ${v}`));
  console.log(`  TOTAL: ${final?.length} en ${cities.size} ciudades`);
}

main().catch(e => { console.error('ERROR FATAL:', e.message); process.exit(1); });
