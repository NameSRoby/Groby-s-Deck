/** Only first-party feature manifests may exceed a 64 KiB frame. Keep their
 * larger flow/catalog trees bounded without changing third-party mod limits. */
module.exports = (maxFrameBytes) =>
  maxFrameBytes > 65536 ? { maxNodes: 40000, maxDepth: 32 } : {};
