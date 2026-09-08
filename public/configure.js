(function () {
  "use strict";

  var providerList = document.getElementById("providerList");
  var bulbStrip = document.getElementById("bulbStrip");
  var enabledCountEl = document.getElementById("enabledCount");
  var totalCountEl = document.getElementById("totalCount");
  var manifestUrlInput = document.getElementById("manifestUrl");
  var installBtn = document.getElementById("installBtn");
  var copyBtn = document.getElementById("copyBtn");
  var minSizeGB = document.getElementById("minSizeGB");
  var minSizeGBOut = document.getElementById("minSizeGBOut");
  var timeoutMs = document.getElementById("timeoutMs");
  var sortBy = document.getElementById("sortBy");
  var selectAllBtn = document.getElementById("selectAll");
  var selectNoneBtn = document.getElementById("selectNone");

  var providers = []; // raw manifest.scrapers, fetched from the *rendered* addon manifest via /manifest.json is not enough (no per-provider list) — use a small internal endpoint instead.
  var checkboxes = {}; // id -> input element
  var bulbs = {}; // id -> bulb element

  function base64url(json) {
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(json))));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function currentUserConfig() {
    var providerConfig = {};
    providers.forEach(function (p) {
      providerConfig[p.id] = !!(checkboxes[p.id] && checkboxes[p.id].checked);
    });
    return {
      providers: providerConfig,
      settings: {
        minSizeGB: parseFloat(minSizeGB.value) || 0,
        timeoutMs: parseInt(timeoutMs.value, 10),
        sortBy: sortBy.value,
      },
    };
  }

  function refreshTicket() {
    var cfg = currentUserConfig();
    var enabledIds = Object.keys(cfg.providers).filter(function (id) {
      return cfg.providers[id];
    });

    // bulbs + counts
    providers.forEach(function (p) {
      var bulb = bulbs[p.id];
      if (bulb) bulb.classList.toggle("lit", cfg.providers[p.id]);
      var card = document.getElementById("card-" + p.id);
      if (card) card.classList.toggle("disabled", !cfg.providers[p.id]);
    });
    enabledCountEl.textContent = String(enabledIds.length);
    totalCountEl.textContent = String(providers.length);

    // manifest URL
    var b64 = base64url(cfg);
    var origin = window.location.origin;
    var manifestUrl = origin + "/" + b64 + "/manifest.json";
    manifestUrlInput.value = manifestUrl;
    installBtn.href = "stremio://" + manifestUrl.replace(/^https?:\/\//, "");

    // min size label
    var v = parseFloat(minSizeGB.value) || 0;
    minSizeGBOut.textContent = v === 0 ? "0 GB — no filter" : v.toFixed(1) + " GB minimum";
  }

  function renderProviders() {
    providerList.innerHTML = "";
    var strip = document.createDocumentFragment();
    var list = document.createDocumentFragment();

    providers.forEach(function (p) {
      // bulb
      var bulb = document.createElement("span");
      bulb.className = "bulb";
      bulb.title = p.name;
      bulbs[p.id] = bulb;
      strip.appendChild(bulb);

      // card
      var card = document.createElement("div");
      card.className = "ticket-card";
      card.id = "card-" + p.id;

      var label = document.createElement("label");
      label.className = "switch";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!p.enabled;
      input.addEventListener("change", refreshTicket);
      checkboxes[p.id] = input;
      var track = document.createElement("span");
      track.className = "track";
      label.appendChild(input);
      label.appendChild(track);

      var meta = document.createElement("div");
      meta.className = "meta";

      var nameRow = document.createElement("div");
      nameRow.className = "name-row";
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = p.name || p.id;
      var langs = document.createElement("span");
      langs.className = "langs";
      langs.textContent = (p.contentLanguage || []).join("/");
      nameRow.appendChild(name);
      if (p.contentLanguage && p.contentLanguage.length) nameRow.appendChild(langs);

      var desc = document.createElement("p");
      desc.className = "desc";
      desc.textContent = p.description || "";

      var chips = document.createElement("div");
      chips.className = "chips";
      (p.formats || []).forEach(function (fmt) {
        var chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = fmt;
        chips.appendChild(chip);
      });
      (p.supportedTypes || []).forEach(function (t) {
        var chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = t;
        chips.appendChild(chip);
      });

      meta.appendChild(nameRow);
      if (p.description) meta.appendChild(desc);
      meta.appendChild(chips);

      card.appendChild(label);
      card.appendChild(meta);
      list.appendChild(card);
    });

    bulbStrip.appendChild(strip);
    providerList.appendChild(list);
  }

  function loadProviders() {
    fetch("/api/providers")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        providers = data.providers || [];
        renderProviders();
        refreshTicket();
      })
      .catch(function () {
        providerList.innerHTML = '<p class="hint">Could not load the provider list. Refresh to try again.</p>';
      });
  }

  minSizeGB.addEventListener("input", refreshTicket);
  timeoutMs.addEventListener("change", refreshTicket);
  sortBy.addEventListener("change", refreshTicket);

  selectAllBtn.addEventListener("click", function () {
    providers.forEach(function (p) {
      checkboxes[p.id].checked = true;
    });
    refreshTicket();
  });
  selectNoneBtn.addEventListener("click", function () {
    providers.forEach(function (p) {
      checkboxes[p.id].checked = false;
    });
    refreshTicket();
  });

  copyBtn.addEventListener("click", function () {
    manifestUrlInput.select();
    navigator.clipboard && navigator.clipboard.writeText(manifestUrlInput.value);
    copyBtn.textContent = "Copied";
    setTimeout(function () {
      copyBtn.textContent = "Copy";
    }, 1200);
  });

  loadProviders();
})();
