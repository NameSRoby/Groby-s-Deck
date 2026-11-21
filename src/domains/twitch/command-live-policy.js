/** Coalesce stream lookups so gated chat commands cannot flood Helix. */
module.exports = ({ getProvider, now }) => {
  let cached = null;
  const lookup = async (owner) => {
    if (!cached || cached.owner !== owner || cached.until <= now()) {
      const entry = { owner, until: now() + 30000 };
      entry.result = Promise.resolve()
        .then(() => getProvider().dashboardStream())
        .then((value) => value?.ok && value.live === true)
        .catch(() => false);
      cached = entry;
    }
    return cached.result;
  };
  lookup.setLive = (owner, live) => {
    cached = { owner, until: now() + 30000, result: Promise.resolve(live === true) };
  };
  return lookup;
};
