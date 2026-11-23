/** Each variation is editable without code and can be tested with the same rules as OBS. */
globalThis.setupOverlayAlertControls = (a, host, w) => {
  const heading = document.createElement("h3");
  heading.textContent = "Alert media & sound";
  host.append(heading);
  const note = document.createElement("p");
  note.textContent =
    "Set the default, then add variations for event type, amount or subscription tier. Highest priority wins; exact amounts win ties, then the highest minimum. Unmatched events use the default.";
  host.append(note);
  function control(parent, target, key, label, type = "text", options) {
    const row = document.createElement("label"),
      input = document.createElement(options ? "select" : "input");
    row.textContent = label;
    input.setAttribute("aria-label", label);
    if (options) input.append(...options.map(([id, name]) => new Option(name, id)));
    else input.type = type;
    if (type === "checkbox") {
      input.checked = target[key];
      row.className = "check";
    } else input.value = target[key] ?? "";
    if (type === "number") {
      input.min = "0";
      input.max = key === "volume" || key === "priority" ? "100" : "1000000000";
      input.step = "any";
    }
    input.onchange = () => {
      if (!input.reportValidity()) return;
      const value =
        type === "checkbox"
          ? input.checked
          : type === "number"
            ? input.value === ""
              ? null
              : Number(input.value)
            : input.value;
      a.change(() => {
        target[key] = value;
        if (key === "event" && !w.events.includes(value)) w.events.push(value);
      }, false);
    };
    row.append(input);
    parent.append(row);
    return input;
  }
  function media(parent, target, key, name, accept) {
    const input = control(parent, target, key, name + " URL");
    input.type = "text";
    input.placeholder = "HTTPS URL or uploaded file";
    const row = document.createElement("label"),
      upload = document.createElement("input");
    row.textContent = "Upload " + name.toLowerCase();
    upload.type = "file";
    upload.accept = accept;
    upload.onchange = async () => {
      const file = upload.files?.[0];
      if (!file) return;
      upload.disabled = true;
      try {
        const type = file.type === "audio/x-wav" ? "audio/wav" : file.type;
        const result = await a.request("/media", "POST", file, { "Content-Type": type });
        a.change(() => {
          target[key] = result.url;
        }, false);
        input.value = result.url;
      } catch (error) {
        a.notice(error.message);
      } finally {
        upload.disabled = false;
        upload.value = "";
      }
    };
    row.append(upload);
    parent.append(row);
  }
  function settings(parent, target) {
    media(
      parent,
      target,
      "mediaUrl",
      "Image, GIF or video",
      "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm",
    );
    control(parent, target, "mediaType", "Media type", "text", [
      ["auto", "Detect from URL"],
      ["image", "Image / GIF"],
      ["video", "Video (including URLs without an extension)"],
    ]);
    media(parent, target, "soundUrl", "Sound", "audio/mpeg,audio/wav,audio/ogg,audio/mp4");
    control(parent, target, "volume", "Volume (%)", "number");
    control(parent, target, "mediaMuted", "Mute video's own audio", "checkbox");
    control(parent, target, "layout", "Media layout", "text", [
      ["above", "Media above text"],
      ["beside", "Media beside text"],
      ["background", "Text over media"],
      ["text", "Text only"],
    ]);
    control(parent, target, "mediaFit", "Media fitting", "text", [
      ["contain", "Fit inside"],
      ["cover", "Fill and crop"],
    ]);
    control(parent, target, "textDelay", "Text delay (seconds)", "number");
  }
  settings(host, w.alert);
  for (const variant of w.alertVariants) {
    const panel = document.createElement("details"),
      summary = document.createElement("summary");
    panel.className = "alertVariation";
    panel.dataset.variantId = variant.id;
    summary.textContent = variant.name;
    panel.append(summary);
    host.append(panel);
    const name = control(panel, variant, "name", "Variation name");
    name.addEventListener("change", () => {
      summary.textContent = variant.name;
    });
    control(panel, variant, "enabled", "Enabled", "checkbox");
    control(
      panel,
      variant,
      "event",
      "Event type",
      "text",
      OverlayAlertRules.events.map((event) => [
        event,
        event.replace("channel.", "").replaceAll("_", " "),
      ]),
    );
    control(panel, variant, "minimum", "Minimum amount / viewers / months", "number");
    control(
      panel,
      variant,
      "maximum",
      "Maximum (blank for no limit; same as minimum for exact)",
      "number",
    );
    control(panel, variant, "tier", "Subscription tier", "text", [
      ["", "Any tier"],
      ["1000", "Tier 1"],
      ["2000", "Tier 2"],
      ["3000", "Tier 3"],
    ]);
    control(panel, variant, "currency", "Currency filter (optional ISO code)");
    control(panel, variant, "priority", "Priority", "number");
    control(
      panel,
      variant,
      "text",
      "Variation message (${name}, ${amount}, ${message}, ${tier}, ${currency})",
    );
    control(panel, variant, "lifetime", "Variation duration (seconds)", "number");
    settings(panel, variant);
    const test = document.createElement("button");
    test.textContent = "Test variation";
    test.onclick = () => {
      a.testWidget({ ...w, events: [variant.event] });
      a.$("sampleAmount").value = variant.minimum;
      a.$("sampleTier").value = variant.tier || "1000";
    };
    const remove = document.createElement("button");
    remove.textContent = "Remove variation";
    remove.onclick = () =>
      a.change(() => {
        w.alertVariants = w.alertVariants.filter((v) => v !== variant);
      });
    panel.append(test, remove);
  }
  const add = document.createElement("button");
  add.textContent = "Add alert variation";
  add.disabled = w.alertVariants.length >= 32;
  add.onclick = () =>
    a.change(() => {
      w.alertVariants.push(
        OverlayAlertRules.variants([
          {
            ...w.alert,
            id: GrobyRandomId(),
            name: "Variation " + (w.alertVariants.length + 1),
            text: w.text,
            lifetime: w.lifetime,
            event: w.events[0] || "channel.cheer",
          },
        ])[0],
      );
    });
  const preview = document.createElement("label"),
    sound = document.createElement("input");
  sound.type = "checkbox";
  sound.checked = a.previewAudio === true;
  sound.onchange = () => {
    a.previewAudio = sound.checked;
  };
  preview.append(sound, " Enable sound for sample alerts in this editor");
  host.append(add, preview);
};
