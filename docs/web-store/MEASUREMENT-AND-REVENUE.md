# Measurement, email, donations, and monetization

Version 2.2.0 intentionally contains no analytics, tracking, account system,
payment code, donation code, or email collection. That makes the initial
Developer Preview easier to review and preserves its local-only promise.

## Measure adoption without changing the extension

Use the Chrome Web Store dashboard for:

- daily installs and uninstalls;
- store impressions and listing conversion;
- weekly installed-user retention by country, language, OS, and version; and
- ratings and reviews.

The Web Store exposes aggregate, non-user-level data. Its **Users** metric is
based on installations and does not prove that someone actively used the copy
feature. The dashboard can also opt the listing into Google Analytics 4 for
additional store-listing metrics; Google manages that analytics property and
still provides only non-user-level data to the publisher.

This is the recommended measurement setup for the first release. It answers
“How many people installed it?” without collecting Gmail data or adding
extension telemetry.

## What the store will not tell you

The Web Store does not reveal the names or email addresses of installers. Do
not try to infer identities from Gmail, scrape the signed-in account, or add a
hidden identifier. Doing so would materially change the product's privacy
practices and require new permissions, prominent disclosure, informed consent,
secure infrastructure, retention/deletion procedures, and an updated privacy
policy before the change begins.

If feature-use counts become essential later, add only a separately reviewed,
opt-in telemetry design that records minimal events such as `copy_succeeded`
and never records thread text, participants, subjects, attachment names, Gmail
URLs, account identifiers, or clipboard output. That is deliberately out of
scope for version 2.2.0.

## Collect email addresses safely

Use an optional, external signup page rather than harvesting the user's Gmail
identity. A compliant future flow should:

1. open only after the user clicks a plainly labeled **Get release updates**
   link;
2. state what messages will be sent and identify Zena Labs LLC;
3. collect only the email address, use double opt-in, and provide unsubscribe;
4. publish retention, deletion, processor, and contact details; and
5. keep signup optional—the extension's advertised functionality must work
   without it.

Do not add a signup link until its final URL, provider, privacy text, and sender
domain are ready.

## Donations

The lowest-risk approach is a user-initiated **Support this project** link on
the public repository or support page that opens a reputable external donation
or payment page. Do not collect card details in the extension. Add the final
provider, seller identity, any recurring-payment terms, refund policy, and
relevant privacy disclosures before showing the link.

The release files contain no placeholder donation link because a dead or
unowned payment URL would make the listing inaccurate. Once Zena Labs LLC has a
verified payment destination, add it in a small follow-up release.

## Paid features

If a future version charges for basic functionality, the price and limitation
must be clear before installation, Zena Labs LLC—not Google—must be identified
as the seller, and payment data must be handled under applicable privacy,
security, and card-industry rules. A separate hosted checkout and entitlement
service is safer than handling payment details in the extension.

Do not monetize email content, browsing activity, or user data through ads,
profiling, sale, or transfer. Affiliate programs have additional pre-install
and in-product disclosure requirements and require a related user action; they
are a poor fit for this extension's narrow single purpose.
