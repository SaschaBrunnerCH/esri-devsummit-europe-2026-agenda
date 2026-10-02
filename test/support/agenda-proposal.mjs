// In-memory schema test projection, pending discussion of the public contract.
// This deliberately has no export command and writes no published agenda files.
import { convert } from 'html-to-text';
import { sourceUtc } from '../../scripts/validate-data.mjs';
import { buildKeywordCatalog } from '../../scripts/lib/keywords.mjs';

const text = value => value?.trim() || null;
const plain = value => value ? text(convert(value, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }] })) : null;

export function proposedAgenda(snapshot) {
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
