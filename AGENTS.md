# Agent rules — Telegram bot

1. Docs match code: after any behavior/config/API change, update root `README.md`
   and the affected file in `docs/` (`prompts/README.md` where applicable).
   Single sources of truth: `src/config/config.ts` default = `docs/configuration.md`
   = `.env.example`. `PROMPT_MAX_TOTAL_CHARS` default is `32000`;
   lorebook `PRIMARY_MAX_CHARS` (`12000`) is a separate budget — do not conflate them.
   Never change one of the three config sources without the other two.

2. No god files: keep each module focused and small.
   - Target max ~200-250 lines per file in `src/server/*`, `src/services/*`,
     and `webapp/app/*`. If a file exceeds that, split by responsibility
     (routes vs. controller vs. service vs. middleware; on the frontend,
     state vs. render vs. actions per feature folder).
   - Never add a new endpoint to `src/server/server.ts` — add a
     `registerXRoutes(app)` module in `src/server/` instead and wire it in
     `createServer()`. `server.ts` is wiring + middleware only.
   - Never grow `scripts/smoke-webapp.mjs` into a monolith — add a
     per-feature `smoke-<feature>.mjs` instead.
   - One responsibility per module: validation, multimodal assembly, history/jobs,
     and static serving must live in separate units, not in one handler.

3. Patterns to follow:
   - `src/bot/bot.ts` stays thin (redirect only, never calls OpenRouter).
   - Express wiring in `src/server/`, domain logic in `src/services/`,
     env validation only via `src/config/config.ts` (zod, fail-fast, no secrets in logs).
   - Cross-cutting concerns (auth in `webappAuth.ts`/`requestIdentity.ts`,
     rate limiting, error mapping via `UserFacingError`) go in middleware/utils,
     not duplicated in handlers.
   - Frontend stays bundler-free ESM under `webapp/app/<feature>/`
     (`chat/`, `voice/`, `video/`, `profile/`, `lorebook/`, `core/`).
     Shared API shapes must mirror the backend types in
     `src/services/openrouter.ts` (e.g. `ChatContentPart`).
   - Tests: put unit-testable logic in `services/` with a matching
     `scripts/smoke-<feature>.mjs` case. Before finishing, run the full gate
     (same as CI): `npm run typecheck`, `npm run lint`,
     `npm run format:check`, `npm run docs:check`, then `npm run smoke`.
