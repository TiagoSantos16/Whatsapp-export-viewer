import { test, expect, type Page } from "@playwright/test";
import { completeArchive, completeText } from "../fixtures/complete";
import { legacyBackup } from "../fixtures/legacy-backup";

async function importArchive(page: Page, video?: Uint8Array) {
  await page.goto("app/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Adicionar ZIP ou TXT" }).click();
  await (
    await chooser
  ).setFiles({
    name: "arquivo-sintetico.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(completeArchive(video)),
  });
  await expect(
    page.getByRole("heading", { name: "Rever importação" }),
  ).toBeVisible();
  await page
    .getByLabel("Nome da conversa", { exact: true })
    .fill("Arquivo sintético");
  await page.getByLabel("Tipo", { exact: true }).selectOption("group");
  await page
    .getByLabel("Quem sou eu", { exact: true })
    .selectOption({ label: "João" });
  await page.getByRole("button", { name: "Guardar e abrir" }).click();
  await expect(
    page.getByRole("heading", { name: "Arquivo sintético" }),
  ).toBeVisible();
}
async function menu(page: Page, action: string) {
  await page.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function startSearch(page: Page, query: string) {
  await menu(page, "Pesquisar");
  await page.getByPlaceholder("Pesquisar nesta conversa").fill(query);
}
async function storedTexts(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const r = indexedDB.open("chat-archive");
        r.onsuccess = () => {
          const t = r.result.transaction("messages");
          const q = t.objectStore("messages").getAll();
          q.onsuccess = () =>
            resolve(q.result.map((m: { text: string }) => m.text));
        };
      }),
  );
}

test("derived markers apply to existing records and never rewrite stored content", async ({
  page,
}) => {
  await importArchive(page);
  await page.reload();
  await page.locator(".conversation").click();
  await startSearch(page, "Texto final");
  await expect(page.getByText("1 de 1", { exact: true })).toBeVisible();
  const edited = page.locator(".highlight");
  await expect(edited.locator(".message-time")).toContainText("Editada");
  await expect(edited.locator(".message-text")).toHaveText(
    "Texto final corrigido",
  );
  await expect(edited).not.toContainText("<Esta mensagem foi editada>");
  expect(
    (await storedTexts(page)).some((t) =>
      t.includes("<Esta mensagem foi editada>"),
    ),
  ).toBe(true);
  await page
    .getByPlaceholder("Pesquisar nesta conversa")
    .fill("Ficheiro não incluído");
  await expect(page.getByText("1 de 1", { exact: true })).toBeVisible();
  await expect(page.locator(".highlight .omitted-attachment")).toHaveText(
    "Ficheiro não incluído",
  );
  await expect(page.locator(".highlight a.download")).toHaveCount(0);
  await page.getByRole("button", { name: "Sair da pesquisa" }).click();
  await expect(page.getByRole("button", { name: "Ir ao início" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Pesquisar por data" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Guarda uma cópia de segurança do teu arquivo",
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Definições", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Cópia de segurança", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Guardar cópia de segurança",
      exact: true,
    }),
  ).toBeVisible();
});

