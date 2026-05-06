const fs = require('fs');

const ws = require('ws');

const { HttpsProxyAgent } = require('https-proxy-agent');

const { SocksProxyAgent } = require('socks-proxy-agent');

const { pack, unpack } = require("msgpackr");

const url = require('url');

const { fork } = require('child_process');

const os = require('os');

const dns = require('dns');

const nativePerformance = global.performance ? global.performance : null;

const nativeFetch = global.fetch ? global.fetch.bind(global) : null;

const realFetch = nativeFetch

  ? (...args) => nativeFetch(...args)

  : (...args) => import('node-fetch').then((mod) => (mod.default || mod)(...args));

const readline = require('readline');



process.on('uncaughtException', function (e) { console.log(e) });



// Filter out arras.io build messages

if (process.env.IS_WORKER === 'true') {

  const originalConsoleLog = console.log;

  console.log = function(...args) {

    const message = args.join(' ');

    

    // Filter out unwanted messages

    const filters = [

      'arras.io - build',

      'Unexpected token',

      // Add your custom filters here:

      // 'some message you want to hide',

      // 'another unwanted message',

      // 'error message to suppress',

      // 'debug info',

      // '[headless]', // Hide all headless messages

      // 'WebSocket', // Hide WebSocket messages

      // 'Connected', // Hide connection messages

      // 'Disconnected', // Hide disconnection messages

      // 'Status', // Uncomment to hide all status messages (currently disabled)

    ];

    

    // Check if message contains any filter text

    const shouldFilter = filters.some(filter => message.includes(filter));

    

    if (shouldFilter) {

      return; // Silently filter out matching messages

    }

    

    return originalConsoleLog.apply(console, args);

  };

}



