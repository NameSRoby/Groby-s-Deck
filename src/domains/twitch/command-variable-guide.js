/** Public variable reference: short calls, with matching usable examples. */
const ordinary = require("./command-context-variables");
const rows = [
  [
    "resetstats xp",
    "Saved leaderboards",
    "Reset one numeric field for everyone in this broadcaster's player records. Defaults to zero; use resetstats rating 1000 for a different starting value. Other fields are preserved. Prints nothing.",
    "Resets XP; prints nothing.",
  ],
  [
    'saveboard "S1" xp 3',
    "Saved leaderboards",
    "Save the top three players for a field under an archive name. Existing archives cannot be overwritten. Choose any field, name and count from 1 to 10. Prints nothing.",
    "Saves the finishing leaderboard; prints nothing.",
  ],
  [
    'board "S1"',
    "Saved leaderboards",
    "Show a saved leaderboard, even after the live field has been reset or changed.",
    "S1: 1. sample_viewer: 120 · 2. sample_target: 90",
  ],
  [
    "boards",
    "Saved leaderboards",
    "List the names of the last five saved leaderboards. Use boards 3 for another count from 1 to 10.",
    "S1, S2",
  ],
  [
    "username 1",
    "People",
    "Read and validate the first username argument, removing @ and ignoring capitalization. Use another argument number (1-20), or sender. Missing or invalid names give a clear error.",
    "sample_target",
  ],
  [
    "args 2",
    "Arguments",
    "All text from the second argument onward. Change 2 to the starting argument you need.",
    "hello there",
  ],
  [
    "game user",
    "Channel",
    "The target's current or last category. The same pattern works for title, link, live and uptime; leave out user for your own channel.",
    "Music",
  ],
  ["title user", "Channel", "The target's stream title.", "A cosy evening stream"],
  ["link user", "Channel", "The target's Twitch link.", "https://www.twitch.tv/sample_target"],
  [
    "addcount adddeath -1",
    "Counters",
    "Subtract one from the existing adddeath counter and show the new total. Use a positive amount to add more than one.",
    "The same saved counter, reduced by one.",
  ],
  [
    "setcount adddeath 10",
    "Counters",
    "Set the existing adddeath counter to 10 and show its new total. Choose your own name and number.",
    "10",
  ],
  [
    "same sender user",
    "Values & rules",
    "Compare two text values: 1 for equal, otherwise 0. Ignores outer spaces, a leading @ and capitalization. Works with usernames or your own text values.",
    "1 for the same player, otherwise 0; @ and capitalization do not matter.",
  ],
  [
    "set roll random 1 20",
    "Values & rules",
    "Roll a d20 once and remember the result as roll for this message. Prints nothing.",
    "Saves roll for this message; prints nothing.",
  ],

  [
    "roll",
    "Values & rules",
    "Show the value saved as roll. Use the name you chose with set.",
    "Use after setting roll: the same number every time.",
  ],
  [
    "math 2 + 3",
    "Values & rules",
    "Calculate and show a number. Supports +, -, *, / and parentheses.",
    "5",
  ],

  [
    "if roll >= 16",
    "Values & rules",
    'Start a conditional block. Also accepts live, true/false, or same role "moderator" for text comparisons. Only the chosen branch runs. Close it with end.',
    "Win!; only the winning block runs.",
  ],
  [
    "else",
    "Values & rules",
    "Inside an if block, start the text and actions to use when the comparison is false.",
    "",
  ],
  [
    "end",
    "Values & rules",
    "Finish the current if block. The command then continues normally.",
    "",
  ],
  [
    "add difficulty 1",
    "Values & rules",
    "Add 1 to difficulty for this message. Prints nothing.",
    "Use after setting difficulty; adds one and prints nothing.",
  ],
  [
    "subtract difficulty 1",
    "Values & rules",
    "Subtract 1 from difficulty for this message. Prints nothing.",
    "Use after setting difficulty; subtracts one and prints nothing.",
  ],
  [
    "limit difficulty 10 19",
    "Values & rules",
    "Keep difficulty between 10 and 19 for this message. Prints nothing.",
    "Use after setting difficulty; keeps it between 10 and 19.",
  ],
  [
    "round difficulty",
    "Values & rules",
    "Round difficulty to the nearest whole number for this message. Prints nothing.",
    "Use after setting difficulty; rounds it to a whole number.",
  ],

  [
    "stat user rating 1000",
    "Player records",
    "Read any saved numeric field for a person. Replace rating with your own field. The optional 1000 is the value to use before anything is saved; without it, the starting value is zero.",
    "Their rating, or 1000 if no rating has been saved.",
  ],
  [
    "addstat user xp 12",
    "Player records",
    "Add 12 to the target player's saved xp. Choose any stat name and amount; negative amounts subtract. Use a local value for a calculated award or deduction. Prints nothing.",
    "Adds 12 XP; prints nothing.",
  ],
  [
    "setstat user streak 0",
    "Player records",
    "Set the target player's saved streak to zero. Choose any stat name and value. Prints nothing.",
    "Sets their streak to zero; prints nothing.",
  ],
  [
    "top wins 5",
    "Player records",
    "Show the five players with the most wins in this channel.",
    "The five highest win totals in this channel.",
  ],
  [
    "random 1 20",
    "Random",
    "Choose a whole number from 1 to 20 with equal chances. Change the endpoints for other dice.",
    "One number from 1 to 20, with equal chances.",
  ],
  [
    'random.pick "Hello" "Welcome" "Hey"',
    "Random",
    "Choose one of the quoted messages with equal chances.",
    "One of the three messages, with equal chances.",
  ],
  [
    'chance 25 "Win!" "Try again"',
    "Random",
    "Show the first message 25% of the time; otherwise show the second. Choose a percentage from 0 to 100.",
    "Win! 25% of the time; otherwise Try again.",
  ],
  [
    'weighted "1:Legendary!" "9:Common"',
    "Random",
    "Choose between weighted messages: 1 and 9 give 10% and 90% odds. Larger weights are more likely.",
    "10% Legendary! and 90% Common.",
  ],
];
module.exports = [
  ...ordinary.map((row) => ({
    ...row,
    description:
      row.syntax === "${countadddeath}"
        ? "Add one to the counter named adddeath and show its total. Everything after count is the name; choose your own."
        : row.syntax === "${readcountadddeath}"
          ? "Show the adddeath counter without changing it. Use the same name after readcount."
          : row.syntax === "${resetcountadddeath}"
            ? "Reset the adddeath counter to zero. Use the same name after resetcount."
            : row.group === "Events"
              ? row.description + " Available when the matching Twitch event supplies it."
              : row.description,
  })),
  ...rows.map(([syntax, group, description, output]) => ({
    syntax: "${" + syntax + "}",
    group,
    description,
    output,
    changes: /^(addstat|setstat|resetstats|saveboard)/.test(syntax),
  })),
];
