# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the config-driven single `/` showcase route with semantic Hero, Proof, Install, Requirements, FAQ, and repository-control surfaces.

## Important Decisions

- Keep Task 03 static: install and repository actions are native links, proof uses the configured media/fallback contract, and no clipboard, live-star, motion, or visual-system behavior is pulled forward from Tasks 04-06.
- Use one shared `Section.astro` wrapper for config-defined IDs, `aria-labelledby`, `h2` headings, and section body copy; Hero owns the page's single `h1`.
- Pass typed config slices from `index.astro` into presentational components so public claims and install/repository values remain centralized in `showcase-config.ts`.
- Reserve `install.primaryCtaLabel` for Task 04's actual clipboard control; Task 03 links use the config-backed Hero install label so they do not promise a copy action they cannot perform.

## Learnings

- Task 03 automated evidence is clean: site tests pass 15/15, measured config/helper coverage is 100%, Astro check reports 0 errors/warnings/hints, the build emits one `dist/index.html`, and the root `typecheck && test` gate passes 1,556 tests with 0 failures and 2 expected credentialed skips.
- The browser-control runtime reports no available browser backends in this session, so the required manual keyboard and desktop/mobile viewport smoke cannot be evidenced.

## Files / Surfaces

- `site/src/pages/index.astro`
- `site/src/components/{Section,Hero,Proof,Install,Requirements,Faq,SiteControls}.astro`
- `site/test/landing-page.test.ts`

## Errors / Corrections

- The first render test incorrectly required empty build stderr. Bun writes its script banner there, and RTK's inherited color environment can add a warning even on exit 0; the test now gates on exit code and preserves both streams as failure context.
- A post-build `rtk test -f dist/index.html` probe resolved to RTK's test-command handling and `/usr/bin/test` does not exist on this macOS host; use `/bin/test` explicitly for the final artifact check.
- UI self-review found that `SiteControls` initially used the future clipboard CTA label on a plain anchor. It now uses the Hero install label and reserves copy language for Task 04's real copy interaction.

## Ready for Next Run

- Implementation and automated gates are ready for a browser-backed smoke at the local `/Kitten/` preview URL. Verify heading order, visible focus/tab order for the two install links and GitHub link, and section ordering at mobile and desktop widths.
- Keep `task_03.md` pending and do not commit until that browser evidence is clean; then update memory, checkboxes, and status in the required sequence.
