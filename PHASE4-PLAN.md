# Phase 4: Framework Integrations — Implementation Plan

## Design Decisions

### NestJS
- `forRoot(config)` for raw config, `forRootAsync({ useFactory, inject })` for async
- Auto-register global exception filter via APP_FILTER (opt-out via `exceptions: { autoRegister: false }`)
- Middleware (not interceptor) for AsyncLocalStorage — runs before guards/pipes, full coverage
- AlertLoggerService mirrors AlertLogger API exactly, auto-injects request context transparently
- @Global() module — service injectable everywhere

### NextJS
- `createAlertLoggerHandler(config)` returns void, calls AlertLogger.init() internally
- `captureRequestError` extracts path, method, routerKind, routeType, renderSource
- Title uses routerKind + routeType (not error message) for stable fingerprinting
- `getAlertLogger()` exported for manual logging in server actions/components
- onRequestError only — no route wrappers for v1

## Tasks

### 4.1 NestJS Module (`src/integrations/nestjs/`)
Files:
- `alert-logger.module.ts` — @Global @Module with forRoot/forRootAsync
- `alert-logger.service.ts` — Injectable wrapper, reads ALS context
- `exception.filter.ts` — Global exception filter for 5xx
- `alert-context.middleware.ts` — ALS middleware for request context
- `index.ts` — public exports
- `types.ts` — NestJS-specific config types, injection tokens

### 4.2 NextJS Integration (`src/integrations/nextjs/`)
Files:
- `handler.ts` — createAlertLoggerHandler + captureRequestError
- `index.ts` — public exports + getAlertLogger

### 4.3 Tests
- NestJS: module init, service methods, exception filter, context middleware
- NextJS: handler init, captureRequestError, getAlertLogger

### 4.4 Verification
- TypeScript compiles
- All tests pass
- Build succeeds with subpath exports
