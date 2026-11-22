const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { Readable } = require("node:stream");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groby-sounds-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function wav() {
  const bytes = Buffer.alloc(1644);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(1600, 40);
  return bytes;
}
test("sound library streams, deduplicates, renames and removes private files; interrupted uploads leave nothing", async (t) => {
  const root = fixture(t),
    create = require("../src/domains/control-deck/soundboard-library"),
    library = create(root),
    bytes = wav();
  const clip = await library.upload(
    Readable.from([bytes.subarray(0, 7), bytes.subarray(7)]),
    "Air horn",
  );
  assert.equal(fs.readFileSync(library.read(clip.id)).equals(bytes), true);
  await library.upload(Readable.from([bytes]), "Duplicate");
  assert.equal(library.list().length, 1);
  library.rename(clip.id, "Horn");
  assert.equal(create(root).list()[0].name, "Horn");
  await assert.rejects(library.upload(Readable.from([Buffer.alloc(30)]), "Bad"), {
    code: "soundboard_format_invalid",
  });
  const broken = Readable.from(
    (async function* () {
      yield bytes;
      throw Error("Disconnected");
    })(),
  );
  await assert.rejects(library.upload(broken, "Broken"));
  assert.equal(
    fs.readdirSync(path.join(root, "soundboard")).some((name) => name.endsWith(".upload")),
    false,
  );
  assert.throws(() => library.read("../../private"), { code: "soundboard_clip_missing" });
  library.remove(clip.id);
  assert.equal(create(root).list().length, 0);
  assert.throws(() => library.read(clip.id));
});
test("shared sound actions retain explicit outputs and reject invalid audio controls", async (t) => {
  const root = fixture(t),
    calls = [],
    output = "device:" + "a".repeat(64);
  const service = require("../src/domains/control-deck/soundboard.service")({
    rootDir: root,
    runtimeDir: root,
    platform: "win32",
    request: async (op, payload) => {
      calls.push({ op, payload });
      return op === "soundboard.status"
        ? { available: true, outputs: [{ key: output, name: "Cable input" }], playing: [] }
        : { ok: true };
    },
  });
  const clip = await service.library.upload(Readable.from([wav()]), "Boop");
  await service.refresh(true);
  const action = service.catalog().find((row) => row.id === "native.soundboard.play");
  assert.equal(action.parameters.properties.outputs.enumNames[output], "Cable input");
  await service.execute(action.id, {
    clip: clip.id,
    volume: 35,
    outputs: [output],
    mode: "overlap",
  });
  assert.equal(calls.at(-1).payload.outputs[0], output);
  assert.equal(calls.at(-1).payload.volume, 35);
  assert.equal(calls.at(-1).op, "soundboard.play");
  assert.equal(calls.at(-1).payload.file, service.library.read(clip.id));
  await assert.rejects(
    service.execute(action.id, { clip: clip.id, volume: 101, outputs: [output], mode: "overlap" }),
    { code: "soundboard_request_invalid" },
  );
  await assert.rejects(
    service.execute(action.id, {
      clip: clip.id,
      volume: 35,
      outputs: ["unknown"],
      mode: "overlap",
    }),
    { code: "soundboard_request_invalid" },
  );
  await service.execute(action.id, { clip: clip.id, outputs: ["default", output] });
  assert.deepEqual(calls.at(-1).payload.outputs, ["default", output]);
  assert.equal(calls.at(-1).payload.volume, 80);
  assert.equal(calls.at(-1).payload.mode, "restart");
  await assert.rejects(service.execute(action.id, { clip: clip.id, outputs: [output, output] }), {
    code: "soundboard_request_invalid",
  });
  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(service.execute(action.id, action.defaults, cancel.signal), {
    code: "control_deck_cancelled",
  });
  await service.execute("native.soundboard.stop", {});
  assert.equal(calls.at(-1).op, "soundboard.stop");
});
test("paired virtual cable inputs and headphones can be routed by the same sound action", async (t) => {
  const root = fixture(t);
  const speaker = "device:" + "a".repeat(64);
  const cableA = "device:" + "b".repeat(64);
  const cableB = "device:" + "c".repeat(64);
  const calls = [];
  let capture = [
    { name: "CABLE-A Output (VB-Audio Cable A)", adapter: "VB-Audio Cable A" },
    { name: "CABLE-B Output (Unrelated device)", adapter: "USB recording device" },
    { name: "Microphone (USB recording device)", adapter: "USB recording device" },
  ];
  const soundboard = require("../src/domains/control-deck/soundboard.service")({
    rootDir: root,
    platform: "win32",
    request: async (op, payload) => {
      if (op !== "soundboard.status") {
        calls.push(payload.outputs);
        return { ok: true };
      }
      return {
        available: true,
        playing: [],
        inputs: capture,
        outputs: [
          { key: speaker, name: "Speakers" },
          { key: cableA, name: "CABLE-A Input (VB-Audio Cable A)", adapter: "VB-Audio Cable A" },
          { key: cableB, name: "CABLE-B Input (VB-Audio Cable B)", adapter: "VB-Audio Cable B" },
        ],
      };
    },
  });
  const state = await soundboard.refresh(true);
  assert.deepEqual(
    state.outputs.map((output) => output.name),
    [
      "Speakers",
      "Virtual mic: CABLE-A Output (VB-Audio Cable A)",
      "CABLE-B Input (VB-Audio Cable B)",
    ],
  );
  assert.equal("inputs" in state, false);
  const clip = await soundboard.library.upload(Readable.from([wav()]), "Sound");
  await soundboard.execute("native.soundboard.play", { clip: clip.id, outputs: [speaker, cableA] });
  assert.deepEqual(calls, [[speaker, cableA]]);
  capture = [];
  const disconnected = await soundboard.refresh(true);
  assert.equal(disconnected.outputs[1].name, "CABLE-A Input (VB-Audio Cable A)");
});
test(
  "real Windows helper enumerates outputs and streams an inaudible test without changing mixer volume",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = fixture(t),
      file = path.join(root, "silent.wav");
    fs.writeFileSync(file, wav());
    const bridge = require("../src/domains/control-deck/windows-bridge")({
      rootDir: path.resolve(__dirname, ".."),
      scriptName: "windows-soundboard.ps1",
      idleTimeoutMs: 0,
    });
    t.after(() => bridge.shutdown());
    const state = await bridge.request("soundboard.status", {});
    assert.ok(Array.isArray(state.outputs));
    assert.ok(Array.isArray(state.inputs));
    assert.ok(state.inputs.every((row) => /^device:[a-f0-9]{64}$/.test(row.key)));
    if (!state.outputs.length) return t.skip("No active Windows outputs");
    const clip = "a".repeat(64) + ".wav";
    const result = await bridge.request("soundboard.play", {
      clip,
      file,
      outputs: [state.outputs[0].key],
      volume: 0,
      mode: "restart",
    });
    assert.equal(result.ok, true);
    await bridge.request("soundboard.stop", { clip });
    await assert.rejects(
      bridge.request("soundboard.play", {
        clip,
        file,
        outputs: [state.outputs[0].key, "device:" + "0".repeat(64)],
        volume: 0,
        mode: "restart",
      }),
      { code: "soundboard_output_unavailable" },
    );
    assert.equal(
      (await bridge.request("soundboard.status", {})).playing.length,
      0,
      "a missing output never leaves playback running on the other selected output",
    );
  },
);
module.exports.wav = wav;
