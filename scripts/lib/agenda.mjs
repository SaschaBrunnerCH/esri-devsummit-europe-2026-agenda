import { convert } from 'html-to-text';
import { sourceUtc } from '../validate-data.mjs';
import { buildKeywordCatalog } from './keywords.mjs';

const text = value => value?.trim() || null;
const plain = value => value ? text(convert(value, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }] })) : null;

export function buildAgenda(snapshot) {
  const labels = (session, id) => [...new Set(session.attributevalues.filter(attribute => attribute.attribute_id === id).map(attribute => attribute.value.trim()).filter(Boolean))];
  const topic = session => {
    const values = labels(session, 'Topic');
    if (values.length > 1) throw new Error(`Session ${session.sessionID}: multiple Topic labels cannot fit the public topic field`);
    return values[0] ?? null;
  };
  const keywords = buildKeywordCatalog(snapshot.sessions);
  return {
    schemaVersion: '1.0.0',
    source: { url: snapshot.source.url, scrapedAt: snapshot.scrapedAt, contentSha256: snapshot.contentSha256, scope: snapshot.source.scope },
    event: { id: snapshot.source.eventId, name: snapshot.sessions[0].eventName, catalogName: 'Esri European Developer & Technology Summit 2026', timezone: snapshot.source.timezone },
    sessions: snapshot.sessions.map(session => ({
      id: session.sessionID, code: text(session.code), title: session.title,
      description: plain(session.abstract),
      url: `${snapshot.source.url}/session/${encodeURIComponent(session.sessionID)}`,
      language: text(session.language), sessionType: text(session.type), level: labels(session, 'SessionLevel')[0] ?? null,
      topic: topic(session), products: labels(session, 'EsriProducts'), capabilities: labels(session, 'Capabilities'), technologies: labels(session, 'Technologies'),
      keywords: keywords.sessionKeywords.get(session.sessionID),
      catalogs: labels(session, 'CatalogDisplay'),
      speakers: (session.participants ?? []).map(speaker => ({
        speakerId: speaker.speakerId, name: speaker.fullName, company: text(speaker.companyName),
        role: text(speaker.session?.find(entry => entry.sessionID === session.sessionID)?.speakerRole), order: speaker.displayorder ?? null,
      })),
      occurrences: (session.times ?? []).map(time => ({
        id: time.sessionTimeID, startsAt: sourceUtc(time.utcStartTime), endsAt: sourceUtc(time.utcEndTime), durationMinutes: time.length,
        localStart: { date: time.date, time: time.startTime }, localEnd: { date: time.endDate, time: time.endTime },
        room: text(time.room) ? { id: text(time.roomId), name: time.room } : null,
        inPerson: time.inPersonTime ?? null, virtual: time.virtualTime ?? null,
      })),
      sourceModifiedAt: session.modified ?? null,
    })),
    speakers: snapshot.speakers.map(speaker => ({
      id: speaker.speakerId, name: speaker.fullName,
      firstName: text(speaker.firstName), lastName: text(speaker.lastName), company: text(speaker.companyName),
      jobTitle: text(speaker.jobTitle) ?? text(speaker.globalJobtitle), bio: plain(text(speaker.bio) ?? text(speaker.globalBio)),
      photoUrl: text(speaker.photoURL), sourceModifiedAt: speaker.modified ?? null,
    })),
  };
}

