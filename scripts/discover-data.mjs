#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildKeywordCatalog } from './lib/keywords.mjs';

function profile(records) {
  return Object.fromEntries([...new Set(records.flatMap(record => Object.keys(record)))].sort().map(key => {
    const present = records.filter(record => Object.hasOwn(record, key));
    return [key, {
      present: present.length, missing: records.length - present.length,
      types: [...new Set(present.map(record => record[key] === null ? 'null' : Array.isArray(record[key]) ? 'array' : typeof record[key]))].sort(),
      empty: present.filter(record => record[key] === null || record[key] === '' || Array.isArray(record[key]) && !record[key].length).length,
    }];
  }));
}

function frequencies(values) {
  return Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(entry => entry === value).length]));
}

export function discoverData(snapshot) {
  const sessions = snapshot.sessions;
  const times = sessions.flatMap(session => session.times ?? []);
  const assignments = sessions.flatMap(session => session.participants ?? []);
  const ids = new Set(sessions.map(session => session.sessionID));
  const attributes = sessions.flatMap(session => session.attributevalues ?? []);
  const keywords = buildKeywordCatalog(sessions);
  return {
    sourceContentSha256: snapshot.contentSha256,
    sourceScrapedAt: snapshot.scrapedAt,
    counts: { ...snapshot.counts, occurrences: times.length, assignments: assignments.length,
      rooms: new Set(times.map(time => time.roomId).filter(Boolean)).size },
    dates: [...new Set(times.map(time => time.date))].sort(),
    sessionTypes: frequencies(sessions.map(session => session.type ?? '(missing)')),
    durationsMinutes: frequencies(times.map(time => time.length)),
    occurrencesPerSession: frequencies(sessions.map(session => session.times?.length ?? 0)),
    speakersPerSession: frequencies(sessions.map(session => session.participants?.length ?? 0)),
    classificationCoverage: Object.fromEntries([...new Set(attributes.map(attribute => attribute.attribute))].sort().map(name => [name, {
      sessions: sessions.filter(session => session.attributevalues?.some(attribute => attribute.attribute === name)).length,
      distinctValues: new Set(attributes.filter(attribute => attribute.attribute === name).map(attribute => attribute.value)).size,
      values: [...new Set(attributes.filter(attribute => attribute.attribute === name).map(attribute => attribute.value))].sort(),
    }])),
    optionalSpeakerFields: {
      eventBio: snapshot.speakers.filter(speaker => speaker.bio?.trim()).length,
      eventOrGlobalBio: snapshot.speakers.filter(speaker => speaker.bio?.trim() || speaker.globalBio?.trim()).length,
      eventJobTitle: snapshot.speakers.filter(speaker => speaker.jobTitle?.trim()).length,
      eventOrGlobalJobTitle: snapshot.speakers.filter(speaker => speaker.jobTitle?.trim() || speaker.globalJobtitle?.trim()).length,
    },
    parsedKeywords: {
      catalogTerms: keywords.catalog.length,
      sessionAssignments: [...keywords.sessionKeywords.values()].flat().length,
      parsingDiagnostics: keywords.diagnostics,
    },
    anomalies: {
      sharedCatalogSessions: sessions.filter(session => session.attributevalues?.some(attribute => attribute.attribute_id === 'CatalogDisplay' && attribute.value === 'European Partner Conference')).map(session => ({ id: session.sessionID, title: session.title })),
      differentPreferredNames: snapshot.speakers.filter(speaker => speaker.preferredFullName && speaker.preferredFullName !== speaker.fullName).map(speaker => ({ id: speaker.speakerId, name: speaker.fullName, preferredName: speaker.preferredFullName })),
      speakerSessionIdsOutsideCatalog: [...new Set(snapshot.speakers.flatMap(speaker => speaker.session ?? []).map(session => session.sessionID))].filter(id => !ids.has(id)).sort(),
      capacityValues: [...new Set(times.map(time => time.capacity))].sort(),
      keywordSamples: attributes.filter(attribute => attribute.attribute_id === 'Keywords').slice(0, 5).map(attribute => attribute.value),
      attachmentFields: [...new Set(sessions.flatMap(session => Object.keys(session)).filter(key => /^(files|resources|sessionFiles|attachments)$/i.test(key)))],
    },
    fieldProfiles: {
      sessions: profile(sessions), occurrences: profile(times), speakers: profile(snapshot.speakers),
      assignments: profile(assignments), attributes: profile(attributes),
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2] ?? 'data/raw/agenda.json';
  const snapshot = JSON.parse(await readFile(path, 'utf8'));
  console.log(JSON.stringify(discoverData(snapshot), null, 2));
}
