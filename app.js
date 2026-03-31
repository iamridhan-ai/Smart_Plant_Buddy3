const e = React.createElement;
const { useMemo, useRef, useState, useEffect } = React;

const STORAGE_KEY = 'smart-plant-buddy-csv-cache';
const SAMPLE_CSV = `timestamp,hour,minute,second,soil_pct,temp_c,humidity,status,problem,score
2026-03-30T21:39:19.420325,21,39,19,0,40.1,37.0,CRITICAL_HOT,TOO_HOT,14
2026-03-30T21:39:21.423755,21,39,21,0,40.1,38.0,CRITICAL_HOT,TOO_HOT,15
2026-03-30T21:40:15.508848,21,40,15,91,33.8,51.0,DRENCHED,TOO_HOT,59
2026-03-30T21:40:17.512315,21,40,17,89,33.8,51.0,HAPPY,TOO_HOT,71
2026-03-30T21:40:45.556303,21,40,45,46,31.8,57.0,THIRSTY,NONE,40
2026-03-30T21:40:47.559647,21,40,47,60,31.8,57.0,DRY,NONE,54
2026-03-30T21:40:49.562935,21,40,49,79,31.8,57.0,HAPPY,NONE,84
2026-03-30T21:41:11.597197,21,41,11,0,30.2,61.0,THIRSTY,NONE,32`;

const guideHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Smart Plant Buddy Guide</title>
<style>
  body { margin: 0; font-family: Syne, sans-serif; background: #0a0a0f; color: #e8e8f0; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 40px 24px; }
  .badge { display: inline-block; padding: 6px 12px; border: 1px solid rgba(0,255,136,.3); color: #00ff88; font: 11px Space Mono, monospace; letter-spacing: .15em; }
  h1 { font-size: 56px; line-height: .95; margin: 18px 0; }
  h1 span { color: #00ff88; display: block; }
  p { color: #97a1aa; line-height: 1.7; }
  .card { margin-top: 24px; border: 1px solid rgba(255,255,255,.08); border-radius: 16px; overflow: hidden; background: #111118; }
  .head { padding: 16px 20px; background: #1a1a25; font: 12px Space Mono, monospace; color: #97a1aa; }
  pre { margin: 0; padding: 20px; white-space: pre-wrap; font: 12px/1.8 Space Mono, monospace; color: #d6e0e5; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="badge">SMART PLANT BUDDY</div>
    <h1>Build <span>Guide</span></h1>
    <p>Smart Plant Buddy uses an FC-28 moisture sensor, DHT11 temperature and humidity sensor, RGB LEDs, buzzer, a TFT display, Arduino firmware, Python CSV logging and AI summaries to show plant health in real time.</p>
    <div class="card">
      <div class="head">System highlights</div>
      <pre>1. Real-time sensing of soil moisture, heat and humidity
2. Immediate LED and buzzer feedback for stress conditions
3. TFT-based live status display with score and plant mood
4. Serial JSON stream from Arduino to Python
5. CSV logging with timestamp, minute-level tracking, status and problem labels
6. AI-style interpretation of each time period for easier explanation</pre>
    </div>
  </div>
</body>
</html>`;

const scoreNote = 'The overall score is calculated in the Arduino from soil moisture, temperature, humidity, status penalties and problem penalties, then logged into the CSV and shown in the display and summaries.';

const codeFiles = [
  {
    title: "Plant_Happiness.ino",
    meta: "Arduino firmware",
    body: `// Smart Plant Buddy firmware
// Includes:
// - moisture thresholds for DRY / THIRSTY / DRENCHED
// - temperature danger states
// - LED + buzzer responses
// - TFT display pages
// - JSON output with status + problem + score`
  },
  {
    title: "plant_logger.py",
    meta: "Serial logger",
    body: `# Logs CSV columns:
# timestamp, hour, minute, second,
# soil_pct, temp_c, humidity, status, problem, score`
  },
  {
    title: "plant_report.py",
    meta: "AI summary script",
    body: `# Reads the CSV and creates minute-level summaries
# for plant condition and care recommendations.`
  }
];

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return { headers: [], rows: [] };
  }
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map((line) => {
    const values = line.split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
  return { headers, rows };
}

function buildOverview(rows) {
  return rows.map((row) => {
    const time = row.hour && row.minute ? `${row.hour}:${row.minute}` : 'Unknown';
    let title = 'Healthy recovery';
    let summary = `At ${time}, the plant looked stable with soil moisture at ${row.soil_pct}%, temperature at ${row.temp_c}°C and humidity at ${row.humidity}%.`;
    if (row.status === 'CRITICAL_HOT') {
      title = 'Dangerous heat event';
      summary = `At ${time}, the plant entered a critical heat state at ${row.temp_c}°C while soil moisture was only ${row.soil_pct}%.`;
    } else if (row.status === 'THIRSTY') {
      title = 'Severe dryness warning';
      summary = `At ${time}, soil moisture was ${row.soil_pct}%, which indicates the plant needed water immediately.`;
    } else if (row.status === 'DRY') {
      title = 'Surface dryness detected';
      summary = `At ${time}, the top layer was drying out. Soil moisture was ${row.soil_pct}%, so the plant was trending toward thirst.`;
    } else if (row.status === 'DRENCHED') {
      title = 'Strong water detection';
      summary = `At ${time}, the probe detected a very wet root zone at ${row.soil_pct}% moisture, confirming the wet-state response.`;
    }
    return { ...row, time, title, summary };
  });
}

function buildOverallOverview(rows) {
  if (!rows.length) {
    return {
      title: 'No readings loaded',
      summary: 'Load a CSV file to generate an overall overview of the plant readings.',
      solutions: []
    };
  }

  const temps = rows.map((row) => Number(row.temp_c || 0));
  const soils = rows.map((row) => Number(row.soil_pct || 0));
  const criticalCount = rows.filter((row) => String(row.status).includes('CRITICAL')).length;
  const thirstyCount = rows.filter((row) => row.status === 'THIRSTY').length;
  const dryCount = rows.filter((row) => row.status === 'DRY').length;
  const drenchedCount = rows.filter((row) => row.status === 'DRENCHED').length;
  const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
  const avgSoil = soils.reduce((a, b) => a + b, 0) / soils.length;
  const maxTemp = Math.max(...temps);
  const minSoil = Math.min(...soils);

  let title = 'Overall plant reading overview';
  let summary = `Across ${rows.length} readings, the plant averaged ${avgSoil.toFixed(1)}% soil moisture and ${avgTemp.toFixed(1)}°C. The data shows a mix of dry stress, heat stress and brief recovery periods after watering.`;
  let solutions = [
    'Keep monitoring temperature spikes during hotter periods.',
    'Water before the soil falls into repeated thirsty readings.'
  ];

  if (criticalCount > 0) {
    title = 'Overall trend: repeated heat and dryness stress';
    summary = `Across ${rows.length} readings, the plant reached critical conditions ${criticalCount} times. The highest temperature recorded was ${maxTemp.toFixed(1)}°C, the lowest soil reading was ${minSoil}%, and the overall score stayed low during the harshest periods, showing that overheating and drying were the main problems in this dataset.`;
    solutions = [
      'Move the plant away from direct heat or strong afternoon sunlight.',
      'Water earlier so the soil does not stay dry during the hottest period.',
      'Watch for repeated critical alerts and cool the area with shade or airflow.'
    ];
  } else if (thirstyCount + dryCount > drenchedCount) {
    title = 'Overall trend: the plant was too dry more often than wet';
    summary = `Most readings leaned toward dry or thirsty states. With an average soil moisture of ${avgSoil.toFixed(1)}% and a minimum of ${minSoil}%, the plant likely needs a more consistent watering pattern.`;
    solutions = [
      'Increase watering consistency so the soil does not repeatedly drop into dry states.',
      'Check moisture before the hottest part of the day and water earlier if needed.',
      'Use the CSV trend to find the time when dryness usually starts.'
    ];
  } else if (drenchedCount > 0) {
    title = 'Overall trend: moisture recovery is happening';
    summary = `The log shows clear wet recovery moments, including drenched readings, which means the system is detecting watering events correctly. The remaining task is keeping the plant in the healthy range more consistently between those extremes.`;
    solutions = [
      'Aim for moderate moisture instead of swinging between very dry and very wet readings.',
      'Check whether watering can be spread more evenly through the day.',
      'Keep tracking temperature so heat does not undo the recovery.'
    ];
  }

  return { title, summary, solutions };
}

function sentimentClass(status) {
  if (String(status).includes('CRITICAL')) return 'bad';
  if (status === 'THIRSTY' || status === 'DRY' || status === 'HOT' || status === 'COLD') return 'warn';
  return 'good';
}

function sectionHead(eyebrow, title, copy) {
  return e('div', { className: 'section-head' }, [
    e('div', { key: 'left' }, [
      e('div', { className: 'eyebrow', key: 'eyebrow' }, eyebrow),
      e('h2', { className: 'section-title', key: 'title' }, title)
    ]),
    e('p', { className: 'section-copy', key: 'copy' }, copy)
  ]);
}

function CircuitDiagram() {
  const wiringRows = [
    ['FC-28 soil sensor', 'Arduino A0', 'Analog soil moisture input'],
    ['DHT11', 'Arduino D7', 'Temperature + humidity input'],
    ['Status RGB LED', 'Arduino D6 / D8 / D9', 'Moisture-state indicator'],
    ['Health RGB LED', 'Arduino D3 / D5 / D11', 'Overall health indicator'],
    ['Buzzer', 'Arduino D4', 'Audible alert output'],
    ['1.8" TFT display', 'Arduino SPI pins', 'Live readings, score and plant mood pages'],
    ['5V rail', 'All powered modules', 'Shared supply line'],
    ['GND rail', 'All modules', 'Shared electrical ground']
  ];

  return e('div', { className: 'panel' }, [
    e('div', { className: 'table-wrap', key: 'photo-wrap', style: { marginBottom: '18px' } }, [
      e('div', { className: 'table-scroll', key: 'photo-scroll', style: { maxHeight: 'none', padding: '18px' } }, [
        e('figure', { key: 'final-photo', style: { margin: 0 } }, [
          e('img', {
            src: '/Users/pingu/Desktop/3a4ca3f1-bf4f-48f9-bc1c-6a6a13383741.jpg',
            alt: 'Final Smart Plant Buddy physical circuit build',
            style: {
              display: 'block',
              width: '100%',
              height: 'auto',
              borderRadius: '18px',
              border: '1px solid rgba(255,255,255,0.08)'
            },
            key: 'img'
          }),
          e('figcaption', {
            key: 'caption',
            style: {
              marginTop: '10px',
              color: 'var(--muted)',
              fontSize: '14px',
              lineHeight: '1.6'
            }
          }, 'Final physical build of the Smart Plant Buddy system, showing the single Arduino, breadboard wiring, TFT display and connected sensor modules.')
        ])
      ])
    ]),

    e('div', { className: 'table-wrap', key: 'svg-wrap', style: { marginBottom: '18px' } }, [
      e('div', { className: 'table-scroll', key: 'svg-scroll', style: { maxHeight: 'none' } }, [
        e('svg', {
          viewBox: '0 0 980 500',
          width: '100%',
          key: 'svg',
          style: {
            display: 'block',
            minWidth: '820px',
            background: '#0f1813'
          }
        }, [
          e('rect', { x: 360, y: 120, width: 260, height: 220, rx: 24, fill: '#152637', stroke: '#67c7ff', strokeWidth: 3, key: 'arduino' }),
          e('text', { x: 490, y: 165, textAnchor: 'middle', fill: '#edf6ef', fontSize: '30', fontFamily: 'Syne', key: 'a1t1' }, 'ARDUINO'),
          e('text', { x: 490, y: 195, textAnchor: 'middle', fill: '#67c7ff', fontSize: '16', fontFamily: 'Space Mono', key: 'a1t2' }, 'sensing + display + alerts'),

          e('rect', { x: 60, y: 70, width: 210, height: 90, rx: 18, fill: '#1b3023', stroke: '#8cff9d', strokeWidth: 3, key: 'soil' }),
          e('text', { x: 165, y: 118, textAnchor: 'middle', fill: '#edf6ef', fontSize: '24', fontFamily: 'Syne', key: 'soil1' }, 'FC-28'),
          e('text', { x: 165, y: 145, textAnchor: 'middle', fill: '#8cff9d', fontSize: '13', fontFamily: 'Space Mono', key: 'soil2' }, 'soil moisture'),

          e('rect', { x: 60, y: 210, width: 210, height: 90, rx: 18, fill: '#2c1f39', stroke: '#c987ff', strokeWidth: 3, key: 'dht' }),
          e('text', { x: 165, y: 258, textAnchor: 'middle', fill: '#edf6ef', fontSize: '24', fontFamily: 'Syne', key: 'dht1' }, 'DHT11'),
          e('text', { x: 165, y: 285, textAnchor: 'middle', fill: '#c987ff', fontSize: '13', fontFamily: 'Space Mono', key: 'dht2' }, 'temp + humidity'),

          e('rect', { x: 55, y: 350, width: 230, height: 110, rx: 18, fill: '#3a241d', stroke: '#ff8a57', strokeWidth: 3, key: 'tft' }),
          e('text', { x: 170, y: 402, textAnchor: 'middle', fill: '#edf6ef', fontSize: '24', fontFamily: 'Syne', key: 'tft1' }, '1.8" TFT'),
          e('text', { x: 170, y: 430, textAnchor: 'middle', fill: '#ffb18d', fontSize: '13', fontFamily: 'Space Mono', key: 'tft2' }, 'live display'),

          e('rect', { x: 700, y: 70, width: 190, height: 90, rx: 18, fill: '#31271f', stroke: '#ffb347', strokeWidth: 3, key: 'led1' }),
          e('text', { x: 795, y: 115, textAnchor: 'middle', fill: '#edf6ef', fontSize: '22', fontFamily: 'Syne', key: 'led1t1' }, 'Status RGB LED'),
          e('text', { x: 795, y: 142, textAnchor: 'middle', fill: '#ffb18d', fontSize: '13', fontFamily: 'Space Mono', key: 'led1t2' }, 'D6 / D8 / D9'),

          e('rect', { x: 700, y: 190, width: 190, height: 90, rx: 18, fill: '#24301f', stroke: '#8cff9d', strokeWidth: 3, key: 'led2' }),
          e('text', { x: 795, y: 235, textAnchor: 'middle', fill: '#edf6ef', fontSize: '22', fontFamily: 'Syne', key: 'led2t1' }, 'Health RGB LED'),
          e('text', { x: 795, y: 262, textAnchor: 'middle', fill: '#8cff9d', fontSize: '13', fontFamily: 'Space Mono', key: 'led2t2' }, 'D3 / D5 / D11'),

          e('rect', { x: 700, y: 320, width: 190, height: 80, rx: 18, fill: '#2f2718', stroke: '#ffe86b', strokeWidth: 3, key: 'buzz' }),
          e('text', { x: 795, y: 368, textAnchor: 'middle', fill: '#edf6ef', fontSize: '22', fontFamily: 'Syne', key: 'buzz1' }, 'Buzzer'),

          e('line', { x1: 270, y1: 115, x2: 360, y2: 175, stroke: '#8cff9d', strokeWidth: 5, key: 'w1' }),
          e('line', { x1: 270, y1: 255, x2: 360, y2: 235, stroke: '#c987ff', strokeWidth: 5, key: 'w2' }),
          e('line', { x1: 285, y1: 405, x2: 360, y2: 290, stroke: '#ff8a57', strokeWidth: 5, key: 'w3' }),

          e('line', { x1: 620, y1: 165, x2: 700, y2: 115, stroke: '#ff6a3d', strokeWidth: 5, key: 'w4' }),
          e('line', { x1: 620, y1: 220, x2: 700, y2: 235, stroke: '#8cff9d', strokeWidth: 5, key: 'w5' }),
          e('line', { x1: 620, y1: 285, x2: 700, y2: 360, stroke: '#ffe86b', strokeWidth: 5, key: 'w6' }),

          e('line', { x1: 140, y1: 470, x2: 860, y2: 470, stroke: '#7c8489', strokeWidth: 4, key: 'gnd1' }),
          e('line', { x1: 490, y1: 340, x2: 490, y2: 470, stroke: '#7c8489', strokeWidth: 4, key: 'gnd2' }),

          e('text', { x: 500, y: 490, fill: '#7c8489', fontSize: '12', fontFamily: 'Space Mono', textAnchor: 'middle', key: 'lab3' }, 'Shared ground and power rails across the full single-Arduino system')
        ])
      ])
    ]),

    e('div', { className: 'table-wrap', key: 'pin-table' }, [
      e('div', { className: 'table-scroll', key: 'table-scroll', style: { maxHeight: 'none' } }, [
        e('table', { key: 'table' }, [
          e('thead', { key: 'thead' }, [
            e('tr', { key: 'tr' }, [
              e('th', { key: 'c1' }, 'From'),
              e('th', { key: 'c2' }, 'To'),
              e('th', { key: 'c3' }, 'Purpose')
            ])
          ]),
          e('tbody', { key: 'tbody' }, wiringRows.map((row, index) =>
            e('tr', { key: index }, row.map((cell, cellIndex) => e('td', { key: cellIndex }, cell)))
          ))
        ])
      ])
    ])
  ]);
}

function App() {
  const fileInputRef = useRef(null);
  const [showCsv, setShowCsv] = useState(false);
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [csvLabel, setCsvLabel] = useState('Sample data loaded');

  useEffect(() => {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (!cached) return;
    try {
      const parsedCache = JSON.parse(cached);
      if (parsedCache && parsedCache.text) {
        setCsvText(parsedCache.text);
        setCsvLabel(parsedCache.label || 'Previously loaded CSV');
      }
    } catch (error) {
      console.error('Could not restore cached CSV', error);
    }
  }, []);

  const parsed = useMemo(() => parseCsv(csvText), [csvText]);
  const overview = useMemo(() => buildOverview(parsed.rows), [parsed.rows]);
  const overallOverview = useMemo(() => buildOverallOverview(parsed.rows), [parsed.rows]);
  const maxTemp = useMemo(() => parsed.rows.length ? Math.max(...parsed.rows.map((row) => Number(row.temp_c || 0))) : 0, [parsed.rows]);
  const minSoil = useMemo(() => parsed.rows.length ? Math.min(...parsed.rows.map((row) => Number(row.soil_pct || 0))) : 0, [parsed.rows]);
  const latestScore = useMemo(() => parsed.rows.length ? Number(parsed.rows[parsed.rows.length - 1].score || 0) : 0, [parsed.rows]);

  function openFilePicker() {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }

  function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setCsvText(text);
      setCsvLabel(`Loaded from ${file.name}`);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ text, label: `Loaded from ${file.name}` }));
    };
    reader.readAsText(file);
  }

  return e('div', { className: 'app-shell' }, [
    e('input', {
      type: 'file',
      accept: '.csv,text/csv',
      ref: fileInputRef,
      onChange: handleFileChange,
      style: { display: 'none' },
      key: 'file-input'
    }),
    e('header', { className: 'topbar', key: 'topbar' }, [
      e('div', { className: 'brand', key: 'brand' }, [
        e('span', { className: 'eyebrow', key: 'e' }, 'Smart Plant Buddy'),
        e('strong', { className: 'brand-title', key: 't' }, 'Plant Monitoring System')
      ]),
      e('nav', { className: 'nav', key: 'nav' }, [
        e('a', { className: 'nav-link', href: '#overview', key: 'o' }, 'Overview'),
        e('a', { className: 'nav-link', href: '#diagram', key: 'dg' }, 'Circuit Diagram'),
        e('a', { className: 'nav-link', href: '#guide', key: 'g' }, 'Guide'),
        e('a', { className: 'nav-link', href: '#timeline', key: 't' }, 'Readings'),
        e('a', { className: 'nav-link', href: '#overall', key: 'ov' }, 'AI Overview'),
        e('a', { className: 'nav-link', href: '#code', key: 'c' }, 'Code'),
        e('a', { className: 'nav-link', href: '#data', key: 'd' }, 'CSV')
      ])
    ]),
    e('section', { className: 'hero', key: 'hero' }, [
      e('div', { className: 'hero-card', key: 'left' }, [
        e('div', { className: 'eyebrow', key: 'eyebrow' }, 'Embedded Plant Care System'),
        e('h1', { key: 'h1' }, ['Smart Plant ', e('span', { key: 'span' }, 'Buddy')]),
        e('p', { className: 'hero-copy', key: 'copy' }, 'Smart Plant Buddy senses soil moisture, temperature and humidity, responds with LED and buzzer feedback, logs every reading into CSV and turns those readings into readable time-based summaries.'),
        e('div', { className: 'hero-actions', key: 'actions' }, [
          e('a', { className: 'button', href: '#diagram', key: 'diagram' }, 'View Circuit Diagram'),
          e('button', { className: 'button', type: 'button', onClick: openFilePicker, key: 'load-csv' }, 'Load Latest CSV'),
          e('button', { className: 'button', type: 'button', onClick: () => setShowCsv(!showCsv), key: 'toggle' }, showCsv ? 'Hide CSV' : 'Show CSV')
        ]),
        e('p', { className: 'metric-note', key: 'csv-note', style: { marginTop: '18px' } }, `Current data source: ${csvLabel}. To update the site with new readings, choose /Users/pingu/Desktop/yes/plant_log.csv.`)
      ]),
      e('aside', { className: 'hero-side', key: 'right' }, [
        e('div', { className: 'metric-grid', key: 'grid' }, [
          e('div', { className: 'metric', key: 'm1' }, [e('div', { className: 'metric-label', key: 'l1' }, 'Rows Loaded'), e('div', { className: 'metric-value', key: 'v1' }, String(parsed.rows.length))]),
          e('div', { className: 'metric', key: 'm2' }, [e('div', { className: 'metric-label', key: 'l2' }, 'Peak Temp'), e('div', { className: 'metric-value', key: 'v2' }, `${maxTemp.toFixed(1)}°C`)]),
          e('div', { className: 'metric', key: 'm3' }, [e('div', { className: 'metric-label', key: 'l3' }, 'Lowest Soil'), e('div', { className: 'metric-value', key: 'v3' }, `${minSoil}%`)]),
          e('div', { className: 'metric', key: 'm4' }, [e('div', { className: 'metric-label', key: 'l4' }, 'Latest Score'), e('div', { className: 'metric-value', key: 'v4' }, String(latestScore))])
        ]),
        e('p', { className: 'metric-note', key: 'note' }, 'Loading a new CSV replaces the sample data immediately, updates the cards, refreshes the table and stores the last selected CSV in the browser for the next time the page opens.')
      ])
    ]),
    e('section', { className: 'section', id: 'overview', key: 'overview' }, [
      sectionHead('Project Story', 'System overview', 'The system combines sensing, embedded response, logging and readable summaries in one workflow.'),
      e('p', { className: 'metric-note', key: 'score-note', style: { marginBottom: '18px' } }, scoreNote),
      e('div', { className: 'overview-grid', key: 'grid' }, [
        e('article', { className: 'overview-card', key: 'a1' }, [e('span', { className: 'chip good', key: 'c1' }, 'Hardware'), e('h3', { className: 'card-title', key: 't1' }, 'Real-time sensing'), e('p', { className: 'card-copy', key: 'p1' }, 'FC-28 moisture sensing and DHT11 temperature and humidity sensing drive the logic for plant comfort, warning and danger states.')]),
        e('article', { className: 'overview-card', key: 'a2' }, [e('span', { className: 'chip warn', key: 'c2' }, 'Data'), e('h3', { className: 'card-title', key: 't2' }, 'Structured logging'), e('p', { className: 'card-copy', key: 'p2' }, 'The Arduino emits JSON and the Python logger stores timestamp, minute, sensor values, status and problem into CSV.')]),
        e('article', { className: 'overview-card', key: 'a3' }, [e('span', { className: 'chip bad', key: 'c3' }, 'Insight'), e('h3', { className: 'card-title', key: 't3' }, 'Time-based summaries'), e('p', { className: 'card-copy', key: 'p3' }, 'Minute-level summaries make it easy to see when the plant was overheating, drying out or recovering after watering.')])
      ])
    ]),
    e('section', { className: 'section', id: 'diagram', key: 'diagram' }, [
      sectionHead('Wiring', 'Circuit diagram', 'This section shows the final physical build photo and a clean generated diagram of the final single-Arduino system wiring.'),
      e(CircuitDiagram, { key: 'diagram-panel' })
    ]),
    e('section', { className: 'section', id: 'guide', key: 'guide' }, [
      sectionHead('Build Guide', 'Project guide', 'This section presents the main project explanation and implementation story.'),
      e('div', { className: 'guide-frame', key: 'frame' }, [e('iframe', { title: 'Guide', srcDoc: guideHtml, key: 'iframe' })])
    ]),
    e('section', { className: 'section', id: 'timeline', key: 'timeline' }, [
      sectionHead('Reading Overview', 'Per-time plant condition summary', 'Each card below is derived from a logged time point and explains what the plant was experiencing.'),
      e('div', { className: 'panel', key: 'panel' }, [
        e('div', { className: 'toolbar', key: 'timeline-toolbar' }, [
          e('span', { className: 'chip', key: 'timeline-source' }, `Source: ${csvLabel}`),
          e('div', { className: 'toolbar-actions', key: 'timeline-actions' }, [
            e('button', { className: 'button', type: 'button', onClick: openFilePicker, key: 'timeline-load' }, 'Read New CSV')
          ])
        ]),
        e('div', { className: 'timeline', key: 'list' }, overview.map((item, index) =>
          e('article', { className: 'timeline-card', key: item.timestamp + index }, [
            e('div', { className: 'timeline-header', key: 'head' }, [
              e('div', { key: 'left' }, [e('div', { className: 'timeline-time', key: 'time' }, item.time), e('h3', { className: 'timeline-title', key: 'title' }, item.title)]),
              e('span', { className: `chip ${sentimentClass(item.status)}`, key: 'chip' }, item.status)
            ]),
            e('p', { className: 'timeline-summary', key: 'summary' }, item.summary),
            e('div', { className: 'timeline-metrics', key: 'metrics' }, [
              e('span', { className: 'metric-pill', key: 's' }, `Soil ${item.soil_pct}%`),
              e('span', { className: 'metric-pill', key: 't' }, `Temp ${item.temp_c}°C`),
              e('span', { className: 'metric-pill', key: 'h' }, `Humidity ${item.humidity}%`),
              e('span', { className: 'metric-pill', key: 'p' }, `Problem ${item.problem}`),
              e('span', { className: 'metric-pill', key: 'sc' }, `Score ${item.score || 0}`)
            ])
          ])
        ))
      ])
    ]),
    e('section', { className: 'section', id: 'overall', key: 'overall' }, [
      sectionHead('AI Overview', 'Overall reading overview', 'This section combines all readings into one overall explanation of the plant condition.'),
      e('div', { className: 'panel', key: 'overall-panel' }, [
        e('div', { className: 'toolbar', key: 'overall-toolbar' }, [
          e('span', { className: 'chip', key: 'overall-source' }, `Source: ${csvLabel}`),
          e('div', { className: 'toolbar-actions', key: 'overall-actions' }, [
            e('button', { className: 'button', type: 'button', onClick: openFilePicker, key: 'overall-load' }, 'Read New CSV')
          ])
        ]),
        e('article', { className: 'timeline-card', key: 'overall-card' }, [
          e('h3', { className: 'timeline-title', key: 'overall-title' }, overallOverview.title),
          e('p', { className: 'timeline-summary', key: 'overall-summary', style: { marginTop: '12px' } }, overallOverview.summary),
          e('div', { key: 'overall-solutions-wrap', style: { marginTop: '16px' } }, [
            e('div', { className: 'timeline-time', key: 'overall-solutions-title', style: { marginBottom: '8px' } }, 'Suggested actions'),
            e('ul', { key: 'overall-solutions-list', style: { margin: '0 0 0 18px', padding: 0, color: '#8da496', lineHeight: '1.8' } },
              overallOverview.solutions.map((solution, solutionIndex) => e('li', { key: solutionIndex }, solution))
            )
          ])
        ])
      ])
    ]),
    e('section', { className: 'section', id: 'code', key: 'code' }, [
      sectionHead('Source Code', 'Core project files', 'These are the main implementation files for the firmware, logger and reporting flow.'),
      e('div', { className: 'code-grid', key: 'grid' }, codeFiles.map((file) =>
        e('article', { className: 'code-card', key: file.title }, [
          e('div', { className: 'code-header', key: 'head' }, [
            e('h3', { className: 'code-title', key: 't' }, file.title),
            e('span', { className: 'code-meta', key: 'm' }, file.meta)
          ]),
          e('pre', { key: 'pre' }, file.body)
        ])
      ))
    ]),
    e('section', { className: 'section', id: 'data', key: 'data' }, [
      sectionHead('Raw Data', 'CSV log viewer', 'Open the raw CSV to inspect the direct sensor evidence behind the summaries.'),
      e('div', { className: 'panel', key: 'panel' }, [
        e('div', { className: 'toolbar', key: 'toolbar' }, [
          e('span', { className: 'chip', key: 'rows' }, `Rows loaded: ${parsed.rows.length}`),
          e('div', { className: 'toolbar-actions', key: 'actions' }, [
            e('button', { className: 'button', type: 'button', onClick: openFilePicker, key: 'load' }, 'Load CSV From yes Folder'),
            e('button', { className: 'button', type: 'button', onClick: () => setShowCsv(!showCsv), key: 'toggle' }, showCsv ? 'Hide Raw CSV' : 'Display Raw CSV')
          ])
        ]),
        showCsv
          ? e('div', { className: 'table-wrap', key: 'table-wrap' }, [
              e('div', { className: 'table-scroll', key: 'scroll' }, [
                e('table', { key: 'table' }, [
                  e('thead', { key: 'thead' }, [
                    e('tr', { key: 'tr' }, parsed.headers.map((header) => e('th', { key: header }, header)))
                  ]),
                  e('tbody', { key: 'tbody' }, parsed.rows.map((row, index) =>
                    e('tr', { key: row.timestamp + index }, parsed.headers.map((header) => e('td', { key: header }, row[header])))
                  ))
                ])
              ])
            ])
          : e('p', { className: 'section-copy', key: 'copy' }, 'The raw CSV table is hidden until opened.')
      ])
    ]),
    e('footer', { className: 'footer', key: 'footer' }, 'Open this file directly from your laptop, then choose the latest CSV from /Users/pingu/Desktop/yes/plant_log.csv whenever you want the site to refresh with new readings.')
  ]);
}

ReactDOM.createRoot(document.getElementById('root')).render(e(App));
