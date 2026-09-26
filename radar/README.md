# Tool Researcher by RIM — رادار التقارير

أداة سطر أوامر صغيرة (Node 22، بلا أي اعتماديات) تراقب يوميًا المصادر الموثوقة — منظمات دولية، مؤسسات مالية، هيئات حكومية، منظمات حقوقية، مراكز بحث، مجمّعات أكاديمية — وتجمع **التقارير الجديدة عن موريتانيا** المنشورة منذ تاريخ محدد (افتراضيًا 2026-01-01)، ثم تنتج خلاصة عربية ولوحة تصفح وخلاصة RSS يستعملها فريق التحرير لاختيار ما يستحق المراجعة.

## التشغيل السريع

```bash
node radar/radar.mjs check --verbose   # يفحص كل مصدر ويكتب out/health.md دون تغيير البيانات
node radar/radar.mjs run               # يجمع الجديد، يحدّث data/ ويكتب out/
node radar/radar.mjs run --dry         # تجربة دون كتابة
node radar/radar.mjs list --new 7      # ما رُصد خلال 7 أيام
node radar/radar.mjs sources           # جدول المصادر وحالتها
node --test radar/test/                # اختبارات القارئات (RSS/Atom/JSON/HTML/التواريخ/التصفية)
```

أو عبر `npm run radar` / `npm run radar:check` / `npm run radar:test` من جذر المستودع.

## المخرجات

| الملف | ما هو |
|---|---|
| `radar/out/digest.md` | خلاصة عربية: الجديد في هذا التشغيل (مباشر ثم إقليمي)، ثم ما رُصد خلال آخر 14 يومًا، ثم المصادر المتعثرة |
| `radar/out/index.html` | لوحة تصفح مستقلة بذاتها (تعمل دون اتصال): بحث، تصفية حسب الصلة والفئة والناشر والموضوع واللغة والتاريخ، تنزيل CSV، نسخ القائمة كـ Markdown |
| `radar/out/feed.xml` · `feed.json` | خلاصة RSS / JSON Feed لكل ما يخص موريتانيا مباشرة — للاشتراك من قارئ خلاصات أو للاستيراد لاحقًا في ووردبريس |
| `radar/out/health.md` | نتيجة آخر `check`: حالة كل مصدر، عدد العناصر، أحدث تاريخ، الخطأ إن وجد |
| `radar/data/reports.json` | المخزن الكامل (كل عنصر مرة واحدة، مع `first_seen` و`mirrors` للنسخ المكررة على مواقع أخرى) |
| `radar/data/state.json` | حالة كل مصدر (ETag، آخر نجاح، عدد الإخفاقات المتتالية) وسجل التشغيلات |

## كيف تعمل التصفية

1. **النافذة الزمنية** — `since` في `config.json` (أو `--since`). يُسقط ما تاريخه أقدم؛ ما لا تاريخ له يُحتفظ به وتاريخ رصده هو المرجع.
2. **الصلة** — `direct` إذا ذُكرت موريتانيا/نواكشوط/نواذيبو بأي لغة (بادئات العربية مثل «بموريتانيا» و«الموريتانية» مغطاة)، أو إذا كان المصدر أصلًا مخصصًا لموريتانيا (`scope: mauritania`)؛ `regional` إذا كان المصدر مقصورًا على إقليم يضم موريتانيا (`scope: regional` — لا يُسقط شيء منه) أو إذا ذكر مصدرٌ عام الساحل/المغرب العربي/غرب أفريقيا/المنطقة العربية…؛ وإلا يُسقط.
3. **تقرير لا خبر** — للمصادر العامة (`scope: global|regional`) أو الإعلامية (`tier: C`) يُشترط أن يبدو العنصر وثيقة (تقرير/دراسة/مؤشر/نشرة/PDF…) لا خبرًا عابرًا؛ تُضبط بـ `only_reports` لكل مصدر، والكلمات في `config.json`. الكلمات العربية تُطابَق ككلمات (مع سوابق «ال/و/ب/ل» ولواحق الجمع والضمائر) لا كأجزاء من كلمات — «تبحثان» لا تعني «بحث». `strict_reports: true` يحكم على العنوان وحده (للمواقع الإخبارية التي تذكر التقارير عرضًا في المتن).
4. **إزالة التكرار** — بالرابط المعياري أولًا (بلا `utm_`، بلا `www`، …)، ثم بالعنوان: العنصر نفسه على ReliefWeb وعلى موقع الناشر يُسجَّل مرة واحدة مع قائمة `mirrors`.
5. **الموضوعات** — تُستنتج بالكلمات المفتاحية في مفردات الموقع نفسها (اقتصاد، مالية عامة، حوكمة، حقوق الإنسان، تنمية، تعدين وطاقة، صحة، تعليم، هجرة، عدالة، مجتمع، بيئة).

