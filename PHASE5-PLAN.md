# Phase 5: Testing and Documentation — Implementation Plan

## Tasks

### 5.1 NestJS integration tests
- AlertLoggerService: test info/warn/error/critical forward to AlertLogger
- AlertLoggerService: test request context merge from AsyncLocalStorage
- AlertContextMiddleware: test requestId from header vs auto-generate
- AlertExceptionFilter: test 5xx → error, non-HttpException → critical
- Module: test forRoot creates correct providers

### 5.2 NextJS integration tests
- createAlertLoggerHandler: initializes AlertLogger singleton
- captureRequestError: extracts fields, handles missing logger gracefully
- getAlertLogger: returns instance, throws if not initialized

### 5.3 Discord adapter tests
- Rate limit (429) retry handling
- Webhook URL override from alert

### 5.4 Update README
- Already comprehensive — ensure it matches actual API
- No changes needed unless API diverged from spec

### 5.5 Verification
- All tests pass (old + new)
- Build succeeds
