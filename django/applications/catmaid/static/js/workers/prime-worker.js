/**
 * Created by cbarnes on 1/30/17.
 */

var isPrime = function (number) {
  if (number === 2) {
    return true;
  }
  if (number % 2 === 0) {
    return false;
  }

  var i = 3;
  while (i <= Math.sqrt(number)) {
    if (number % i === 0) {
      return false;
    }
    i += 2;
  }
  return true;
};

var PrimeGetter = function(startAt, descending) {
  this.current = startAt;
  this.descending = descending || false;

  this.getNext = function() {
    if (this.current <= 1) {
      this.descending = false;
    } else if (this.current >= 9007199254740881) {
      this.descending = true;
    }
    var multiplier = descending ? -1 : 1;

    do {
      this.current += multiplier;
    } while (!isPrime(this.current));

    return this.current;
  };
};

PrimeGetter.prototype = {};

var Synchroniser = function() {
  this.startAt = Date.now();

  this.wait = function(delay) {
    var endAt = this.startAt + delay;
    while (Date.now() < endAt) {
      // do nothing
    }
  };
};

Synchroniser.prototype = {};

self.addEventListener('message', function(e) {
  if (e.data.srcs) {
    for (var src of e.data.srcs) {
      importScripts(src);
    }
  }

  var idx;
  if (e.data.cmd == 'start') {
    idx = e.data.idx || 0;
    var currentNumber = e.data.startAt || 0;
    var descending = false;

    var primeGetter = new PrimeGetter(currentNumber, descending);

    while (true) {
      var sync = new Synchroniser();
      var started = Date.now();
      currentNumber = primeGetter.getNext();
      sync.wait(100);
      self.postMessage({output: currentNumber, 'idx': idx, runtime: Date.now() - started});
    }
  } else if (e.data.cmd == 'test') {
    idx = e.data.idx || 0;
    self.postMessage({output: 200, 'idx': idx, runtime: Date.now()});
  }
}, false);
