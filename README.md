# LOTRO Skills and Effects

A Wowhead-style browser for LOTRO skills and effects, built from data read
directly out of the client `.dat` files. No scraping, no third-party dataset.

## Running it

    serve.bat          (or: python serve.py)

then go to <http://localhost:8000/>.

Use `serve.py`, not `python -m http.server`. Pages have real addresses now
(`/skill/1879049328`, not `#/skill/...`), and a plain static server has no file
at that address, so every page but the front one would 404. `serve.py` falls
back the same way the published site does, so what you preview is what ships.

To publish it, upload this whole folder to any static host. There is no
backend. On GitHub Pages, `404.html` is what makes a deep link work: the host
serves it for an address it has no file for, and it hands the path back to
`index.html`. If the site ever moves to the root of a domain, change
`PATH_SEGMENTS_TO_KEEP` in `404.html` from 1 to 0.

### Getting the pages indexed

`sitemap.xml` and `robots.txt` are written on every rebuild. That is enough for
a crawler to find the pages, but a static host still answers 404 for each one
before the redirect runs, and crawlers believe the 404. To publish a real file
per page instead:

    refresh.bat --prerender

That writes ~39,000 small HTML files (one per page, each with its own title and
description, the app taking over from there). It is off by default because of
what it does to the size of the repository.

## Where the data comes from

Skills and effects are WSTATE resources in the DID range
`0x70000000-0x77FFFFFF`. The dword at offset 4 of each WSTATE blob is its
classDefIndex, which is what says *what the resource is*:

| classDefIndex | resource |
|---|---|
| 827 | skill |
| 734, 716, 717, 752, 753, 739, 748, 764, 780, 2156, 2258, 2259, 2441, 2459, 3218, 3690, 3833 | property-modification effect |
| 718 | flag effect |
| 755 | vital-over-time | 
| 725 | instant vital |
| 709 | aura |
| ...and 20 more | see `../lotrodb/extract.py` |
| 1477, 1478, 1483, 1494, 2525, 3438, 3509 | trait |

Two more directory resources carry the class side:

| WSTATE did | what |
|---|---|
| `0x7000020E` | `AdvTable_LevelTableList` - one advancement table per class |
| `0x7000025B` | TraitControl - trait natures -> trait tree dids |

A skill is earned one of two ways, and both are extracted:

* **trained at a level** - `AdvTable_AvailableSkillEntryList` on the class,
  pairing `AdvTable_Skill` with `AdvTable_Level`
* **granted by a trait** - `Trait_Skill_Array` (from the moment the trait is
  taken) or `Trait_EffectSkill_AtRankSkillsAcquired_Array` (at a given rank)

Branch display names ("The Quiet Knife") are not the enum's internal name
("Class_Specialization_Burglar_Two"): the internal name is in enum 587203489's
`strings`, the shown name is a StringInfo in its `log_strings`.

Each resource's numbers live in its DBPROPERTIES property collection, at
DID + `0x09000000`.

## Redeploying

`index.html` loads `app.js?v=N` and `style.css?v=N`. The rebuild bumps that `N`
itself, so returning visitors get the new files rather than their cache. If you
edit `app.js` or `style.css` by hand without rebuilding, bump it by hand.

## Rebuilding after a LOTRO patch

The extractor that produces `data/` and `icons/` is kept separately and is not
part of this repository. Rebuilding is one command there. It compares the new
counts against the previous build and refuses to look happy if one of them has
fallen - a DAT format change shows up as a count that collapses, not as an
error - and it writes what changed since the last build into
`data/changes.json`, which is the site's "What changed" page.

## Layout

    data/index.json        search index over every skill and effect
    data/searchText.json   description text, fetched only when someone searches
    data/properties.json   the client's own label for each game property
    data/changes.json      what this build changed since the previous one
    data/snapshot.json     the fingerprints the next build diffs against
    data/meta.json         counts
    data/progressions.json every level-scaling curve
    data/classes.json      the 12 classes, their trained skills and class traits
    data/traits.json       every trait and the skills it grants
    data/traitTrees.json   trait trees, branches and cell positions
    data/traceries.json    traceries grouped by uniqueness channel, per rarity
    data/modSources.json   which traits, effects and traceries grant each
                           modifier property, and what reads it
    data/skill/<n>.json    curated skill records, bucket = id % 128
    data/effect/<n>.json   curated effect records
    data/raw/...           pruned raw client properties, loaded on demand
    icons/<iconId>.png     icons exported from the DATs
