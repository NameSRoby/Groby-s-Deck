# Command language

Write ordinary reply text and insert `${...}` functions. Use the same functions in chat commands, timer/event replies and deck chat actions. **Syntax & examples** and the editor's **All variables and saved values** picker use one shared reference.

Messages sent by Groby's Deck are excluded from command and exact-phrase triggers, including replies, timed messages and announcements. Commands you type yourself still work, including from the broadcaster account.

Command editors color your source as you type: functions are gold, variables blue, `if` / `else` / `end` purple, numbers peach, quoted text green and operators pink. The same colors appear when creating automations and editing deck actions. Use **Colors off** beside an editor for plain text. Coloring helps you read the command; Preview checks its result. It never runs a command or changes saved values.

## Three kinds of values

| Kind                    | Read                       | Change                                                                                    | Lifetime                                                                               |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Temporary named value   | `${roll}`                  | `${set roll random 1 20}`, `${add roll 1}`                                                | This message only. `set` and arithmetic changes print nothing.                         |
| Channel counter         | `${readcountdeaths}`       | `${countdeaths}`, `${addcount deaths -1}`, `${setcount deaths 10}`, `${resetcountdeaths}` | Saved for this broadcaster across restarts. Counter changes print the resulting total. |
| A person's saved number | `${stat user rating 1000}` | `${addstat user xp 12}`, `${setstat user streak 0}`                                       | Saved for this broadcaster and username across restarts. Changes print nothing.        |

Choose your own temporary names, counter names and saved field names. `xp`, `wins`, `rating`, `mana` and `streak` are ordinary field names, not special game features. The optional final number in `stat` supplies a starting value without creating a record. Without it, a missing field reads as zero. Saved fields hold whole numbers; temporary values can also hold text.

`${countdeaths}` increments once per message, even if you display it twice. An explicit `${addcount deaths 2}` applies each time it is written. Reads always reflect earlier writes in that message. Previews never save changes. Give commands that change saved data an appropriate access level.

## People and arguments

| Function               | Meaning                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `${sender}`            | The person who triggered the command.                                                                                                 |
| `${user}`              | The target: first argument, incoming raider, or sender when no target was supplied.                                                   |
| `${username 1}`        | Require and normalize a valid username in argument 1. Accepts `name` or `@name`. No Twitch lookup is needed to create a saved record. |
| `${1}`, `${2}`         | An argument exactly as typed.                                                                                                         |
| `${args}`, `${args 2}` | All remaining text, or text starting with argument 2.                                                                                 |
| `${same sender user}`  | Compare text ignoring capitalization, outer spaces and a leading `@`. Returns 1 or 0.                                                 |

Use `${game}` for your category and `${game user}` for the target's category. `title`, `link`, `live` and `uptime` use the same pattern. The reference recommends one form; older aliases are converted when saved.

There is one authored form for each operation: `${user}` for the target, `${username 1}` for a validated name, `${random 1 20}` for a numeric range (the endpoints can also be temporary names), `${random.pick "Hello" "Hi"}` for text choices, `${math expression}` for a displayed calculation, and `${name}` for a temporary value. All conditional choices use `${if condition}`, optional `${else}`, and `${end}`. Imports and saved commands are converted to these forms; the editor and presets do not offer the retired spellings. The compiler's private instructions are never saved as user-facing command text.

Reading and changing a value are different operations: `math` displays a result, while `set`, `add`, `subtract`, `limit` and `round` update a temporary value without printing. Likewise, `stat` reads a saved player field, `addstat` changes it by an amount, and `setstat` assigns its new total. The dice arena uses these generic operations and contains no special fight function.

The [editable d20 arena guide](d20-arena.md) explains its XP awards and deductions, odds, margins and critical rolls with worked examples. Negative `addstat` amounts subtract from a saved number. Protect a balance by comparing the proposed deduction with the saved value before writing it, as the arena recipe does. The recipe's rules and messages are all editable in **Syntax & examples**.

Other context values include `${channel}`, `${command}` and `${role}`; `${raider}`, `${bits}`, `${months}`, `${gifts}` and `${event}` when the matching event supplies them; and `${time}`, `${date}` and `${unix}` for UTC time. `${viewers}` means current channel viewers, or the incoming viewer count during a raid.

## Rules and random choices

