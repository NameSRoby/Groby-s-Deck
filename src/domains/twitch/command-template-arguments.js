/** Resolve authored argument boundaries before inserting untrusted text values. */
module.exports = async (parts, expression, fail) => {
  const structured = typeof parts[0] === "string" && /^([a-z][a-z0-9.]*)\[/i.exec(parts[0]);
  let structuredArgs = null;
  const resolved = [];
  if (structured && typeof parts.at(-1) === "string" && parts.at(-1).endsWith("]")) {
    const chunks = [[]];
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (typeof part !== "string") {
        chunks.at(-1).push(await expression(part.parts));
        continue;
      }
      let text = index === 0 ? part.slice(structured[0].length) : part;
      if (index === parts.length - 1) text = text.slice(0, -1);
      const segments = text.split("|");
      for (let i = 0; i < segments.length; i++) {
        if (i) chunks.push([]);
        chunks.at(-1).push(segments[i]);
      }
    }
    structuredArgs = chunks.map((chunk) => chunk.join(""));
    resolved.push(structured[1]);
  } else
    for (const part of parts) {
      if (typeof part === "string") resolved.push(part);
      else {
        const value = await expression(part.parts);
        if (/[|\[\]{}$]/.test(value)) fail("A nested argument cannot contain template delimiters.");
        resolved.push(value);
      }
    }
  return { rawExpression: resolved.join("").trim(), structuredArgs };
};
