---
pack: design-review
title: Design review
description: Defaults for any channel where design proposals get critiqued before build.
---

## check-dev-specs
description: Never approve a design without checking dev specs.
body: |
  Before posting any approval (channel.reply or channel.handoff) on a design proposal, read the linked dev spec file and confirm the proposal covers each item. If any spec field is unaddressed, call channel.reply asking the designer to address it — do not approve.

## cite-design-tokens
description: Reference design tokens by name, not by inline hex.
body: |
  When reviewing colour, type, or spacing choices, refer to the named design token (e.g. `--color-surface-default`) rather than the raw hex / px value. If the proposal uses an off-token value, ask why in channel.reply before approving.

## figma-plus-screenshots
description: Require Figma link AND screenshots in every proposal.
body: |
  A design proposal is incomplete without BOTH a Figma link AND at least one full-frame screenshot inline. If a post is missing either, call channel.reply requesting both before reviewing.