```text
${set roll random 1 20}
Need 16 or more. Rolled ${roll}/20.
${if roll >= 16}
  ${random.pick "A clean hit!" "A perfectly timed counterattack!"}
${else}
  ${random.pick "The shield holds!" "A heroic attempt. A terrible landing."}
${end}
```

`if` accepts comparisons, numeric calculations, `live`, and `true`/`false`. For text, use `${if same role "moderator"}`. `else` is optional; `end` closes the block. Only the chosen branch runs, including changes to saved values. `${set roll random 1 20}` rolls once; every later `${roll}` reuses that result. Temporary values can also remember context functions, such as `${set category game user}`.

Use `${math 2 + 3}` to display a calculation. For temporary values, `add`, `subtract`, `round` and `limit` change the named value without printing. For example `${limit difficulty 10 19}` keeps it between 10 and 19. Use `${chance 25 "Win" "Lose"}` for a percentage, or `${weighted "1:Rare" "9:Common"}` for weighted outcomes. Quotes keep each option together; punctuation inside text remains ordinary text. Inserted viewer arguments are never executed as functions.

## Conditions and calculations: the manual

A condition asks a true (yes) or false (no) question. For example, `${if roll >= 16}` asks whether a remembered roll is at least 16. The block after `if` runs for a true answer. `${else}` starts the alternative for a false answer and is optional. `${end}` closes the choice; text and operations afterward run in either case. Only the chosen block changes saved data.

Create temporary names before reading them: `${set roll 18}` remembers 18, and `${roll}` displays it. Temporary names are case sensitive: `roll` and `Roll` differ. Begin names with a letter and use letters, digits or underscores. Built-in names and functions must be written as shown in the reference. Spaces separate options; quotes keep a phrase together, such as `${set greeting "Welcome back"}`.

Each `if` needs its own `end`; up to three nested choices are supported. Indentation and line breaks help you read the source, but the `if`, `else` and `end` calls determine the branches. Use Preview to check the final wording and spacing.

<!-- OPERATOR_MANUAL_START -->

### Compare two numbers

A condition asks a question with a true (yes) or false (no) answer. Put a number or a remembered name on each side. Comparisons only check values; they never change them. These examples use literal numbers so you can see exactly why each answer is true or false.

| Symbol / function | What it means | Worked examples |
| --- | --- | --- |
| `==` — Equal to | True when both numbers are exactly the same. Use two equals signs to compare. To assign a value instead, use set, such as ${set roll 20}. | `20 == 20` → **true (yes)**; `19 == 20` → **false (no)** |
| `!=` — Not equal to | True when the numbers are different. False when they are the same. For example, roll != 1 excludes a critical failure. | `12 != 1` → **true (yes)**; `1 != 1` → **false (no)** |
| `>` — Greater than | True when the left number is larger than the right number. Equality does not count: roll > 16 needs at least 17 on a whole-number die. | `17 > 16` → **true (yes)**; `16 > 16` → **false (no)** |
| `<` — Less than | True when the left number is smaller than the right number. Equality does not count: roll < 16 accepts 15 or less on a whole-number die. | `15 < 16` → **true (yes)**; `16 < 16` → **false (no)** |
| `>=` — Greater than or equal to | True when the left number is larger OR equal. A rule of roll >= 16 includes 16, 17, 18, 19 and 20 on a d20. | `16 >= 16` → **true (yes)**; `15 >= 16` → **false (no)** |
| `<=` — Less than or equal to | True when the left number is smaller OR equal. For example, lives <= 0 includes zero and negative numbers. | `0 <= 0` → **true (yes)**; `1 <= 0` → **false (no)** |

### Combine or reverse conditions

Use these inside one if condition. Comparisons happen before AND, and AND happens before OR. Parentheses make your intended groups clear. Do not write 1 < roll < 20: write roll > 1 && roll < 20. Every value in a calculation must be valid; AND and OR do not hide an invalid calculation such as division by zero.

