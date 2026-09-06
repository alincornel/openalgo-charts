# Profile website and 2.1.0 documentation plan

> Execute the authorized work inline with verification at each checkpoint.

**Goal:** Make the compact profile, per-day controls and five themes discoverable and testable on the website, with real screenshots and accurate 2.1.0 release notes.

**Architecture:** Copy the existing standalone demo and its two built bundles into generated website assets during the existing sync step. Embed that demo in a dedicated documentation page and the website examples page. Reuse screenshot cards on the documentation and landing pages.

**Tech stack:** Existing static site, MDX, React, native browser modules and browser screenshot automation.

**Requirements:** Current user requests in this conversation. Theme names, new comments and copy use generic labels. Screenshots use the actual synthetic-data demo. The separate production-readiness branch is not merged by this task. The user subsequently explicitly authorized committing and pushing to master, publishing version 2.1.0 to npm through CI, and publishing the website.

## 1. Website demo and screenshot assets

- [x] Extend `website/scripts/sync-lib.mjs` to copy the standalone profile HTML, theme module and required bundles into `website/public/demos/`; rewrite the demo's bundle imports to relative paths.
- [x] Ignore generated demo assets in `website/.gitignore`; include standalone example changes in the existing website deployment workflow's path filter.
- [x] Add `scripts/capture-profile-screenshots.mjs` to capture deterministic screenshots at 1600 x 1000 from the working demo, for Dark, Blue, Graphite, Emerald and Ivory, plus a close view of split/packed profiles.
- [x] Store the actual screenshots under `website/public/screenshots/market-profile/` and document capture commands in `website/README.md`.
- [x] Verify generated assets load from the site's base path and screenshots show actual letters, markers and theme colors.

## 2. Website pages and profile guides

- [x] Add `website/components/ProfileShowcase.tsx` for the embedded demo and linked theme screenshot gallery; add responsive styling to `website/styles/globals.css`.
- [x] Add `website/pages/docs/market-profile-examples.mdx` with a working demo, theme gallery and instructions for compression, row size, per-day split/unsplit and markers; register it in the docs sidebar.
- [x] Update the website examples page, market-profile guide, themes guide and profile overview to link to the new demo and document which settings belong to the demo.
- [x] Add a compact-profile preview to the homepage; correct current build sizes and test counts in the landing content and footer.
- [x] Build the static site and verify the new routes, embedded demo and image links in a browser.

## 3. Release notes and final checks

- [x] Add matching `2.1.0` sections to `CHANGELOG.md` and website release notes covering the implemented profile features, fixes and website assets.
- [x] Update the repository README with website gallery and screenshot links.
- [x] Generate API docs from the current source and confirm the new options/methods appear.
- [x] Run site build, relevant browser checks and whitespace checks. Review the final changes and provide local website/demo links.

## 4. Authorized publication

- [x] Bump package, lockfile, runtime version and current documentation to 2.1.0. Verify the complete release build.
- [ ] Commit only this task's work, push master and the v2.1.0 tag, and dispatch the existing Release workflow for that tag.
- [ ] Verify CI, npm registry metadata and the deployed website before reporting publication complete.
