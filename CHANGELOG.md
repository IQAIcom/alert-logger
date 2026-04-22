# Changelog

## 1.0.1

### Patch Changes

- [`942e36f`](https://github.com/IQAIcom/alert-logger/commit/942e36fc5351232fc91f87dc57003a73a2326514) Thanks [@Royal-lobster](https://github.com/Royal-lobster)! - fix(fingerprinter): normalize numbers adjacent to unit letters

  The built-in `NUMBER_RE` used `\b\d+\b`, which failed to match digits
  immediately followed by word characters (e.g. `330s`, `120ms`). Messages
  like `"No block processed for 330s"` and `"... for 360s"` produced
  different fingerprints, so aggregation treated each tick as a fresh
  onset and no suppression occurred. Loosened to `\d+` so duration/size
  suffixes are collapsed too.

- [#20](https://github.com/IQAIcom/alert-logger/pull/20) [`3239f66`](https://github.com/IQAIcom/alert-logger/commit/3239f665ad30c04204adbefa12c06a76123464f9) Thanks [@Royal-lobster](https://github.com/Royal-lobster)! - fix(fingerprinter): run built-in normalizers before user-defined ones

  User-defined normalizers previously ran before the built-in ones, so a
  broad rule like `{ pattern: /\d+/g, replacement: "<num>" }` would strip
  digits out of UUIDs and hex addresses before `UUID_RE` and `HEX_RE` had a
  chance to match. Every trade ID or transaction hash then produced a
  distinct fingerprint, which made the aggregator treat each occurrence as
  a fresh onset and suppression never kicked in.

  Built-ins now collapse structural identifiers first, and user rules
  compose on top of the normalized output.

## 1.0.0

### Major Changes

- [#16](https://github.com/IQAIcom/alert-logger/pull/16) [`bc50c1a`](https://github.com/IQAIcom/alert-logger/commit/bc50c1aaf4660872db6d81b3726b732d25e87794) Thanks [@Royal-lobster](https://github.com/Royal-lobster)! - Add Slack and Telegram adapters with adapter-owned routing

  **Breaking changes:**

  - Removed `RoutingConfig` type, `Router` class, and `routing` option from `AlertLoggerConfig`
  - Removed `webhookUrl` and `pings` from `FormattedAlert`
  - Removed `pings` from `EnvironmentConfig`
  - Routing is now configured per-adapter via `channels`, `tags`, and `mentions` constructor options

  **Migration:** Move `routing.channels`, `routing.tags`, and `routing.pings` into your adapter constructor:

  ```ts
  // Before
  AlertLogger.init({
    adapters: [new DiscordAdapter({ webhookUrl: "..." })],
    routing: {
      channels: { critical: "..." },
      pings: { critical: ["<@&role>"] },
    },
  });

  // After
  AlertLogger.init({
    adapters: [
      new DiscordAdapter({
        webhookUrl: "...",
        channels: { critical: "..." },
        mentions: { critical: ["<@&role>"] },
      }),
    ],
  });
  ```

  **New features:**

  - `SlackAdapter` — Incoming Webhooks with Block Kit formatting, per-level channel routing, mention support, mrkdwn sanitization
  - `TelegramAdapter` — Bot API with HTML formatting, per-level forum topic routing, tag-to-topic mapping, @username mentions, safe HTML truncation

## 0.4.1

### Patch Changes

- [#13](https://github.com/IQAIcom/alert-logger/pull/13) [`417688e`](https://github.com/IQAIcom/alert-logger/commit/417688e9ec62ac8540a88aa3e559e7648f3195dd) Thanks [@Royal-lobster](https://github.com/Royal-lobster)! - fix: improve default fingerprint aggregation to reduce alert noise

  - Normalize titles with the same rules used for messages (UUIDs, hex addresses, timestamps, numbers) so dynamic values in titles don't split fingerprints.
  - Reduce default `stackDepth` from 3 to 1 so the same error from different callers groups into a single aggregation stream. Users can restore the previous behavior with `fingerprint: { stackDepth: 3 }`.

## 0.4.0

### Minor Changes

- [#11](https://github.com/IQAIcom/alert-logger/pull/11) [`44f5ee8`](https://github.com/IQAIcom/alert-logger/commit/44f5ee8eec9cd2b622c857e4b438b8d407893d16) Thanks [@Royal-lobster](https://github.com/Royal-lobster)! - feat: add `description` option and fix resolution noise

  - Add `description` field to `AlertOptions` for separating short titles from detailed messages. When set, `description` is used as the embed body instead of the title.
  - Allow `error()` and `critical()` to accept `(title, options)` without an intermediate `undefined` error param.
  - Resolution notifications now only fire for sustained incidents (count > rampThreshold). One-off or sporadic alerts no longer produce "Resolved" messages.
  - NestJS exception filter uses `{METHOD} {PATH}` as the alert title instead of the full error message.

## 0.3.1

### Patch Changes

- [#9](https://github.com/IQAIcom/alert-logger/pull/9) [`c578183`](https://github.com/IQAIcom/alert-logger/commit/c5781833c3afc9acb062d22120cd6de7c0c45cbf) Thanks [@Royal-lobster](https://github.com/Royal-lobster)! - Add typesVersions for TypeScript moduleResolution "node" subpath type resolution

## 0.3.0

### Minor Changes

- [#6](https://github.com/IQAIcom/alert-logger/pull/6) [`83c2811`](https://github.com/IQAIcom/alert-logger/commit/83c281125fc637731f09c1753fa5c9702fc9f874) Thanks [@Royal-lobster](https://github.com/Royal-lobster)! - Add configurable HealthPolicy for adapter health/retry behavior

  - New `health` config option with `unhealthyThreshold`, `healthWindowMs`, `drainIntervalMs`, `maxRetries`, and `entryExpiryMs`
  - Extract shared `formatDuration` utility to eliminate duplication between health-manager and discord formatter
  - Fix drain-only recovery: `onRecovery` now fires when adapters become unhealthy purely through background drain retries
  - Immediate re-drain after discarding expired queue entries for faster stale queue cleanup

### Patch Changes

- [#8](https://github.com/IQAIcom/alert-logger/pull/8) [`0746d58`](https://github.com/IQAIcom/alert-logger/commit/0746d5833628db1af3d2d985031dd672c5fd484a) Thanks [@Royal-lobster](https://github.com/Royal-lobster)! - Add CommonJS build output alongside ESM for compatibility with projects using `moduleResolution: "node"`

## 0.2.0

### Minor Changes

- [`c31f9b9`](https://github.com/IQAIcom/alert-logger/commit/c31f9b99ed5b35fc3def62370a89875b924627df) Thanks [@Royal-lobster](https://github.com/Royal-lobster)! - Initial release of @iqai/alert-logger with core engine, Discord/Console adapters, reliability layer, and NestJS/Next.js integrations.

## 0.1.0

Initial release.

### Features

- **Core engine**: unified alert API with `info`, `warn`, `error`, `critical` methods
- **Error fingerprinting**: automatic deduplication via MD5 hash of normalized error message + stack frames
- **Smart aggregation**: exponential suppression (onset -> ramp -> sustained -> resolution)
- **Multi-channel routing**: route alerts by severity level or custom tags to different webhook URLs
- **Per-environment config**: different thresholds, levels, and ping rules for prod/staging/dev
- **Environment badges**: `[PROD]`, `[STG]`, `[DEV]` prefix on every alert

### Adapters

- **DiscordAdapter**: color-coded embeds, mention sanitization, 429 retry with Retry-After
- **ConsoleAdapter**: TTY-aware pretty/JSON output

### Reliability

- **RetryQueue**: ring buffer with configurable max size, FIFO drain
- **HealthManager**: per-adapter health tracking, graceful degradation, recovery detection
- **Disk persistence**: atomic JSON save/load for crash recovery

### Framework Integrations

- **NestJS** (`@iqai/alert-logger/nestjs`): global module, injectable service, exception filter, request context via AsyncLocalStorage
- **Next.js** (`@iqai/alert-logger/nextjs`): instrumentation.ts handler, onRequestError hook, getAlertLogger for manual use
