# Changelog

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
