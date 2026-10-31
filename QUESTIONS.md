# Open Questions — Revised for Brainstorming

## Client Delivery
1. PDF quote or WhatsApp copy? Auto-generated PDF looks more professional but adds build time. WhatsApp is faster for the India team but less trackable.

## Currency & Pricing
2. Default display currency per office. India sees INR, China sees CNY, but should there be a toggle to switch, and who controls the exchange rate source?

## Data Visibility
3. Supplier contact exposure. China agents may need supplier phones and WeChat IDs on the go. Should that live in the app or stay in Chatwoot/WeChat?

## Input Methods
4. Voice notes for factory visits. Useful for China staff walking supplier floors, but adds transcription and storage complexity.

## Operations
5. Account administration ownership. One trusted admin per office, or a single global admin?

## Distribution
6. APK sideload vs store publish. Sideloading is faster for China (Play Store access is restricted); stores give easier updates for India.

## Backups
7. Should the read-only backup browser page on the storage VPS show download links for dumps, or only metadata like timestamps and sizes?

## Resolved
- Shared vs separate VPS: DECIDED — separate. Three servers: Twenty app, Chatwoot, storage.
- WhatsApp integration: DECIDED — Chatwoot via Meta Cloud API as primary; unofficial libraries as fallback only.
