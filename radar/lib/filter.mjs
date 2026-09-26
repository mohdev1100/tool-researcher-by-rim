// Relevance and report-likeness classification, driven by config.json keyword lists.

import { normText, normalizeArabic, stripLatinDiacritics } from './text.mjs'

function latinRe(list) {
  return list && list.length ? new RegExp(list.map(s => stripLatinDiacritics(s)).join('|'), 'iu') : /$^/
}

function arabicList(list) {
  return (list || []).map(s => normText(s)).filter(Boolean)
}

const AR_PREFIX = '(?:وال|بال|لل|فال|كال|ال|و|ب|ل|ف|ك)?'
const AR_SUFFIX = '(?:ات|ان|ين|ون|تان|تين|ها|هما|هم|هن|كم|كن|نا|ني|ه|ك|ي)?'
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Word-level Arabic matcher: the keyword may carry the usual clitic prefixes (ال، و، ب، ل…) and nominal
 * suffixes (ات، ين، ها…) but must otherwise stand as a word. Plain substring matching let verb forms
 * through — «تبحثان» (they discuss) contains «بحث» (research) — and marked half of a news feed as reports.
 */
function arabicWordRe(list) {
  const words = arabicList(list)
  return words.length ? new RegExp(`(?<![\\p{L}])${AR_PREFIX}(?:${words.map(esc).join('|')})${AR_SUFFIX}(?![\\p{L}])`, 'u') : /$^/
}

export function makeMatchers(config) {
  return {
    // Relevance keywords stay substring-based: «موريتاني» inside any form is always about us.
    direct: { re: latinRe(config.keywords.latin), ar: arabicList(config.keywords.arabic) },
    regional: { re: latinRe(config.regional.latin), ar: arabicList(config.regional.arabic) },
    // Report and noise words are matched as words.
    report: { re: latinRe(config.report_words.latin), ar: [], word: arabicWordRe(config.report_words.arabic) },
    noise: { re: latinRe(config.noise_words && config.noise_words.latin), ar: [], word: arabicWordRe(config.noise_words && config.noise_words.arabic) },
  }
}

function hit(t, m) {
  return m.re.test(t) || (m.ar && m.ar.some(k => t.includes(k))) || (m.word ? m.word.test(t) : false)
}

export function itemText(item) {
  return normText([item.title, item.summary, item.type, (item.tags || []).join(' '), item.publisher].filter(Boolean).join(' • '))
}

/**
 * 'direct'   → the text names Mauritania, or the source is scoped to Mauritania (scope: mauritania)
 * 'regional' → the source is scoped to a region that includes Mauritania (scope: regional — never dropped),
 *              or a global source's text names the Sahel / Maghreb / West Africa / Arab region / Africa
 * null       → not about us (global sources only)
 */
export function relevance(item, source, m) {
  const t = itemText(item)
  if (hit(t, m.direct)) return 'direct'
  if (source.scope === 'mauritania') return 'direct'
  if (source.scope === 'regional') return 'regional'
  if (hit(t, m.regional)) return 'regional'
  return null
}

/**
 * strict = judge the title (and type) only — for news outlets, whose summaries mention reports in passing.
 */
