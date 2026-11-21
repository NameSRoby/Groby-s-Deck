/** One teaching reference for the in-app manual and downloadable command guide. */
module.exports = [
  {
    id: "comparisons",
    title: "Compare two numbers",
    intro:
      "A condition asks a question with a true (yes) or false (no) answer. Put a number or a remembered name on each side. Comparisons only check values; they never change them. These examples use literal numbers so you can see exactly why each answer is true or false.",
    rows: [
      {
        symbol: "==",
        name: "Equal to",
        description:
          "True when both numbers are exactly the same. Use two equals signs to compare. To assign a value instead, use set, such as ${set roll 20}.",
        cases: [
          ["20 == 20", 1],
          ["19 == 20", 0],
        ],
      },
      {
        symbol: "!=",
        name: "Not equal to",
        description:
          "True when the numbers are different. False when they are the same. For example, roll != 1 excludes a critical failure.",
        cases: [
          ["12 != 1", 1],
          ["1 != 1", 0],
        ],
      },
      {
        symbol: ">",
        name: "Greater than",
        description:
          "True when the left number is larger than the right number. Equality does not count: roll > 16 needs at least 17 on a whole-number die.",
        cases: [
          ["17 > 16", 1],
          ["16 > 16", 0],
        ],
      },
      {
        symbol: "<",
        name: "Less than",
        description:
          "True when the left number is smaller than the right number. Equality does not count: roll < 16 accepts 15 or less on a whole-number die.",
        cases: [
          ["15 < 16", 1],
          ["16 < 16", 0],
        ],
      },
      {
        symbol: ">=",
        name: "Greater than or equal to",
        description:
          "True when the left number is larger OR equal. A rule of roll >= 16 includes 16, 17, 18, 19 and 20 on a d20.",
        cases: [
          ["16 >= 16", 1],
          ["15 >= 16", 0],
        ],
      },
      {
        symbol: "<=",
        name: "Less than or equal to",
        description:
          "True when the left number is smaller OR equal. For example, lives <= 0 includes zero and negative numbers.",
        cases: [
          ["0 <= 0", 1],
          ["1 <= 0", 0],
        ],
      },
    ],
  },
  {
    id: "logic",
    title: "Combine or reverse conditions",
    intro:
      "Use these inside one if condition. Comparisons happen before AND, and AND happens before OR. Parentheses make your intended groups clear. Do not write 1 < roll < 20: write roll > 1 && roll < 20. Every value in a calculation must be valid; AND and OR do not hide an invalid calculation such as division by zero.",
    rows: [
      {
        symbol: "&&",
        name: "AND: both must be true",
        description:
          "The whole condition is true only when both checks pass. For a normal successful d20 roll, use roll >= 16 && roll < 20: at least 16, but not a natural 20.",
        cases: [
          ["18 >= 16 && 18 < 20", 1],
          ["20 >= 16 && 20 < 20", 0],
        ],
      },
      {
        symbol: "||",
        name: "OR: either may be true",
        description:
          "True when at least one check passes. It is also true when both pass. Use roll == 1 || roll == 20 to recognize either critical result.",
        cases: [
          ["1 == 1 || 1 == 20", 1],
          ["10 == 1 || 10 == 20", 0],
        ],
      },
      {
        symbol: "!",
        name: "NOT: reverse the answer",
        description:
          "Put ! before a condition in parentheses to turn true into false or false into true. For example, !(roll == 1) means the roll is not 1.",
        cases: [
          ["!(12 == 1)", 1],
          ["!(1 == 1)", 0],
        ],
      },
      {
        symbol: "true / false",
        name: "Yes / no values",
        description:
          "An if block runs for true or any nonzero number. Zero or false chooses else. Comparisons displayed using math print 1 for true or 0 for false. A remembered test can be reused in later conditions.",
        cases: [
          ["true", 1],
          ["false", 0],
        ],
      },
    ],
  },
  {
    id: "calculations",
    title: "Calculate a number",
    intro:
      "Use ${math expression} to print an answer, or ${set name expression} to remember it without printing. Multiplication, division and remainder happen before addition and subtraction. Operations at the same level run left to right. Parentheses change that order. Use a decimal point (2.5), not a decimal comma (2,5). Division by zero is an error.",
    numeric: true,
    rows: [
      {
        symbol: "+",
        name: "Add",
        description:
          "Add the right number to the left number. For example, ${set total xp + 12} remembers an XP total plus 12 if you have already remembered xp; it does not save a player's record by itself.",
        cases: [["10 + 3", 13]],
      },
      {
        symbol: "-",
        name: "Subtract / make negative",
        description:
          "Subtract the right number from the left number. Before a single value, - changes its sign: -5 is negative five. Subtracting a negative adds it instead.",
        cases: [
          ["10 - 3", 7],
          ["-5", -5],
          ["10 - (-3)", 13],
        ],
      },
      {
        symbol: "*",
        name: "Multiply",
        description:
          "Multiply two numbers. For example, 3 * 4 means three groups of four. Type the asterisk *, not the letter x or a multiplication glyph.",
        cases: [["3 * 4", 12]],
      },
      {
        symbol: "/",
        name: "Divide",
        description:
          "Divide the left number by the right number. The answer can contain a fraction; use round, floor or ceil when you need a whole number. The right number must not be zero.",
        cases: [["9 / 2", 4.5]],
      },
      {
        symbol: "%",
        name: "Remainder",
        description:
          "Return what is left after division, rather than a percentage. Seven divided into groups of three leaves one. For a random percentage, use chance instead. With negative numbers the remainder follows the left number's sign.",
        cases: [
          ["7 % 3", 1],
          ["-7 % 3", -1],
        ],
      },
      {
        symbol: "( )",
        name: "Group first",
        description:
          "Calculate the part inside parentheses first. Each opening ( needs a closing ). Compare these two answers: grouping the addition changes the result.",
        cases: [
          ["2 + 3 * 4", 14],
          ["(2 + 3) * 4", 20],
        ],
      },
    ],
  },
  {
    id: "math-functions",
    title: "Choose, round or limit a number",
    intro:
      "These functions go inside a calculation, for example ${math min(8, 12)}. Put the inputs inside parentheses and separate them with commas. The order matters: clamp takes the number, the lower limit, then the upper limit. A calculation can be fractional; saved counters and player fields require whole numbers.",
    numeric: true,
    rows: [
      {
        symbol: "min(a, b)",
        name: "Choose the smaller",
        description:
          "Return the lower of two numbers. For example, min(bonus, 3) caps a bonus at three.",
        cases: [["min(8, 12)", 8]],
      },
      {
        symbol: "max(a, b)",
        name: "Choose the larger",
        description:
          "Return the higher of two numbers. For example, max(lives, 0) prevents a displayed life count from falling below zero.",
        cases: [["max(8, 12)", 12]],
      },
      {
        symbol: "abs(number)",
        name: "Distance from zero",
        description:
          "Remove a negative sign. Positive numbers stay positive; zero stays zero. Useful for measuring the size of a difference.",
        cases: [["abs(-7)", 7]],
      },
      {
        symbol: "round(number)",
        name: "Nearest whole number",
        description:
          "Round to the nearest whole number. Exact halves round toward the more positive number: 2.5 becomes 3, and -2.5 becomes -2.",
        cases: [
          ["round(2.5)", 3],
          ["round(-2.5)", -2],
        ],
      },
      {
        symbol: "floor(number)",
        name: "Round down",
        description:
          "Return the whole number at or below the input. This moves toward negative infinity, so floor(-2.7) is -3. Useful for completed levels: floor(xp / 100).",
        cases: [
          ["floor(2.7)", 2],
          ["floor(-2.7)", -3],
        ],
      },
      {
        symbol: "ceil(number)",
        name: "Round up",
        description:
          "Return the whole number at or above the input. This moves toward positive infinity, so ceil(-2.7) is -2.",
        cases: [
          ["ceil(2.1)", 3],
          ["ceil(-2.7)", -2],
        ],
      },
      {
        symbol: "clamp(number, low, high)",
        name: "Keep within limits",
        description:
          "Keep a number between a lower and upper limit, including both ends. Below the lower limit becomes the lower limit; above the upper limit becomes the upper limit. A number already inside stays unchanged. Put the lower limit first.",
        cases: [
          ["clamp(25, 10, 19)", 19],
          ["clamp(5, 10, 19)", 10],
          ["clamp(16, 10, 19)", 16],
        ],
      },
    ],
  },
];
