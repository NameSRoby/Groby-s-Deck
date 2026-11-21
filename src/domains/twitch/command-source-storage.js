module.exports = (compile, modernize) => {
  const canonicalCache = new Map(),
    readableCache = new Map();
  const remember = (cache, key, value) => {
    cache.set(key, value);
    while (cache.size > 32) cache.delete(cache.keys().next().value);
    return value;
  };
  function canonicalLocals(source) {
    const names = new Map();
    return source.replace(/(?<!\\)\$\{(set|get)\[([a-z][a-z0-9_]*)/gi, (_, operation, name) => {
      if (!names.has(name)) names.set(name, "v" + names.size);
      return "${" + operation + "[" + names.get(name);
    });
  }
  function unpack(source) {
    if (readableCache.has(source)) return readableCache.get(source);
    const match = /^\$\{set\[recipe_source\|([A-Za-z0-9+/=]+)\]\}/.exec(source);
    if (!match) return source;
    try {
      const text = require("node:zlib")
        .inflateRawSync(Buffer.from(match[1], "base64"), { maxOutputLength: 12000 })
        .toString();
      const tail = source.slice(match[0].length),
        hash = (value) => require("node:crypto").createHash("sha256").update(value).digest("hex"),
        retired = {
          a65f7d03648920736ea7133d59819c6d88512e8183a4b524430c6fc07c962f7a:
            "a65f7d03648920736ea7133d59819c6d88512e8183a4b524430c6fc07c962f7a",
          f4ab53135ec52d4067dacf41a073ad2b27a8b8786e313a97e09eb9491b2734eb:
            "59b0b5848ce42c22a29def75ebb58161ff06cc3ea9097062337c764c80a68ea5",
        };
      return retired[hash(text)] === hash(tail) ||
        canonicalLocals(compile(modernize(text))) === canonicalLocals(tail)
        ? remember(readableCache, source, text)
        : source;
    } catch {
      return source;
    }
  }

  function canonical(source) {
    if (canonicalCache.has(source)) return canonicalCache.get(source);
    if (typeof source !== "string" || source.length > 16384)
      throw Error("Keep commands under 12,000 characters.");
    const result = modernize(unpack(source));
    compile(result);
    if (result.length > 12000) throw Error("This command is too long to save.");
    return remember(canonicalCache, source, result);
  }
  return { compile, unpack, canonical };
};
