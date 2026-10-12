# The gauntlet-loop skill

`SKILL.md` in this folder is copied unchanged from a skill published on GitHub:

- **Skill:** Gauntlet Loop, by Jay E at RoboNuggets — https://robonuggets.com
- **Technique:** the gauntlet loop is Matt Shumer's idea, from his original prompt for
  Claude of Duty — https://github.com/mshumer/Claude-of-Duty
- **Source:** https://github.com/robonuggets/gauntlet-loop, `.claude/skills/gauntlet-loop/SKILL.md`
  at commit `9b1975a1b8f01981f3f1e6b667ad3aaf907178ea` (6 August 2026)
- **Licence:** CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/

Nothing was changed. Read in full before it was taken in (12 October 2026): plain text that
only writes a prompt, with no hooks, no network calls of its own and no settings.

What it does: `/gauntlet-loop <goal>` offers two or three concrete, fetchable references to
aim at, and once one is picked writes a ~150-word prompt in which builders and separate harsh
critics compare the work blind against that reference until it wins. The prompt it writes ends
in `/loop` and `ultracode`, so running it fans out many agents for as long as nobody stops it:
that is expensive in tokens by design.
