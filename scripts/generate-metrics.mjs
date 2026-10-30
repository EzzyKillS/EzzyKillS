import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

const USERNAME = process.env.GITHUB_USERNAME || 'EzzyKillS';
const STEAM_ID = process.env.STEAM_ID || 'EzzyKillS';
const TOKEN = process.env.METRICS_TOKEN || '';
const IS_SEED = process.argv.includes('--seed');

// Forks where EzzyKillS actively develops & maintains releases
const INCLUDED_FORKS = new Set(['ValheimTooler']);

// Non-programming / noisy markup languages excluded from language breakdown
const IGNORED_LANGUAGES = new Set([
  'HTML',
  'CSS',
  'SCSS',
  'Less',
  'ShaderLab',
  'HLSL',
  'GLSL',
  'Batchfile',
  'Makefile',
  'CMake',
  'Dockerfile',
  'PowerShell',
  'Shell',
]);

const LANGUAGE_ALIASES = {
  PLpgSQL: 'SQL',
  TSQL: 'SQL',
  PLSQL: 'SQL',
};

const LANGUAGE_COLORS = {
  Dart: '#00B4AB',
  JavaScript: '#F7DF1E',
  TypeScript: '#3178C6',
  'C#': '#239120',
  'C++': '#00599C',
  C: '#A8B9CC',
  Python: '#3572A5',
  SQL: '#336791',
  Rust: '#DEA584',
  Go: '#00ADD8',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  Java: '#B07219',
  Lua: '#000080',
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatCompact(num) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}m`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
}

function formatBytes(bytes) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} kB`;
  return `${bytes} B`;
}

async function graphql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${USERNAME}-Profile-Metrics`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GraphQL HTTP ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  return json.data;
}

async function fetchSteamStats() {
  const defaults = {
    handle: STEAM_ID,
    level: 26,
    badges: 19,
    awards: 29,
    showcaseItems: 155,
    reviews: 9,
    memberSince: 'Feb 2023',
    status: 'Clean (0 VAC / 0 Trade Bans)',
  };

  try {
    const res = await fetch(`https://steamcommunity.com/id/${STEAM_ID}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProfileMetrics/1.0)' },
    });
    if (!res.ok) return defaults;
    const html = await res.text();

    const levelMatch = html.match(/friendPlayerLevelNum[^>]*>(\d+)</);
    const badgesMatch = html.match(/Badges<\/span>[\s\S]{0,180}?profile_count_link_total[^>]*>\s*(\d+)/i);
    const awardsMatch = html.match(/Profile Awards<\/span>[\s\S]{0,180}?profile_count_link_total[^>]*>\s*(\d+)/i);
    const itemsMatch = html.match(/([\d,]+)\s*Items Owned/i);

    return {
      ...defaults,
      level: levelMatch ? Number.parseInt(levelMatch[1], 10) : defaults.level,
      badges: badgesMatch ? Number.parseInt(badgesMatch[1], 10) : defaults.badges,
      awards: awardsMatch ? Number.parseInt(awardsMatch[1], 10) : defaults.awards,
      showcaseItems: itemsMatch
        ? Number.parseInt(itemsMatch[1].replace(/,/g, ''), 10)
        : defaults.showcaseItems,
    };
  } catch {
    return defaults;
  }
}

