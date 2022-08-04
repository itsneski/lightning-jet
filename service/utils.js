const config = require('../api/config');
const fs = require('node:fs');
const {exec, execSync, spawn} = require('node:child_process');
const findProc = require('find-process');
const {spawnDetached} = require('../api/utils');
const {sendMessage} = require('../api/telegram');
const {setPropSync} = require('../db/utils');
const {getPropAndDateSync} = require('../db/utils');

class Service {
  stop() {
    if (!this.isRunning()) return console.log('already stopped');
    stopServiceExec(this.proc);
    sendMessage('stopped ' + this.name);
  }
  restart() {
    if (this.isRunning()) this.stop();
    return this.start();
  }
  isRunning() {
    return isServiceRunning(this.proc);
  }
  status() {
    if (this.isRunning()) return 'running';
    else return 'stopped';
  }
  exists() {
    return require('fs').existsSync(this.path());
  }
  start() {
    if (this.isRunning()) return console.log('already running');
    if (!this.exists()) return 'service does not exist';
    if (!this.isConfigured()) {
      if (this.help) return 'service is not configured, can\'t start it. ' + this.help;
      else return 'service is not configured';
    }
    if (this.isDisabled()) return console.log('service is disabled');

    // spawn the process
    spawnDetached({
      cmd: 'node',
      arg: [ this.path() ],
      log: this.log
    })

    sendMessage('started ' + this.name);
    return 'started';
  }
  path() {
    return __dirname + '/' + this.proc;
  }
  isConfigured() {
    return true;  // services can overrides this if configuration is required
  }
  isDisabled() {
    return false;
  }
  recordHeartbeat(sub) {
    let prop = 'service.' + this.name + '.heartbeat';
    if (sub) prop += '.' + sub;
    setPropSync(prop, Date.now());
  }
  lastHeartbeat(sub) {
    let prop = 'service.' + this.name + '.heartbeat';
    if (sub) prop += '.' + sub;
    let val = getPropAndDateSync(prop);
    return val && val.date;
  }
}

class Rebalancer extends Service {
  static name = 'rebalancer';
  constructor() {
    super();
    this.name = Rebalancer.name;
    this.proc = 'rebalancer.js';
    this.log = '/tmp/rebalancer.log';
  }
  isDisabled() {
    return config.rebalancer.disabled;
  }
}

class HtlcLogger extends Service {
  static name = 'logger';
  constructor() {
    super();
    this.name = HtlcLogger.name;
    this.proc = 'htlc-logger.js';
    this.log = '/tmp/htlc-logger.log';
  }
}

// main daemon service; responsible for starting up all other services
// and for keeping them alive. also responsible for doing periodic
// bos reconnect.
class Launcher extends Service {
  static name = 'daddy';
  constructor() {
    super();
    this.name = Launcher.name;
    this.proc = 'launcher.js';
    this.log = '/tmp/launcher.log';
  }
}

// telegram bot
class TelegramBot extends Service {
  static name = 'telegram';
  constructor() {
    super();
    this.name = TelegramBot.name;
    this.proc = 'telegram.js';
    this.log = '/tmp/telegram.log';
    this.help = 'https://github.com/itsneski/lightning-jet#telegram-bot';
  }

  isConfigured() {
    return config.telegramToken;
  }
}

const serviceNames = [
  Rebalancer.name,
  HtlcLogger.name,
  Launcher.name,
  TelegramBot.name
]

var services = {};
services[Rebalancer.name] = new Rebalancer();
services[HtlcLogger.name] = new HtlcLogger();
services[Launcher.name] = new Launcher();
services[TelegramBot.name] = new TelegramBot();

module.exports = {
  Rebalancer: services[Rebalancer.name],
  HtlcLogger: services[HtlcLogger.name],
  Launcher: services[Launcher.name],
  TelegramBot: services[TelegramBot.name],
  getServiceNames: function() { 
    return serviceNames;
  },
  isRunning: function(name) {
    if (!name) return console.error('missing service');
    if (!services[name]) return console.error('unknown service:', name);
    return services[name].isRunning();
  },
  isDisabled: function(name) {
    if (!name) return console.error('missing service');
    if (!services[name]) return console.error('unknown service:', name);
    return services[name].isDisabled();
  },
  stopService: function(name) {
    if (!name) return console.error('missing service');
    if (name === 'all') {
      const daddy = module.exports.Launcher;
      daddy.stop();
      Object.values(services).forEach(s => {
        if (s.name !== daddy.name) s.stop();
      })
    } else {
      if (!services[name]) return console.error('unknown service:', name);
      return services[name].stop();
    }
  },
  startService: function(name) {
    if (!name) return console.error('missing service');
    if (name === 'all') {
      const daddy = module.exports.Launcher;
      daddy.start();  // will start all other services
    } else {
      if (!services[name]) return console.error('unknown service:', name);
      return services[name].start();
    }
  },
  restartService: function(name) {
    if (!name) return 'missing service';
    if (name === 'all') {
      module.exports.stopService('all');
      module.exports.startService('all');
    } else {
      if (!services[name]) return 'unknown service: ' + name;
      return services[name].restart();
    }
  },
  printStatus: function() {
    let status = [];
    Object.values(services).forEach(s => {
      status.push({service: s.name, status: s.status(), log: s.log});
    })
    console.table(status);
  },
  isConfigured: function(name) {
    if (!name) return 'missing service';
    if (!services[name]) return 'unknown service: ' + name;
    return services[name].isConfigured();
  }
}

function stopServiceExec(service) {
  let res;
  findProc('name', service).then(function (list) {
    res = list;
  })
  while(res === undefined) {
    require('deasync').runLoopOnce();
  }
  let pid = res[0] && res[0].pid;
  if (!pid) return 'already stopped';
  process.kill(pid);
  return 'stopped';
}

function isServiceRunning(service) {
  let res;
  findProc('name', service).then(list => res = list);
  while(res === undefined) {
    require('deasync').runLoopOnce();
  }
  return res.length > 0;
}

function execute(cmd) {
  //console.log(cmd);
  return exec(cmd).toString().trim();
}

function executeSync(cmd) {
  //console.log(cmd);
  return execSync(cmd).toString().trim();
}
