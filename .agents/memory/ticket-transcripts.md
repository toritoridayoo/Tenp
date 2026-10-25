---
name: Ticket transcript logs
description: Required logging behavior when support or purchase tickets are closed.
---

Every support or purchase ticket closed through the bot must send a TXT transcript to the configured log channel before the ticket channel is deleted. If the transcript cannot be sent, leave the ticket channel open and report the failure.

**Why:** the user explicitly requested TXT logs for every bot-driven ticket closure method.

**How to apply:** route any new close button, approval/rejection flow, or slash-command closure through the shared transcript logger and preserve the no-delete-on-log-failure behavior.
