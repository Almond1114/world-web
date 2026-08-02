import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const outputPath = process.env.OUTPUT_PATH || "public/data/live.json";
const connectors = [];

async function collect(id, name, mode, license, cadence, docs, task) {
  const started = Date.now();
  try {
    const data = await task();
    connectors.push({ id, name, status: "live", mode, license, cadence, docs, latency: Date.now() - started });
    return data;
  } catch (error) {
    connectors.push({ id, name, status: "unavailable", mode, license, cadence, docs, latency: Date.now() - started });
    console.warn(`${name}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { "User-Agent": "ATLAS-LIVE/1.0 (+https://almond1114.github.io/world-web/)" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const citySpecs = [
  { city: "東京", country: "JP", lat: 35.6762, lon: 139.6503 },
  { city: "ロンドン", country: "GB", lat: 51.5072, lon: -0.1276 },
  { city: "ニューヨーク", country: "US", lat: 40.7128, lon: -74.006 },
  { city: "シンガポール", country: "SG", lat: 1.3521, lon: 103.8198 },
  { city: "ドバイ", country: "AE", lat: 25.2048, lon: 55.2708 },
  { city: "シドニー", country: "AU", lat: -33.8688, lon: 151.2093 },
];
const marineSpecs = [
  { place: "相模湾", lat: 34.8, lon: 139.5 }, { place: "北大西洋", lat: 45, lon: -25 },
  { place: "シンガポール海峡", lat: 1.15, lon: 103.7 }, { place: "シドニー沖", lat: -34.1, lon: 151.5 },
];
const marketSpecs = [
  { remote: "%5EN225", symbol: "N225", name: "日経平均" }, { remote: "%5EGSPC", symbol: "SPX", name: "S&P 500" },
  { remote: "%5ENDX", symbol: "NDX", name: "NASDAQ 100" }, { remote: "%5EGDAXI", symbol: "DAX", name: "DAX" },
];

const weatherTask = collect("weather", "Open-Meteo Weather", "DIRECT", "CC BY 4.0", "15 min model", "https://open-meteo.com/en/docs", async () => {
  const values = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${citySpecs.map((c) => c.lat).join(",")}&longitude=${citySpecs.map((c) => c.lon).join(",")}&current=temperature_2m,weather_code,wind_speed_10m`);
  return citySpecs.map((city, index) => ({ ...city, temp: values[index].current.temperature_2m, wind: values[index].current.wind_speed_10m, code: values[index].current.weather_code }));
});
const airTask = collect("air", "Open-Meteo / CAMS", "DIRECT", "CC BY 4.0", "12–24 h model", "https://open-meteo.com/en/docs/air-quality-api", async () => {
  const values = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${citySpecs.map((c) => c.lat).join(",")}&longitude=${citySpecs.map((c) => c.lon).join(",")}&current=us_aqi,pm2_5`);
  return citySpecs.map((city, index) => ({ city: city.city, country: city.country, aqi: values[index].current.us_aqi, pm25: values[index].current.pm2_5 }));
});
const marineTask = collect("marine", "Open-Meteo Marine", "DIRECT", "CC BY 4.0", "hourly model", "https://open-meteo.com/en/docs/marine-weather-api", async () => {
  const values = await getJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${marineSpecs.map((c) => c.lat).join(",")}&longitude=${marineSpecs.map((c) => c.lon).join(",")}&current=wave_height,sea_surface_temperature`);
  return marineSpecs.map((place, index) => ({ ...place, wave: values[index].current.wave_height, temp: values[index].current.sea_surface_temperature }));
});
const quakeTask = collect("earthquakes", "USGS Earthquake Hazards", "DIRECT", "Public domain", "1 min", "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php", async () => {
  const json = await getJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
  return json.features.slice(0, 16).map(({ properties }) => ({ place: properties.place, magnitude: properties.mag, time: properties.time, url: properties.url }));
});
const transitTask = collect("transit", "Open Transport Data CH", "DIRECT", "Provider terms", "realtime", "https://transport.opendata.ch/docs.html", async () => {
  const json = await getJson("https://transport.opendata.ch/v1/stationboard?station=Z%C3%BCrich%20HB&limit=8");
  return json.stationboard.map((trip) => ({ line: `${trip.category || ""}${trip.number || ""}`.trim(), destination: trip.to, category: trip.category, departure: new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" }).format(new Date(trip.stop.departure)) }));
});
const fxTask = collect("fx", "Frankfurter", "DIRECT", "MIT / source rates", "business daily", "https://frankfurter.dev/", async () => {
  const json = await getJson("https://api.frankfurter.dev/v2/rates?base=USD&quotes=JPY,EUR,GBP,CHF");
  return json.map((rate) => ({ pair: `${rate.base}/${rate.quote}`, value: rate.rate }));
});
const cryptoTask = collect("crypto", "CoinGecko", "SNAPSHOT", "Provider terms", "30 min", "https://docs.coingecko.com/docs/keyless-public-api", async () => {
  const json = await getJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true");
  return Object.entries(json).map(([symbol, quote]) => ({ symbol: symbol.toUpperCase(), value: quote.usd, change: quote.usd_24h_change }));
});
const eventTask = collect("events", "NASA EONET", "SNAPSHOT", "NASA open data", "event driven", "https://eonet.gsfc.nasa.gov/docs/v3", async () => {
  const json = await getJson("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=12");
  return json.events.map((event) => ({ title: event.title, category: event.categories[0]?.title || "Natural event", date: event.geometry.at(-1)?.date || "", url: event.link }));
});
const flightTask = collect("flights", "OpenSky Network", "SNAPSHOT", "OpenSky terms", "30 min sample", "https://openskynetwork.github.io/opensky-api/rest.html", async () => {
  const boxes = ["lamin=30&lomin=128&lamax=46&lomax=146", "lamin=44&lomin=-3&lamax=54&lomax=16"];
  const responses = await Promise.all(boxes.map((box) => getJson(`https://opensky-network.org/api/states/all?${box}`)));
  return responses.flatMap((json) => json.states || []).filter((row) => row[1] && row[5] && row[6] && !row[8]).slice(0, 20).map((row) => ({ callsign: String(row[1]).trim(), country: String(row[2]), lon: Number(row[5]), lat: Number(row[6]), altitude: Number(row[7] || 0), speed: Number(row[9] || 0) * 3.6 }));
});
const marketTask = collect("markets", "Yahoo Finance", "SNAPSHOT", "Provider terms", "30 min / delayed", "https://finance.yahoo.com/", async () => Promise.all(marketSpecs.map(async (spec) => {
  const json = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${spec.remote}?interval=1d&range=5d`);
  const meta = json.chart?.result?.[0]?.meta || {};
  const close = Number(meta.regularMarketPrice); const previous = Number(meta.chartPreviousClose || meta.previousClose);
  return { symbol: spec.symbol, name: spec.name, value: Number.isFinite(close) ? close : null, change: Number.isFinite(previous) && Number.isFinite(close) && previous ? ((close - previous) / previous) * 100 : null, live: Number.isFinite(close) };
})));

const [weather, airQuality, marine, earthquakes, transit, fx, crypto, events, flights, markets] = await Promise.all([weatherTask, airTask, marineTask, quakeTask, transitTask, fxTask, cryptoTask, eventTask, flightTask, marketTask]);
const output = { generatedAt: new Date().toISOString(), weather: weather || [], airQuality: airQuality || [], marine: marine || [], earthquakes: earthquakes || [], transit: transit || [], fx: fx || [], crypto: crypto || [], events: events || [], flights: flights || [], markets: markets || marketSpecs.map((spec) => ({ symbol: spec.symbol, name: spec.name, value: null, change: null, live: false })), connectors };

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath} with ${connectors.filter((connector) => connector.status === "live").length}/${connectors.length} sources online.`);

