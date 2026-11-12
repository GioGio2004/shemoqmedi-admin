// Builds the PWA icons that app/manifest.ts and public/sw.js use from the
// crow (public/icons/crow-512.png, black on white):
//
//   crow-maskable-{192,512}.png  the crow inside the maskable safe zone (the
//                                centre 80% circle), so Android's round and
//                                squircle masks never clip its beak or tail.
//   crow-badge-96.png            a white silhouette on transparency: Android
//                                draws notification badges from alpha only.
//
// Run once after the crow changes: node scripts/pwa-icons.mjs

import sharp from "sharp";
import { fileURLToPath } from "node:url";

const icons = fileURLToPath(new URL("../public/icons/", import.meta.url));
const source = `${icons}crow-512.png`;

// The trimmed crow is wider than tall; fitting it in 62% of the icon keeps
// its corners inside the safe circle (radius 40%).
const SAFE_FRACTION = 0.62;

async function trimmedCrow() {
  return sharp(source).flatten({ background: "#ffffff" }).trim({ threshold: 40 }).png().toBuffer();
}

async function maskable(size) {
  const box = Math.round(size * SAFE_FRACTION);
  const crow = await sharp(await trimmedCrow())
    .resize(box, box, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: "#ffffff" } })
    .composite([{ input: crow, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(`${icons}crow-maskable-${size}.png`);
}

async function badge(size) {
  const box = Math.round(size * 0.84);
  // Darkness becomes opacity: black crow → opaque, white paper → transparent.
  const alpha = await sharp(await trimmedCrow())
    .resize(box, box, { fit: "contain", background: "#ffffff" })
    .extend({
      top: Math.floor((size - box) / 2),
      bottom: Math.ceil((size - box) / 2),
      left: Math.floor((size - box) / 2),
      right: Math.ceil((size - box) / 2),
      background: "#ffffff",
    })
    .greyscale()
    .negate()
    .raw()
    .toBuffer();
  const white = Buffer.alloc(size * size * 3, 255);
  await sharp(white, { raw: { width: size, height: size, channels: 3 } })
    .joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(`${icons}crow-badge-${size}.png`);
}

await Promise.all([maskable(192), maskable(512), badge(96)]);
console.log("PWA icons written to public/icons/");
