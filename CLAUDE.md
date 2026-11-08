# Valet

## Release notes

- Every app release needs notes in `app/release-notes/X.Y.Z.md`. The release workflow fails without them, and the app shows them on the first open after the update.
- Write them only when releasing, in the release commit that bumps the version, then tag that commit `app-vX.Y.Z` and push the tag.
- Draft them from `git log app-v<previous>..HEAD`: user-visible changes only, written for the people using the app, not for developers. Show the draft to the user before committing.
