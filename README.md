# Chat Archive

Chat Archive lets you keep and read WhatsApp chat exports offline. Import a TXT or ZIP, choose which participant is you, and reopen the conversation later without selecting the files again.

The app is a TypeScript PWA with a Portuguese (Portugal) interface. Everything runs in your browser. It has no account, backend, upload endpoint, advertising or analytics.

## What you can do

Import Android and iPhone exports with multiline messages, local dates, system notices and attachment references. The app keeps the original TXT, author names and source line references. If the date order is ambiguous, you choose it before saving.

Conversations and attachment Blobs stay in IndexedDB. An import only becomes visible when it has finished saving. You can set your identity separately from the person who exported the chat, change displayed names and correct aliases in conversation details.

The reader has day separators, basic text formatting, native media controls and downloads of the original attachments. Known export markers appear as an "Editada" label or a missing-file notice, including in previously saved messages. Stored text stays unchanged. The virtual list supports variable row heights in large conversations.

Global search shows message excerpts without hover. Inside a conversation, open the three-dot menu and choose **Pesquisar**. The search bar keeps the bubbles visible, highlights matches and provides previous/next controls. Search ignores case and accents, including decomposed Unicode accents. The calendar appears only in search mode; an empty day offers the next available date instead of skipping there silently. Reading position is saved between sessions.

When you add another export to a conversation, the app uses unique message sequences to match overlaps. It keeps uncertain repetitions as separate records. You can save a versioned ZIP backup with SHA-256 integrity checks and restore it as separate conversations.

After the first visit, the app caches its own files for offline startup. Updates need your approval. You can choose a light or dark theme, or follow the system setting.

![Chat Archive with synthetic messages](public/preview.png)

## Run locally

Install an active Node.js LTS release with npm. Use Node 22.12 or later; Node 24 is recommended. Run these commands in the project directory:

```sh
npm ci
npm run dev
```

Open the local address printed in the terminal. Use development mode to work on the code and the production build to test the service worker.

```sh
npm run typecheck
npm run test
npx playwright install chromium
npm run test:e2e
npm run build
npm run preview
```

Integration tests start the production build on port 4177 (override with `TEST_PORT` if needed). All fixtures are synthetic. Tests generate the large conversation and the complete media ZIP instead of keeping large exports in the repository. On the phone, check identity, attachments, search, backup restoration and offline reopening before relying on the archive.

## Publish manually

GitHub Pages is the intended host. The site has two real entry pages: the presentation at `/<repository>/` and the PWA at `/<repository>/app/`. Both also work at `/` and `/app/` on a user domain. The presentation shows a local synthetic screenshot and never opens the archive database. Paths alone do not isolate it from the app: they share an origin.

Review and test locally before committing or pushing. Then choose **GitHub Actions** in the repository's **Settings → Pages** and manually run **Publish GitHub Pages**. The separate `workflow_dispatch` workflow uses the Pages configuration to set the base path and publishes only `dist`. It does not deploy on push and needs no custom secrets. CI runs independently.

For a local build under a repository prefix, set `BASE_PATH` before building. In PowerShell:

```powershell
$env:BASE_PATH='/repositorio/'
npm run build
npm run preview
```

Open the printed origin followed by `/repositorio/`. Remove the variable with `Remove-Item Env:BASE_PATH` to return to a root build. Keep the same deployed address when updating, and never upload chat exports or backups to the hosting project.

On the Samsung, choose **Instalar aplicação** on the presentation page. It opens the app, which offers an install button only when Chrome provides the prompt. Otherwise, use **Install app** or **Add to Home screen** in Chrome's menu. The installed icon opens the app rather than the presentation. Import a ZIP from **My Files** with **Adicionar ZIP ou TXT** or restore a backup on the phone itself. Installing does not detach the app from its hosting address.

## Data and backups

Imported messages, names and attachments stay in browser storage. The app does not send them to a server. It fetches no link previews; opening an external link yourself connects to that website. The hosting provider receives normal requests for app files, without conversation content.

The app does not encrypt local storage. Clearing site data, changing origin, browser eviction, device loss or damage can remove the archive. Persistent-storage permission can reduce the risk of eviction, but cannot guarantee that data will survive.

Keep the original exports outside the app and save backups regularly. Backup controls and the last-copy date are in **Definições → Cópia de segurança**, without reminders on the conversation list. Backups contain private data and are not encrypted. Use **Restaurar cópia** to restore one; existing conversations stay separate and format 1 remains supported. Localhost and GitHub Pages are different origins, so PC data does not appear on a phone without importing or restoring it there.

## What exports cannot tell you

An export cannot reconstruct missing media, original message IDs, delivery status, reactions, reply links, time zones or an edit history. Chat Archive cannot import messages back into WhatsApp. If two people share the same textual identity in an export, the app needs more source information to distinguish them.

A line that looks like a valid export header may start a new message even if it was meant as message text. Check unusual export formats against the preserved TXT.

Overlap matching favors keeping records. Only unique runs of three messages count as anchors, so a short overlap or a changed attachment marker can leave duplicates. The backup keeps every source. Segments without anchors use stable local-date ordering and have a source warning. Large backups also need enough browser memory to assemble the final ZIP.

The app has not been tested on a physical Samsung. Media playback depends on Chrome and the device's codecs.

## Project information

Read the [contributing guide](CONTRIBUTING.md) and [security notes](SECURITY.md). Original code uses the [MIT license](LICENSE). Dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Chat Archive is an independent personal project. It is not an official WhatsApp or Meta product and has no affiliation with either company.
