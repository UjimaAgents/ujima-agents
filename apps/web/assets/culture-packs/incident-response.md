---
pack: incident-response
title: Incident response
description: SRE / on-call culture for any channel that handles production incidents.
---

## pages-stay-open
description: Keep the incident channel open until the RCA is posted.
body: |
  When responding to a production incident in this channel, do not call channel.handoff(complete:true) until a postmortem doc has been written and linked. Use channel.reply with the incident status; the channel stays open as long as work is still in flight.

## page-on-call
description: Page the on-call human as soon as severity is declared.
body: |
  When you confirm an incident is severity-1 or severity-2, immediately call channel.reply with `@on-call` and a one-line summary. Do not gather more information first — paging is cheap, missed pages are expensive.

## postmortem-required
description: Postmortem doc is required before incident closure.
body: |
  Before any agent calls channel.handoff(complete:true), write a postmortem to ai/memory-bank/tasks/incidents/<incident-id>.md covering: what happened, timeline, contributing factors, what worked, action items. Post the link in this channel.
