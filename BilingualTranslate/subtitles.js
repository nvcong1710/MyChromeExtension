// ==========================================================================
// Vimi Bilingual — Universal Video Subtitles & Captions Engine
//
// Features:
//  - Universal Multi-Engine Subtitle Capture:
//      * Engine 1: HTML5 TextTracks (Coursera, edX, Canvas, Video.js, Plyr, etc.)
//      * Engine 2: Platform-specific DOM Caption Observers (YouTube, Udemy, etc.)
//      * Engine 3: External SRT/VTT file loader with drag & drop onto video
//  - Real-time Bilingual Translation (Chrome on-device AI + background fallback)
//  - LRU In-memory Cue Cache for zero-latency replay
//  - Fullscreen compatibility (dynamic reparenting to document.fullscreenElement)
//  - Word-level interactive vocabulary integration: click any word in subtitles
//    to look up & save directly to Vimi spaced repetition vocabulary!
//  - Auto-pause on hover (Study mode for LMS lectures)
//  - Draggable & resizable overlay with floating video control badge
// ==========================================================================

(() => {
  const previousInstance = window.__vimiSubtitlesInstance;
  try {
    if (previousInstance?.isAlive?.()) return;
    previousInstance?.destroy?.();
  } catch {}

  const F = self.FuFu;
  const TranslationCard = window.VimiTranslationCard;
  const HAS_LETTER = /\p{L}/u;
  const activeControllers = new Map();
  let subtitleRuntimeActive = true;
  let videoObserver = null;
  let domReadyHandler = null;
  let storageChangeHandler = null;
  const reportedApiErrors = new Set();
  const instanceHandle = {
    isAlive: () => subtitleRuntimeActive && isExtensionContextValid(),
    destroy: () => shutdownStaleSubtitleInstance(),
  };
  window.__vimiSubtitlesInstance = instanceHandle;
  window.__vimiSubtitlesLoaded = true;

  function isExtensionContextValid() {
    try {
      return !!chrome?.runtime?.id;
    } catch {
      return false;
    }
  }

  function isContextInvalidatedError(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function shutdownStaleSubtitleInstance() {
    if (!subtitleRuntimeActive) return;
    subtitleRuntimeActive = false;
    videoObserver?.disconnect();
    videoObserver = null;
    if (domReadyHandler) {
      document.removeEventListener("DOMContentLoaded", domReadyHandler);
      domReadyHandler = null;
    }
    if (storageChangeHandler && isExtensionContextValid()) {
      try { chrome.storage.onChanged.removeListener(storageChangeHandler); } catch {}
    }
    storageChangeHandler = null;
    for (const controller of activeControllers.values()) controller.destroy();
    activeControllers.clear();
    if (window.__vimiSubtitlesInstance === instanceHandle) {
      window.__vimiSubtitlesInstance = null;
      window.__vimiSubtitlesLoaded = false;
    }
  }

  function ensureExtensionContext() {
    if (!subtitleRuntimeActive) return false;
    if (isExtensionContextValid()) return true;
    shutdownStaleSubtitleInstance();
    return false;
  }

  function handleExtensionApiError(operation, error) {
    if (isContextInvalidatedError(error) || !isExtensionContextValid()) {
      shutdownStaleSubtitleInstance();
      return true;
    }
    const signature = `${operation}:${String(error?.message || error || "unknown")}`;
    if (!reportedApiErrors.has(signature)) {
      reportedApiErrors.add(signature);
      console.error(`[Vimi] ${operation} failed:`, error);
    }
    return false;
  }

  async function safeStorageGet(keys) {
    if (!ensureExtensionContext()) return null;
    try {
      return await chrome.storage.local.get(keys);
    } catch (error) {
      handleExtensionApiError("storage read", error);
      return null;
    }
  }

  async function safeStorageSet(values) {
    if (!ensureExtensionContext()) return false;
    try {
      await chrome.storage.local.set(values);
      return true;
    } catch (error) {
      handleExtensionApiError("storage write", error);
      return false;
    }
  }

  async function safeStorageRemove(keys) {
    if (!ensureExtensionContext()) return false;
    try {
      await chrome.storage.local.remove(keys);
      return true;
    } catch (error) {
      handleExtensionApiError("storage remove", error);
      return false;
    }
  }

  async function safeSetConfig(patch) {
    if (!ensureExtensionContext()) return false;
    try {
      await F.setConfig(patch);
      return ensureExtensionContext();
    } catch (error) {
      handleExtensionApiError("config update", error);
      return false;
    }
  }

  async function safeRuntimeMessage(message) {
    if (!ensureExtensionContext()) return null;
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (!handleExtensionApiError("runtime message", error)) {
        // A missing receiver or translation failure is recoverable; the caller
        // can fall back without disabling the subtitle controller.
        return null;
      }
      return null;
    }
  }

  // Verb inflection lemmas for matching phrasal verbs across tenses
  const VERB_LEMMAS = {
    looked: "look", looking: "look", looks: "look",
    gave: "give", gives: "give", giving: "give", given: "give",
    took: "take", takes: "take", taking: "take", taken: "take",
    turned: "turn", turns: "turn", turning: "turn",
    came: "come", comes: "come", coming: "come",
    got: "get", gets: "get", getting: "get", gotten: "get",
    ran: "run", runs: "run", running: "run",
    carried: "carry", carries: "carry", carrying: "carry",
    broke: "break", breaks: "break", breaking: "break", broken: "break",
    sets: "set", setting: "set",
    found: "find", finds: "find", finding: "find",
    made: "make", makes: "make", making: "make",
    held: "hold", holds: "hold", holding: "hold",
    brought: "bring", brings: "bring", bringing: "bring",
    pointed: "point", points: "point", pointing: "point",
    worked: "work", works: "work", working: "work",
    puts: "put", putting: "put",
    picked: "pick", picks: "pick", picking: "pick",
    cuts: "cut", cutting: "cut",
    dropped: "drop", drops: "drop", dropping: "drop",
    figured: "figure", figures: "figure", figuring: "figure",
    hung: "hang", hangs: "hang", hanging: "hang",
    showed: "show", shows: "show", showing: "show", shown: "show",
    stood: "stand", stands: "stand", standing: "stand",
    ended: "end", ends: "end", ending: "end",
    woke: "wake", wakes: "wake", waking: "wake", woken: "wake",
    switched: "switch", switches: "switch", switching: "switch",
    dealt: "deal", deals: "deal", dealing: "deal",
    fell: "fall", falls: "fall", falling: "fall", fallen: "fall",
    grew: "grow", grows: "grow", growing: "grow", grown: "grow",
    called: "call", calls: "call", calling: "call",
    cleaned: "clean", cleans: "clean", cleaning: "clean",
    cheered: "cheer", cheers: "cheer", cheering: "cheer",
    checked: "check", checks: "check", checking: "check",
    handed: "hand", hands: "hand", handing: "hand",
    kept: "keep", keeps: "keep", keeping: "keep",
    passed: "pass", passes: "pass", passing: "pass",
    paid: "pay", pays: "pay", paying: "pay",
    pulled: "pull", pulls: "pull", pulling: "pull",
    shuts: "shut", shutting: "shut",
    slowed: "slow", slows: "slow", slowing: "slow",
    sped: "speed", speeds: "speed", speeding: "speed",
    stayed: "stay", stays: "stay", staying: "stay",
    threw: "throw", throws: "throw", throwing: "throw", thrown: "throw",
    tried: "try", tries: "try", trying: "try",
    warmed: "warm", warms: "warm", warming: "warm",
    watched: "watch", watches: "watch", watching: "watch",
    wrapped: "wrap", wraps: "wrap", wrapping: "wrap",
    wrote: "write", writes: "write", writing: "write", written: "write",
    went: "go", goes: "go", going: "go", gone: "go",
    left: "leave", leaves: "leave", leaving: "leave",
    sat: "sit", sits: "sit", sitting: "sit",
    built: "build", builds: "build", building: "build",
    bought: "buy", buys: "buy", buying: "buy",
    caught: "catch", catches: "catch", catching: "catch",
    drew: "draw", draws: "draw", drawing: "draw",
    blew: "blow", blows: "blow", blowing: "blow", blown: "blow",
    stuck: "stick", sticks: "stick", sticking: "stick",
    led: "lead", leads: "lead", leading: "lead",
    met: "meet", meets: "meet", meeting: "meet",
    sent: "send", sends: "send", sending: "send",
    lost: "lose", loses: "lose", losing: "lose",
    won: "win", wins: "win", winning: "win",
    wore: "wear", wears: "wear", wearing: "wear", worn: "wear"
  };

  // English unpluralizer for matching plural noun phrases (e.g. "operating systems" -> "operating system")
  function unpluralize(word) {
    if (!word || word.length < 3) return word;
    const w = word.toLowerCase();
    const irregulars = {
      people: "person", children: "child", men: "man", women: "woman",
      teeth: "tooth", feet: "foot", mice: "mouse", data: "data",
      media: "media", criteria: "criterion", phenomena: "phenomenon",
      analyses: "analysis", crises: "crisis", bases: "basis"
    };
    if (irregulars[w]) return irregulars[w];
    if (w.endsWith("ies") && w.length > 4) {
      if (w === "series" || w === "species") return w;
      return w.slice(0, -3) + "y";
    }
    if (w.endsWith("es") && w.length > 3) {
      if (w.endsWith("shes") || w.endsWith("ches") || w.endsWith("xes") || w.endsWith("sses") || w.endsWith("zes")) {
        return w.slice(0, -2);
      }
      if (w.endsWith("oes")) {
        return w.slice(0, -2);
      }
    }
    if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) {
      return w.slice(0, -1);
    }
    return w;
  }

  // Comprehensive English compound nouns & noun phrases (1390 entries)
  const COMMON_NOUN_PHRASES = new Set([
    "a b testing", "absolute path", "academic journal", "academic year",
    "access control", "access point", "access token", "accounts payable",
    "accounts receivable", "action camera", "action figure", "action item",
    "activation function", "active noise cancellation", "ad revenue", "admin access",
    "adverse reaction", "advisory board", "affiliate marketing", "agenda item",
    "air conditioner", "air freshener", "airplane mode", "airport terminal",
    "alarm clock", "all hands meeting", "allergic reaction", "alumni association",
    "amusement park", "analytics dashboard", "angel investment", "angel investor",
    "animal shelter", "annual leave", "annual percentage rate", "annual report",
    "annual review", "annual salary", "anxiety disorder", "api gateway",
    "api key", "apple juice", "application state", "approval rating",
    "arcade game", "architectural pattern", "arm chair", "arms control",
    "arrest warrant", "art gallery", "artificial intelligence", "ask price",
    "aspect ratio", "assembly language", "asset allocation", "asset value",
    "assisted living", "asynchronous programming", "attention span", "audit report",
    "audit trail", "augmented reality", "authorization header", "baby boomer",
    "baby stroller", "bachelor degree", "back door", "back end",
    "back propagation", "background check", "bacterial infection", "baggage claim",
    "bail bond", "baking sheet", "balance sheet", "balanced diet",
    "ballot box", "bandwidth limit", "bank account", "bank statement",
    "bank transfer", "bankruptcy protection", "barrier to entry", "base salary",
    "basketball court", "batch file", "bath towel", "battery life",
    "beach resort", "bear market", "bearer token", "beauty sleep",
    "bed room", "bedside table", "benchmark test", "best practice",
    "beta testing", "bid price", "big data", "bill of rights",
    "billing cycle", "binary file", "biometric authentication", "bipolar disorder",
    "bistro cafe", "bit rate", "black hole", "black tea",
    "bleach bottle", "blockchain network", "blood cell", "blood pressure",
    "blood sugar", "blood test", "blood vessel", "blue chip",
    "bluetooth connection", "board game", "board of directors", "boarding gate",
    "boarding pass", "boarding school", "body guard", "body language",
    "body temperature", "body wash", "bond market", "book case",
    "book keeping", "book store", "book value", "botanical garden",
    "bottle opener", "bottled water", "bottom line", "bounce rate",
    "boxing gym", "brain drain", "brain fog", "brainstorming session",
    "branching strategy", "brand name drug", "break even point", "brokerage firm",
    "brute force", "bubble tea", "buffer overflow", "bug bounty",
    "bug report", "build tool", "bull market", "bunk bed",
    "burden of proof", "burglar alarm", "burn rate", "burnout syndrome",
    "bus stop", "business continuity", "business development", "business loan",
    "business model", "business plan", "business school", "business strategy",
    "butterfly effect", "buy order", "byte code", "cabinet member",
    "cabinet minister", "cache memory", "call to action", "callback function",
    "calorie intake", "campaign trail", "campus cafeteria", "can opener",
    "canned food", "capital expenditure", "capital gain", "capital punishment",
    "car loan", "car seat", "carbon footprint", "carbon monoxide",
    "carbon tax", "card game", "carry on", "case study",
    "cash flow", "cash flow statement", "ceiling fan", "central nervous system",
    "central processing unit", "certificate authority", "chain reaction", "charging cable",
    "checking account", "chest pain", "chief executive officer", "chief financial officer",
    "chief marketing officer", "chief operating officer", "chief technology officer", "chronic fatigue",
    "chronic illness", "churn rate", "circadian rhythm", "circuit breaker",
    "circulatory system", "civil law", "civil liberties", "civil rights",
    "civil servant", "civil service", "civil society", "clean energy",
    "click through rate", "client side rendering", "climate change", "clinical trial",
    "closed source", "clothing store", "cloud computing", "cloud provider",
    "cloud storage", "cocktail lounge", "code base", "code editor",
    "code review", "code smell", "coffee maker", "coffee mug",
    "coffee shop", "coffee table", "cognitive load", "cold brew",
    "cold calling", "collateral security", "collective bargaining", "collective intelligence",
    "college student", "comedy club", "comfort food", "comfort zone",
    "command line", "command line interface", "commit message", "commodity market",
    "common cold", "common ground", "common law", "common sense",
    "community college", "community service", "competitive advantage", "competitive landscape",
    "compliance check", "component library", "compost bin", "compound interest",
    "computer lab", "computer vision", "concert hall", "conflict of interest",
    "constitutional law", "container orchestration", "content delivery network", "content marketing",
    "continuous delivery", "continuous deployment", "continuous integration", "control panel",
    "control tower", "convenience store", "conversion rate", "cookie policy",
    "cooling fan", "copyright infringement", "core competency", "cork screw",
    "corporate governance", "cost of living", "cost per acquisition", "cost per click",
    "cost structure", "cotton swab", "course material", "court room",
    "cover letter", "cream cheese", "creative thinking", "credit card",
    "credit card fraud", "credit limit", "credit rating", "credit score",
    "crib bed", "criminal justice", "criminal law", "critical thinking",
    "cross border payment", "cross examination", "cross origin resource sharing", "cross walk",
    "crowd funding", "crypto currency", "curriculum vitae", "curtain rod",
    "customer acquisition cost", "customer care", "customer experience", "customer journey",
    "customer persona", "customer relationship", "customer retention", "customer satisfaction",
    "customer service", "customer support", "cutting board", "cutting edge",
    "cyber attack", "cyber security", "cybersecurity", "daily active user",
    "daily life", "daily routine", "dark mode", "data analysis",
    "data analyst", "data analytics", "data breach", "data center",
    "data engineer", "data engineering", "data lake", "data mining",
    "data pipeline", "data science", "data scientist", "data set",
    "data structure", "data transfer", "data warehouse", "deadbolt lock",
    "death penalty", "debit card", "debt financing", "debt ratio",
    "decentralized finance", "decision tree", "dedicated server", "deep dive",
    "deep learning", "deep sleep", "default gateway", "defence attorney",
    "defence minister", "denial of service", "dental floss", "department store",
    "dependency injection", "depreciation rate", "depth of field", "deputy prime minister",
    "design pattern", "design system", "desktop environment", "developed country",
    "developing country", "dietary supplement", "digestive system", "digital asset",
    "digital camera", "digital certificate", "digital nomad", "digital signature",
    "dining room", "dining table", "dinner plate", "direct debit",
    "direct deposit", "direct sales", "disaster recovery", "dish soap",
    "dish washer", "disinfectant spray", "display port", "district attorney",
    "diversification strategy", "dividend stock", "dividend yield", "docker container",
    "doctor of philosophy", "doctoral thesis", "dog park", "dom tree",
    "domain name", "domain name system", "domino effect", "door bell",
    "door knob", "dormitory room", "dosage instruction", "double standard",
    "download speed", "drone camera", "drugstore pharmacy", "due diligence",
    "due process", "early adopter", "eating disorder", "economic sanctions",
    "economies of scale", "edge computing", "election campaign", "electric bike",
    "electric meter", "electric oven", "electric vehicle", "elementary school",
    "elevator pitch", "email marketing", "embedding vector", "emergency exit",
    "emergency room", "emerging market", "emotional intelligence", "employment contract",
    "encryption key", "end to end encryption", "end to end testing", "endpoint url",
    "energy drink", "enter key", "entrance exam", "environment variable",
    "equal opportunity", "equity financing", "equity market", "escape key",
    "escrow account", "ethernet cable", "ethical hacker", "event listener",
    "event loop", "everyday life", "exchange rate", "exchange traded fund",
    "executive order", "executive summary", "exit interview", "exit poll",
    "exit strategy", "extension cord", "external audit", "extreme weather",
    "eye contact", "face recognition", "facial expression", "facial recognition",
    "fall semester", "family life", "farmers market", "fast charger",
    "fast food", "fast lane", "faucet handle", "feasibility study",
    "federal government", "field of study", "field of view", "file explorer",
    "file system", "filing cabinet", "final exam", "finance minister",
    "financial quarter", "financial statement", "financial year", "fine dining",
    "fine tuning", "finger food", "fingerprint scanner", "finishing line",
    "fire alarm", "fire escape", "fire extinguisher", "fire station",
    "firewall rule", "first aid", "first aid kit", "first impression",
    "first lady", "first mover advantage", "fiscal year", "fitness center",
    "fixed mindset", "flash memory", "flea market", "flexible hours",
    "flight attendant", "flight mode", "floor lamp", "focal point",
    "focus group", "food poisoning", "food processor", "foreign aid",
    "foreign minister", "foreign policy", "forex market", "fossil fuel",
    "frame of mind", "frame rate", "franchise system", "free software",
    "free time", "free trade", "free trial", "freemium model",
    "french fries", "fringe benefits", "front camera", "front desk",
    "front door", "front end", "frozen food", "frying pan",
    "full stack", "full stack developer", "full time", "fuse box",
    "game changer", "game console", "game plan", "garage door",
    "garbage can", "gas meter", "gas station", "gas stove",
    "gathering place", "general assembly", "general election", "general ledger",
    "general manager", "general public", "generation gap", "generation x",
    "generation y", "generation z", "generative ai", "generic drug",
    "git repository", "glass ceiling", "global state", "global warming",
    "golf course", "grade point average", "gradient boosting", "gradient descent",
    "graduate school", "graduate student", "graduation ceremony", "grand jury",
    "graphic design", "graphics card", "graphics processing unit", "graphql query",
    "green tea", "greenhouse effect", "greenhouse gas", "grocery store",
    "gross profit", "ground truth", "growth hack", "growth mindset",
    "growth stock", "guest room", "guilty verdict", "gut feeling",
    "gut reaction", "hair dryer", "halo effect", "hand gesture",
    "hand soap", "happy hour", "hard disk", "hard drive",
    "hardware store", "hash function", "hdmi cable", "head of government",
    "head of state", "headache relief", "health insurance", "healthy diet",
    "heart attack", "heart disease", "heat sink", "hedge fund",
    "hidden layer", "high blood pressure", "high chair", "high court",
    "high definition", "high fever", "high level language", "high school",
    "high tech", "higher education", "hiking trail", "holding company",
    "home automation", "home loan", "home office", "home page",
    "homeless shelter", "honor roll", "host name", "hot chocolate",
    "hot dog", "hourly rate", "house of representatives", "http request",
    "http response", "human resources", "human rights", "humanitarian crisis",
    "hybrid work", "ice cream", "ice cube", "ice rink",
    "ice tray", "iced coffee", "identity theft", "image recognition",
    "immune system", "imposter syndrome", "income statement", "index fund",
    "industry benchmark", "infectious disease", "infinite loop", "influencer marketing",
    "initial coin offering", "initial public offering", "input device", "insider trading",
    "integration test", "integration testing", "intellectual property", "intensive care",
    "intensive care unit", "interest group", "interest rate", "intermittent fasting",
    "internal audit", "internal rate of return", "international monetary fund", "internet of things",
    "inventory control", "invoice payment", "ip address", "ironing board",
    "issue tracker", "job application", "job description", "job interview",
    "job market", "job offer", "job opening", "job posting",
    "job vacancy", "joint account", "joint venture", "juice bar",
    "junior high", "junk food", "jury duty", "key chain",
    "key performance indicator", "keyboard shortcut", "kickoff meeting", "kitchen counter",
    "kitchen sink", "knowledge graph", "kubernetes cluster", "labor union",
    "landing page", "landscape mode", "large language model", "last will and testament",
    "latency time", "lateral thinking", "laundry basket", "laundry room",
    "law enforcement", "law school", "lead generation", "lecture hall",
    "legacy code", "legal advice", "legal counsel", "legal guardian",
    "legal system", "letter of intent", "leveraged buyout", "life expectancy",
    "life insurance", "life sentence", "lifetime value", "light bulb",
    "light mode", "light switch", "limit order", "line manager",
    "line of work", "listed company", "living room", "living wage",
    "load balancer", "load balancing", "lobbying group", "local area network",
    "local election", "local government", "local repository", "local state",
    "lock screen", "logic board", "login screen", "long term",
    "long term memory", "loss function", "love life", "low blood pressure",
    "low level language", "low tech", "luggage claim", "lunch box",
    "mac address", "machine code", "machine learning", "main course",
    "malware infection", "managing director", "maple syrup", "market cap",
    "market capitalization", "market order", "market penetration", "market research",
    "market saturation", "market segment", "market share", "market value",
    "mass market", "master bedroom", "master degree", "master thesis",
    "maternity leave", "measuring cup", "measuring spoon", "mechanical keyboard",
    "medical history", "medical school", "meeting point", "member of parliament",
    "memorandum of understanding", "memory leak", "mental breakdown", "mental clarity",
    "mental health", "merchant account", "merge request", "merger and acquisition",
    "metric tracking", "microservice architecture", "microwave oven", "middle class",
    "middle school", "midterm exam", "milky way", "mineral water",
    "minimum viable product", "minimum wage", "mission statement", "mixed feelings",
    "mixed reality", "mobile app", "mobile application", "modern life",
    "monetization strategy", "money market", "monolithic architecture", "monthly active user",
    "mood swing", "mop bucket", "mortgage loan", "motherboard",
    "motion sensor", "mountain bike", "movie theater", "multi factor authentication",
    "muscle memory", "muscular system", "museum exhibition", "mutual fund",
    "nail clipper", "national park", "native speaker", "natural disaster",
    "natural language processing", "nature reserve", "nervous breakdown", "nervous system",
    "net profit", "net worth", "network card", "network effect",
    "network switch", "neural network", "niche market", "night club",
    "night light", "noise cancelling", "non compete clause", "non disclosure agreement",
    "notification center", "null pointer", "nursing home", "nutritional value",
    "object code", "object detection", "objective and key result", "office chair",
    "onboarding flow", "onboarding process", "one on one", "open source",
    "opera house", "operating cost", "operating expenditure", "operating leverage",
    "operating profit", "operating room", "operating system", "opinion poll",
    "opposition party", "optical drive", "orange juice", "organic food",
    "outer space", "output device", "oven mitt", "over the counter",
    "overdraft protection", "overtime pay", "oxygen saturation", "package manager",
    "packet loss", "paid leave", "pain killer", "pain point",
    "panic attack", "paper towel", "parent company", "parking lot",
    "parking space", "parliament member", "part time", "passport control",
    "password manager", "patent application", "paternity leave", "pay per click",
    "payment gateway", "paywall access", "peace keeping", "peace of mind",
    "peak hours", "peanut butter", "peer pressure", "peer review",
    "penetration testing", "pension fund", "pension scheme", "performance bonus",
    "performance review", "peripheral device", "personal loan", "phishing email",
    "physical exam", "pilot cabin", "ping rate", "placebo effect",
    "plant based diet", "point of contact", "point of view", "police department",
    "police officer", "police station", "policy maker", "political party",
    "pop quiz", "port number", "portfolio manager", "portrait mode",
    "positive thinking", "post office", "potato chips", "power bank",
    "power nap", "power of attorney", "power strip", "power supply",
    "powerpoint presentation", "predictive analytics", "prescription drug", "president of the united states",
    "presidential election", "pressure group", "primary school", "prime minister",
    "prison sentence", "privacy policy", "private company", "private equity",
    "private hospital", "private investigator", "private ip", "private jet",
    "private key", "private life", "private property", "private school",
    "private sector", "probation period", "processed food", "product manager",
    "product market fit", "professional development", "profit and loss", "profit margin",
    "programming language", "progress bar", "progressive web app", "project manager",
    "promise chain", "prompt engineering", "proof of concept", "proprietary software",
    "proxy server", "public administration", "public company", "public health",
    "public interest", "public ip", "public key", "public library",
    "public opinion", "public park", "public policy", "public prosecutor",
    "public restroom", "public safety", "public school", "public sector",
    "public transit", "public transport", "public transportation", "pull request",
    "pulse rate", "purchase order", "puzzle game", "quality assurance",
    "quality control", "quality of life", "quantum computing", "quarterly report",
    "query string", "race condition", "random access memory", "random forest",
    "ransomware attack", "raw food", "razor blade", "read only memory",
    "real estate", "real life", "real world", "reality check",
    "rear camera", "reasonable doubt", "recommendation system", "recovery mode",
    "recovery room", "recruitment agency", "recurring payment", "recycling bin",
    "red blood cell", "red cross", "reference check", "refresh rate",
    "refresh token", "refugee camp", "registered trademark", "regression testing",
    "reinforcement learning", "relative path", "rem sleep", "remote control",
    "remote repository", "remote work", "renewable energy", "report card",
    "request body", "research paper", "respiratory system", "response body",
    "responsive design", "rest api", "rest room", "restful api",
    "restraining order", "retail store", "retained earnings", "retention rate",
    "retirement plan", "return on equity", "return on investment", "revenue stream",
    "reverse proxy", "ripple effect", "risk assessment", "risk management",
    "risk tolerance", "road trip", "roadmap plan", "rock climbing",
    "rocking chair", "role model", "rolling pin", "rooftop bar",
    "room service", "root directory", "router configuration", "routing system",
    "rubber gloves", "rule of law", "rule of thumb", "ruling party",
    "run rate", "runny nose", "runtime environment", "rush hour",
    "safe haven", "safe mode", "salad bowl", "salad dressing",
    "salary increase", "sales funnel", "sales pitch", "sales representative",
    "sauce pan", "savings account", "school library", "school uniform",
    "science lab", "screen resolution", "screen time", "script file",
    "scroll bar", "sea level rise", "search bar", "search engine",
    "search engine marketing", "search engine optimization", "search warrant", "second thoughts",
    "secondary school", "secret agent", "secretary of state", "secure sockets layer",
    "security camera", "security council", "security guard", "security vulnerability",
    "seed money", "seed round", "segmentation fault", "self esteem",
    "selfie stick", "sell order", "selling point", "senate chamber",
    "senior high", "sense of belonging", "sense of duty", "sense of humor",
    "sense of urgency", "sentiment analysis", "series a", "series a funding",
    "series b", "series b funding", "server side rendering", "serverless computing",
    "service level agreement", "service worker", "session cookie", "set menu",
    "severance package", "shampoo bottle", "share capital", "share price",
    "shaving cream", "shell script", "shift work", "shoe rack",
    "shoe store", "shopping mall", "short selling", "short term",
    "short term memory", "shower curtain", "sick leave", "side dish",
    "side effect", "silent mode", "silver lining", "simple interest",
    "single page application", "sixth sense", "skate park", "skeletal system",
    "ski resort", "sleep deprivation", "sleep mode", "slide deck",
    "sliding door", "smart contract", "smart device", "smart home",
    "smart phone", "smart speaker", "smart thermostat", "smart tv",
    "smart watch", "smoke alarm", "smoke detector", "snowball effect",
    "soccer field", "social engineering", "social intelligence", "social life",
    "social media", "social network", "social security", "sofa bed",
    "soft drink", "software architecture", "software developer", "software engineer",
    "software engineering", "solar energy", "solar panel", "solar system",
    "solid state drive", "sore throat", "soul food", "sound card",
    "soup bowl", "source code", "source control", "source file",
    "space bar", "space station", "spare time", "sparkling water",
    "speech recognition", "speed limit", "split testing", "sponge cloth",
    "sports bar", "sports drink", "spring semester", "stack overflow",
    "standard of living", "standardized test", "standup meeting", "starting point",
    "state government", "state management", "state of mind", "state of the art",
    "statement of work", "static site generation", "status code", "steam iron",
    "stepping stone", "stock broker", "stock exchange", "stock market",
    "stock price", "stomach ache", "stop loss", "strategic partnership",
    "strategic planning", "street food", "student loan", "student union",
    "style sheet", "subnet mask", "subscription model", "subsidiary company",
    "subway station", "summer break", "supermarket chain", "supervised learning",
    "supply chain", "supply chain management", "support vector machine", "supreme court",
    "suspended sentence", "swimming pool", "sworn testimony", "swot analysis",
    "syllabus outline", "synthetic data", "system settings", "system tray",
    "system variable", "table lamp", "talent acquisition", "tap water",
    "target audience", "target market", "target price", "task manager",
    "tea house", "team leader", "technical debt", "teddy bear",
    "tennis court", "term limit", "terminal window", "terms and conditions",
    "terms of service", "terms of use", "test driven development", "test set",
    "text book", "text editor", "theme park", "thermos flask",
    "think tank", "ticket system", "tissue paper", "toaster oven",
    "toilet paper", "tone of voice", "tooth brush", "tooth paste",
    "top line", "total equity", "touch point", "touch screen",
    "touchpad gesture", "tourist attraction", "trade agreement", "trade war",
    "trading platform", "trading volume", "traffic jam", "traffic light",
    "train of thought", "train station", "training program", "training set",
    "transfer learning", "transport layer security", "trash bag", "trash collection",
    "travel insurance", "treaty agreement", "trial judge", "tuition fee",
    "tumble dryer", "turning point", "two factor authentication", "ui component",
    "ultra high definition", "undercover cop", "undergraduate student", "unit test",
    "unit testing", "united nations", "university student", "unsupervised learning",
    "upload speed", "upper class", "url parameter", "usb port",
    "user account", "user agreement", "user experience", "user feedback",
    "user interface", "user journey", "utility bill", "vacuum cleaner",
    "validation set", "value add", "value proposition", "value stock",
    "vector database", "vegan diet", "venture capital", "venture capitalist",
    "version control", "veterinary clinic", "veto power", "vice president",
    "vicious circle", "video game", "viral infection", "virtual assistant",
    "virtual currency", "virtual dom", "virtual machine", "virtual private network",
    "virtual private server", "virtual reality", "vision statement", "visual design",
    "vital signs", "vocational school", "voice assistant", "voter turnout",
    "voting booth", "vulnerability scan", "wage increase", "waiting room",
    "wake up call", "wall outlet", "wall street", "washing machine",
    "water bottle", "water heater", "water meter", "water park",
    "web app", "web application", "web browser", "web developer",
    "web development", "web page", "web socket", "website design",
    "welcome mat", "whistle blower", "white blood cell", "white house",
    "white paper", "whole food", "wholesale trade", "wide area network",
    "wifi network", "wildlife sanctuary", "wind turbine", "window sill",
    "wine glass", "winter break", "wire transfer", "wireless charger",
    "wireless earbuds", "wireless network", "wishful thinking", "witness stand",
    "work life", "work life balance", "working class", "working directory",
    "working memory", "world bank", "world health organization", "wrap up meeting",
    "yoga studio", "zero day"
  ]);

  // Conversational idioms, connectors & multi-word expressions (281 entries)
  const COMMON_IDIOMS = new Set([
    "a lot of", "a piece of cake", "according to", "across the board",
    "add fuel to the fire", "after all", "again and again", "ahead of",
    "ahead of the curve", "alive and kicking", "alive and well", "all at once",
    "all in all", "all of a sudden", "all things considered", "all told",
    "along with", "apart from", "as a matter of fact", "as a result",
    "as a rule", "as far as", "as far as i know", "as for",
    "as if", "as long as", "as of", "as soon as",
    "as though", "as well as", "aside from", "at a crossroads",
    "at a glance", "at all", "at any rate", "at hand",
    "at last", "at least", "at loggerheads", "at odds with",
    "at once", "at short notice", "at stake", "at the crack of dawn",
    "at the end of the day", "at the same time", "at wits end", "back and forth",
    "bear in mind", "beat around the bush", "because of", "behind closed doors",
    "behind the curve", "behind the scenes", "bite off more than you can chew", "bits and pieces",
    "blessing in disguise", "bright and early", "burn the midnight oil", "by accident",
    "by all means", "by and large", "by any chance", "by chance",
    "by means of", "by mistake", "by no means", "by the book",
    "by the way", "call it a day", "catch sight", "clear the air",
    "close to", "contrary to", "cost an arm and a leg", "cry over spilled milk",
    "cut corners", "day by day", "day in and day out", "down in the dumps",
    "down to earth", "draw conclusions", "due to", "each other",
    "elephant in the room", "even if", "even though", "every now and then",
    "face to face", "far and wide", "find fault", "first and foremost",
    "first of all", "fish out of water", "fit as a fiddle", "flesh and blood",
    "for example", "for instance", "for the most part", "for the sake of",
    "for the time being", "for this reason", "frankly speaking", "from time to time",
    "generally speaking", "get the hang", "give and take", "give way",
    "hand in hand", "have a look", "having said that", "here and there",
    "high and dry", "hit the nail on the head", "hustle and bustle", "in a nutshell",
    "in addition to", "in advance", "in any case", "in black and white",
    "in case of", "in charge of", "in common", "in conclusion",
    "in detail", "in due course", "in due time", "in either case",
    "in fact", "in front of", "in general", "in light of",
    "in need of", "in no time", "in order to", "in other words",
    "in particular", "in search of", "in seventh heaven", "in spite of",
    "in terms of", "in the blink of an eye", "in the clear", "in the dark",
    "in the long run", "in the loop", "in the meantime", "in the pipeline",
    "in the short run", "in time", "in vain", "inside out",
    "instead of", "it goes without saying", "keep in mind", "kill two birds with one stone",
    "kind of", "let alone", "little by little", "lose heart",
    "lose track", "lots of", "loud and clear", "make room",
    "make sense", "make sure", "more often than not", "more or less",
    "neat and tidy", "neck and neck", "needless to say", "next to",
    "no matter", "not only that", "not to mention", "now and then",
    "off and on", "off the record", "on behalf of", "on cloud nine",
    "on pins and needles", "on purpose", "on schedule", "on the basis of",
    "on the brink of", "on the other hand", "on the record", "on the same page",
    "on the spot", "on the verge of", "on thin ice", "on time",
    "on top of that", "once and for all", "once in a while", "once upon a time",
    "one another", "out of", "out of control", "out of date",
    "out of order", "out of the blue", "out of the loop", "out of the woods",
    "out of thin air", "over and over", "over the moon", "pave the way",
    "pay attention", "peace and quiet", "per se", "piece of cake",
    "play it safe", "plenty of", "prior to", "pros and cons",
    "raise the bar", "regardless of", "right now", "ring a bell",
    "round the clock", "safe and sound", "see eye to eye", "set the tone",
    "shed light", "sick and tired", "side by side", "so far",
    "so that", "so to speak", "sooner or later", "sort of",
    "speak of the devil", "spick and span", "state of the art", "status quo",
    "step by step", "storm in a teacup", "strictly speaking", "take a look",
    "take advantage", "take into account", "take part", "take place",
    "take pride", "take with a grain of salt", "thanks to", "that is to say",
    "through thick and thin", "time after time", "time and again", "to be fair",
    "to be honest", "to make matters worse", "to say the least", "to sum up",
    "to tell the truth", "together with", "touch and go", "trial and error",
    "truth be told", "under any circumstances", "under control", "under no circumstances",
    "under the weather", "under wraps", "up and down", "up to",
    "up to date", "ups and downs", "upside down", "vice versa",
    "walking on eggshells", "wear and tear", "what is more", "when all is said and done",
    "with regard to", "with respect to", "with that in mind", "wrap your head around",
    "year in and year out"
  ]);

  // High-frequency English phrasal verbs for instant multi-word recognition (1855 entries)
  const COMMON_PHRASAL_VERBS = new Set([
    "act out", "act up", "add on", "add up",
    "agree with", "aim at", "allow for", "answer back",
    "ask around", "ask for", "ask in", "ask out",
    "back down", "back off", "back out", "back out of",
    "back up", "bail out", "band together", "bargain for",
    "bear down", "bear out", "bear up", "bear with",
    "beat down", "beat off", "beat up", "bend down",
    "bend over", "bite back", "bite off", "black out",
    "blank out", "blast off", "bleed out", "blow away",
    "blow down", "blow off", "blow out", "blow up",
    "boil down", "boil down to", "boil over", "bone up",
    "boot up", "boss around", "bottle up", "bounce back",
    "bow out", "branch out", "break away", "break down",
    "break in", "break into", "break off", "break out",
    "break through", "break up", "breathe in", "breathe out",
    "brighten up", "bring about", "bring along", "bring back",
    "bring down", "bring forward", "bring in", "bring off",
    "bring on", "bring out", "bring round", "bring to",
    "bring together", "bring up", "brush aside", "brush off",
    "brush up", "brush up on", "buckle down", "buckle up",
    "build in", "build on", "build up", "bump into",
    "bundle up", "burn down", "burn off", "burn out",
    "burn up", "burst in", "burst into", "burst out",
    "butt in", "buy into", "buy off", "buy out",
    "buy up", "call back", "call for", "call in",
    "call off", "call on", "call out", "call round",
    "call up", "calm down", "care for", "carry away",
    "carry forward", "carry off", "carry on", "carry out",
    "carry over", "carry through", "cash in", "catch on",
    "catch up", "catch up with", "cater to", "cave in",
    "chalk up", "change over", "charge up", "chase away",
    "chase down", "chase up", "chat up", "cheat on",
    "check in", "check into", "check off", "check on",
    "check out", "check over", "check through", "check up",
    "check up on", "cheer on", "cheer up", "chew on",
    "chew out", "chew up", "chicken out", "chill out",
    "chime in", "chip in", "choke up", "chop down",
    "chop off", "chop up", "circle back", "clam up",
    "clamp down", "clean out", "clean up", "clear away",
    "clear off", "clear out", "clear up", "climb down",
    "climb up", "cling to", "clog up", "close down",
    "close in", "close off", "close out", "close up",
    "cloud over", "clutter up", "come about", "come across",
    "come along", "come apart", "come around", "come back",
    "come by", "come down", "come down with", "come forward",
    "come from", "come in", "come into", "come off",
    "come on", "come out", "come over", "come round",
    "come through", "come to", "come together", "come under",
    "come up", "come up against", "come up with", "con into",
    "con out", "cook up", "cool down", "cool off",
    "coop up", "cope with", "copy out", "cordon off",
    "count against", "count in", "count on", "count out",
    "count up", "cover up", "cozy up", "crack down",
    "crack open", "crack up", "crank out", "crank up",
    "crash out", "creep in", "creep up", "crop up",
    "cross off", "cross out", "cry out", "curl up",
    "cut across", "cut back", "cut down", "cut down on",
    "cut in", "cut off", "cut out", "cut through",
    "cut up", "dampen down", "dash off", "dawn on",
    "deal in", "deal with", "decide on", "delve into",
    "die away", "die down", "die off", "die out",
    "dig in", "dig out", "dig up", "dine out",
    "dip into", "dish out", "dive into", "divide up",
    "do away", "do over", "do up", "do with",
    "do without", "double back", "double down", "double up",
    "doze off", "drag on", "drag out", "drain away",
    "draw back", "draw in", "draw on", "draw out",
    "draw up", "dream of", "dream up", "dress down",
    "dress up", "drift apart", "drift off", "drill down",
    "drink in", "drink to", "drink up", "drive away",
    "drive off", "drive out", "drive up", "drop away",
    "drop back", "drop behind", "drop by", "drop in",
    "drop off", "drop out", "drop out of", "drown out",
    "drum up", "dry off", "dry out", "dry up",
    "duck out", "dumb down", "dwell on", "ease off",
    "ease up", "eat away", "eat in", "eat into",
    "eat out", "eat up", "edge out", "embark on",
    "empty out", "end off", "end up", "even out",
    "face off", "face up", "face up to", "fade away",
    "fade out", "fall apart", "fall back", "fall back on",
    "fall behind", "fall down", "fall for", "fall in",
    "fall into", "fall off", "fall out", "fall over",
    "fall through", "fan out", "farm out", "fasten up",
    "fawn over", "feed on", "feed up", "feel up",
    "feel up to", "fend off", "ferret out", "fiddle around",
    "fight back", "fight off", "figure on", "figure out",
    "file away", "file for", "fill in", "fill out",
    "fill up", "filter out", "find out", "finish off",
    "finish up", "fire away", "fire up", "firm up",
    "fish for", "fish out", "fit in", "fit into",
    "fit out", "fit up", "fix up", "fizzle out",
    "flag down", "flare up", "flash back", "flesh out",
    "flick through", "flip out", "float around", "flog off",
    "flood in", "flop down", "flunk out", "flush out",
    "fly by", "fob off", "focus on", "fold up",
    "follow through", "follow up", "fool around", "forge ahead",
    "fork out", "fork over", "foul up", "freak out",
    "free up", "freeze out", "freeze over", "freeze up",
    "freshen up", "frighten away", "frighten off", "fritter away",
    "frolic about", "front for", "frown on", "fuel up",
    "fumble around", "fuss over", "gain on", "gang up",
    "gear up", "get across", "get ahead", "get along",
    "get along with", "get around", "get at", "get away",
    "get away with", "get back", "get behind", "get by",
    "get down", "get in", "get into", "get off",
    "get on", "get out", "get out of", "get over",
    "get rid of", "get round", "get through", "get to",
    "get together", "get up", "give away", "give back",
    "give in", "give off", "give out", "give over",
    "give up", "glance at", "glaze over", "gloss over",
    "glow with", "glue to", "gnaw at", "go about",
    "go after", "go ahead", "go along", "go around",
    "go at", "go away", "go back", "go by",
    "go down", "go for", "go in", "go into",
    "go off", "go on", "go out", "go over",
    "go round", "go through", "go through with", "go under",
    "go up", "go with", "go without", "gobble down",
    "gobble up", "goof off", "grab at", "grapple with",
    "grate on", "graze on", "grind down", "grind on",
    "grind out", "grip on", "gross out", "grow apart",
    "grow back", "grow into", "grow on", "grow out",
    "grow up", "grub around", "guard against", "guide through",
    "gull into", "gum up", "gun for", "gush out",
    "hack into", "hammer away", "hammer out", "hand back",
    "hand down", "hand in", "hand on", "hand out",
    "hand over", "hand round", "hang about", "hang around",
    "hang back", "hang on", "hang out", "hang over",
    "hang together", "hang up", "hanker after", "happen on",
    "harden up", "hark back", "harp on", "hasten on",
    "hate on", "have against", "have around", "have back",
    "have down", "have in", "have off", "have on",
    "have out", "have over", "have round", "head back",
    "head for", "head off", "head out", "head up",
    "heal over", "heal up", "heap up", "hear about",
    "hear from", "hear of", "hear out", "heat up",
    "heave up", "hedge in", "help out", "hem in",
    "hide away", "hide out", "hinder from", "hinge on",
    "hint at", "hire out", "hit back", "hit on",
    "hit out", "hit up", "hitch up", "hive off",
    "hoard up", "hold against", "hold back", "hold down",
    "hold off", "hold on", "hold on to", "hold out",
    "hold over", "hold together", "hold up", "hole up",
    "hollow out", "home in", "hone in", "hook into",
    "hook up", "hoot down", "hop in", "hop on",
    "horn in", "horse around", "hose down", "hound out",
    "house in", "hover over", "howl down", "huddle together",
    "huff away", "hug close", "hulk over", "hum along",
    "hump along", "hunch up", "hunger after", "hunger for",
    "hunker down", "hunt down", "hunt out", "hunt up",
    "hurry along", "hurry up", "hush up", "hustle into",
    "hype up", "identify with", "idle away", "impact on",
    "impose on", "improve on", "inch along", "inflict on",
    "inform on", "infuse with", "inquire after", "inquire into",
    "insist on", "interfere with", "intrude on", "invest in",
    "invite in", "invite out", "invite over", "invite round",
    "iron out", "itch for", "jabber away", "jack in",
    "jack up", "jam on", "jam up", "jar on",
    "jaw away", "jazz up", "jeer at", "jell together",
    "jerk around", "jet off", "jibe with", "jiggle about",
    "jilt away", "jingle along", "jockey for", "jog along",
    "jog on", "join in", "join up", "joke around",
    "jolt into", "jostle for", "jot down", "juice up",
    "jump at", "jump in", "jump off", "jump on",
    "jut out", "keel over", "keep at", "keep away",
    "keep back", "keep down", "keep from", "keep in",
    "keep off", "keep on", "keep out", "keep to",
    "keep under", "keep up", "keep up with", "key in",
    "key to", "kick about", "kick around", "kick back",
    "kick down", "kick in", "kick off", "kick out",
    "kick up", "kill off", "kiss off", "kiss up",
    "kneel down", "knock about", "knock around", "knock back",
    "knock down", "knock off", "knock out", "knock over",
    "knock together", "knock up", "knuckle down", "knuckle under",
    "land in", "land up", "lap up", "lash out",
    "latch on", "laugh off", "launch into", "lay aside",
    "lay down", "lay in", "lay into", "lay off",
    "lay on", "lay out", "lay over", "lay up",
    "laze around", "lead on", "lead to", "lead up",
    "leak out", "lean back", "lean on", "lean towards",
    "leap at", "leap out", "leave behind", "leave off",
    "leave out", "leave over", "let down", "let in",
    "let off", "let on", "let out", "let through",
    "let up", "level off", "level out", "level with",
    "lie around", "lie down", "lie in", "lift off",
    "lift up", "light up", "lighten up", "line up",
    "link up", "listen in", "listen out for", "listen to",
    "listen up", "live by", "live down", "live for",
    "live in", "live off", "live on", "live out",
    "live through", "live together", "live up", "live up to",
    "live with", "liven up", "load down", "load up",
    "lock away", "lock in", "lock out", "lock up",
    "log in", "log off", "log on", "log out",
    "look after", "look ahead", "look around", "look at",
    "look back", "look back on", "look down", "look down on",
    "look for", "look forward", "look forward to", "look in",
    "look into", "look on", "look out", "look out for",
    "look over", "look round", "look through", "look to",
    "look up", "look up to", "loop in", "loosen up",
    "lose out", "lounge around", "luck out", "lumber along",
    "lunge at", "lurch forward", "lurk around", "make away",
    "make do", "make for", "make into", "make off",
    "make out", "make over", "make towards", "make up",
    "make up for", "map out", "march on", "mark down",
    "mark off", "mark out", "mark up", "marry off",
    "mash up", "match up", "max out", "measure off",
    "measure out", "measure up", "measure up to", "meet up",
    "meet with", "melt away", "melt down", "merge into",
    "mess about", "mess around", "mess up", "mete out",
    "mill around", "miss out", "mix in", "mix up",
    "mock up", "monkey around", "mop up", "mount up",
    "mouth off", "move ahead", "move along", "move away",
    "move back", "move in", "move off", "move on",
    "move out", "move over", "move up", "muddle through",
    "muddle up", "muff up", "mug up", "mull over",
    "muscle in", "muster up", "nail down", "name after",
    "narrow down", "narrow down to", "nerd out", "nestle down",
    "nibble at", "nip in", "nip out", "nod off",
    "nose around", "nose out", "notch up", "note down",
    "number among", "nut out", "open out", "open up",
    "opt in", "opt out", "order about", "order around",
    "order in", "own up", "pack away", "pack in",
    "pack off", "pack out", "pack up", "pad out",
    "pair off", "pair up", "palm off", "pan out",
    "pant for", "parcel out", "pare down", "part with",
    "pass away", "pass by", "pass down", "pass for",
    "pass off", "pass on", "pass out", "pass over",
    "pass round", "pass through", "pass up", "patch up",
    "pay back", "pay down", "pay for", "pay in",
    "pay off", "pay out", "pay up", "peck at",
    "peel off", "peg down", "peg out", "pelt down",
    "pen in", "pencil in", "perk up", "peter out",
    "phase in", "phase out", "phone in", "phone up",
    "pick at", "pick off", "pick on", "pick out",
    "pick through", "pick up", "pig out", "pile in",
    "pile on", "pile out", "pile up", "pin down",
    "pin on", "pin up", "pine for", "pipe down",
    "pipe up", "piss off", "pit against", "pitch in",
    "pitch into", "play along", "play around", "play at",
    "play back", "play down", "play off", "play on",
    "play out", "play up", "play with", "plod along",
    "plod on", "plop down", "plot out", "plow ahead",
    "plow back", "plow into", "plow through", "plug away",
    "plug in", "plug into", "plump for", "plump up",
    "plunge in", "plunge into", "point out", "point to",
    "point towards", "poke around", "poke at", "polish off",
    "polish up", "pony up", "poop out", "pop in",
    "pop out", "pop up", "pore over", "portion out",
    "post up", "potter about", "potter around", "pour down",
    "pour forth", "pour in", "pour out", "power down",
    "power up", "prattle on", "press ahead", "press for",
    "press forward", "press on", "prey on", "price up",
    "prick up", "print out", "prize apart", "prod at",
    "prop up", "provide for", "psyche out", "psyche up",
    "pucker up", "puff out", "puff up", "pull ahead",
    "pull apart", "pull away", "pull back", "pull down",
    "pull in", "pull off", "pull on", "pull out",
    "pull over", "pull round", "pull through", "pull together",
    "pull up", "pump out", "pump up", "punch in",
    "punch out", "push ahead", "push around", "push away",
    "push back", "push for", "push forward", "push in",
    "push off", "push on", "push out", "push through",
    "put across", "put aside", "put away", "put back",
    "put by", "put down", "put forward", "put in",
    "put off", "put on", "put out", "put through",
    "put together", "put toward", "put up", "put up with",
    "puzzle out", "quiet down", "rack up", "radiate from",
    "rage on", "rain down", "rain in", "rain out",
    "rake in", "rake up", "rally round", "ram home",
    "ram into", "ramp up", "ranch out", "rap out",
    "rattle off", "rattle on", "reach down", "reach for",
    "reach out", "read back", "read into", "read off",
    "read out", "read over", "read through", "read up",
    "read up on", "reason out", "reason with", "reckon on",
    "reckon with", "reel in", "reel off", "refer to",
    "reflect on", "reign in", "rein in", "rely on",
    "remain behind", "remind of", "render down", "resort to",
    "rest on", "revolve around", "rib on", "ride out",
    "ridge up", "riff on", "rig up", "ring back",
    "ring in", "ring off", "ring out", "ring round",
    "ring up", "rip into", "rip off", "rip out",
    "rip up", "rise above", "rise up", "roll back",
    "roll by", "roll in", "roll on", "roll out",
    "roll over", "roll up", "root around", "root for",
    "root out", "rope in", "rope into", "rough in",
    "rough out", "rough up", "round down", "round off",
    "round on", "round out", "round up", "rub along",
    "rub down", "rub in", "rub off", "rub out",
    "rub up", "rule against", "rule in", "rule out",
    "run across", "run after", "run against", "run along",
    "run around", "run away", "run away from", "run back",
    "run down", "run in", "run into", "run off",
    "run on", "run out", "run out of", "run over",
    "run round", "run through", "run to", "run up",
    "rush in", "rush into", "rush off", "rush out",
    "rush through", "rustle up", "sail through", "sally forth",
    "salt away", "save on", "save up", "scale back",
    "scale down", "scale up", "scare away", "scare off",
    "scent out", "scheme against", "scoff at", "scoot away",
    "scoot over", "score off", "scour for", "scout around",
    "scout out", "scrape along", "scrape by", "scrape through",
    "scrape together", "scrape up", "screen off", "screen out",
    "screw around", "screw up", "scurry away", "scurry off",
    "seal off", "seal up", "search out", "see about",
    "see off", "see out", "see through", "see to",
    "sell off", "sell out", "sell up", "send away",
    "send back", "send down", "send for", "send in",
    "send off", "send on", "send out", "send round",
    "send up", "serve out", "serve up", "set about",
    "set against", "set apart", "set aside", "set back",
    "set down", "set forth", "set in", "set off",
    "set on", "set out", "set to", "set up",
    "settle back", "settle down", "settle for", "settle in",
    "settle into", "settle on", "settle up", "shack up",
    "shade off", "shake down", "shake off", "shake out",
    "shake up", "shape up", "share out", "shave off",
    "sheer off", "shell out", "shelve away", "shift around",
    "shine through", "ship off", "ship out", "shoot down",
    "shoot for", "shoot off", "shoot out", "shoot up",
    "shop around", "shore up", "short out", "shout down",
    "shout out", "shove off", "show around", "show in",
    "show off", "show out", "show round", "show through",
    "show up", "shrug off", "shut away", "shut down",
    "shut in", "shut off", "shut out", "shut up",
    "shy away", "side with", "sift out", "sift through",
    "sigh out", "sign away", "sign for", "sign in",
    "sign off", "sign on", "sign out", "sign up",
    "sign up for", "single out", "sink in", "sink into",
    "sit around", "sit back", "sit by", "sit down",
    "sit for", "sit in", "sit on", "sit out",
    "sit through", "sit up", "size up", "skate over",
    "sketch out", "skim off", "skim through", "skin alive",
    "skip out", "skirt around", "slack off", "slack up",
    "slag off", "slam down", "slant towards", "slap down",
    "slap on", "slash down", "sleep in", "sleep off",
    "sleep on", "sleep over", "sleep round", "sleep through",
    "slice off", "slice up", "slide into", "slip away",
    "slip by", "slip in", "slip into", "slip off",
    "slip on", "slip out", "slip over", "slip up",
    "slope off", "slosh around", "slow down", "slow up",
    "smack of", "smash down", "smash in", "smash up",
    "smell out", "smoke out", "smooth down", "smooth over",
    "snap back", "snap off", "snap out", "snap up",
    "snarl up", "snatch away", "sneak away", "sneak in",
    "sneak out", "sneak up", "sniff around", "sniff at",
    "sniff out", "snip off", "snort at", "snout out",
    "snow in", "snow under", "snuff out", "snuggle down",
    "snuggle up", "soak in", "soak up", "sober up",
    "sock away", "soften up", "soil down", "soldier on",
    "sort out", "sort through", "sound off", "sound out",
    "space out", "span over", "spark off", "spark up",
    "speak for", "speak of", "speak out", "speak to",
    "speak up", "speed up", "spell out", "spew out",
    "spice up", "spill out", "spill over", "spin off",
    "spin out", "spit out", "splash down", "splash out",
    "split off", "split up", "spoil for", "sponge off",
    "sponge on", "spoon out", "spout off", "sprawl out",
    "spread out", "spring back", "spring for", "spring from",
    "spring on", "spring up", "spruce up", "spur on",
    "spurt out", "spy on", "square away", "square off",
    "square up", "squeeze in", "squeeze out", "squeeze through",
    "squint at", "squirm out", "squirt out", "stack up",
    "staff up", "stage manage", "stake out", "stall off",
    "stamp down", "stamp out", "stand about", "stand around",
    "stand back", "stand by", "stand down", "stand for",
    "stand in", "stand in for", "stand out", "stand over",
    "stand up", "stand up for", "stare down", "start back",
    "start in", "start off", "start on", "start out",
    "start over", "start up", "stash away", "stave off",
    "stay ahead", "stay away from", "stay behind", "stay down",
    "stay in", "stay off", "stay on", "stay out",
    "stay over", "stay up", "steady down", "steady on",
    "steal away", "steal in", "steal off", "steam up",
    "steel against", "steer clear", "step aside", "step back",
    "step down", "step forward", "step in", "step off",
    "step out", "step up", "stick around", "stick at",
    "stick by", "stick down", "stick out", "stick to",
    "stick together", "stick up", "stick with", "stiffen up",
    "stifle down", "stir up", "stitch up", "stock up",
    "stomp on", "stop by", "stop in", "stop off",
    "stop over", "stop up", "store away", "store up",
    "storm out", "stow away", "straighten out", "straighten up",
    "strap in", "stray from", "streak ahead", "stream in",
    "stretch out", "strike back", "strike down", "strike off",
    "strike out", "strike through", "strike up", "string along",
    "string out", "string together", "string up", "strip away",
    "strip down", "strip off", "stroll along", "strut about",
    "stub out", "stuff up", "stumble across", "stumble on",
    "stump up", "suck in", "suck into", "suck out",
    "suck up", "suit up", "sum up", "summon up",
    "surrender to", "swallow down", "swallow up", "swap out",
    "swap round", "swarm around", "swarm in", "sway towards",
    "swear by", "swear in", "swear off", "sweat out",
    "sweep aside", "sweep away", "sweep off", "sweep through",
    "sweep up", "swell up", "swerve away", "switch off",
    "switch on", "switch over", "swoop down", "swoop in",
    "sync up", "tack on", "tag along", "tag on",
    "tail away", "tail off", "take aback", "take after",
    "take against", "take apart", "take aside", "take away",
    "take back", "take care of", "take down", "take in",
    "take off", "take on", "take out", "take over",
    "take through", "take to", "take up", "talk around",
    "talk back", "talk down", "talk into", "talk out",
    "talk over", "talk round", "talk through", "talk up",
    "tamp down", "tangle with", "tap for", "tap into",
    "taper off", "target at", "taste of", "tattle on",
    "team up", "team up with", "tear apart", "tear away",
    "tear down", "tear into", "tear off", "tear out",
    "tear up", "tease out", "tee off", "tee up",
    "tell apart", "tell off", "tell on", "test out",
    "thaw out", "thin out", "think ahead", "think back",
    "think of", "think out", "think over", "think through",
    "think up", "thrash out", "throw away", "throw back",
    "throw down", "throw in", "throw off", "throw on",
    "throw out", "throw together", "throw up", "thrust upon",
    "thump down", "tick off", "tick over", "tide over",
    "tidy up", "tie back", "tie down", "tie in",
    "tie off", "tie up", "tighten up", "tip off",
    "tip over", "tip up", "tire out", "tone down",
    "tone up", "tool up", "top off", "top out",
    "top up", "toss around", "toss aside", "toss out",
    "toss up", "total up", "touch base", "touch down",
    "touch off", "touch on", "touch up", "track down",
    "trade down", "trade in", "trade off", "trade on",
    "trade up", "trail away", "trail off", "train up",
    "trample on", "trap in", "tread down", "tread on",
    "treat to", "trick into", "trip over", "trip up",
    "trot off", "trot out", "trump up", "trust to",
    "trust with", "try back", "try for", "try on",
    "try out", "tuck away", "tuck in", "tuck into",
    "tuck up", "tune in", "tune out", "tune up",
    "turn against", "turn around", "turn away", "turn back",
    "turn down", "turn in", "turn into", "turn off",
    "turn on", "turn out", "turn out to", "turn over",
    "turn round", "turn to", "turn up", "type in",
    "type out", "type up", "urge on", "use up",
    "usher in", "vacuum up", "veer away", "vent out",
    "venture forth", "verge on", "vouch for", "wade in",
    "wade through", "wait around", "wait in", "wait on",
    "wait out", "wait up", "wake up", "walk away",
    "walk into", "walk off", "walk out", "walk out on",
    "walk over", "walk through", "walk up", "wall in",
    "wall off", "warm down", "warm to", "warm up",
    "wash away", "wash down", "wash off", "wash out",
    "wash over", "wash up", "waste away", "watch out",
    "watch out for", "watch over", "water down", "wave aside",
    "wave away", "wave down", "wave off", "wear away",
    "wear down", "wear off", "wear on", "wear out",
    "wear through", "weed out", "weigh down", "weigh in",
    "weigh on", "weigh out", "weigh up", "well up",
    "whip out", "whip up", "whisk away", "whistle for",
    "whittle away", "whittle down", "wile away", "win back",
    "win out", "win over", "win round", "win through",
    "wind down", "wind off", "wind on", "wind up",
    "wink at", "wipe away", "wipe down", "wipe off",
    "wipe out", "wipe up", "wire up", "wise up",
    "wolf down", "work around", "work at", "work away",
    "work in", "work into", "work off", "work on",
    "work out", "work over", "work round", "work through",
    "work toward", "work up", "worm into", "worm out",
    "wrap around", "wrap up", "wrest from", "wrestle with",
    "wriggle out", "wring out", "write back", "write down",
    "write in", "write off", "write out", "write up",
    "yield to", "zero in", "zero in on", "zero out",
    "zip by", "zip up", "zone out"
  ]);

  // Match phrase against known sets and saved vocabulary
  function findPhraseMatch(exact, vLemma, nUnplural, bothLemma) {
    // 1. User saved vocabulary (exact, lemma, unpluralized)
    const savedCandidates = [exact, nUnplural, vLemma, bothLemma];
    for (const c of savedCandidates) {
      if (c && savedVocabSet.has(c)) {
        return { key: c, type: "Saved Phrase", isSaved: true };
      }
    }

    // 2. Noun Phrases (exact, unpluralized)
    if (COMMON_NOUN_PHRASES.has(exact)) return { key: exact, type: "Noun Phrase" };
    if (nUnplural && COMMON_NOUN_PHRASES.has(nUnplural)) return { key: nUnplural, type: "Noun Phrase" };

    // 3. Phrasal Verbs (exact, verb lemma)
    if (COMMON_PHRASAL_VERBS.has(exact)) return { key: exact, type: "Phrasal Verb" };
    if (vLemma && COMMON_PHRASAL_VERBS.has(vLemma)) return { key: vLemma, type: "Phrasal Verb" };

    // 4. Idioms & Conversational Phrases (exact, unpluralized, verb lemma)
    if (COMMON_IDIOMS.has(exact)) return { key: exact, type: "Phrase / Idiom" };
    if (nUnplural && COMMON_IDIOMS.has(nUnplural)) return { key: nUnplural, type: "Phrase / Idiom" };
    if (vLemma && COMMON_IDIOMS.has(vLemma)) return { key: vLemma, type: "Phrase / Idiom" };

    return null;
  }

  // Get display category name for arbitrary phrase text
  function getPhraseType(phraseText) {
    if (!phraseText) return "Phrase";
    const cleanStr = phraseText.trim().toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    const words = cleanStr.split(/[\s-]+/).filter(Boolean);
    if (words.length <= 1) return "";
    const exact = words.join(" ");
    const vLemma = [VERB_LEMMAS[words[0]] || words[0], ...words.slice(1)].join(" ");
    const nUnplural = [...words.slice(0, -1), unpluralize(words[words.length - 1])].join(" ");
    const match = findPhraseMatch(exact, vLemma, nUnplural, "");
    if (match) return match.type;
    return "Phrase";
  }

  // Clean WebVTT and HTML tags from subtitle cues
  function cleanCueText(raw) {
    if (!raw) return "";
    return raw
      .replace(/<v[^>]*>/gi, "") // WebVTT voice tags
      .replace(/<\/v>/gi, "")
      .replace(/<c\.[^>]*>/gi, "") // WebVTT class tags
      .replace(/<\/c>/gi, "")
      .replace(/<[^>]+>/g, " ") // All remaining HTML/VTT tags
      .replace(/\{[^}]+\}/g, "") // ASS/SSA style tags
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  // ── Global Subtitle State & Config ────────────────────────────────────────
  let cfg = {
    src: "en",
    tgt: "vi",
    transColor: "",
    videoSubEnabled: true,
    videoSubLayout: "bilingual", // bilingual | transOnly | origOnly
    videoSubSize: "md", // sm | md | lg | xl
    videoSubAutoPause: false,
    videoSubHighlightVocab: true,
  };

  let savedVocabSet = new Set();
  const cueCache = new Map(); // LRU translation cache

  async function refreshConfig() {
    if (!ensureExtensionContext()) return;
    try {
      cfg = Object.assign(cfg, await F.getConfig());
      if (!ensureExtensionContext()) return;
      const vocabList = await F.getVocab();
      if (!ensureExtensionContext()) return;
      savedVocabSet = new Set(
        vocabList.map((w) => (w.term || "").trim().toLowerCase()).filter(Boolean)
      );
      // Update all active controllers
      for (const ctrl of activeControllers.values()) {
        ctrl.applyConfig();
      }
    } catch (error) {
      handleExtensionApiError("config refresh", error);
    }
  }

  async function refreshSavedVocabMarks() {
    if (!ensureExtensionContext()) return;
    try {
      const vocabList = await F.getVocab();
      if (!ensureExtensionContext()) return;
      savedVocabSet = new Set(
        vocabList.map((w) => (w.term || "").trim().toLowerCase()).filter(Boolean)
      );
      for (const ctrl of activeControllers.values()) {
        ctrl.highlightSavedWords();
      }
    } catch (error) {
      handleExtensionApiError("vocabulary refresh", error);
    }
  }

  refreshConfig();
  storageChangeHandler = (changes, area) => {
    if (!ensureExtensionContext()) return;
    if (area === "local") {
      if (changes.fufuConfig) {
        refreshConfig();
      } else if (changes.fufuVocab) {
        refreshSavedVocabMarks();
      }
    }
  };
  if (ensureExtensionContext()) {
    try {
      chrome.storage.onChanged.addListener(storageChangeHandler);
    } catch (error) {
      handleExtensionApiError("storage change listener registration", error);
    }
  }

  // ── Translation Pipeline ──────────────────────────────────────────────────
  let onDeviceTranslator = null;
  let translatorInitPromise = null;

  async function getOnDeviceTranslator() {
    if (onDeviceTranslator) return onDeviceTranslator;
    if (translatorInitPromise) return translatorInitPromise;

    translatorInitPromise = (async () => {
      if (typeof Translator === "undefined") throw new Error("NO_ON_DEVICE_API");
      const t = await Translator.create({
        sourceLanguage: cfg.src || "en",
        targetLanguage: cfg.tgt || "vi",
      });
      onDeviceTranslator = t;
      return t;
    })().catch((err) => {
      translatorInitPromise = null;
      throw err;
    });

    return translatorInitPromise;
  }

  async function translateCue(text) {
    if (!ensureExtensionContext()) return text;
    const key = `${cfg.src}:${cfg.tgt}:${text}`;
    if (cueCache.has(key)) return cueCache.get(key);

    let translated = "";
    try {
      const t = await getOnDeviceTranslator();
      translated = await t.translate(text);
    } catch {
      // Fallback to background service worker translation
      try {
        const res = await safeRuntimeMessage({
          type: "FUFU_TRANSLATE",
          text,
          src: cfg.src || "auto",
          tgt: cfg.tgt || "vi",
        });
        if (res?.translation) {
          translated = res.translation;
        }
      } catch (error) {
        if (!isContextInvalidatedError(error)) {
          console.warn("[Vimi] Subtitle translation fallback failed:", error);
        }
      }
    }

    if (!ensureExtensionContext()) return text;

    if (translated) {
      if (cueCache.size > 800) {
        const firstKey = cueCache.keys().next().value;
        cueCache.delete(firstKey);
      }
      cueCache.set(key, translated);
    }

    return translated || text;
  }

  // ── SRT & WebVTT File Parser ──────────────────────────────────────────────
  function parseTimestamp(timeStr) {
    const parts = timeStr.trim().replace(",", ".").split(":");
    if (parts.length === 3) {
      const [h, m, s] = parts;
      return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
    } else if (parts.length === 2) {
      const [m, s] = parts;
      return parseFloat(m) * 60 + parseFloat(s);
    }
    return 0;
  }

  function parseSubtitles(content) {
    const cues = [];
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const blocks = normalized.split(/\n\s*\n/);

    const timeRegex = /((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{2,3})/;

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      let timeLineIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (timeRegex.test(lines[i])) {
          timeLineIdx = i;
          break;
        }
      }
      if (timeLineIdx === -1) continue;

      const match = lines[timeLineIdx].match(timeRegex);
      if (!match) continue;

      const start = parseTimestamp(match[1]);
      const end = parseTimestamp(match[2]);
      const text = cleanCueText(lines.slice(timeLineIdx + 1).join(" "));

      if (text && end > start) {
        cues.push({ start, end, text });
      }
    }

    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  // ── Single Video Controller ───────────────────────────────────────────────
  class VideoController {
    constructor(video) {
      this.video = video;
      this.container = this.findPlayerContainer();
      this.overlay = null;
      this.badge = null;
      this.menu = null;
      this.fileInput = null;

      this.currentCueText = "";
      this.currentTranslatedText = "";
      this.lastCueTime = 0;
      this.externalCues = null;
      this.activeTrack = null;
      this.domObserver = null;
      this.boundCueChange = this.onNativeCueChange.bind(this);
      this.boundTimeUpdate = this.onTimeUpdate.bind(this);
      this.boundPause = () => this.cancelStickyClear();
      this.boundPlay = () => {
        if (this.currentCueText) this.scheduleStickyClear(6000);
      };
      this.boundEnded = () => this.handleCueClear();
      this.debounceTimer = null;
      this.translateDebounceTimer = null;
      this.stickyClearTimer = null;
      this.activeWord = null;
      this.translationCard = null;
      this.hoverPausedByExtension = false;
      this.translationPauseLocked = false;
      this.translationPausedByExtension = false;
      this.replacingTranslationCard = false;
      this.badgeHasDragged = false;
      this.badgeJustDragged = false;
      this.cleanupBadgeDrag = null;
      this.cleanupOverlayDrag = null;
      this.justHighlightedPhrase = false;
      this.lastClickedWordSpan = null;
      this.cleanupPhraseHighlight = null;
      this.boundResize = null;
      this.boundPlayerInteraction = this.handlePlayerInteraction.bind(this);
      this.boundDocumentClick = null;
      this.boundFullscreenChange = null;
      this.boundDragOver = null;
      this.boundDrop = null;
      this.boundTrackAdded = null;
      this.parentObserver = null;
      this.destroyed = false;

      this.initUI();
      this.attachEvents();
      this.detectSubtitles();
    }

    findPlayerContainer() {
      // Find the closest wrapper container that encloses the video player
      const el = this.video;
      const playerCandidate = el.closest(
        '#movie_player, .html5-video-player, .video-js, [class*="player__"], [class*="player-container"], [data-purpose="video-player"], [class*="video-player"]'
      );
      if (playerCandidate) return playerCandidate;

      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        if (
          style.position === "relative" ||
          style.position === "absolute" ||
          style.position === "fixed"
        ) {
          return parent;
        }
        parent = parent.parentElement;
      }
      const directParent = el.parentElement || document.body;
      if (directParent !== document.body) {
        const s = window.getComputedStyle(directParent);
        if (s.position === "static") {
          directParent.style.position = "relative";
        }
      }
      return directParent;
    }

    initUI() {
      // 1. Subtitle Overlay
      this.overlay = document.createElement("div");
      this.overlay.className = `vimi-sub-overlay vimi-sub-${cfg.videoSubSize || "md"} vimi-sub-hidden`;
      this.overlay.innerHTML = `
        <div class="vimi-sub-drag-handle" title="Drag to reposition subtitles"></div>
        <div class="vimi-sub-content">
          <div class="vimi-sub-orig"></div>
          <div class="vimi-sub-trans"></div>
        </div>
      `;

      // 2. Control Badge
      this.badge = document.createElement("div");
      this.badge.className = "vimi-sub-badge";
      this.badge.innerHTML = `
        <span class="vimi-sub-badge-icon">CC</span>
        <span>Vimi</span>
        <span class="vimi-sub-badge-dot"></span>
      `;
      this.badge.title = "Vimi Bilingual Video Subtitles (Drag to move, double-click to reset)";

      // 3. Settings Menu
      this.menu = document.createElement("div");
      this.menu.className = "vimi-sub-menu vimi-menu-hidden";
      this.renderMenu();

      // Hidden file input for external SRT/VTT
      this.fileInput = document.createElement("input");
      this.fileInput.type = "file";
      this.fileInput.accept = ".srt,.vtt";
      this.fileInput.style.display = "none";
      this.fileInput.addEventListener("change", (e) => this.handleFileSelect(e));

      this.mountToContainer();
      this.setupDraggable();
      this.setupHoverPause();
      this.setupPhraseHighlight();
      this.loadSavedPositions();
    }

    mountToContainer() {
      const target = document.fullscreenElement || this.container;
      if (!target.contains(this.overlay)) target.appendChild(this.overlay);
      if (!target.contains(this.badge)) target.appendChild(this.badge);
      if (!target.contains(this.menu)) target.appendChild(this.menu);
      if (!target.contains(this.fileInput)) target.appendChild(this.fileInput);
      this.loadSavedPositions();
    }

    renderMenu() {
      const tracks = this.getAvailableTracks();
      const trackOptions = tracks
        .map(
          (t, idx) =>
            `<option value="${idx}" ${t.selected ? "selected" : ""}>${t.label || t.language || `Track ${idx + 1}`}</option>`
        )
        .join("");

      this.menu.innerHTML = `
        <div class="vimi-sub-menu-title">
          <span>🎬 Bilingual Subtitles</span>
          <span style="font-size: 11px; opacity: 0.8;">Vimi</span>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Subtitles</span>
          <button class="vimi-sub-toggle-btn ${cfg.videoSubEnabled ? "active" : ""}" id="vimiSubToggle">
            ${cfg.videoSubEnabled ? "Enabled" : "Disabled"}
          </button>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Layout</span>
          <div class="vimi-sub-segmented">
            <button class="vimi-sub-seg-btn ${cfg.videoSubLayout === "bilingual" ? "active" : ""}" data-layout="bilingual">Both</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubLayout === "transOnly" ? "active" : ""}" data-layout="transOnly">Target</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubLayout === "origOnly" ? "active" : ""}" data-layout="origOnly">Source</button>
          </div>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Track</span>
          <select class="vimi-sub-select" id="vimiSubTrackSelect">
            <option value="auto">Auto-detect</option>
            ${trackOptions}
          </select>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Size</span>
          <div class="vimi-sub-segmented">
            <button class="vimi-sub-seg-btn ${cfg.videoSubSize === "sm" ? "active" : ""}" data-size="sm">S</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubSize === "md" ? "active" : ""}" data-size="md">M</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubSize === "lg" ? "active" : ""}" data-size="lg">L</button>
            <button class="vimi-sub-seg-btn ${cfg.videoSubSize === "xl" ? "active" : ""}" data-size="xl">XL</button>
          </div>
        </div>
        <div class="vimi-sub-menu-row">
          <span class="vimi-sub-menu-label">Study Mode (Pause on hover)</span>
          <button class="vimi-sub-toggle-btn ${cfg.videoSubAutoPause ? "active" : ""}" id="vimiSubPauseToggle">
            ${cfg.videoSubAutoPause ? "ON" : "OFF"}
          </button>
        </div>
        <button class="vimi-sub-btn-secondary" id="vimiResetPositions">
          ↺ Reset Positions (Default)
        </button>
        <button class="vimi-sub-btn-secondary" id="vimiLoadSubFile">
          📁 Load .srt / .vtt file
        </button>
      `;

      this.bindMenuEvents();
    }

    bindMenuEvents() {
      const toggleBtn = this.menu.querySelector("#vimiSubToggle");
      toggleBtn?.addEventListener("click", () => {
        if (!ensureExtensionContext() || this.destroyed) return;
        cfg.videoSubEnabled = !cfg.videoSubEnabled;
        safeSetConfig({ videoSubEnabled: cfg.videoSubEnabled });
        this.applyConfig();
      });

      this.menu.querySelectorAll("[data-layout]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!ensureExtensionContext() || this.destroyed) return;
          cfg.videoSubLayout = btn.dataset.layout;
          safeSetConfig({ videoSubLayout: cfg.videoSubLayout });
          this.applyConfig();
        });
      });

      this.menu.querySelectorAll("[data-size]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!ensureExtensionContext() || this.destroyed) return;
          cfg.videoSubSize = btn.dataset.size;
          safeSetConfig({ videoSubSize: cfg.videoSubSize });
          this.applyConfig();
        });
      });

      const pauseBtn = this.menu.querySelector("#vimiSubPauseToggle");
      pauseBtn?.addEventListener("click", () => {
        if (!ensureExtensionContext() || this.destroyed) return;
        cfg.videoSubAutoPause = !cfg.videoSubAutoPause;
        safeSetConfig({ videoSubAutoPause: cfg.videoSubAutoPause });
        this.applyConfig();
      });

      const trackSelect = this.menu.querySelector("#vimiSubTrackSelect");
      trackSelect?.addEventListener("change", (e) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        const val = e.target.value;
        if (val === "auto") {
          this.activeTrack = null;
          this.detectSubtitles();
        } else {
          const idx = parseInt(val, 10);
          this.selectTrackByIndex(idx);
        }
      });

      const resetBtn = this.menu.querySelector("#vimiResetPositions");
      resetBtn?.addEventListener("click", () => {
        if (!ensureExtensionContext() || this.destroyed) return;
        this.resetPositions();
        this.showToast("Subtitles & CC badge reset to default positions");
      });

      const loadFileBtn = this.menu.querySelector("#vimiLoadSubFile");
      loadFileBtn?.addEventListener("click", () => {
        if (!ensureExtensionContext() || this.destroyed) return;
        this.fileInput.click();
      });
    }

    handleFileSelect(e) {
      if (!ensureExtensionContext() || this.destroyed) return;
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        const text = evt.target?.result;
        if (typeof text === "string") {
          const cues = parseSubtitles(text);
          if (cues.length > 0) {
            this.externalCues = cues;
            this.video.addEventListener("timeupdate", this.boundTimeUpdate);
            this.showToast(`Loaded ${cues.length} subtitles from ${file.name}`);
            this.menu.classList.add("vimi-menu-hidden");
          } else {
            this.showToast("Could not find valid subtitles in file");
          }
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    }

    showToast(msg) {
      const toast = document.createElement("div");
      toast.style.cssText = `
        position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.95); color: #38bdf8; padding: 6px 14px;
        border-radius: 8px; font-size: 12px; font-weight: 600; z-index: 2147483647;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4); border: 1px solid rgba(56, 189, 248, 0.3);
      `;
      toast.textContent = msg;
      (document.fullscreenElement || this.container).appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
    }

    applyConfig() {
      if (!cfg.videoSubAutoPause && this.hoverPausedByExtension) {
        this.resumeAfterStudyHover();
      }

      // Toggle overlay visibility
      if (!cfg.videoSubEnabled) {
        this.overlay.classList.add("vimi-sub-hidden");
        this.badge.classList.add("vimi-sub-disabled");
      } else {
        this.badge.classList.remove("vimi-sub-disabled");
        if (this.currentCueText) {
          this.overlay.classList.remove("vimi-sub-hidden");
        }
      }

      // Update sizing
      this.overlay.className = this.overlay.className.replace(/vimi-sub-(sm|md|lg|xl)/g, "");
      this.overlay.classList.add(`vimi-sub-${cfg.videoSubSize || "md"}`);

      // Re-render menu
      this.renderMenu();

      // Refresh current cue display
      if (this.activeTrack) {
        this.activeTrack.mode = cfg.videoSubEnabled ? "hidden" : "showing";
      }
      if (this.currentCueText) {
        this.renderCueDisplay();
      }
    }

    positionMenu() {
      if (!this.menu || this.menu.classList.contains("vimi-menu-hidden")) return;
      const target = document.fullscreenElement || this.container;
      const parentRect = target.getBoundingClientRect();
      const badgeRect = this.badge.getBoundingClientRect();
      const menuWidth = 250;
      const menuHeight = this.menu.offsetHeight || 320;

      const badgeRelLeft = badgeRect.left - parentRect.left;
      const badgeRelTop = badgeRect.top - parentRect.top;

      // Horizontal: align right edge if near right border, otherwise align left edge
      let menuLeft = badgeRelLeft;
      if (badgeRelLeft + menuWidth > parentRect.width - 10) {
        menuLeft = badgeRelLeft + badgeRect.width - menuWidth;
      }
      menuLeft = Math.max(10, Math.min(parentRect.width - menuWidth - 10, menuLeft));

      // Vertical: flip upwards if badge is near the bottom edge
      let menuTop = badgeRelTop + badgeRect.height + 8;
      if (menuTop + menuHeight > parentRect.height - 10 && badgeRelTop - menuHeight - 8 >= 10) {
        menuTop = badgeRelTop - menuHeight - 8;
      }
      menuTop = Math.max(10, Math.min(parentRect.height - menuHeight - 10, menuTop));

      this.menu.style.left = `${menuLeft}px`;
      this.menu.style.top = `${menuTop}px`;
      this.menu.style.right = "auto";
      this.menu.style.bottom = "auto";
    }

    resetPositions() {
      // 1. Reset overlay to bottom-center default
      this.overlay.style.top = "auto";
      this.overlay.style.bottom = "50px";
      this.overlay.style.left = "50%";
      this.overlay.style.right = "auto";
      this.overlay.style.transform = "translateX(-50%)";

      // 2. Reset badge to top-right default
      this.badge.style.top = "14px";
      this.badge.style.right = "14px";
      this.badge.style.left = "auto";
      this.badge.style.bottom = "auto";
      this.badge.style.transform = "none";

      try {
        safeStorageRemove(["vimiSubOverlayPos", "vimiSubBadgePos"]);
      } catch {}

      this.positionMenu();
    }

    async loadSavedPositions() {
      try {
        const positions = await safeStorageGet([
          "vimiSubOverlayPos",
          "vimiSubBadgePos",
        ]);
        if (!positions || this.destroyed) return;
        const { vimiSubOverlayPos, vimiSubBadgePos } = positions;
        const target = document.fullscreenElement || this.container;
        const parentRect = target.getBoundingClientRect();
        if (parentRect.width <= 0 || parentRect.height <= 0) return;

        if (vimiSubOverlayPos && typeof vimiSubOverlayPos.x === "number" && typeof vimiSubOverlayPos.y === "number") {
          const overlayWidth = this.overlay.offsetWidth || Math.min(parentRect.width * 0.88, 780);
          const overlayHeight = this.overlay.offsetHeight || 50;
          const leftPx = Math.max(8, Math.min(parentRect.width - overlayWidth - 8, (vimiSubOverlayPos.x / 100) * parentRect.width));
          const topPx = Math.max(8, Math.min(parentRect.height - overlayHeight - 8, (vimiSubOverlayPos.y / 100) * parentRect.height));
          this.overlay.style.bottom = "auto";
          this.overlay.style.right = "auto";
          this.overlay.style.transform = "none";
          this.overlay.style.left = `${leftPx}px`;
          this.overlay.style.top = `${topPx}px`;
        }

        if (vimiSubBadgePos && typeof vimiSubBadgePos.x === "number" && typeof vimiSubBadgePos.y === "number") {
          const badgeWidth = this.badge.offsetWidth || 80;
          const badgeHeight = this.badge.offsetHeight || 30;
          const leftPx = Math.max(8, Math.min(parentRect.width - badgeWidth - 8, (vimiSubBadgePos.x / 100) * parentRect.width));
          const topPx = Math.max(8, Math.min(parentRect.height - badgeHeight - 8, (vimiSubBadgePos.y / 100) * parentRect.height));
          this.badge.style.right = "auto";
          this.badge.style.bottom = "auto";
          this.badge.style.transform = "none";
          this.badge.style.left = `${leftPx}px`;
          this.badge.style.top = `${topPx}px`;
        }
      } catch (error) {
        handleExtensionApiError("saved subtitle position load", error);
      }
    }

    setupDraggable() {
      const getTarget = () => document.fullscreenElement || this.container;

      // ── A. Subtitle Overlay Card Dragging ──────────────────────────────────
      // Dragging is exclusively initiated from the dedicated top drag handle (.vimi-sub-drag-handle)
      // or by Alt+dragging the overlay background, so text selection inside the subtitles NEVER moves the box!
      const dragHandle = this.overlay.querySelector(".vimi-sub-drag-handle");
      let overlayActivePointerId = null;
      let overlayStartX = 0, overlayStartY = 0;
      let overlayInitLeft = 0, overlayInitTop = 0;
      let overlayMoved = false;

      const endOverlayDrag = (cancelled = false) => {
        if (overlayActivePointerId === null) return;
        const pid = overlayActivePointerId;
        overlayActivePointerId = null;

        try {
          if (this.overlay.hasPointerCapture && this.overlay.hasPointerCapture(pid)) {
            this.overlay.releasePointerCapture(pid);
          }
          if (dragHandle && dragHandle.hasPointerCapture && dragHandle.hasPointerCapture(pid)) {
            dragHandle.releasePointerCapture(pid);
          }
        } catch {}

        window.removeEventListener("pointermove", onOverlayPointerMove, true);
        window.removeEventListener("pointerup", onOverlayPointerUp, true);
        window.removeEventListener("mouseup", onOverlayPointerUp, true);
        window.removeEventListener("pointercancel", onOverlayPointerCancel, true);
        window.removeEventListener("lostpointercapture", onOverlayPointerCancel, true);
        window.removeEventListener("keydown", onOverlayKeyDown, true);
        window.removeEventListener("blur", onOverlayBlur, true);

        this.overlay.classList.remove("vimi-sub-dragging");

        if (cancelled) {
          this.overlay.style.bottom = "auto";
          this.overlay.style.right = "auto";
          this.overlay.style.transform = "none";
          this.overlay.style.left = `${overlayInitLeft}px`;
          this.overlay.style.top = `${overlayInitTop}px`;
          overlayMoved = false;
          return;
        }

        if (overlayMoved) {
          overlayMoved = false;
          const target = getTarget();
          const pRect = target.getBoundingClientRect();
          const oRect = this.overlay.getBoundingClientRect();
          const curLeft = oRect.left - pRect.left;
          const curTop = oRect.top - pRect.top;
          if (pRect.width > 0 && pRect.height > 0) {
            const xPercent = (curLeft / pRect.width) * 100;
            const yPercent = (curTop / pRect.height) * 100;
            safeStorageSet({ vimiSubOverlayPos: { x: xPercent, y: yPercent } });
          }
        }
      };

      const onOverlayPointerMove = (ev) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        if (overlayActivePointerId === null || ev.pointerId !== overlayActivePointerId) return;
        const dx = ev.clientX - overlayStartX;
        const dy = ev.clientY - overlayStartY;

        if (!overlayMoved && Math.hypot(dx, dy) > 4) {
          overlayMoved = true;
          this.overlay.classList.add("vimi-sub-dragging");
        }
        if (!overlayMoved) return;

        const target = getTarget();
        const pRect = target.getBoundingClientRect();
        const oRect = this.overlay.getBoundingClientRect();

        let newLeft = overlayInitLeft + dx;
        let newTop = overlayInitTop + dy;

        newLeft = Math.max(8, Math.min(pRect.width - oRect.width - 8, newLeft));
        newTop = Math.max(8, Math.min(pRect.height - oRect.height - 8, newTop));

        this.overlay.style.bottom = "auto";
        this.overlay.style.right = "auto";
        this.overlay.style.transform = "none";
        this.overlay.style.left = `${newLeft}px`;
        this.overlay.style.top = `${newTop}px`;

        ev.preventDefault();
        ev.stopPropagation();
      };

      const onOverlayPointerUp = (ev) => {
        if (overlayActivePointerId !== null && (ev.pointerId === overlayActivePointerId || !ev.pointerId)) {
          endOverlayDrag(false);
        }
      };

      const onOverlayPointerCancel = (ev) => {
        if (overlayActivePointerId !== null && (!ev || ev.pointerId === overlayActivePointerId || !ev.pointerId)) {
          endOverlayDrag(true);
        }
      };

      const onOverlayBlur = () => {
        if (overlayActivePointerId !== null) {
          endOverlayDrag(true);
        }
      };

      const onOverlayKeyDown = (ev) => {
        if (overlayActivePointerId !== null && ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          endOverlayDrag(true);
        }
      };

      const onOverlayPointerDown = (e) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        if (e.pointerType === "mouse" && e.button !== 0) return; // only left click
        if (e.isPrimary === false) return;

        e.stopPropagation();

        if (overlayActivePointerId !== null) {
          endOverlayDrag(true);
        }

        const target = getTarget();
        const parentRect = target.getBoundingClientRect();
        const overlayRect = this.overlay.getBoundingClientRect();

        overlayActivePointerId = e.pointerId;
        overlayMoved = false;
        overlayStartX = e.clientX;
        overlayStartY = e.clientY;
        overlayInitLeft = overlayRect.left - parentRect.left;
        overlayInitTop = overlayRect.top - parentRect.top;

        try {
          (e.currentTarget || this.overlay).setPointerCapture(e.pointerId);
        } catch {}

        window.addEventListener("pointermove", onOverlayPointerMove, { capture: true, passive: false });
        window.addEventListener("pointerup", onOverlayPointerUp, { capture: true });
        window.addEventListener("mouseup", onOverlayPointerUp, { capture: true });
        window.addEventListener("pointercancel", onOverlayPointerCancel, { capture: true });
        window.addEventListener("lostpointercapture", onOverlayPointerCancel, { capture: true });
        window.addEventListener("keydown", onOverlayKeyDown, { capture: true });
        window.addEventListener("blur", onOverlayBlur, { capture: true });
      };

      this.cleanupOverlayDrag = endOverlayDrag;
      if (dragHandle) {
        dragHandle.addEventListener("pointerdown", onOverlayPointerDown);
      }
      this.overlay.addEventListener("pointerdown", (e) => {
        // Only allow overlay background drag if user holds Alt key
        if (e.altKey && !e.target.closest?.(".vimi-sub-word, .vimi-sub-phrase, .vimi-pop-chip")) {
          onOverlayPointerDown(e);
        }
      });

      // Double-click drag handle or overlay resets position to bottom center
      this.overlay.addEventListener("dblclick", (e) => {
        if (e.target.closest?.(".vimi-sub-word, .vimi-sub-phrase, .vimi-pop-chip")) return;
        if (!ensureExtensionContext() || this.destroyed) return;
        e.stopPropagation();
        this.overlay.style.top = "auto";
        this.overlay.style.bottom = "50px";
        this.overlay.style.left = "50%";
        this.overlay.style.right = "auto";
        this.overlay.style.transform = "translateX(-50%)";
        safeStorageRemove("vimiSubOverlayPos");
        this.showToast("Subtitles reset to bottom center");
      });

      // ── B. Control Badge Dragging ──────────────────────────────────────────
      let badgeActivePointerId = null;
      let badgeStartX = 0, badgeStartY = 0;
      let badgeInitLeft = 0, badgeInitTop = 0;
      this.badgeHasDragged = false;
      this.badgeJustDragged = false;

      const endBadgeDrag = (cancelled = false) => {
        if (badgeActivePointerId === null) return;
        const pid = badgeActivePointerId;
        badgeActivePointerId = null;

        try {
          if (this.badge.hasPointerCapture && this.badge.hasPointerCapture(pid)) {
            this.badge.releasePointerCapture(pid);
          }
        } catch {}

        window.removeEventListener("pointermove", onBadgePointerMove, true);
        window.removeEventListener("pointerup", onBadgePointerUp, true);
        window.removeEventListener("mouseup", onBadgePointerUp, true);
        window.removeEventListener("pointercancel", onBadgePointerCancel, true);
        window.removeEventListener("lostpointercapture", onBadgePointerCancel, true);
        window.removeEventListener("keydown", onBadgeKeyDown, true);
        window.removeEventListener("blur", onBadgeBlur, true);

        this.badge.classList.remove("vimi-sub-badge-dragging");

        if (cancelled) {
          this.badge.style.right = "auto";
          this.badge.style.bottom = "auto";
          this.badge.style.transform = "none";
          this.badge.style.left = `${badgeInitLeft}px`;
          this.badge.style.top = `${badgeInitTop}px`;
          this.badgeHasDragged = false;
          this.positionMenu();
          return;
        }

        if (this.badgeHasDragged) {
          this.badgeJustDragged = true;
          setTimeout(() => {
            this.badgeJustDragged = false;
            this.badgeHasDragged = false;
          }, 200);

          const target = getTarget();
          const pRect = target.getBoundingClientRect();
          const bRect = this.badge.getBoundingClientRect();
          const curLeft = bRect.left - pRect.left;
          const curTop = bRect.top - pRect.top;
          if (pRect.width > 0 && pRect.height > 0) {
            const xPercent = (curLeft / pRect.width) * 100;
            const yPercent = (curTop / pRect.height) * 100;
            safeStorageSet({ vimiSubBadgePos: { x: xPercent, y: yPercent } });
          }
          this.positionMenu();
        }
      };

      const onBadgePointerMove = (ev) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        if (badgeActivePointerId === null || ev.pointerId !== badgeActivePointerId) return;
        const dx = ev.clientX - badgeStartX;
        const dy = ev.clientY - badgeStartY;

        if (!this.badgeHasDragged && Math.hypot(dx, dy) > 5) {
          this.badgeHasDragged = true;
          this.badge.classList.add("vimi-sub-badge-dragging");
        }
        if (!this.badgeHasDragged) return;

        const target = getTarget();
        const pRect = target.getBoundingClientRect();
        const bRect = this.badge.getBoundingClientRect();

        let newLeft = badgeInitLeft + dx;
        let newTop = badgeInitTop + dy;

        newLeft = Math.max(8, Math.min(pRect.width - bRect.width - 8, newLeft));
        newTop = Math.max(8, Math.min(pRect.height - bRect.height - 8, newTop));

        this.badge.style.right = "auto";
        this.badge.style.bottom = "auto";
        this.badge.style.transform = "none";
        this.badge.style.left = `${newLeft}px`;
        this.badge.style.top = `${newTop}px`;

        this.positionMenu();
        ev.preventDefault();
        ev.stopPropagation();
      };

      const onBadgePointerUp = (ev) => {
        if (badgeActivePointerId !== null && (ev.pointerId === badgeActivePointerId || !ev.pointerId)) {
          endBadgeDrag(false);
        }
      };

      const onBadgePointerCancel = (ev) => {
        if (badgeActivePointerId !== null && (!ev || ev.pointerId === badgeActivePointerId || !ev.pointerId)) {
          endBadgeDrag(true);
        }
      };

      const onBadgeBlur = () => {
        if (badgeActivePointerId !== null) {
          endBadgeDrag(true);
        }
      };

      const onBadgeKeyDown = (ev) => {
        if (badgeActivePointerId !== null && ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          endBadgeDrag(true);
        }
      };

      const onBadgePointerDown = (e) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (e.isPrimary === false) return;

        e.stopPropagation();

        if (badgeActivePointerId !== null) {
          endBadgeDrag(true);
        }

        const target = getTarget();
        const parentRect = target.getBoundingClientRect();
        const badgeRect = this.badge.getBoundingClientRect();

        badgeActivePointerId = e.pointerId;
        this.badgeHasDragged = false;
        badgeStartX = e.clientX;
        badgeStartY = e.clientY;
        badgeInitLeft = badgeRect.left - parentRect.left;
        badgeInitTop = badgeRect.top - parentRect.top;

        try {
          this.badge.setPointerCapture(e.pointerId);
        } catch {}

        window.addEventListener("pointermove", onBadgePointerMove, { capture: true, passive: false });
        window.addEventListener("pointerup", onBadgePointerUp, { capture: true });
        window.addEventListener("mouseup", onBadgePointerUp, { capture: true });
        window.addEventListener("pointercancel", onBadgePointerCancel, { capture: true });
        window.addEventListener("lostpointercapture", onBadgePointerCancel, { capture: true });
        window.addEventListener("keydown", onBadgeKeyDown, { capture: true });
        window.addEventListener("blur", onBadgeBlur, { capture: true });
      };

      this.cleanupBadgeDrag = endBadgeDrag;
      this.badge.addEventListener("pointerdown", onBadgePointerDown);

      // Double click on badge resets to top-right corner
      this.badge.addEventListener("dblclick", (e) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        e.stopPropagation();
        this.badge.style.top = "14px";
        this.badge.style.right = "14px";
        this.badge.style.left = "auto";
        this.badge.style.bottom = "auto";
        this.badge.style.transform = "none";
        safeStorageRemove("vimiSubBadgePos");
        this.showToast("CC badge reset to top right");
        this.positionMenu();
      });
    }

    setupHoverPause() {
      this.overlay.addEventListener("mouseenter", () => {
        this.pauseForStudyHover();
      });

      this.overlay.addEventListener("mouseleave", () => {
        this.resumeAfterStudyHover();
      });
    }

    setupPhraseHighlight() {
      let selectionTimer = null;

      const onMouseUp = () => {
        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => {
          this.checkSelectionAndLookup();
        }, 40);
      };

      this.overlay.addEventListener("mouseup", onMouseUp);
      window.addEventListener("mouseup", onMouseUp);

      this.cleanupPhraseHighlight = () => {
        clearTimeout(selectionTimer);
        this.overlay.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("mouseup", onMouseUp);
      };
    }

    checkSelectionAndLookup() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;

      const rawText = sel.toString().trim();
      if (!rawText) return;

      // Ensure selection belongs to this overlay
      const anchorNode = sel.anchorNode;
      const focusNode = sel.focusNode;
      if (!anchorNode || !focusNode) return;
      if (!this.overlay.contains(anchorNode) || !this.overlay.contains(focusNode)) return;

      // Clean punctuation from start/end
      const cleanPhrase = rawText.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
      if (!cleanPhrase) return;

      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return;

        // Suppress single-word click
        this.justHighlightedPhrase = true;
        setTimeout(() => {
          this.justHighlightedPhrase = false;
        }, 350);

        this.handleWordClick(cleanPhrase, this.currentCueText, {
          getBoundingClientRect: () => rect,
          isPhrase: cleanPhrase.includes(" ") || cleanPhrase.includes("-"),
        });
      } catch {}
    }

    pauseForStudyHover() {
      if (!ensureExtensionContext() || this.destroyed) return;
      if (!cfg.videoSubAutoPause || this.translationPauseLocked) return;
      if (!this.video.paused) {
        this.hoverPausedByExtension = true;
        this.video.pause();
      }
    }

    resumeAfterStudyHover() {
      if (!ensureExtensionContext() || this.destroyed) return;
      if (!this.hoverPausedByExtension || this.translationPauseLocked) return;
      this.hoverPausedByExtension = false;
      if (this.video.paused && !this.video.ended) {
        this.video.play().catch(() => {});
      }
    }

    lockTranslationPause() {
      if (this.translationPauseLocked) return;
      this.translationPauseLocked = true;

      // If Study Mode paused a playing video, transfer that resume ownership
      // to the translation lock instead of treating it as a user pause.
      if (this.hoverPausedByExtension) {
        this.translationPausedByExtension = true;
        this.hoverPausedByExtension = false;
      } else if (!this.video.paused) {
        this.translationPausedByExtension = true;
        this.video.pause();
      } else {
        this.translationPausedByExtension = false;
      }
    }

    releaseTranslationPause({ resume }) {
      if (!this.translationPauseLocked) return;
      const shouldResume = resume && this.translationPausedByExtension;
      this.translationPauseLocked = false;
      this.translationPausedByExtension = false;
      if (shouldResume && this.video.paused && !this.video.ended) {
        this.video.play().catch(() => {});
      }
    }

    handlePlayerInteraction(event) {
      if (!ensureExtensionContext() || this.destroyed) return;
      if (!this.translationPauseLocked) return;
      if (
        this.overlay.contains(event.target) ||
        this.badge.contains(event.target) ||
        this.menu.contains(event.target) ||
        event.target.closest?.(".vimi-translation-card")
      ) {
        return;
      }

      // Cleanup only. The event is deliberately left untouched so the player
      // can perform its native play/pause behavior.
      if (this.translationCard) {
        TranslationCard.close(this.translationCard, "video-interaction", event);
      } else {
        this.clearActiveWord();
        this.releaseTranslationPause({ resume: false });
      }
    }

    setActiveWord(span) {
      if (this.activeWord && this.activeWord !== span) {
        this.activeWord.classList?.remove("vimi-sub-active");
      }
      this.activeWord = span;
      span?.classList?.add("vimi-sub-active");
    }

    clearActiveWord(span) {
      if (span && this.activeWord !== span) return;
      this.activeWord?.classList?.remove("vimi-sub-active");
      this.activeWord = null;
    }

    attachEvents() {
      this.container.addEventListener("click", this.boundPlayerInteraction, true);

      // Toggle Settings Menu
      this.badge.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.badgeJustDragged || this.badgeHasDragged) {
          this.badgeJustDragged = false;
          this.badgeHasDragged = false;
          return;
        }
        const willOpen = this.menu.classList.contains("vimi-menu-hidden");
        this.menu.classList.toggle("vimi-menu-hidden");
        this.badge.classList.toggle("vimi-sub-badge-active", willOpen);
        if (willOpen) {
          this.positionMenu();
        }
      });

      this.boundDocumentClick = (e) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        if (!this.menu.contains(e.target) && !this.badge.contains(e.target)) {
          this.menu.classList.add("vimi-menu-hidden");
          this.badge.classList.remove("vimi-sub-badge-active");
        }
      };
      document.addEventListener("click", this.boundDocumentClick);

      // Window resize / resolution adjustment
      this.boundResize = () => {
        if (!ensureExtensionContext() || this.destroyed) return;
        this.loadSavedPositions();
        this.positionMenu();
      };
      window.addEventListener("resize", this.boundResize);

      // Fullscreen change handling
      this.boundFullscreenChange = () => {
        if (!ensureExtensionContext() || this.destroyed) return;
        this.mountToContainer();
      };
      document.addEventListener("fullscreenchange", this.boundFullscreenChange);
      document.addEventListener("webkitfullscreenchange", this.boundFullscreenChange);

      // Continuous timeupdate & state synchronization
      this.video.addEventListener("timeupdate", this.boundTimeUpdate);
      this.video.addEventListener("seeked", this.boundTimeUpdate);
      this.video.addEventListener("pause", this.boundPause);
      this.video.addEventListener("play", this.boundPlay);
      this.video.addEventListener("ended", this.boundEnded);

      // Drag & drop subtitle file directly onto video
      const dropZone = this.container;
      this.boundDragOver = (e) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      };
      this.boundDrop = (e) => {
        if (!ensureExtensionContext() || this.destroyed) return;
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && (file.name.endsWith(".srt") || file.name.endsWith(".vtt"))) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            if (!ensureExtensionContext() || this.destroyed) return;
            const cues = parseSubtitles(evt.target?.result || "");
            if (cues.length > 0) {
              this.externalCues = cues;
              this.video.addEventListener("timeupdate", this.boundTimeUpdate);
              this.showToast(`Loaded ${cues.length} subtitles from ${file.name}`);
            }
          };
          reader.readAsText(file);
        }
      };
      dropZone.addEventListener("dragover", this.boundDragOver);
      dropZone.addEventListener("drop", this.boundDrop);
    }

    // ── Subtitle Detection & Extraction ─────────────────────────────────────
    detectSubtitles() {
      // 1. Check HTML5 TextTracks
      if (this.video.textTracks && this.video.textTracks.length > 0) {
        this.setupTextTracks();
      } else if (this.video.textTracks) {
        this.boundTrackAdded = () => {
          if (!ensureExtensionContext() || this.destroyed) return;
          this.setupTextTracks();
        };
        this.video.textTracks.onaddtrack = this.boundTrackAdded;
      }

      // 2. On YouTube, auto-activate captions module if available
      const ytPlayer = document.getElementById("movie_player");
      if (ytPlayer && typeof ytPlayer.getOption === "function") {
        try {
          ytPlayer.loadModule?.("captions");
          const cur = ytPlayer.getOption("captions", "track");
          if (!cur || !cur.languageCode) {
            const list = ytPlayer.getOption("captions", "tracklist");
            if (list && list.length > 0) {
              const def = list.find((t) => t.is_default) || list[0];
              ytPlayer.setOption("captions", "track", def);
              ytPlayer.setOption("captions", "reload", true);
            }
          }
        } catch {}
      }

      // 3. Setup DOM Observers for custom players (YouTube, Udemy, Coursera, Video.js)
      this.setupDomCaptionObserver();
    }

    getAvailableTracks() {
      const list = [];
      if (!this.video.textTracks) return list;
      for (let i = 0; i < this.video.textTracks.length; i++) {
        const t = this.video.textTracks[i];
        if (t.kind === "subtitles" || t.kind === "captions") {
          list.push({
            index: i,
            label: t.label,
            language: t.language,
            selected: t === this.activeTrack || t.mode === "showing" || t.mode === "hidden",
          });
        }
      }
      return list;
    }

    setupTextTracks() {
      const tracks = this.video.textTracks;
      let chosen = null;

      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t.kind === "subtitles" || t.kind === "captions") {
          if (t.mode === "showing") {
            chosen = t;
            break;
          }
          if (!chosen) chosen = t;
        }
      }

      if (chosen) {
        this.attachTrack(chosen);
      }
    }

    selectTrackByIndex(idx) {
      if (!this.video.textTracks || !this.video.textTracks[idx]) return;
      this.attachTrack(this.video.textTracks[idx]);
    }

    attachTrack(track) {
      if (this.activeTrack && this.activeTrack !== track) {
        this.activeTrack.removeEventListener("cuechange", this.boundCueChange);
      }
      this.activeTrack = track;
      if (cfg.videoSubEnabled) {
        track.mode = "hidden";
      } else if (track.mode === "disabled") {
        track.mode = "hidden";
      }
      track.addEventListener("cuechange", this.boundCueChange);
      this.renderMenu();

      // Ensure track elements finish loading
      const trackEls = this.video.querySelectorAll("track");
      trackEls.forEach((el) => {
        if (el.track === track) {
          el.addEventListener("load", () => {
            if (cfg.videoSubEnabled) track.mode = "hidden";
            this.onNativeCueChange();
          });
        }
      });
      this.onNativeCueChange();
    }

    // ── Sticky Subtitle Persistence ─────────────────────────────────────────
    cancelStickyClear() {
      if (this.stickyClearTimer) {
        clearTimeout(this.stickyClearTimer);
        this.stickyClearTimer = null;
      }
    }

    scheduleStickyClear(delay = 6000) {
      if (this.video.paused) return; // NEVER clear while paused!
      if (this.stickyClearTimer) return;
      this.stickyClearTimer = setTimeout(() => {
        if (!ensureExtensionContext() || this.destroyed) return;
        if (!this.video.paused) {
          this.handleCueClear();
        }
        this.stickyClearTimer = null;
      }, delay);
    }

    onNativeCueChange() {
      if (!ensureExtensionContext() || this.destroyed) return;
      if (!this.activeTrack) return;
      const cues = this.activeTrack.activeCues;
      if (cues && cues.length > 0) {
        const raw = Array.from(cues).map((c) => c.text).join(" ");
        const cleaned = cleanCueText(raw);
        if (cleaned) {
          this.cancelStickyClear();
          this.handleNewCue(cleaned);
          return;
        }
      }
      this.onTimeUpdate();
    }

    onTimeUpdate() {
      if (!ensureExtensionContext() || this.destroyed) return;
      let activeText = "";

      // 1. External loaded cues (.srt / .vtt)
      if (this.externalCues && this.externalCues.length > 0) {
        const t = this.video.currentTime;
        const cue = this.externalCues.find((c) => t >= c.start && t <= c.end);
        if (cue) activeText = cue.text;
      } else if (this.activeTrack) {
        // 2. HTML5 TextTrack activeCues & cues list fallback
        const activeCues = this.activeTrack.activeCues;
        if (activeCues && activeCues.length > 0) {
          activeText = Array.from(activeCues).map((c) => c.text).join(" ");
        } else if (this.activeTrack.cues && this.activeTrack.cues.length > 0) {
          const t = this.video.currentTime;
          const cue = Array.from(this.activeTrack.cues).find((c) => t >= c.startTime && t <= c.endTime);
          if (cue) activeText = cue.text;
        }
      }

      const cleaned = cleanCueText(activeText);
      if (cleaned) {
        this.cancelStickyClear();
        this.handleNewCue(cleaned);
      } else {
        // Sticky subtitle: Keep current sentence visible on screen for 6s of silence!
        // Never flash or disappear in conversational gaps between speech.
        if (this.currentCueText && !this.video.paused) {
          this.scheduleStickyClear(6000);
        }
      }
    }

    setupDomCaptionObserver() {
      const captionSelectors = [
        ".ytp-caption-window-container", // YouTube
        ".vjs-text-track-display", // Udemy / Video.js
        ".rc-SubtitleCues", // Coursera
        ".c-video-control-caption", // Coursera
        ".player-timedtext", // Netflix / Generic
        ".plyr__captions", // Plyr
        ".jw-text-track-cue", // JW Player
        '[class*="caption-window"]',
        '[class*="subtitle-cue"]',
      ];

      const findContainer = () => {
        for (const sel of captionSelectors) {
          const el = (this.container || document).querySelector(sel);
          if (el) return el;
        }
        return null;
      };

      const observeContainer = (container) => {
        if (!container) return;
        if (this.domObserver) this.domObserver.disconnect();

        const processBuffer = () => {
          if (!ensureExtensionContext() || this.destroyed) return;
          // Extract text from visual lines (YouTube & custom players)
          // Query ONLY top-level visual lines to avoid duplicating text from child segments!
          let collected = [];
          const visualLines = container.querySelectorAll(".caption-visual-line");
          if (visualLines && visualLines.length > 0) {
            visualLines.forEach((line) => {
              const t = cleanCueText(line.textContent || "");
              if (t && !collected.includes(t)) {
                collected.push(t);
              }
            });
          } else {
            const segments = container.querySelectorAll(".ytp-caption-segment, [class*='subtitle-cue'], .vjs-text-track-cue");
            if (segments && segments.length > 0) {
              segments.forEach((seg) => {
                const t = cleanCueText(seg.textContent || "");
                if (t && !collected.includes(t)) {
                  collected.push(t);
                }
              });
            }
          }
          const raw = collected.length > 0 ? collected.join(" ") : (container.innerText || container.textContent || "");
          const text = cleanCueText(raw);

          if (!text) {
            if (this.currentCueText && !this.video.paused) {
              this.scheduleStickyClear(6000);
            }
            return;
          }

          if (text === this.currentCueText) return;

          // ZERO-LATENCY REAL-TIME AUDIO SYNCHRONIZATION:
          // Immediately display to match the speaker's audio with 0ms delay!
          this.handleNewCue(text);
        };

        this.domObserver = new MutationObserver(() => {
          if (!ensureExtensionContext() || this.destroyed) return;
          clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => {
            if (!ensureExtensionContext() || this.destroyed) return;
            processBuffer();
          }, 35); // 35ms micro-batching for instant audio-subtitle synchronization!
        });

        this.domObserver.observe(container, {
          childList: true,
          subtree: true,
          characterData: true,
        });

        container.classList.add("vimi-hide-native");
      };

      const target = findContainer();
      if (target) {
        observeContainer(target);
      } else {
        this.parentObserver?.disconnect();
        this.parentObserver = new MutationObserver(() => {
          if (!ensureExtensionContext() || this.destroyed) return;
          const found = findContainer();
          if (found) {
            this.parentObserver?.disconnect();
            this.parentObserver = null;
            observeContainer(found);
          }
        });
        this.parentObserver.observe(this.container || document.body, {
          childList: true,
          subtree: true,
        });
      }
    }

    // ── Cue Display & Full Sentence Rendering ───────────────────────────────
    async handleNewCue(text) {
      if (!ensureExtensionContext() || this.destroyed) return;
      if (!text || text === this.currentCueText) return;
      this.cancelStickyClear();
      this.currentCueText = text;

      if (!cfg.videoSubEnabled) return;

      // 1. INSTANT ZERO-LATENCY RENDERING:
      // Show original text immediately so it synchronizes 100% with the audio!
      const cached = cueCache.get(`${cfg.src}:${cfg.tgt}:${text}`);
      this.renderFullSentence(text, cached || this.currentTranslatedText || "");

      if (cached) {
        this.currentTranslatedText = cached;
        return;
      }

      // 2. DEBOUNCE TRANSLATION:
      // Debounce translation by 200ms so we translate full clauses without thrashing the API
      clearTimeout(this.translateDebounceTimer);
      this.translateDebounceTimer = setTimeout(async () => {
        const trans = await translateCue(text);
        if (!ensureExtensionContext() || this.destroyed) return;
        if (this.currentCueText === text) {
          this.currentTranslatedText = trans;
          const transEl = this.overlay.querySelector(".vimi-sub-trans");
          if (transEl && cfg.videoSubLayout !== "origOnly") {
            transEl.textContent = trans;
          }
        }
      }, 200);
    }

    handleCueClear() {
      this.cancelStickyClear();
      clearTimeout(this.translateDebounceTimer);
      this.currentCueText = "";
      this.currentTranslatedText = "";
      this.overlay.classList.add("vimi-sub-hidden");
    }

    renderFullSentence(origText, transText) {
      if (!this.overlay) return;
      this.overlay.classList.remove("vimi-sub-hidden");

      const origEl = this.overlay.querySelector(".vimi-sub-orig");
      const transEl = this.overlay.querySelector(".vimi-sub-trans");

      if (cfg.videoSubLayout === "transOnly") {
        if (origEl) origEl.style.display = "none";
        if (transEl) {
          transEl.style.display = "block";
          transEl.textContent = transText || origText;
        }
        return;
      }

      if (cfg.videoSubLayout === "origOnly") {
        if (transEl) transEl.style.display = "none";
        if (origEl) {
          origEl.style.display = "block";
          this.renderWordTokens(origEl, origText);
        }
        return;
      }

      // Bilingual mode: full original sentence on top, full translated sentence below
      if (origEl) {
        origEl.style.display = "block";
        this.renderWordTokens(origEl, origText);
      }
      if (transEl) {
        transEl.style.display = "block";
        transEl.textContent = transText;
      }
    }

    renderWordTokens(container, text) {
      if (container.dataset.renderedText === text) return;
      if (this.activeWord instanceof Node && container.contains(this.activeWord)) {
        if (this.translationCard) TranslationCard.close(this.translationCard);
        else this.clearActiveWord();
      }
      container.dataset.renderedText = text;
      container.innerHTML = "";

      const clean = (str) => (str || "").toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      const tokens = text.split(/([\s,.;:!?()[\]'"]+)/);
      let i = 0;

      while (i < tokens.length) {
        const token = tokens[i];
        if (!token) {
          i++;
          continue;
        }

        if (!HAS_LETTER.test(token)) {
          container.appendChild(document.createTextNode(token));
          i++;
          continue;
        }

        const w1 = clean(token);

        // Multi-word phrase matching (greedy longest match: 5 down to 2 words)
        let matched = false;
        const maxL = Math.min(5, Math.floor((tokens.length - i + 1) / 2));

        for (let L = maxL; L >= 2; L--) {
          const spanLen = 2 * L - 1;
          if (i + spanLen > tokens.length) continue;

          let valid = true;
          const wordList = [];
          for (let k = 0; k < L; k++) {
            const wIdx = i + 2 * k;
            if (!HAS_LETTER.test(tokens[wIdx])) {
              valid = false;
              break;
            }
            wordList.push(clean(tokens[wIdx]));
            if (k < L - 1) {
              const sIdx = i + 2 * k + 1;
              if (!/^[\s-]+$/.test(tokens[sIdx])) {
                valid = false;
                break;
              }
            }
          }

          if (!valid) continue;

          const exact = wordList.join(" ");
          const firstLemma = VERB_LEMMAS[wordList[0]] || wordList[0];
          const vLemma = [firstLemma, ...wordList.slice(1)].join(" ");
          const lastUnplural = unpluralize(wordList[wordList.length - 1]);
          const nUnplural = [...wordList.slice(0, -1), lastUnplural].join(" ");
          const bothLemma = [firstLemma, ...wordList.slice(1, -1), lastUnplural].join(" ");

          const match = findPhraseMatch(exact, vLemma, nUnplural, bothLemma);
          if (match) {
            const phraseDisplay = tokens.slice(i, i + spanLen).join("");
            const phraseSpan = document.createElement("span");
            phraseSpan.className = "vimi-sub-phrase";
            phraseSpan.dataset.phrase = match.key;
            phraseSpan.dataset.phraseType = match.type;
            phraseSpan.textContent = phraseDisplay;
            phraseSpan.title = `${match.type}: "${phraseDisplay}" (Click to translate)`;

            if (cfg.videoSubHighlightVocab && (match.isSaved || savedVocabSet.has(match.key) || savedVocabSet.has(phraseDisplay.toLowerCase()))) {
              phraseSpan.classList.add("vimi-sub-saved");
              phraseSpan.title = `Saved in your Vimi vocabulary: "${phraseDisplay}"`;
            }

            phraseSpan.addEventListener("click", (e) => {
              e.stopPropagation();
              if (this.justHighlightedPhrase) return;
              const sel = window.getSelection();
              if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
              this.lastClickedWordSpan = phraseSpan;
              this.handleWordClick(phraseDisplay, text, phraseSpan, match.type);
            });

            container.appendChild(phraseSpan);
            i += spanLen;
            matched = true;
            break;
          }
        }

        if (matched) continue;

        // Single word token
        const span = document.createElement("span");
        span.className = "vimi-sub-word";
        span.textContent = token;
        span.dataset.word = w1;

        if (cfg.videoSubHighlightVocab && savedVocabSet.has(w1)) {
          span.classList.add("vimi-sub-saved");
          span.title = "Saved in your Vimi vocabulary";
        }

        span.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.justHighlightedPhrase) return;
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

          // Shift-click range selection
          if (e.shiftKey && this.lastClickedWordSpan && this.lastClickedWordSpan !== span && this.lastClickedWordSpan.parentNode === container) {
            const allSpans = Array.from(container.querySelectorAll(".vimi-sub-word, .vimi-sub-phrase"));
            const idx1 = allSpans.indexOf(this.lastClickedWordSpan);
            const idx2 = allSpans.indexOf(span);
            if (idx1 !== -1 && idx2 !== -1) {
              const start = Math.min(idx1, idx2);
              const end = Math.max(idx1, idx2);
              const selectedTokens = allSpans.slice(start, end + 1);
              const phraseStr = selectedTokens.map((s) => s.textContent).join(" ").trim();
              const rect1 = selectedTokens[0].getBoundingClientRect();
              const rect2 = selectedTokens[selectedTokens.length - 1].getBoundingClientRect();
              const combinedRect = {
                left: Math.min(rect1.left, rect2.left),
                right: Math.max(rect1.right, rect2.right),
                top: Math.min(rect1.top, rect2.top),
                bottom: Math.max(rect1.bottom, rect2.bottom),
                width: Math.abs(rect2.right - rect1.left),
                height: Math.max(rect1.height, rect2.height),
              };

              this.handleWordClick(phraseStr, text, {
                getBoundingClientRect: () => combinedRect,
                isPhrase: true,
              });
              return;
            }
          }

          this.lastClickedWordSpan = span;
          this.handleWordClick(w1, text, span);
        });

        container.appendChild(span);
        i++;
      }
    }

    renderCueDisplay() {
      if (!cfg.videoSubEnabled || !this.currentCueText) {
        this.overlay.classList.add("vimi-sub-hidden");
        return;
      }
      this.renderFullSentence(this.currentCueText, this.currentTranslatedText);
    }

    highlightSavedWords() {
      if (!this.overlay) return;
      this.overlay.querySelectorAll(".vimi-sub-word, .vimi-sub-phrase").forEach((el) => {
        const key = el.dataset.phrase || el.dataset.word;
        if (key && (savedVocabSet.has(key) || savedVocabSet.has(el.textContent.trim().toLowerCase()))) {
          el.classList.add("vimi-sub-saved");
          el.title = `Saved in your Vimi vocabulary: "${el.textContent.trim()}"`;
        }
      });
    }

    async handleWordClick(term, context, targetSpan, explicitType) {
      if (!ensureExtensionContext() || this.destroyed) return;
      if (!term) return;
      this.lockTranslationPause();
      const rect = targetSpan.getBoundingClientRect();
      const isPhrase = term.includes(" ") || term.includes("-") || Boolean(targetSpan?.isPhrase);
      let typeBadge = explicitType || targetSpan?.dataset?.phraseType || targetSpan?.phraseType;
      if (!typeBadge && isPhrase) typeBadge = getPhraseType(term);
      let card = null;
      this.replacingTranslationCard = true;
      try {
        card = TranslationCard.show({
          sourceText: term,
          sourceLanguage: cfg.src,
          targetLanguage: cfg.tgt,
          context,
          badgeText: typeBadge || (isPhrase ? "Phrase" : ""),
          url: window.location.href,
          anchorRect: rect,
          align: "center",
          mountRoot: document.fullscreenElement || document.body,
          translate: translateCue,
          closeAfterSave: false,
          ensureContext: ensureExtensionContext,
          shouldIgnoreOutsidePointer: (event) =>
            !!event.target.closest?.(".vimi-sub-word, .vimi-sub-phrase") && this.overlay.contains(event.target),
          onSaved: () => {
            savedVocabSet.add(term.toLowerCase());
            targetSpan.classList?.add("vimi-sub-saved");
            this.highlightSavedWords();
          },
          onClose: (reason) => {
            if (this.translationCard === card) this.translationCard = null;
            this.clearActiveWord(targetSpan);
            if (this.replacingTranslationCard) return;
            this.releaseTranslationPause({
              resume: reason === "close-button" || reason === "destroy",
            });
          },
        });
      } catch (error) {
        this.releaseTranslationPause({ resume: true });
        handleExtensionApiError("translation popup open", error);
        return;
      } finally {
        this.replacingTranslationCard = false;
      }
      this.translationCard = card;
      this.setActiveWord(targetSpan);
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      const shouldResumeHoverPause = this.hoverPausedByExtension;
      this.hoverPausedByExtension = false;
      clearTimeout(this.debounceTimer);
      clearTimeout(this.translateDebounceTimer);
      if (this.translationCard) TranslationCard.close(this.translationCard, "destroy");
      else this.releaseTranslationPause({ resume: true });
      if (shouldResumeHoverPause && this.video.paused && !this.video.ended) {
        this.video.play().catch(() => {});
      }
      this.clearActiveWord();
      this.cancelStickyClear();
      if (this.cleanupBadgeDrag) this.cleanupBadgeDrag(true);
      if (this.cleanupOverlayDrag) this.cleanupOverlayDrag(true);
      if (this.cleanupPhraseHighlight) this.cleanupPhraseHighlight();
      if (this.boundResize) window.removeEventListener("resize", this.boundResize);
      if (this.boundDocumentClick) document.removeEventListener("click", this.boundDocumentClick);
      if (this.boundFullscreenChange) {
        document.removeEventListener("fullscreenchange", this.boundFullscreenChange);
        document.removeEventListener("webkitfullscreenchange", this.boundFullscreenChange);
      }
      if (this.domObserver) this.domObserver.disconnect();
      if (this.parentObserver) this.parentObserver.disconnect();
      if (this.activeTrack) {
        this.activeTrack.removeEventListener("cuechange", this.boundCueChange);
      }
      this.video.removeEventListener("timeupdate", this.boundTimeUpdate);
      this.video.removeEventListener("seeked", this.boundTimeUpdate);
      this.video.removeEventListener("pause", this.boundPause);
      this.video.removeEventListener("play", this.boundPlay);
      this.video.removeEventListener("ended", this.boundEnded);
      this.container.removeEventListener("click", this.boundPlayerInteraction, true);
      if (this.boundDragOver) this.container.removeEventListener("dragover", this.boundDragOver);
      if (this.boundDrop) this.container.removeEventListener("drop", this.boundDrop);
      if (this.video.textTracks && this.video.textTracks.onaddtrack === this.boundTrackAdded) {
        this.video.textTracks.onaddtrack = null;
      }
      this.overlay?.remove();
      this.badge?.remove();
      this.menu?.remove();
      this.fileInput?.remove();
    }
  }

  // ── Global Video Scanner & Lifecycle Manager ─────────────────────────────
  function isEligibleVideo(v) {
    if (!v) return false;
    // Check if video is visible and not an audio-only / tracking pixel
    const rect = v.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 120 && rect.height > 0 && rect.height < 80) return false;
    return true;
  }

  function registerVideo(video) {
    if (!ensureExtensionContext()) return;
    if (activeControllers.has(video)) return;
    if (!isEligibleVideo(video)) return;

    try {
      const ctrl = new VideoController(video);
      activeControllers.set(video, ctrl);
    } catch (err) {
      console.warn("[Vimi] Failed to attach video subtitles controller:", err);
    }
  }

  function scanVideos() {
    if (!ensureExtensionContext()) return;
    document.querySelectorAll("video").forEach(registerVideo);
  }

  // Watch for newly mounted videos (e.g. SPAs, course lectures, dynamic video players)
  videoObserver = new MutationObserver((mutations) => {
    if (!ensureExtensionContext()) return;
    let shouldScan = false;
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length > 0) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) {
            if (n.tagName === "VIDEO" || n.querySelector?.("video")) {
              shouldScan = true;
              break;
            }
          }
        }
      }
      if (m.removedNodes && m.removedNodes.length > 0) {
        for (const n of m.removedNodes) {
          if (n.nodeType === 1) {
            if (n.tagName === "VIDEO" && activeControllers.has(n)) {
              activeControllers.get(n).destroy();
              activeControllers.delete(n);
            } else if (n.querySelectorAll) {
              n.querySelectorAll("video").forEach((v) => {
                if (activeControllers.has(v)) {
                  activeControllers.get(v).destroy();
                  activeControllers.delete(v);
                }
              });
            }
          }
        }
      }
    }
    if (shouldScan) scanVideos();
  });

  if (ensureExtensionContext()) {
    videoObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Initial scan
  if (document.readyState === "loading") {
    domReadyHandler = () => {
      domReadyHandler = null;
      scanVideos();
    };
    document.addEventListener("DOMContentLoaded", domReadyHandler);
  } else {
    scanVideos();
  }
})();
