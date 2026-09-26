# Tool Researcher by RIM

أداة رصد يومية تمرّ على مصادر مؤسسية وبحثية موثوقة (وكالات الأمم المتحدة، المؤسسات المالية الدولية، الهيئات الرسمية، المنظمات الحقوقية، مراكز البحث، المجمّعات الأكاديمية…) وتجمع **التقارير الجديدة عن موريتانيا** المنشورة منذ مطلع 2026، ثم تعرضها في لوحة تصفح وخلاصة عربية وموجز جاهز للصق في أي مساعد ذكاء اصطناعي.

A daily research radar: it polls 170+ institutional and research sources, keeps the new reports about Mauritania published since 2026, de-duplicates them, and publishes a filterable dashboard, an Arabic digest, an AI-ready brief and subscribable feeds.

## Outputs

| File | What it is |
|---|---|
| `index.html` | the dashboard: trends over 30 days, search and filters, PDF links, CSV download, "copy as Markdown", "copy an AI brief" |
| `digest.md` | the Arabic digest of what the last run found |
| `brief.md` | the last 7 days as a paste-ready brief for an AI assistant |
| `feed.xml` · `feed.json` | subscribable feeds |
| `health.md` | how every source fared on the last run |

## How it updates

A GitHub Action runs the radar every day at 06:00 UTC, commits the refreshed data and outputs, and republishes. To refresh on demand: **Actions → tool-researcher → Run workflow**.

## Sources that GitHub's servers cannot reach

Some hosts refuse requests from datacenter addresses while answering a normal connection. They carry `"skip_on": ["github"]` in `radar/sources.json`; the Action skips them and a **local run covers them** (`npm run radar`, then `git pull --rebase && git push`). Two academic APIs (Semantic Scholar, CORE) are rate-limited on shared addresses; free API keys added as the repository secrets `S2_API_KEY` / `CORE_API_KEY` lift that.

## Running it locally

Node 22, no dependencies:

```bash
node radar/radar.mjs run          # poll every source, update data/ and out/
node radar/radar.mjs check        # health check only
node radar/radar.mjs brief --days 7
node --test radar/test/*.test.mjs
```

Handover for the next maintainer: [`HANDOVER.md`](HANDOVER.md). Sources live in `radar/sources.json`; the full guide is in [`radar/README.md`](radar/README.md).

The repository holds the tool, its source list and the collected metadata of public reports (titles, publishers, dates, links). No credentials: secrets live in repository settings. The site is marked `noindex` and disallows crawlers.
