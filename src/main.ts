import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import {
  Virtualizer,
  observeElementRect,
  observeElementOffset,
  elementScroll,
} from "@tanstack/virtual-core";
import { db, cleanup, conversations, page, messagesFor } from "./storage/db";
import { withArchiveLock } from "./storage/lock";
import { inspect, analyze } from "./import/client";
import { saveImport, planImport, type ImportConfig } from "./import/save";
import { exportBackup, restoreBackup } from "./backup/archive";
import {
  search,
  conversationMatches,
  type ConversationHit,
} from "./search/search";
import {
  presentMessage,
  visibleText,
  type OmittedKind,
} from "./components/presentation";
import { appendHighlighted } from "./components/highlight";
import { snippet } from "./search/matching";
import { updateLegacyWorker } from "./app/legacy-worker";
import {
  el,
  button,
  field,
  select,
  input,
  icon,
} from "./components/dom";
import type { Conversation, Prepared, Message, Participant } from "./types";
import { matchPath, messageSide } from "./utils/core";
const root = document.querySelector<HTMLDivElement>("#app")!;
let busy = false;
let dispose = () => {};
let current: Conversation | undefined;
let offlineReady = false;
let updateAvailable = false;
let installRequested = new URLSearchParams(location.search).has("install");
void updateLegacyWorker().catch(() => {
  /* Keep the archive usable if an old worker cannot update yet. */
});
let installEvent:
  | (Event & {
      prompt?: () => Promise<void>;
    })
  | undefined;
