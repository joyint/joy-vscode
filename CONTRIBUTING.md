# Configure joy forge for item-grouped GitHub releases

Currently 'joy release publish' prints 'No forge configured; publish done.' and only pushes the tag - the GitHub release itself is produced by .github/workflows/release.yml, which writes generic install instructions. The closed items (stories, tasks, decisions, contributors) that joy collects in 'joy release record' never make it to the release page.

joy and jyn both have 'forge: github' as a top-level field in .joy/project.yaml (next to 'language: en'). With that set, 'joy release publish' creates the GitHub release directly, populated with the item list and contributors that 'joy release record' captured.

Steps:

1. Add 'forge: github' to .joy/project.yaml. Try 'joy project set forge github' first; if that subcommand does not accept 'forge' as a key (the documented set keys are name|acronym|description|language), hand-edit the file with explicit user authorization (same carve-out we used for release.version-files).
2. Update .github/workflows/release.yml: switch from 'gh release create' to 'gh release upload ${tag} ${vsix} --clobber'. The release will already exist by the time the workflow finishes (joy creates it during publish). Add a short retry loop (~5x with 3s sleep) on the upload step so the workflow does not race ahead of joy's release-creation API call.
3. Update CONTRIBUTING.md Releasing section: clarify that 'just publish' (-> joy release publish) creates the release with the item changelog; the workflow's job is to attach the VSIX asset.

Verification: tag v0.1.1 (or whichever is next), 'just release patch && just publish'. Release page should list every item closed since v0.1.0, grouped by type, with contributor counts; VSIX asset attached.

Out of scope: editing the release-notes content itself. Joy controls that.

_Implemented for item JVSC-0009-60 by the mock agent._