const markdown = value => String(value).replace(/[\\`*_{}\[\]<>]/g, '\\$&')
  .replace(/^([#+-])(?=\s)/gm, '\\$1').replace(/^(\d+)([.)])(?=\s)/gm, '$1\\$2');
const inline = value => markdown(value).replace(/\s+/g, ' ');

export function renderMarkdown(agenda) {
  const occurrenceCount = agenda.sessions.reduce((total, session) => total + session.occurrences.length, 0);
  const lines = [
    `# ${inline(agenda.event.catalogName)}`, '',
    `Timezone: ${inline(agenda.event.timezone)}  `,
    `Source captured: ${agenda.source.scrapedAt}  `,
    `[Official agenda](<${agenda.source.url}>) · [JSON agenda](agenda.json)`, '',
    `${agenda.sessions.length} sessions · ${occurrenceCount} occurrences · ${agenda.speakers.length} speaker profiles.`, '',
    `Registration event: ${inline(agenda.event.name)}  `,
    `Event ID: ${inline(agenda.event.id)}  `,
    `Source SHA-256: ${agenda.source.contentSha256}`, '',
    markdown(agenda.source.scope), '',
  ];
  const scheduled = agenda.sessions.map(session => ({ session,
    occurrences: [...session.occurrences].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)),
  })).sort((a, b) => {
    if (!a.occurrences.length !== !b.occurrences.length) return a.occurrences.length ? -1 : 1;
    return (a.occurrences[0]?.startsAt ?? '').localeCompare(b.occurrences[0]?.startsAt ?? '') || a.session.id.localeCompare(b.session.id);
  });
  let day;
  for (const { session, occurrences } of scheduled) {
    const date = occurrences[0]?.localStart.date ?? 'Unscheduled';
    if (date !== day) { lines.push(`## ${date}`, ''); day = date; }
    lines.push(`### ${inline(session.title)}`, '',
      `Session ID: ${inline(session.id)}${session.code ? ` · Code: ${inline(session.code)}` : ''}`, '');
    if (!occurrences.length) lines.push('Not yet scheduled.', '');
    for (const occurrence of occurrences) {
      lines.push(`- When: ${occurrence.localStart.date} ${occurrence.localStart.time}–${occurrence.localEnd.date} ${occurrence.localEnd.time} (${inline(agenda.event.timezone)}; ${occurrence.durationMinutes} minutes)`,
        `- UTC: ${occurrence.startsAt}–${occurrence.endsAt}`,
        `- Room: ${occurrence.room ? inline(occurrence.room.name) : 'Not specified'}`,
        `- Occurrence ID: ${inline(occurrence.id)}`);
      const modes = [['In person', occurrence.inPerson], ['Virtual', occurrence.virtual]]
        .filter(([, value]) => value !== null).map(([label, value]) => `${label}: ${value ? 'yes' : 'no'}`);
      if (modes.length) lines.push(`- Attendance: ${modes.join('; ')}`);
      lines.push('');
    }
    lines.push(markdown(session.description ?? 'Description not provided.'), '');
    for (const [label, value] of [['Type', session.sessionType], ['Level', session.level], ['Language', session.language], ['Topic', session.topic]]) {
      if (value) lines.push(`- ${label}: ${inline(value)}`);
    }
    for (const [label, values] of [['Products', session.products], ['Capabilities', session.capabilities], ['Technologies', session.technologies], ['Keywords', session.keywords], ['Catalogues', session.catalogs]]) {
      if (values.length) lines.push(`- ${label}: ${values.map(inline).join(', ')}`);
    }
    lines.push(`- Speakers: ${session.speakers.length ? session.speakers.map(speaker =>
      `${inline(speaker.name)} (${[speaker.company, speaker.role, `ID: ${speaker.speakerId}`].filter(Boolean).map(inline).join('; ')})`).join('; ') : 'None listed'}`);
    if (session.sourceModifiedAt) lines.push(`- Source modified: ${session.sourceModifiedAt}`);
    lines.push('', `[Session on the official agenda](<${session.url}>)`, '');
  }
  lines.push('## Speaker profiles', '');
  for (const speaker of [...agenda.speakers].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id))) {
    lines.push(`### ${inline(speaker.name)}`, '', `Speaker ID: ${inline(speaker.id)}`, '');
    for (const [label, value] of [['First name', speaker.firstName], ['Last name', speaker.lastName], ['Company', speaker.company], ['Job title', speaker.jobTitle]]) {
      if (value) lines.push(`- ${label}: ${inline(value)}`);
    }
    if (speaker.photoUrl) lines.push(`- [Photo](<${speaker.photoUrl}>)`);
    if (speaker.sourceModifiedAt) lines.push(`- Source modified: ${speaker.sourceModifiedAt}`);
    lines.push('', markdown(speaker.bio ?? 'Biography not provided.'), '');
  }
  return lines.join('\n');
}
