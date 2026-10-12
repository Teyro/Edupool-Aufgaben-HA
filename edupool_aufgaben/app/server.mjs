// Edupool Aufgaben – Home-Assistant-Add-on
//
// Liest deine Aufgaben (Karten in deiner Aufgabenfarbe) aus Edupool Boards, zeigt sie in einer
// eigenen Seite in der Seitenleiste (Ingress) und meldet die Zahl der offenen Aufgaben als
// Sensor sensor.edupool_offene_aufgaben an Home Assistant.
//
// Datenschutz: Der Sensor enthält nur Zahlen (Titel nur, wenn „titel_im_sensor“ an ist), weil
// Home Assistant Sensorwerte dauerhaft speichert. Titel und Beschreibungen liegen nur im Speicher
// dieses Add-ons und werden in der Seite angezeigt.
//
// Anmeldung: offizielle Geräte-Freigabe von Edupool Boards (wie `boards auth login`), nur Lesen.
// Das Add-on sieht kein Passwort; die Freigabe liegt in /data/freigabe.json.
//
// Keine Abhängigkeiten außer Node.js.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const VERSION = "1.0.0";
const DATEN = process.env.DATEN_ORDNER || "/data";
const BASE = (process.env.EDUPOOL_URL || "https://boards.edupool.cloud").replace(/\/$/, "");
const SUPERVISOR = (process.env.SUPERVISOR_URL || "http://supervisor").replace(/\/$/, "");
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || "";
const PORT = Number(process.env.PORT || 8099);
// Ingress-Anfragen kommen nur vom Supervisor; für Tests abschaltbar
const NUR_INGRESS = process.env.NUR_INGRESS !== "0";
const INGRESS_ADRESSE = "172.30.32.2";
const SENSOR = "sensor.edupool_offene_aufgaben";
const ZEIT_LIMIT_MS = 30000;
const MAX_BOARDS = 30;

// ---------------------------------------------------------------- Optionen und Speicher
function liesJSON(datei, ersatz) {
  try { return JSON.parse(fs.readFileSync(path.join(DATEN, datei), "utf8")); } catch { return ersatz; }
}
function schreibJSON(datei, wert) {
  const ziel = path.join(DATEN, datei);
  const tmp = ziel + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(wert), { mode: 0o600 });
  fs.renameSync(tmp, ziel);
}
function loesche(datei) { try { fs.unlinkSync(path.join(DATEN, datei)); } catch { /* war nicht da */ } }

const optionen = Object.assign({ farbe: "#76a5af", intervall_minuten: 15, boards: [], titel_im_sensor: false }, liesJSON("options.json", {}));

function log(...t) { console.log(new Date().toISOString().slice(0, 19).replace("T", " "), ...t); }

// ---------------------------------------------------------------- Edupool-Schnittstelle
let freigabe = liesJSON("freigabe.json", null); // { token }

class EdupoolFehler extends Error {
  constructor(text, status, verbindung = false) { super(text); this.status = status; this.verbindung = verbindung; }
}

async function anfrage(pfad, { methode = "GET", koerper = null, mitToken = true } = {}) {
  const kopf = { Accept: "application/json" };
  if (koerper !== null) kopf["Content-Type"] = "application/json";
  if (mitToken) {
    if (!freigabe || !freigabe.token) throw new EdupoolFehler("Noch nicht verbunden", 0, true);
    kopf.Authorization = "Bearer " + freigabe.token;
  }
  const antwort = await fetch(BASE + pfad, {
    method: methode, headers: kopf, body: koerper === null ? undefined : JSON.stringify(koerper),
    redirect: "error", signal: AbortSignal.timeout(ZEIT_LIMIT_MS),
  });
  const text = await antwort.text();
  let daten = null;
  try { daten = text ? JSON.parse(text) : null; } catch { daten = null; }
  if (mitToken && antwort.status === 401) throw new EdupoolFehler("Die Freigabe ist abgelaufen oder wurde widerrufen – bitte neu verbinden.", 401, true);
  if (mitToken && antwort.status === 403) throw new EdupoolFehler("Die Freigabe reicht nicht aus – beim Verbinden „Lesen“ und „alle Boards“ wählen.", 403, true);
  if (mitToken && antwort.status >= 400) throw new EdupoolFehler(`Edupool antwortet mit HTTP ${antwort.status}`, antwort.status);
  return { status: antwort.status, daten };
}

