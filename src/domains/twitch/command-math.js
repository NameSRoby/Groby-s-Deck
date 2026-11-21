/** Small bounded arithmetic language. Never executes JavaScript or reads objects. */
module.exports = (source) => {
  if (source.length > 1024) throw Error("Calculation is too long.");
  const tokens = source.match(/\d+(?:\.\d+)?|[a-z]+|==|!=|<=|>=|&&|\|\||[+*/%(),<>!-]/g) || [];
  if (tokens.join("") !== source.replace(/\s/g, "") || tokens.length > 256)
    throw Error("Use numbers, arithmetic and min/max/clamp in calculations.");
  let index = 0;
  const precedence = {
    "||": 1,
    "&&": 2,
    "==": 3,
    "!=": 3,
    "<": 4,
    ">": 4,
    "<=": 4,
    ">=": 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
    "%": 6,
  };
  function expression(min = 0, depth = 0) {
    if (depth > 24) throw Error("Calculation is nested too deeply.");
    const token = tokens[index++];
    let left;
    if (["-", "+", "!"].includes(token)) {
      const n = expression(7, depth + 1);
      left = token === "-" ? -n : token === "!" ? Number(!n) : n;
    } else if (token === "(") {
      left = expression(0, depth + 1);
      if (tokens[index++] !== ")") throw Error("Close calculation parentheses.");
    } else if (/^\d/.test(token || "")) left = Number(token);
    else if (token === "true" || token === "false") left = Number(token === "true");
    else {
      const functions = {
        min: [2, Math.min],
        max: [2, Math.max],
        abs: [1, Math.abs],
        round: [1, Math.round],
        floor: [1, Math.floor],
        ceil: [1, Math.ceil],
        clamp: [3, (n, lo, hi) => Math.min(hi, Math.max(lo, n))],
      };
      const entry = Object.hasOwn(functions, token) ? functions[token] : undefined;
      if (!entry || tokens[index++] !== "(") throw Error("Unknown calculation function.");
      const args = [];
      for (let n = 0; n < entry[0]; n++) {
        if (n && tokens[index++] !== ",")
          throw Error("Separate calculation arguments with commas.");
        args.push(expression(0, depth + 1));
      }
      if (tokens[index++] !== ")") throw Error("Close calculation parentheses.");
      left = entry[1](...args);
    }
    while (Object.hasOwn(precedence, tokens[index]) && precedence[tokens[index]] >= min) {
      const op = tokens[index++],
        right = expression(precedence[op] + 1, depth + 1);
      switch (op) {
        case "+":
          left += right;
          break;
        case "-":
          left -= right;
          break;
        case "*":
          left *= right;
          break;
        case "/":
          left /= right;
          break;
        case "%":
          left %= right;
          break;
        case "==":
          left = Number(left === right);
          break;
        case "!=":
          left = Number(left !== right);
          break;
        case "<":
          left = Number(left < right);
          break;
        case ">":
          left = Number(left > right);
          break;
        case "<=":
          left = Number(left <= right);
          break;
        case ">=":
          left = Number(left >= right);
          break;
        case "&&":
          left = Number(Boolean(left && right));
          break;
        case "||":
          left = Number(Boolean(left || right));
          break;
      }
    }
    if (!Number.isFinite(left) || Math.abs(left) > 1e9)
      throw Error("Calculation is outside the supported range.");
    return left;
  }
  const result = expression();
  if (index !== tokens.length) throw Error("Check the calculation.");
  return result;
};
