// Reviewed examples only. Metadata stays in the agenda JSON; the agent creates the user's own schedule.
const roles = [
  { id: 'web', label: 'JavaScript / web', sessions: [
    '1785494387567001kitV', '1785495619244001ttHS',
    '1785494574001001ahF2', '1785494727635001W1Oa', '1785488844287001JhoD', '1785495003196001fwKB', '1785495094887001f0XA',
    '1785495992137001r4SB', '1785496151845001upt9', '1785495505595001u7S6',
  ] },
  { id: 'python', label: 'Python / data', sessions: [
    '1785492427169001yOxW', '1785481230937001TX5V',
    '1785492755046001JVlx', '1785482952493001LNiy', '1785482839006001nLsT', '1785491630111001RFvk', '1785492652962001ydxP',
    '1785490036168001dnx0', '1785483613452001PuZq', '1785492551934001fcc9', '1785493024826001Salx',
  ] },
  { id: 'native', label: 'Native apps', sessions: [
    '1785489365604001BwBR', '1785487845940001dq1g',
    '1785492284277001WPNe', '1785491789306001kknK', '1785491902057001pS8Z',
    '1785487648507001JydR', '1785492163207001rhKM', '1785492028686001iLdL',
  ] },
  { id: 'architect', label: 'GIS architecture', sessions: [
    '1785493152511001mz22', '1785493271654001i4IX',
    '1785485792828001LNND', '1785493428600001x4gQ', '1785493533691001yG2g', '1785493789000001BHsA', '1785493662600001LeyY',
    '1785491397743001mAwB', '1785487230377001mEju', '1785494189026001yKkd', '1785486994541001rFoj',
  ] },
  { id: 'devops', label: 'DevOps', sessions: [
    '1785493152511001mz22', '1785493271654001i4IX',
    '1785488298088001RAmI', '1785493428600001x4gQ', '1785486341667001slFC', '1785486243010001fJez', '1785493662600001LeyY',
    '1785491397743001mAwB', '1785487230377001mEju', '1785486877948001udxW', '1785486994541001rFoj',
  ] },
  { id: 'ai', label: 'AI', sessions: [
    '1785481230937001TX5V',
    '1785480754385001m6KU', '1785482839006001nLsT', '1785491630111001RFvk', '1785495094887001f0XA',
    '1785480969446001f0kE', '1785484578943001M00N', '1785482236468001Qg7Q', '1785481365243001f1yI',
  ] },
];
const dates = ['2026-10-20', '2026-10-21', '2026-10-22'];

export function renderExamples(agenda) {
  const tabs = document.querySelector('#role-tabs');
  const panel = document.querySelector('#example-output');
  const byId = new Map(agenda.sessions.map(session => [session.id, session]));
  const sharedSessions = agenda.sessions.filter(session => ['Plenary', 'Closing Session'].includes(session.sessionType)
    && session.catalogs.includes('European Dev & Tech Summit')).map(session => session.id);
  function show(role) {
    for (const button of tabs.children) {
      const selected = button.id === `role-${role.id}`;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', `role-${role.id}`);
    const candidates = [...sharedSessions, ...role.sessions].flatMap(id => {
      const session = byId.get(id);
      if (!session || !['Technical Session', 'Plenary', 'Closing Session'].includes(session.sessionType)
        || !session.catalogs.includes('European Dev & Tech Summit')) return [];
      return session.occurrences.filter(occurrence => dates.includes(occurrence.localStart.date))
        .map(occurrence => ({ session, occurrence }));
    }).sort((a, b) => a.occurrence.startsAt.localeCompare(b.occurrence.startsAt)
      || a.session.title.localeCompare(b.session.title, 'en') || a.session.id.localeCompare(b.session.id));
    const selected = [];
    for (const entry of candidates) {
      if (selected.some(other => other.session.id === entry.session.id ||
        (Date.parse(entry.occurrence.startsAt) < Date.parse(other.occurrence.endsAt)
        && Date.parse(other.occurrence.startsAt) < Date.parse(entry.occurrence.endsAt)))) continue;
      selected.push(entry);
    }
    const table = document.createElement('table');
    table.className = 'example-table';
    const caption = table.createCaption();
    caption.className = 'sr-only';
    caption.textContent = `${role.label}: example sessions for 20–22 October 2026, ${agenda.event.timezone}`;
    const header = table.createTHead().insertRow();
    for (const label of ['Date', 'Time', 'Session', 'Room']) {
      const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; header.append(cell);
    }
    const body = table.createTBody();
    let previousDate;
    for (const { session, occurrence } of selected) {
      const row = body.insertRow();
      if (previousDate !== occurrence.localStart.date) row.className = 'day-start';
      const date = row.insertCell(); date.className = 'date-cell';
      date.textContent = previousDate === occurrence.localStart.date ? '' : `${Number(occurrence.localStart.date.slice(-2))} October`;
      if (!date.textContent) date.setAttribute('aria-label', `${Number(occurrence.localStart.date.slice(-2))} October`);
      const time = row.insertCell(); time.className = 'time-cell'; time.textContent = `${occurrence.localStart.time}–${occurrence.localEnd.time}`;
      const title = row.insertCell();
      const link = document.createElement('a'); link.href = session.url; link.textContent = session.title.trim(); link.target = '_blank'; link.rel = 'noopener'; title.append(link);
      const room = row.insertCell(); room.className = 'room-cell'; room.textContent = occurrence.room?.name ?? 'Not listed';
      previousDate = occurrence.localStart.date;
    }
    panel.replaceChildren(table);
  }
  for (const role of roles) {
    const button = document.createElement('button'); button.type = 'button'; button.id = `role-${role.id}`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'example-output'); button.textContent = role.label;
    button.addEventListener('click', () => show(role)); tabs.append(button);
  }
  tabs.addEventListener('keydown', event => {
    const buttons = [...tabs.children], index = buttons.indexOf(document.activeElement);
    const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index - 1 + buttons.length) % buttons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); buttons[next].focus(); buttons[next].click();
  });
  show(roles[0]);
}
