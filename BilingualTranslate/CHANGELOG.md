# Vimi Bilingual — Changelog

## v2.1.5

### Improved — Extension popup
- Split the popup into Translate and Progress tabs while keeping translation
  settings intact when switching between them.
- Refined the popup layout, scrolling, language controls, and model status text.
- Moved the local file translation link into a persistent footer.

## v2.1.4

### Improved — Translation model fallback
- Simplified the model action to download locally first, then offer cloud
  translation only when the local model is unavailable or fails to download.
- Apply cloud fallback consistently to page translation, selected text, and
  bilingual video subtitles.
- Avoid repeatedly creating a failed local translator for the same language
  pair, while allowing users to retry the download after changing languages.
- Normalize Traditional Chinese language codes for the on-device API and show
  clearer model download errors.

## v2.1.3

### Improved — Language model controls
- Show whether the selected translation model is ready, needs downloading, or
  is unavailable directly in the extension popup.
- Keep dropdown changes pending until **Apply & refresh** is clicked, preventing
  the page, selection popup, and video subtitles from using different pairs.
- Clearly mark language changes that have not yet been applied.

### New — Quick language access
- Added a language button beside the pair in translation-card headers. It opens
  the extension popup so the translation languages can be changed quickly.

### Fixed — Runtime stability
- Refresh cached translators safely when the active language pair changes.
- Prevent stale translation results from an earlier language pair appearing.
- Avoid an early mascot lifecycle error while page elements are still loading.

## v2.1.2

### Improved — Selection translation
- Refined the translation popup with a clearer source/translation hierarchy,
  language direction, and Copy action.
- Long selections (over 60 characters) now open a compact, draggable dialog
  with independently scrollable source and translated text.
- Preserve meaningful line and paragraph breaks in long translations, with
  fixed spacing around the divider while scrolling.
- Keep Save for short vocabulary selections; long translations offer TTS and
  Copy without a Save action.

### Fixed — Speech playback
- Stop text-to-speech when a translation popup or dialog closes, including
  Close, outside click, and replacement by another translation.

## v2.1.1

### New — Local Document Translation with Doc2Notion
- Added companion web tool recommendation for translating local desktop files:
  **Doc2Notion** (https://doc2-notion.vercel.app/). Read and translate local PDFs,
  Word (.docx), Excel (.xlsx/.csv), and Markdown documents bilingually with full
  Notion-style reading canvas and bilingual export support.
- Compatibility improvements for custom reader canvases (`data-bt-translatable`).

## v2.1.0

Turns everyday browsing into review and makes your data portable. Still
**100% on-device** — no account, no server, no tracking.

### New — Reading aids (Settings → General → Reading aids)
- **Highlight saved words**: when you meet a word you've already saved on any
  page, Vimi underlines it — hover to see its meaning and context.
- **Sprinkle translations**: optionally swaps a few of your saved words on a
  page for their translation (Toucan-style passive learning); click a word to
  flip it back to the original. Capped per page so reading stays readable.
- **Reveal-on-hover mode**: blurs in-page translations until you hover the
  original, so you read the source first and only peek when stuck.

### New — Learn deeper
- **Fill-in-the-blank (cloze) tests**: a new question type that blanks the word
  out of the real sentence you saved it from, with the meaning as a hint. Pick
  it under Reminders & Tests → Question type, or get it in “Mixed”.
- **Notes / examples on words**: add your own example, collocation or mnemonic
  when saving a word; it shows under the word and travels with exports.

### New — Backup & data portability
- **Full backup & restore**: one file with everything — words, decks, streak,
  settings and history — to keep safe or move to another computer
  (Settings → General → Backup & restore).
- **CSV export / import**: Anki-friendly CSV alongside the existing JSON, so
  your vocabulary moves freely in and out of Vimi.

### New — Quick controls
- **Show/hide Vimi from the popup**: a mascot toggle right in the toolbar panel
  — open tabs show or hide her instantly, no reload.
- The in-page status badge (language pair / download progress) is now larger and
  **auto-hides after a few seconds** so it never covers a page's own controls.

### New — Onboarding
- A first-run welcome page explains on-device translation, checks browser
  compatibility, lets you pick your languages, and shows how to start.

## v2.0.1

A major upgrade that turns Vimi from a translator into a full language-learning
companion. Everything runs **100% on your device** (Chrome's built-in Translator)
— no account, no server, no tracking.

### New — Reading & appearance
- **Custom translation color**: pick the color of in-page translations in
  Settings → General → Appearance (with a Reset to default). Applies live to
  open tabs.
- **Auto-translate site list**: Settings → General now lists every site set to
  translate automatically; remove one (or disable all) to stop — open tabs turn
  off immediately.

### Fixed — Translation accuracy & layout
- **Tables no longer break**: a translation inside a table cell or list item is
  now placed *inside* it instead of becoming a stray cell/item that shoved the
  real cells sideways.
- **Buttons, links & icons**: button bars, nav/link clusters and cookie banners
  are no longer translated as one garbled blob, and icon-font glyphs / emoji are
  stripped before translating so they don't leak stray characters into the output.
- **Hidden content is skipped**: hover tooltips and collapsed menus (laid out but
  invisible) are no longer translated, so injected text can't pop in and break the
  layout on hover.
- **Vimi's quick menu** relabels its translate action to “Show original page”
  while a page is translated.

### New — Vocabulary learning
- **Highlight to save**: select any word/phrase on a page to save it with its
  meaning, the sentence it came from, and one-click pronunciation.
- **Add words manually** from the Vocabulary tab (auto-translates if you leave
  the meaning blank).
- **Spaced-repetition review (SM-2)** schedules each word for the right day.
- **Scheduled tests**: pick frequency, weekday, question count (10/20/30) and
  type (multiple-choice / typing / mixed). Tests wait until you take them.
- **Daily reminder** + toolbar badge showing how many words are due.

### New — Flashcard decks
- Tick words in the Vocabulary tab to **create named decks**; rename/delete them.
- **Study a deck** anytime — free navigation, repeat as much as you like.

### New — Dashboard
- **🔥 Streak** (current + best), due count, totals, mastered.
- **Today's goal** progress and **vocabulary breakdown** (new / learning / mastered).
- **14-day activity** chart and a **GitHub-style yearly heatmap** with month and
  weekday labels; hover a cell for the date, words learned and reviews.

### New — Vimi mascot
- A cute chibi companion that wanders the page, chats, and pops up vocabulary
  reminders; poke her for reactions. Drag to move; toggle off in Settings.

### Improved — Review experience
- Flip the card back and forth, go **Prev/Next**, loop, and **shuffle** — study
  the same set repeatedly in one sitting.
- **Read the whole context sentence** aloud, not just the word.
- Each grade shows the **next review interval**.
- Fixed-height card (no more size jumps when flipping).

### Improved — Interface
- Rebuilt entirely with **TailwindCSS** and a consistent design system.
- **Light / Dark / System** theme and an adjustable **text size**.
- Full-width, tabbed **Settings** page; keyboard focus rings for accessibility.

### Privacy
- On-device translation and review. Page content and saved words never leave
  your computer.
