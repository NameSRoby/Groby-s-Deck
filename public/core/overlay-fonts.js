/** Font names stay local. Only an explicitly chosen file is stored with overlay assets. */
(() => {
  const loaded = new Set();
  let installed = [];
  const fallbacks = { system: "system-ui", serif: "Georgia,serif", mono: "ui-monospace,monospace" };
  const assetPath = /^\/api\/stream-overlays\/media\/([a-f0-9-]{36})\.(woff2?|otf|ttf)$/;
  function family(w) {
    if (w.font === "installed" && w.fontFamily)
      return '"' + w.fontFamily.replace(/["\\]/g, "\\$&") + '",system-ui';
    const match = w.font === "uploaded" && assetPath.exec(w.fontAsset);
    if (!match) return fallbacks[w.font] || fallbacks.system;
    const name = "GrobyFont-" + match[1];
    if (!loaded.has(name)) {
      loaded.add(name);
      const face = new FontFace(name, 'url("' + w.fontAsset + '")');
      document.fonts.add(face);
      void face.load().catch(() => document.fonts.delete(face));
    }
    return name + ",system-ui";
  }
  function controls(a, host, w, field) {
    const hint = document.createElement("p");
    if (w.font === "installed") {
      const input = field("Font family name", "fontFamily", "text", { maxLength: 120 }),
        choices = document.createElement("datalist");
      choices.id = "overlayInstalledFonts";
      input.setAttribute("list", choices.id);
      const showChoices = () =>
        choices.replaceChildren(...installed.map((name) => new Option(name)));
      showChoices();
      host.append(choices);
      hint.textContent = "Type an installed font name. OBS needs that font installed too.";
      if (typeof window.queryLocalFonts === "function") {
        const scan = document.createElement("button");
        scan.type = "button";
        scan.textContent = "Browse installed fonts";
        scan.onclick = async () => {
          scan.disabled = true;
          try {
            installed = [...new Set((await window.queryLocalFonts()).map((font) => font.family))]
              .filter((name) => name && name.length <= 120)
              .sort((a, b) => a.localeCompare(b));
            showChoices();
            input.focus();
            input.showPicker?.();
          } catch {
            hint.textContent = installed.length
              ? "Start typing to see matching installed fonts."
              : "The browser did not allow browsing fonts. You can still type a family name.";
          } finally {
            scan.disabled = false;
          }
        };
        host.append(scan);
      }
    } else if (w.font === "uploaded") {
      const label = document.createElement("label"),
        input = document.createElement("input"),
        doc = a.doc,
        ids = a.selected().map((row) => row.id),
        formats = { woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };
      label.textContent = w.fontAsset ? "Replace font file" : "Choose font file";
      input.type = "file";
      input.accept = ".woff,.woff2,.ttf,.otf";
      label.append(input);
      host.append(label);
      hint.textContent = "Use a font file you can use on stream. Uploaded fonts also load in OBS.";
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        input.disabled = true;
        try {
          const type = formats[file.name.split(".").pop().toLowerCase()];
          if (!type || file.size > 5 * 1024 * 1024)
            throw Error("Choose a WOFF, WOFF2, TTF or OTF font under 5 MB.");
          await new FontFace("GrobyFontCheck", await file.arrayBuffer()).load();
          if (a.doc !== doc) throw Error("The draft changed. Choose the font again.");
          const result = await a.request("/fonts", "POST", new File([file], file.name, { type }), {
            "Content-Type": type,
          });
          if (a.doc !== doc) throw Error("The draft changed. Choose the font again.");
          a.change(() => {
            for (const row of doc.widgets)
              if (ids.includes(row.id)) {
                row.font = "uploaded";
                row.fontAsset = result.url;
              }
          });
          a.notice("Font ready. Save the overlay to use it in OBS.");
        } catch (error) {
          a.notice(error.message);
        } finally {
          input.disabled = false;
          input.value = "";
        }
      };
    } else return;
    host.append(hint);
  }
  globalThis.OverlayFonts = { family, controls };
})();
