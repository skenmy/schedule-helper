import { describe, expect, it } from 'vitest';
import {
  detectBrand,
  normalizeTwitchChannel,
  parseLegacyHash,
  parseRoomPath,
  parseScheduleInput,
  roomPath,
} from './sources.ts';

describe('parseScheduleInput', () => {
  it.each([
    ['https://oengus.io/marathon/uksggrn26/schedule/main', 'oengus', 'uksggrn26', 'main'],
    ['oengus.io/en-GB/marathon/uksgred26/schedule/event?x=1', 'oengus', 'uksgred26', 'event'],
    ['https://oengus.io/marathon/uksgred26', 'oengus', 'uksgred26', null],
    ['https://horaro.net/esa/2026-winter1', 'horaro', 'esa', '2026-winter1'],
    ['horaro.net/esa/', 'horaro', 'esa', null],
    ['uksggrn26/main', 'oengus', 'uksggrn26', 'main'],
    ['uksggrn26', 'oengus', 'uksggrn26', null],
    ['demo', 'demo', 'demo', 'main'],
    ['https://schedule.skenmy.com/horaro/esa/stream1', 'horaro', 'esa', 'stream1'],
  ])('%s', (input, source, event, slug) => {
    expect(parseScheduleInput(input)).toEqual({ source, event, slug });
  });

  it.each(['', 'not a url at all', 'https://example.com/foo', 'a/b/c/d', '../../etc/passwd'])(
    'rejects %j',
    (input) => expect(parseScheduleInput(input)).toBeNull(),
  );
});

describe('room paths', () => {
  it('round-trips', () => {
    const ref = { source: 'oengus', event: 'uksgred26', slug: 'main' } as const;
    expect(parseRoomPath(roomPath(ref))).toEqual(ref);
  });
  it('rejects unknown sources and bad ids', () => {
    expect(parseRoomPath('/ftp/a/b')).toBeNull();
    expect(parseRoomPath('/oengus/a')).toBeNull();
    expect(parseRoomPath('/oengus/a%2Fb/c')).toBeNull();
  });
  it('parses legacy hashes', () => {
    expect(parseLegacyHash('#uksgred26/main')).toEqual({
      source: 'oengus',
      event: 'uksgred26',
      slug: 'main',
    });
    expect(parseLegacyHash('#horaro:esa/s1')).toEqual({
      source: 'horaro',
      event: 'esa',
      slug: 's1',
    });
    expect(parseLegacyHash('#')).toBeNull();
  });
});

describe('detectBrand', () => {
  const ref = (event: string, source: 'oengus' | 'horaro' = 'oengus') => ({
    source,
    event,
    slug: 'x',
  });
  it('maps UKSG colour suffixes', () => {
    expect(detectBrand(ref('uksgred26'))?.variant).toBe('red');
    expect(detectBrand(ref('UKSGgrn25'))?.variant).toBe('green');
    expect(detectBrand(ref('uksgblu'))?.variant).toBe('blue');
    expect(detectBrand(ref('uksg'))?.variant).toBe('standard');
  });
  it('ignores other events and sources', () => {
    expect(detectBrand(ref('esa'))).toBeNull();
    expect(detectBrand(ref('uksgred26', 'horaro'))).toBeNull();
  });
});

describe('normalizeTwitchChannel', () => {
  it.each([
    ['uksgmarathon', 'uksgmarathon'],
    ['https://www.twitch.tv/UKSGMarathon?referrer=raid', 'uksgmarathon'],
    ['twitch.tv/foo_bar/', 'foo_bar'],
    ['@someone', 'someone'],
    ['bad channel!', ''],
    ['', ''],
  ])('%j → %j', (input, out) => expect(normalizeTwitchChannel(input)).toBe(out));
});
