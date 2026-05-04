// Vercel serverless function — proxy til Vinmonopolets stock-endepunkt
// Browseren kan ikke kalle vinmonopolet.no direkte (ingen CORS-headers).

export default async function handler(req, res) {
  const { code, location, lat, lon } = req.query;

  if (!code || !/^\d+$/.test(code)) {
    return res.status(400).json({ error: "Mangler eller ugyldig 'code'" });
  }

  let locParam;
  if (lat && lon && /^-?\d+(\.\d+)?$/.test(lat) && /^-?\d+(\.\d+)?$/.test(lon)) {
    locParam = `latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`;
  } else if (location && /^[\w\s.\-,]{1,40}$/.test(location)) {
    locParam = `location=${encodeURIComponent(location)}`;
  } else {
    return res.status(400).json({ error: "Mangler 'location' eller 'lat'+'lon'" });
  }

  const url = `https://www.vinmonopolet.no/vmpws/v2/vmp/products/${code}/stock?${locParam}&pageSize=10`;

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Polkupp/0.1 (mariusjahnsen@gmail.com)",
        Accept: "application/json",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream HTTP ${upstream.status}` });
    }

    const data = await upstream.json();

    // Cache 10 min på Vercels CDN — stock-tall endres ikke ofte og samme spørsmål
    // gjentas typisk fra mange brukere.
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=300");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "Kunne ikke nå Vinmonopolet", detail: e.message });
  }
}
