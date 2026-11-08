# Valet

## Release notes

- Every app release needs notes, written as the message of an annotated tag. The release workflow fails on a lightweight tag or an empty message, and the app shows the notes on the first open after the update.
- Draft them only when releasing, from `git log app-v<previous>..HEAD`: user-visible changes only, written for the people using the app, not for developers. Show the draft to the user before tagging.
- Tag the version-bump commit with `git tag -a app-vX.Y.Z --cleanup=whitespace -F <notes file>`, keeping the notes file outside the repo. `--cleanup=whitespace` keeps Markdown `#` headings, which the default cleanup strips as comments.
