# Contributing

Use Node.js LTS and npm. Start with `npm ci` and `npm run dev`. Before submitting a change, run `npm run typecheck`, `npm run test`, `npm run build` and `npm run test:e2e`. The integration tests need Chromium, which you can install with `npx playwright install chromium`.

Use only synthetic fixtures. Keep personal exports, backups, credentials and screenshots of private conversations out of the repository.

When changing imports or backups, test what happens when an operation fails. Preserve the source text and local dates; normalize a copy when comparing text. Schema changes need versioned migrations. Do not add network services or telemetry.
