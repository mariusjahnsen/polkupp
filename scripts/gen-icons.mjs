import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("public/favicon.svg");

// Standard PWA-størrelser
for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(`public/icon-${size}.png`);
  console.log(`✓ icon-${size}.png`);
}

// Maskable: legg til padding så ikonet ikke blir klippet på Android
const maskable = await sharp({
  create: { width: 512, height: 512, channels: 4, background: { r: 122, g: 26, b: 26, alpha: 1 } }
}).composite([{
  input: await sharp(svg).resize(360, 360).png().toBuffer(),
  gravity: "center"
}]).png().toBuffer();
writeFileSync("public/icon-512-maskable.png", maskable);
console.log("✓ icon-512-maskable.png");

// Apple touch icon (180x180)
await sharp(svg).resize(180, 180).png().toFile("public/apple-touch-icon.png");
console.log("✓ apple-touch-icon.png");

// Favicon ICO (32x32) — sharp støtter ikke ICO direkte, så bruk PNG som .ico (alle moderne browsere godtar)
await sharp(svg).resize(32, 32).png().toFile("public/favicon.png");
console.log("✓ favicon.png (32x32)");
