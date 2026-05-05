import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "Polkupp — Vinmonopolets prisnedsettelser",
        short_name: "Polkupp",
        description: "Daglig oppdaterte prisnedsettelser fra Vinmonopolet, gruppert etter dato.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#faf7f2",
        theme_color: "#7a1a1a",
        lang: "nb-NO",
        categories: ["food", "shopping", "lifestyle"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        runtimeCaching: [
          {
            // Vinmonopolet-bilder via deres CDN — cache lenge
            urlPattern: /^https:\/\/bilder\.vinmonopolet\.no\/.*\.(jpg|jpeg|png|webp)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "vmp-product-images",
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
          {
            // Vår egen /api/stock — kort cache, network-first
            urlPattern: /\/api\/stock/,
            handler: "NetworkFirst",
            options: {
              cacheName: "stock-api",
              expiration: { maxEntries: 100, maxAgeSeconds: 600 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
});
