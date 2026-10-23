import fs from "node:fs";
const packages = [
  "idb",
  "fflate",
  "@tanstack/virtual-core",
  "workbox-core",
  "workbox-window",
  "workbox-precaching",
  "workbox-routing",
  "workbox-strategies",
  "workbox-expiration",
  "workbox-cacheable-response",
  "workbox-sw",
];
let output =
  "# Third-party notices\n\nThe parser, app code and icons were written for this project. No repositories were cloned or external parser source copied. npm installs the dependencies locally, with exact versions and integrity values recorded in package-lock.json. The app loads no scripts or fonts from a CDN.\n\nThe runtime libraries and service worker components are listed below with their license notices. Development tools keep their licenses in node_modules: TypeScript and Playwright use Apache-2.0; Vite, vite-plugin-pwa and Vitest use MIT.\n";
for (const name of packages) {
  const dir = `node_modules/${name}`;
  const p = JSON.parse(fs.readFileSync(`${dir}/package.json`, "utf8"));
  output += `\n## ${name} ${p.version}\n\nSource: ${typeof p.repository === "string" ? p.repository : p.repository?.url || p.homepage}\n\nLicense: ${p.license}\n\n\`\`\`text\n${fs.readFileSync(`${dir}/LICENSE`, "utf8").trim()}\n\`\`\`\n`;
}
fs.writeFileSync("THIRD_PARTY_NOTICES.md", output);
fs.writeFileSync("public/THIRD_PARTY_NOTICES.txt", output);
