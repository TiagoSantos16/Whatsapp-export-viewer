import { test, expect, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { readFileSync } from "node:fs";

async function add(page: Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Adicionar ZIP ou TXT" }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: name.endsWith(".zip") ? "application/zip" : "text/plain",
    buffer,
  });
  await expect(
    page.getByRole("heading", { name: "Rever importação" }),
  ).toBeVisible();
}

test("same ZIP can add media after text-only import without duplicating messages", async ({
  page,
}) => {
  await page.goto("app/");
  const zip = Buffer.from(
    zipSync({
      "chat.txt": strToU8(
        "21/10/2026, 18:00 - Ana: <attached: a.png>\n21/10/2026, 18:01 - João: Obrigado",
      ),
      "a.png": readFileSync("public/icons/icon-192.png"),
    }),
  );
  await add(page, "same.zip", zip);
  await page.getByLabel("Nome da conversa", { exact: true }).fill("Só texto");
  await page
    .getByLabel("Quem sou eu", { exact: true })
    .selectOption({ label: "João" });
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Guardar e abrir" }).click();
  await expect(page.getByRole("heading", { name: "Só texto" })).toBeVisible();
  await expect(
    page.getByText("Imagem não incluída", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await add(page, "same.zip", zip);
  await expect(page.getByLabel("Guardar em")).not.toHaveValue("");
  await expect(page.getByLabel("Quem sou eu", { exact: true })).not.toHaveValue(
    "",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Guardar e abrir" }).click();
  await expect(page.locator(".attachment img")).toBeVisible();
  await expect(page.locator(".message-text")).toHaveCount(2);
  await page.getByRole("button", { name: "Mais opções", exact: true }).click();
  await page.getByRole("menuitem", { name: "Detalhes", exact: true }).click();
  await expect(page.getByText(/2 mensagens ·/)).toBeVisible();
});

test("overlapping exports use confirmed identities and preserve source provenance", async ({
  page,
}) => {
  await page.goto("app/");
  await add(page, "first.txt", readFileSync("tests/fixtures/android.txt"));
  await page
    .getByLabel("Nome da conversa", { exact: true })
    .fill("Sobreposição");
  await page
    .getByLabel("Quem sou eu", { exact: true })
    .selectOption({ label: "João" });
  await page.getByRole("button", { name: "Guardar e abrir" }).click();
  await expect(
    page.getByRole("heading", { name: "Sobreposição" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await add(page, "second.txt", readFileSync("tests/fixtures/overlap.txt"));
  await page.getByLabel("Guardar em").selectOption({ label: "Sobreposição" });
  await expect(
    page.getByLabel("Identidade de “Ana” nesta origem"),
  ).not.toHaveValue("");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(
      "1 novas mensagens; 3 correspondências seguras",
    );
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Guardar e abrir" }).click();
  await expect(
    page.getByRole("heading", { name: "Sobreposição" }),
  ).toBeVisible();
  await expect(page.locator(".message-text")).toHaveCount(5);
  await page.getByRole("button", { name: "Mais opções", exact: true }).click();
  await page.getByRole("menuitem", { name: "Detalhes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "first.txt" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "second.txt" })).toBeVisible();
});

test("chooses one TXT and never resolves a colliding attachment basename arbitrarily", async ({
  page,
}) => {
  await page.goto("app/");
  const image = readFileSync("public/icons/icon-192.png");
  const zip = zipSync({
    "one.txt": strToU8("21/10/2026, 18:00 - Ana: <attached: a.png>"),
    "two.txt": strToU8("21/10/2026, 19:00 - João: Outra conversa"),
    "one/a.png": image,
    "two/a.png": image,
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Adicionar ZIP ou TXT" }).click();
  await (
    await chooser
  ).setFiles({
    name: "multiple.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  await page.getByRole("button", { name: "one.txt", exact: true }).click();
  await page.getByRole("button", { name: "Guardar e abrir" }).click();
  await expect(
    page.getByRole("heading", { name: "Conversa importada" }),
  ).toBeVisible();
  await expect(page.locator(".message-text")).toHaveCount(1);
  await expect(page.locator(".attachment img")).toHaveCount(0);
  await expect(
    page.getByText("Imagem não incluída", { exact: true }),
  ).toBeVisible();
});

test("imported HTML remains text, external links are explicit, no external requests", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("app/");
  await add(
    page,
    "safe.txt",
    Buffer.from(
      "21/10/2026, 18:00 - Ana: <img src=https://example.com/private onerror=alert(1)> https://example.com/test",
    ),
  );
  await page.getByRole("button", { name: "Guardar e abrir" }).click();
  await expect(page.locator(".message-text")).toContainText("<img");
  await expect(page.locator(".message-text img")).toHaveCount(0);
  await expect(page.locator(".message-text a").last()).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  expect(
    requests.filter(
      (url) =>
        !url.startsWith(new URL(page.url()).origin + "/") &&
        !url.startsWith("blob:"),
    ),
  ).toEqual([]);
});

test("abandoned pending data is removed on startup", async ({ page }) => {
  await page.goto("app/");
  await expect(
    page.getByRole("heading", { name: "Chat Archive" }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("chat-archive");
        r.onsuccess = () => {
          const t = r.result.transaction(["imports", "messages"], "readwrite");
          t.objectStore("imports").put({
            id: "pending",
            conversationId: "unpublished",
            status: "pending",
            hash: "fake",
            name: "synthetic.txt",
            text: "",
            warnings: [],
            created: "",
          });
          t.objectStore("messages").put({
            id: "partial",
            conversationId: "unpublished",
            sourceId: "pending",
            position: 0,
            text: "Synthetic pending record",
          });
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        };
      }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Chat Archive" }),
  ).toBeVisible();
  const counts = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const r = indexedDB.open("chat-archive");
        r.onsuccess = () => {
          const t = r.result.transaction(["imports", "messages"]);
          const a = t.objectStore("imports").count(),
            b = t.objectStore("messages").count();
          t.oncomplete = () => resolve([a.result, b.result]);
        };
      }),
  );
  expect(counts).toEqual([0, 0]);
});
