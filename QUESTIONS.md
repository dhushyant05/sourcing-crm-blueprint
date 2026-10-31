# Questions — All Resolved (2026-10-31)

1. **Client quotes**: Auto-generated PDF, shared to WhatsApp manually via the phone's share sheet. No WhatsApp integration for now.
2. **Currency**: Multi-currency, mainly RMB and USD. Prices stored in the supplier's quoted currency; India view shows INR. Admin controls the exchange rate source with manual override.
3. **Data visibility**: China team sees supplier details; India team sees customer details. Each office admin sees everything on their own side. Super admin sees everything across both offices.
4. **Voice notes**: Not needed.
5. **Account administration**: One admin per office (scoped to that office) plus one global super admin.
6. **Distribution**: Sideload APK for everyone (Android only for now).
7. **Backup browser page**: Download links visible to super admin only; others see metadata.

## Earlier decisions
- Shared vs separate VPS: separate. Three servers: Twenty app, Chatwoot, storage.
- WhatsApp: no customer-facing WhatsApp or Meta Cloud API integration. Chatwoot is internal-only (India–China).