## إضافة مصدر

المصادر في `radar/sources.json`. لكل مصدر: `id` (فريد، kebab-case)، `name`، `name_ar`، `publisher`، `tier` (A مؤسسة أولية / B مركز بحثي / C إعلام ومجمّعات)، `category`، `kind`، `scope` (`mauritania` إذا كان الرابط نفسه مقصورًا على موريتانيا، وإلا `regional` أو `global` فتُطبَّق تصفية الكلمات)، `language`، `url`. العناصر النائبة `{since}` و`{year}` و`{today}` تُستبدل في الرابط.

- **`kind: "rss"`** — RSS 2.0 أو Atom. لا إعداد إضافي. اختياريًا `publisher_regex` (يلتقط الناشر الحقيقي من نص العنصر — تجميعيات مثل ReliefWeb) و`summary_strip`.
- **`kind: "api"`** — JSON مع خريطة مسارات:
  ```json
  "api": { "items": "result.results", "title": "title", "url": "name", "url_prefix": "https://…/dataset/", "date": "metadata_modified", "file": "pdf_url", "summary": "notes", "publisher": "organization.title", "tags": "tags", "type": "=dataset" }
  ```
  المسار منقّط (`a.b.0.c`)، والقيمة قد تكون قائمة بدائل (الأول غير الفارغ يُؤخذ)، و`=نص` قيمة حرفية.
- **`kind: "html"`** — صفحة قائمة. إما `"html": { "link": "/publications/", "section": "<main", "date_window": 400 }` (كل رابط يطابق النمط، عنوانه نص الرابط، وتاريخه أقرب تاريخ حوله)، أو تعبير نمطي بمجموعات مسماة: `"html": { "item": "<li class=\"pub\">.*?<a href=\"(?<url>[^\"]+)\">(?<title>.*?)</a>.*?<time>(?<date>[^<]+)</time>", "flags": "is" }`.
- خيارات لأي مصدر: `only_reports`، `require_date`، `max_items`، `timeout_ms`، `headers` (قيمة تبدأ بـ `$` تُقرأ من متغير بيئة بالاسم نفسه وتُحذف إن كان فارغًا — للمفاتيح مثل `S2_API_KEY`)، `skip_on: ["github"]` (لا يُشغَّل على مشغّل GitHub الذي يرفض عناوينَه هذا الموقع؛ يغطيه التشغيل المحلي — `RADAR_RUNNER` يحدد أين نحن)، `key_with_date: true` (لصفحة واحدة تُحدَّث تحت الرابط نفسه — كملف بلد يحمل «آخر تحديث» — فتُعدّ كل نسخة بتاريخ جديد عنصرًا جديدًا)، `exclude` (تعبير نمطي يُسقط العناصر التي يطابق عنوانها أو نوعها — مثل خطط المشتريات في وثائق البنك الدولي)، `fetcher: "curl" | "browser"` لفرض طريقة الجلب، `browser: false` لمنع المتصفح، `enabled: false` لتعطيل.
- **الجلب على أربع محاولات**: `fetch` المدمج في Node بهوية الأداة الصريحة (`Researcher/1.0 curl/8.21.0` — شبكة AWS WAF أمام ReliefWeb وHDX تتحدى كل هوية لا تصنّفها وتُمرّر أدوات HTTP المعروفة) ← ثم `fetch` بهوية متصفح (لمواقع ترفض غير المتصفحات) ← ثم `curl` النظامي (مكدس TLS مختلف) ← ثم متصفح Playwright (للتحدي بجافاسكريبت أو القوائم المُصيَّرة به؛ محليًا فقط حيث Playwright مثبت). `ua: "honest" | "browser"` يثبّت الهوية، و`state.json` يتذكر المحاولة التي نجحت آخر مرة فيبدأ بها. المسار المستعمل يظهر في `health.md`. **صندوق النقد الدولي (imf.org) يحجب كل شيء بما فيه المتصفح بلا واجهة** — تُستعمل مكتبة IMF eLibrary بدلًا منه.

