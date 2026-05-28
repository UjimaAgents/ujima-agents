---
pack: customer-escalation
title: Customer escalation
description: Defaults for any channel that handles escalated customer issues.
---

## tag-severity
description: Every reply to a customer thread must declare a severity tag.
body: |
  When you call channel.reply on a customer-escalation thread, the first line must be `[SEV-1|SEV-2|SEV-3]` matching the case priority. The severity is what triggers paging and escalation rails — omitting it silently downgrades the issue.

## no-chitchat
description: No "let me check on that" replies — only substantive responses.
body: |
  In customer-escalation channels, do not post acknowledgements like "I'm looking into this" or "I'll get back to you". Either reply with concrete information, status, or a question — or use channel.ack to silently mark you have seen the message.

## thirty-minute-pulse
description: Status update every 30 min on any unresolved escalation.
body: |
  When you take ownership of an unresolved customer issue, schedule a self-followup every 30 minutes. On each wake, either post a substantive update (channel.reply with what's changed) or call channel.pass with "still working on X — next check at HH:MM".
