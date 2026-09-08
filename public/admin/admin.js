(function () {
  "use strict";

  var gate = document.getElementById("gate");
  var app = document.getElementById("app");
  var gateForm = document.getElementById("gateForm");
  var tokenInput = document.getElementById("tokenInput");
  var gateError = document.getElementById("gateError");
  var refreshBtn = document.getElementById("refreshBtn");
  var logoutBtn = document.getElementById("logoutBtn");
  var lastRefreshed = document.getElementById("lastRefreshed");
  var providerRows = document.getElementById("providerRows");
  var providerCount = document.getElementById("providerCount");
  var saveSettingsBtn = document.getElementById("saveSettingsBtn");
  var settingsSaveMsg = document.getElementById("settingsSaveMsg");
  var errorBanner = document.getElementById("errorBanner");

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.remove("hidden");
  }
  function clearError() {
    errorBanner.classList.add("hidden");
    errorBanner.textContent = "";
  }

  var settingsFields = {
    timeoutMs: document.getElementById("s_timeoutMs"),
    minSizeGB: document.getElementById("s_minSizeGB"),
    maxPerProvider: document.getElementById("s_maxPerProvider"),
    maxTotal: document.getElementById("s_maxTotal"),
    sortBy: document.getElementById("s_sortBy"),
  };

  var token = sessionStorage.getItem("knoxAdminToken") || "";

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "x-admin-token": token, "Content-Type": "application/json" }, opts.headers || {});
    return fetch("/api/admin" + path, opts).then(function (r) {
      if (r.status === 401) throw new Error("unauthorized");
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || "request failed");
        return body;
      });
    });
  }

  function showApp() {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    loadSettings();
    loadProviders();
  }

  function showGate(message) {
    app.classList.add("hidden");
    gate.classList.remove("hidden");
    gateError.textContent = message || "";
  }

  gateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    token = tokenInput.value.trim();
    api("/ping")
      .then(function () {
        sessionStorage.setItem("knoxAdminToken", token);
        showApp();
      })
      .catch(function () {
        gateError.textContent = "That token was rejected.";
      });
  });

  logoutBtn.addEventListener("click", function () {
    sessionStorage.removeItem("knoxAdminToken");
    token = "";
    showGate();
  });

  refreshBtn.addEventListener("click", loadProviders);

  function loadSettings() {
    api("/settings").then(function (data) {
      var s = data.settings || {};
      settingsFields.timeoutMs.value = s.timeoutMs || "";
      settingsFields.minSizeGB.value = s.minSizeGB != null ? s.minSizeGB : "";
      settingsFields.maxPerProvider.value = s.maxPerProvider || "";
      settingsFields.maxTotal.value = s.maxTotal || "";
      settingsFields.sortBy.value = s.sortBy || "quality";
    });
  }

  saveSettingsBtn.addEventListener("click", function () {
    clearError();
    var patch = {
      timeoutMs: parseInt(settingsFields.timeoutMs.value, 10),
      minSizeGB: parseFloat(settingsFields.minSizeGB.value),
      maxPerProvider: parseInt(settingsFields.maxPerProvider.value, 10),
      maxTotal: parseInt(settingsFields.maxTotal.value, 10),
      sortBy: settingsFields.sortBy.value,
    };
    api("/settings", { method: "POST", body: JSON.stringify(patch) })
      .then(function () {
        settingsSaveMsg.textContent = "Saved.";
        setTimeout(function () {
          settingsSaveMsg.textContent = "";
        }, 1800);
      })
      .catch(function (err) {
        showError(err.message);
      });
  });

  function formatTestResult(status) {
    if (!status) return '<span class="test-result hint">not tested yet</span>';
    if (status.ok) {
      return (
        '<span class="test-result ok">' + status.streamCount + " streams · " + status.ms + "ms</span>"
      );
    }
    return '<span class="test-result fail">' + (status.error || "failed") + "</span>";
  }

  function rowHtml(p) {
    var types = (p.supportedTypes || [])
      .map(function (t) {
        return '<span class="type-chip">' + t + "</span>";
      })
      .join("");
    var loadCell = p.loaded
      ? '<span class="load-ok">loaded</span>'
      : '<span class="load-broken">' + (p.loadError || "broken") + "</span>";

    return (
      '<tr data-id="' + p.id + '">' +
      '<td><label class="switch"><input type="checkbox" class="toggle" ' + (p.enabled ? "checked" : "") + " />" +
      '<span class="track"></span></label></td>' +
      "<td><span class=\"provider-name\">" + p.name + '</span><span class="provider-id">' + p.id + "</span></td>" +
      "<td>" + types + "</td>" +
      "<td>" + loadCell + "</td>" +
      '<td class="test-cell">' + formatTestResult(p.status) + "</td>" +
      '<td class="row-actions">' +
      '<button class="btn test-btn" type="button">Test</button>' +
      '<button class="btn reload-btn" type="button">Reload</button>' +
      "</td>" +
      "</tr>"
    );
  }

  function loadProviders() {
    api("/providers").then(function (data) {
      var providers = data.providers || [];
      providerCount.textContent = "(" + providers.length + " total, " + providers.filter(function (p) { return p.enabled; }).length + " enabled)";
      providerRows.innerHTML = providers.map(rowHtml).join("");
      lastRefreshed.textContent = "updated " + new Date().toLocaleTimeString();
      bindRowEvents();
    });
  }

  function bindRowEvents() {
    providerRows.querySelectorAll("tr").forEach(function (row) {
      var id = row.getAttribute("data-id");

      row.querySelector(".toggle").addEventListener("change", function (e) {
        clearError();
        api("/providers/" + id + "/toggle", {
          method: "POST",
          body: JSON.stringify({ enabled: e.target.checked }),
        }).catch(function (err) {
          e.target.checked = !e.target.checked;
          showError(err.message);
        });
      });

      row.querySelector(".test-btn").addEventListener("click", function (e) {
        var btn = e.target;
        var cell = row.querySelector(".test-cell");
        btn.disabled = true;
        cell.innerHTML = '<span class="test-result hint">testing…</span>';
        api("/providers/" + id + "/test", { method: "POST" })
          .then(function (result) {
            cell.innerHTML = formatTestResult(result);
          })
          .catch(function (err) {
            cell.innerHTML = '<span class="test-result fail">' + err.message + "</span>";
          })
          .finally(function () {
            btn.disabled = false;
          });
      });

      row.querySelector(".reload-btn").addEventListener("click", function () {
        api("/providers/" + id + "/reload", { method: "POST" }).then(loadProviders);
      });
    });
  }

  if (token) {
    api("/ping").then(showApp).catch(function () {
      sessionStorage.removeItem("knoxAdminToken");
      showGate();
    });
  } else {
    showGate();
  }
})();
