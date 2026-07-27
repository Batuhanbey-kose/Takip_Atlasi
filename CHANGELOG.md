# Changelog

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
