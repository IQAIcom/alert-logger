---
"@iqai/alert-logger": patch
---

fix(fingerprinter): run built-in normalizers before user-defined ones

User-defined normalizers previously ran before the built-in ones, so a
broad rule like `{ pattern: /\d+/g, replacement: "<num>" }` would strip
digits out of UUIDs and hex addresses before `UUID_RE` and `HEX_RE` had a
chance to match. Every trade ID or transaction hash then produced a
distinct fingerprint, which made the aggregator treat each occurrence as
a fresh onset and suppression never kicked in.

Built-ins now collapse structural identifiers first, and user rules
compose on top of the normalized output.
