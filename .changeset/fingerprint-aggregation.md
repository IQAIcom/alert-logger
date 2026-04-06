---
"@iqai/alert-logger": patch
---

fix: improve default fingerprint aggregation to reduce alert noise

- Normalize titles with the same rules used for messages (UUIDs, hex addresses, timestamps, numbers) so dynamic values in titles don't split fingerprints.
- Reduce default `stackDepth` from 3 to 1 so the same error from different callers groups into a single aggregation stream. Users can restore the previous behavior with `fingerprint: { stackDepth: 3 }`.
