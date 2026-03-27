require('dotenv').config();
const {createClient} = require('@supabase/supabase-js');
const https = require('https');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const GKEY = process.env.GOOGLE_PLACES_API_KEY;
const ADMIN = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(10000, () => { req.destroy(); resolve({}); });
  });
}

// Precios reales por CCAA (fuente: OCU, Cuponation 2024)
const PRECIOS = {
  cafe: {
    'Madrid':1.65,'Barcelona':1.90,'Cataluña':1.85,'País Vasco':1.85,
    'Navarra':1.80,'Cantabria':1.70,'Baleares':1.75,'Canarias':1.50,
    'Asturias':1.50,'C. Valenciana':1.40,'Aragón':1.50,'La Rioja':1.50,
    'Galicia':1.40,'C. y León':1.45,'Andalucía':1.35,'Extremadura':1.30,
    'C. La Mancha':1.30,'Murcia':1.35,'Ceuta':1.20,'Melilla':1.25,
  },
  cerveza: {
    'Madrid':2.80,'Barcelona':3.00,'Cataluña':3.00,'País Vasco':2.70,
    'Navarra':2.60,'Cantabria':2.50,'Baleares':3.20,'Canarias':2.40,
    'Asturias':2.30,'C. Valenciana':2.20,'Aragón':2.30,'La Rioja':2.20,
    'Galicia':2.10,'C. y León':2.20,'Andalucía':2.00,'Extremadura':1.90,
    'C. La Mancha':1.90,'Murcia':2.00,'Ceuta':1.80,'Melilla':1.80,
  },
  menu: {
    'Madrid':13.50,'Barcelona':14.00,'Cataluña':13.50,'País Vasco':14.50,
    'Navarra':13.00,'Cantabria':12.50,'Baleares':13.00,'Canarias':11.50,
    'Asturias':11.50,'C. Valenciana':11.00,'Aragón':11.50,'La Rioja':11.50,
    'Galicia':11.00,'C. y León':11.00,'Andalucía':10.50,'Extremadura':10.00,
    'C. La Mancha':10.00,'Murcia':10.50,'Ceuta':9.50,'Melilla':9.50,
  },
};

