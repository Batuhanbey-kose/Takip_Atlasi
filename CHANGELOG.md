# Changelog

## 1.5.0 - 2026-10-16

- Replace fixed 12-account pages with balanced 50-account and fast 100-account requests; use one paced request queue for lists and profile counters.
- Collect profile follower counts during relationship scanning, reusing list-provided counts and results for accounts present in both lists.
- Remove separate counter loading from the UI; preserve unavailable counts as unknown and keep cancellation, identity checks and 429 cooldowns.
- Add Aurora, AMOLED, Coffee and Cyber themes, per-profile starred accounts, filtered-list copying, and persistent compact/comfortable layouts.
- Show scan counter progress and elapsed time, keep dashboard refresh progress visible, and prevent conflicting imports during a scan.
- Publish current Android/Windows packages and remove superseded GitHub release pages after verifying the new artifacts.

## 1.4.1 - 2026-10-14

- Simplify the not-following-back cards to photo, username, follower count and the existing relationship badge.
- Read profile follower counters without requiring post/following counters; never enumerate each person's followers just to obtain their count.
- Reduce this category's filters and sorts to follower-oriented controls and improve mobile readability/touch targets.
- Document the observed errors, fixes, methods and validation limits in historical release notes.

## 1.4.0 - 2026-10-13

- Add direct PC Instagram collection using a visible Edge/Chrome session and the shared Android collector, with a manual scan button and localhost-only bridge.
- Seed PC scans from a session-matching web profile response and reuse the website's authentication headers instead of unsupported legacy account-info calls.
- Add cookie-free PC photo caching and session-backed web-profile counters, with visible-first loading, caching, progress and a stop control.
- Prepare Android scans from observed, session-matching web profile data and keep the web session for manual profile counter queries.
- Publish a Windows x64 PC ZIP with a BAT launcher and checksum-verified bundled Node runtime.
- Stop immediately on Instagram rate limits or invalid-session responses instead of retrying or reporting a missing username.
- Respect Retry-After and persist a shared Android request cooldown across restarts and metadata requests.
- Require a user-started scan after login completes; exclude one-tap, two-factor and checkpoint pages from page readiness.
- Distinguish unsupported-client responses without exposing raw Instagram error messages.
- Use 50-account pages with a 2–3 second default gap between all Instagram scan requests; offer explicit original/steady tempo choices without automatic speed increases.
- Load account counters only on user request, with one worker and a 2–3 second delay; stop enrichment when starting a scan, navigating away or backgrounding the app.

## 1.3.0 - 2026-10-12

- Add a PC localhost interface and the same offline Instagram JSON/ZIP archive import to both PC and Android.
- Validate both relationship lists, reject incomplete/oversized archives and reuse the existing local analysis and history.
- Keep the Android direct connection available while providing an archive path when Instagram returns 400/429.

## 1.2.5 - 2026-10-12

- Read the signed-in account ID from Android's Instagram cookie store when it is hidden from page JavaScript.
- Reject rounded numeric Instagram IDs and prefer exact string IDs; try the basic current-user endpoint when the edit endpoint omits account details.
- Show per-endpoint HTTP or response-format diagnostics when Instagram refuses account verification, without exposing cookies or account IDs.

## 1.2.4 - 2026-10-12

- Recover a missing username from the requested profile only when its numeric ID matches the Instagram session.
- Explain how to retry with a username when Instagram hides account details; never save data for an unverified account.

## 1.2.3 - 2026-10-12

- Verify missing Instagram profile counts through the matching web profile before collecting lists.
- Request up to 100 accounts per page, shorten inter-page delays and avoid repeatedly copying completed Android results.
- Wait for login navigation to settle before starting collection.
- Stop metadata batches when Instagram asks for a pause and reduce photo/UI work during list browsing.
- Surface IndexedDB write failures instead of silently switching storage and losing saved lists.
- Update Android CI and release SDK setup for current Google SDK packages.

## 1.2.2 - 2026-07-27

- Fetch all counters required by global sorting and filtering with four controlled workers.
- Reduce guarded metadata request spacing from seconds to milliseconds.
- Shorten stalled metadata request timeouts and stop the progress indicator when work ends.

## 1.2.1 - 2026-07-27

- Accept small Instagram profile/list count drift when pagination finishes normally.
- Continue to reject materially incomplete or interrupted relationship lists.

## 1.2.0 - 2026-07-24

- Product converted to Android-only operation.
- Added direct in-app Instagram collection without a computer.
- Added local profile-photo caching and public account counters.
- Added richer sorting, relationship filters and audience filters.
- Added explicit data-use consent and local session deletion.
- Removed the desktop server, Chrome extension, PWA and file-transfer flows.
