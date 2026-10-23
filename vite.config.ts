import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { deploymentPaths } from "./config/paths.ts";
import { execFileSync } from "node:child_process";
const { base, app } = deploymentPaths(process.env.BASE_PATH);
let repository = process.env.GITHUB_REPOSITORY || "";
if (!repository) {
  try {
    const remote = execFileSync(
      "git",
      ["config", "--get", "remote.origin.url"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    repository =
      remote.match(
        /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
      )?.[1] || "";
  } catch {
    /* A local repository may have no remote. */
  }
}
const source = /^[\w.-]+\/[\w.-]+$/.test(repository)
  ? `https://github.com/${repository}`
  : "";
export default defineConfig({
  base,
  build: {
    rollupOptions: { input: { landing: "index.html", app: "app/index.html" } },
  },
  plugins: [
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      filename: "app/sw.js",
      manifestFilename: "app/manifest.webmanifest",
      scope: app,
      includeAssets: [],
      includeManifestIcons: false,
      integration: {
        beforeBuildServiceWorker(options) {
          options.workbox.additionalManifestEntries =
            options.workbox.additionalManifestEntries?.map((entry) =>
              typeof entry === "string"
                ? base + entry
                : { ...entry, url: base + entry.url },
            );
        },
      },
      manifest: {
        name: "Chat Archive",
        short_name: "Chat Archive",
        lang: "pt-PT",
        id: process.env.PWA_ID || base,
        start_url: app,
        scope: app,
        display: "standalone",
        theme_color: "#195f51",
        background_color: "#f4f5ef",
        icons: [
          {
            src: base + "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: base + "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: base + "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: [
          "app/**/*.html",
          "app/*.webmanifest",
          "assets/*.{js,css}",
          "icons/*.png",
        ],
        modifyURLPrefix: { "": base },
        navigateFallback: app + "index.html",
        cacheId: "chat-archive-app-" + base.replace(/[^a-z0-9]/gi, "_"),
        maximumFileSizeToCacheInBytes: 4000000,
        cleanupOutdatedCaches: false,
      },
    }),
    {
      name: "landing-without-pwa",
      enforce: "post",
      generateBundle(_options, bundle) {
        const manifest = bundle["app/manifest.webmanifest"];
        if (manifest?.type === "asset")
          this.emitFile({
            type: "asset",
            fileName: "manifest.webmanifest",
            source: manifest.source,
          });
      },
      transformIndexHtml: {
        order: "post",
        handler(html, ctx) {
          if (ctx.path.endsWith("/app/index.html") || ctx.path === "/app/")
            return html;
          return html
            .replace(/<link\b[^>]*rel="manifest"[^>]*>/g, "")
            .replace(
              "<!--SOURCE_LINK-->",
              source
                ? `<a href="${source}" rel="noopener noreferrer">Código no GitHub</a>`
                : "",
            );
        },
      },
    },
  ],
  worker: { format: "es" },
});
