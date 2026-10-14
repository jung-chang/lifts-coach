import type { Evidence } from '../shared/types';

// Original editorial summaries. Confidence is a qualitative judgment, not formal GRADE.
// See matching Markdown records for review scope and maintenance guidance.
export const evidence: Evidence[] = [
  {
    id: 'acsm-progressive-training-2026',
    topics: ['programming', 'progression', 'strength', 'hypertrophy'],
    claim:
      'Progressive resistance training improves strength, muscle size and physical function. Load, volume and exercise order should match the goal rather than follow one universal program.',
    applicability: 'Healthy adults.',
    confidence: 'High for general benefit.',
    limitations: 'Overview of reviews; individual responses vary. Abstract reviewed.',
    title: 'ACSM resistance training position stand',
    year: 2026,
    url: 'https://pubmed.ncbi.nlm.nih.gov/41843416/',
  },
  {
    id: 'acsm-accessible-training-2026',
    topics: ['equipment', 'schedule', 'consistency', 'beginner'],
    claim:
      'ACSM recommends training major muscle groups regularly and building gradually. Home, band and bodyweight training can be useful; elaborate equipment and methods are optional.',
    applicability: 'Healthy adults starting or maintaining training.',
    confidence: 'Moderate to high.',
    limitations: 'Official public summary, not a personalized prescription.',
    title: 'ACSM effective resistance training plan',
    year: 2026,
    url: 'https://www.acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf',
  },
  {
    id: 'strength-load-2023',
    topics: ['strength', 'load', 'weight', 'reps'],
    claim:
      'Heavier-load prescriptions generally produce greater maximal-strength gains. Choose load according to the strength goal and current ability.',
    applicability: 'Healthy adults.',
    confidence: 'Moderate to high.',
    limitations: 'Network comparisons and varied protocols; abstract reviewed.',
    title: 'Resistance training prescription network meta-analysis',
    year: 2023,
    url: 'https://pubmed.ncbi.nlm.nih.gov/37414459/',
  },
  {
    id: 'hypertrophy-load-2023',
    topics: ['hypertrophy', 'load', 'volume', 'sets'],
    claim:
      'Many tested prescriptions increased muscle size; multiple-set programs ranked well. No single load range is necessary for growth.',
    applicability: 'Healthy adults.',
    confidence: 'Moderate.',
    limitations: 'Ranking does not prove a universal optimum; abstract reviewed.',
    title: 'Resistance training prescription network meta-analysis',
    year: 2023,
    url: 'https://pubmed.ncbi.nlm.nih.gov/37414459/',
  },
  {
    id: 'split-fullbody-2024',
    topics: ['split', 'full-body', 'schedule', 'programming'],
    claim:
      'Split and full-body routines showed similar strength and growth outcomes when volume was equated. Fit the split to preferences and available days.',
    applicability: 'Healthy adults in the included trials.',
    confidence: 'Moderate.',
    limitations:
      'Fourteen studies; similar averages do not guarantee identical individual outcomes. Abstract reviewed.',
    title: 'Split versus full-body training meta-analysis',
    year: 2024,
    url: 'https://pubmed.ncbi.nlm.nih.gov/38595233/',
  },
  {
    id: 'frequency-hypertrophy-2019',
    topics: ['frequency', 'schedule', 'hypertrophy', 'volume'],
    claim:
      'Higher frequency did not meaningfully improve hypertrophy when weekly volume was equated. Frequency can distribute a manageable amount of training.',
    applicability: 'Participants in resistance-training trials.',
    confidence: 'Moderate.',
    limitations:
      'Volume and frequency interact; extreme schedules are not established. Abstract reviewed.',
    title: 'Training frequency and hypertrophy meta-analysis',
    year: 2019,
    url: 'https://pubmed.ncbi.nlm.nih.gov/30558493/',
  },
  {
    id: 'frequency-strength-2018',
    topics: ['frequency', 'strength', 'volume', 'schedule'],
    claim:
      'Higher frequency was associated with strength gains overall, but the volume-equated subgroup did not show a significant independent frequency effect.',
    applicability: 'Mostly untrained study participants.',
    confidence: 'Moderate.',
    limitations:
      'Few trained participants; absence of significance is not proof of equivalence. Abstract reviewed.',
    title: 'Training frequency and strength meta-analysis',
    year: 2018,
    url: 'https://pubmed.ncbi.nlm.nih.gov/29470825/',
  },
  {
    id: 'rest-hypertrophy-2024',
    topics: ['rest', 'recovery', 'hypertrophy'],
    claim:
      'Resting longer than 60 seconds may have a small growth advantage. The review did not identify appreciable additional hypertrophy differences beyond 90 seconds.',
    applicability: 'Healthy adults in nine studies.',
    confidence: 'Moderate.',
    limitations:
      'Substantial heterogeneity; not a ceiling on useful rest for performance. Abstract reviewed.',
    title: 'Inter-set rest Bayesian meta-analysis',
    year: 2024,
    url: 'https://pubmed.ncbi.nlm.nih.gov/39205815/',
  },
  {
    id: 'failure-hypertrophy-2023',
    topics: ['failure', 'effort', 'hypertrophy', 'fatigue'],
    claim:
      'Momentary failure was not clearly superior to non-failure training for hypertrophy. Closer-to-failure work does not automatically yield greater growth.',
    applicability: 'Healthy adults across included training backgrounds.',
    confidence: 'Moderate.',
    limitations:
      'Failure definitions and protocols differ; exact optimal repetitions in reserve remain uncertain. Abstract reviewed.',
    title: 'Proximity-to-failure hypertrophy meta-analysis',
    year: 2023,
    url: 'https://pubmed.ncbi.nlm.nih.gov/36334240/',
  },
  {
    id: 'failure-strength-2022',
    topics: ['failure', 'strength', 'fatigue', 'recovery'],
    claim:
      'The pooled comparison did not find a significant strength or hypertrophy difference between failure and non-failure training. Failure need not be a compulsory set target.',
    applicability: 'Young adults in fifteen studies.',
    confidence: 'Moderate.',
    limitations:
      'Subgroups and volume matching can change interpretation; not direct evidence for all ages. Abstract reviewed.',
    title: 'Failure versus non-failure training meta-analysis',
    year: 2022,
    url: 'https://pubmed.ncbi.nlm.nih.gov/33497853/',
  },
  {
    id: 'weekly-volume-2017',
    topics: ['volume', 'sets', 'hypertrophy'],
    claim:
      'Greater weekly set volume was associated with greater muscle growth across the studied range. Increase volume gradually when recovery and performance support it.',
    applicability: 'Participants in fifteen included studies.',
    confidence: 'Moderate.',
    limitations:
      'Does not establish unlimited benefit or an individual maximum; abstract reviewed.',
    title: 'Weekly training volume dose-response meta-analysis',
    year: 2017,
    url: 'https://pubmed.ncbi.nlm.nih.gov/27433992/',
  },
  {
    id: 'exercise-order-2021',
    topics: ['order', 'strength', 'programming', 'hypertrophy'],
    claim:
      'Strength gains tended to be largest for exercises placed early in the session. The pooled hypertrophy comparison did not show a significant order effect.',
    applicability: 'Included resistance-training populations.',
    confidence: 'Moderate.',
    limitations:
      'Eleven studies; prioritize goals while adapting to equipment availability. Abstract reviewed.',
    title: 'Resistance exercise order meta-analysis',
    year: 2021,
    url: 'https://pubmed.ncbi.nlm.nih.gov/32077380/',
  },
  {
    id: 'machines-freeweights-2023',
    topics: ['equipment', 'substitution', 'machines', 'free-weights'],
    claim:
      'Machines and free weights produced similar pooled growth outcomes; strength gains were specific to the trained modality. Substitutions should preserve goals and comfort.',
    applicability: 'Adults aged 18–60 in included studies.',
    confidence: 'Moderate.',
    limitations:
      'Only five studies assessed hypertrophy; loads are not interchangeable across equipment. Abstract reviewed.',
    title: 'Free-weight versus machine training meta-analysis',
    year: 2023,
    url: 'https://pubmed.ncbi.nlm.nih.gov/37582807/',
  },
  {
    id: 'exercise-variation-2022',
    topics: ['variation', 'substitution', 'programming'],
    claim:
      'Planned exercise variation may support regional growth and strength. Frequent random changes can interfere with a consistent training stimulus.',
    applicability: 'Young men in eight studies.',
    confidence: 'Low to moderate.',
    limitations:
      'Small, narrow population; no universal rotation schedule established. Abstract reviewed.',
    title: 'Resistance exercise variation systematic review',
    year: 2022,
    url: 'https://pubmed.ncbi.nlm.nih.gov/35438660/',
  },
  {
    id: 'range-of-motion-2023',
    topics: ['range-of-motion', 'technique', 'hypertrophy', 'selection'],
    claim:
      'Some muscles grew more with training at longer muscle lengths. Full and selected partial ranges can differ in effect depending on muscle and exercise.',
    applicability: 'Muscles and exercises studied in eleven trials.',
    confidence: 'Low to moderate.',
    limitations:
      'Muscle-specific findings cannot justify painful or forced ranges. Abstract reviewed.',
    title: 'Range of motion and hypertrophy systematic review',
    year: 2023,
    url: 'https://pubmed.ncbi.nlm.nih.gov/36662126/',
  },
  {
    id: 'repetition-tempo-2015',
    topics: ['tempo', 'technique', 'hypertrophy'],
    claim:
      'The review reported similar growth across repetition durations from roughly half a second to eight seconds. No precise tempo is required by this evidence.',
    applicability: 'Healthy participants training to failure.',
    confidence: 'Low to moderate.',
    limitations:
      'Eight studies and older evidence; not a comparison of all techniques or power training. Abstract reviewed.',
    title: 'Repetition duration hypertrophy meta-analysis',
    year: 2015,
    url: 'https://pubmed.ncbi.nlm.nih.gov/25601394/',
  },
  {
    id: 'concurrent-training-2022',
    topics: ['sports', 'cardio', 'recovery', 'power', 'schedule'],
    claim:
      'Concurrent aerobic and strength training generally preserved maximal strength and whole-muscle growth. Explosive-strength gains were more affected, especially within the same session.',
    applicability: 'Healthy adults in supervised trials.',
    confidence: 'Moderate.',
    limitations:
      'Individual sport loads and fatigue vary; scheduling findings are not guaranteed thresholds. Abstract reviewed.',
    title: 'Concurrent aerobic and strength training meta-analysis',
    year: 2022,
    url: 'https://pubmed.ncbi.nlm.nih.gov/34757594/',
  },
  {
    id: 'plyometrics-2019',
    topics: ['plyometrics', 'power', 'sports', 'jump', 'sprint'],
    claim:
      'Lower-body plyometric programs improved jump, sprint and strength outcomes on average. Athletic goals may benefit from power-specific training rather than only lifting.',
    applicability: 'Healthy recreationally active adults and athletes.',
    confidence: 'Moderate.',
    limitations:
      'Short interventions and heterogeneous results; appropriate landing technique and readiness matter. Abstract reviewed.',
    title: 'Plyometric training performance meta-analysis',
    year: 2019,
    url: 'https://pubmed.ncbi.nlm.nih.gov/31136014/',
  },
  {
    id: 'nsca-older-adults-2019',
    topics: ['older-adults', 'function', 'strength', 'individualization'],
    claim:
      'NSCA identifies resistance training as useful for countering age-related losses in strength and muscle and supporting physical function.',
    applicability: 'Older adults; adapt to abilities and health context.',
    confidence: 'Moderate to high for general benefit.',
    limitations:
      'Official overview reviewed; this record does not supply clinical or rehabilitation prescriptions.',
    title: 'NSCA resistance training for older adults position statement',
    year: 2019,
    url: 'https://www.nsca.com/about-us/position-statements/resistance-training-for-older-adults/',
  },
  {
    id: 'periodization-2022',
    topics: ['periodization', 'plateau', 'strength', 'hypertrophy'],
    claim:
      'Volume-equated periodized programs showed a small pooled strength advantage, with no clear hypertrophy advantage. Complexity is optional and should serve a specific goal.',
    applicability: 'Included resistance-training populations.',
    confidence: 'Moderate.',
    limitations:
      'Models and training status differ; newer ACSM overview finds inconsistent effects across outcomes. Abstract reviewed.',
    title: 'Volume-equated periodization meta-analysis',
    year: 2022,
    url: 'https://pubmed.ncbi.nlm.nih.gov/35044672/',
  },
];
export const evidenceRecords = evidence;
export const records = evidence;