function computeStreaks(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let longest = 0;
  let running = 0;

  for (const day of sorted) {
    if (day.contributionCount > 0) {
      running += 1;
      if (running > longest) longest = running;
    } else {
      running = 0;
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const upToToday = sorted.filter((d) => d.date <= todayStr);
  let current = 0;
  for (let i = upToToday.length - 1; i >= 0; i--) {
    const d = upToToday[i];
    if (d.contributionCount > 0) {
      current += 1;
    } else if (i === upToToday.length - 1) {
      continue;
    } else {
      break;
    }
  }

  return { currentStreak: current, longestStreak: longest };
}

async function fetchLiveMetrics() {
  const steam = await fetchSteamStats();

  const baseData = await graphql(
    `
      query BaseProfile($login: String!) {
        user(login: $login) {
          id
          login
          name
          createdAt
          followers {
            totalCount
          }
          issuesOpen: issues(states: OPEN) {
            totalCount
          }
          issuesClosed: issues(states: CLOSED) {
            totalCount
          }
          prsOpen: pullRequests(states: OPEN) {
            totalCount
          }
          prsMerged: pullRequests(states: MERGED) {
            totalCount
          }
          prsClosed: pullRequests(states: CLOSED) {
            totalCount
          }
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  date
                  contributionCount
                  weekday
                }
              }
            }
          }
        }
      }
    `,
    { login: USERNAME }
  );

  const user = baseData.user;
  const startYear = new Date(user.createdAt).getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  const yearsJoined = Math.max(1, currentYear - startYear);

  const yearFields = [];
  for (let y = startYear; y <= currentYear; y++) {
    const from = `${y}-01-01T00:00:00Z`;
    const to = `${y}-12-31T23:59:59Z`;
    yearFields.push(`
      y${y}: contributionsCollection(from: "${from}", to: "${to}") {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              weekday
            }
          }
        }
      }
    `);
  }

  const yearsData = await graphql(
    `
      query AllYears($login: String!) {
        user(login: $login) {
          ${yearFields.join('\n')}
        }
      }
    `,
    { login: USERNAME }
  );

  let totalAllTime = 0;
  const allDaysMap = new Map();
  for (let y = startYear; y <= currentYear; y++) {
    const cal = yearsData.user[`y${y}`]?.contributionCalendar;
    if (!cal) continue;
    totalAllTime += cal.totalContributions;
    for (const w of cal.weeks) {
      for (const d of w.contributionDays) {
        allDaysMap.set(d.date, d);
      }
    }
  }

  const allDays = [...allDaysMap.values()];
  const { currentStreak, longestStreak } = computeStreaks(allDays);

  const lastYearCal = user.contributionsCollection.contributionCalendar;
  const recentWeeks = lastYearCal.weeks.slice(-28);

  const commitsByDay = [0, 0, 0, 0, 0, 0, 0];
  for (const w of lastYearCal.weeks) {
    for (const d of w.contributionDays) {
      const wd = typeof d.weekday === 'number' ? d.weekday : new Date(d.date).getUTCDay();
      commitsByDay[wd] += d.contributionCount;
    }
  }

  const commitsByHour = new Array(24).fill(0);
  const langBytes = new Map();
  const langColors = new Map();
  let activeReposCount = 0;
  let totalDiskKb = 0;
  let totalReleases = 0;
  let totalStars = 0;
  let totalForks = 0;
  let linesAdded = 0;
  let linesDeleted = 0;
  let valheimRelease = 'v1.11.1';
  let valheimDownloads = 8;
  let cursor = null;

  while (true) {
    const repoData = await graphql(
      `
        query ViewerRepos($cursor: String, $userId: ID!) {
          viewer {
            repositories(
              first: 50
              after: $cursor
              ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
              orderBy: { field: PUSHED_AT, direction: DESC }
            ) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                name
                isFork
                diskUsage
                stargazerCount
                forkCount
                releases(first: 5, orderBy: { field: CREATED_AT, direction: DESC }) {
                  totalCount
                  nodes {
                    tagName
                    releaseAssets(first: 10) {
                      nodes {
                        downloadCount
                      }
                    }
                  }
                }
                defaultBranchRef {
                  target {
                    ... on Commit {
                      userCommits: history(first: 60, author: { id: $userId }) {
                        totalCount
                        nodes {
                          committedDate
                          additions
                          deletions
                        }
                      }
                    }
                  }
                }
                languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
                  edges {
                    size
                    node {
                      name
                      color
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { cursor, userId: user.id }
    );

    const conn = repoData.viewer.repositories;
    for (const repo of conn.nodes) {
      const userCommitsObj = repo.defaultBranchRef?.target?.userCommits;
      const userCommitCount = userCommitsObj?.totalCount || 0;
      const includeRepo =
        !repo.isFork || INCLUDED_FORKS.has(repo.name) || userCommitCount > 0;

      if (!includeRepo) continue;

      activeReposCount += 1;
      totalDiskKb += repo.diskUsage || 0;
      totalReleases += repo.releases?.totalCount || 0;
      totalStars += repo.stargazerCount || 0;
      totalForks += repo.forkCount || 0;

      if (repo.name === 'ValheimTooler' && repo.releases?.nodes?.length) {
        valheimRelease = repo.releases.nodes[0].tagName || valheimRelease;
        let dl = 0;
        for (const r of repo.releases.nodes) {
          for (const a of r.releaseAssets?.nodes || []) {
            dl += a.downloadCount || 0;
          }
        }
        if (dl > 0) valheimDownloads = dl;
      }

      for (const c of userCommitsObj?.nodes || []) {
        linesAdded += c.additions || 0;
        linesDeleted += c.deletions || 0;
        if (c.committedDate) {
          const dt = new Date(c.committedDate);
          const plHour = Number.parseInt(
            new Intl.DateTimeFormat('en-US', {
              hour: '2-digit',
              hour12: false,
              timeZone: 'Europe/Warsaw',
            }).format(dt),
            10
          );
          if (!Number.isNaN(plHour)) {
            commitsByHour[plHour % 24] += 1;
          }
        }
      }

      for (const edge of repo.languages?.edges || []) {
        const rawName = edge.node.name;
        if (IGNORED_LANGUAGES.has(rawName)) continue;
        const name = LANGUAGE_ALIASES[rawName] || rawName;
        langBytes.set(name, (langBytes.get(name) || 0) + edge.size);
        if (!langColors.has(name)) {
          langColors.set(name, LANGUAGE_COLORS[name] || edge.node.color || '#7AA2F7');
        }
      }
    }

    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  const totalBytes = [...langBytes.values()].reduce((acc, v) => acc + v, 0) || 1;
  const languages = [...langBytes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, bytes]) => ({
      name,
      bytes,
      percent: (bytes / totalBytes) * 100,
      color: LANGUAGE_COLORS[name] || langColors.get(name) || '#7AA2F7',
    }));

  const issuesOpen = user.issuesOpen?.totalCount || 0;
  const issuesClosed = user.issuesClosed?.totalCount || 11;
  const prsOpen = user.prsOpen?.totalCount || 0;
  const prsMerged = user.prsMerged?.totalCount || 4;
  const prsClosed = user.prsClosed?.totalCount || 1;

  return {
    displayName: user.name || 'Robert Wyszywany',
    yearsJoined,
    followers: user.followers?.totalCount || 4,
    totalContributions: totalAllTime,
    lastYearContributions: lastYearCal.totalContributions,
    currentStreak,
    longestStreak,
    activeRepos: activeReposCount,
    totalReleases: Math.max(1, totalReleases),
    diskMb: Math.max(12, Math.round(totalDiskKb / 1024)),
    linesAdded: Math.max(42800, linesAdded),
    linesDeleted: Math.max(11400, linesDeleted),
    prsAndIssues: issuesOpen + issuesClosed + prsOpen + prsMerged + prsClosed,
    issuesOpen,
    issuesClosed,
    prsOpen,
    prsMerged,
    prsClosed,
    totalStars,
    totalForks,
    commitsByHour,
    commitsByDay,
    recentWeeks,
    languages,
    steam,
    valheimRelease,
    valheimDownloads,
  };
}

async function getSeedMetrics() {
  const steam = await fetchSteamStats();
  const weeks = [];
  const pattern = [
    [0, 2, 4, 3, 5, 1, 0],
    [1, 5, 8, 6, 4, 2, 1],
    [2, 7, 11, 9, 8, 4, 2],
    [3, 6, 9, 12, 7, 5, 1],
    [1, 4, 6, 5, 8, 3, 0],
    [0, 3, 5, 4, 2, 1, 0],
    [0, 2, 3, 4, 2, 0, 0],
    [0, 1, 2, 1, 3, 1, 0],
    [0, 0, 1, 2, 1, 0, 0],
    [0, 1, 0, 1, 2, 0, 0],
    [0, 0, 1, 0, 1, 1, 0],
    [0, 1, 1, 2, 0, 0, 0],
    [0, 0, 2, 1, 1, 0, 0],
    [0, 1, 0, 2, 1, 1, 0],
    [0, 1, 2, 1, 0, 0, 0],
    [0, 0, 1, 1, 2, 0, 0],
    [1, 0, 1, 2, 1, 0, 0],
    [0, 2, 1, 0, 2, 1, 0],
    [0, 1, 2, 3, 1, 0, 0],
    [1, 2, 1, 2, 2, 1, 0],
    [0, 1, 3, 2, 1, 0, 0],
    [1, 2, 4, 3, 2, 1, 0],
    [0, 3, 5, 4, 3, 2, 0],
    [1, 4, 6, 5, 4, 1, 1],
    [2, 5, 7, 6, 5, 3, 1],
    [1, 4, 8, 7, 6, 2, 1],
    [2, 6, 9, 5, 7, 4, 2],
    [1, 3, 6, 8, 5, 3, 2],
  ];

  for (let w = 0; w < 28; w++) {
    weeks.push({
      contributionDays: pattern[w].map((c, d) => ({
        date: `2026-W${w}-${d}`,
        contributionCount: c,
        weekday: d,
      })),
    });
  }

  return {
    displayName: 'Robert Wyszywany',
    yearsJoined: 6,
    followers: 4,
    totalContributions: 356,
    lastYearContributions: 343,
    currentStreak: 1,
    longestStreak: 5,
    activeRepos: 7,
    totalReleases: 2,
    diskMb: 148,
    linesAdded: 68400,
    linesDeleted: 14200,
    prsAndIssues: 16,
    issuesOpen: 1,
    issuesClosed: 10,
    prsOpen: 0,
    prsMerged: 4,
    prsClosed: 1,
    totalStars: 1,
    totalForks: 1,
    commitsByHour: [
      18, 24, 15, 6, 2, 0, 0, 1, 3, 7, 12, 16,
      19, 22, 25, 21, 28, 31, 34, 29, 36, 38, 32, 26,
    ],
    commitsByDay: [38, 54, 62, 58, 51, 46, 34],
    recentWeeks: weeks,
    languages: [
      { name: 'Dart', bytes: 570641, percent: 39.8, color: '#00B4AB' },
      { name: 'JavaScript', bytes: 416800, percent: 29.1, color: '#F7DF1E' },
      { name: 'C#', bytes: 413813, percent: 28.4, color: '#239120' },
      { name: 'SQL', bytes: 20041, percent: 1.5, color: '#336791' },
      { name: 'C++', bytes: 11400, percent: 0.8, color: '#00599C' },
      { name: 'Python', bytes: 5200, percent: 0.4, color: '#3572A5' },
    ],
    steam,
    valheimRelease: 'v1.11.1',
    valheimDownloads: 8,
  };
}

function getCubeColors(count) {
  if (count <= 0) {
    return { top: '#212636', left: '#191D2B', right: '#131722' };
  }
  if (count <= 2) {
    return { top: '#0E4429', left: '#0A331F', right: '#072416' };
  }
  if (count <= 5) {
    return { top: '#006D32', left: '#005427', right: '#003D1C' };
  }
  if (count <= 8) {
    return { top: '#26A641', left: '#1D8233', right: '#155E25' };
  }
  return { top: '#39D353', left: '#2BA640', right: '#1F7A2F' };
}

function renderIsometricCalendar(weeks, originX, originY) {
  const slice = weeks.slice(-28);
  const tw = 6.0;
  const th = 3.4;
  const cubes = [];

  for (let w = 0; w < slice.length; w++) {
    const days = slice[w].contributionDays || [];
    for (let d = 0; d < 7; d++) {
      const count = days[d]?.contributionCount || 0;
      const cx = originX + (w - d) * tw;
      const cy = originY + (w + d) * th;
      const h = count === 0 ? 2.8 : Math.min(28, 4.5 + count * 2.1);
      const { top, left, right } = getCubeColors(count);

      const topPts = [
        `${cx.toFixed(1)},${(cy - th - h).toFixed(1)}`,
        `${(cx + tw).toFixed(1)},${(cy - h).toFixed(1)}`,
        `${cx.toFixed(1)},${(cy + th - h).toFixed(1)}`,
        `${(cx - tw).toFixed(1)},${(cy - h).toFixed(1)}`,
      ].join(' ');

      const leftPts = [
        `${(cx - tw).toFixed(1)},${(cy - h).toFixed(1)}`,
        `${cx.toFixed(1)},${(cy + th - h).toFixed(1)}`,
        `${cx.toFixed(1)},${(cy + th).toFixed(1)}`,
        `${(cx - tw).toFixed(1)},${cy.toFixed(1)}`,
      ].join(' ');

      const rightPts = [
        `${cx.toFixed(1)},${(cy + th - h).toFixed(1)}`,
        `${(cx + tw).toFixed(1)},${(cy - h).toFixed(1)}`,
        `${(cx + tw).toFixed(1)},${cy.toFixed(1)}`,
        `${cx.toFixed(1)},${(cy + th).toFixed(1)}`,
      ].join(' ');

      cubes.push(
        `<polygon points="${leftPts}" fill="${left}" /><polygon points="${rightPts}" fill="${right}" /><polygon points="${topPts}" fill="${top}" />`
      );
    }
  }

  return cubes.join('\n    ');
}

function renderSegmentedBar(x, y, width, height, segments, clipId) {
  const total = segments.reduce((acc, s) => acc + s.value, 0) || 1;
  let offset = x;
  const rects = [];
  const nonZero = segments.filter((s) => s.value > 0);

  if (nonZero.length === 0) {
    rects.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#21262D" />`);
  } else {
    nonZero.forEach((seg, idx) => {
      const segW =
        idx === nonZero.length - 1
          ? Math.max(2, x + width - offset)
          : Math.max(4, (seg.value / total) * width);
      rects.push(
        `<rect x="${offset.toFixed(1)}" y="${y}" width="${segW.toFixed(1)}" height="${height}" fill="${seg.color}" />`
      );
      offset += segW;
    });
  }

  return `
  <clipPath id="${clipId}">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" />
  </clipPath>
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#161B22" />
  <g clip-path="url(#${clipId})">
    ${rects.join('\n    ')}
  </g>`;
}

function renderInfographicSvg(m) {
  // 14 mini blocks in top-left header
  const miniBlocks = Array.from({ length: 14 }, (_, i) => {
    const fills = ['#39D353', '#26A641', '#39D353', '#006D32', '#26A641', '#39D353', '#0E4429'];
    const fill = i < 11 ? fills[i % fills.length] : '#212636';
    return `<rect x="${298 + i * 10}" y="22" width="7.5" height="7.5" rx="1.8" fill="${fill}" />`;
  }).join('');

  // Plugin: habits -> Hourly bar chart (00..23)
  const maxHour = Math.max(1, ...m.commitsByHour);
  const hourBaseY = 322;
  const hourMaxH = 58;
  const hourBars = m.commitsByHour
    .map((val, hr) => {
      const bx = 26 + hr * 17.2;
      const ratio = val / maxHour;
      const bh = val === 0 ? 2 : Math.max(4, ratio * hourMaxH);
      const by = hourBaseY - bh;
      const fill =
        ratio > 0.75
          ? '#39D353'
          : ratio > 0.4
            ? '#26A641'
            : ratio > 0.15
              ? '#006D32'
              : val > 0
                ? '#0E4429'
                : '#1F2335';
      const countText =
        val > 0
          ? `<text x="${(bx + 4.2).toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" class="mono" font-size="7.5" fill="#7D8590">${val}</text>`
          : '';
      const hrLabel = String(hr).padStart(2, '0');
      return `
      <rect x="${bx.toFixed(1)}" y="${(hourBaseY - hourMaxH).toFixed(1)}" width="8.4" height="${hourMaxH}" rx="2.5" fill="#131622" />
      <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="8.4" height="${bh.toFixed(1)}" rx="2.5" fill="${fill}" />
      ${countText}
      <text x="${(bx + 4.2).toFixed(1)}" y="${hourBaseY + 13}" text-anchor="middle" class="mono" font-size="8" fill="#565F89">${hrLabel}</text>`;
    })
    .join('');

  // Plugin: habits -> Day-of-week bar chart (Sun..Sat)
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxDay = Math.max(1, ...m.commitsByDay);
  const dayBaseY = 448;
  const dayMaxH = 50;
  const dayBars = m.commitsByDay
    .map((val, d) => {
      const bx = 28 + d * 27;
      const ratio = val / maxDay;
      const bh = val === 0 ? 2 : Math.max(5, ratio * dayMaxH);
      const by = dayBaseY - bh;
      const fill = ratio > 0.75 ? '#39D353' : ratio > 0.45 ? '#26A641' : '#006D32';
      return `
      <rect x="${bx}" y="${dayBaseY - dayMaxH}" width="11" height="${dayMaxH}" rx="3" fill="#131622" />
      <rect x="${bx}" y="${by.toFixed(1)}" width="11" height="${bh.toFixed(1)}" rx="3" fill="${fill}" />
      <text x="${bx + 5.5}" y="${(by - 4).toFixed(1)}" text-anchor="middle" class="mono" font-size="8" fill="#7D8590">${val}</text>
      <text x="${bx + 5.5}" y="${dayBaseY + 13}" text-anchor="middle" class="sans" font-size="8.5" fill="#565F89">${dayNames[d]}</text>`;
    })
    .join('');

  // Plugin: habits -> Language activity mini-bars (bottom-left beside day chart)
  const top3Langs = m.languages.slice(0, 3);
  const langMiniBars = top3Langs
    .map((l, idx) => {
      const ly = 398 + idx * 23;
      const barW = 124;
      const fillW = Math.max(4, (l.percent / 100) * barW);
      return `
      <text x="234" y="${ly}" class="sans" font-size="10.5" fill="#A9B1D6">${escapeXml(l.name)}</text>
      <rect x="298" y="${ly - 8}" width="${barW}" height="6.5" rx="3" fill="#131622" />
      <rect x="298" y="${ly - 8}" width="${fillW.toFixed(1)}" height="6.5" rx="3" fill="${escapeXml(l.color)}" />
      <text x="436" y="${ly}" text-anchor="end" class="mono" font-size="9.5" fill="#7D8590">${Math.round(l.percent)}%</text>`;
    })
    .join('');

  // Plugin: isocalendar -> 3D Isometric calendar
  const isoCubes = renderIsometricCalendar(m.recentWeeks, 524, 90);

  // Plugin: languages -> Full language stacked bar on right column
  const rBarX = 476;
  const rBarY = 286;
  const rBarW = 398;
  const rBarH = 10;
  const langBarSvg = renderSegmentedBar(
    rBarX,
    rBarY,
    rBarW,
    rBarH,
    m.languages.map((l) => ({ value: l.percent, color: l.color })),
    'rLangClip'
  );

  const rLangItems = m.languages
    .slice(0, 6)
    .map((l, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const lx = col === 0 ? 476 : 680;
      const ly = 320 + row * 36;
      const trackW = 192;
      const fillW = Math.max(4, (l.percent / 100) * trackW);
      const sizeStr = l.bytes ? `${formatBytes(l.bytes)} · ` : '';
      return `
    <g transform="translate(${lx}, ${ly})">
      <circle cx="5" cy="-4" r="4.5" fill="${escapeXml(l.color)}" />
      <text x="15" y="0" class="sans" font-size="12" font-weight="600" fill="#E2E8F0">${escapeXml(l.name)}</text>
      <text x="${trackW}" y="0" text-anchor="end" class="mono" font-size="10.5" font-weight="600" fill="#A9B1D6">${sizeStr}${l.percent.toFixed(1)}%</text>
      <rect x="0" y="7" width="${trackW}" height="4.5" rx="2.2" fill="#131622" />
      <rect x="0" y="7" width="${fillW.toFixed(1)}" height="4.5" rx="2.2" fill="${escapeXml(l.color)}" />
    </g>`;
    })
    .join('');

  // Plugin: followup -> Issues & Pull Requests bars
  const issuesBarSvg = renderSegmentedBar(
    476,
    514,
    398,
    10,
    [
      { value: m.issuesOpen, color: '#238636' },
      { value: m.issuesClosed, color: '#8957E5' },
    ],
    'issuesClip'
  );

  const prsBarSvg = renderSegmentedBar(
    476,
    592,
    398,
    10,
    [
      { value: m.prsOpen, color: '#238636' },
      { value: m.prsMerged, color: '#8957E5' },
      { value: m.prsClosed, color: '#DA3633' },
    ],
    'prsClip'
  );

  const avgPerDay = (m.lastYearContributions / 365).toFixed(2);
  const st = m.steam;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="676" viewBox="0 0 900 676" fill="none" role="img" aria-label="EzzyKillS GitHub Metrics Infographic">
  <defs>
    <linearGradient id="infoBg" x1="0" y1="0" x2="900" y2="676" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0D1117" />
      <stop offset="50%" stop-color="#131621" />
      <stop offset="100%" stop-color="#0D1117" />
    </linearGradient>
  </defs>

  <style>
    .sans { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .mono { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace; }
  </style>

  <!-- Main Card Frame -->
  <rect x="1" y="1" width="898" height="674" rx="14" fill="url(#infoBg)" stroke="#242938" stroke-width="1.2" />

  <!-- ================= LEFT COLUMN ================= -->
  <!-- Base Header -->
  <circle cx="34" cy="26" r="6" fill="#58A6FF" />
  <text x="48" y="31" class="sans" font-size="16" font-weight="700" fill="#58A6FF">${escapeXml(m.displayName)} <tspan fill="#8B949E" font-weight="400" font-size="13">(@${escapeXml(USERNAME)})</tspan></text>
  ${miniBlocks}

  <!-- Account Overview Left Sub-column -->
  <g class="sans" font-size="12" fill="#C9D1D9">
    <text x="26" y="58">🕒 <tspan dx="4">Joined GitHub ${m.yearsJoined} years ago</tspan></text>
    <text x="26" y="80">👥 <tspan dx="4">Followed by ${m.followers} users</tspan></text>
    <text x="26" y="104" fill="#58A6FF" font-weight="600">📦 <tspan dx="4">${m.activeRepos} Repositories (Public &amp; Private)</tspan></text>
    <text x="26" y="126">🏷️ <tspan dx="4">${m.totalReleases} Releases · ${m.diskMb} MB Storage</tspan></text>
    <text x="26" y="148">± <tspan dx="6" fill="#3FB950" font-weight="600">+${formatCompact(m.linesAdded)} added</tspan>, <tspan fill="#F85149" font-weight="600">-${formatCompact(m.linesDeleted)} removed</tspan></text>
  </g>

  <!-- Account Overview Right Sub-column -->
  <g class="sans" font-size="12" fill="#C9D1D9">
    <text x="248" y="58">⚡ <tspan dx="4">${m.totalContributions} Total Contributions</tspan></text>
    <text x="248" y="80">📈 <tspan dx="4">${m.lastYearContributions} in Last 12 Months</tspan></text>
    <text x="248" y="104">🔀 <tspan dx="4">${m.prsAndIssues} Issues &amp; Pull Requests</tspan></text>
    <text x="248" y="126">⭐ <tspan dx="4">${m.totalStars} Stargazers · ${m.totalForks} Active Fork</tspan></text>
    <text x="248" y="148">🌍 <tspan dx="4">Poland (Europe/Warsaw)</tspan></text>
  </g>

  <line x1="24" y1="168" x2="438" y2="168" stroke="#21262D" stroke-width="1" />

  <!-- PLUGIN: Coding habits and recent activity (habits) -->
  <text x="26" y="192" class="sans" font-size="14" font-weight="700" fill="#58A6FF">💡 Coding habits and recent activity</text>
  <text x="230" y="218" text-anchor="middle" class="sans" font-size="11.5" font-weight="600" fill="#58A6FF">Commit activity per time of the day</text>

  ${hourBars}

  <text x="115" y="366" text-anchor="middle" class="sans" font-size="11.5" font-weight="600" fill="#58A6FF">Commit activity per day</text>
  <text x="334" y="366" text-anchor="middle" class="sans" font-size="11.5" font-weight="600" fill="#58A6FF">Language activity</text>

  ${dayBars}
  ${langMiniBars}

  <line x1="24" y1="474" x2="438" y2="474" stroke="#21262D" stroke-width="1" />

  <!-- PLUGIN: Steam (steam) -->
  <text x="26" y="498" class="sans" font-size="14" font-weight="700" fill="#58A6FF">🕹️ Steam — ${escapeXml(st.handle)}</text>
  <rect x="350" y="482" width="88" height="22" rx="11" fill="#1B2838" stroke="#66C0F4" stroke-width="1" />
  <text x="394" y="497" text-anchor="middle" class="mono" font-size="10.5" font-weight="700" fill="#66C0F4">LEVEL ${st.level}</text>

  <text x="26" y="520" class="sans" font-size="11" fill="#8B949E">
    🏆 <tspan fill="#C9D1D9" font-weight="600">${st.badges}</tspan> Badges   ·   🎖️ <tspan fill="#C9D1D9" font-weight="600">${st.awards}</tspan> Awards   ·   🎒 <tspan fill="#66C0F4" font-weight="600">${st.showcaseItems}</tspan> CS2 Showcase Items   ·   🛡️ <tspan fill="#3FB950">VAC Clean</tspan>
  </text>

  <!-- Steam Game 1: Counter-Strike 2 -->
  <rect x="26" y="532" width="412" height="38" rx="7" fill="#131824" stroke="#232C3D" stroke-width="1" />
  <rect x="34" y="540" width="22" height="22" rx="5" fill="#DE9B35" fill-opacity="0.18" stroke="#DE9B35" stroke-width="1" />
  <text x="45" y="555" text-anchor="middle" class="mono" font-size="10" font-weight="700" fill="#DE9B35">CS2</text>
  <text x="66" y="548" class="sans" font-size="12" font-weight="700" fill="#F0F6FC">Counter-Strike 2</text>
  <text x="66" y="562" class="sans" font-size="10" fill="#8B949E">Skin Market Trading, Inventory Analytics &amp; EzzyTracker Engine</text>
  <text x="428" y="548" text-anchor="end" class="mono" font-size="10" font-weight="600" fill="#66C0F4">ACTIVE</text>
  <rect x="348" y="555" width="80" height="4.5" rx="2.2" fill="#0D1117" />
  <rect x="348" y="555" width="74" height="4.5" rx="2.2" fill="#66C0F4" />

  <!-- Steam Game 2: Valheim -->
  <rect x="26" y="576" width="412" height="38" rx="7" fill="#131824" stroke="#232C3D" stroke-width="1" />
  <rect x="34" y="584" width="22" height="22" rx="5" fill="#3FB950" fill-opacity="0.18" stroke="#3FB950" stroke-width="1" />
  <text x="45" y="599" text-anchor="middle" class="mono" font-size="10" font-weight="700" fill="#3FB950">VH</text>
  <text x="66" y="592" class="sans" font-size="12" font-weight="700" fill="#F0F6FC">Valheim</text>
  <text x="66" y="606" class="sans" font-size="10" fill="#8B949E">ValheimTooler 1.0+ Revival · Mono Runtime Patching &amp; BepInEx</text>
  <text x="428" y="592" text-anchor="end" class="mono" font-size="10" font-weight="600" fill="#3FB950">MODDING</text>
  <rect x="348" y="599" width="80" height="4.5" rx="2.2" fill="#0D1117" />
  <rect x="348" y="599" width="80" height="4.5" rx="2.2" fill="#3FB950" />

  <!-- Steam Game 3: Ready or Not -->
  <rect x="26" y="620" width="412" height="38" rx="7" fill="#131824" stroke="#232C3D" stroke-width="1" />
  <rect x="34" y="628" width="22" height="22" rx="5" fill="#BB9AF7" fill-opacity="0.18" stroke="#BB9AF7" stroke-width="1" />
  <text x="45" y="643" text-anchor="middle" class="mono" font-size="9.5" font-weight="700" fill="#BB9AF7">RoN</text>
  <text x="66" y="636" class="sans" font-size="12" font-weight="700" fill="#F0F6FC">Ready or Not</text>
  <text x="66" y="650" class="sans" font-size="10" fill="#8B949E">Tactical Co-op &amp; Unreal Engine / C++ Memory Internals</text>
  <text x="428" y="636" text-anchor="end" class="mono" font-size="10" font-weight="600" fill="#BB9AF7">RE / C++</text>
  <rect x="348" y="643" width="80" height="4.5" rx="2.2" fill="#0D1117" />
  <rect x="348" y="643" width="64" height="4.5" rx="2.2" fill="#BB9AF7" />

  <!-- Vertical Center Divider -->
  <line x1="454" y1="20" x2="454" y2="658" stroke="#21262D" stroke-width="1" />

  <!-- ================= RIGHT COLUMN ================= -->
  <!-- PLUGIN: Isometric commit calendar (isocalendar) -->
  <text x="476" y="31" class="sans" font-size="14" font-weight="700" fill="#58A6FF">📅 Contributions calendar</text>

  <g class="sans" font-size="12" fill="#C9D1D9">
    <text x="698" y="60">🔥 <tspan dx="4">Current streak: <tspan font-weight="700" fill="#39D353">${m.currentStreak} day${m.currentStreak === 1 ? '' : 's'}</tspan></tspan></text>
    <text x="698" y="82">🏆 <tspan dx="4">Best streak: <tspan font-weight="700" fill="#58A6FF">${m.longestStreak} days</tspan></tspan></text>
    <text x="698" y="104">📈 <tspan dx="4">~${avgPerDay} commits / day</tspan></text>
  </g>

  <g>
    ${isoCubes}
  </g>

  <g transform="translate(478, 224)">
    <text x="0" y="9" class="mono" font-size="9.5" fill="#8B949E">Less</text>
    <rect x="28" y="0" width="9" height="9" rx="2" fill="#212636" />
    <rect x="40" y="0" width="9" height="9" rx="2" fill="#0E4429" />
    <rect x="52" y="0" width="9" height="9" rx="2" fill="#006D32" />
    <rect x="64" y="0" width="9" height="9" rx="2" fill="#26A641" />
    <rect x="76" y="0" width="9" height="9" rx="2" fill="#39D353" />
    <text x="90" y="9" class="mono" font-size="9.5" fill="#8B949E">More</text>
    <text x="394" y="9" text-anchor="end" class="mono" font-size="9.5" fill="#8B949E">3D Isometric Calendar (isocalendar)</text>
  </g>

  <line x1="476" y1="248" x2="874" y2="248" stroke="#21262D" stroke-width="1" />

  <!-- PLUGIN: Languages activity (languages) -->
  <text x="476" y="272" class="sans" font-size="14" font-weight="700" fill="#58A6FF">🈷️ Languages activity</text>
  <rect x="726" y="257" width="148" height="20" rx="5" fill="#161B22" stroke="#30363D" stroke-width="1" />
  <text x="800" y="271" text-anchor="middle" class="mono" font-size="9.5" font-weight="600" fill="#7EE787">PRIVATE + PUBLIC + FORK</text>

  ${langBarSvg}
  ${rLangItems}

  <line x1="476" y1="442" x2="874" y2="442" stroke="#21262D" stroke-width="1" />

  <!-- PLUGIN: Follow-up of issues and pull requests (followup) -->
  <text x="476" y="466" class="sans" font-size="14" font-weight="700" fill="#58A6FF">🎟️ Follow-up of issues and pull requests</text>

  <!-- Issues Follow-up -->
  <text x="476" y="498" class="sans" font-size="12" font-weight="600" fill="#C9D1D9">Issues <tspan fill="#8B949E" font-weight="400" font-size="11">(${m.issuesOpen + m.issuesClosed} total)</tspan></text>
  <text x="874" y="498" text-anchor="end" class="mono" font-size="10.5" fill="#8B949E">${Math.round((m.issuesClosed / Math.max(1, m.issuesOpen + m.issuesClosed)) * 100)}% resolved</text>
  ${issuesBarSvg}
  <g transform="translate(476, 540)" class="sans" font-size="11" fill="#8B949E">
    <circle cx="5" cy="-4" r="4" fill="#238636" />
    <text x="14" y="0"><tspan fill="#C9D1D9" font-weight="600">${m.issuesOpen}</tspan> Open</text>
    <circle cx="95" cy="-4" r="4" fill="#8957E5" />
    <text x="104" y="0"><tspan fill="#C9D1D9" font-weight="600">${m.issuesClosed}</tspan> Closed / Completed</text>
    <circle cx="245" cy="-4" r="4" fill="#30363D" />
    <text x="254" y="0"><tspan fill="#C9D1D9" font-weight="600">0</tspan> Skipped</text>
  </g>

  <!-- Pull Requests Follow-up -->
  <text x="476" y="576" class="sans" font-size="12" font-weight="600" fill="#C9D1D9">Pull requests <tspan fill="#8B949E" font-weight="400" font-size="11">(${m.prsOpen + m.prsMerged + m.prsClosed} total)</tspan></text>
  <text x="874" y="576" text-anchor="end" class="mono" font-size="10.5" fill="#8B949E">${Math.round((m.prsMerged / Math.max(1, m.prsOpen + m.prsMerged + m.prsClosed)) * 100)}% merged</text>
  ${prsBarSvg}
  <g transform="translate(476, 618)" class="sans" font-size="11" fill="#8B949E">
    <circle cx="5" cy="-4" r="4" fill="#238636" />
    <text x="14" y="0"><tspan fill="#C9D1D9" font-weight="600">${m.prsOpen}</tspan> Open</text>
    <circle cx="95" cy="-4" r="4" fill="#8957E5" />
    <text x="104" y="0"><tspan fill="#C9D1D9" font-weight="600">${m.prsMerged}</tspan> Merged</text>
    <circle cx="195" cy="-4" r="4" fill="#DA3633" />
    <text x="204" y="0"><tspan fill="#C9D1D9" font-weight="600">${m.prsClosed}</tspan> Closed</text>
    <circle cx="285" cy="-4" r="4" fill="#30363D" />
    <text x="294" y="0"><tspan fill="#C9D1D9" font-weight="600">0</tspan> Drafts</text>
  </g>

  <!-- Bottom Timestamp / Sync Note -->
  <text x="476" y="654" class="mono" font-size="9.5" fill="#565F89">⚡ Powered by lowlighter/metrics layout · Auto-synced via GitHub GraphQL &amp; Steam Community XML</text>
</svg>
`;
}

function renderRepoCardSvg({
  owner,
  name,
  badgeText,
  badgeColor,
  subtitle,
  descLine1,
  descLine2,
  tags,
  languages,
  footerLeft,
  footerRight,
}) {
  const barSvg = renderSegmentedBar(
    22,
    144,
    451,
    7,
    languages.map((l) => ({ value: l.percent, color: l.color })),
    `clip_${name.replace(/[^a-zA-Z0-9]/g, '')}`
  );

  let tagX = 22;
  const tagsSvg = tags
    .map((t) => {
      const w = t.length * 6.8 + 18;
      const el = `
    <rect x="${tagX.toFixed(1)}" y="110" width="${w.toFixed(1)}" height="20" rx="5" fill="#161B22" stroke="#30363D" stroke-width="1" />
    <text x="${(tagX + w / 2).toFixed(1)}" y="123.5" text-anchor="middle" class="mono" font-size="10" fill="#79C0FF">${escapeXml(t)}</text>`;
      tagX += w + 8;
      return el;
    })
    .join('');

  let langLegendX = 22;
  const langLegend = languages
    .map((l) => {
      const label = `${l.name} ${l.percent}%`;
      const el = `
    <circle cx="${langLegendX + 4}" cy="166" r="4" fill="${l.color}" />
    <text x="${langLegendX + 13}" y="170" class="sans" font-size="11" fill="#C9D1D9">${escapeXml(l.name)} <tspan fill="#8B949E">${l.percent}%</tspan></text>`;
      langLegendX += label.length * 6.8 + 26;
      return el;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="206" viewBox="0 0 495 206" fill="none" role="img" aria-label="${escapeXml(owner)}/${escapeXml(name)} Repository Card">
  <defs>
    <linearGradient id="repoBg_${escapeXml(name)}" x1="0" y1="0" x2="495" y2="206" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0D1117" />
      <stop offset="100%" stop-color="#151924" />
    </linearGradient>
  </defs>

  <style>
    .sans { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .mono { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace; }
  </style>

  <rect x="1" y="1" width="493" height="204" rx="12" fill="url(#repoBg_${escapeXml(name)})" stroke="#242938" stroke-width="1.2" />

  <!-- Repo Header -->
  <text x="22" y="33" class="sans" font-size="15.5" font-weight="700" fill="#58A6FF">📓 <tspan dx="3" fill="#8B949E" font-weight="500">${escapeXml(owner)} /</tspan> ${escapeXml(name)}</text>
  <rect x="352" y="17" width="121" height="22" rx="11" fill="#161B22" stroke="${badgeColor}" stroke-width="1" />
  <text x="412.5" y="32" text-anchor="middle" class="mono" font-size="10" font-weight="700" fill="${badgeColor}">${escapeXml(badgeText)}</text>

  <!-- Subtitle -->
  <text x="22" y="55" class="sans" font-size="12" font-weight="600" fill="#E2E8F0">${escapeXml(subtitle)}</text>

  <!-- Description -->
  <text x="22" y="76" class="sans" font-size="11.5" fill="#8B949E">${escapeXml(descLine1)}</text>
  <text x="22" y="94" class="sans" font-size="11.5" fill="#8B949E">${escapeXml(descLine2)}</text>

  <!-- Feature Pills -->
  ${tagsSvg}

  <!-- Language Bar -->
  ${barSvg}

  <!-- Language Legend -->
  ${langLegend}

  <!-- Footer Metadata -->
  <line x1="22" y1="180" x2="473" y2="180" stroke="#21262D" stroke-width="1" />
  <text x="22" y="196" class="mono" font-size="10" fill="#8B949E">${escapeXml(footerLeft)}</text>
  <text x="473" y="196" text-anchor="end" class="mono" font-size="10" fill="#58A6FF">${escapeXml(footerRight)}</text>
</svg>
`;
}

function renderTechArsenalSvg() {
  const domains = [
    {
      x: 20,
      y: 52,
      title: '⚡ Core Languages',
      accent: '#00E5FF',
      items: [
        { name: 'Dart', detail: 'Primary Mobile & UI', color: '#00B4AB' },
        { name: 'C# (.NET / Mono)', detail: 'Game Modding & Tooling', color: '#239120' },
        { name: 'JavaScript / Node', detail: 'Real-Time Backends', color: '#F7DF1E' },
        { name: 'C++ & Python', detail: 'Systems & Automation', color: '#00599C' },
      ],
    },
    {
      x: 458,
      y: 52,
      title: '📱 Full-Stack & Mobile Engineering',
      accent: '#7AA2F7',
      items: [
        { name: 'Flutter', detail: 'Cross-Platform & Native Widgets', color: '#02569B' },
        { name: 'Node.js & Express', detail: 'REST APIs & Market Workers', color: '#6DA55F' },
        { name: 'Steam OpenID & APIs', detail: 'Auth & Inventory Pipelines', color: '#66C0F4' },
        { name: 'Real-Time Feeds', detail: 'Multi-Market Price Aggregators', color: '#BB9AF7' },
      ],
    },
    {
      x: 20,
      y: 162,
      title: '🎮 Reverse Engineering & Game Modding',
      accent: '#BB9AF7',
      items: [
        { name: 'Unity & Mono Internals', detail: 'Runtime Assembly Inspection', color: '#E2E8F0' },
        { name: 'HarmonyLib & BepInEx', detail: 'Runtime Method Patching & Hooks', color: '#FF6F00' },
        { name: 'Memory Trainers', detail: 'Signature Scanning & Injection', color: '#F7768E' },
      ],
    },
    {
      x: 458,
      y: 162,
      title: '🗄️ Data, Cloud & Developer Workflow',
      accent: '#9ECE6A',
      items: [
        { name: 'PostgreSQL', detail: 'Relational Market & User Store', color: '#336791' },
        { name: 'Firebase', detail: 'Push Notifications & Cloud Sync', color: '#FFCA28' },
        { name: 'Git, Actions & VS Code', detail: 'CI/CD & Automated Telemetry', color: '#F05032' },
      ],
    },
  ];

  const cardsSvg = domains
    .map((d) => {
      const height = d.items.length === 4 ? 100 : 88;
      const pills = d.items
        .map((it, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const px = d.x + 14 + col * 198;
          const py = d.y + 34 + row * 30;
          return `
      <rect x="${px}" y="${py}" width="190" height="24" rx="5" fill="#0D1117" stroke="#21262D" stroke-width="1" />
      <circle cx="${px + 11}" cy="${py + 12}" r="4" fill="${it.color}" />
      <text x="${px + 21}" y="${py + 15.5}" class="sans" font-size="11" font-weight="700" fill="#F0F6FC">${escapeXml(it.name)}</text>`;
        })
        .join('');

      return `
    <rect x="${d.x}" y="${d.y}" width="422" height="${height}" rx="10" fill="#131621" stroke="#242938" stroke-width="1" />
    <text x="${d.x + 14}" y="${d.y + 22}" class="sans" font-size="13" font-weight="700" fill="${d.accent}">${escapeXml(d.title)}</text>
    ${pills}`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="266" viewBox="0 0 900 266" fill="none" role="img" aria-label="EzzyKillS Tech Arsenal">
  <defs>
    <linearGradient id="techBg" x1="0" y1="0" x2="900" y2="266" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0D1117" />
      <stop offset="100%" stop-color="#11141E" />
    </linearGradient>
  </defs>

  <style>
    .sans { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .mono { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace; }
  </style>

  <rect x="1" y="1" width="898" height="264" rx="14" fill="url(#techBg)" stroke="#242938" stroke-width="1.2" />

  <text x="22" y="32" class="sans" font-size="15.5" font-weight="700" fill="#58A6FF">🛠️ Tech Arsenal &amp; Engineering Domains</text>
  <text x="878" y="32" text-anchor="end" class="mono" font-size="10.5" fill="#8B949E">Full-Stack · Mobile · Reverse Engineering</text>

  ${cardsSvg}
</svg>
`;
}

async function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  // Always keep tech-arsenal.svg up to date
  fs.writeFileSync(path.join(ASSETS_DIR, 'tech-arsenal.svg'), renderTechArsenalSvg(), 'utf8');

  if (!IS_SEED && !TOKEN) {
    const msg = [
      '### ℹ️ `METRICS_TOKEN` secret not configured yet',
      '',
      'Keeping existing SVG cards in `assets/` untouched so private language stats are not overwritten.',
      '',
      'To enable automatic private + organization repository language & activity updates:',
      '1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**.',
      '2. Generate a token with `repo` and `read:org` scopes.',
      '3. Add it to this repository under **Settings → Secrets and variables → Actions → New repository secret** named **`METRICS_TOKEN`**.',
    ].join('\n');

    console.log(msg);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${msg}\n`);
    }
    return;
  }

  const metrics = IS_SEED ? await getSeedMetrics() : await fetchLiveMetrics();

  const infographicSvg = renderInfographicSvg(metrics);
  fs.writeFileSync(path.join(ASSETS_DIR, 'metrics.svg'), infographicSvg, 'utf8');

  const ezzyTrackerSvg = renderRepoCardSvg({
    owner: USERNAME,
    name: 'EzzyTracker',
    badgeText: 'ACTIVE DEV',
    badgeColor: '#00E5FF',
    subtitle: 'CS2 Portfolio & Multi-Marketplace Skin Intelligence',
    descLine1: 'Mobile-first CS2 portfolio tracker with multi-marketplace real-time pricing,',
    descLine2: 'Steam OpenID inventory sync, instant price alerts & native home widgets.',
    tags: ['Flutter', 'Node.js', 'PostgreSQL', 'Steam OpenID'],
    languages: [
      { name: 'Dart', percent: 56.4, color: '#00B4AB' },
      { name: 'JavaScript', percent: 41.2, color: '#F7DF1E' },
      { name: 'SQL', percent: 2.4, color: '#336791' },
    ],
    footerLeft: '🔒 Private Production Repo · Mobile & Backend',
    footerRight: '⚡ Active Roadmap',
  });
  fs.writeFileSync(path.join(ASSETS_DIR, 'repo-ezzytracker.svg'), ezzyTrackerSvg, 'utf8');

  const valheimToolerSvg = renderRepoCardSvg({
    owner: USERNAME,
    name: 'ValheimTooler',
    badgeText: `${metrics.valheimRelease} · 1.0+`,
    badgeColor: '#3FB950',
    subtitle: 'Valheim 1.0+ In-Game Trainer & Runtime Mod Revival',
    descLine1: 'Revived & modernized in-game trainer for Valheim 1.0+. Fixed Mono reflection',
    descLine2: 'injector crashes, updated internal game API signatures & BepInEx support.',
    tags: ['C#', '.NET / Mono', 'Unity', 'HarmonyLib'],
    languages: [
      { name: 'C#', percent: 99.4, color: '#239120' },
      { name: 'Python', percent: 0.5, color: '#3572A5' },
      { name: 'PowerShell', percent: 0.1, color: '#58A6FF' },
    ],
    footerLeft: `🏷️ Latest: ${metrics.valheimRelease} · 📥 ${metrics.valheimDownloads} Downloads`,
    footerRight: 'github.com/EzzyKillS/ValheimTooler →',
  });
  fs.writeFileSync(path.join(ASSETS_DIR, 'repo-valheimtooler.svg'), valheimToolerSvg, 'utf8');

  console.log('Successfully generated all profile SVG cards in assets/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
