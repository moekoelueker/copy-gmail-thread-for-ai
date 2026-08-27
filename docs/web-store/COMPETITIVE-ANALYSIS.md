# Chrome Web Store discovery and competitive analysis

Research completed 27 August 2026 for the version 2.2.1 public listing.

## Executive recommendation

Keep the product name **Copy Gmail Thread for AI**. It is clear, unique, and
already contains the highest-intent job phrase without unnecessary keyword
stuffing.

Use this 118-character summary:

> Copy or export complete Gmail threads as AI-ready text for ChatGPT, Claude,
> or Gemini. Private, local, and no account.

Most importantly, change distribution from **Unlisted** to **Public**. An
unlisted item is available by direct link but cannot compete normally in Chrome
Web Store search and category browsing. No wording change can compensate for
that visibility setting.

## Research method and limitations

This analysis used live Google autocomplete suggestions, live Chrome Web Store
search results, and current competitor listings. These signals show current
search language and marketplace positioning, but they are directional rather
than exact monthly keyword volumes. Chrome does not publish exact Web Store
query volumes.

Observed high-intent language included:

- copy Gmail thread / copy email thread Gmail
- export Gmail thread / export Gmail conversation
- save Gmail thread / save Gmail thread as PDF
- Gmail thread to Markdown / Gmail to Markdown
- Gmail to ChatGPT / connect Gmail to ChatGPT

The product should target the narrower **copy or export an entire Gmail thread
for AI** job. The broader Gmail-to-ChatGPT market is much larger, but is crowded
with extensions that read or write email using AI; presenting this local-only
exporter as one of those products would weaken its clear single purpose.

## Competitive landscape

User and rating counts are point-in-time Store observations from 27 August
2026 and will change.

| Product | Observed position | Store signal | Main promise | Opportunity for this extension |
| --- | --- | --- | --- | --- |
| [Gmail Thread to Markdown](https://chromewebstore.google.com/detail/gmail-thread-%E2%86%92-markdown/gcafbcnbpkhgnckjbjlfjfjnemkkcikd) | First for “gmail thread markdown”; second for “copy gmail thread” | 29 users; no ratings | Clean Markdown for ChatGPT, Claude, or any AI | Emphasize completeness verification, warnings, structured attribution, privacy, and attachment context. |
| [Gmail Thread Extractor](https://chromewebstore.google.com/detail/gmail-thread-extractor/mnadkdmihpjmjjhkifhdakfjjgnpfipp) | Direct Markdown extractor | 12 users; no ratings | Extract a Gmail conversation as clean Markdown | Lead with complete-thread capture and safe failure when Gmail returns a different conversation. |
| [Gmail to ChatGPT Helper](https://chromewebstore.google.com/detail/gmail-to-chatgpt-helper/jiigjdejogfoegmkepecjlagcihjaide) | Lower result for “gmail to chatgpt” | 12 users; no ratings | Open Gmail content in ChatGPT | Differentiate on support for any AI, no automatic third-party transfer, and no account. |
| [Save Emails from Gmail as PDF](https://chromewebstore.google.com/detail/save-emails-from-gmail-as/ldlfdhpofcjdjnljkmmhaigbjpchhank) | First for “copy gmail thread” and prominent for export queries | 9,000 users; 4.6 from 32 ratings | Archive email as PDF | PDF demand is broader, but this extension should own the AI-ready, machine-readable use case rather than add unrelated PDF functionality. |
| [ThreadPDF for Gmail](https://chromewebstore.google.com/detail/threadpdf-for-gmail-%E2%80%94-sav/ommkhbhfjepkcgcfofolfigikcplnfkg) | Visible for thread export/save searches | 75 users; 3.9 from 7 ratings | Save and export threads as PDF | Position XML with readable Markdown as better input for AI analysis than a visual PDF. |
| [ChatGPT for Gmail by cloudHQ](https://chromewebstore.google.com/detail/chatgpt-for-gmail-by-clou/fcblgiphlneejkokhnaagmjombnfdnog) | Dominant broad Gmail-AI competitor | 30,000 users; 4.4 from 45 ratings | AI writing and replies inside Gmail | Avoid feature comparison on AI generation; emphasize private preparation of complete context with no AI-provider access. |

## Positioning

The defendable position is:

> The private, reliable way to copy or export a complete Gmail conversation as
> reviewable, AI-ready structured text.

The strongest differentiators are concrete rather than promotional:

- Requests Gmail's full print conversation so collapsed messages are included.
- Verifies Gmail returned the same conversation before copying anything.
- Preserves sender, recipient, date, message boundaries, links, tables,
  signatures, and attachment context.
- Marks partial or uncertain captures instead of silently claiming success.
- Flags possible unsent drafts.
- Runs locally with no extension account, OAuth, analytics, publisher server,
  or automatic transfer to an AI provider.

## Listing changes for version 2.2.1

- Keep the name **Copy Gmail Thread for AI**.
- Replace the summary with the 118-character copy above.
- Use the outcome-led description in `STORE-LISTING.md`.
- Set visibility to **Public** and retain all intended regions.
- Keep the current category closest to **Productivity / Workflow & Planning**.
- Do not append lists of brands or repeat keywords unnaturally. Chrome's
  policies prohibit irrelevant or excessive metadata, and the discovery
  guidance favors clear, useful listings.

## Ranking plan after publication

Chrome documents that listing metadata is only one input. Product quality,
design, ratings, usage, and the relationship between downloads and uninstalls
also affect discovery. A sustainable launch plan is therefore:

1. Link directly to the public Store listing from the GitHub README, the Zena
   Labs product page, relevant tutorials, and existing audience channels.
2. Add a short demonstration showing one complete thread copied into a generic
   AI chat, with the privacy and completeness protections visible.
3. Ask satisfied users for an honest Store review without incentives or review
   gating.
4. Monitor Store dashboard impressions, listing-to-install conversion, active
   users, ratings, and uninstall trends after release.
5. Turn common support issues into onboarding and reliability improvements;
   Store ranking benefits when installs remain useful rather than being quickly
   removed.
6. Recheck search placement and competitor messaging after 30 days before
   changing the name. Consider localized listings only when support can also be
   provided in those languages.

## Authoritative guidance

- [Discovery on the Chrome Web Store](https://developer.chrome.com/docs/webstore/discovery)
- [Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing)
- [Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)
- [Update your Chrome Web Store item](https://developer.chrome.com/docs/webstore/update/)
