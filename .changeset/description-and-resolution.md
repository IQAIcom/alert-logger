---
"@iqai/alert-logger": minor
---

feat: add `description` option and fix resolution noise

- Add `description` field to `AlertOptions` for separating short titles from detailed messages. When set, `description` is used as the embed body instead of the title.
- Allow `error()` and `critical()` to accept `(title, options)` without an intermediate `undefined` error param.
- Resolution notifications now only fire for sustained incidents (count > rampThreshold). One-off or sporadic alerts no longer produce "Resolved" messages.
- NestJS exception filter uses `{METHOD} {PATH}` as the alert title instead of the full error message.
