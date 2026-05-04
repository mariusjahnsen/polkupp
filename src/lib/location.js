const KEY = "polkupp_location";

export function getLocation() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export function setLocation(loc) {
  localStorage.setItem(KEY, JSON.stringify(loc));
}

export function clearLocation() {
  localStorage.removeItem(KEY);
}

export function locationLabel(loc) {
  if (!loc) return "Velg lokasjon";
  if (loc.type === "gps") return "Min posisjon";
  if (loc.type === "postnr") return `Postnr ${loc.postnr}`;
  return "Lokasjon";
}

export function getGpsLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("GPS er ikke tilgjengelig i denne nettleseren"));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ type: "gps", lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(new Error(err.message || "Kunne ikke hente posisjon")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  });
}
