import { defineConfig } from "@playwright/test";
import { deploymentPaths } from "./config/paths";
const { base } = deploymentPaths(process.env.BASE_PATH);
const port = Number(process.env.TEST_PORT || 4177);
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: `http://127.0.0.1:${port}` + base,
    viewport: { width: 390, height: 844 },
    isMobile:true,
    hasTouch:true,
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}${base}`,
    reuseExistingServer: false,
  },
  workers: 1,
});