test("global snippets and conversation arrows work with decomposed accents without hover", async ({
  page,
}) => {
  await importArchive(page);
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await page.getByPlaceholder("Pesquisar em todas as conversas").fill("cafe");
  const result = page.locator(".result");
  await expect(result).toHaveCount(1);
  await expect(result.locator(".result-snippet")).toContainText("cafe\u0301");
  await expect(result.locator("mark")).toHaveText("cafe\u0301");
  await expect(result.locator(".result-snippet")).not.toContainText(
    "Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes Antes",
  );
  await result.click();
  await expect(page.locator(".highlight .message-text")).toContainText(
    "cafe\u0301",
  );
  await startSearch(page, "imagem");
  await expect(page.locator(".search-counter")).toHaveText("1 de 3");
  const first = await page
    .locator(".highlight")
    .getAttribute("data-message-id");
  await page.getByRole("button", { name: "Resultado seguinte" }).click();
  await expect(page.locator(".search-counter")).toHaveText("2 de 3");
  expect(
    await page.locator(".highlight").getAttribute("data-message-id"),
  ).not.toBe(first);
  await page.getByRole("button", { name: "Resultado anterior" }).click();
  expect(await page.locator(".highlight").getAttribute("data-message-id")).toBe(
    first,
  );
  await page.getByPlaceholder("Pesquisar nesta conversa").press("Enter");
  await expect(page.locator(".search-counter")).toHaveText("2 de 3");
  await page.getByPlaceholder("Pesquisar nesta conversa").fill("cafe");
  await expect(page.locator(".highlight .message-text mark")).toHaveText(
    "cafe\u0301",
  );
  await page.getByPlaceholder("Pesquisar nesta conversa").press("Escape");
  await expect(
    page.getByRole("heading", { name: "Arquivo sintético" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Pesquisar nesta conversa")).toBeHidden();
  await startSearch(page, "nao-existe");
  await expect(page.locator(".search-counter")).toHaveText("Sem resultados");
});

test("calendar offers the next date instead of silently skipping an empty day", async ({
  page,
}) => {
  await importArchive(page);
  await menu(page, "Pesquisar");
  await page.getByRole("button", { name: "Pesquisar por data" }).click();
  await page.getByLabel("Escolher data", { exact: true }).fill("2026-10-22");
  await expect(
    page.getByText("Não há mensagens nesse dia.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ir para 23/10/2026" }).click();
  await expect(page.locator(".highlight .message-text")).toHaveText(
    "Outro dia.",
  );
  await page.getByRole("button", { name: "Pesquisar por data" }).click();
  await page.getByLabel("Escolher data", { exact: true }).fill("2026-10-21");
  await expect(page.locator(".highlight .message-text")).toHaveText(
    "Legenda da imagem vermelha.",
  );
});

test("complete ZIP maps files to references, retains captions and reports unlinked files", async ({
  page,
}) => {
  await importArchive(page);
  await startSearch(page, "Legenda da imagem vermelha");
  await expect(page.getByText("1 de 1", { exact: true })).toBeVisible();
  const red = page.locator(".highlight");
  await expect(red.locator("img")).toHaveAttribute(
    "alt",
    "media/z-vermelho.png",
  );
  await expect(red).toContainText("10:00");
  await expect(red).toHaveAttribute("data-side", "other");
  const pixel = await red.locator("img").evaluate(async (img) => {
    const image = img as HTMLImageElement;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  });
  expect(pixel).toEqual([210, 40, 35]);
  await page
    .getByPlaceholder("Pesquisar nesta conversa")
    .fill("Legenda sem imagem");
  await expect(page.locator(".highlight .omitted-attachment")).toHaveText(
    "Imagem não incluída",
  );
  await expect(page.locator(".highlight .download")).toHaveCount(0);
  await page.getByRole("button", { name: "Sair da pesquisa" }).click();
  await menu(page, "Detalhes");
  await expect(
    page.getByText(/anexos desta origem sem mensagem associada/),
  ).toBeVisible();
  await expect(page.getByText(/Nome de anexo ambíguo/)).toBeVisible();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await page.reload();
  await page.locator(".conversation").click();
  await menu(page, "Pesquisar");
  await page.getByRole("button", { name: "Pesquisar por data" }).click();
  await page.getByLabel("Escolher data", { exact: true }).fill("2026-10-21");
  const audio = page.locator("audio");
  await expect(audio).toHaveAttribute("src", /^blob:/);
  await expect(audio).toHaveAttribute("preload", "none");
  await expect(
    page.getByRole("link", { name: "Descarregar documento.txt" }),
  ).toHaveAttribute("download", "documento.txt");
});

test("landing has no archive access or PWA registration; manifest launches app", async ({
  page,
  context,
  baseURL,
}) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw Error("Landing must not open IndexedDB");
    };
  });
  await page.goto(baseURL!);
  await expect(
    page.getByRole("heading", { name: "As conversas ficam contigo." }),
  ).toBeVisible();
  await expect(page.locator("link[rel=manifest]")).toHaveCount(0);
  await expect(page.locator("script")).toHaveCount(1);
  await expect(page.locator("script")).toHaveAttribute(
    "src",
    new URL("installed-entry.js", baseURL!).pathname,
  );
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((r) => r.length),
    ),
  ).toBe(0);
  const manifest = await (
    await context.request.get("app/manifest.webmanifest")
  ).json();
  const rootPath = new URL(baseURL!).pathname;
  expect(manifest.start_url).toBe(rootPath + "app/");
  expect(manifest.scope).toBe(rootPath + "app/");
  expect(manifest.id).toBe(rootPath);
  await expect(
    page.getByRole("link", { name: "Instalar aplicação", exact: true }),
  ).toHaveAttribute("href", "./app/?install=1");
});

test("no personal content leaves the browser during import, search, media and offline reopening", async ({
  page,
  context,
  baseURL,
}) => {
  const requests: { url: string; method: string; body: string | null }[] = [],
    sockets: string[] = [];
  context.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method(), body: r.postData() }),
  );
  page.on("websocket", (s) => sockets.push(s.url()));
  await page.addInitScript(() => {
    navigator.sendBeacon = () => {
      throw Error("Unexpected beacon");
    };
  });
  await importArchive(page);
  await startSearch(page, "cafe");
  await expect(page.locator(".highlight mark")).toHaveText("cafe\u0301");
  await page.getByRole("button", { name: "Sair da pesquisa" }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => {}));
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page.locator(".conversation").click();
  await startSearch(page, "Legenda da imagem vermelha");
  await expect(page.locator(".highlight img")).toBeVisible();
  const origin = new URL(baseURL!).origin;
  expect(
    requests.filter(
      (r) => !r.url.startsWith(origin + "/") && !r.url.startsWith("blob:"),
    ),
  ).toEqual([]);
  expect(
    requests.filter((r) => r.method !== "GET" && r.method !== "HEAD"),
  ).toEqual([]);
  expect(requests.filter((r) => r.body !== null)).toEqual([]);
  expect(
    requests.some((r) =>
      /cafe|vermelho|Ana|documento|arquivo-sintetico/i.test(r.url),
    ),
  ).toBe(false);
  expect(sockets).toEqual([]);
});

