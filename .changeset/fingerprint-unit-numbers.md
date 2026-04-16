---
"@iqai/alert-logger": patch
---

fix(fingerprinter): normalize numbers adjacent to unit letters

The built-in `NUMBER_RE` used `\b\d+\b`, which failed to match digits
immediately followed by word characters (e.g. `330s`, `120ms`). Messages
like `"No block processed for 330s"` and `"... for 360s"` produced
different fingerprints, so aggregation treated each tick as a fresh
onset and no suppression occurred. Loosened to `\d+` so duration/size
suffixes are collapsed too.