if (!process.env.IS_WORKER) {

  // --- MASTER PROCESS (TUI Controller) ---

  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const rl = isInteractive ? readline.createInterface({

    input: process.stdin,

    output: process.stdout

  }) : null;

  let rlClosed = false;

  if (rl) {

    rl.on('close', () => { rlClosed = true; });

  }

  let nonInteractiveNotified = false;

  if (!isInteractive) {

    setInterval(() => {}, 60000);

  }

  const configFilePath = 'bot_config.json';



  const getPath = function(name, tree) {

    let p = '', o = tree[name];

    while(o) { p = o[0] + p; let n = o[1]; if(n === 'Basic') { break } o = tree[n] }

    return p;

  };



  const tree = {

    'Browser': ['Y', 'Surfer'],  'Strider': ['K', 'Fighter'], 'Automingler': ['J', 'Mingler'], 'Mingler': ['K', 'Hexa Tank'], 'Necromancer': ['Y', 'Necromancer'], 'Underseer': ['I', 'Director'], 'Firework': ['Y', 'Rocketeer'], 'Leviathan': ['H', 'Rocketeer'], 'Rocketeer': ['K', 'Launcher'], 'Annihilator': ['U', 'Destroyer'], 'Destroyer': ['Y', 'Pounder'], 'Swarmer': ['I', 'Launcher'], 'Twister' :['U', 'Launcher'], 'Launcher': ['H', 'Pounder'], 'Fighter': ['Y', 'TriAngle'], 'Surfer': ['K','TriAngle'], 'Sprayer': ['H', 'Machine Gun'], 'Redistributor': ['Y', 'Sprayer'], 'Spreadshot': ['U', 'Triple Shot'], 'Gale': ['I', 'Octo Tank'],'Crackshot': ['J', 'Penta Shot'], 'Penta Shot': ['Y', 'Triple Shot'], 'Twin': ['Y', 'Basic'], 'Double Twin': ['Y', 'Twin'], 'Triple Shot': ['U', 'Twin'], 'Sniper': ['U', 'Basic'], 'Machine Gun': ['I', 'Basic'], 'Gunner': ['I', 'Machine Gun'], 'Machine Gunner': ['H', 'Gunner'], 'Nailgun': ['U', 'Gunner'], 'Pincer': ['K', 'Nailgun'], 'Flank Guard': ['H', 'Basic'], 'Hexa Tank': ['Y', 'Flank Guard'], 'Octo Tank': ['Y', 'Hexa Tank'], 'Cyclone': ['U', 'Hexa Tank'], 'HexaTrapper': ['I', 'Hexa Tank'], 'TriAngle': ['U', 'Flank Guard'], 'Fighter': ['Y', 'TriAngle'], 'Booster': ['U', 'TriAngle'], 'Falcon': ['I', 'TriAngle'], 'Bomber': ['H', 'TriAngle'], 'AutoTriAngle': ['J', 'TriAngle'], 'Surfer': ['K', 'TriAngle'], 'Auto3': ['I', 'Flank Guard'], 'Auto5': ['Y', 'Auto3'], 'Mega3': ['U', 'Auto3'], 'Auto4': ['I', 'Auto3'], 'Banshee': ['H', 'Auto3'], 'Trap Guard': ['H', 'Flank Guard'], 'Buchwhacker': ['Y', 'Trap Guard'], 'Gunner Trapper': ['U', 'Trap Guard'], 'Conqueror': ['J', 'Trap Guard'], 'Bulwark': ['K', 'Trap Guard'], 'TriTrapper': ['J', 'Flank Guard'], 'Fortress': ['Y', 'TriTrapper'], 'Septatrapper': ['I', 'TriTrapper'], 'Architect': ['H', 'TriTrapper'], 'TripleTwin': ['K', 'Flank Guard'], 'Director': ['J', 'Basic'], 'Pounder': ['K', 'Basic'],

  };

  

  const STAT_SLOT_COUNT = 10;

  const defaultStats = Object.freeze([2, 2, 2, 6, 6, 8, 8, 8, 0, 0]);



  // --- MODIFIED: botConfig now includes modes for names and tanks ---

  let botConfig = {

    squadId: 'MySquadName',

    region: 'wa',

    feedMode: 'off',

    name: '[SSS] tristam',

    nameMode: 'fixed', // 'fixed' or 'random'

    nameFile: 'names.txt',

    tank: 'Booster',

    keys: [],

    tankMode: 'single', // 'single' or 'multi'

    multiTankConfig: [], // Stores configs for multi-mode, e.g., [{ count: 2, tank: 'Twin', keys: ['U','K'] }]

    autoFire: false,

    autoRespawn: true,

    target: 'player',

    aim: 'drone',

    chatSpam: '',

    stats: [...defaultStats],

    launchDelay: 20000,

    autoStartCount: 1,

    reconnectAttempts: 3,

    reconnectDelay: 15000

  };



  let workers = [];

  let proxies = {};

  let randomNames = []; // --- NEW: To store names from the name file ---

  let tankLetters = []; // --- NEW: To store letter combinations from Tanks.txt ---

  let paused = false;

  let botsStarted = false;



  function sanitizeKeys(keys) {

      if (!Array.isArray(keys)) return [];

      return keys.map(key => String(key).trim().toUpperCase()).filter(Boolean);

  }



  function sanitizeStatBuild(stats, expectedLength) {

      if (!Array.isArray(stats) || stats.length === 0) return null;

      if (Number.isInteger(expectedLength) && stats.length !== expectedLength) return null;



      const normalized = stats.map(value => parseInt(value, 10));

      if (normalized.some(value => Number.isNaN(value) || value < 0)) {

          return null;

      }

      return normalized;

  }



  

  function pickRandom(items, fallbackValue) {

      if (!Array.isArray(items) || items.length === 0) {

          return fallbackValue;

      }

      return items[Math.floor(Math.random() * items.length)];

  }



  function parseOnOffMode(value) {

      if (typeof value === 'boolean') {

          return value ? 'on' : 'off';

      }

      if (typeof value !== 'string') {

          return null;

      }



      const trimmedValue = value.trim().toLowerCase();

      if (['on', 'true', 'yes', 'enable', 'enabled'].includes(trimmedValue)) {

          return 'on';

      }

      if (['off', 'false', 'no', 'disable', 'disabled', 'custom'].includes(trimmedValue)) {

          return 'off';

      }

      return null;

  }



  function sanitizeFeedMode(feedMode, legacyValue) {

      return parseOnOffMode(feedMode) || parseOnOffMode(legacyValue) || 'off';

  }



  function normalizeHash(value) {

      if (typeof value !== 'string') return '';

      const trimmed = value.trim();

      if (!trimmed) return '';

      return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;

  }



  function getServerHash() {

      const envHash = normalizeHash(process.env.ARRAS_HASH || process.env.SERVER_HASH || '');

      if (envHash) {

          return envHash;

      }

      const squadHash = normalizeHash(botConfig.squadId);

      if (squadHash) {

          console.log('Using squadId as server hash.');

          return squadHash;

      }

      const regionHash = normalizeHash(botConfig.region);

      if (regionHash) {

          return regionHash;

      }

      return '';

  }



  function applyBotConfig(partialConfig) {

      const mergedConfig = { ...botConfig, ...partialConfig };

      const legacyFeedMode = partialConfig && Object.prototype.hasOwnProperty.call(partialConfig, 'configPreset')

          ? partialConfig.configPreset

          : undefined;

      const legacyFeedBotStats = partialConfig && Object.prototype.hasOwnProperty.call(partialConfig, 'feedbotstats')

          ? partialConfig.feedbotstats

          : undefined;

      mergedConfig.feedMode = sanitizeFeedMode(mergedConfig.feedMode, legacyFeedMode);

      delete mergedConfig.configPreset;

      mergedConfig.stats = sanitizeStatBuild(mergedConfig.stats, STAT_SLOT_COUNT) || [...defaultStats];

      delete mergedConfig.feedbotstats;

      delete mergedConfig.feedModeTanks;

      mergedConfig.keys = sanitizeKeys(mergedConfig.keys);

      mergedConfig.region = typeof mergedConfig.region === 'string' ? mergedConfig.region.trim() : mergedConfig.region;

      mergedConfig.squadId = typeof mergedConfig.squadId === 'string' ? mergedConfig.squadId.trim() : mergedConfig.squadId;

      mergedConfig.multiTankConfig = Array.isArray(mergedConfig.multiTankConfig)

          ? mergedConfig.multiTankConfig

              .map(config => ({

                  ...(config && typeof config === 'object' ? config : {}),

                  count: parseInt(config && config.count, 10),

                  tank: typeof (config && config.tank) === 'string' ? config.tank.trim() : '',

                  keys: sanitizeKeys(config && config.keys)

              }))

              .filter(config => Number.isInteger(config.count) && config.count > 0 && config.tank)

          : [];

      botConfig = mergedConfig;

  }



  function loadConfigFile(filePath) {

      const savedConfigData = fs.readFileSync(filePath, 'utf8');

      applyBotConfig(JSON.parse(savedConfigData));

  }



  function saveConfig() {

      try {

          const configToSave = { ...botConfig };

          delete configToSave.configPreset;

          delete configToSave.feedbotstats;

          delete configToSave.feedModeTanks;

          fs.writeFileSync(configFilePath, JSON.stringify(configToSave, null, 2), 'utf8');

          return 'Configuration saved.';

      } catch (e) {

          return 'Error saving configuration file.';

      }

  }



  function loadConfig() {

      try {

          if (fs.existsSync(configFilePath)) {

              loadConfigFile(configFilePath);

              return 'Configuration loaded from bot_config.json.';

          }

          return 'No config file found, using defaults.';

      } catch (e) {

          return 'Error loading config file. Using defaults.';

      }

  }



  function parseProxyLine(line) {

      const trimmed = String(line || '').trim();

      if (!trimmed) return null;

      if (trimmed.startsWith('#') || trimmed.startsWith('//')) return null;



      // Full URL format (http/https/socks)

      if (/^[a-z]+:\/\//i.test(trimmed)) {

          try {

              const parsed = new URL(trimmed);

              const protocol = parsed.protocol.toLowerCase();

              if (protocol.startsWith('socks')) {

                  return { url: parsed.href, type: 'socks' };

              }

              if (protocol === 'http:' || protocol === 'https:') {

                  return { url: parsed.href, type: 'http' };

              }

          } catch (e) {

              return null;

          }

      }



      // user:pass@host:port

      if (trimmed.includes('@') && trimmed.includes(':')) {

          const [authPart, hostPart] = trimmed.split('@');

          const hostParts = hostPart.split(':');

          if (hostParts.length === 2) {

              const [host, port] = hostParts;

              const proxyUrl = `http://${authPart}@${host}:${port}`;

              return { url: proxyUrl, type: 'http' };

          }

      }



      const parts = trimmed.split(':');

      // host:port:user:pass

      if (parts.length === 4) {

          const [host, port, user, pass] = parts;

          const proxyUrl = `http://${user}:${pass}@${host}:${port}`;

          return { url: proxyUrl, type: 'http' };

      }

      // host:port

      if (parts.length === 2) {

          const [host, port] = parts;

          const proxyUrl = `http://${host}:${port}`;

          return { url: proxyUrl, type: 'http' };

      }

      return null;

  }



  function loadProxies() {

      try {

          const proxyData = fs.readFileSync('proxies.txt', 'utf8');

          const lines = proxyData.split(/\r?\n/).filter(line => line.trim() !== '');

          proxies = {}; // Clear existing proxies

          let skipped = 0;

          for (const line of lines) {

              const parsed = parseProxyLine(line);

              if (!parsed) {

                  skipped++;

                  continue;

              }

              proxies[parsed.url] = parsed.type;

          }

          const loaded = Object.keys(proxies).length;

          if (loaded === 0) {

              return `Warning: No valid proxies loaded (skipped ${skipped}).`;

          }

          const typeLabel = Object.values(proxies).includes('socks') ? 'HTTP/SOCKS' : 'HTTP';

          return `Successfully loaded ${loaded} ${typeLabel} proxies.`;

      } catch (e) {

          if (e.code === 'ENOENT') {

              return 'Warning: proxies.txt not found. Bots will run without proxies.';

          }

          return 'Error reading proxies.txt.';

      }

  }

  

  // --- NEW: Function to load random names from a file ---

  function loadNames() {

      if (botConfig.nameMode !== 'random') {

          return 'Name mode is not set to random.';

      }

      try {

          const nameData = fs.readFileSync(botConfig.nameFile, 'utf8');

          randomNames = nameData.split(/\r?\n/).filter(line => line.trim() !== '');

          if (randomNames.length === 0) {

              return `Warning: ${botConfig.nameFile} is empty. Using fixed name.`;

          }

          return `Successfully loaded ${randomNames.length} names from ${botConfig.nameFile}.`;

      } catch (e) {

          if (e.code === 'ENOENT') {

              return `Warning: ${botConfig.nameFile} not found. Using fixed name.`;

          }

          return `Error reading ${botConfig.nameFile}.`;

      }

  }



  // --- NEW: Function to load letter combinations from Tanks.txt ---

  function loadTankLetters() {

      try {

          const lettersData = fs.readFileSync('Tanks.txt', 'utf8');

          tankLetters = lettersData.split(/\r?\n/).filter(line => line.trim() !== '');

          if (tankLetters.length === 0) {

              return 'Warning: Tanks.txt is empty.';

          }

          return `Successfully loaded ${tankLetters.length} letter combinations from Tanks.txt.`;

      } catch (e) {

          if (e.code === 'ENOENT') {

              return 'Warning: Tanks.txt not found.';

          }

          return 'Error reading Tanks.txt.';

      }

  }



  function canPrompt() {

      return isInteractive && rl && !rlClosed;

  }



  function noteNonInteractive(message) {

      if (!nonInteractiveNotified) {

          console.log(message);

          nonInteractiveNotified = true;

      }

  }



  function readCgroupLimitBytes(path) {

      try {

          const raw = fs.readFileSync(path, 'utf8').trim();

          if (!raw || raw === 'max') {

              return null;

          }

          const value = BigInt(raw);

          if (value <= 0n) {

              return null;

          }

          const asNumber = Number(value);

          if (!Number.isFinite(asNumber) || asNumber <= 0) {

              return null;

          }

          return asNumber;

      } catch (e) {

          return null;

      }

  }



  function getMemoryLimitMb() {

      const total = os.totalmem();

      const cgroupV2 = readCgroupLimitBytes('/sys/fs/cgroup/memory.max');

      const cgroupV1 = readCgroupLimitBytes('/sys/fs/cgroup/memory/memory.limit_in_bytes');

      const limit = [cgroupV2, cgroupV1].filter(Boolean).reduce((min, val) => Math.min(min, val), total);

      const finalLimit = Math.min(total, limit || total);

      return Math.max(0, Math.floor(finalLimit / 1024 / 1024));

  }



  function applyBotCountLimit(requested) {

      if (!Number.isFinite(requested) || requested < 0) {

          return requested;

      }

      // Bot count limit disabled for unlimited capacity

      return requested;

  }



  function getAutoStartCount() {

      const envValue = process.env.BOT_COUNT;

      if (envValue !== undefined) {

          const parsed = parseInt(envValue, 10);

          if (!Number.isFinite(parsed) || parsed < 0) {

              return null;

          }

          return applyBotCountLimit(parsed);

      }



      const configValue = parseInt(botConfig.autoStartCount, 10);

      if (Number.isFinite(configValue) && configValue >= 0) {

          return applyBotCountLimit(configValue);

      }



      return 1;

  }





  function displayMenu() {

    if (!canPrompt()) {

      noteNonInteractive('Non-interactive mode detected. Menu disabled; set BOT_COUNT or autoStartCount to auto-start bots.');

      return;

    }

    console.clear();

    console.log('=========================================');

    console.log('        ARRAS.IO BOT PANEL');

    console.log('=========================================');

    console.log('\n--- CURRENT BOT CONFIGURATION ---');

    console.log(`Region: ${botConfig.region}`);

    console.log(`Feed Mode: ${botConfig.feedMode === 'on' ? 'On' : 'Off'}`);

    // --- MODIFIED: Display for new name and tank modes ---

    if (botConfig.nameMode === 'random') {

        console.log(`Name Mode: ${botConfig.nameMode} (${botConfig.nameFile})`);

    } else {

        console.log(`Name Mode: ${botConfig.nameMode} (${botConfig.name})`);

    }

    console.log(`Tank Mode: ${botConfig.tankMode}`);

    if (botConfig.tankMode === 'single') {

        console.log(`   - Tank: ${botConfig.tank}`);

    } else {

        console.log(`   - Configs: ${botConfig.multiTankConfig.length}`);

    }

    botConfig.multiTankConfig.forEach(c => {

        console.log(`     - ${c.count}x ${c.tank} (${c.keys.join(',') || 'None'})`);

    });

    console.log(`AutoFire: ${botConfig.autoFire ? 'On' : 'Off'}`);

    console.log(`Target Mode: ${botConfig.target}`);

    console.log(`Aim Mode: ${botConfig.aim}`);

    console.log(`Chat Spam: "${botConfig.chatSpam}"`);

    console.log(`Launch Delay: ${botConfig.launchDelay}ms`);

    console.log(`Auto-start Count: ${getAutoStartCount()}`);

    console.log(`Reconnect Attempts: ${botConfig.reconnectAttempts}`);

    console.log(`Reconnect Delay: ${botConfig.reconnectDelay}ms`);

    console.log(`Bots Running: ${workers.length}`);

    console.log(`Squad ID: ${botConfig.squadId}`); 

    console.log(`Bots Paused: ${paused}`);



    console.log('\n--- ACTIONS ---');

    console.log('[1] Start Bots');

    console.log('[2] Disconnect Bots');

    console.log(`[3] ${paused ? 'Resume' : 'Pause'} all`);

    console.log('[4] Exit');

    console.log('[5] Reload Proxies, Names & Tank Letters');

    console.log('[6] Change Bot Configuration');

    console.log('=========================================');

    rl.question('Select an option: ', handleMenuChoice);

  }



  function handleMenuChoice(choice) {

    switch (choice.trim()) {

      case '1':

        startBots();

        break;

      case '2':

        disconnectBots();

        break;

      case '3':

        togglePause();

        break;

      case '4':

        console.log('Exiting...');

        disconnectBots();

        rl.close();

        process.exit();

        break;

      case '5':

        console.log(`\n${loadProxies()}`);

        console.log(`${loadNames()}`);

        console.log(`${loadTankLetters()}`);

        setTimeout(displayMenu, 2000);

        break;

      case '6':

        showConfigMenu();

        break;

      default:

        console.log('\nInvalid option.');

        setTimeout(displayMenu, 1000);

        break;

    }

  }



  // --- MODIFIED: startBots now handles both single and multi tank modes ---

  function startBots() {

    if (botsStarted) {

        console.log('Start already in progress; ignoring duplicate start request.');

        return;

    }

    botsStarted = true;

    const launchQueue = [];

    const disableProxy = process.env.DISABLE_PROXY === '1';

    const proxyList = disableProxy ? [] : Object.keys(proxies);

    const hasProxies = proxyList.length > 0;

    let botIdCounter = workers.length;

    const envLaunchDelay = parseInt(process.env.LAUNCH_DELAY_MS, 10);

    const effectiveLaunchDelay = Number.isFinite(envLaunchDelay) && envLaunchDelay >= 0

        ? envLaunchDelay

        : botConfig.launchDelay;



    if (disableProxy && Object.keys(proxies).length > 0) {

        console.log('DISABLE_PROXY=1 set. Ignoring proxies.txt.');

    }



    // --- Build the queue of bots to launch based on config ---

    let shouldLaunch = false;

    const feedModeEnabled = botConfig.feedMode === 'on';

    

    if (botConfig.tankMode === 'multi') {

        if (botConfig.multiTankConfig.length === 0) {

            console.log('\nMulti-tank mode is enabled, but no configurations are set.');

            setTimeout(displayMenu, 2000);

            return;

        }

        botConfig.multiTankConfig.forEach(tankConf => {

            for (let i = 0; i < tankConf.count; i++) {

                launchQueue.push({

                    tank: tankConf.tank,

                    keys: tankConf.keys,

                    letterCombo: feedModeEnabled && tankLetters.length > 0 ? tankLetters[Math.floor(Math.random() * tankLetters.length)] : null

                });

            }

        });

        shouldLaunch = true;

    } else {

        if (!canPrompt()) {

            const autoCount = getAutoStartCount();

            if (autoCount === null) {

                console.log('\nInvalid BOT_COUNT. Set BOT_COUNT to a non-negative number.');

                botsStarted = false;

                return;

            }

            if (autoCount === 0) {

                console.log('\nBOT_COUNT=0, skipping auto-start.');

                botsStarted = false;

                return;

            }

            for (let i = 0; i < autoCount; i++) {

                launchQueue.push({

                    tank: botConfig.tank,

                    keys: botConfig.keys,

                    letterCombo: feedModeEnabled && tankLetters.length > 0 ? tankLetters[Math.floor(Math.random() * tankLetters.length)] : null

                });

            }

            shouldLaunch = true;

        } else {

            rl.question('Enter amount of bots to start: ', (amount) => {

                const numBots = parseInt(amount, 10);

                if (isNaN(numBots) || numBots <= 0) {

                    console.log('\nInvalid amount.');

                    setTimeout(displayMenu, 1000);

                    botsStarted = false;

                    return;

                }

                for (let i = 0; i < numBots; i++) {

                    launchQueue.push({

                        tank: botConfig.tank,

                        keys: botConfig.keys,

                        letterCombo: feedModeEnabled && tankLetters.length > 0 ? tankLetters[Math.floor(Math.random() * tankLetters.length)] : null

                    });

                }

                launchAll(launchQueue);

            });

            return; // Wait for user input

        }

    }

    

    if (shouldLaunch) {

        launchAll(launchQueue);

    }



    function launchAll(queue) {

        console.log(`\nStarting ${queue.length} bot(s) with a ${effectiveLaunchDelay}ms delay between each...`);

        const baseHash = getServerHash();

        if (!baseHash) {

            console.log('Error: missing server hash. Set bot_config.json "region" or ARRAS_HASH env var.');

            return;

        }

        const fallbackHash = baseHash;

        queue.forEach((botSpec, i) => {

            // Determine name for this bot

            let botName = botConfig.name;

            if (botConfig.nameMode === 'random' && randomNames.length > 0) {

                botName = randomNames[Math.floor(Math.random() * randomNames.length)];

            }



            const feedModeEnabled = botConfig.feedMode === 'on';

            // In Feed mode, use single tank stats for all bots instead of random selection

            const selectedTank = feedModeEnabled ? botSpec.tank : botSpec.tank;

            const selectedStats = [...botConfig.stats];

            const selectedTankPath = getPath(selectedTank, tree) || getPath(botSpec.tank, tree);



            const config = {

                id: botIdCounter + i,

                proxy: hasProxies ? { type: proxies[proxyList[i % proxyList.length]], url: proxyList[i % proxyList.length] } : false,

                hash: fallbackHash,

                name: botName,

                stats: selectedStats,

                type: 'follow',

                token: 'follow-8fe6ca',

                autoFire: botConfig.autoFire,

                autoRespawn: botConfig.autoRespawn,

                feedMode: botConfig.feedMode,

                target: feedModeEnabled ? 'mouse' : botConfig.target,

                aim: botConfig.aim,

                keys: [...botSpec.keys],

                tank: selectedTankPath,

                letterCombo: botSpec.letterCombo,

                chatSpam: botConfig.chatSpam,

                squadId: botConfig.squadId,

                reconnectAttempts: botConfig.reconnectAttempts,

                reconnectDelay: botConfig.reconnectDelay,

                loadFromCache: true,

                cache: false,

                arrasCache: './ah.txt',

                silent: true,

            };



            setTimeout(() => {

                const hashLabel = config.hash || '(pending)';

                const proxyLabel = config.proxy ? config.proxy.url : 'none';

                // console.log(`Launching bot #${config.id} (Tank: ${selectedTank}, Name: ${config.name}, Hash: ${hashLabel}, Proxy: ${proxyLabel})...`); // Silenced

                const worker = fork(__filename, [], { env: { ...process.env, IS_WORKER: 'true' } });

                worker.send({type: 'start', config: config});

                workers.push(worker);

            }, effectiveLaunchDelay * i); 

        });

        setTimeout(displayMenu, effectiveLaunchDelay * queue.length + 1000);

    }

  }



  function disconnectBots() {

    console.log(`\nDisconnecting ${workers.length} bot(s)...`);

    workers.forEach(worker => worker.kill());

    workers = [];

    paused = false;

    botsStarted = false;

    setTimeout(displayMenu, 1000);

  }



  function togglePause() {

      paused = !paused;

      console.log(`\nSending ${paused ? 'pause' : 'resume'} command to ${workers.length} bot(s)...`);

      workers.forEach(worker => worker.send({ type: 'pause', paused: paused }));

      setTimeout(displayMenu, 1000);

  }



  // --- MODIFIED: Config menu now includes sub-menus for new features ---

  function showConfigMenu() {

      console.clear();

      console.log('--- CHANGE BOT CONFIGURATION ---\n');

      console.log('[1] Squad ID (Region without numbers)');

      console.log('[2] Tank Configuration (Single/Multi)');

      console.log('[3] Bot Name Configuration (Fixed/Random)');

      console.log('[4] AutoFire');

      console.log('[5] Target Mode');

      console.log('[6] Aim Mode');

      console.log('[7] Chat Spam Message');

      console.log('[8] Stat Build (for all bots)');

      console.log('[9] Launch Delay');

      console.log('[10] Auto-start Count');

      console.log('[11] Reconnect Attempts');

      console.log('[12] Reconnect Delay');

      console.log('[13] Feed Mode');

      console.log('[14] Back to Main Menu');

      console.log('--------------------------------\n');

      rl.question('Select setting to change: ', (choice) => {

          handleConfigChange(choice.trim());

      });

  }



  // --- NEW: Function to parse multi-tank config string ---

  function parseMultiTankConfig(input) {

      const configs = [];

      const parts = input.toLowerCase().split('and');

      let success = true;



      for (const part of parts) {

          const trimmed = part.trim();

          if (!trimmed) continue;



          const elements = trimmed.split(/\s+/);

          const count = parseInt(elements[0], 10);

          

          if (isNaN(count) || elements.length < 2) {

              console.log(`Invalid format in segment: "${part}"`);

              success = false;

              continue;

          }



          let keys = [];

          let tankName = '';

          const lastElement = elements[elements.length - 1];

          

          // Check if the last element is a key string (e.g., u,k,u)

          if (/^[a-z](,[a-z])*$/.test(lastElement)) {

              keys = lastElement.toUpperCase().split(',');

              tankName = elements.slice(1, -1).join(' ');

          } else {

              tankName = elements.slice(1).join(' ');

          }

          

          // Capitalize the first letter of each word in the tank name for matching

          const formattedTankName = tankName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          

          if (tree[formattedTankName]) {

              configs.push({ count, tank: formattedTankName, keys });

          } else {

              console.log(`Invalid tank name: "${formattedTankName}"`);

              success = false;

          }

      }

      

      if (success && configs.length > 0) {

          botConfig.multiTankConfig = configs;

          return true;

      }

      return false;

  }

  

  // --- MODIFIED: handleConfigChange now manages the new configuration options ---

  function handleConfigChange(choice) {

      const back = (msg) => {

          if (msg) console.log(msg);

          setTimeout(showConfigMenu, 1500);

      };

      const saveAndBack = () => {

          const msg = saveConfig();

          console.log('Configuration updated. ' + msg);

          setTimeout(showConfigMenu, 1500);

      };



      switch(choice) {

          case '1':

            rl.question(`Enter new Squad ID (current: ${botConfig.squadId}): `, (val) => { botConfig.squadId = val || botConfig.squadId; saveAndBack(); });

            break;

          case '2': // Tank Configuration

              rl.question('Select Tank Mode (single/multi): ', (mode) => {

                  if (mode === 'single') {

                      botConfig.tankMode = 'single';

                      console.log('Available tanks:', Object.keys(tree).join(', '));

                      rl.question(`Enter tank name (current: ${botConfig.tank}): `, (tank) => {

                          if (tree[tank]) botConfig.tank = tank;

                          rl.question(`Enter extra keys, comma-separated (current: ${botConfig.keys.join(',')}): `, (keys) => {

                              botConfig.keys = keys.split(',').map(k => k.trim().toUpperCase()).filter(Boolean);

                              saveAndBack();

                          });

                      });

                  } else if (mode === 'multi') {

                      botConfig.tankMode = 'multi';

                      console.log('Enter multi-tank configuration.');

                      console.log('Example: 2 Twin U,K,U and 1 Director U,U,U and 1 Twin U (The "and" keyword is important to separate the type of tanks)');

                      rl.question('Config string: ', (str) => {

                          if (parseMultiTankConfig(str)) {

                              saveAndBack();

                          } else {

                              back('Failed to parse multi-tank config. No changes made.');

                          }

                      });

                  } else {

                      back('Invalid mode.');

                  }

              });

              break;

          case '3': // Name Configuration

              rl.question('Select Name Mode (fixed/random): ', (mode) => {

                  if (mode === 'fixed') {

                      botConfig.nameMode = 'fixed';

                      rl.question(`Enter bot name (current: ${botConfig.name}): `, (val) => { botConfig.name = val || botConfig.name; saveAndBack(); });

                  } else if (mode === 'random') {

                      botConfig.nameMode = 'random';

                      rl.question(`Enter name file (current: ${botConfig.nameFile}): `, (val) => {

                          botConfig.nameFile = val || botConfig.nameFile;

                          console.log(loadNames());

                          saveAndBack();

                      });

                  } else {

                      back('Invalid mode.');

                  }

              });

              break;

          case '4':

              rl.question('Set AutoFire? (on/off): ', (val) => { botConfig.autoFire = val.toLowerCase() === 'on'; saveAndBack(); });

              break;

          case '5':

              rl.question('Set Target Mode (player/mouse): ', (val) => { if (['player', 'mouse'].includes(val)) { botConfig.target = val; saveAndBack(); } else { back('Invalid mode.'); } });

              break;

          case '6':

              rl.question('Set Aim Mode (drone/movement): ', (val) => { if (['drone', 'movement'].includes(val)) { botConfig.aim = val; saveAndBack(); } else { back('Invalid mode.'); } });

              break;

          case '7':

              rl.question('Enter new chat spam message: ', (val) => { botConfig.chatSpam = val; saveAndBack(); });

              break;

          case '8': // Changed from Extra Keys to Stats

              console.log('Enter 10 stat points, comma-separated (e.g., 2,2,2,6,6,8,8,8,0,0)');

              rl.question(`Set new stat build (current: ${botConfig.stats.join(',')}): `, (val) => {

                  const stats = val.split(',').map(s => parseInt(s.trim(), 10));

                  if (stats.length === 10 && stats.every(s => !isNaN(s) && s >= 0)) {

                      botConfig.stats = stats;

                      saveAndBack();

                  } else {

                      back('Invalid stat build. Must be 10 numbers.');

                  }

              });

              break;

          case '9':

              rl.question(`Enter new launch delay (current: ${botConfig.launchDelay}ms): `, (val) => {

                  const delay = parseInt(val, 10);

                  if (!isNaN(delay) && delay >= 0) { botConfig.launchDelay = delay; saveAndBack(); } else { back('Invalid number.'); }

              });

              break;

          case '10':

              rl.question(`Enter auto-start count (current: ${botConfig.autoStartCount}, 0 to disable): `, (val) => {

                  const count = parseInt(val, 10);

                  if (!isNaN(count) && count >= 0) { botConfig.autoStartCount = count; saveAndBack(); } else { back('Invalid number.'); }

              });

              break;

          case '11':

              rl.question(`Enter max reconnect attempts (current: ${botConfig.reconnectAttempts}): `, (val) => {

                  const attempts = parseInt(val, 10);

                  if (!isNaN(attempts) && attempts >= 0) { botConfig.reconnectAttempts = attempts; saveAndBack(); } else { back('Invalid number.'); }

              });

              break;

          case '12':

              rl.question(`Enter reconnect delay (current: ${botConfig.reconnectDelay}ms): `, (val) => {

                  const delay = parseInt(val, 10);

                  if (!isNaN(delay) && delay >= 0) { botConfig.reconnectDelay = delay; saveAndBack(); } else { back('Invalid number.'); }

              });

              break;

          case '13':

              rl.question(`Set Feed Mode (on/off, current: ${botConfig.feedMode}): `, (val) => {

                  const nextValue = val.trim() ? parseOnOffMode(val) : botConfig.feedMode;

                  if (nextValue) {

                      botConfig.feedMode = nextValue;

                      saveAndBack();

                  } else {

                      back('Invalid mode.');

                  }

              });

              break;

          case '14':

              displayMenu();

              break;

          default:

              back('Invalid choice.');

      }

  }



  // Initial Load

  console.log(loadConfig());

  console.log(loadProxies());

  console.log(loadNames()); // --- NEW: Load names on startup ---

  console.log(loadTankLetters()); // --- NEW: Load tank letters on startup ---

  if (canPrompt()) {

    setTimeout(displayMenu, 1000);

  } else {

    noteNonInteractive('Non-interactive mode detected. Auto-starting bots; set BOT_COUNT or autoStartCount to control count.');

    setTimeout(startBots, 1000);

  }



} else {

  // --- WORKER PROCESS (Unchanged logic, with added message handling) ---

  // THIS ENTIRE SECTION REMAINS THE SAME AS THE ORIGINAL SCRIPT

  let isPaused = false;

  let currentBotInterface = {}; // To hold bot state

  

  // Memory management configuration

  const MEMORY_LIMIT_MB = 32768; // 32GB for Tanks.txt processing

  const MEMORY_WARNING_THRESHOLD_MB = 31768;

  const MEMORY_CRITICAL_THRESHOLD_MB = 32768;

  const MEMORY_CHECK_INTERVAL_MS = 15000;

  const MEMORY_HISTORY_SIZE = 5;

  

  let memoryCheckInterval = null;

  let restartCount = 0;

  const MAX_RESTARTS = 3;

  

  // Memory tracking for leak detection

  let memoryHistory = [];

  let lastGCTime = 0;

  let memoryGrowthRate = 0;

  let consecutiveHighMemory = 0;



  // Object pooling for frequently created objects

  const objectPool = {

    arrays: [],

    buffers: [],

    objects: [],

    

    getArray: (size = 10) => {

      if (objectPool.arrays.length > 0) {

        const arr = objectPool.arrays.pop();

        arr.length = 0;

        return arr;

      }

      return new Array(size);

    },

    

    returnArray: (arr) => {

      if (arr && objectPool.arrays.length < 50) {

        arr.length = 0;

        objectPool.arrays.push(arr);

      }

    },

    

    getBuffer: (size = 1024) => {

      if (objectPool.buffers.length > 0) {

        const buf = objectPool.buffers.pop();

        if (buf.length >= size) {

          return buf;

        }

      }

      return Buffer.allocUnsafe(size);

    },

    

    returnBuffer: (buf) => {

      if (buf && objectPool.buffers.length < 20) {

        objectPool.buffers.push(buf);

      }

    },

    

    getObject: () => {

      if (objectPool.objects.length > 0) {

        const obj = objectPool.objects.pop();

        // Clear object properties

        for (const key in obj) {

          delete obj[key];

        }

        return obj;

      }

      return {};

    },

    

    returnObject: (obj) => {

      if (obj && typeof obj === 'object' && objectPool.objects.length < 30) {

        objectPool.objects.push(obj);

      }

    }

  };



  // Memory management functions

  const getMemoryUsage = () => {

    try {

      const usage = process.memoryUsage();

      return usage.heapUsed / 1024 / 1024; // Return MB

    } catch (e) {

      return 0;

    }

  };



  const updateMemoryHistory = (memoryMB) => {

    memoryHistory.push(memoryMB);

    if (memoryHistory.length > MEMORY_HISTORY_SIZE) {

      memoryHistory.shift();

    }

    

    // Calculate memory growth rate

    if (memoryHistory.length >= 3) {

      const recent = memoryHistory.slice(-3);

      memoryGrowthRate = (recent[2] - recent[0]) / 2; // MB per check interval

    }

  };



  const detectMemoryLeak = (memoryMB) => {

    if (memoryHistory.length < MEMORY_HISTORY_SIZE) return false;

    

    // Check for consistent growth pattern

    const avgGrowth = memoryGrowthRate;

    const isConsistentlyGrowing = avgGrowth > 0.5; // Growing more than 0.5MB per interval

    

    // Check if memory never decreases (potential leak)

    const neverDecreases = memoryHistory.every((val, idx) => 

      idx === 0 || val >= memoryHistory[idx - 1] - 0.1 // Allow small fluctuations

    );

    

    return isConsistentlyGrowing || neverDecreases;

  };



  const performAggressiveGC = () => {

    try {

      const now = Date.now();

      // Prevent GC spam (minimum 5 seconds between GC calls)

      if (now - lastGCTime < 5000) return;

      

      if (global.gc) {

        global.gc();

        

        // Force cleanup of event listeners and intervals

        if (global.gc) {

          setTimeout(() => global.gc(), 100);

        }

        

        lastGCTime = now;

      }

    } catch (e) {

      // Silent error handling

    }

  };



  const performGradualCleanup = () => {

    try {

      // Clear any cached data that might be holding memory

      if (typeof clearTimeout === 'function') {

        // Clear any pending timeouts that might be holding references

        const originalTimeout = global.setTimeout;

        global.setTimeout = function(...args) {

          const timeoutId = originalTimeout.apply(this, args);

          return timeoutId;

        };

      }

      

      // Perform light GC

      if (global.gc) {

        global.gc();

      }

    } catch (e) {

      // Silent error handling

    }

  };



  const checkMemoryAndRestart = () => {

    try {

      const memoryMB = getMemoryUsage();

      updateMemoryHistory(memoryMB);

      

      // Memory pressure warnings and gradual cleanup

      if (memoryMB > MEMORY_WARNING_THRESHOLD_MB) {

        consecutiveHighMemory++;

        

        // Perform gradual cleanup at warning level

        if (consecutiveHighMemory >= 2) {

          performGradualCleanup();

        }

      } else {

        consecutiveHighMemory = 0;

      }

      

      // Critical memory handling

      if (memoryMB > MEMORY_CRITICAL_THRESHOLD_MB) {

        performAggressiveGC();

        

        const memoryAfterGC = getMemoryUsage();

        

        if (memoryAfterGC > MEMORY_CRITICAL_THRESHOLD_MB) {

          // Check for memory leak before restart

          if (detectMemoryLeak(memoryAfterGC)) {

            // Memory leak detected - force restart

            if (restartCount < MAX_RESTARTS) {

              restartCount++;

              process.exit(0);

            } else {

              process.exit(1);

            }

          } else if (memoryAfterGC > MEMORY_LIMIT_MB) {

            // Memory still exceeds hard limit - restart

            if (restartCount < MAX_RESTARTS) {

              restartCount++;

              process.exit(0);

            } else {

              process.exit(1);

            }

          }

        }

      }

    } catch (e) {

      // Silent error handling for memory checks

    }

  };



  const startMemoryMonitoring = () => {

    if (memoryCheckInterval) {

      clearInterval(memoryCheckInterval);

    }

    memoryCheckInterval = setInterval(checkMemoryAndRestart, MEMORY_CHECK_INTERVAL_MS);

  };



  const stopMemoryMonitoring = () => {

    if (memoryCheckInterval) {

      clearInterval(memoryCheckInterval);

      memoryCheckInterval = null;

    }

    

    // Clear object pools to free memory

    objectPool.arrays.length = 0;

    objectPool.buffers.length = 0;

    objectPool.objects.length = 0;

    

    // Clear memory history

    memoryHistory.length = 0;

  };



  // Memory statistics for monitoring

  const getMemoryStats = () => {

    try {

      const usage = process.memoryUsage();

      return {

        heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,

        heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,

        external: Math.round(usage.external / 1024 / 1024 * 100) / 100,

        rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100,

        growthRate: Math.round(memoryGrowthRate * 100) / 100,

        history: [...memoryHistory],

        consecutiveHighMemory: consecutiveHighMemory,

        restartCount: restartCount

      };

    } catch (e) {

      return null;

    }

  };



  // Enhanced cleanup for intervals and event listeners

  const cleanupResources = () => {

    try {

      // Clear all timeouts

      if (typeof clearTimeout !== 'undefined') {

        // Store original timeout IDs if needed for cleanup

        const maxTimeoutId = setTimeout(() => {}, 0);

        for (let i = 1; i <= maxTimeoutId; i++) {

          clearTimeout(i);

        }

      }

      

      // Clear all intervals

      if (typeof clearInterval !== 'undefined') {

        const maxIntervalId = setInterval(() => {}, 0);

        for (let i = 1; i <= maxIntervalId; i++) {

          clearInterval(i);

        }

      }

      

      // Perform aggressive cleanup

      performAggressiveGC();

    } catch (e) {

      // Silent error handling

    }

  };



  process.on('message', (message) => {

      if (message.type === 'start') {

          const config = message.config;

          options.token = config.token;

          options.loadFromCache = config.loadFromCache;

          options.cache = config.cache;

          options.arrasCache = config.arrasCache;

          

          arras.then(function() {

            currentBotInterface = arras.create(config);

            // Start memory monitoring after bot is created

            startMemoryMonitoring();

          });

      } else if (message.type === 'pause') {

          isPaused = message.paused;

          if (currentBotInterface.log) { // Check if bot is initialized

              currentBotInterface.log(`Bot state is now: ${isPaused ? 'PAUSED' : 'RESUMED'}`);

          }

      }

  });



  // Cleanup on process exit

  process.on('exit', () => {

    stopMemoryMonitoring();

  });



  process.on('SIGINT', () => {

    stopMemoryMonitoring();

    process.exit(0);

  });



  process.on('SIGTERM', () => {

    stopMemoryMonitoring();

    process.exit(0);

  });



  const options = { start: () => {} }; // Start is now handled by message handler



  const tree = {

    'Twin': ['Y', 'Basic'], 'Double Twin': ['Y', 'Twin'], 'Triple Shot': ['U', 'Twin'], 'Sniper': ['U', 'Basic'], 'Machine Gun': ['I', 'Basic'], 'Flank Guard': ['H', 'Basic'], 'Hexa Tank': ['Y', 'Flank Guard'], 'Octo Tank': ['Y', 'Hexa Tank'], 'Cyclone': ['U', 'Hexa Tank'], 'Hexa-Trapper': ['I', 'Hexa Tank'], 'Tri-Angle': ['U', 'Flank Guard'], 'Fighter': ['Y', 'Tri-Angle'], 'Booster': ['U', 'Tri-Angle'], 'Falcon': ['I', 'Tri-Angle'], 'Bomber': ['H', 'Tri-Angle'], 'Auto-Tri-Angle': ['J', 'Tri-Angle'], 'Surfer': ['K', 'Tri-Angle'], 'Auto-3': ['I', 'Tri-Angle'], 'Auto-5': ['Y', 'Auto-3'], 'Mega-3': ['U', 'Auto-3'], 'Auto-4': ['I', 'Auto-3'], 'Banshee': ['H', 'Auto-3'], 'Trap Guard': ['H', 'Flank Guard'], 'Buchwhacker': ['Y', 'Trap Guard'], 'Gunner Trapper': ['U', 'Trap Guard'], 'Bomber': ['I', 'Trap Guard'], 'Conqueror': ['J', 'Trap Guard'], 'Bulwark': ['K', 'Trap Guard'], 'Tri-Trapper': ['J', 'Flank Guard'], 'Fortress': ['Y', 'Tri-Trapper'], 'Hexa-Trapper': ['U', 'Tri-Trapper'], 'Septa-Trapper': ['I', 'Tri-Trapper'], 'Architect': ['H', 'Tri-Trapper'], 'Triple-Twin': ['K', 'Flank Guard'], 'Director': ['J', 'Basic'], 'Pounder': ['K', 'Basic']

  };

  const workerTankNames = Object.keys(tree);

  const getPath = function(name) {

    let p = '', o = tree[name]

    while(o) {

      p = o[0] + p

      let n = o[1]

      if(n === 'Basic') { break }

      o = tree[n]

    }

    return p

  };

  const getRandomTreeTank = function() {

    let tankName = workerTankNames[Math.floor(Math.random() * workerTankNames.length)]

    return {

      name: tankName,

      path: getPath(tankName)

    }

  };



  WebAssembly.instantiateStreaming = false

  const arras = (function() {

    const log = function() {

      // Check if we're in a worker process and silent mode is enabled

      if (process.env.IS_WORKER === 'true') {

        return; // Suppress all worker log messages

      }

      global.console.log(`[headless]`, ...arguments)

    }

    const resetTarget = function() {

      if (!currentBotInterface.target) {

        return;

      }

      currentBotInterface.target[0] = 0;

      currentBotInterface.target[1] = 0;

      currentBotInterface.target[2] = 0;

      currentBotInterface.target[3] = 0;

      currentBotInterface.target[4] = false;

      currentBotInterface.target[5] = null;

      currentBotInterface.target[6] = null;

      currentBotInterface.target[7] = null;

      currentBotInterface.target[8] = null;

      currentBotInterface.target[9] = null;

      currentBotInterface.target[10] = null;

      currentBotInterface.target[11] = null;

    }

    const leaderPort = parseInt(process.env.LEADER_PORT || process.env.PORT, 10) || 8080

    const leaderHost = process.env.LEADER_HOST || '127.0.0.1'

    const wu = process.env.LEADER_WS || `ws://${leaderHost}:${leaderPort}`

    let lastRecieve = 0

    let connect = function() {

      log(`Connecting to leader/follower server at ${wu}...`)

      const headers = {

        'user-agent': 'Mozilla/5.0 (X11; CrOS x86_64 14588.123.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Safari/537.36',

        'accept-encoding': 'gzip, deflate, br',

        'accept-language': 'en-US,en;q=0.9',

        'cache-control': 'no-cache',

        'connection': 'Upgrade',

        'origin': 'https://arras.io',

        'pragma': 'no-cache',

        'upgrade': 'websocket'

      }

      socket = new ws(wu, {

        headers,

        followRedirects: true,

        origin: 'https://arras.io',

        localAddress: 0

      })

      socket.binaryType = 'arraybuffer'

      socket.addEventListener('open', function() {

        log('Connected to leader/follower server. Waiting for server name to subscribe.')

      })

      socket.addEventListener('message', function(e) {

        try {

          if (!currentBotInterface.target) return;



          let data = unpack(new Uint8Array(e.data));

          if(!data || !Array.isArray(data)) { return }



          const type = data.splice(0, 1)[0];

          switch(type) {

            case 101: { 

              if (data.length >= 5) {

                  if (data[0] == null || data[1] == null) {

                      currentBotInterface.target[0] = 0;

                      currentBotInterface.target[1] = 0;

                      currentBotInterface.target[2] = 0;

                      currentBotInterface.target[3] = 0;

                      currentBotInterface.target[4] = false;

                      currentBotInterface.target[5] = null;

                      currentBotInterface.target[6] = null;

                      currentBotInterface.target[7] = null;

                      currentBotInterface.target[8] = null;

                      currentBotInterface.target[9] = null;

                      currentBotInterface.target[10] = null;

                      currentBotInterface.target[11] = null;

                      currentBotInterface.setActive(0);

                      break;

                  }

                  currentBotInterface.target[0] = data[0] / 10;

                  currentBotInterface.target[1] = data[1] / 10;

                  currentBotInterface.target[2] = data[2] / 10;

                  currentBotInterface.target[3] = data[3] / 10;

                  currentBotInterface.target[4] = data[4];

                  currentBotInterface.target[5] = typeof data[5] === 'number' ? data[5] : null;

                  currentBotInterface.target[6] = typeof data[6] === 'number' ? data[6] : null;

                  currentBotInterface.target[7] = typeof data[7] === 'number' ? data[7] : null;

                  currentBotInterface.target[8] = typeof data[8] === 'number' ? data[8] : null;

                  currentBotInterface.target[9] = typeof data[9] === 'number' ? data[9] : null;

                  currentBotInterface.target[10] = typeof data[10] === 'number' ? data[10] / 10 : null;

                  currentBotInterface.target[11] = typeof data[11] === 'number' ? data[11] / 10 : null;

                  currentBotInterface.setActive(15);

                  lastRecieve = Date.now();

              }

              break;

            }

            case 102: { 

                log(`Leader ${data[0]} is now inactive.`);

                resetTarget();

                currentBotInterface.setActive(0);

                currentBotInterface.setSubscribed(false);

                break;

            }

            case 103: { 

                log(`Error from server: ${data[0]}`);

                resetTarget();

                currentBotInterface.setActive(0);

                currentBotInterface.setSubscribed(false);

                break;

            }

          }

        } catch(e) { log('Error processing message from server:', e); }

      })

      socket.addEventListener('close', function() {

        log('Disconnected from leader/follower server.')

        socket = false

        subscribedToLeader = false;

        setTimeout(connect, 3000)

      })

    }, socket = false, send = function(p) {

      if(socket && socket.readyState === 1) {

        socket.send(pack(p))

      }

    }, subscribedToLeader = false;

    connect();



    let app = false

    const wasm = function() {

      return {

        arrayBuffer: function() {

          return app

        }

      }

    }

    const fetchWithRetry = function(url, options, attempts = 3, baseDelayMs = 1500) {

      let attempt = 0

      const run = () => {

        return realFetch(url, options).catch(err => {

          attempt += 1

          if (attempt >= attempts) {

            throw err

          }

          const waitMs = baseDelayMs * Math.pow(2, attempt - 1)

          return new Promise(resolve => setTimeout(resolve, waitMs)).then(run)

        })

      }

      return run()

    }

    let lastStatus = 0, statusData = ''

    let lastStatusFetchLog = 0

    const logStatusFetchError = function(err) {

      const now = Date.now()

      if (now - lastStatusFetchLog < 30000) { return }

      lastStatusFetchLog = now

      log('Status fetch failed:', err && err.message ? err.message : err)

    }

    const getStatus = function(f, s) {

      let now = global.performance.now()

      if(statusData && now - lastStatus < 15000) {

        return {

          then: function() {

            return {

              then: function(f) {

                let i = JSON.parse(statusData)

                s(i)

                f(i)

              }

            }

          }

        }

      }

      let then = function() {}

      realFetch(f).then(x => x.text()).then(x => {

        statusData = x

        let i = JSON.parse(x)

        s(i)

        then(i)

      }).catch(err => {

        logStatusFetchError(err)

        const fallback = { ok: false, status: {} }

        try { s(fallback) } catch(e) {}

        try { then(fallback) } catch(e) {}

      })

      return {

        then: function() {

          return {

            then: function(f) {

              then = f

            }

          }

        }

      }

    }

    

    let ready = false, script = false, o = [], then = function(f) {

      if (ready) {

        f();

      } else {

        o.push(f);

      }

    };



    const initializeAndRunQueue = function() {

        ready = true;

        log('Headless arras ready.');

        for (let i = 0, l = o.length; i < l; i++) {

            o[i]();

        }

        o = [];

        then = function(f) {

            f();

        };

    }



    let prerequisites = 0;

    const onPrerequisiteLoaded = function() {

        prerequisites++;

        if (prerequisites === 2) {

            initializeAndRunQueue();

        }

    }



    fetchWithRetry('https://arras.io/app.wasm', undefined, 3, 1500).then(x => {

      return x.arrayBuffer().then(x => {

        app = x;

        log('Prerequisite 1/2: app.wasm loaded.');

        onPrerequisiteLoaded();

      })

    }).catch(err => {

      log('FATAL: Could not fetch app.wasm from arras.io.', err);

    });



    const loadScript = function() {

        const activateBot = (scriptContent) => {

            script = scriptContent;

            log('Prerequisite 2/2: Game script loaded.');

            onPrerequisiteLoaded();

        };



        const extractScriptFromHtml = (html) => {

            const scriptTagStart = html.indexOf('<script>');

            if (scriptTagStart === -1) {

                log('Error: Could not find <script> tag in content.');

                return null;

            }

            let scriptContent = html.slice(scriptTagStart + 8);

            const scriptTagEnd = scriptContent.indexOf('</script');

            if (scriptTagEnd === -1) {

                log('Error: Could not find closing </script> tag.');

                return null;

            }

            scriptContent = scriptContent.slice(0, scriptTagEnd);

            return scriptContent;

        };



        log('Fetching from https://arras.io to ensure correct script execution order...');

        fetchWithRetry('https://arras.io', undefined, 3, 1500).then(x => x.text()).then(html => {

            // console.log('Response received.'); // Silenced

            const extractedScript = extractScriptFromHtml(html);

            if (extractedScript) {

                activateBot(extractedScript);

            }

        }).catch(err => {

            log('FATAL: Could not fetch from arras.io. Please check network or use a valid cache file.', err);

        });

    }

    loadScript();



const run = function(x, config, oa) {

      const log = function() {

        if (config.silent) {

          return; // Suppress all messages when config.silent is true

        }

        global.console.log(`[headless ${config.id}]`, ...arguments)

      }



      const eventLog = [];



      let target = [0, 0, 0, 0, false, null, null, null, null, null, null, null],

          active = 0,

          subscribedToLeader = false;

      let lastSubscribeAttempt = 0;

      const SUBSCRIBE_INTERVAL_MS = 2000;

      const followTimeoutMs = parseInt(process.env.FOLLOW_TIMEOUT_MS || '1500', 10);

      const perBotMb = parseInt(process.env.BOT_EST_MB || '60', 10);



      const internalBotInterface = {

        target: target,

        setActive: (val) => { active = val; },

        setSubscribed: (val) => { subscribedToLeader = val; },

        log: log

      };





      let destroy = function() {

        if(destroyed) { return }

        log('Destroying instance...')

        if(gameSocket && gameSocket.readyState < 3) {

          gameSocket.close()

          gameSocket = false

        }

        clearInterval(mainInterval)

        stopMemoryMonitoring() // Stop memory monitoring on destroy

        destroyed = true

      }, destroyed = false

      const setInterval = new Proxy(global.setInterval, { apply:function(a, b, c) {

        if(destroyed) { return }

        return Reflect.apply(a, b, c)

      } }), setTimeout = new Proxy(global.setTimeout, { apply:function(a, b, c) {

        if(destroyed) { return }

        return Reflect.apply(a, b, c)

      } })

      const h = function(o) {

        return new Proxy(o, { get:function(a, b, c) {

          let d = Reflect.get(a, b, c)

          return d

        }, set:function(a, b, c) {

          return Reflect.set(a, b, c)

        } })

      }

      const handleListener = function(type, f, target) {

        listeners[type] = f

      }

      const listeners = {}

      const trigger = {

        mousemove: function(clientX, clientY) {

          if(listeners.mousemove) {

            listeners.mousemove({

              isTrusted: true,

              clientX: clientX,

              clientY: clientY

            })

          }

        },

        mousedown: function(clientX, clientY, button) {

          if(listeners.mousedown) {

            listeners.mousedown({

              isTrusted: true,

              clientX: clientX,

              clientY: clientY,

              button: button

            })

          }

        },

        mouseup: function(clientX, clientY, button) {

          if(listeners.mouseup) {

            listeners.mouseup({

              isTrusted: true,

              clientX: clientX,

              clientY: clientY,

              button: button

            })

          }

        },

        keydown: function(code, repeat) {

          if(listeners.keydown) {

            listeners.keydown({

              isTrusted: true,

              code: code,

              key: '',

              repeat: repeat || false,

              preventDefault: function() {}

            })

          }

        },

        keyup: function(code, repeat) {

          if(listeners.keyup) {

            listeners.keyup({

              isTrusted: true,

              code: code,

              key: '',

              repeat: repeat || false,

              preventDefault: function() {}

            })

          }

        }

      }



      global.window = global.parent = global.top = {

          WebAssembly,

          googletag: {

              cmd: {

                  push: function(f) { try { f(); } catch(e) {} }

              },

              defineSlot: function() { return this; },

              addService: function() { return this; },

              display: function() { return this; },

              pubads: function() { return this; },

              enableSingleRequest: function() { return this; },

              collapseEmptyDivs: function() { return this; },

              enableServices: function() { return this; }

          },

          arrasAdDone: true

      };



      global.crypto = global.window.crypto = {

        getRandomValues: function(a) { return a }

      };

      global.addEventListener = global.window.addEventListener =  function(type, f) {

        handleListener(type, f, global.window)

      };

      global.removeEventListener = global.window.removeEventListener = function(type, f) {

      };

      global.Image = global.window.Image = function() {

        return {}

      };



      let inputs = [], setValue = function(str) {

        for(let i=0,l=inputs.length;i<l;i++) {

          inputs[i].value = str

        }

      }

      let position = [0, 0, 5], died = false, ignore = false, disconnected = false, connected = false, inGame = false, upgrade = false, reconnectCount = 0;

      

      let innerWidth = global.window.innerWidth = 500

      let innerHeight = global.window.innerHeight = 500

      

      let st = 2, lx = 0, gd = 1, canvasRef = {}, sr = 1, s = 1;



      const g = function() {

        let w = innerWidth;

        let h = innerHeight;

        if (!canvasRef.width) canvasRef.width = w;

        if (w * 0.5625 > h) {

            s = 888.888888888 / w;

        } else {

            s = 500 / h;

        }

        sr = canvasRef.width / w;

      };

      g();



      global.document = global.window.document = (function() {

        const emptyFunc = () => {};

        const emptyStyle = { setProperty: emptyFunc };

        

        const simulatedContext2D = {

          isContextLost: () => false,

          fillText: function() {

            // Rendering disabled for memory savings

            if(ignore) { return }

          },

          measureText: (text) => ({ width: text.length }),

          clearRect: emptyFunc, strokeRect: emptyFunc, fillRect: emptyFunc,

          save: emptyFunc, translate: emptyFunc, clip: emptyFunc, restore: emptyFunc,

          beginPath: emptyFunc, 

          moveTo: function() {

            canvasRef = this.canvas;

            if (st > 0) {

              st--;

              if (st === 1) {

                lx = arguments[0];

              } else {

                const diff = arguments[0] - lx;

                if (diff !== 0) {

                  gd = sr / diff;

                }

              }

            }

          },

          lineTo: function() {

            canvasRef = this.canvas;

            if (st > 0) {

              st--;

              if (st === 1) {

                lx = arguments[0];

              } else {

                const diff = arguments[0] - lx;

                if (diff !== 0) {

                  gd = sr / diff;

                }

              }

            }


          arc: emptyFunc, ellipse: emptyFunc, roundRect: emptyFunc, closePath: emptyFunc

          fill: emptyFunc, stroke: emptyFunc, strokeText: emptyFunc, drawImage: emptyFunc,
        };


        const createElement = function(tag, options) {
          const element = {

            tag: tag ? tag.toLowerCase() : '',

            appended: false,

            value: '',

            style: emptyStyle,

            addEventListener: (type, f) => handleListener(type, f, element),

            setAttribute: emptyFunc,

            appendChild: (e) => { e.appended = true },

            focus: emptyFunc,

            blur: emptyFunc,

            remove: emptyFunc,

            getBoundingClientRect: () => ({

              width: innerWidth, height: innerHeight, top: 0, left: 0, bottom: innerHeight, right: innerWidth,

            }),

          };



          if (element.tag === 'canvas') {

            element.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAADElEQVQImWNgoBMAAABpAAFEI8ARAAAAAElFTkSuQmCC';

            element.toBlob = (callback, type = 'image/png', quality) => {

                try {

                    // Create a simple PNG data for headless mode

                    const canvasData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAADElEQVQImWNgoBMAAABpAAFEI8ARAAAAAElFTkSuQmCC';

                    // Convert base64 to binary data

                    const base64Data = canvasData.replace(/^data:image\/png;base64,/, '');

                    const binaryData = Buffer.from(base64Data, 'base64');

                    

                    // Create a proper Blob instance

                    const blob = new Blob([binaryData], { type: type });

                    

                    // Call the callback asynchronously to match browser behavior

                    setTimeout(() => callback(blob), 0);

                } catch (e) {

                    // Fallback if Blob creation fails

                    setTimeout(() => callback(null), 0);

                }

            };

            element.getContext = (type) => {

                if (type === '2d') {

                    simulatedContext2D.canvas = element;

                    return simulatedContext2D;

                }

                return null;

            };

          }



          if (element.tag === 'input') {

            inputs.push(element);

          }

          

          if (options) {

            Object.assign(element, options);

          }



          return element;

        };



        const doc = createElement('document', {

          createElement: createElement,

          body: null,

          fonts: { load: () => true },

          referrer: '',

        });

        doc.body = createElement('body');

        

        return doc;

      })();



      const locationHash = config.hash || '';

      global.location = global.window.location = {

        hostname: 'arras.io',

        host: 'arras.io',

        protocol: 'https:',

        origin: 'https://arras.io',

        pathname: '/',

        search: '',

        href: `https://arras.io/${locationHash}`,

        hash: locationHash,

        query: ''

      }

      let lastHash = global.location.hash

      global.prompt = global.window.prompt = function() {

        console.log('prompt', ...arguments)

      }

      let devicePixelRatio = global.window.devicePixelRatio = 1

      let a = false

      global.requestAnimationFrame = global.window.requestAnimationFrame = function(f) {

        st = 2;

        g();

        a = f

      }

      global.performance = {

        time: 0,

        now: function() {

          return this.time

        },

        markResourceTiming: nativePerformance && typeof nativePerformance.markResourceTiming === 'function'

          ? (...args) => nativePerformance.markResourceTiming(...args)

          : () => {},

        getEntriesByType: nativePerformance && typeof nativePerformance.getEntriesByType === 'function'

          ? (...args) => nativePerformance.getEntriesByType(...args)

          : () => [],

        timeOrigin: nativePerformance && typeof nativePerformance.timeOrigin === 'number'

          ? nativePerformance.timeOrigin

          : 0

      }

      const console = {

        log: new Proxy(global.console.log, { apply:function(a, b, c) {

          if(c[0] === '%cStop!' || (c[0] && c[0].startsWith && c[0].startsWith('%cHackers have been known'))) { return }

          return Reflect.apply(a, b, c)

        } })

      }



      let proxyAgent = null;

      if (config.proxy) {

          const proxyOptions = {

              timeout: 30000, // 30 second timeout

              keepAlive: true,

              keepAliveMsecs: 1000,

              maxSockets: 5,

              maxFreeSockets: 2

          };

          

          if (config.proxy.type === 'socks') {

              proxyAgent = new SocksProxyAgent(config.proxy.url, proxyOptions);

          } else if (config.proxy.type === 'http') {

              proxyAgent = new HttpsProxyAgent(config.proxy.url, proxyOptions);

          }

          log('Proxy agent created:', config.proxy.type, config.proxy.url);

      }

      let proxyDisabledForFetch = false;

      let proxyDisabledForWS = false;

      let proxyFailureLogged = false;

      let proxyFailureCount = 0;

      let lastProxyFailureTime = 0;

      const MAX_PROXY_FAILURES = 3;

      const PROXY_RESET_INTERVAL = 300000; // 5 minutes

      

      // Test basic connectivity at startup

      const testConnectivity = async () => {

        try {

          const https = require('https');

          await new Promise((resolve, reject) => {

            const req = https.request('https://arras.io', (res) => {

              if (res.statusCode === 200) {

                log('Connectivity test: OK - arras.io is reachable');

                resolve();

              } else {

                reject(new Error(`HTTP ${res.statusCode}`));

              }

            });

            req.on('error', reject);

            req.on('timeout', () => reject(new Error('Timeout')));

            req.setTimeout(10000);

            req.end();

          });

        } catch (err) {

          log('Connectivity test FAILED:', err.message || err);

          log('This may indicate network issues, DNS problems, or firewall restrictions');

        }

      };

      

      // Run connectivity test

      testConnectivity();

      

      const resetProxyFailures = function() {

        const now = Date.now();

        if (now - lastProxyFailureTime > PROXY_RESET_INTERVAL) {

          proxyFailureCount = 0;

          proxyDisabledForFetch = false;

          proxyDisabledForWS = false;

          proxyFailureLogged = false;

          log('Proxy failure count reset - attempting to use proxy again.');

        }

      };



      const disableProxyForFetch = function(reason) {

        if (proxyDisabledForFetch) { return }

        proxyDisabledForFetch = true;

        proxyFailureCount++;

        lastProxyFailureTime = Date.now();

        if (!proxyFailureLogged) {

          proxyFailureLogged = true;

          log('Proxy disabled for fetch only; WS will still use proxy.', reason || '');

        }

        if (proxyFailureCount >= MAX_PROXY_FAILURES) {

          proxyDisabledForWS = true;

          log('Proxy completely disabled due to multiple failures.');

        }

      };



      let i = 0, controller = {

        x: 250,

        y: 250,

        mouseDown: function() {

          trigger.mousedown(controller.x, controller.y)

        },

        mouseUp: function() {

          trigger.mouseup(controller.x, controller.y)

        },

        click: function(x, y) {

          trigger.mousedown(x, y, 0)

          trigger.mouseup(x, y, 0)

        },

        press: function(code) {

          trigger.keydown(code)

          trigger.keyup(code)

        },

        chat: function(str) {

          log('Sent chat:', str)

          controller.press('Enter')

          global.performance.time += 90

          a()

          controller.press('Enter')

          global.performance.time += 90

          a()

          setValue(str)

          controller.press('Enter')

          global.performance.time += 90

          a()

          setValue(str)

          controller.press('Enter')

        },

        moveDirection: function(x, y) {

          // Track previous key states to prevent spamming

          if (!controller.keyStates) {

            controller.keyStates = { KeyA: false, KeyW: false, KeyD: false, KeyS: false };

          }

          

          const newStates = {

            KeyA: x < 0,

            KeyW: y < 0, 

            KeyD: x > 0,

            KeyS: y > 0

          };

          

          // Only trigger key events when state actually changes

          if (controller.keyStates.KeyA !== newStates.KeyA) {

            trigger[newStates.KeyA ? 'keydown' : 'keyup']('KeyA');

            controller.keyStates.KeyA = newStates.KeyA;

          }

          if (controller.keyStates.KeyW !== newStates.KeyW) {

            trigger[newStates.KeyW ? 'keydown' : 'keyup']('KeyW');

            controller.keyStates.KeyW = newStates.KeyW;

          }

          if (controller.keyStates.KeyD !== newStates.KeyD) {

            trigger[newStates.KeyD ? 'keydown' : 'keyup']('KeyD');

            controller.keyStates.KeyD = newStates.KeyD;

          }

          if (controller.keyStates.KeyS !== newStates.KeyS) {

            trigger[newStates.KeyS ? 'keydown' : 'keyup']('KeyS');

            controller.keyStates.KeyS = newStates.KeyS;

          }

        },

        iv: 4 / Math.PI,

        dv: Math.PI / 4,

        ix: [1, 1, 0, -1, -1, -1, 0, 1],

        iy: [0, 1, 1, 1, 0, -1, -1, -1],

        moveVector: function(x, y, i) {

          let d = Math.atan2(y, x)

          let h = (Math.round(d * controller.iv) % 8 + 8) % 8

          let x2 = controller.ix[h]

          let y2 = controller.iy[h]

          controller.moveDirection(x2, y2)

          return h * controller.dv

        }

      }, smoothMouseTowards = function(targetX, targetY) {

        controller.x = Math.max(0, Math.min(500, targetX))

        controller.y = Math.max(0, Math.min(500, targetY))

        trigger.mousemove(controller.x, controller.y)

      }, statusRecieved = false, status = [], firstJoin = false, hasJoined = false, timeouts = {}, timeout = function(f, t) {

        if(!(t >= 1)) { t = 1 }

        let n = i + t

        let a = timeouts[n]

        if(!a) {

          a = timeouts[n] = []

        }

        a.push(f)

      }, block = false, idleKeys = false, idleIndex = -1

      let idleAngle = 0, cIdleAngle = 0

      let statusFailureCount = 0

      let lastStatusErrorLog = 0

      const STATUS_ERROR_LOG_INTERVAL = 30000

      const shouldLogStatus = config && config.id === 0

      let lastFetchErrorLog = 0

      const FETCH_ERROR_LOG_INTERVAL = 30000

      let followAxisToggle = 0



      const logStatusError = function(message, err) {

        if (!shouldLogStatus) { return }

        const now = Date.now()

        if (now - lastStatusErrorLog < STATUS_ERROR_LOG_INTERVAL) { return }

        lastStatusErrorLog = now

        if (err) {

          log(message, err && err.message ? err.message : err)

        } else {

          log(message)

        }

      }



      const ensureStatusFallback = function() {

        if (!statusRecieved && statusFailureCount >= 3) {

          statusRecieved = true

          logStatusError('Status unavailable; continuing without it.')

        }

      }



      const createStatusFallbackResponse = function() {

        const payload = JSON.stringify({ ok: false, status: {} })

        if (typeof Response === 'function') {

          return new Response(payload, {

            status: 200,

            headers: { 'content-type': 'application/json' }

          })

        }

        return {

          ok: false,

          status: 200,

          json: async () => ({ ok: false, status: {} }),

          text: async () => payload,

          clone: function() { return this }

        }

      }



      const logFetchError = function(err) {

        if (!shouldLogStatus) { return }

        const now = Date.now()

        if (now - lastFetchErrorLog < FETCH_ERROR_LOG_INTERVAL) { return }

        lastFetchErrorLog = now

        log('Fetch failed:', err && err.message ? err.message : err)

      }



      const createFetchFallbackResponse = function() {

        const payload = ''

        if (typeof Response === 'function') {

          return new Response(payload, {

            status: 503,

            headers: { 'content-type': 'text/plain; charset=utf-8' }

          })

        }

        return {

          ok: false,

          status: 503,

          json: async () => ({}),

          text: async () => payload,

          arrayBuffer: async () => new ArrayBuffer(0),

          clone: function() { return this }

        }

      }

      

      const mainInterval = setInterval(function() {

        if(block || isPaused) { // <-- Check for pause flag

          return

        }



        if (socket && socket.readyState === 1 && !subscribedToLeader && config.squadId) {

          const now = Date.now();

          if (now - lastSubscribeAttempt >= SUBSCRIBE_INTERVAL_MS) {

            lastSubscribeAttempt = now;

            log(`Subscribing to leader using Squad ID: ${config.squadId}`);

            send([10, config.squadId]);

            subscribedToLeader = true;

          }

        }



        if (config.type === 'follow' && lastRecieve && Number.isFinite(followTimeoutMs) && followTimeoutMs > 0) {

          if (Date.now() - lastRecieve > followTimeoutMs) {

            active = 0;

          }

        }



        if(a) {

          switch(i) {

            case 1: {

              setValue(config.name)

              controller.click(250, 190)

              log('Play button clicked!', config.name, global.location.hash)

              break

            }

          }

          if(lastHash !== global.location.hash) {

            log('hash =', global.location.hash)

            lastHash = global.location.hash

          }

          let at = timeouts[i]

          if(at) {

            delete timeouts[i]

            for(let i=0,l=at.length;i<l;i++) {

              at[i]()

            }

          }

          position[2] --

          if(position[2] < 0) {

            controller.press('KeyL')

          }

          if(hasJoined) {

            reconnectCount = 0; // Reset reconnect counter on successful join

            if(ca.onJoin) {

              ca.onJoin()

            }

            hasJoined = false

            inGame = true

            upgrade = true

            let keys = []

            if(firstJoin) {

              firstJoin = false

              for(let i=0,l=config.tank.length;i<l;i++) {

                keys.push(config.tank[i])

              }

              

              // --- Letter assignment with memory clearing ---

              if(config.feedMode === 'on' && config.letterCombo) {

                log(`Bot assigned letter combo: ${config.letterCombo}`);

                

                // Randomly decide whether to type the letters (10% chance)

                if(Math.random() < 0.1) {

                  for(let j=0; j<config.letterCombo.length; j++) {

                    const letter = config.letterCombo[j].toUpperCase();

                    controller.press('Key' + letter);

                  }

                }

                

                // Clear memory after assignment

                if(global.gc) {

                  global.gc();

                }

              }

            }

            idleIndex = 0

            idleKeys = keys

            

            if (!fs.existsSync('./success_log.json')) {

                log('SUCCESSFUL CONNECTION! Saving this event sequence as the baseline.');

                fs.writeFileSync('./success_log.json', JSON.stringify(eventLog, null, 2));

            }

          }

          if(idleKeys) {

            if(idleIndex >= 0) {

              controller.press('Key' + idleKeys[idleIndex])

              idleIndex ++

              if(idleIndex >= idleKeys.length) {

                idleIndex = -1

                idleKeys = false

              }

            }

          } else if(idleIndex >= -10) {

            idleIndex --

          } else {

            idleIndex = -11

          }

          if(inGame && config.type === 'follow' && idleIndex < -10) {

            if(upgrade) {

              for(let i=0,l=config.keys.length;i<l;i++) {

                controller.press('Key' + config.keys[i])

              }

              upgrade = false

            }



            active --

            if(i % 175 === 174 && config.chatSpam) {

              controller.chat(config.chatSpam)

            }

            

            let dx = target[0] - position[0], dy = target[1] - position[1]

            if(active > 0) {

              let mouseWorldX = target[10];

              let mouseWorldY = target[11];

              let hasMouseWorld = (typeof mouseWorldX === 'number' && typeof mouseWorldY === 'number');

              const preferDelta = process.env.FOLLOW_PREFER_DELTA === '1';

              const preferScreen = process.env.FOLLOW_PREFER_SCREEN === '1';

              const allowScreenFallback = process.env.FOLLOW_SCREEN_FALLBACK === '1';

              const clampToViewport = process.env.FOLLOW_CLAMP_VIEWPORT === '1';



              // Prefer computing world point from leader screen coords + gd if available

              let leaderClientX = target[5];

              let leaderClientY = target[6];

                  let leaderViewportWidth = target[7];

                  let leaderViewportHeight = target[8];

                  let leaderGd = target[9];

                  const outOfBounds = clampToViewport &&

                      typeof leaderClientX === 'number' &&

                      typeof leaderClientY === 'number' &&

                      typeof leaderViewportWidth === 'number' &&

                      typeof leaderViewportHeight === 'number' &&

                      (leaderClientX < 0 || leaderClientY < 0 ||

                       leaderClientX > leaderViewportWidth || leaderClientY > leaderViewportHeight);

              if (outOfBounds) {

                  hasMouseWorld = false;

              }

              const shouldUseScreen = (preferScreen || (!hasMouseWorld && allowScreenFallback));

              if (shouldUseScreen && !outOfBounds && typeof leaderClientX === 'number' &&

                  typeof leaderClientY === 'number' &&

                  typeof leaderViewportWidth === 'number' &&

                  typeof leaderViewportHeight === 'number' &&

                  leaderViewportWidth > 0 &&

                  leaderViewportHeight > 0 &&

                  typeof leaderGd === 'number' &&

                  leaderGd !== 0) {

                  const leaderScale = (leaderViewportWidth * 0.5625 > leaderViewportHeight)

                      ? 888.888888888 / leaderViewportWidth

                      : 500 / leaderViewportHeight;

                  const centeredX = leaderClientX - leaderViewportWidth * 0.5;

                  const centeredY = leaderClientY - leaderViewportHeight * 0.5;

                  mouseWorldX = target[0] + centeredX * leaderScale * leaderGd;

                  mouseWorldY = target[1] + centeredY * leaderScale * leaderGd;

                  hasMouseWorld = true;

              }

              if (!hasMouseWorld && preferDelta && typeof target[2] === 'number' && typeof target[3] === 'number') {

                  mouseWorldX = target[0] + target[2];

                  mouseWorldY = target[1] + target[3];

                  hasMouseWorld = true;

              }



              if (!hasMouseWorld) {

                  controller.moveDirection(0, 0);

                  controller.mouseUp();

              } else {

                  let move_dx = mouseWorldX - position[0];

                  let move_dy = mouseWorldY - position[1];



                  // Follow tolerance to prevent exact coordinate alignment and diagonal correction loops

                  const followTolerance = parseFloat(process.env.FOLLOW_TOLERANCE || '2');

                  const axisRange = parseFloat(process.env.FOLLOW_AXIS_RANGE || '0.02');

                  const stopRadius = parseFloat(process.env.FOLLOW_STOP_RADIUS || '3');

                  const axisMode = (process.env.FOLLOW_AXIS_MODE || 'alternate').toLowerCase();

                  let dist = Math.hypot(move_dx, move_dy);

                  let comp_x = 0;

                  let comp_y = 0;

                  const absDx = Math.abs(move_dx);

                  const absDy = Math.abs(move_dy);



                  // Stop movement if within tolerance range of target

                  if (absDx <= followTolerance && absDy <= followTolerance) {

                      // Within tolerance, stop movement

                  } else if (dist > stopRadius) {

                      // Allow smooth diagonal movement by using both axes when needed

                      if (absDx > followTolerance) {

                          comp_x = move_dx > 0 ? 1 : -1;

                      }

                      if (absDy > followTolerance) {

                          comp_y = move_dy > 0 ? 1 : -1;

                      }

                      

                      // If both are zero but we're still outside radius, force dominant axis.

                      if (comp_x === 0 && comp_y === 0) {

                          if (absDx >= absDy) comp_x = move_dx > 0 ? 1 : -1;

                          else comp_y = move_dy > 0 ? 1 : -1;

                      }

                  }



                  controller.moveDirection(comp_x, comp_y);



                  const angle = Math.atan2(move_dy, move_dx);

                  controller.x = 250 + Math.cos(angle) * 100;

                  controller.y = 250 + Math.sin(angle) * 100;

                  trigger.mousemove(controller.x, controller.y);

              }



              if (config.autoFire) {

                  controller.mouseDown();

              } else {

                  if (target[4]) {

                      controller.mouseDown();

                  } else {

                      controller.mouseUp();

                  }

              }



            } else {

              controller.moveDirection(0, 0)

              if(Math.random() < 0.01) {

                  let dist = 20;

                  let randomAngle = 2 * Math.PI * Math.random();

                  trigger.mousemove(

                      controller.x = 250 + dist * Math.cos(randomAngle),

                      controller.y = 250 + dist * Math.sin(randomAngle)

                  );

              }

              controller.mouseUp()

            }

          }

          if(died) {

            inGame = false

            log('Death detected. Clearing render cache...')

            block = true

            ignore = true

            let index = 0

            let interval = setInterval(function() {

              if(destroyed) {

                clearInterval(interval)

                return

              }

              for(let i=0;i<30;i++) {

                let r = 100 + 900 * Math.random(), q = 100 + 900 * Math.random(), p = 0.5 + Math.random()

                innerWidth = global.window.innerWidth = r

                innerHeight = global.window.innerHeight = q

                devicePixelRatio = global.window.devicePixelRatio = p

                global.performance.time += 9000

                a()

              }

              index ++

              if(index >= 30) {

                clearInterval(interval)

                end()

              }

            }, 30), end = function() {

              innerWidth = global.window.innerWidth = 500

              innerHeight = global.window.innerHeight = 500

              devicePixelRatio = global.window.devicePixelRatio = 1

              if(config.autoRespawn) {

                // Stagger respawn to prevent cascade

                const respawnDelay = Math.random() * 2000 + 1000; // 1-3 seconds random delay

                log(`Render cache cleared, respawning in ${Math.round(respawnDelay/1000)}s...`);

                setTimeout(() => {

                  controller.press('Enter');

                }, respawnDelay);

              } else {

                log('Render cache cleared.')

              }

              block = false

              ignore = false

              global.performance.time += 9000

              a()

              if(statusRecieved) { i ++ }

            }

            died = false

            return

          }

          global.performance.time += 9000

          a()

          if(statusRecieved) {

            i ++

          }

        }

      }, 20)

      const averageAngle = function(a, b, c) {

        let d = 2 * Math.PI;

        a = ((a % d) + d) % d;

        let e = (d + b - a) % d;

        if (e > Math.PI) {

          return (((a + (e - d) / (c + 1)) % d) + d) % d;

        } else {

          return (((a + e / (c + 1)) % d) + d) % d;

        }

      }

      global.localStorage = global.window.localStorage = {

        setItem: function(i, v) {

          this[i] = v

        },

        getItem: function(i) {

          return this[i]

        }

      }



      global.fetch = global.window.fetch = new Proxy(realFetch, { apply:function(a, b, c) {

        let f = c[0];

        eventLog.push({ type: 'fetch', url: f });



        if(f.startsWith('./')) {

          f = c[0] = 'https://arras.io' + f.slice(1)

        } else if(f.startsWith('/')) {

          f = c[0] = 'https://arras.io' + f

        }



        let options = c[1] ? { ...c[1] } : {};

        

        // Properly handle proxy agent for Node.js fetch

        if (proxyAgent && !proxyDisabledForFetch) {

            options.agent = proxyAgent;

        } else if (options.agent) {

            delete options.agent;

        }

        

        // Add timeout to prevent hanging

        if (!options.timeout) {

            options.timeout = 30000; // 30 seconds

        }



        // DNS resolution fallback and connection retry with different methods

        options.lookup = (hostname, opts, callback) => {

            dns.lookup(hostname, opts, (err, address, family) => {

                if (err && err.code === 'ENOTFOUND') {

                    // Try again with different DNS servers or methods

                    dns.lookup(hostname, { ...opts, verbatim: true }, (err2, address2, family2) => {

                        if (err2) {

                            return callback(err2);

                        }

                        callback(null, address2, family2);

                    });

                } else if (err) {

                    return callback(err);

                }

                callback(null, address, family);

            });

        };

        

        const runFetch = async (opts) => {

            // Try different methods in order

            const methods = [

                // Method 1: Use node-fetch directly

                async () => {

                    const m = await import('node-fetch');

                    const fetchFunc = m.default || m;

                    return await fetchFunc(f, opts);

                },

                // Method 2: Use native fetch if available

                async () => {

                    if (typeof realFetch === 'function') {

                        return await realFetch(f, opts);

                    }

                    throw new Error('Native fetch not available');

                },

                // Method 3: Direct HTTPS/HTTP request

                async () => {

                    const urlObj = new URL(f);

                    const isHttps = urlObj.protocol === 'https:';

                    const lib = isHttps ? require('https') : require('http');

                    

                    return new Promise((resolve, reject) => {

                        const req = lib.request(f, opts, (res) => {

                            let data = '';

                            res.on('data', chunk => data += chunk);

                            res.on('end', () => {

                                resolve({

                                    ok: res.statusCode >= 200 && res.statusCode < 300,

                                    status: res.statusCode,

                                    statusText: res.statusMessage,

                                    headers: res.headers,

                                    text: async () => data,

                                    json: async () => JSON.parse(data),

                                    arrayBuffer: async () => Buffer.from(data),

                                    clone: function() { return this; }

                                });

                            });

                        });

                        

                        req.on('error', reject);

                        req.on('timeout', () => reject(new Error('Request timeout')));

                        req.setTimeout(30000);

                        req.end();

                    });

                }

            ];



            for (let i = 0; i < methods.length; i++) {

                try {

                    log(`Trying fetch method ${i + 1}...`);

                    const result = await methods[i]();

                    log(`Fetch method ${i + 1} succeeded`);

                    return result;

                } catch (err) {

                    log(`Fetch method ${i + 1} failed:`, err.message || err);

                    if (i === methods.length - 1) {

                        throw err; // Re-throw the last error if all methods fail

                    }

                }

            }

        };

        const fetchWithOptionalRetry = () => {

            resetProxyFailures(); // Check if we should reset proxy failures

            return Promise.resolve()

                .then(() => runFetch(options))

                .catch(err => {

                    log('Fetch error details:', {

                        url: f,

                        usingProxy: !!(proxyAgent && !proxyDisabledForFetch),

                        proxyUrl: config.proxy ? config.proxy.url : 'none',

                        error: err.message || err,

                        errorCode: err.code,

                        errno: err.errno

                    });

                    

                    if (proxyAgent && !proxyDisabledForFetch) {

                        disableProxyForFetch('Proxy fetch failed; retrying direct.');

                        const retryOptions = { ...options };

                        delete retryOptions.agent;

                        return runFetch(retryOptions).catch(retryErr => {

                            log('Direct fetch also failed after proxy failure:', retryErr.message || retryErr);

                            throw retryErr;

                        });

                    }

                    throw err;

                });

        };



        if(f.includes('app.wasm')) { return wasm() }



        const isStatusRequest = typeof f === 'string' && f.includes('status');

        const fetchPromise = fetchWithOptionalRetry();



        if (isStatusRequest) {

            return fetchPromise.then(response => {

                response.clone().json().then(i => {

                    if (i && typeof i === 'object') {

                        statusRecieved = true;

                        statusFailureCount = 0;

                        if (i.status) {

                            status = Object.values(i.status);

                            if (shouldLogStatus) {

                                log('Status recieved and processed.');

                            }

                        } else if (i.servers) {

                            status = Object.values(i.servers);

                            if (shouldLogStatus) {

                                log('Status recieved and processed.');

                            }

                        } else {

                            logStatusError('Status payload missing expected fields.');

                        }

                    } else {

                        statusFailureCount++;

                        logStatusError('Status payload invalid.');

                        ensureStatusFallback();

                    }

                }).catch(err => {

                    statusFailureCount++;

                    logStatusError('Failed to process status JSON:', err);

                    ensureStatusFallback();

                });

                return response;

            }).catch(err => {

                statusFailureCount++;

                logStatusError('Status fetch failed.', err);

                ensureStatusFallback();

                return createStatusFallbackResponse();

            });

        }



        return fetchPromise.catch(err => {

            logFetchError(err);

            return createFetchFallbackResponse();

        });

      } })



      global.navigator = global.window.navigator = {}

      let gameSocket = false, host = false

      

      global.WebSocket = global.window.WebSocket = new Proxy(ws, { construct:function(a, b, c) {

        const fullUrl = b[0];

        eventLog.push({ type: 'websocket', url: fullUrl });

        host = new url.URL(fullUrl).host



        let h = {

          headers: {

            'user-agent': `Mozilla/5.0 (X11; CrOS x86_64 14588.123.0) AppleWebKit/${(100 + 900 * Math.random()).toFixed(2)} (KHTML, like Gecko) Chrome 101.0.0.0 Safari ${(100 + 900 * Math.random()).toFixed(2)}`,

            'accept-encoding': 'gzip, deflate, br',

            'accept-language': 'en-US,en;q=0.9',

            'cache-control': 'no-cache',

            'connection': 'Upgrade',

            'origin': 'https://arras.io',

            'pragma': 'no-cache',

            'upgrade': 'websocket',

            'Sec-WebSocket-Protocol': b[1] ? b[1].join(', ') : '',

            'host': host

          },

          followRedirects: true,

          origin: 'https://arras.io',

        }

        

        resetProxyFailures(); // Check if we should reset proxy failures

        if (proxyAgent && !proxyDisabledForWS && process.env.PROXY_WS_DISABLE !== '1') { h.agent = proxyAgent; }

        

        const newArgs = [fullUrl, b[1], h];

        const d = Reflect.construct(a, newArgs, c)



        d.addEventListener('open', function() {

          log('WebSocket open.')

          connected = true

        })



        d.addEventListener('error', function(err) {

          log('WebSocket error:', err && err.message ? err.message : err)

          // Track WebSocket proxy failures

          if (proxyAgent && !proxyDisabledForWS && err && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND')) {

            proxyFailureCount++;

            log(`WebSocket proxy failure #${proxyFailureCount}`);

            if (proxyFailureCount >= MAX_PROXY_FAILURES) {

              proxyDisabledForWS = true;

              log('WebSocket proxy disabled due to multiple connection failures.');

            }

          }

        })



        d.addEventListener('close', function(e) {

          if(gameSocket === d) { gameSocket = false; }

          log('WebSocket closed. wasClean =', e.wasClean, 'code =', e.code, 'reason =', e.reason)



          if (!inGame && e.code !== 1000) {

            try {

              if (fs.existsSync('./success_log.json')) {

                const successfulLog = JSON.parse(fs.readFileSync('./success_log.json'));

                // compareLogs(successfulLog, eventLog); This function was not defined in original script

              } else {

                log('Failure occurred, but no successful log exists yet to compare against. The first bot to succeed will create one.');

              }

            } catch (err) {

              log('Error during log comparison:', err);

            }

          }

        })



        let closed = false

        d.addEventListener('message', function(e) { let u = Array.from(new Uint8Array(e.data)) })

        d.send = new Proxy(d.send, { apply:function(f, g, h) { return Reflect.apply(f, g, h) } })

        d.close = new Proxy(d.close, { apply:function(f, g, h) {

          if(closed) { return }

          log('WebSocket closed by client.')

          closed = true

          Reflect.apply(f, g, h)

        } })

        d.addEventListener = new Proxy(d.addEventListener, { apply:function(a, b, c) { return Reflect.apply(a, b, c) } })

        gameSocket = d

        return d

      } })

      eval(x)

      let ca = oa || {}

      ca.window = global.window

      ca.destroy = destroy

      ca.controller = controller

      ca.trigger = trigger

      // Return the interface so the master process can reference it

      return Object.assign(ca, internalBotInterface);

    }





    let id = 0

    let arras = {

      then: (cb) => {

          then(() => cb(arras));

      },

      create: function(o) {

        if (!ready) {

            log("Warning: 'create' called before arras was ready. It will be queued.");

        }

        o.id = o.id !== undefined ? o.id : id++;

        return run(script, o)

      }

    }

    if(options.start) {

      options.start(arras)

    }

    return arras

  })()

}