| Symbol / function | What it means | Worked examples |
| --- | --- | --- |
| `&&` — AND: both must be true | The whole condition is true only when both checks pass. For a normal successful d20 roll, use roll >= 16 && roll < 20: at least 16, but not a natural 20. | `18 >= 16 && 18 < 20` → **true (yes)**; `20 >= 16 && 20 < 20` → **false (no)** |
| `\|\|` — OR: either may be true | True when at least one check passes. It is also true when both pass. Use roll == 1 \|\| roll == 20 to recognize either critical result. | `1 == 1 \|\| 1 == 20` → **true (yes)**; `10 == 1 \|\| 10 == 20` → **false (no)** |
| `!` — NOT: reverse the answer | Put ! before a condition in parentheses to turn true into false or false into true. For example, !(roll == 1) means the roll is not 1. | `!(12 == 1)` → **true (yes)**; `!(1 == 1)` → **false (no)** |
| `true / false` — Yes / no values | An if block runs for true or any nonzero number. Zero or false chooses else. Comparisons displayed using math print 1 for true or 0 for false. A remembered test can be reused in later conditions. | `true` → **true (yes)**; `false` → **false (no)** |

### Calculate a number

Use ${math expression} to print an answer, or ${set name expression} to remember it without printing. Multiplication, division and remainder happen before addition and subtraction. Operations at the same level run left to right. Parentheses change that order. Use a decimal point (2.5), not a decimal comma (2,5). Division by zero is an error.

| Symbol / function | What it means | Worked examples |
| --- | --- | --- |
| `+` — Add | Add the right number to the left number. For example, ${set total xp + 12} remembers an XP total plus 12 if you have already remembered xp; it does not save a player's record by itself. | `10 + 3` → **13** |
| `-` — Subtract / make negative | Subtract the right number from the left number. Before a single value, - changes its sign: -5 is negative five. Subtracting a negative adds it instead. | `10 - 3` → **7**; `-5` → **-5**; `10 - (-3)` → **13** |
| `*` — Multiply | Multiply two numbers. For example, 3 * 4 means three groups of four. Type the asterisk *, not the letter x or a multiplication glyph. | `3 * 4` → **12** |
| `/` — Divide | Divide the left number by the right number. The answer can contain a fraction; use round, floor or ceil when you need a whole number. The right number must not be zero. | `9 / 2` → **4.5** |
| `%` — Remainder | Return what is left after division, rather than a percentage. Seven divided into groups of three leaves one. For a random percentage, use chance instead. With negative numbers the remainder follows the left number's sign. | `7 % 3` → **1**; `-7 % 3` → **-1** |
| `( )` — Group first | Calculate the part inside parentheses first. Each opening ( needs a closing ). Compare these two answers: grouping the addition changes the result. | `2 + 3 * 4` → **14**; `(2 + 3) * 4` → **20** |

### Choose, round or limit a number

These functions go inside a calculation, for example ${math min(8, 12)}. Put the inputs inside parentheses and separate them with commas. The order matters: clamp takes the number, the lower limit, then the upper limit. A calculation can be fractional; saved counters and player fields require whole numbers.

| Symbol / function | What it means | Worked examples |
| --- | --- | --- |
| `min(a, b)` — Choose the smaller | Return the lower of two numbers. For example, min(bonus, 3) caps a bonus at three. | `min(8, 12)` → **8** |
| `max(a, b)` — Choose the larger | Return the higher of two numbers. For example, max(lives, 0) prevents a displayed life count from falling below zero. | `max(8, 12)` → **12** |
| `abs(number)` — Distance from zero | Remove a negative sign. Positive numbers stay positive; zero stays zero. Useful for measuring the size of a difference. | `abs(-7)` → **7** |
| `round(number)` — Nearest whole number | Round to the nearest whole number. Exact halves round toward the more positive number: 2.5 becomes 3, and -2.5 becomes -2. | `round(2.5)` → **3**; `round(-2.5)` → **-2** |
| `floor(number)` — Round down | Return the whole number at or below the input. This moves toward negative infinity, so floor(-2.7) is -3. Useful for completed levels: floor(xp / 100). | `floor(2.7)` → **2**; `floor(-2.7)` → **-3** |
| `ceil(number)` — Round up | Return the whole number at or above the input. This moves toward positive infinity, so ceil(-2.7) is -2. | `ceil(2.1)` → **3**; `ceil(-2.7)` → **-2** |
| `clamp(number, low, high)` — Keep within limits | Keep a number between a lower and upper limit, including both ends. Below the lower limit becomes the lower limit; above the upper limit becomes the upper limit. A number already inside stays unchanged. Put the lower limit first. | `clamp(25, 10, 19)` → **19**; `clamp(5, 10, 19)` → **10**; `clamp(16, 10, 19)` → **16** |