const notice = el("div", "notice");
notice.setAttribute("role", "status");
document.body.append(notice);
let noticeTimer: ReturnType<typeof setTimeout>;
function toast(text: string) {
  notice.textContent = text;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.hidden = true), 7000);
}
function error(e: unknown) {
  toast(
    e instanceof DOMException && e.name === "QuotaExceededError"
      ? "Sem espaço suficiente. A importação não foi concluída. Liberta espaço ou importa apenas texto."
      : e instanceof Error
        ? e.message
        : "Não foi possível concluir. Tenta novamente.",
  );
}
function run(fn: () => Promise<unknown>) {
  void fn().catch(error);
}
function screen(title: string, back?: () => void) {
  dispose();
  dispose = () => {};
  root.replaceChildren();
  const header = el("header");
  if (back) {
    const b = button("", back, "icon-button");
    b.setAttribute("aria-label", "Voltar");
    b.append(icon("back"));
    header.append(b);
  }
  header.append(el("h1", "", title));
  root.append(header);
  return header;
}
function status() {
  const n = el(
    "p",
    "status",
    !navigator.onLine
      ? "Sem ligação · arquivo local"
      : offlineReady
        ? "Disponível offline"
        : "A preparar disponibilidade offline…",
  );
  return n;
}
function refreshStatus() {
  const text = status().textContent;
  document.querySelectorAll("p.status").forEach((n) => (n.textContent = text));
}
if ("serviceWorker" in navigator)
  void navigator.serviceWorker.ready.then((registration) => {
    if (
      registration.scope ===
      new URL(import.meta.env.BASE_URL + "app/", location.origin).href
    ) {
      offlineReady = true;
      refreshStatus();
    }
  });
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  if (installRequested && !busy) run(preferences);
});
window.addEventListener("online", () => toast("Ligação disponível."));
window.addEventListener("offline", () =>
  toast("Sem ligação. Podes consultar o arquivo local."),
);
const update = registerSW({
  onOfflineReady() {
    offlineReady = true;
    refreshStatus();
    toast("Aplicação preparada para abrir offline.");
  },
  onNeedRefresh() {
    updateAvailable = true;
    toast("Atualização disponível nas definições.");
  },
});
async function setTheme(value?: string) {
  const t = value || (await (await db).get("settings", "theme")) || "system";
  document.documentElement.dataset.theme = String(t);
}
function pick(accept: string, action: (file: File) => Promise<void>) {
  const f = input("file");
  f.accept = accept;
  f.onchange = () => {
    const file = f.files?.[0];
    if (file) run(() => action(file));
  };
  f.click();
}
async function home() {
  current = undefined;
  const list = await conversations();
  const header = screen("Chat Archive");
  const settings = button("", () => run(preferences), "icon-button");
  settings.setAttribute("aria-label", "Definições");
  settings.append(icon("settings"));
  header.append(settings);
  root.append(status());
  const body = el("main", "home");
  const lead = el("div", "home-lead");
  lead.append(
    el("h2", "", "O teu arquivo de conversas"),
    el(
      "p",
      "muted",
      "Guarda exportações do WhatsApp para as releres e pesquisares mais tarde.",
    ),
  );
  body.append(lead);
  const add = button(
    "Adicionar ZIP ou TXT",
    () => pick(".zip,.txt", startImport),
    "primary",
  );
  body.append(add);
  body.append(searchBox());
  if (!list.length) {
    const empty = el("section", "empty");
    empty.append(
      icon("archive"),
      el("h2", "", "Ainda não tens conversas guardadas."),
      el(
        "p",
        "muted",
        "Adiciona uma exportação ZIP ou TXT guardada no teu dispositivo. O conteúdo fica aqui.",
      ),
    );
    body.append(empty);
  } else {
    const ul = el("div", "conversations");
    for (const c of list) {
      const row = button(
        "",
        () => run(() => openConversation(c.id)),
        "conversation",
      );
      const avatar = el(
        "span",
        "avatar",
        c.name
          .split(/\s+/)
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toUpperCase(),
      );
      const copy = el("span", "conversation-copy");
      const line = el("span", "conversation-line");
      line.append(
        el("strong", "", c.name),
        el("time", "", c.lastDate.slice(0, 10).split("-").reverse().join("/")),
      );
      copy.append(line, el("span", "preview", visibleText(c.preview)));
      row.append(avatar, copy);
      ul.append(row);
    }
    body.append(ul);
  }
  root.append(body);
}
function searchBox() {
  const section = el("section", "search-section"),
    q = input("search"),
    results = el("div", "search-results");
  q.placeholder = "Pesquisar em todas as conversas";
  q.setAttribute("aria-label", q.placeholder);
  section.append(q, results);
  let timer: ReturnType<typeof setTimeout>,
    generation = 0,
    cursor: string | undefined;
  async function execute(append = false) {
    const token = ++generation;
    if (!append) {
      results.replaceChildren();
      cursor = undefined;
    }
    if (!q.value.trim()) return;
    const found = await search(q.value, undefined, append ? cursor : undefined);
    if (token !== generation) return;
    const all = await conversations();
    for (const m of found.results) {
      const c = all.find((x) => x.id === m.conversationId);
      const b = button(
        "",
        () => run(() => openConversation(m.conversationId, m.id)),
        "result",
      );
      const top = el("span", "result-heading");
      top.append(
        el("strong", "", c?.name || "Conversa"),
        el(
          "time",
          "",
          m.date?.key.replace("T", " ").slice(0, 16) || "Data desconhecida",
        ),
      );
      const excerpt = snippet(visibleText(m.text), q.value),
        body = el("span", "result-snippet");
      if (excerpt.leading) body.append(document.createTextNode("…"));
      const content = el("span");
      appendHighlighted(content, excerpt.text, q.value, false);
      body.append(content);
      if (excerpt.trailing) body.append(document.createTextNode("…"));
      b.append(top, body);
      if (c?.kind === "group")
        b.append(el("span", "result-author", m.author || "Sistema"));
      results.append(b);
    }
    cursor = found.after;
    if (!append && !found.results.length)
      results.append(el("p", "muted", "Sem resultados"));
    if (found.more) {
      const more = button("Há mais resultados · Continuar", () => {
        more.remove();
        run(() => execute(true));
      });
      results.append(more);
    }
  }
  q.oninput = () => {
    clearTimeout(timer);
    generation++;
    timer = setTimeout(() => run(() => execute()), 180);
  };
  q.onkeydown = (e) => {
    if (e.key === "Escape") {
      q.value = "";
      generation++;
      results.replaceChildren();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.querySelector("button.result"))
        (results.querySelector("button.result") as HTMLButtonElement).click();
      else run(() => execute());
    }
  };
  return section;
}
async function startImport(file: File, target = "") {
  if (busy) return;
  busy = true;
  const abort = new AbortController();
  const header = screen("Adicionar conversa");
  const body = el("main", "form-page");
  const progress = el("p", "progress", "Leitura do ficheiro…");
  progress.setAttribute("role", "status");
  const cancel = button("Cancelar", () => {
    abort.abort();
    busy = false;
    run(home);
  });
  body.append(progress, cancel);
  root.append(body);
  try {
    const inspected = await inspect(file);
    if (abort.signal.aborted) return;
    const duplicate = (
      await (await db).getAllFromIndex("imports", "hash", inspected.hash)
    ).find((x) => x.status === "complete");
    if (duplicate) {
      const d = await db;
      const keys = await d.getAllKeysFromIndex(
        "attachments",
        "conversation",
        duplicate.conversationId,
      );
      const available = new Set<string>();
      for (const key of keys) {
        const a = await d.get("attachments", key);
        if (a) available.add(a.path);
      }
      if (inspected.paths.some((path) => !available.has(path))) {
        target = duplicate.conversationId;
        toast(
          "Origem já guardada. Podes acrescentar os anexos em falta sem duplicar mensagens.",
        );
      } else {
        busy = false;
        toast("Este ficheiro já foi importado.");
        await openConversation(duplicate.conversationId);
        return;
      }
    }
    async function configure(text: string) {
      progress.textContent = "Análise das mensagens…";
      const parsed = await analyze(text);
      if (abort.signal.aborted) return;
      const prepared: Prepared = { ...inspected, text, parsed };
      await importForm(prepared, target, abort);
    }
    if (inspected.candidates.length > 1) {
      progress.textContent =
        "Este ZIP contém vários TXT. Escolhe uma conversa.";
      for (const [path, text] of inspected.candidates)
        body.append(button(path, () => run(() => configure(text))));
    } else await configure(inspected.candidates[0][1]);
  } catch (e) {
    busy = false;
    progress.textContent = "A importação não foi concluída.";
    error(e);
    header.append(button("Voltar", () => run(home)));
  }
}
async function importForm(p: Prepared, target: string, abort: AbortController) {
  const d = await db;
  const list = await conversations();
  screen("Rever importação");
  const body = el("main", "form-page");
  root.append(body);
  const dates = p.parsed.messages.filter((m) => m.date);
  body.append(
    el("h2", "", "Confirma os dados da conversa"),
    el(
      "p",
      "muted",
      `${p.parsed.messages.length.toLocaleString("pt-PT")} mensagens · ${dates[0]?.date?.key.slice(0, 10) || "Sem data"} a ${dates.at(-1)?.date?.key.slice(0, 10) || "Sem data"}`,
    ),
    el(
      "p",
      "",
      `Participantes: ${p.parsed.authors.join(", ") || "Nenhum identificado"}`,
    ),
    el(
      "p",
      "",
      `${p.paths.length} anexos possíveis · até ${(p.attachmentBytes / 1048576).toFixed(1)} MB descomprimidos (estimativa)`,
    ),
  );
  for (const warning of p.parsed.warnings)
    body.append(el("p", "warning", warning));
  const estimate = await navigator.storage?.estimate?.();
  if (
    estimate?.quota &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < p.attachmentBytes * 1.2
  )
    body.append(
      el(
        "p",
        "warning",
        "Pode não haver espaço suficiente. Podes importar só o texto. O espaço indicado é uma estimativa, não uma garantia.",
      ),
    );
  const destination = select(
    [
      ["", "Criar nova conversa"],
      ...list.map((c) => [c.id, c.name] as [string, string]),
    ],
    target,
  );
  body.append(field("Guardar em", destination));
  const name = input("text", "Conversa importada");
  name.required = true;
  const kind = select(
    [
      ["individual", "Individual"],
      ["group", "Grupo"],
    ],
    p.parsed.authors.length > 2 ? "group" : "individual",
  );
  const self = select([
    ["", "Ainda não sei / não estou na lista"],
    ...p.parsed.authors.map((a) => [a, a] as [string, string]),
  ]);
  const exporter = select([
    ["", "Não sei"],
    ...p.parsed.authors.map((a) => [a, a] as [string, string]),
  ]);
  body.append(
    field("Nome da conversa", name),
    field("Tipo", kind),
    field("Quem sou eu", self),
    field("Quem forneceu a exportação", exporter),
  );
  const order = select(
    [
      ["DMY", "Dia / mês / ano"],
      ["MDY", "Mês / dia / ano"],
    ],
    p.parsed.order,
  );
  body.append(
    field(
      p.parsed.ambiguous ? "Confirma a ordem das datas" : "Ordem das datas",
      order,
    ),
  );
  order.onchange = () =>
    run(async () => {
      p.parsed = await analyze(p.text, order.value as "DMY" | "MDY");
      toast(
        "Datas reinterpretadas: " +
          (p.parsed.messages.find((m) => m.date)?.date?.key.slice(0, 10) ||
            "sem data"),
      );
    });
  const media = input("checkbox");
  media.checked = true;
  body.append(
    field("Importar todos os anexos (desmarca para apenas texto)", media),
  );
  const aliasFields = el("div");
  body.append(aliasFields);
  const aliasInputs = new Map<string, HTMLSelectElement>();
  async function loadTarget() {
    const c = list.find((x) => x.id === destination.value);
    aliasFields.replaceChildren();
    aliasInputs.clear();
    if (c) {
      name.value = c.name;
      kind.value = c.kind;
      const people = await d.getAllFromIndex(
        "participants",
        "conversation",
        c.id,
      );
      const aliases = await d.getAllFromIndex(
        "participantAliases",
        "conversation",
        c.id,
      );
      self.replaceChildren(
        ...select(
          [
            ["", "Ainda não definido"],
            ...people.map((p) => [p.id, p.name] as [string, string]),
          ],
          c.selfId || "",
        ).children,
      );
      self.value = c.selfId || "";
      for (const a of p.parsed.authors) {
        const found = [
          ...new Set(
            aliases.filter((x) => x.original === a).map((x) => x.participantId),
          ),
        ];
        const s = select(
          [
            ["", "Criar pessoa separada"],
            ...people.map((p) => [p.id, p.name] as [string, string]),
          ],
          found.length === 1 ? found[0] : "",
        );
        aliasInputs.set(a, s);
        aliasFields.append(field(`Identidade de “${a}” nesta origem`, s));
      }
      aliasFields.prepend(
        el(
          "p",
          "muted",
          "Confirma cada identidade. Nomes iguais podem pertencer a pessoas diferentes.",
        ),
      );
    } else {
      self.replaceChildren(
        ...select([
          ["", "Ainda não sei / não estou na lista"],
          ...p.parsed.authors.map((a) => [a, a] as [string, string]),
        ]).children,
      );
    }
  }
  destination.onchange = () => run(loadTarget);
  await loadTarget();
  const progress = el("p", "progress");
  progress.setAttribute("role", "status");
  const confirm = button(
    "Guardar e abrir",
    () =>
      run(async () => {
        if (!name.value.trim()) {
          toast("Indica um nome para a conversa.");
          return;
        }
        confirm.disabled = true;
        try {
          p.parsed = await analyze(p.text, order.value as "DMY" | "MDY");
          const config: ImportConfig = {
            name: name.value.trim(),
            kind: kind.value as "individual" | "group",
            self: self.value,
            exporter: exporter.value,
            target: destination.value,
            media: media.checked,
            aliases: Object.fromEntries(
              [...aliasInputs].map(([a, s]) => [a, s.value]),
            ),
          };
          if (config.target) {
            const plan = await planImport(p, config);
            const summary = `${plan.additions.length} novas mensagens; ${plan.matches.size} correspondências seguras; até ${config.media ? p.paths.length : 0} novos anexos; ${plan.ambiguous} casos ambíguos conservados.`;
            if (!window.confirm(summary + "\n\nConcluir a complementação?")) {
              confirm.disabled = false;
              return;
            }
          }
          await d.put("settings", true, "importStarted");
          const id = await saveImport(
            p,
            config,
            (s) => (progress.textContent = s),
            abort.signal,
          );
          busy = false;
          if (navigator.storage?.persist)
            void navigator.storage.persist().catch(() => false);
          await openConversation(id);
          toast("Conversa guardada.");
        } catch (e) {
          confirm.disabled = false;
          error(e);
        }
      }),
    "primary",
  );
  body.append(
    progress,
    confirm,
    button("Cancelar", () => {
      abort.abort();
      busy = false;
      run(home);
    }),
  );
}
async function openConversation(id: string, focusId?: string) {
  const d = await db;
  const c = await d.get("conversations", id);
  if (!c) throw Error("Conversa não encontrada.");
  current = c;
  const people = await d.getAllFromIndex("participants", "conversation", id);
  const header = screen(c.name, () => run(home));
  header.classList.add("conversation-header");
  const avatar = el(
    "span",
    "avatar",
    c.name
      .split(/\s+/)
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
  );
  header.insertBefore(avatar, header.querySelector("h1"));
  const menuButton = button(
    "",
    () => {
      menu.hidden = !menu.hidden;
      menuButton.setAttribute("aria-expanded", String(!menu.hidden));
    },
    "icon-button",
  );
  menuButton.setAttribute("aria-label", "Mais opções");
  menuButton.setAttribute("aria-haspopup", "menu");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.append(icon("menu"));
  const menu = el("div", "conversation-menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  const searchAction = button("Pesquisar", () => enterSearch()),
    detailsAction = button("Detalhes", () => run(() => details(c)));
  for (const action of [searchAction, detailsAction])
    action.setAttribute("role", "menuitem");
  menu.append(searchAction, detailsAction);
  header.append(menuButton, menu);
  const searchPanel = el("section", "conversation-search");
  searchPanel.hidden = true;
  searchPanel.setAttribute("aria-label", "Pesquisa na conversa");
  const searchTop = el("div", "search-top"),
    searchNav = el("div", "search-navigation");
  const queryInput = input("search");
  queryInput.placeholder = "Pesquisar nesta conversa";
  queryInput.setAttribute("aria-label", queryInput.placeholder);
  const closeSearch = button("", () => leaveSearch(), "icon-button");
  closeSearch.setAttribute("aria-label", "Sair da pesquisa");
  closeSearch.append(icon("back"));
  const calendar = button(
    "",
    () => {
      datePanel.hidden = !datePanel.hidden;
      if (!datePanel.hidden) {
        date.focus();
        try {
          date.showPicker?.();
        } catch {
          /* Native picker may require a direct gesture. */
        }
      }
    },
    "icon-button",
  );
  calendar.setAttribute("aria-label", "Pesquisar por data");
  calendar.append(icon("calendar"));
  const datePanel = el("div", "date-panel");
  datePanel.hidden = true;
  const date = input("date");
  date.setAttribute("aria-label", "Escolher data");
  datePanel.append(field("Escolher data", date));
  const counter = el("span", "search-counter", "Escreve para pesquisar");
  counter.setAttribute("role", "status");
  const previous = button("", () => moveMatch(-1), "icon-button"),
    next = button("", () => moveMatch(1), "icon-button");
  previous.setAttribute("aria-label", "Resultado anterior");
  next.setAttribute("aria-label", "Resultado seguinte");
  previous.append(icon("up"));
  next.append(icon("down"));
  previous.disabled = next.disabled = true;
  const dateStatus = el("div", "date-status");
  dateStatus.setAttribute("role", "status");
  searchTop.append(closeSearch, queryInput, calendar);
  searchNav.append(counter, previous, next);
  searchPanel.append(searchTop, searchNav, datePanel, dateStatus);
  root.append(searchPanel);
  let searchQuery = "",
    searchMode = false,
    searchHits: ConversationHit[] = [],
    hitIndex = -1,
    searchAbort: AbortController | undefined,
    searchTimer: ReturnType<typeof setTimeout>;
  const scroller = el("main", "messages");
  scroller.setAttribute("aria-label", "Mensagens da conversa");
  const canvas = el("div", "message-canvas");
  scroller.append(canvas);
  root.append(scroller);
  const latest = button(
    "",
    () => jump(Math.max(0, c.messageCount - 1)),
    "to-latest icon-button",
  );
  latest.setAttribute("aria-label", "Ir para as mensagens mais recentes");
  latest.append(icon("down"));
  latest.hidden = true;
  root.append(latest);
  const cache = new Map<number, Message[]>();
  const keys = new Map<number, string>();
  const loading = new Set<number>();
  const rendered = new Map<
    number,
    {
      node: HTMLElement;
      release: () => void;
    }
  >();
  let active = true;
  let highlighted = focusId;
  let pendingJump = 0;
  let saving: ReturnType<typeof setTimeout>;
  let initialIndex = Math.max(0, c.messageCount - 1);
  let initialOffset = 0;
  if (focusId || c.read) {
    const m = await d.get("messages", focusId || c.read!.id);
    if (m && m.conversationId === id) {
      initialIndex = m.position;
      initialOffset = focusId ? 0 : c.read?.offset || 0;
    }
  }
  const block = (i: number) => Math.floor(i / 200) * 200;
  async function load(index: number) {
    const offset = block(index);
    if (cache.has(offset) || loading.has(offset)) return;
    loading.add(offset);
    const data = await page(id, offset);
    loading.delete(offset);
    if (!active) return;
    cache.set(offset, data);
    for (const m of data) keys.set(m.position, m.id);
    if (cache.size > 12) {
      const far = [...cache.keys()].sort(
        (a, b) => Math.abs(b - index) - Math.abs(a - index),
      )[0];
      cache.delete(far);
    }
    render();
  }
  let virtualizer: Virtualizer<HTMLElement, HTMLElement> | undefined;
  await load(initialIndex);
  function get(i: number) {
    return cache.get(block(i))?.[i - block(i)];
  }
  function render() {
    if (!active || !virtualizer) return;
    canvas.style.height = `${virtualizer.getTotalSize()}px`;
    const items = virtualizer.getVirtualItems();
    const keep = new Set(items.map((i) => i.index));
    for (const [i, row] of rendered)
      if (!keep.has(i)) {
        row.release();
        row.node.remove();
        rendered.delete(i);
      }
    for (const item of items) {
      const m = get(item.index);
      if (!m) {
        void load(item.index).catch(error);
        continue;
      }
      let row = rendered.get(item.index);
      if (!row) {
        row = messageRow(
          m,
          get(item.index - 1),
          c!,
          people,
          highlighted === m.id,
          searchQuery,
        );
        row.node.dataset.index = String(item.index);
        canvas.append(row.node);
        rendered.set(item.index, row);
        virtualizer.measureElement(row.node);
      }
      row.node.style.transform = `translateY(${item.start}px)`;
    }
    canvas.style.height = `${virtualizer.getTotalSize()}px`;
  }
  virtualizer = new Virtualizer({
    count: c.messageCount,
    getScrollElement: () => scroller,
    estimateSize: () => 100,
    getItemKey: (i) => keys.get(i) || `${id}:${i}`,
    overscan: 8,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    onChange: () => {
      render();
      latest.hidden =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
        900;
      clearTimeout(saving);
      saving = setTimeout(() => void savePosition(), 250);
    },
  });
  const unmount = virtualizer!._didMount();
  virtualizer!._willUpdate();
  function jump(index: number, offset = 0, center = false) {
    pendingJump++;
    const token = pendingJump;
    void load(index)
      .then(() => {
        if (!active || token !== pendingJump) return;
        virtualizer!.scrollToIndex(index, {
          align: center ? "center" : "start",
        });
        requestAnimationFrame(() => {
          if (!active || token !== pendingJump) return;
          virtualizer!.scrollToIndex(index, {
            align: center ? "center" : "start",
          });
          if (offset) scroller.scrollTop += offset;
          render();
        });
      })
      .catch(error);
  }
  async function savePosition() {
    if (!virtualizer) return;
    const first = virtualizer
      .getVirtualItems()
      .find((v) => v.end > scroller.scrollTop);
    const m = first && get(first.index);
    if (m) {
      c!.read = { id: m.id, offset: scroller.scrollTop - first!.start };
      const tx = d.transaction("conversations", "readwrite");
      const latest = await tx.store.get(id);
      if (latest) await tx.store.put({ ...latest, read: c!.read });
      await tx.done;
    }
  }
  function redraw() {
    for (const [index, row] of rendered) {
      const m = get(index);
      if (!m) continue;
      row.node.classList.toggle("highlight", m.id === highlighted);
      const text = row.node.querySelector<HTMLElement>(".message-text");
      if (text) {
        text.replaceChildren();
        appendHighlighted(text, presentMessage(m.text).text, searchQuery);
      }
    }
    render();
  }
  function enterSearch() {
    menu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    header.hidden = true;
    searchPanel.hidden = false;
    searchMode = true;
    queryInput.focus();
  }
  function leaveSearch() {
    searchAbort?.abort();
    clearTimeout(searchTimer);
    searchMode = false;
    searchQuery = "";
    queryInput.value = "";
    searchHits = [];
    hitIndex = -1;
    datePanel.hidden = true;
    dateStatus.replaceChildren();
    searchPanel.hidden = true;
    header.hidden = false;
    highlighted = undefined;
    redraw();
    menuButton.focus();
  }
  function selectMatch(index: number) {
    if (!searchHits.length) return;
    hitIndex = (index + searchHits.length) % searchHits.length;
    const hit = searchHits[hitIndex];
    counter.textContent = hitIndex + 1 + " de " + searchHits.length;
    highlighted = hit.id;
    redraw();
    jump(hit.position, 0, true);
  }
  function moveMatch(direction: number) {
    selectMatch(hitIndex + direction);
  }
  queryInput.oninput = () => {
    clearTimeout(searchTimer);
    searchAbort?.abort();
    searchQuery = queryInput.value.trim();
    searchHits = [];
    hitIndex = -1;
    previous.disabled = next.disabled = true;
    redraw();
    counter.textContent = searchQuery
      ? "A pesquisar…"
      : "Escreve para pesquisar";
    if (!searchQuery) return;
    const abort = new AbortController();
    searchAbort = abort;
    searchTimer = setTimeout(
      () =>
        run(async () => {
          const hits = await conversationMatches(searchQuery, id, abort.signal);
          if (abort.signal.aborted || !active || !searchMode) return;
          searchHits = hits;
          previous.disabled = next.disabled = !hits.length;
          if (!hits.length) {
            counter.textContent = "Sem resultados";
            return;
          }
          selectMatch(0);
        }),
      180,
    );
  };
  queryInput.onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      leaveSearch();
    } else if (e.key === "Enter") {
      e.preventDefault();
      moveMatch(e.shiftKey ? -1 : 1);
    }
  };
  menu.onkeydown = (e) => {
    if (e.key === "Escape") {
      menu.hidden = true;
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.focus();
    }
  };
  function showDated(m: Message) {
    highlighted = m.id;
    redraw();
    jump(m.position, 0, true);
    setTimeout(() => {
      if (!searchQuery) {
        highlighted = undefined;
        for (const row of rendered.values())
          row.node.classList.remove("highlight");
      }
    }, 3500);
  }
  date.onchange = () =>
    run(async () => {
      if (!date.value) return;
      datePanel.hidden = true;
      dateStatus.replaceChildren();
      const tx = d.transaction("messages");
      const cursor = await tx.store
        .index("date")
        .openCursor(IDBKeyRange.bound([id, date.value], [id, "\uffff"]));
      if (!cursor) {
        dateStatus.append(
          el("p", "", "Não há mensagens nesse dia nem numa data posterior."),
        );
        return;
      }
      const m = cursor.value;
      if (m.date?.key.slice(0, 10) === date.value) {
        showDated(m);
        return;
      }
      dateStatus.append(
        el("p", "", "Não há mensagens nesse dia."),
        button(
          "Ir para " + m.date!.key.slice(0, 10).split("-").reverse().join("/"),
          () => {
            dateStatus.replaceChildren();
            showDated(m);
          },
        ),
      );
    });
  dispose = () => {
    searchAbort?.abort();
    clearTimeout(searchTimer);
    void savePosition();
    active = false;
    clearTimeout(saving);
    unmount?.();
    for (const row of rendered.values()) row.release();
  };
  jump(initialIndex, initialOffset, !!focusId);
  if (highlighted)
    setTimeout(() => {
      for (const row of rendered.values())
        row.node.classList.remove("highlight");
    }, 3500);
}
function messageRow(
  m: Message,
  prev: Message | undefined,
  c: Conversation,
  people: Participant[],
  highlight: boolean,
  searchQuery = "",
) {
  const node = el("article", "message-row" + (highlight ? " highlight" : ""));
  const system = m.kind !== "message";
  const own = !!c.selfId && m.participantId === c.selfId;
  node.dataset.side = messageSide(m, c.selfId);
  node.dataset.messageId = m.id;
  if (m.date?.key.slice(0, 10) !== prev?.date?.key.slice(0, 10))
    node.append(
      el(
        "div",
        "day",
        m.date?.key.slice(0, 10).split("-").reverse().join("/") ||
          "Data desconhecida",
      ),
    );
  const grouped =
    prev?.participantId === m.participantId &&
    prev?.kind === m.kind &&
    prev?.date?.key.slice(0, 10) === m.date?.key.slice(0, 10);
  if (grouped) node.classList.add("grouped");
  const bubble = el("div", "bubble");
  const person = people.find((p) => p.id === m.participantId);
  if (!system && !own && !grouped) {
    const author = el(
      "strong",
      "author",
      person?.name || m.author || "Pessoa não identificada",
    );
    let hue = 0;
    for (const ch of m.participantId || m.author || "")
      hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    author.style.setProperty("--author-hue", String(hue));
    bubble.append(author);
  }
  const presentation = presentMessage(m.text);
  const text = el("div", "message-text");
  appendHighlighted(text, presentation.text, searchQuery);
  bubble.append(text);
  if (presentation.editOnly)
    bubble.append(
      el(
        "p",
        "message-state",
        "Mensagem editada sem texto disponível na exportação.",
      ),
    );
  if (presentation.deletion)
    bubble.append(el("p", "message-state", presentation.deletion));
  for (const kind of presentation.omissions) bubble.append(omittedBlock(kind));
  if (
    (system || !!presentation.deletion) &&
    /\b(tu|you|teu|tua|apagaste|você)\b/i.test(m.text)
  )
    bubble.append(
      el("small", "perspective", "Aviso na perspetiva de quem exportou."),
    );
  for (const warning of m.warnings)
    bubble.append(el("small", "perspective", warning));
  const urls: string[] = [];
  let released = false;
  for (const name of m.attachmentNames) {
    const placeholder = el("div", "attachment");
    if (m.attachmentIds.length) {
      placeholder.classList.add("attachment-loading");
      placeholder.textContent = "A abrir anexo…";
    } else placeholder.append(omittedBlock(fileKind(name)));
    bubble.append(placeholder);
    if (m.attachmentIds.length)
      run(async () => {
        const all = await Promise.all(
          m.attachmentIds.map((id) => db.then((d) => d.get("attachments", id))),
        );
        if (released) return;
        const path = matchPath(
          name,
          all.flatMap((a) => (a ? [a.path] : [])),
        );
        const a = all.find((a) => a?.path === path);
        placeholder.classList.remove("attachment-loading");
        if (!a) {
          placeholder.replaceChildren(omittedBlock(fileKind(name)));
          return;
        }
        const url = URL.createObjectURL(a.blob);
        urls.push(url);
        placeholder.replaceChildren();
        if (/^image\/(jpeg|png|webp|gif)$/.test(a.mime)) {
          const img = el("img");
          img.alt = name;
          img.src = url;
          img.loading = "lazy";
          img.width = 280;
          img.height = 210;
          const b = button("", () => showImage(url, name), "image-button");
          b.append(img);
          placeholder.append(b);
        } else if (/^(audio|video)\//.test(a.mime)) {
          const media = el(a.mime.startsWith("audio") ? "audio" : "video");
          media.controls = true;
          media.preload = "none";
          if (media.canPlayType(a.mime)) {
            media.src = url;
            placeholder.append(media);
            media.onerror = () =>
              placeholder.prepend(
                el("p", "", "Este formato não pode ser reproduzido aqui."),
              );
          } else
            placeholder.append(
              el("p", "", "Este formato não pode ser reproduzido aqui."),
            );
        }
        const link = el("a", "download", `Descarregar ${name}`);
        link.href = url;
        link.download = a.path.split("/").pop() || name;
        placeholder.append(link);
      });
  }
  if (m.date)
    bubble.append(
      el(
        "time",
        "message-time",
        `${presentation.edited ? "Editada · " : ""}${String(m.date.hour).padStart(2, "0")}:${String(m.date.minute).padStart(2, "0")}`,
      ),
    );
  node.append(bubble);
  return {
    node,
    release: () => {
      released = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}
function fileKind(name: string): OmittedKind {
  return /\.(png|jpe?g|gif|webp|heic)$/i.test(name)
    ? "Imagem"
    : /\.(mp4|webm|3gp|mov)$/i.test(name)
      ? "Vídeo"
      : /\.(mp3|m4a|ogg|opus|wav|amr|aac)$/i.test(name)
        ? "Áudio"
        : /\.(pdf|docx?|xlsx?|txt|csv|pptx?)$/i.test(name)
          ? "Documento"
          : "Ficheiro";
}
function omittedBlock(kind: OmittedKind) {
  const n = el("div", "omitted-attachment");
  n.append(
    icon(
      kind === "Imagem"
        ? "image"
        : kind === "Vídeo"
          ? "video"
          : kind === "Áudio"
            ? "audio"
            : "file",
    ),
    el(
      "span",
      "",
      kind + (kind === "Imagem" ? " não incluída" : " não incluído"),
    ),
  );
  return n;
}
function showImage(url: string, name: string) {
  const dialog = el("dialog", "image-dialog");
  dialog.setAttribute("aria-label", name);
  const img = el("img");
  img.src = url;
  img.alt = name;
  dialog.append(
    button("Fechar", () => dialog.close()),
    img,
  );
  document.body.append(dialog);
  dialog.onclose = () => dialog.remove();
  dialog.showModal();
}
async function details(c: Conversation) {
  const d = await db;
  const people = await d.getAllFromIndex("participants", "conversation", c.id);
  const aliases = await d.getAllFromIndex(
    "participantAliases",
    "conversation",
    c.id,
  );
  const sources = (
    await d.getAllFromIndex("imports", "conversation", c.id)
  ).filter((s) => s.status === "complete");
  screen("Detalhes da conversa", () => run(() => openConversation(c.id)));
  const body = el("main", "form-page");
  root.append(body);
  const name = input("text", c.name);
  const kind = select(
    [
      ["individual", "Individual"],
      ["group", "Grupo"],
    ],
    c.kind,
  );
  const self = select(
    [
      ["", "Ainda não definido"],
      ...people.map((p) => [p.id, p.name] as [string, string]),
    ],
    c.selfId || "",
  );
  body.append(
    field("Nome da conversa", name),
    field("Tipo", kind),
    field("Quem sou eu", self),
  );
  const names = new Map<string, HTMLInputElement>();
  const aliasMap = new Map<string, HTMLSelectElement>();
  body.append(el("h2", "", "Identidades e nomes apresentados"));
  for (const p of people) {
    const n = input("text", p.name);
    names.set(p.id, n);
    body.append(field("Nome apresentado", n));
  }
  for (const a of aliases) {
    const s = select(
      people.map((p) => [p.id, p.name]),
      a.participantId,
    );
    aliasMap.set(a.id, s);
    body.append(field(`Identidade original: ${a.original}`, s));
  }
  body.append(
    el(
      "p",
      "muted",
      "Associar aliases à mesma identidade altera o alinhamento das mensagens. Faz esta associação apenas quando tens a certeza.",
    ),
  );
  body.append(
    button(
      "Guardar alterações",
      () =>
        run(async () => {
          if (!name.value.trim()) throw Error("Indica o nome da conversa.");
          await withArchiveLock(async () => {
            const tx = d.transaction(
              [
                "conversations",
                "participants",
                "participantAliases",
                "messages",
              ],
              "readwrite",
            );
            const latest = await tx.objectStore("conversations").get(c.id);
            if (!latest) throw Error("Conversa não encontrada.");
            await tx.objectStore("conversations").put({
              ...latest,
              name: name.value.trim(),
              kind: kind.value as "individual" | "group",
              selfId: self.value || undefined,
            });
            for (const p of people)
              await tx
                .objectStore("participants")
                .put({ ...p, name: names.get(p.id)!.value.trim() || p.name });
            for (const a of aliases)
              await tx
                .objectStore("participantAliases")
                .put({ ...a, participantId: aliasMap.get(a.id)!.value });
            let cur = await tx
              .objectStore("messages")
              .index("conversation")
              .openCursor(c.id);
            while (cur) {
              const m = cur.value;
              const a = aliases.find(
                (a) =>
                  a.original === m.author &&
                  a.participantId === m.participantId,
              );
              if (a)
                await cur.update({
                  ...m,
                  participantId: aliasMap.get(a.id)!.value,
                });
              cur = await cur.continue();
            }
            await tx.done;
          });
          await openConversation(c.id);
          toast("Detalhes guardados.");
        }),
      "primary",
    ),
  );
  const all = await messagesFor(c.id);
  const dates = all.flatMap((m) => (m.date ? [m.date.key] : [])).sort();
  const attachCount = await d.countFromIndex(
    "attachments",
    "conversation",
    c.id,
  );
  const missing = all.filter(
    (m) =>
      m.attachmentNames.length > m.attachmentIds.length ||
      presentMessage(m.text).omissions.length > 0,
  ).length;
  body.append(
    el("h2", "", "Arquivo"),
    el(
      "p",
      "",
      `${c.messageCount.toLocaleString("pt-PT")} mensagens · ${dates[0]?.slice(0, 10) || "?"} a ${dates.at(-1)?.slice(0, 10) || "?"}`,
    ),
    el(
      "p",
      "",
      `${attachCount} anexos disponíveis · ${missing} mensagens com anexos ausentes`,
    ),
  );
  for (const s of sources) {
    body.append(
      el("h3", "", s.name),
      el(
        "p",
        "muted",
        `Origem: ${s.id.slice(0, 8)} · exportou: ${people.find((p) => p.id === s.exporterId)?.name || "não identificado"}`,
      ),
    );
    for (const w of s.warnings) body.append(el("p", "warning", w));
    const attached = await d.getAllKeysFromIndex("attachments", "source", s.id);
    const linked = new Set(all.flatMap((m) => m.attachmentIds));
    const unlinked = attached.filter((id) => !linked.has(id));
    if (unlinked.length)
      body.append(
        el(
          "p",
          "muted",
          `${unlinked.length} anexos desta origem sem mensagem associada. Estão guardados, mas não aparecem num ponto arbitrário do histórico.`,
        ),
      );
  }
  body.append(
    button("Complementar com outra exportação", () =>
      pick(".zip,.txt", (f) => startImport(f, c.id)),
    ),
  );
}
async function preferences() {
  const d = await db;
  screen("Definições", () => run(home));
  const body = el("main", "form-page");
  root.append(body);
  const theme = select(
    [
      ["system", "Seguir o sistema"],
      ["light", "Claro"],
      ["dark", "Escuro"],
    ],
    String((await d.get("settings", "theme")) || "system"),
  );
  theme.onchange = () =>
    run(async () => {
      await d.put("settings", theme.value, "theme");
      await setTheme(theme.value);
    });
  body.append(field("Tema", theme), status());
  if (updateAvailable)
    body.append(
      button("Atualização disponível · Aplicar", () => {
        if (busy) {
          toast("Conclui a operação atual antes de atualizar.");
          return;
        }
        void update(true);
      }),
    );
  if (installEvent?.prompt)
    body.append(
      button("Instalar Chat Archive", () =>
        run(async () => {
          await installEvent?.prompt?.();
          installEvent = undefined;
          installRequested = false;
          await preferences();
        }),
      ),
    );
  else
    body.append(
      el(
        "p",
        "muted",
        "No Chrome para Android: abre o menu ⋮ e escolhe “Adicionar ao ecrã principal” ou “Instalar aplicação”.",
      ),
    );
  body.append(
    el("h2", "", "Cópia de segurança"),
    el(
      "p",
      "warning",
      "A cópia pode incluir dados pessoais e não é cifrada. Guarda-a num local protegido.",
    ),
  );
  const last = await d.get("settings", "lastBackup");
  body.append(
    el(
      "p",
      "muted",
      last
        ? "Última cópia: " + new Date(String(last)).toLocaleString("pt-PT")
        : "Ainda não guardaste uma cópia.",
    ),
  );
  const progress = el("p", "progress");
  progress.setAttribute("role", "status");
  const backup = button(
    "Guardar cópia de segurança",
    () =>
      run(async () => {
        if (busy) return;
        busy = true;
        backup.disabled = true;
        try {
          const blob = await exportBackup((s) => (progress.textContent = s));
          const url = URL.createObjectURL(blob);
          const link = el("a", "download", "Descarregar cópia preparada");
          link.href = url;
          link.download = `chat-archive-${new Date().toISOString().slice(0, 10)}.zip`;
          body.append(link);
          link.click();
          dispose = () => URL.revokeObjectURL(url);
          progress.textContent =
            "Cópia preparada. Confirma que ficou guardada em Transferências.";
        } finally {
          busy = false;
          backup.disabled = false;
        }
      }),
    "primary",
  );
  body.append(
    backup,
    button("Restaurar cópia", () =>
      pick(".zip", async (file) => {
        if (busy) return;
        const count = (await conversations()).length;
        if (
          count &&
          !window.confirm(
            "As conversas da cópia serão acrescentadas separadamente. Os dados atuais serão mantidos. Continuar?",
          )
        )
          return;
        busy = true;
        try {
          await restoreBackup(file, (s) => (progress.textContent = s));
          toast("Cópia restaurada.");
          await home();
        } finally {
          busy = false;
        }
      }),
    ),
    progress,
    el("h2", "", "Armazenamento local"),
    el(
      "p",
      "muted",
      "As conversas ficam guardadas neste navegador e neste endereço. Se limpares os dados do site ou da aplicação, podes perder o arquivo. Mantém os ficheiros originais e uma cópia de segurança fora da aplicação.",
    ),
  );
  const estimate = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persisted?.();
  body.append(
    el(
      "p",
      "muted",
      `Armazenamento persistente: ${persisted ? "concedido" : "não concedido ou indisponível"}. ${estimate?.usage !== undefined ? "Utilização estimada: " + (estimate.usage / 1048576).toFixed(1) + " MB." : ""} A conservação não é garantida.`,
    ),
  );
}
window.addEventListener("pagehide", () => dispose());
window.addEventListener("beforeunload", (e) => {
  if (busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});
root.append(el("p", "status", "A abrir o arquivo local…"));
void cleanup()
  .then(() => setTheme())
  .then(() => (installRequested ? preferences() : home()))
  .catch(error);
