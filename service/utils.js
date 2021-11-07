const {exec} = require('child_process');
const {execSync} = require('child_process');
const findProc = require('find-process');

class Service {
  stop() {
    if (!this.isRunning()) return console.log('already stopped');
    stopServiceExec(this.proc);
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
    let cmd = 'node ' + this.path() + ' > ' + this.log +' 2>&1 &';
    execute(cmd);
    return 'started';
  }
  path() {
    return __dirname + '/' + this.proc;
  }
}

class Rebalancer extends Service {
  static name = 'rebalancer';
  constructor() {
    super();
    this.name = Rebalancer.name;
    this.proc = 'autorebalance.js';
    this.log = '/tmp/autorebalance.log';
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
  }

  // override to provide additional info
  start() {
    try {
      const {validateBot} = require('../api/telegram');
      validateBot();
      super.start();
    } catch(error) {
      return error.message;
    }
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
  stopService: function(name) {
    if (!name) return console.error('missing service');
    if (!services[name]) return console.error('unknown service:', name);
    return services[name].stop();
  },
  startService: function(name) {
    if (!name) return console.error('missing service');
    if (!services[name]) return console.error('unknown service:', name);
    return services[name].start();
  },
  restartService: function(name) {
    if (!name) return 'missing service';
    if (!services[name]) return 'unknown service: ' + name;
    return services[name].restart();
  },
  printStatus: function() {
    let status = [];
    Object.values(services).forEach(s => {
      status.push({service: s.name, status: s.status(), log: s.log});
    })
    console.table(status);
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