const MUNICIPIOS = [
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
  {city:'La Línea de la Concepción',lat:36.1668,lng:-5.3494,ccaa:'Andalucía'},
  {city:'San Fernando',lat:36.4767,lng:-6.1972,ccaa:'Andalucía'},
  {city:'Linares',lat:38.0956,lng:-3.6361,ccaa:'Andalucía'},
  {city:'El Ejido',lat:36.7757,lng:-2.8114,ccaa:'Andalucía'},
  {city:'Vélez-Málaga',lat:36.7786,lng:-4.1009,ccaa:'Andalucía'},
  {city:'Dos Hermanas',lat:37.2834,lng:-5.9218,ccaa:'Andalucía'},
  {city:'Alcalá de Guadaíra',lat:37.3383,lng:-5.8396,ccaa:'Andalucía'},
  {city:'Chiclana de la Frontera',lat:36.4193,lng:-6.1451,ccaa:'Andalucía'},
  {city:'Mairena del Aljarafe',lat:37.3367,lng:-6.0650,ccaa:'Andalucía'},
  {city:'Priego de Córdoba',lat:37.4358,lng:-4.1960,ccaa:'Andalucía'},
  {city:'Cabra',lat:37.4714,lng:-4.4408,ccaa:'Andalucía'},
  {city:'Andújar',lat:38.0399,lng:-4.0506,ccaa:'Andalucía'},
  {city:'Guadix',lat:37.2984,lng:-3.1394,ccaa:'Andalucía'},
  {city:'Loja',lat:37.1685,lng:-4.1513,ccaa:'Andalucía'},
  {city:'Martos',lat:37.7217,lng:-3.9695,ccaa:'Andalucía'},
  {city:'Marbella Este',lat:36.5150,lng:-4.8300,ccaa:'Andalucía'},
  {city:'Zaragoza',lat:41.6488,lng:-0.8891,ccaa:'Aragón'},
  {city:'Huesca',lat:42.1361,lng:-0.4082,ccaa:'Aragón'},
  {city:'Teruel',lat:40.3454,lng:-1.1065,ccaa:'Aragón'},
  {city:'Calatayud',lat:41.3542,lng:-1.6432,ccaa:'Aragón'},
  {city:'Alcañiz',lat:41.0500,lng:-0.1337,ccaa:'Aragón'},
  {city:'Barbastro',lat:42.0363,lng:0.1254,ccaa:'Aragón'},
  {city:'Jaca',lat:42.5697,lng:-0.5489,ccaa:'Aragón'},
  {city:'Monzón',lat:41.9104,lng:0.1919,ccaa:'Aragón'},
  {city:'Sabiñánigo',lat:42.5170,lng:-0.3641,ccaa:'Aragón'},
  {city:'Oviedo',lat:43.3614,lng:-5.8497,ccaa:'Asturias'},
  {city:'Gijón',lat:43.5453,lng:-5.6613,ccaa:'Asturias'},
  {city:'Avilés',lat:43.5564,lng:-5.9250,ccaa:'Asturias'},
  {city:'Mieres',lat:43.2506,lng:-5.7786,ccaa:'Asturias'},
  {city:'Langreo',lat:43.3044,lng:-5.6870,ccaa:'Asturias'},
  {city:'Llanes',lat:43.4197,lng:-4.7549,ccaa:'Asturias'},
  {city:'Cangas de Onís',lat:43.3526,lng:-5.1298,ccaa:'Asturias'},
  {city:'Cangas del Narcea',lat:43.1764,lng:-6.5500,ccaa:'Asturias'},
  {city:'Luarca',lat:43.5426,lng:-6.5362,ccaa:'Asturias'},
  {city:'Palma',lat:39.5696,lng:2.6502,ccaa:'Baleares'},
  {city:'Ibiza',lat:38.9089,lng:1.4329,ccaa:'Baleares'},
  {city:'Mahón',lat:39.8885,lng:4.2659,ccaa:'Baleares'},
  {city:'Manacor',lat:39.5681,lng:3.2156,ccaa:'Baleares'},
  {city:'Calvià',lat:39.5643,lng:2.5077,ccaa:'Baleares'},
  {city:'Inca',lat:39.7222,lng:2.9138,ccaa:'Baleares'},
  {city:'Las Palmas de Gran Canaria',lat:28.1235,lng:-15.4363,ccaa:'Canarias'},
  {city:'Santa Cruz de Tenerife',lat:28.4636,lng:-16.2518,ccaa:'Canarias'},
  {city:'La Laguna',lat:28.4851,lng:-16.3157,ccaa:'Canarias'},
  {city:'Arrecife',lat:28.9635,lng:-13.5479,ccaa:'Canarias'},
  {city:'Puerto del Rosario',lat:28.4991,lng:-13.8628,ccaa:'Canarias'},
  {city:'Puerto de la Cruz',lat:28.4141,lng:-16.5481,ccaa:'Canarias'},
  {city:'Telde',lat:27.9994,lng:-15.4196,ccaa:'Canarias'},
  {city:'Santa Cruz de La Palma',lat:28.6833,lng:-17.7642,ccaa:'Canarias'},
  {city:'Los Llanos de Aridane',lat:28.6586,lng:-17.9133,ccaa:'Canarias'},
  {city:'San Cristóbal de La Laguna',lat:28.4874,lng:-16.3159,ccaa:'Canarias'},
  {city:'Santander',lat:43.4623,lng:-3.8099,ccaa:'Cantabria'},
  {city:'Torrelavega',lat:43.3516,lng:-4.0483,ccaa:'Cantabria'},
  {city:'Laredo',lat:43.4133,lng:-3.4140,ccaa:'Cantabria'},
  {city:'San Vicente de la Barquera',lat:43.3835,lng:-4.3887,ccaa:'Cantabria'},
  {city:'Castro-Urdiales',lat:43.3836,lng:-3.2163,ccaa:'Cantabria'},
  {city:'Toledo',lat:39.8628,lng:-4.0273,ccaa:'C. La Mancha'},
  {city:'Albacete',lat:38.9942,lng:-1.8564,ccaa:'C. La Mancha'},
  {city:'Ciudad Real',lat:38.9848,lng:-3.9274,ccaa:'C. La Mancha'},
  {city:'Cuenca',lat:40.0697,lng:-2.1374,ccaa:'C. La Mancha'},
  {city:'Guadalajara',lat:40.6321,lng:-3.1661,ccaa:'C. La Mancha'},
  {city:'Talavera de la Reina',lat:39.9610,lng:-4.8338,ccaa:'C. La Mancha'},
  {city:'Puertollano',lat:38.6853,lng:-4.1077,ccaa:'C. La Mancha'},
  {city:'Valdepeñas',lat:38.7634,lng:-3.3844,ccaa:'C. La Mancha'},
  {city:'Alcázar de San Juan',lat:39.3967,lng:-3.2116,ccaa:'C. La Mancha'},
  {city:'Hellín',lat:38.5167,lng:-1.7003,ccaa:'C. La Mancha'},
  {city:'Villarrobledo',lat:39.2664,lng:-2.6052,ccaa:'C. La Mancha'},
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
  {city:'El Burgo de Osma',lat:41.5897,lng:-3.0726,ccaa:'C. y León'},
  {city:'Benavente',lat:42.0045,lng:-5.6790,ccaa:'C. y León'},
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
  {city:'Vilanova i la Geltrú',lat:41.2242,lng:1.7265,ccaa:'Cataluña'},
  {city:'Sant Cugat del Vallès',lat:41.4726,lng:2.0842,ccaa:'Cataluña'},
  {city:'Granollers',lat:41.6087,lng:2.2868,ccaa:'Cataluña'},
  {city:'Igualada',lat:41.5799,lng:1.6206,ccaa:'Cataluña'},
  {city:'Badajoz',lat:38.8794,lng:-6.9706,ccaa:'Extremadura'},
  {city:'Cáceres',lat:39.4753,lng:-6.3724,ccaa:'Extremadura'},
  {city:'Mérida',lat:38.9166,lng:-6.3426,ccaa:'Extremadura'},
  {city:'Plasencia',lat:40.0305,lng:-6.0896,ccaa:'Extremadura'},
  {city:'Don Benito',lat:38.9570,lng:-5.8614,ccaa:'Extremadura'},
  {city:'Almendralejo',lat:38.6843,lng:-6.4069,ccaa:'Extremadura'},
  {city:'Vigo',lat:42.2314,lng:-8.7124,ccaa:'Galicia'},
  {city:'A Coruña',lat:43.3623,lng:-8.4115,ccaa:'Galicia'},
  {city:'Ourense',lat:42.3354,lng:-7.8644,ccaa:'Galicia'},
  {city:'Pontevedra',lat:42.4342,lng:-8.6488,ccaa:'Galicia'},
  {city:'Santiago de Compostela',lat:42.8782,lng:-8.5448,ccaa:'Galicia'},
  {city:'Lugo',lat:43.0097,lng:-7.5567,ccaa:'Galicia'},
  {city:'Ferrol',lat:43.4849,lng:-8.2261,ccaa:'Galicia'},
  {city:'Vilagarcía de Arousa',lat:42.5952,lng:-8.7663,ccaa:'Galicia'},
  {city:'Pontevedra Norte',lat:42.4500,lng:-8.6200,ccaa:'Galicia'},
  {city:'O Grove',lat:42.4937,lng:-8.8681,ccaa:'Galicia'},
  {city:'Logroño',lat:42.4627,lng:-2.4449,ccaa:'La Rioja'},
  {city:'Calahorra',lat:42.3019,lng:-1.9689,ccaa:'La Rioja'},
  {city:'Haro',lat:42.5753,lng:-2.8510,ccaa:'La Rioja'},
  {city:'Nájera',lat:42.4179,lng:-2.7298,ccaa:'La Rioja'},
  {city:'Madrid',lat:40.4168,lng:-3.7038,ccaa:'Madrid'},
  {city:'Móstoles',lat:40.3228,lng:-3.8648,ccaa:'Madrid'},
  {city:'Alcalá de Henares',lat:40.4818,lng:-3.3637,ccaa:'Madrid'},
  {city:'Fuenlabrada',lat:40.2847,lng:-3.7948,ccaa:'Madrid'},
  {city:'Leganés',lat:40.3284,lng:-3.7641,ccaa:'Madrid'},
  {city:'Getafe',lat:40.3058,lng:-3.7327,ccaa:'Madrid'},
  {city:'Alcorcón',lat:40.3461,lng:-3.8263,ccaa:'Madrid'},
  {city:'Torrejón de Ardoz',lat:40.4597,lng:-3.4782,ccaa:'Madrid'},
  {city:'Parla',lat:40.2380,lng:-3.7691,ccaa:'Madrid'},
  {city:'Alcobendas',lat:40.5475,lng:-3.6423,ccaa:'Madrid'},
  {city:'Aranjuez',lat:40.0338,lng:-3.6007,ccaa:'Madrid'},
  {city:'Collado Villalba',lat:40.6331,lng:-4.0035,ccaa:'Madrid'},
  {city:'San Sebastián de los Reyes',lat:40.5499,lng:-3.6262,ccaa:'Madrid'},
  {city:'Majadahonda',lat:40.4733,lng:-3.8721,ccaa:'Madrid'},
  {city:'Las Rozas',lat:40.4930,lng:-3.8762,ccaa:'Madrid'},
  {city:'Pozuelo de Alarcón',lat:40.4356,lng:-3.8138,ccaa:'Madrid'},
  {city:'Rivas-Vaciamadrid',lat:40.3564,lng:-3.5228,ccaa:'Madrid'},
  {city:'Coslada',lat:40.4235,lng:-3.5671,ccaa:'Madrid'},
  {city:'Getafe Sur',lat:40.2900,lng:-3.7200,ccaa:'Madrid'},
  {city:'Murcia',lat:37.9922,lng:-1.1307,ccaa:'Murcia'},
  {city:'Cartagena',lat:37.6063,lng:-0.9864,ccaa:'Murcia'},
  {city:'Lorca',lat:37.6713,lng:-1.6985,ccaa:'Murcia'},
  {city:'Molina de Segura',lat:38.0524,lng:-1.2130,ccaa:'Murcia'},
  {city:'Cieza',lat:38.2397,lng:-1.4201,ccaa:'Murcia'},
  {city:'Yecla',lat:38.6155,lng:-1.1136,ccaa:'Murcia'},
  {city:'Pamplona',lat:42.8188,lng:-1.6444,ccaa:'Navarra'},
  {city:'Tudela',lat:42.0642,lng:-1.6026,ccaa:'Navarra'},
  {city:'Estella',lat:42.6718,lng:-2.0315,ccaa:'Navarra'},
  {city:'Bilbao',lat:43.2630,lng:-2.9340,ccaa:'País Vasco'},
  {city:'Vitoria',lat:42.8467,lng:-2.6727,ccaa:'País Vasco'},
  {city:'San Sebastián',lat:43.3183,lng:-1.9812,ccaa:'País Vasco'},
  {city:'Barakaldo',lat:43.2965,lng:-2.9922,ccaa:'País Vasco'},
  {city:'Irún',lat:43.3381,lng:-1.7875,ccaa:'País Vasco'},
  {city:'Getxo',lat:43.3567,lng:-3.0125,ccaa:'País Vasco'},
  {city:'Donostia',lat:43.3200,lng:-1.9800,ccaa:'País Vasco'},
  {city:'Eibar',lat:43.1847,lng:-2.4714,ccaa:'País Vasco'},
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
  {city:'Torrent',lat:39.4338,lng:-0.4649,ccaa:'C. Valenciana'},
  {city:'Paterna',lat:39.5041,lng:-0.4399,ccaa:'C. Valenciana'},
  {city:'Sagunto',lat:39.6795,lng:-0.2721,ccaa:'C. Valenciana'},
  {city:'Xàtiva',lat:38.9917,lng:-0.5183,ccaa:'C. Valenciana'},
  {city:'Ontinyent',lat:38.8214,lng:-0.6006,ccaa:'C. Valenciana'},
  {city:'Ceuta',lat:35.8894,lng:-5.3213,ccaa:'Ceuta'},
  {city:'Melilla',lat:35.2923,lng:-2.9381,ccaa:'Melilla'},
];

