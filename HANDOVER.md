# HANDOVER — Tool Researcher by RIM

Written for whoever picks this tool up next, human or AI session. `README.md` explains what the tool is; `radar/README.md` (Arabic first) is the user guide and the source-entry reference. This file carries the state, the decisions, the measured traps and what is still owed.

## 1. State (2026-09-26)

- **Live:** <https://mohdev1100.github.io/tool-researcher-by-rim/> — public repo `mohdev1100/tool-researcher-by-rim`, GitHub Pages in Actions mode.
- **Updates:** `.github/workflows/researcher.yml` runs daily at 06:00 UTC, on **Actions → tool-researcher → Run workflow**, and on any push that touches `radar/sources.json`, `radar/config.json`, `radar/lib/**` or `radar/radar.mjs`. It runs the radar, commits `radar/data` + `radar/out` as "researcher: <date> run", then deploys `radar/out` to Pages. Every run so far: success.
- **Content:** 176 sources in `radar/sources.json` (166 enabled, 18 of them skipped on GitHub's runner — see §3). Store: 810 items, 709 directly about Mauritania, from ~240 publishers, all published since 2026-01-01.
- **Outputs on the site:** `index.html` (dashboard: 30-day trends, search, filters, CSV, copy-as-Markdown, copy-AI-brief), `digest.md`, `brief.md`, `feed.xml`, `feed.json`, `health.md`.
- **Tests:** `node --test radar/test/*.test.mjs` — 11 tests over real fixtures, green.
- **Secrets configured:** none yet (see §5).

## 2. How to work on it

```bash
npm run radar            # full run locally: polls every enabled source, updates data/ and out/
npm run check            # health check only, writes out/health.md
npm run brief            # prints the last-7-days AI brief
npm test
node radar/radar.mjs probe <url> [--link <regex>] [--item <regex>] [--api '<map>'] [--dump file]
node radar/radar.mjs check --sources tmp-batch.json --only <id> --verbose
node radar/radar.mjs merge tmp-batch.json      # folds tested entries in, dedup by id and URL
```

Adding a source: write the entry in a scratch file, `probe` and `check` it until the sample titles, dates and URLs are right, then `merge`. Pushing a change to `sources.json` triggers a run and a redeploy by itself. **Always `git pull --rebase` before pushing** — the Action commits every day.

## 3. Measured traps

- **Datacenter blocks.** 18 hosts refuse GitHub's runner addresses but answer a home connection (AfDB ×3, IMF eLibrary, Frontex ×3, IOM ×2, UN Women, EITI, ESCWA, IRENA, ND-GAIN, UNECA repository, European Parliament think tank, Africa CDC, theses.fr). They carry `"skip_on": ["github"]`; the Action sets `RADAR_RUNNER=github`; they show as "skipped" in the health table. **A local run is the only way they are collected** — run `npm run radar` on the owner's machine from time to time, then `git pull --rebase && git push`.
- **AWS WAF identity.** ReliefWeb, HDX and others answer an empty `202` + `x-amzn-waf-action: challenge` to any identity they cannot classify, including a spoofed Chrome UA. The radar identifies as `Researcher/1.0 curl/8.21.0` (the curl token is what passes; a bare custom name is challenged) first, then browser UA, then real curl, then Playwright (local only). Never give a WAF-fronted host a browser UA.
- **imf.org blocks everything**, headless Chromium included; IMF eLibrary is the IMF entry.
- **Rate limits on shared addresses:** Semantic Scholar (429 on the runner every time) and CORE. Header values starting with `$` are read from the environment, so free API keys fix it (§5).
- **DSpace repositories** (WHO IRIS, UNECA): use the OpenSearch Atom feed; REST `lastModified` is a re-index time, not the issue date.
- **Arabic matching:** report words match as whole words with clitic prefixes/suffixes, not substrings («تبحثان» is not «بحث»). Bare «Africa» is deliberately not a regional keyword.
- **Windows tooling:** Git Bash heredocs halve backslashes in regexes and break on apostrophes — write JSON/regex files with an editor; `node --test` needs the file glob; a regex beginning with `/` on the command line needs `MSYS_NO_PATHCONV=1`.
- **Privacy:** the site and repo carry no name of the team or its website (scrubbed 2026-09-26, history rewritten). Keep it that way: no team name, site URL, emails or tokens in code, docs, outputs or the fetch identity. One API token (HDX HAPI) embeds an email in base64; it was replaced with a placeholder before publishing. Keep emails and tokens out of `sources.json` — use `$VAR` headers and repository secrets.

## 4. Decisions (do not reopen without a reason)

- Zero dependencies: the Action installs nothing; Playwright is an optional local fallback only.
- Sources are data (`sources.json`), not code.
- Scope: `mauritania` = URL limited to Mauritania (everything kept, direct); `regional` = region containing Mauritania (never dropped); `global` = keyword-filtered. A site search on a general site is `global`.
- `only_reports` defaults to false for `mauritania`, true otherwise; `strict_reports` judges titles only (news outlets).
- De-duplication: canonical URL, then identical normalised title within 60 days (`mirrors`); `key_with_date` makes a re-issued single page a new item per edition.
- The site is public by the owner's choice (GitHub Pages on the free plan cannot be private). It holds only public report metadata. For a login-protected version, deploy `radar/out` to Cloudflare Pages behind Cloudflare Access instead.

## 5. Still owed

1. **Secrets (owner):** `S2_API_KEY` (free, api.semanticscholar.org) — the one source still erroring on the runner; optionally `CORE_API_KEY` (`Bearer <key>`, core.ac.uk); optionally `RADAR_TELEGRAM_TOKEN` + `RADAR_TELEGRAM_CHAT` for new-report alerts. Settings → Secrets and variables → Actions.
2. **Periodic local run** to cover the 18 runner-blocked sources (§3).
3. **Completeness review** of the source list — never ran (usage limits). Thin areas: fisheries, mining/gas/hydrogen bodies, election observers (AU, EU EOM, Carter Center), Spanish migration institutes, rating agencies, universities. The research that produced the current list, including every unreachable publisher and what was tried, is in `radar/candidates/researched-2026-09-25.json`.
4. **Ideas, not built:** an optional Claude pass giving Latin items Arabic titles and summaries; "already reviewed" marking against the editors' own index; importing `feed.json` into a CMS as draft posts.
5. **Housekeeping:** the Action logs warn that `actions/*@v4` run on a deprecated Node 20 and that `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19; bump the action versions when v5 releases are available.

## 6. History

Built 2026-09-25/26; this repository is the canonical copy.
