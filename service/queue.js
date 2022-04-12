// a simple queue for rebalance instances

module.exports = class RebalanceQueue {
  constructor() {
    this.queue = [];
  }
  pop() {
    if (this.queue.length === 0) return;
    if (this.queue[0].time < Date.now()) return this.queue.shift();
    return;
  }
  add(from, to, fromName, toName, amount, maxPpm, time = new Date, type) {
    let item = {from, to, fromName, toName, amount, maxPpm, time, type};
    if (this.queue.length === 0) {
      this.queue.push(item);
    } else {
      // insert base on time
      let index = 0;
      for(; index < this.queue.length; index++) {
        if (time < this.queue[index].time) break;
      }
      if (index === this.queue.length) this.queue.push(item);
      else this.queue.splice(index, 0, item);
    }
    return item;
  }
  includes(from, to) {
    let included = false;
    this.queue.forEach(entry => {
      included = included || (entry.from === from && entry.to === to);
    })
    return included;
  }
  sats(peer) {  // returns outstanding sats for the peer, inbound and outbound
    let inbound = 0;
    let outbound = 0;
    this.queue.forEach(entry => {
      if (entry.from === peer) outbound += entry.amount;
      if (entry.to === peer) inbound += entry.amount;
    })
    return {inbound, outbound};
  }
  list() { return this.queue; }
  count() { return this.queue.length; }
}