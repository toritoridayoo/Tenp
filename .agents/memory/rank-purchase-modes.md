---
name: Rank purchase modes
description: Product rules for rank purchase requests and payment intake.
---

Rank purchase intake is configurable per server between Booth and Amazon gift cards. Booth remains the default and keeps the existing flow. Amazon intake is only for rank requests; it asks for Minecraft ID, gift-card number, amount, and a written product description, then staff reviews the ticket and chooses the rank duration. Staff may also grant a custom number of days; this custom period applies to the Discord role only and must not trigger RCON auto-grant, so game rank is handled manually.

**Why:** the user requested server-level Booth/Amazon switching and chose custom-duration approval for the Discord role only; the existing RCON flow does not support arbitrary periods.

**How to apply:** keep other purchase flows unchanged unless asked, do not treat Amazon submissions as automatically approved, preserve permanent and one-month options, and for custom days store the expiry but leave game-side rank grants to staff.