export function isReportLike(item, m, strict = false) {
  if (item.file && /\.pdf(\?|#|$)/i.test(item.file)) return true
  const t = strict ? normText([item.title, item.type].filter(Boolean).join(' • ')) : itemText(item)
  if (hit(t, m.noise)) return false
  return hit(t, m.report)
}

/** Topic tags in the site's own vocabulary (see BUILD-BRIEF §1 seed topics). */
const TOPICS = [
  ['economy', /\b(econom|économ|growth|croissance|gdp|pib|inflation|trade|commerce|investment|investissement|business|entreprise|market|marché|bank|banque|monetary|monétaire|article iv|fmi|imf)\b|اقتصاد|نمو|تضخم|تجار|استثمار|مصرف|بنك|نقدي/iu],
  ['public-finance', /\b(budget|fiscal|debt|dette|tax|impôt|fiscalit|public finance|finances publiques|expenditure|dépenses|revenue|recettes|procurement|marchés publics)\b|ميزانية|موازنة|دين|ديون|ضريب|مالية عامة|إنفاق|نفقات|إيرادات|صفقات/iu],
  ['governance', /\b(governance|gouvernance|corruption|transparen|accountab|redevabilit|rule of law|état de droit|election|élection|electoral|parliament|parlement|democra|démocra|institution)\b|حوكمة|فساد|شفافية|مساءلة|سيادة القانون|انتخاب|برلمان|ديمقراطي|مؤسسات/iu],
  ['rights', /\b(human rights|droits (de l')?homme|droits humains|slavery|esclavage|torture|detention|détention|freedom|liberté|press|presse|journalist|discriminat|minorit|haratin|trafficking|traite)\b|حقوق الإنسان|حقوق الانسان|عبودية|رق\b|استرقاق|تعذيب|اعتقال|حرية|صحاف|تمييز|أقلي|اتجار|حراطين/iu],
  ['development', /\b(development|développement|poverty|pauvreté|sdg|odd|humanitarian|humanitaire|social protection|protection sociale|safety net|filets sociaux|livelihood|resilien|résilien|food security|sécurité alimentaire|nutrition|hunger|faim|famine)\b|تنمية|فقر|أهداف التنمية|إنساني|حماية اجتماعية|أمن غذائي|تغذية|جوع|مجاعة/iu],
  ['mining', /\b(mining|minier|mine|mines|iron|fer|gold|or\b|copper|cuivre|gas|gaz|oil|pétrole|petroleum|hydrocarbon|hydrocarbure|energy|énergie|electricity|électricité|hydrogen|hydrogène|solar|solaire|wind|éolien|gta|tortue|snim|eiti|itie)\b|تعدين|منجم|مناجم|حديد|ذهب|نحاس|غاز|نفط|بترول|محروقات|طاقة|كهرباء|هيدروجين|شمسية|رياح|سنيم|الشفافية في الصناعات الاستخراجية/iu],
  ['health', /\b(health|santé|hospital|hôpital|disease|maladie|epidemic|épidémie|vaccin|malaria|paludisme|hiv|sida|maternal|maternelle|who|oms|covid|cholera|choléra|dengue|measles|rougeole)\b|صحة|صحي|مستشفى|مرض|وباء|لقاح|ملاريا|إيدز|أمومة|كوليرا|حصبة/iu],
  ['education', /\b(education|éducation|school|école|scolaire|university|université|literacy|alphabétisation|teacher|enseignant|student|élève|étudiant|training|formation)\b|تعليم|مدرسة|مدارس|جامعة|أمية|معلم|طلاب|تلاميذ|تكوين|تدريب/iu],
  ['migration', /\b(migra|réfugié|refugee|asylum|asile|displace|déplac|border|frontière|canary|canaries|atlantic route|route atlantique|frontex|smuggl|mbera|mberra|diaspora|return|retour)\b|هجرة|مهاجر|لاجئ|لجوء|نزوح|نازح|حدود|جزر الكناري|مبرة|شتات|عودة/iu],
  ['justice', /\b(justice|judicia|court|tribunal|cour|prison|law|loi|legal|juridique|penal|pénal|crime|criminal|criminel|police|gendarmerie|impunit)\b|عدالة|قضاء|قضائي|محكمة|سجن|قانون|قانوني|جريمة|جنائي|شرطة|درك|إفلات من العقاب/iu],
  ['social', /\b(gender|genre|women|femmes|girl|fille|youth|jeunes|jeunesse|child|enfant|family|famille|population|census|recensement|demograph|démograph|household|ménage|employment|emploi|labour|labor|travail|unemployment|chômage|housing|logement|urban|urbain|culture|religio|society|société)\b|نوع اجتماعي|جندر|نساء|امرأة|مرأة|فتاة|فتيات|شباب|طفل|أطفال|أسرة|سكان|تعداد|إحصاء السكان|ديمغراف|ديموغراف|أسر|توظيف|عمل|عمالة|بطالة|سكن|حضري|ثقافة|دين|مجتمع/iu],
  ['environment', /\b(environment|environnement|climate|climat|drought|sécheresse|flood|inondation|desertif|désertif|water|eau|sanitation|assainissement|fisher|pêche|ocean|océan|marine|marin|biodivers|forest|forêt|pastoral|livestock|élevage|bétail|agricultur|agricole|rainfall|pluvio|locust|criquet)\b|بيئة|مناخ|جفاف|فيضان|تصحر|مياه|صرف صحي|صيد|أسماك|محيط|بحري|تنوع بيولوجي|غابات|رعي|رعوي|ماشية|مواشي|زراعة|زراعي|أمطار|جراد/iu],
]

export function topicsFor(item) {
  const t = [item.title, item.summary, item.type, (item.tags || []).join(' ')].filter(Boolean).join(' • ')
  const tn = normalizeArabic(t)
  const out = []
  for (const [slug, re] of TOPICS) {
    if (re.test(t) || re.test(tn)) out.push(slug)
  }
  return out
}