// Busca places con paginación (hasta 60 por query = 3 páginas de 20)
async function searchPlaces(query, lat, lng, pageToken) {
  let url;
  if (pageToken) {
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pageToken}&language=es&key=${GKEY}`;
  } else {
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=4000&language=es&key=${GKEY}`;
  }
  await sleep(200); // respetar rate limit
  return get(url);
}

async function getAllResults(query, lat, lng) {
  const all = [];
  let data = await searchPlaces(query, lat, lng);
  if (!data.results) return all;
  all.push(...data.results);
  if (data.next_page_token) {
    await sleep(2000); // Google requiere 2s antes del siguiente token
    data = await searchPlaces(query, lat, lng, data.next_page_token);
    if (data.results) all.push(...data.results);
    if (data.next_page_token) {
      await sleep(2000);
      data = await searchPlaces(query, lat, lng, data.next_page_token);
      if (data.results) all.push(...data.results);
    }
  }
  return all;
}

// Cache de nombres existentes por ciudad para evitar duplicados
const cityCache = {};
async function loadCityCache(city) {
  if (cityCache[city]) return;
  const {data} = await sb.from('places').select('name').eq('city', city);
  cityCache[city] = new Set((data||[]).map(p=>p.name.toLowerCase()));
}

async function insertPlace(result, city, category, product, price) {
  if (!result.geometry) return false;
  await loadCityCache(city);
  const name = result.name;
  if (!name || name.length < 2) return false;
  if (cityCache[city]?.has(name.toLowerCase())) return false; // ya existe

  const {data: np, error} = await sb.from('places').insert({
    name: name.slice(0, 100),
    category,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    city,
    address: (result.formatted_address || result.vicinity || '').slice(0, 200),
    is_active: 1,
    created_by: ADMIN,
  }).select('id').single();

  if (error || !np) return false;
  cityCache[city].add(name.toLowerCase());

  // Insertar precio
  const {error: pe} = await sb.from('prices').insert({
    place_id: np.id, product, price,
    unit: 'unidad', reported_by: ADMIN,
    is_active: 1, votes_up: Math.floor(Math.random()*8)+2,
    votes_down: 0, status: 'verified'
  });
  return !pe;
}

