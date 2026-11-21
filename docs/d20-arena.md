# Editable d20 arena

The Fight example is a normal command recipe, built with the same variables as other commands. Its fifteen stages are editable in Syntax & examples. Copy the recipe into a command message to use it; the scenes are text choices, not a hidden game handler.

| Stage                   | What to change                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Choose players          | Sender and opponent; plain names and @names both work.                                   |
| Read records            | Which saved player fields the encounter uses.                                            |
| Roll once               | `${set roll random 1 20}` remembers one die for the entire encounter.                    |
| Set difficulty          | Base 16, bounded streak pressure, comeback and rating adjustment.                        |
| Choose winner           | Natural 1 loses, natural 20 wins; otherwise meet the difficulty.                         |
| Award progress          | Odds, winning margin and critical rolls set XP gains and losses; edit the formulas here. |
| Update streaks          | Consecutive wins or losses affect later encounters.                                      |
| Update ratings          | Bounded changes keep stronger opponents challenging.                                     |
| Announce challenge      | The invitation and mirror-match introduction.                                            |
| Show die and difficulty | Actual roll, difficulty, chance and check result.                                        |
| Self-fight scenes       | Ten silly scenes; every saved record remains unchanged.                                  |
| Critical failures       | Six natural-1 scenes.                                                                    |
| Critical successes      | Six natural-20 scenes.                                                                   |
| Ordinary encounters     | Six victories, six close misses and six defeats.                                         |
| Award summary           | Actual XP gained by the winner and deducted from the loser.                              |

For another scene, add a quoted sentence inside the appropriate `${random.pick ...}`. Use `${attacker}`, `${defender}`, `${winner}` and `${loser}` for names. Only the selected scene is evaluated. Each encounter rolls its die once, then chooses one scene. A close miss means exactly one point below the difficulty.

The summary reads `${xpAward}` and `${xpLoss}`, so changing the rules also changes the displayed amounts. Keep the self check around every saved-stat mutation. Self-fights are exhibitions even when their die critically succeeds or fails: no XP, wins, losses, streaks or rating changes.

## XP rules you can edit

These are ordinary recipe values, not special game functions. XP is the arena's score; Twitch Channel Points and watchtime points are separate. Existing balances are kept.

| Value          | Meaning                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chance`       | Attacker's percentage chance to win before the roll.                                                                                                                                                                     |
| `winnerChance` | Winner's original chance: `chance` if the attacker won, `100 - chance` if the defender won.                                                                                                                              |
| `margin`       | How decisively the check was won. An attacking win uses `roll - difficulty`; a defending win uses `difficulty - roll - 1`. Kept between 0 and 5. Meeting the target or defending a one-point miss gives no margin bonus. |
| `xpAward`      | `10 + (100 - winnerChance) * 2 / 5 + margin`, rounded to a whole number. A winner who had lower odds earns more.                                                                                                         |
| `xpLoss`       | `2 + (100 - winnerChance) / 5 + margin / 2`, rounded. Losing as the favorite costs more than losing as the underdog.                                                                                                     |
| Critical roll  | A natural 1 or 20 adds 5 to the winner's award and 3 to the loser's deduction, before rounding.                                                                                                                          |
| Balance floor  | The deduction cannot exceed the loser's saved XP. Someone with 3 XP can lose at most 3; someone at zero loses zero. The reply shows that actual deduction.                                                               |

At the starting difficulty of 16, the attacker has a 25% chance:

| Roll | Winner   | Winner gains | Loser loses, if they have enough XP |
| ---- | -------- | ------------ | ----------------------------------- |
| 1    | Defender | 30 XP        | 13 XP                               |
| 8    | Defender | 25 XP        | 10 XP                               |
| 15   | Defender | 20 XP        | 7 XP                                |
| 16   | Attacker | 40 XP        | 17 XP                               |
| 19   | Attacker | 43 XP        | 19 XP                               |
| 20   | Attacker | 49 XP        | 22 XP                               |

Edit `10` to change the base win award, the odds multiplier `2` and divisor `5` to change the importance of odds, or the margin limit and critical bonuses. The odds weighting is stronger than the margin bonus, so the same winning roll is worth more against a harder opponent. `${round xpAward}` rounds a local value. `${set loserXP stat loser xp}` reads the balance; the following comparison caps the loss. `${set xpDebit 0 - xpLoss}` makes the deduction negative, and `${addstat loser xp xpDebit}` applies it. These same functions work with any player field you create. Every 100 XP grants a cosmetic level; losing enough XP can lower that level. Wins and losses are still recorded once per real duel.

Use `!fightstats name` for a record and `!fighttop` for the leaderboard. Records stay within the broadcaster's channel. Every 100 XP grants a cosmetic level. The difficulty's final range is 10–19, so a die's shown chance remains exact, with natural 1 and 20 included.

Preview uses sample data and does not post chat or commit records. Commands remain bounded: 12,000 authored characters, 16,384 compiled/storage characters, 512 functions, three nested authoring conditions and 500 characters in the final chat reply. Increasing the text library does not add a background loop or roll all the unused scenes.

The expanded example needs the updated Core runtime. Installing only its UI on an older Core is insufficient. Existing customized commands are not silently replaced by this example.