for (const width of [360, 412, 1280])
  test(`synthetic visual review at ${width}px`, async ({ page, browser, baseURL }) => {
    const desktop=width===1280?await browser.newContext({isMobile:false,hasTouch:false,viewport:{width:1280,height:900}}):undefined;
    if(desktop)page=await desktop.newPage();
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.goto(baseURL!);
    await page.screenshot({
      path: `docs/screenshots/landing-${width}.png`,
      fullPage: true,
    });
    await importArchive(page);
    await startSearch(page, "Texto final");
    await expect(page.locator(".highlight .message-time")).toContainText(
      "Editada",
    );
    await expect(page.getByAltText("media/z-vermelho.png")).toBeVisible();
    await page.getByAltText("media/z-vermelho.png").evaluate(img=>(img as HTMLImageElement).decode());
    await page.screenshot({path:`docs/screenshots/in-conversation-search-${width}.png`,fullPage:true,style:".notice{visibility:hidden}"});
    await page.getByRole("button", { name: "Sair da pesquisa" }).click();
    await expect(page.getByAltText("media/z-vermelho.png")).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/conversation-${width}.png`,
      fullPage: true,
      style: ".notice{visibility:hidden}",
    });
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Chat Archive", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/list-${width}.png`,
      fullPage: true,
      style: ".notice{visibility:hidden}",
    });
    await page.getByPlaceholder("Pesquisar em todas as conversas").fill("cafe");
    await expect(page.locator(".result mark")).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/search-${width}.png`,
      fullPage: true,
      style: ".notice{visibility:hidden}",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.evaluate(()=>matchMedia('(hover: none)').matches)).toBe(width!==1280);
    await desktop?.close();
  });
test("synthetic video and audio use native playback without preloading", async ({
  page,
}) => {
  await page.goto("app/");
  const video = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ca3d34";
    ctx.fillRect(0, 0, 64, 48);
    const stream = canvas.captureStream(5);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<Blob>(
      (resolve) =>
        (recorder.onstop = () =>
          resolve(new Blob(chunks, { type: "video/webm" }))),
    );
    recorder.start();
    await new Promise((r) => setTimeout(r, 300));
    ctx.fillStyle = "#215ac8";
    ctx.fillRect(0, 0, 64, 48);
    await new Promise((r) => setTimeout(r, 300));
    recorder.stop();
    const blob = await done;
    stream.getTracks().forEach((t) => t.stop());
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await importArchive(page, new Uint8Array(video));
  const element = page.locator("video");
  await expect(element).toHaveAttribute("preload", "none");
  await expect(element).toHaveAttribute("src", /^blob:/);
  await element.evaluate((v) => (v as HTMLVideoElement).play());
  await expect
    .poll(() => element.evaluate((v) => (v as HTMLVideoElement).videoWidth))
    .toBe(64);
  await menu(page, "Pesquisar");
  await page.getByRole("button", { name: "Pesquisar por data" }).click();
  await page.getByLabel("Escolher data", { exact: true }).fill("2026-10-21");
  const audio = page.locator("audio");
  await audio.evaluate((a) => (a as HTMLAudioElement).play());
  await expect
    .poll(() => audio.evaluate((a) => (a as HTMLAudioElement).duration))
    .toBeCloseTo(0.25, 1);
});
test("format-1 backups written before these changes restore without reimporting", async ({
  page,
}) => {
  await page.goto("app/");
  await page.getByRole("button", { name: "Definições", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Restaurar cópia", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "legacy-format-1.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(await legacyBackup()),
  });
  await page.getByRole("button", { name: /Cópia sintética antiga/ }).click();
  await expect(page.getByAltText("pasta/legacy.png")).toBeVisible();
  await expect(page.locator("[data-side=self] .message-time")).toContainText(
    "Editada",
  );
  expect(await storedTexts(page)).toContain(
    "Texto final <Esta mensagem foi editada>",
  );
});
test("legacy standalone entry forwards to app and keeps the same archive and manifest identity", async ({
  page,
  context,
  baseURL,
}) => {
  await importArchive(page);
  const before = await storedTexts(page);
  await page.addInitScript(() => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === "(display-mode: standalone)"
        ? { ...native(query), matches: true }
        : native(query);
  });
  await page.goto(baseURL!);
  await expect(page).toHaveURL(new URL("app/", baseURL!).href);
  await expect(page.locator(".conversation")).toHaveCount(1);
  expect(await storedTexts(page)).toEqual(before);
  const previous = await (
      await context.request.get("manifest.webmanifest")
    ).json(),
    current = await (
      await context.request.get("app/manifest.webmanifest")
    ).json();
  expect(previous).toEqual(current);
  expect(current.id).toBe(new URL(baseURL!).pathname);
  expect(current.start_url).toBe(new URL(baseURL!).pathname + "app/");
});
