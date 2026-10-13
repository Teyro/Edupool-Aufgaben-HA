# Edupool Aufgaben

Zeigt deine Aufgaben aus [Edupool Boards](https://boards.edupool.cloud) (der TaskCards-Alternative
der Stadt Hamburg) in Home Assistant:

- **Seite „Aufgaben“ in der Seitenleiste:** alle Karten in deiner Aufgabenfarbe, nach den Kategorien
  Ideen Backlog, Zu erledigen, In Bearbeitung, Wartet auf Feedback und Erledigt – mit Titel,
  Änderungsdatum und Beschreibung. Auf breiten Bildschirmen nebeneinander wie ein Kanban-Board.
  Ein Klick öffnet das Board in Edupool.
- **Sensor `sensor.edupool_offene_aufgaben`:** Zahl der offenen Aufgaben (alles außer „Erledigt“),
  dazu je Kategorie die Anzahl als Attribut – für Dashboards, Badges und Automationen.

## Einrichten

1. Add-on installieren und starten.
2. In der Seitenleiste **Aufgaben** öffnen → **Verbinden**.
3. **Freigabeseite öffnen** (neuer Tab), mit dem Schulkonto anmelden, prüfen, dass der angezeigte
   Code eingetragen ist, **nur „Lesen“** anhaken, alle Boards, Laufzeit wählen (bis 90 Tage),
   bestätigen. Das Add-on merkt es von selbst.

Läuft die Freigabe ab, zeigt die Seite „Neu verbinden“, und der Sensor meldet „nicht verfügbar“.

## Optionen

| Option | Bedeutung |
| --- | --- |
| `farbe` | Kartenfarbe deiner Aufgaben, Standard `#76a5af` |
| `intervall_minuten` | Wie oft neu geladen wird (5–1440, Standard 15) |
| `boards` | Board-IDs (Zahl in `…/boards/123`); leer = alle Kanban-Boards |
| `titel_im_sensor` | Aufgabentitel zusätzlich im Sensor (Standard aus, siehe unten) |

## Datenschutz und Sicherheit

- Das Add-on nutzt die offizielle Geräte-Freigabe von Edupool Boards. Es sieht dein Passwort nie
  und hat nur Leserechte. Widerrufen kannst du die Freigabe jederzeit in Edupool Boards unter
  `/cli/authorize`; „Verbindung entfernen“ in der Seite löscht sie aus dem Add-on.
- Home Assistant speichert Sensorwerte dauerhaft. Deshalb enthält der Sensor standardmäßig **nur
  Zahlen**. Titel und Beschreibungen (in denen oft Namen stehen) bleiben im Speicher des Add-ons
  und erscheinen nur auf der Seite. `titel_im_sensor` ändert das bewusst.
- Die Seite ist nur über Home Assistant erreichbar (Ingress); direkte Zugriffe lehnt das Add-on ab.

## IServ-Störungsmeldungen (optional)

Zusätzlich kann das Add-on die Störungsmeldungen aus IServ (`/iserv/report/`) anzeigen:
Reiter **Störungen** auf der Seite und Sensor `sensor.iserv_offene_stoerungen` (Zahl der offenen
Meldungen, dazu `noch_ohne_bearbeiter`).

Einschalten in den Optionen: `iserv_aktiv: true`, dazu `iserv_server` (z. B. `s1234.schuldock.de`),
`iserv_benutzer` und `iserv_passwort`. Läuft die Anmeldung über eine andere Adresse
(z. B. `auth.iam.schuldock.de`), diese unter `iserv_anmeldeseiten` eintragen.

**Zwei-Faktor:** Ohne `iserv_2fa_schluessel` zeigt der Reiter „Störungen“ bei Bedarf ein Feld für
den 6-stelligen Code. Hinterlegst du den Schlüssel (Text unter dem QR-Code beim Einrichten der
Zwei-Faktor-Anmeldung), meldet sich das Add-on ohne Eingriff an.

Das Add-on liest nur – Seiten zum Übernehmen, Ändern oder Löschen ruft es nie auf. IServ-Passwort
und 2FA-Schlüssel liegen nur in der Add-on-Konfiguration auf diesem Gerät. Der Sensor enthält nur
Zahlen; Titel, Namen und Inhalte erscheinen nur auf der Seite.