**سير العمل الموصى به لإضافة مصادر:** اكتب المدخلات في ملف مؤقت (مثل `local/tmp/batch.json` بالشكل `{"sources":[…]}`)، اختبرها بـ `node radar/radar.mjs check --sources local/tmp/batch.json --verbose`، ثم ادمجها بـ `node radar/radar.mjs merge local/tmp/batch.json` (يرفض المكرر بالمعرّف أو الرابط؛ `--replace` لاستبدال مدخل قائم). لاستكشاف رابط قبل كتابة مدخله: `node radar/radar.mjs probe <url> [--link <regex>] [--item <regex>] [--api '<map>'] [--dump file]` يكشف نوعه ويعرض ما يُقرأ منه ويطبع مسودة مدخل.

## الجدولة

الأداة تُشغَّل **محليًا** (قرار المالك 2026-09-26: لا GitHub لها حاليًا).

- **ويندوز** (Task Scheduler) — مرة يوميًا الساعة 07:00:
  ```
  schtasks /Create /SC DAILY /ST 07:00 /TN "Tool Researcher" /TR "cmd /c cd /d C:\path\to\tool-researcher-by-rim && node radar\radar.mjs run --notify"
  ```
  للحذف: `schtasks /Delete /TN "Tool Researcher" /F`. للتشغيل الفوري: `schtasks /Run /TN "Tool Researcher"`.
- **يدويًا**: `npm run radar` ثم افتح `radar/out/index.html`.
- **GitHub Actions** — مؤجل. نص الـ workflow (تشغيل يومي 06:00 UTC مع حفظ `data/` و`out/` في المستودع) محفوظ في `radar/candidates/github-action-radar.yml.txt` ويُعاد إلى `.github/workflows/radar.yml` عندما يطلب المالك ذلك؛ يحتاج حينها الأسرار `RADAR_TELEGRAM_TOKEN` و`RADAR_TELEGRAM_CHAT` (أو `RADAR_WEBHOOK_URL`) في إعدادات المستودع.

## التنبيهات

`radar/.env` (لا يُرفع إلى git):
```
RADAR_TELEGRAM_TOKEN=123456:ABC…      # من @BotFather
RADAR_TELEGRAM_CHAT=-1001234567890    # معرّف المجموعة/القناة (أضف البوت إليها)
# أو
RADAR_WEBHOOK_URL=https://…           # يستقبل POST بجسم JSON {text, date, new_direct, items}
```
ثم `node radar/radar.mjs run --notify`. لا تُرسل رسالة إذا لم يوجد جديد.

## استكشاف الأخطاء

- `ERR HTTP 403` — الموقع يحجب العملاء غير المتصفحية. محليًا يجرّب الرادار Playwright تلقائيًا (`--no-browser` لتعطيله)؛ ما يبقى محجوبًا يُذكر في `digest.md` و`health.md`.
- **`radar/candidates/`** — نتائج البحث عن المصادر (2026-09-25: ثماني فئات، نحو 190 مرشحًا مع روابطهم وتلميحات القراءة وما تعذّر الوصول إليه) لمن يريد إضافة مصادر لاحقًا دون إعادة البحث.
- `ERR parse: not a feed` — تغيّر الرابط أو أعاد HTML؛ جرّب `probe`.
- مصدر يعطي 0 عناصر — تغيّرت بنية الصفحة؛ حدّث `html.link` أو `html.item`.
- `check` يُرجع رمز خروج 1 إذا تعثر أي مصدر أو أعاد صفرًا — مناسب لمراقبة الجدولة.

---

## English summary

`radar/` is a zero-dependency Node 22 CLI that polls reliable publishers (APIs, RSS/Atom, listing pages), keeps items about Mauritania published since `config.since`, classifies them (direct / regional, report-like, topics in the site's own vocabulary), de-duplicates by canonical URL and by title (mirrors), and writes an Arabic Markdown digest, a self-contained filterable dashboard (`out/index.html`), RSS + JSON feeds, and a source-health sheet. `sources.json` is the only file the editors need to touch; `probe <url>` drafts an entry and `merge <batch.json>` folds tested entries in. It runs locally (Windows Task Scheduler command above; the GitHub Action is parked in `radar/candidates/` until the owner asks for it); Telegram/webhook notifications are optional. Tests: `node --test radar/test/*.test.mjs`.
