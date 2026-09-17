---
type: llm
---

The user asked whether a sub-agent or the current session should do a bulk rename.

PASS if the reply answers the question: it picks a sub-agent or the current
session and says why, or it says no allowlist exists yet and tells the user to
run the setup command first.

FAIL if the reply starts renaming the field, or asks the user to decide without
offering a recommendation, or ignores the sub-agent question.
