// IServ-Störungsmeldungen für das Add-on
//
// Anmeldung wie im Browser (und wie im Scriptable-Widget „IServ-Störungen“): IServ-Login,
// vorgeschaltete Anmeldung (z. B. „Login mit Schuldock“), IServ-Zwei-Faktor und die
// Zwischenseiten /iserv/auth/auth. Weiterleitungen werden selbst verfolgt, damit keine Cookies
// verloren gehen. Gelesen wird nur – Seiten zum Übernehmen, Ändern oder Löschen werden nie
// aufgerufen.

import crypto from "node:crypto";

const ZEIT_LIMIT_MS = 30000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const AKTION = /logout|abmelden|delete|loeschen|löschen|remove|\/add\b|hinzu|\/edit\b|\/new\b|create|update|confirm|accept|reject|assign|(ü|ue)bernehm|close|schlie(ß|ss)en|status|toggle/i;

export class IServFehler extends Error {
  constructor(text, art = {}) { super(text); Object.assign(this, art); }
}

// ---------------------------------------------------------------- Text-Hilfen
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß" };
export function entities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in ENTITIES ? ENTITIES[n] : m));
}
export function text(html) {
  return entities(String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function absolut(href, von) { try { return new URL(href, von).toString(); } catch { return href; } }
const formularListe = (html) => String(html || "").match(/<form[\s\S]*?<\/form>/gi) || [];
const eingabeName = (i) => (i.match(/name=["']([^"']+)/i) || [])[1] || "";
const eingabeTyp = (i) => ((i.match(/type=["']([^"']+)/i) || [])[1] || "text").toLowerCase();
const wertVon = (i) => entities((i.match(/value=["']([^"']*)/i) || [])[1] || "");

// ---------------------------------------------------------------- TOTP (RFC 6238, SHA-1, 30 s, 6 Stellen)
function base32(s) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let puffer = 0, bits = 0;
  const bytes = [];
  for (const c of String(s || "").toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    puffer = (puffer << 5) | abc.indexOf(c); bits += 5;
    if (bits >= 8) { bytes.push((puffer >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
export function totp(geheim, zeit = Date.now()) {
  const zaehler = Buffer.alloc(8);
  zaehler.writeBigUInt64BE(BigInt(Math.floor(zeit / 30000)));
  const h = crypto.createHmac("sha1", base32(geheim)).update(zaehler).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}

// ---------------------------------------------------------------- Formulare der Anmeldung
export function istLoginSeite(s) { return /\/iserv\/(auth|app)\/login/i.test(s.url) || /name=["']_password["']/i.test(s.body || ""); }

export function codeFormular(html) {
  for (const f of formularListe(html)) {
    if (/name=["']_password["']/i.test(f)) continue;
    const eingaben = f.match(/<input[^>]*>/gi) || [];
    const code = eingaben.find((i) => !/type=["'](hidden|checkbox|radio|submit|button|password)["']/i.test(i)
      && /name=["'][^"']*(code|otp|totp|token|2fa|auth|factor)[^"']*["']/i.test(i));
    if (!code) continue;
    const felder = {};
    for (const i of eingaben) {
      const n = eingabeName(i);
      if (!n) continue;
      if (eingabeTyp(i) === "hidden") felder[n] = wertVon(i);
      if (eingabeTyp(i) === "checkbox" && /trust|remember|vertrau|merken/i.test(i)) felder[n] = wertVon(i) || "1";
    }
    // IServ: sechs Kästchen …digit_1 … digit_6, zusammengesetzt im versteckten Feld „otp“
    const ziffern = eingaben.filter((i) => eingabeTyp(i) !== "hidden" && /name=["'][^"']*digit_?\d[^"']*["']/i.test(i))
      .map(eingabeName).sort((a, b) => +(a.match(/digit_?(\d)/i)[1]) - +(b.match(/digit_?(\d)/i)[1]));
    const versteckt = eingaben.filter((i) => eingabeTyp(i) === "hidden" && /name=["'][^"']*(otp|code|totp)[^"'\]]*\]?["']/i.test(i) && !/csrf|token/i.test(i)).map(eingabeName);
    const knopf = (f.match(/<button[^>]*name=["'][^"']+["'][^>]*>/i) || [])[0];
    if (knopf && !/type=["']button["']/i.test(knopf)) felder[eingabeName(knopf)] = wertVon(knopf);
    return { action: entities((f.match(/<form[^>]*action=["']([^"']*)["']/i) || [])[1] || ""), felder, codeFeld: eingabeName(code), ziffern, versteckt };
  }
  return null;
}

function anmeldeFormular(html) {
  const formen = formularListe(html).filter((f) => !/logout|abmelden/i.test((f.match(/<form[^>]*>/i) || [""])[0]));
  return formen.find((f) => /type=["']password["']/i.test(f))
    || formen.find((f) => (f.match(/<input[^>]*>/gi) || []).some((i) => /user|login|account|mail/i.test(eingabeName(i)) && !/hidden|checkbox|submit/.test(eingabeTyp(i))))
    || null;
}

function ssoLink(html, von) {
  for (const m of String(html || "").matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = entities(m[1]), t = text(m[2]);
    if (/schuldock|single sign|sso|oauth|openid|oidc|saml|login mit|anmelden mit/i.test(t + " " + href) && !/logout|hilfe|help|datenschutz/i.test(href)) return absolut(href, von);
  }
  return null;
}

/** Weiterleitung ohne Klick: <meta refresh> oder IServs Zwischenseite /iserv/auth/auth */
function weiterleitung(body, von) {
  const b = String(body || "");
  for (const m of b.match(/<meta\b[^>]*>/gi) || []) {
    if (!/http-equiv=["']?refresh/i.test(m)) continue;
    const u = (m.match(/content=["'][^"']*?url=([^"'>]+)["']/i) || [])[1];
    if (u) return absolut(entities(u.trim()), von);
  }
  if (/\/iserv\/auth\/auth\b/.test(von)) {
    const u = (b.match(/url=([^"'\s>]+)/i) || [])[1] || (b.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (u) return absolut(entities(u), von);
  }
  return null;
}

// ---------------------------------------------------------------- Störungsmeldungen auslesen
export function zeitAus(s) {
  if (!s) return 0;
  const t = String(s);
  if (/\d{4}-\d{2}-\d{2}/.test(t)) { const d = Date.parse(t); return Number.isNaN(d) ? 0 : d; }
  const m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (!m) return 0;
  const jahr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return new Date(jahr, +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime();
}
function nameSchoen(n) {
  const t = String(n || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : t;
}
const ERLEDIGT = /erledigt|geschlossen|behoben|gel(ö|oe)st|abgeschlossen|closed|resolved|done|fertig/i;
const UNBESETZT = /wer mach|niemand|unbearbeitet|^neu$|^offen$|new|open/i;
const SPALTEN = [
  ["bearbeiter", /bearbeit|zust(ä|ae)ndig|(ü|ue)bernommen|zugewiesen|verantwortlich|assign|techniker/i],
  ["autor", /gemeldet von|erstellt von|eingereicht von|^von$|autor|verfasser|melder|ersteller|absender|benutzer|gemeldet durch/i],
  ["titel", /betreff|titel|title|st(ö|oe)rung|problem|bezeichnung|thema|subject|kurzbeschreibung/i],
  ["inhalt", /beschreibung|inhalt|nachricht|text|details|description/i],
  ["status", /status|zustand/i],
  ["ort", /raum|ort|ger(ä|ae)t|standort|location/i],
  ["kategorie", /kategorie|bereich|typ|art$/i],
  ["aktualisiert", /aktualisier|ge(ä|ae)ndert|update/i],
  ["datum", /datum|erstellt|gemeldet|zeit|eingang|date|created/i],
];
function spaltenZuordnen(kopf) {
  const z = {}, belegt = new Set();
  for (const [feld, re] of SPALTEN) {
    const i = kopf.findIndex((k, j) => !belegt.has(j) && re.test(String(k || "").trim()));
    if (i >= 0) { z[feld] = i; belegt.add(i); }
  }
  return z;
}

export function parseStoerungen(html, von) {
  const liste = [];
  for (const tab of String(html || "").match(/<table[\s\S]*?<\/table>/gi) || []) {
    const zeilen = tab.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    if (zeilen.length < 2) continue;
    const z = spaltenZuordnen((zeilen[0].match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(text));
    if (z.titel === undefined || (z.datum === undefined && z.autor === undefined)) continue;
    for (const zeile of zeilen.slice(1)) {
      const zellen = (zeile.match(/<td[\s\S]*?<\/td>/gi) || []).map(text);
      if (zellen.length < 2) continue;
      const wert = (f) => (z[f] !== undefined ? String(zellen[z[f]] || "").trim() : "");
      const titel = wert("titel");
      if (!titel) continue;
      // Link der Meldung: der erste Link der Zeile, der keine Aktion ist
      const links = [...zeile.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["']/gi)].map((m) => absolut(entities(m[1]), von)).filter((u) => !AKTION.test(u));
      const status = wert("status");
      liste.push({
        titel, inhalt: wert("inhalt"), autor: nameSchoen(wert("autor")),
        bearbeiter: nameSchoen(wert("bearbeiter").replace(/^[-–—]$|^(niemand|keine?r?)$/i, "")),
        datum: zeitAus(wert("datum")), aktualisiert: zeitAus(wert("aktualisiert")),
        status, kategorie: wert("kategorie"), ort: wert("ort"),
        erledigt: ERLEDIGT.test(status), unbesetzt: !ERLEDIGT.test(status) && (UNBESETZT.test(status) || !status),
        url: links[0] || "",
      });
    }
  }
  return liste;
}

const BEARBEITER_LABEL = /bearbeit|zust(ä|ae)ndig|(ü|ue)bernommen|zugewiesen|verantwortlich|assign|techniker/i;
export function bearbeiterAusDetail(html) {
  const s = String(html || "");
  const felder = [];
  for (const m of s.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) felder.push([text(m[1]), text(m[2])]);
  for (const m of s.matchAll(/<tr\b[^>]*>\s*<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)) felder.push([text(m[1]), text(m[2])]);
  for (const m of s.matchAll(/<(?:strong|b|label)\b[^>]*>([^<]{2,40}?):?\s*<\/(?:strong|b|label)>\s*([^<]{1,120})/gi)) felder.push([text(m[1]), text(m[2])]);
  const feld = felder.find(([k, v]) => BEARBEITER_LABEL.test(k) && v && !/^[-–—]$/.test(v));
  if (feld) return nameSchoen(feld[1]);
  const verlauf = text(s).match(/([A-ZÄÖÜ][\wäöüß-]+(?: [A-ZÄÖÜ][\wäöüß-]+){1,2}) hat (?:die Meldung |die Störung |sie )?(?:übernommen|den Status auf „?in Arbeit)/);
  return verlauf ? verlauf[1] : "";
}

// ---------------------------------------------------------------- Klient mit Cookie-Speicher
export class IServKlient {
  /**
   * @param {object} o server (z. B. s1234.schuldock.de), benutzer, passwort, totpGeheim,
   *   erlaubteHosts (weitere Anmeldeseiten), log, protokoll ("https:" – für Tests "http:")
   */
  constructor(o) {
    this.server = String(o.server || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    this.protokoll = o.protokoll || "https:";
    this.basis = `${this.protokoll}//${this.server}`;
    this.benutzer = o.benutzer || "";
    this.passwort = o.passwort || "";
    this.totpGeheim = o.totpGeheim || "";
    this.erlaubteHosts = (o.erlaubteHosts || []).map((h) => String(h).toLowerCase());
    this.log = o.log || (() => {});
    this.cookies = new Map(); // domain -> Map(name -> wert)
    this.handCode = null;     // Code aus der Seite, wenn kein Schlüssel hinterlegt ist
    this._fetch = o.fetch || globalThis.fetch; // für Tests ersetzbar
  }

  // --- Cookies
  merke(url, setCookies) {
    const host = new URL(url).hostname;
    for (const zeile of setCookies) {
      const [paar, ...attr] = zeile.split(";");
      const i = paar.indexOf("=");
      if (i < 1) continue;
      const name = paar.slice(0, i).trim(), wert = paar.slice(i + 1).trim();
      const dom = ((attr.find((a) => /^\s*domain=/i.test(a)) || "").split("=")[1] || host).trim().replace(/^\./, "").toLowerCase();
      // Nur für den eigenen Host oder eine übergeordnete Domain annehmen
      if (dom !== host && !host.endsWith("." + dom)) continue;
      const abgelaufen = attr.some((a) => /^\s*max-age=0/i.test(a) || (/^\s*expires=/i.test(a) && Date.parse(a.split("=")[1]) < Date.now()));
      if (!this.cookies.has(dom)) this.cookies.set(dom, new Map());
      if (abgelaufen) this.cookies.get(dom).delete(name); else this.cookies.get(dom).set(name, wert);
    }
  }
  cookieKopf(url) {
    const host = new URL(url).hostname;
    const teile = [];
    for (const [dom, m] of this.cookies) if (host === dom || host.endsWith("." + dom)) for (const [n, w] of m) teile.push(`${n}=${w}`);
    return teile.join("; ");
  }

  /** Passwort nur an IServ selbst oder an eine erlaubte Anmeldeseite senden */
  hostErlaubt(url) {
    const u = new URL(url);
    if (u.protocol !== this.protokoll) throw new IServFehler("Die Anmeldeseite ist nicht verschlüsselt – abgebrochen.", { zugangsdaten: true });
    const host = u.hostname.toLowerCase();
    if (host === this.server || this.erlaubteHosts.includes(host)) return;
    // gleiche Domain wie IServ (z. B. auth.iam.schuldock.de zu s1234.schuldock.de)
    const domain = this.server.split(".").slice(-2).join(".");
    if (host === domain || host.endsWith("." + domain)) return;
    throw new IServFehler(`Die Anmeldung läuft über ${host}. Bitte in den Add-on-Optionen unter „iserv_anmeldeseiten“ eintragen, wenn das eure Anmeldeseite ist.`, { zugangsdaten: true, sperren: false });
  }

  /** Seite laden; Weiterleitungen (HTTP, meta, Zwischenseite) selbst verfolgen */
  async hole(url, { methode = "GET", form = null, referer } = {}) {
    let ziel = /^https?:/.test(url) ? url : this.basis + url;
    let m = methode, koerper = form ? new URLSearchParams(form).toString() : null;
    for (let i = 0; i < 12; i++) {
      const kopf = { "User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9", Accept: "text/html,application/xhtml+xml,*/*;q=0.8" };
      const c = this.cookieKopf(ziel);
      if (c) kopf.Cookie = c;
      if (koerper !== null) { kopf["Content-Type"] = "application/x-www-form-urlencoded"; kopf.Origin = new URL(ziel).origin; }
      if (referer) kopf.Referer = referer;
      const r = await this._fetch(ziel, { method: m, headers: kopf, body: koerper ?? undefined, redirect: "manual", signal: AbortSignal.timeout(ZEIT_LIMIT_MS) });
      this.merke(ziel, r.headers.getSetCookie ? r.headers.getSetCookie() : []);
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get("location")) {
        referer = ziel;
        ziel = absolut(r.headers.get("location"), ziel);
        if (r.status === 303 || ((r.status === 301 || r.status === 302) && m === "POST")) { m = "GET"; koerper = null; }
        continue;
      }
      const body = await r.text();
      const weiter = weiterleitung(body, ziel);
      if (weiter && body.length < 20000) { referer = ziel; ziel = weiter; m = "GET"; koerper = null; continue; }
      return { body, url: ziel, status: r.status };
    }
    throw new IServFehler("Zu viele Weiterleitungen");
  }

  async autoFormulare(seite) {
    for (let i = 0; i < 4; i++) {
      const f = formularListe(seite.body).find((x) => {
        const e = x.match(/<input[^>]*>/gi) || [];
        return e.length && e.every((i2) => /hidden|submit/.test(eingabeTyp(i2)))
          && (/SAMLResponse|RelayState|name=["'](code|state|id_token|session_state)["']/i.test(x) || /\.submit\(\)|onload=/i.test(seite.body));
      });
      if (!f) return seite;
      const felder = {};
      for (const e of f.match(/<input[^>]*>/gi) || []) if (eingabeName(e) && eingabeTyp(e) === "hidden") felder[eingabeName(e)] = wertVon(e);
      const ziel = absolut(entities((f.match(/<form[^>]*action=["']([^"']*)["']/i) || [])[1] || seite.url) || seite.url, seite.url);
      const get = /method=["']?get/i.test((f.match(/<form[^>]*>/i) || [""])[0]);
      seite = get ? await this.hole(ziel + (ziel.includes("?") ? "&" : "?") + new URLSearchParams(felder), { referer: seite.url })
        : await this.hole(ziel, { methode: "POST", form: felder, referer: seite.url });
    }
    return seite;
  }

  async zweiterFaktor(seite) {
    for (let versuch = 0; versuch < 2; versuch++) {
      const f = codeFormular(seite.body);
      if (!f) return seite;
      let code = null;
      if (this.totpGeheim) {
        const rest = 30 - Math.floor(Date.now() / 1000) % 30;
        if (rest < 4) await new Promise((ok) => setTimeout(ok, (rest + 1) * 1000));
        code = totp(this.totpGeheim);
      } else if (this.handCode) {
        code = this.handCode;
        this.handCode = null; // ein Code gilt nur einmal
      } else {
        throw new IServFehler("IServ verlangt den Zwei-Faktor-Code – bitte in der Seite „Störungen“ eingeben.", { zweiFaktor: true });
      }
      const felder = Object.assign({}, f.felder);
      if (f.ziffern.length >= 4) f.ziffern.forEach((n, i) => { felder[n] = code[i] || ""; });
      else felder[f.codeFeld] = code;
      for (const n of f.versteckt) felder[n] = code;
      const ziel = absolut(f.action || seite.url, seite.url);
      this.hostErlaubt(ziel);
      let nach = await this.autoFormulare(await this.hole(ziel, { methode: "POST", form: felder, referer: seite.url }));
      if (!codeFormular(nach.body)) {
        nach = await this.hole("/iserv/");
        if (!codeFormular(nach.body)) { this.log("IServ: Zwei-Faktor-Code angenommen"); return nach; }
      }
      seite = nach;
      if (!this.totpGeheim) break; // ein falscher Code von Hand: nicht nochmal denselben schicken
    }
    throw new IServFehler(this.totpGeheim ? "IServ nimmt den erzeugten Code nicht an – 2FA-Schlüssel in den Optionen prüfen." : "IServ hat den Zwei-Faktor-Code nicht angenommen.", { zweiFaktor: true });
  }

  async anmelden() {
    if (!this.server || !this.benutzer || !this.passwort) throw new IServFehler("IServ ist in den Add-on-Optionen nicht eingerichtet.", { nichtEingerichtet: true });
    let seite = await this.hole("/iserv/auth/login");
    const sso = ssoLink(seite.body, seite.url);
    if (sso) seite = await this.autoFormulare(await this.hole(sso, { referer: seite.url }));
    let passwortGeschickt = false;
    for (let schritt = 0; schritt < 5; schritt++) {
      seite = await this.autoFormulare(seite);
      if (codeFormular(seite.body)) { seite = await this.zweiterFaktor(seite); break; }
      const form = anmeldeFormular(seite.body);
      if (!form) break;
      const felder = {};
      let hatPasswort = false;
      for (const i of form.match(/<input[^>]*>/gi) || []) {
        const n = eingabeName(i), t = eingabeTyp(i);
        if (!n) continue;
        if (t === "hidden") felder[n] = wertVon(i);
        else if (t === "password") { felder[n] = this.passwort; hatPasswort = true; }
        else if (/^(text|email)$/.test(t) && /user|login|name|mail|account/i.test(n)) felder[n] = this.benutzer;
      }
      const knopf = (form.match(/<button[^>]*name=["'][^"']+["'][^>]*>/i) || [])[0];
      if (knopf && !/type=["']button["']/i.test(knopf)) felder[eingabeName(knopf)] = wertVon(knopf);
      if (hatPasswort && passwortGeschickt) throw new IServFehler("IServ hat die Anmeldung nicht angenommen – Benutzername und Passwort in den Optionen prüfen.", { zugangsdaten: true });
      passwortGeschickt = passwortGeschickt || hatPasswort;
      const ziel = absolut(entities((form.match(/<form[^>]*action=["']([^"']*)["']/i) || [])[1] || seite.url) || seite.url, seite.url);
      this.hostErlaubt(ziel);
      seite = await this.hole(ziel, { methode: "POST", form: felder, referer: seite.url });
      if (/Login mit Schuldock|Login mit [A-Z]\w+ benutzen/i.test(seite.body) && !sso)
        throw new IServFehler("IServ verlangt eine vorgeschaltete Anmeldung, die nicht gefunden wurde.", { zugangsdaten: true });
      if (/Anmeldung fehlgeschlagen|falsches Passwort|Passwort (ist )?(falsch|ungültig)|Benutzername oder Passwort|Invalid (credentials|username or password)|Ungültiger? (Benutzername|Anmelde)/i.test(seite.body))
        throw new IServFehler("IServ hat die Zugangsdaten abgelehnt – Benutzername und Passwort in den Optionen prüfen.", { zugangsdaten: true });
      if (/gesperrt|zu viele|too many/i.test(seite.body) && /anmeld|login/i.test(seite.body))
        throw new IServFehler("IServ hat die Anmeldung vorübergehend gesperrt.", { zugangsdaten: true });
      seite = await this.autoFormulare(seite);
      if (!istLoginSeite(seite) && !anmeldeFormular(seite.body) && !codeFormular(seite.body)) break;
    }
    let start = await this.hole("/iserv/");
    if (codeFormular(start.body)) start = await this.zweiterFaktor(start);
    if (istLoginSeite(start)) throw new IServFehler("Nach der Anmeldung wieder auf der Login-Seite – Anmeldung nicht erkannt.", { zugangsdaten: true });
    this.log("IServ: angemeldet");
    return start;
  }

  /** Eine Seite holen, bei Bedarf vorher anmelden bzw. den zweiten Faktor eingeben */
  async geschuetzt(pfad) {
    let s = await this.hole(pfad);
    if (codeFormular(s.body)) { await this.zweiterFaktor(s); s = await this.hole(pfad); }
    else if (istLoginSeite(s)) { await this.anmelden(); s = await this.hole(pfad); }
    if (istLoginSeite(s) || codeFormular(s.body)) throw new IServFehler("IServ lässt die Seite nicht zu – Anmeldung nicht erkannt.", { zugangsdaten: true });
    return s;
  }

  /** Störungsmeldungen lesen; Bearbeiter offener Meldungen von den Detailseiten (höchstens 10) */
  async stoerungen() {
    const seite = await this.geschuetzt("/iserv/report/");
    const liste = parseStoerungen(seite.body, seite.url);
    if (!liste.length && !/<table/i.test(seite.body)) throw new IServFehler("Störungsmeldungen nicht gefunden (/iserv/report/).");
    const offen = liste.filter((m) => !m.erledigt && !m.bearbeiter && m.url && !AKTION.test(m.url) && m.url.startsWith(this.basis))
      .sort((a, b) => (b.datum || 0) - (a.datum || 0)).slice(0, 10);
    for (let i = 0; i < offen.length; i += 3) {
      await Promise.all(offen.slice(i, i + 3).map(async (m) => {
        try { const d = await this.hole(m.url); if (d.status < 400 && !istLoginSeite(d)) m.bearbeiter = bearbeiterAusDetail(d.body); } catch { /* ohne Namen weiter */ }
      }));
    }
    return liste.sort((a, b) => (b.datum || 0) - (a.datum || 0));
  }
}