/** Liste aus einer Antwort: Array direkt oder das erste Array darin */
function liste(daten) {
  if (Array.isArray(daten)) return daten;
  if (daten && typeof daten === "object") for (const v of Object.values(daten)) if (Array.isArray(v)) return v;
  return [];
}

// ---------------------------------------------------------------- Auswertung (wie im Widget)
const KATEGORIEN = [
  { name: "Ideen Backlog", muster: /ideen|backlog|ideas?/ },
  { name: "Zu erledigen", muster: /zu ?erledigen|zu ?tun|to ?do|offen/ },
  { name: "In Bearbeitung", muster: /bearbeitung|in ?arbeit|doing|in ?progress|laufend/ },
  { name: "Wartet auf Feedback", muster: /wartet|warten|feedback|rueckmeldung|rückmeldung|review/ },
  { name: "Erledigt", muster: /erledigt|fertig|done|abgeschlossen|geschafft/, erledigt: true },
];
function kategorieVon(titel) {
  const t = String(titel || "").toLowerCase().replace(/[^a-zäöüß]+/g, " ").trim();
  return KATEGORIEN.findIndex((k) => k.muster.test(t));
}
function farbNorm(c) {
  let h = String(c || "").trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map((x) => x + x).join("");
  return /^[0-9a-f]{6}/.test(h) ? h.slice(0, 6) : "";
}
function ohneHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/[#*_`>]+/g, " ").replace(/\s+/g, " ").trim();
}
function kartenText(k) {
  const texte = [];
  for (const b of Array.isArray(k.blocks) ? k.blocks : []) {
    const t = ohneHtml(b && b.data && (b.data.text || b.data.title || b.data.description));
    if (t) texte.push(t);
  }
  for (const f of [k.description, k.content, k.text]) { const t = ohneHtml(f); if (t) texte.push(t); }
  let titel = k.title && String(k.title).trim() ? String(k.title).trim() : "";
  if (!titel) titel = texte.length ? texte.shift().slice(0, 120) : "Ohne Titel";
  return { titel, beschreibung: (texte.find((t) => t !== titel) || "").slice(0, 400) };
}
function geaendertAm(k) {
  for (const f of [k.updated_at, k.updatedAt, k.modified_at, k.last_modified, k.created_at, k.createdAt]) {
    if (f === undefined || f === null || f === "") continue;
    const t = typeof f === "number" ? (f > 1e12 ? f : f * 1000) : Date.parse(f);
    if (!Number.isNaN(t) && t > 0) return t;
  }
  return 0;
}

async function holeAufgaben() {
  const boards = liste((await anfrage("/api/boards")).daten)
    .filter((b) => b && b.id !== undefined)
    .map((b) => ({ id: b.id, titel: String(b.title || b.name || "Board " + b.id), layout: b.layout_type || "" }));
  const gewaehlt = optionen.boards.length ? boards.filter((b) => optionen.boards.includes(Number(b.id))) : boards.filter((b) => b.layout === "kanban");
  const ziel = farbNorm(optionen.farbe);
  const aufgaben = [];
  for (const b of gewaehlt.slice(0, MAX_BOARDS)) {
    const [sek, kar] = await Promise.all([anfrage(`/api/sections/board/${b.id}`), anfrage(`/api/cards/board/${b.id}`)]);
    const spalten = new Map(liste(sek.daten).map((s) => [s.id, String(s.title || "")]));
    for (const k of liste(kar.daten)) {
      if (farbNorm(k.color) !== ziel) continue;
      const kat = kategorieVon(spalten.get(k.section_id));
      if (kat < 0) continue;
      const { titel, beschreibung } = kartenText(k);
      aufgaben.push({ id: k.id, titel, beschreibung, geaendert: geaendertAm(k), board: b.id, boardTitel: b.titel, kategorie: kat, sort: Number(k.sort_index) || 0 });
    }
  }
  const mehrereBoards = new Set(aufgaben.map((a) => a.board)).size > 1;
  const gruppen = KATEGORIEN.map((k, i) => ({
    name: k.name, erledigt: !!k.erledigt,
    aufgaben: aufgaben.filter((a) => a.kategorie === i).sort((x, y) => (x.board - y.board) || (x.sort - y.sort) || x.titel.localeCompare(y.titel, "de")),
  }));
  const offen = gruppen.filter((g) => !g.erledigt).reduce((n, g) => n + g.aufgaben.length, 0);
  return { ts: Date.now(), offen, mehrereBoards, boards: gewaehlt.length, gruppen };
}

