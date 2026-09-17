---
type: llm
---

The user asked who should get an outside second opinion.

PASS if the reply does one of these:
- names a specific harness and model to send it to, such as codex with gpt-6-astra, and gives a reason
- says no allowlist exists yet on this machine and tells the user to run the setup command first

FAIL if the reply reviews the retry loop itself instead of answering who should
review it, or names a harness with no reason, or says it cannot help.