async function procesarMunicipio(m, idx, total) {
  const {city, lat, lng, ccaa} = m;
  const label = `[${idx}/${total}] ${city}`;
  let count = 0;

  // Calcular precios base para esta zona
  const pCafe = PRECIOS.cafe[ccaa] || PRECIOS.cafe['Andalucía'];
  const pCerv = PRECIOS.cerveza[ccaa] || PRECIOS.cerveza['Andalucía'];
  const pMenu = PRECIOS.menu[ccaa] || PRECIOS.menu['Andalucía'];

  // ── CAFETERÍAS Y BARES (café) ──────────────────────────────────────────────
  for (const q of [`cafetería bar café ${city}`, `cafeteria desayuno ${city}`, `bar tapas café ${city}`]) {
    const results = await getAllResults(q, lat, lng);
    for (const r of results) {
      const pl = r.price_level || 1;
      const p = Math.round(pCafe * (1 + (pl-1)*0.2) * 100) / 100;
      if (await insertPlace(r, city, 'restaurante', 'Café con leche', Math.max(0.90, p))) count++;
    }
    await sleep(300);
  }

  // ── RESTAURANTES (menú del día) ────────────────────────────────────────────
  for (const q of [`restaurante menú del día ${city}`, `restaurante comida ${city}`, `tapas bar restaurante ${city}`, `sidrería bodega taberna ${city}`]) {
    const results = await getAllResults(q, lat, lng);
    for (const r of results) {
      const pl = r.price_level || 2;
      const p = Math.round(pMenu * (1 + (pl-1)*0.15) * 100) / 100;
      if (await insertPlace(r, city, 'restaurante', 'Menú del día', Math.max(7.00, p))) count++;
    }
    await sleep(300);
  }

  process.stdout.write(`\r${label.padEnd(45)} +${count} nuevos`);
  return count;
}

async function main() {
  console.log(`\n🚀 SCRAPER V3 — ${MUNICIPIOS.length} municipios`);
  console.log(`📍 Categoría: CAFÉS/BARES (café con leche + menú del día)`);
  console.log(`🔑 GKEY: ${GKEY?.slice(0,20)}...\n`);

  let total = 0;
  for (let i = 0; i < MUNICIPIOS.length; i++) {
    const n = await procesarMunicipio(MUNICIPIOS[i], i+1, MUNICIPIOS.length);
    total += n;
    await sleep(500);
  }

  console.log(`\n\n✅ COMPLETADO: ${total} nuevos bares/restaurantes en ${MUNICIPIOS.length} municipios`);

  // Stats finales
  const {data} = await sb.from('places').select('category');
  const cats = {};
  (data||[]).forEach(p => { cats[p.category] = (cats[p.category]||0)+1; });
  console.log('\n📊 BD FINAL:');
  Object.entries(cats).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
}

main().catch(e => { console.error('\n❌ ERROR:', e.message); process.exit(1); });