// ---------------------------------------------------------------- Stand und Abruf
let stand = null;       // letztes Ergebnis
let fehler = null;      // { text, verbindung, ts }
let abrufLaeuft = null; // laufender Abruf (Promise), damit nie zwei gleichzeitig laufen

async function abrufen(grund) {
  if (abrufLaeuft) return abrufLaeuft;
  abrufLaeuft = (async () => {
    if (!freigabe) { fehler = { text: "Noch nicht verbunden – in der Seite „Aufgaben“ verbinden.", verbindung: true, ts: Date.now() }; await sensorMelden(); return; }
    try {
      stand = await holeAufgaben();
      fehler = null;
      log(`Abruf (${grund}): ${stand.offen} offene Aufgaben aus ${stand.boards} Board(s)`);
    } catch (e) {
      fehler = { text: e.message || String(e), verbindung: !!e.verbindung, ts: Date.now() };
      log(`Abruf (${grund}) fehlgeschlagen: ${fehler.text}`);
    }
    await sensorMelden();
  })().finally(() => { abrufLaeuft = null; });
  return abrufLaeuft;
}

// ---------------------------------------------------------------- Sensor in Home Assistant
async function sensorMelden() {
  if (!SUPERVISOR_TOKEN) return;
  const attribute = {
    friendly_name: "Edupool offene Aufgaben",
    icon: "mdi:clipboard-check-outline",
    unit_of_measurement: "Aufgaben",
    state_class: "measurement",
  };
  let zustand = "unavailable";
  if (stand) {
    zustand = String(stand.offen);
    attribute.stand = new Date(stand.ts).toISOString();
    for (const g of stand.gruppen) attribute[g.name] = g.aufgaben.length;
    if (optionen.titel_im_sensor) attribute.aufgaben = stand.gruppen.filter((g) => !g.erledigt).flatMap((g) => g.aufgaben.map((a) => a.titel));
  }
  if (fehler) attribute.fehler = fehler.text;
  try {
    const r = await fetch(`${SUPERVISOR}/core/api/states/${SENSOR}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + SUPERVISOR_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ state: zustand, attributes: attribute }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) log(`Sensor nicht gesetzt: HTTP ${r.status}`);
  } catch (e) {
    log("Sensor nicht gesetzt: " + (e.message || e));
  }
}

// ---------------------------------------------------------------- Verbinden (Geräte-Freigabe)
let verbinden = null; // { code, seite, ablauf, status: "wartet" | "fertig" | "abgelaufen" | "abgelehnt" | "fehler", text }

async function verbindenStarten() {
  const r = await anfrage("/api/auth/cli/device", { methode: "POST", koerper: {}, mitToken: false });
  const s = r.daten || {};
  if (!s.device_code || !s.user_code) throw new Error(`Edupool hat keinen Freigabe-Code geliefert (HTTP ${r.status})`);
  const seite = (s.verification_uri || BASE + "/cli/authorize") + "?user_code=" + encodeURIComponent(s.user_code);
  const v = { code: String(s.user_code), seite, ablauf: Date.now() + (Number(s.expires_in) || 600) * 1000, status: "wartet" };
  verbinden = v;
  let intervall = Math.max(2, Number(s.interval) || 5) * 1000;
  // Im Hintergrund abholen, bis bestätigt, abgelehnt oder abgelaufen
  (async () => {
    while (verbinden === v && Date.now() < v.ablauf) {
      await new Promise((ok) => setTimeout(ok, intervall));
      if (verbinden !== v) return;
      try {
        const a = await anfrage("/api/auth/cli/device/token", { methode: "POST", koerper: { device_code: s.device_code }, mitToken: false });
        const d = a.daten || {};
        if (d.token) {
          freigabe = { token: String(d.token), seit: Date.now() };
          schreibJSON("freigabe.json", freigabe);
          v.status = "fertig";
          log("Mit Edupool Boards verbunden");
          abrufen("nach dem Verbinden");
          return;
        }
        if (d.error === "slow_down") { intervall += 5000; continue; }
        if (d.error === "authorization_pending") continue;
        v.status = d.error === "expired" ? "abgelaufen" : /denied/.test(d.error || "") ? "abgelehnt" : "fehler";
        v.text = d.error || d.message || "HTTP " + a.status;
        return;
      } catch (e) {
        log("Freigabe abholen: " + (e.message || e)); // Netzfehler: weiter versuchen
      }
    }
    if (verbinden === v && v.status === "wartet") v.status = "abgelaufen";
  })();
  return v;
}

async function trennen() {
  freigabe = null;
  verbinden = null;
  stand = null;
  loesche("freigabe.json");
  fehler = { text: "Verbindung entfernt.", verbindung: true, ts: Date.now() };
  await sensorMelden();
  log("Verbindung entfernt");
}

// ---------------------------------------------------------------- Webseite (Ingress)
const SEITE = fs.readFileSync(new URL("./seite.html", import.meta.url), "utf8");

function statusJSON() {
  return {
    version: VERSION,
    verbunden: !!freigabe,
    stand, fehler,
    verbinden: verbinden && { code: verbinden.code, seite: verbinden.seite, status: verbinden.status, text: verbinden.text, ablauf: verbinden.ablauf },
    edupool: BASE,
    intervall: optionen.intervall_minuten,
    abrufLaeuft: !!abrufLaeuft,
  };
}

function sende(res, code, typ, inhalt) {
  res.writeHead(code, {
    "Content-Type": typ,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
  });
  res.end(inhalt);
}
const json = (res, code, o) => sende(res, code, "application/json; charset=utf-8", JSON.stringify(o));

const server = http.createServer(async (req, res) => {
  // Nur der Supervisor (Ingress) darf zugreifen – die Seite ist nur über Home Assistant erreichbar
  const von = String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (NUR_INGRESS && von !== INGRESS_ADRESSE) { res.writeHead(403).end(); return; }
  const pfad = new URL(req.url, "http://x").pathname.replace(/\/+$/, "") || "/";
  try {
    if (req.method === "GET" && (pfad === "/" || pfad === "/index.html")) return sende(res, 200, "text/html; charset=utf-8", SEITE);
    if (req.method === "GET" && pfad === "/api/status") return json(res, 200, statusJSON());
    if (req.method === "POST") {
      // gegen fremde Seiten, die Formulare an diese Adresse schicken
      if (req.headers["x-edupool"] !== "1") return json(res, 400, { fehler: "ungültige Anfrage" });
      if (pfad === "/api/aktualisieren") { await abrufen("von Hand"); return json(res, 200, statusJSON()); }
      if (pfad === "/api/verbinden") { await verbindenStarten(); return json(res, 200, statusJSON()); }
      if (pfad === "/api/trennen") { await trennen(); return json(res, 200, statusJSON()); }
    }
    json(res, 404, { fehler: "nicht gefunden" });
  } catch (e) {
    log("Fehler: " + (e.message || e));
    json(res, 500, { fehler: e.message || String(e) });
  }
});

server.listen(PORT, () => {
  log(`Edupool Aufgaben ${VERSION} – Seite auf Port ${PORT}, Abruf alle ${optionen.intervall_minuten} Minuten`);
  abrufen("Start");
  setInterval(() => abrufen("Zeitplan"), optionen.intervall_minuten * 60 * 1000);
});
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { server.close(); process.exit(0); });
