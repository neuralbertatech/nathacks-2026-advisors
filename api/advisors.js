// Reads the public natHacks 2026 Advisor Schedule Google Calendar (ICS feed)
// and returns advisor shifts as JSON for the display page.
const CAL_ID = 'c_1b64dc2ba44897f44eafe219b66f89c8c99e806835453af166797d8dbe79b072@group.calendar.google.com';
const ICS_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL_ID)}/public/basic.ics`;

// Offset (ms) of a time zone at a given UTC instant.
function tzOffset(tz, utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

function parseDate(params, value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  const naive = Date.UTC(+y, mo - 1, +d, +h, +mi, +s);
  if (z) return naive;
  const tz = (params.match(/TZID=([^;:]+)/) || [])[1] || 'America/Edmonton';
  let t = naive - tzOffset(tz, naive);
  return naive - tzOffset(tz, t); // second pass handles DST edges
}

function parseICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [key, ...rest] = line.slice(0, i).split(';');
    const params = rest.join(';');
    const value = line.slice(i + 1);
    if (key === 'DTSTART') ev.start = parseDate(params, value);
    else if (key === 'DTEND') ev.end = parseDate(params, value);
    else if (key === 'SUMMARY') ev.summary = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').trim();
    else if (key === 'STATUS') ev.status = value;
  }
  return events
    .filter(e => e.start && e.end && e.summary && e.status !== 'CANCELLED')
    .map(e => ({
      name: (e.summary.split(/\s[—–-]\s/).pop() || e.summary).trim(),
      start: new Date(e.start).toISOString(),
      end: new Date(e.end).toISOString()
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

module.exports = async (req, res) => {
  try {
    const r = await fetch(ICS_URL, { headers: { 'User-Agent': 'natHacks-advisor-display' } });
    if (!r.ok) throw new Error('calendar responded ' + r.status);
    const shifts = parseICS(await r.text());
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json({ source: 'calendar', fetchedAt: new Date().toISOString(), shifts });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(err.message || err) });
  }
};
