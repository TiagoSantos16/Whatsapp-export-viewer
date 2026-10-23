import { test, expect, type Page } from "@playwright/test";
import { zipSync, strToU8, unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const android = readFileSync("tests/fixtures/android.txt");
async function chooseFile(page: Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Adicionar ZIP ou TXT" }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: name.endsWith("zip") ? "application/zip" : "text/plain",
    buffer,
  });
}
async function confirmImport(
  page: Page,
  name = "Memórias de teste",
  expectOpen = true,
) {
  await expect(
    page.getByRole("heading", { name: "Rever importação" }),
  ).toBeVisible();
  await page.getByLabel("Nome da conversa", { exact: true }).fill(name);
  await page
    .getByLabel("Quem sou eu", { exact: true })
    .selectOption({ label: "João" });
  await page
    .getByLabel("Quem forneceu a exportação")
    .selectOption({ label: "João" });
  await page.getByRole("button", { name: "Guardar e abrir" }).click();
  if (expectOpen)
    await expect(page.getByRole("heading", { name })).toBeVisible({
      timeout: 60000,
    });
}
test("TXT identity, persistence, search, date, duplicate and backup restore", async ({
  page,
  browser,
}) => {
  await page.goto("app/");
  await chooseFile(page, "android.txt", android);
  await confirmImport(page);
  await expect(
    page.locator("[data-side=self] .message-text").first(),
  ).toContainText("Sim, obrigado.");
  await expect(
    page.locator("[data-side=other] .message-text").first(),
  ).toContainText("Olá");
  await page.screenshot({
    path: "docs/screenshots/mobile.png",
    fullPage: true,
    style: ".notice {visibility:hidden}",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: "docs/screenshots/desktop.png",
    fullPage: true,
    style: ".notice {visibility:hidden}",
  });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: "docs/screenshots/dark-360.png",
    fullPage: true,
    style: ".notice {visibility:hidden}",
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: /Memórias de teste/ }).click();
  await expect(page.locator("[data-side=self]")).toHaveCount(2);
  await page.getByRole("button", { name: "Mais opções", exact: true }).click();
  await page.getByRole("menuitem", { name: "Pesquisar", exact: true }).click();
  await page.getByPlaceholder("Pesquisar nesta conversa").fill("memorias");
  await expect(page.getByText("1 de 1", { exact: true })).toBeVisible();
  await expect(page.locator(".highlight")).toBeVisible();
  await page
    .getByRole("button", { name: "Pesquisar por data", exact: true })
    .click();
  await page.getByLabel("Escolher data", { exact: true }).fill("2026-10-21");
  await expect(page.locator(".highlight")).toBeVisible();
  await page.getByRole("button", { name: "Sair da pesquisa" }).click();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await chooseFile(page, "android.txt", android);
  await expect(
    page.getByRole("heading", { name: "Memórias de teste" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(page.locator(".conversation")).toHaveCount(1);
  await page.getByPlaceholder("Pesquisar em todas as conversas").fill("ola");
  await expect(page.locator(".result").first()).toContainText(
    "Memórias de teste",
  );
  await page.locator(".result").first().click();
  await expect(page.locator(".highlight .message-text")).toContainText("Olá");
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await page.getByRole("button", { name: "Definições", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Guardar cópia de segurança", exact: true })
    .click();
  const saved = await download;
  const path = await saved.path();
  expect(path).toBeTruthy();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const clean = await context.newPage();
  await clean.goto("app/");
  await clean.getByRole("button", { name: "Definições", exact: true }).click();
  const corrupt = unzipSync(readFileSync(path!));
  corrupt["conversations.json"][0] ^= 1;
  const badChooser = clean.waitForEvent("filechooser");
  await clean
    .getByRole("button", { name: "Restaurar cópia", exact: true })
    .click();
  await (
    await badChooser
  ).setFiles({
    name: "corrupt.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync(corrupt)),
  });
  await expect(
    clean.getByText("A integridade da cópia é inválida.", { exact: true }),
  ).toBeVisible();
  await expect(clean.locator(".conversation")).toHaveCount(0);
  const invalid = unzipSync(readFileSync(path!));
  invalid["settings.json"] = strToU8("null");
  const manifest = JSON.parse(
    new TextDecoder().decode(invalid["manifest.json"]),
  );
  const spec = manifest.entries.find(
    (e: { path: string }) => e.path === "settings.json",
  );
  spec.size = 4;
  spec.hash = createHash("sha256")
    .update(invalid["settings.json"])
    .digest("hex");
  invalid["manifest.json"] = strToU8(JSON.stringify(manifest));
  const invalidChooser = clean.waitForEvent("filechooser");
  await clean
    .getByRole("button", { name: "Restaurar cópia", exact: true })
    .click();
  await (
    await invalidChooser
  ).setFiles({
    name: "invalid-settings.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync(invalid)),
  });
  await expect(
    clean.getByText("Definições inválidas na cópia.", { exact: true }),
  ).toBeVisible();
  await expect(clean.locator(".conversation")).toHaveCount(0);
  const chooser = clean.waitForEvent("filechooser");
  await clean
    .getByRole("button", { name: "Restaurar cópia", exact: true })
    .click();
  await (await chooser).setFiles(path!);
  await expect(clean.locator(".conversation")).toHaveCount(1);
  await clean.locator(".conversation").click();
  await expect(clean.locator("[data-side=self]")).toHaveCount(2);
  await context.close();
});
test("ZIP media, no TXT, invalid ZIP and error recovery", async ({
  page,
  browser,
}) => {
  await page.goto("app/");
  const png = readFileSync("public/icons/icon-192.png");
  const audio = Buffer.alloc(48);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(40, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(4, 40);
  const text =
    "21/10/2026, 18:00 - Ana: <attached: pics/a.png>\n21/10/2026, 18:01 - João: voice.wav (file attached)";
  const zip = zipSync({
    "chat.txt": strToU8(text),
    "pics/a.png": png,
    "voice.wav": audio,
  });
  await chooseFile(page, "media.zip", Buffer.from(zip));
  await confirmImport(page, "Anexos sintéticos");
  await expect(page.locator(".attachment img")).toBeVisible();
  await expect(page.locator("audio")).toHaveAttribute("preload", "none");
  await expect(page.locator("audio")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await page.getByRole("button", { name: "Definições", exact: true }).click();
  const mediaDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Guardar cópia de segurança", exact: true })
    .click();
  const mediaBackup = await (await mediaDownload).path();
  const ctx = await browser.newContext();
  const restored = await ctx.newPage();
  await restored.goto("app/");
  await restored
    .getByRole("button", { name: "Definições", exact: true })
    .click();
  const mediaChooser = restored.waitForEvent("filechooser");
  await restored
    .getByRole("button", { name: "Restaurar cópia", exact: true })
    .click();
  await (await mediaChooser).setFiles(mediaBackup!);
  await restored.locator(".conversation").click();
  await expect(restored.locator(".attachment img")).toBeVisible();
  await expect(restored.locator("audio")).toHaveAttribute("src", /^blob:/);
  await ctx.close();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await chooseFile(page, "bad.zip", Buffer.from("bad zip"));
  await expect(
    page.getByText("A importação não foi concluída.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await chooseFile(page, "empty.zip", Buffer.from(zipSync({ "a.png": png })));
  await expect(
    page.getByText("A importação não foi concluída.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(page.locator(".conversation")).toHaveCount(1);
});
test("production service worker opens offline after preparation", async ({
  page,
  context,
}) => {
  await page.goto("app/");
  await chooseFile(page, "android.txt", android);
  await confirmImport(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chat Archive" }),
  ).toBeVisible();
  await page.locator(".conversation").click();
  await expect(page.locator(".message-text").first()).toBeVisible();
});
test("storage failure never publishes incomplete import", async ({ page }) => {
  await page.goto("app/");
  await page.evaluate(async () => {
    const request = indexedDB.open("chat-archive");
    await new Promise<void>((resolve) => {
      request.onsuccess = () => {
        const tx = request.result.transaction("settings", "readwrite");
        tx.objectStore("settings").put(true, "simulateFailure");
        tx.oncomplete = () => resolve();
      };
    });
    const original = IDBObjectStore.prototype.put;
    let writes = 0;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "messages" && ++writes > 250)
        throw new DOMException("Synthetic quota failure", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await chooseFile(
    page,
    "failure.txt",
    Buffer.from(
      Array.from(
        { length: 300 },
        (_, i) =>
          `21/10/2026, 18:00 - ${i % 2 ? "Ana" : "João"}: Mensagem ${i}`,
      ).join("\n"),
    ),
  );
  await confirmImport(page, "Falha sintética", false);
  await expect(page.getByText(/Sem espaço suficiente/)).toBeVisible();
  await page.reload();
  await expect(page.locator(".conversation")).toHaveCount(0);
  const remaining = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const r = indexedDB.open("chat-archive");
        r.onsuccess = () => {
          const t = r.result.transaction("messages");
          const count = t.objectStore("messages").count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );
  expect(remaining).toBe(0);
});
test("large generated archive stays virtualized and searchable", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("app/");
  const text = Array.from(
    { length: 50000 },
    (_, i) =>
      `21/10/2026, 18:00 - ${i % 2 ? "Ana" : "João"}: Mensagem sintética ${i}`,
  ).join("\n");
  await chooseFile(page, "large.txt", Buffer.from(text));
  await confirmImport(page, "Arquivo grande");
  await expect(page.locator(".message-row").first()).toBeVisible();
  expect(await page.locator(".message-row").count()).toBeLessThan(100);
  await page.getByRole("button", { name: "Mais opções", exact: true }).click();
  await page.getByRole("menuitem", { name: "Pesquisar", exact: true }).click();
  await page
    .getByPlaceholder("Pesquisar nesta conversa")
    .fill("sintetica 43210");
  await expect(page.getByText("1 de 1", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".highlight .message-text")).toContainText("43210");
});
