# How AI was used in this data layer

This file is part of the submission. It says what the AI did, what people decided, and what was and was not checked.

## The short version

The non-temperature data layer and the combined similarity score of Analog Atlas were designed through a structured, three-round interview between the data owner on the team (Stuart) and Claude, an AI model made by Anthropic. The result of that interview is `BUILD_PROMPT.md` in this folder, which is the primary record. Claude then wrote the code, ran the downloads, drafted the curated tables and site texts, and produced the documents. People made the decisions listed below and checked the items listed below.

Models: the first session ran on Claude Fable 5.1 and finished on Claude Sonnet 5.5 after the data owner switched models to stay inside a usage limit. Both worked inside Claude Code, which ran every command on the data owner's laptop.

## What the AI did

- Wrote every script in `pipeline/` and the browser scorer in `js/` (about 3,000 lines), ran them, read the errors, and fixed them.
- Found download addresses on the data providers' own pages, tried mirrors when hosts failed, and switched to a documented fallback when a source could not be reached. Every such substitution is in `METHODS.md` section 7 and `work/log.md`.
- Drafted the curated tables from its own general knowledge: about 70 analog sites, 51 caves, 76 impact structures, 60 Moon and Mars targets and the three Irish sites, including their short descriptions.
- Wrote the plain-English "losses" sentences, the cannot-match caveats and the documents.

## What people decided (not the AI)

- **Scope and design** (`BUILD_PROMPT.md` section 1.4): both search directions; a 1-degree Earth ranking grid plus curated named sites; the Moon and Mars demo targets; Ireland as a first-class case with Athlone, Clonmacnoise and the Burren; honest framing that Athlone scores poorly; operations as an eighth dimension; the four presets.
- **The presets' weights** (`BUILD_PROMPT.md` section 6.3) and the rule that gravity, vacuum or thin air, radiation and the lunar night are never scored.
- **Which sources to try first**, and the rule to take a documented fallback after twenty minutes rather than lose the demo.
- Decisions made by the team about the globe and temperature grids are theirs and are recorded in their own branches.

## What was checked, and how

| Item | Check | Result |
|---|---|---|
| Coordinates of every curated site, cave, structure and target | Compared with the coordinates on each item's Wikipedia page (`pipeline/41_verify_coords.py`, `work/coord_check.csv`, `validation.md` section 7) | Most within 25 km. The rest are regions, mission areas or pits where the page gives a centre. Two real errors were found and fixed (a wrong latitude for Mistastin, a Galapagos entry that matched a California island). |
| Scorer correctness | The browser scorer (`js/score.js`) and the Python scorer were run on ten place-and-target pairs and compared | Agree to better than 1e-7 (`validation.md` section 6) |
| Data plausibility | Values at places whose answers are known (Apollo 16 and 17, Jezero, Gale, Olympus Mons, Hellas, Athlone, Death Valley, the Atacama, the Antarctic dry valleys) were printed and read by Claude | Plausible; problems found this way were fixed (see below) |
| Whether the classic analogs rank well | A table of twelve classic analog-versus-target pairs (`validation.md` section 3) | Reported honestly, including the pairs where they do not rank near the top |
| File structure | 16,200 rows, every cell once, no NaN text, every source listed, team checker on the temperature files | Automated, passes |

Problems that checking found and that were fixed: a thermal-inertia file that was actually an interpolation mask; Mars polar water that had been stretched from the equatorial values; lunar "pits" that were mostly impact-melt features, not lava tubes; island sites with no data; and a score that could be built from a single comparison.

## What was not checked

- **Descriptions, diameters, ages, lengths and programme details in the curated tables** were written by the AI and have not been verified by a person against the sources. AI-drafted text can contain errors. The demo items and everything within 300 km of Ireland had their coordinates checked and should be read by a person before the presentation.
- **The Artemis III region centres** are approximate and flagged as such. They should be replaced from the USGS data release when it can be downloaded.
- **Proxy features** (barren ground, dust, permafrost, lunar and Martian water, lava tubes, sunlight on the Moon and Mars) are labelled in the data and in `METHODS.md`; they are not measurements.
- The scores have not been compared with any published analog-suitability ranking. The rankings in `validation.md` are the only outside sense-check.

## Limits of the AI's role

The AI had no access to NASA data beyond what the laptop could download, could not open some archive pages that need JavaScript, and could not use the Mars cave catalog or the lunar shadowed-region maps because their hosts did not answer. It did not invent NASA involvement in any Irish site, and the Irish texts were written to keep claims checkable.
