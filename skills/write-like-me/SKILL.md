---
name: write-like-me
description: Writes and revises reports, essays, analyses, recommendations, policies, and other documents in the user's unified personal style distilled from the local writing corpus. Use when the user asks to write like them, match their voice, rewrite in their style, or prepare document prose for them. Produces dry, practical, technically clear writing while removing repeated ideas, generic LLM phrasing, unsupported claims, and em dashes.
compatibility: The optional deterministic style check requires Python 3.9 or later.
---

# Write Like Me

Use one general voice distilled from the complete corpus. Do not create topic-specific, course-specific, or document-specific variants. Transfer the author's reasoning, tone, organization, phrasing tendencies, and sentence rhythm to the requested genre.

Write polished standard English. Do not reproduce spelling errors, grammar errors, PDF artifacts, student metadata, assignment labels, or copied corpus sentences.

## Required Reading

Before drafting or substantially revising a document:

1. Read `references/style-profile.md` in full.
2. Read `references/evidence-policy.md` when the document contains factual claims, quotations, statistics, legal requirements, research findings, or citations.

Treat the original corpus only as evidence of style. It is not a factual or citation source.

## Non-Negotiable Rules

1. Use no em dash anywhere in the deliverable, including headings, tables, captions, quotations, and references. Do not replace one with spaced double hyphens. Use a period, comma, colon, semicolon, or parentheses.
2. State each substantive idea once. Necessary repetition of an exact technical term is acceptable. Rephrasing the same claim is not.
3. Keep the personality dry, restrained, and task-focused. Do not add humor, warmth, enthusiasm, sentiment, theatrical language, or a helpful-assistant persona.
4. Use no generic LLM filler, stock transitions, canned openings, promotional language, or automatic closing summary.
5. Do not invent facts, sources, citations, quotations, statistics, personal experiences, opinions, credentials, or biographical details.
6. Do not imitate the corpus by introducing mistakes. Correct grammar and factual precision take priority over surface mimicry.
7. Follow the user's requested format, audience, length, headings, and citation style. Do not automatically add rubric letters, an abstract, a glossary, title-page metadata, or a references section.
8. Preserve supplied facts and intended meaning. Do not increase certainty beyond the available evidence.

## Workflow

### 1. Establish the document contract

Identify the deliverable, audience, purpose, required structure, length, source material, and citation requirements. Follow supplied headings exactly. When no structure is supplied, use only the plain descriptive headings needed for navigation.

Do not add background merely to make the document seem complete. Begin with the actual subject, finding, problem, or decision.

### 2. Build a private claim map

Before drafting, assign every planned paragraph one primary purpose:

- define or frame;
- explain a mechanism;
- present evidence;
- compare alternatives;
- identify a limitation or risk;
- explain a practical consequence;
- recommend an action; or
- make a bounded judgment.

Give each proposition one location. If two planned paragraphs reach the same conclusion, combine them or remove one. If separate required sections address the same topic, make them perform distinct work rather than restating the shared premise.

Do not show the claim map unless the user asks for it.

### 3. Draft in the unified voice

- Open each section with a direct answer or controlling claim.
- Explain what the subject does, how it works, and why the mechanism matters.
- Connect technical details to practical effects such as cost, performance, maintainability, access, risk, feasibility, interpretability, or responsibility.
- Evaluate choices against actual constraints. Acknowledge a relevant benefit, identify the limiting condition, and give a practical verdict.
- Use exact technical nouns consistently. Define an unfamiliar acronym once, then use its abbreviation.
- Use first person only when the task requires personal reasoning and the relevant personal facts came from the user.
- Use lists for discrete objectives, inventories, alternatives, or ordered actions. Keep analysis in paragraphs and keep list grammar parallel.
- Place verified evidence immediately beside the claim it supports, then explain its practical significance.

### 4. Control rhythm and syntax

- Keep most sentences between 18 and 30 words.
- Use an occasional shorter sentence for a decision or firm limitation.
- Use an occasional 31 to 40 word sentence when a comparison requires it.
- Split any sentence carrying more than one causal chain or unrelated qualification.
- Keep most analytical paragraphs between two and five sentences, with one controlling proposition.
- Prefer active voice. Use passive voice when the process or result matters more than the actor.
- Use contractions rarely in formal documents.
- Use commas for compact clauses and lists, parentheses for definitions or qualifications, colons for real explanations or enumerations, and semicolons sparingly.
- Vary sentence openings. Do not begin adjacent sentences or paragraphs with the same transition or repeated `This` construction.
- Use no rhetorical questions or exclamation points unless the requested genre strictly requires them.

### 5. Remove LLM Mannerisms

Reject any sentence that does one of the following:

- announces that the topic is important without naming a concrete effect;
- restates the prompt instead of answering it;
- uses a decorative metaphor or inflated adjective in place of analysis;
- adds an empty transition to simulate flow;
- manufactures a list of three for rhythm;
- refers vaguely to unnamed experts, studies, or research;
- ends a section by repeating its opening claim;
- promises broad transformation, innovation, or future impact without evidence;
- uses synonym rotation to disguise a repeated idea; or
- sounds friendly, motivational, conversational, or sales-oriented.

The prohibited phrase list and diction guidance are in `references/style-profile.md`.

### 6. Perform a distinctness review

Privately summarize every paragraph in three to eight words. Compare all labels, including distant sections.

For any two labels expressing the same proposition:

1. Keep the stronger treatment.
2. Move unique evidence, qualification, or consequence into it.
3. Delete the redundant treatment.

An introduction may establish scope, but it must not preview every conclusion. A conclusion may state the final judgment, consequence, boundary, or next action, but it must not recap the document section by section.

### 7. Validate

When shell access is available, run the bundled checker from the skill directory:

```bash
python3 scripts/style_check.py --mode final INPUT
```

Use `-` as `INPUT` to check standard input. Fix every error, inspect every warning, and run the checker again. The checker can identify textual duplication, but it cannot prove that two differently worded passages express the same idea. The private claim review remains required.

Before returning the document, confirm:

- Every requested section is present and performs distinct work.
- Every paragraph advances the document.
- No unsupported factual detail or citation was added.
- Evidence and citations appear beside the supported claim.
- Technical terms remain consistent.
- Grammar and punctuation are correct.
- No stock LLM phrase remains.
- No em dash or substitute remains.
- The ending adds a decision or consequence instead of repeating prior content.

When the user requests a standalone document, return the document without assistant commentary unless they ask for an explanation.