<!-- OPERATOR_MANUAL_END -->

### Comparing words and usernames

Number comparisons such as `==` work with numbers. For text, use `${if same sender user}` to check whether the sender and target are the same person. `same` compares the complete text, ignoring capitalization, outer spaces and a leading `@`. It does not search for a word inside another sentence. Literal text needs quotes: `${if same ${1} "confirm"}` checks the first argument. To reverse it, use `${set isSelf same sender user}` then `${if isSelf == 0}`.

### Complete worked example

```text
${set roll 18}
Need 16 or more. ${sender} rolled ${roll}/20.
${if roll >= 16}
  Success! The shield breaks.
${else}
  Failed! The shield holds.
${end}
```

With 18, this prints the success text. Change 18 to 9 and it prints the failure text. Replace the first line with `${set roll random 1 20}` to roll randomly once and reuse the result throughout the command. In **Syntax & examples ? Language manual**, both outcomes have buttons that load this example into the safe preview.

## Build the arena from scratch

The complete [D20 arena recipe](../public/core/recipes/d20-arena.json) is plain data. Every stage contains editable public syntax: choosing players, loading records, rolling, difficulty adjustments, criticals, wins/losses, XP, streaks, ratings and story variations. The example does not call a fight-specific runtime function.

Create a chat-command automation, add **Send a chat message**, then paste the stages' `source` text in order. You can also load the D20 example and edit the same stages under **Syntax & examples**. Change the command name, access and cooldowns normally. For a new mechanic, choose another saved field; no JavaScript or special player registration is required.

Self-fights use the ordinary `${same attacker defender}` comparison and skip all saved-field writes. Critical 1/20 rules, comeback bonuses, XP amounts and every joke are part of the recipe, not backend rules. `${top wins 5}` reads the same generic saved fields for a leaderboard.

The automated stress test reads only that JSON recipe, blocks the old duel backend, checks every die result, restarts storage, edits the difficulty and XP amounts, and verifies self-fights leave records unchanged.

Commands remain bounded: 12,000 authored characters, 512 functions, at most three nested `if` blocks, and 500 output characters for Twitch. Keep long game logic in values and rules; keep its final chat story concise.

## Saved leaderboards, resets and seasons

| Function                    | What it does                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `${saveboard "S1" xp 3}`    | Save the current top three XP records under the name S1. Change the field, label or number of people (1–10). Prints nothing. |
| `${resetstats xp}`          | Set everyone's existing XP field to zero in this channel. Other fields stay as they are. Prints nothing.                     |
| `${resetstats rating 1000}` | Reset an existing field to a different starting number.                                                                      |
| `${board "S1"}`             | Show the saved standings, even after XP changes or resets.                                                                   |
| `${boards}`                 | List the last five saved leaderboard names. `${boards 3}` lists three.                                                       |

Archives cannot overwrite an existing name. Up to 256 archives, each with up to ten people, share the bounded saved-value file. A recipe commits its numeric changes and archives together; failed templates and previews save neither. These are general storage functions, so they also work for scores, races or community challenges.

The editable [season recipe](../public/core/recipes/seasons.json) reads a `season` counter (starting at 1), saves `S1`'s top three, resets XP, then advances to `S2`. Wins, losses, ratings and other fields remain untouched. The level in the arena is calculated from XP, so it starts again with XP.

Under **Example commands & starter recipes → Seasons & records**, choose the two-month timer, manual `!newseason`, broadcaster-only `!resetxp`, or public `!season` history command. Manual resets require `confirm` as the command argument. All examples start as disabled drafts. Review their rules and permissions before activating them.

Choose **Run variable recipe (no chat)** to change saved values without sending a message, including while offline. Temporary values last for that step; channel counters and player fields let separate steps and automations share state. To announce a rollover, add **Send a chat message** afterward, for example `Season S${readcountseason} begins!`. Existing Start, Pause and Restart automation actions can connect flows or provide deck controls.

Timers can use elapsed seconds/minutes/hours or actual calendar months with a visible next-run date in UTC. Calendar dates persist across normal restarts and preserve the original day where possible (January 31 → February 28/29 → March 31). A timer overdue while the app is closed runs once when available, then schedules the next future date; it never replays a burst of missed seasons. Pause preserves that date. Restart schedules a new interval from now. The app must be running for timers to execute.
