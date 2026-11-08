# Valet

## Release notes

- Every app release needs notes in `app/release-notes/X.Y.Z.md`, written for the people using the app. The app shows them on the first open after an update.
- Keep `[DRAFT]` as the first line of the next version's notes while changes land, and add each user-visible change to them as it's made. The release workflow fails while `[DRAFT]` is there.
- Remove `[DRAFT]` only when releasing: in the release commit itself (or a commit right before it), then tag that commit `app-vX.Y.Z` and push the tag.
- After a release, start the next version's file with `[DRAFT]`.
