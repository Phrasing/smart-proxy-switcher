(function() {
  var val = self.__PROXY_TZ;
  try { delete self.__PROXY_TZ; } catch(e) {}

  if (typeof val === 'string') {
    // Path A (launch.bat): tz-config.js already set the value synchronously
    boot(val);
  } else {
    // Path B (standalone): value is null, install setter trap for background.js injection
    Object.defineProperty(self, '__PROXY_TZ', {
      configurable: true,
      set: function(v) {
        Object.defineProperty(self, '__PROXY_TZ', {
          value: v, configurable: true, writable: true
        });
        if (typeof v === 'string' && v) boot(v);
      }
    });
  }

  function boot(tz) {
    // Core overrides — self-contained, works in any JS context (page, worker, iframe)
    function applyTzOverrides(tz, G) {
      // A. HOISTED SHARED UTILITIES
      var nativeFns = new Map();
      function nStr(n) { return 'function ' + n + '() { [native code] }'; }
      function defMethod(obj, name, impl) {
        var m = {[name]() { return impl.apply(this, arguments); }}[name];
        obj[name] = m;
        return m;
      }

      // B. TIMEZONE OVERRIDES
      if (tz) {
        var OrigDTF = G.Intl.DateTimeFormat;
        var OrigDate = G.Date;
        var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        var utcFmt = new OrigDTF('en-US', {
          timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
        });
        var tzFmt = new OrigDTF('en-US', {
          timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
        });
        var weekdayFmt = new OrigDTF('en-US', { timeZone: tz, weekday: 'short' });
        var tzNameFmt = new OrigDTF('en-US', { timeZone: tz, timeZoneName: 'long', year: 'numeric' });
        var sysFmt = new OrigDTF('en-US', {
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
        });

        function fmtOffset(date, localFmt) {
          var p = {}, q = {};
          utcFmt.formatToParts(date).forEach(function(v) { p[v.type] = +v.value || 0; });
          localFmt.formatToParts(date).forEach(function(v) { q[v.type] = +v.value || 0; });
          return (OrigDate.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second)
                - OrigDate.UTC(q.year, q.month - 1, q.day, q.hour % 24, q.minute, q.second)) / 60000;
        }

        function getOffset(date) { return fmtOffset(date, tzFmt); }
        function getSysOffset(date) { return fmtOffset(date, sysFmt); }

        function localParts(date) {
          var p = {};
          tzFmt.formatToParts(date).forEach(function(v) { p[v.type] = +v.value || 0; });
          p.hour = p.hour % 24;
          return p;
        }

        function localArgsToUtc(year, month, day, hour, min, sec, ms) {
          var yr = (year >= 0 && year <= 99) ? year + 1900 : year;
          var utcGuess = OrigDate.UTC(yr, month, day, hour, min, sec, ms);
          if (isNaN(utcGuess)) return NaN;
          var offset = getOffset(new OrigDate(utcGuess));
          var result = utcGuess + offset * 60000;
          var offset2 = getOffset(new OrigDate(result));
          if (offset2 !== offset) result = utcGuess + offset2 * 60000;
          return result;
        }

        function adjustLocalParse(d) {
          var sysOff = getSysOffset(d);
          var tgtOff = getOffset(d);
          if (sysOff !== tgtOff) {
            var adjusted = new OrigDate(d.getTime() + (tgtOff - sysOff) * 60000);
            var tgtOff2 = getOffset(adjusted);
            if (tgtOff2 !== tgtOff) adjusted = new OrigDate(d.getTime() + (tgtOff2 - sysOff) * 60000);
            return adjusted;
          }
          return d;
        }

        function hasExplicitTZ(s) {
          var t = s.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
          if (/(?:Z|[+-]\d{2}:?\d{2})\s*$/.test(t)) return true;
          if (/\b(?:UTC|GMT)\b/i.test(t)) return true;
          return false;
        }

        // --- Intl.DateTimeFormat ---
        G.Intl.DateTimeFormat = function DateTimeFormat(locales, options) {
          var opts = options ? Object.assign({}, options) : {};
          if (!opts.timeZone) opts.timeZone = tz;
          return new OrigDTF(locales, opts);
        };
        G.Intl.DateTimeFormat.prototype = OrigDTF.prototype;
        Object.setPrototypeOf(G.Intl.DateTimeFormat, OrigDTF);
        G.Intl.DateTimeFormat.supportedLocalesOf = OrigDTF.supportedLocalesOf.bind(OrigDTF);
        Object.defineProperty(G.Intl.DateTimeFormat, 'name', { value: 'DateTimeFormat', configurable: true });
        Object.defineProperty(G.Intl.DateTimeFormat, 'length', { value: OrigDTF.length, configurable: true });

        // --- Date.prototype getters ---
        defMethod(OrigDate.prototype, 'getTimezoneOffset', function() { return getOffset(this); });
        defMethod(OrigDate.prototype, 'getFullYear', function() { return localParts(this).year; });
        defMethod(OrigDate.prototype, 'getMonth', function() { return localParts(this).month - 1; });
        defMethod(OrigDate.prototype, 'getDate', function() { return localParts(this).day; });
        defMethod(OrigDate.prototype, 'getHours', function() { return localParts(this).hour; });
        defMethod(OrigDate.prototype, 'getMinutes', function() { return localParts(this).minute; });
        defMethod(OrigDate.prototype, 'getSeconds', function() { return localParts(this).second; });
        defMethod(OrigDate.prototype, 'getYear', function() { return localParts(this).year - 1900; });
        defMethod(OrigDate.prototype, 'getDay', function() {
          var p = localParts(this);
          return new OrigDate(OrigDate.UTC(p.year, p.month - 1, p.day)).getUTCDay();
        });

        // --- Date.prototype setters ---
        defMethod(OrigDate.prototype, 'setFullYear', function(y, m, d) {
          var p = localParts(this);
          this.setTime(localArgsToUtc(+y,
            arguments.length > 1 ? +m : p.month - 1,
            arguments.length > 2 ? +d : p.day,
            p.hour, p.minute, p.second, this.getUTCMilliseconds()));
          return this.getTime();
        });
        defMethod(OrigDate.prototype, 'setMonth', function(m, d) {
          var p = localParts(this);
          this.setTime(localArgsToUtc(p.year, +m,
            arguments.length > 1 ? +d : p.day,
            p.hour, p.minute, p.second, this.getUTCMilliseconds()));
          return this.getTime();
        });
        defMethod(OrigDate.prototype, 'setDate', function(d) {
          var p = localParts(this);
          this.setTime(localArgsToUtc(p.year, p.month - 1, +d,
            p.hour, p.minute, p.second, this.getUTCMilliseconds()));
          return this.getTime();
        });
        defMethod(OrigDate.prototype, 'setHours', function(h, m, s, ms) {
          var p = localParts(this);
          this.setTime(localArgsToUtc(p.year, p.month - 1, p.day, +h,
            arguments.length > 1 ? +m : p.minute,
            arguments.length > 2 ? +s : p.second,
            arguments.length > 3 ? +ms : this.getUTCMilliseconds()));
          return this.getTime();
        });
        defMethod(OrigDate.prototype, 'setMinutes', function(m, s, ms) {
          var p = localParts(this);
          this.setTime(localArgsToUtc(p.year, p.month - 1, p.day, p.hour, +m,
            arguments.length > 1 ? +s : p.second,
            arguments.length > 2 ? +ms : this.getUTCMilliseconds()));
          return this.getTime();
        });
        defMethod(OrigDate.prototype, 'setSeconds', function(s, ms) {
          var p = localParts(this);
          this.setTime(localArgsToUtc(p.year, p.month - 1, p.day, p.hour, p.minute, +s,
            arguments.length > 1 ? +ms : this.getUTCMilliseconds()));
          return this.getTime();
        });
        defMethod(OrigDate.prototype, 'setYear', function(y) {
          var p = localParts(this);
          var yr = +y; if (yr >= 0 && yr <= 99) yr += 1900;
          this.setTime(localArgsToUtc(yr, p.month - 1, p.day,
            p.hour, p.minute, p.second, this.getUTCMilliseconds()));
          return this.getTime();
        });

        // --- toString ---
        defMethod(OrigDate.prototype, 'toString', function() {
          if (isNaN(this.getTime())) return 'Invalid Date';
          var parts = localParts(this);
          var dayName = weekdayFmt.format(this);
          var tzName = '';
          tzNameFmt.formatToParts(this).forEach(function(v) {
            if (v.type === 'timeZoneName') tzName = v.value;
          });
          var offset = getOffset(this);
          var sign = offset > 0 ? '-' : '+';
          var abs = Math.abs(offset);
          var oh = String(Math.floor(abs / 60)).padStart(2, '0');
          var om = String(abs % 60).padStart(2, '0');
          return dayName + ' ' + MONTHS[parts.month - 1] + ' ' +
                 String(parts.day).padStart(2, '0') + ' ' + parts.year + ' ' +
                 String(parts.hour).padStart(2, '0') + ':' +
                 String(parts.minute).padStart(2, '0') + ':' +
                 String(parts.second).padStart(2, '0') +
                 ' GMT' + sign + oh + om + ' (' + tzName + ')';
        });
        defMethod(OrigDate.prototype, 'toDateString', function() {
          if (isNaN(this.getTime())) return 'Invalid Date';
          return this.toString().split(' ').slice(0, 4).join(' ');
        });
        defMethod(OrigDate.prototype, 'toTimeString', function() {
          if (isNaN(this.getTime())) return 'Invalid Date';
          return this.toString().split(' ').slice(4).join(' ');
        });

        // --- toLocaleString family ---
        ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(function(method) {
          var orig = OrigDate.prototype[method];
          defMethod(OrigDate.prototype, method, function(locales, options) {
            var opts = options ? Object.assign({}, options) : {};
            if (!opts.timeZone) opts.timeZone = tz;
            return orig.call(this, locales, opts);
          });
        });

        // --- Date constructor ---
        var ProxyDate = function Date() {
          var a = arguments;
          if (!(new.target || this instanceof ProxyDate)) return new OrigDate().toString();
          if (a.length === 0) return new OrigDate();
          if (a.length === 1) {
            var val = a[0];
            if (typeof val === 'string') {
              var d = new OrigDate(val);
              if (!isNaN(d.getTime()) && !hasExplicitTZ(val)) {
                return adjustLocalParse(d);
              }
              return d;
            }
            return new OrigDate(val);
          }
          return new OrigDate(localArgsToUtc(+a[0], +a[1],
            a.length > 2 ? +a[2] : 1, a.length > 3 ? +a[3] : 0,
            a.length > 4 ? +a[4] : 0, a.length > 5 ? +a[5] : 0,
            a.length > 6 ? +a[6] : 0));
        };
        ProxyDate.prototype = OrigDate.prototype;
        Object.setPrototypeOf(ProxyDate, G.Function.prototype);
        ProxyDate.now = OrigDate.now;
        ProxyDate.parse = {parse(s) {
          var d = new OrigDate(s);
          if (!isNaN(d.getTime()) && typeof s === 'string' && !hasExplicitTZ(s)) {
            return adjustLocalParse(d).getTime();
          }
          return OrigDate.parse(s);
        }}.parse;
        ProxyDate.UTC = OrigDate.UTC;
        Object.defineProperty(ProxyDate, 'name', { value: 'Date', configurable: true });
        Object.defineProperty(ProxyDate, 'length', { value: 7, configurable: true });
        G.Date = ProxyDate;
        Object.defineProperty(OrigDate.prototype, 'constructor', {
          value: G.Date, configurable: true, writable: true
        });

        // Register timezone nativeFns
        nativeFns.set(G.Date, nStr('Date'));
        nativeFns.set(G.Date.parse, nStr('parse'));
        nativeFns.set(G.Intl.DateTimeFormat, nStr('DateTimeFormat'));
        nativeFns.set(G.Intl.DateTimeFormat.supportedLocalesOf, nStr('supportedLocalesOf'));
        ['getTimezoneOffset','getFullYear','getMonth','getDate','getHours','getMinutes',
         'getSeconds','getYear','getDay','setFullYear','setMonth','setDate',
         'setHours','setMinutes','setSeconds','setYear',
         'toString','toDateString','toTimeString',
         'toLocaleString','toLocaleDateString','toLocaleTimeString'].forEach(function(name) {
          nativeFns.set(OrigDate.prototype[name], nStr(name));
        });
      }

      // C. Function.prototype.toString spoofing
      if (nativeFns.size > 0) {
        var origFnToStr = G.Function.prototype.toString;
        G.Function.prototype.toString = {toString() {
          if (nativeFns.has(this)) return nativeFns.get(this);
          return origFnToStr.call(this);
        }}.toString;
        nativeFns.set(G.Function.prototype.toString, nStr('toString'));
      }
    }

    // Apply to main window
    applyTzOverrides(tz, window);

    // --- Worker interception ---
    var workerCode = '(' + applyTzOverrides.toString() + ')(' + JSON.stringify(tz) + ', self);\n';

    var OrigWorker = window.Worker;
    if (OrigWorker) {
      window.Worker = function Worker(scriptURL, options) {
        if (options && options.type === 'module') return new OrigWorker(scriptURL, options);
        var resolved;
        try { resolved = new URL(scriptURL, location.href).href; } catch(e) { resolved = String(scriptURL); }
        var blob = new Blob(
          [workerCode + 'importScripts(' + JSON.stringify(resolved) + ');\n'],
          { type: 'application/javascript' }
        );
        return new OrigWorker(URL.createObjectURL(blob), options);
      };
      window.Worker.prototype = OrigWorker.prototype;
      Object.defineProperty(window.Worker, 'name', { value: 'Worker', configurable: true });
      Object.defineProperty(window.Worker, 'length', { value: OrigWorker.length, configurable: true });
    }

    var OrigSharedWorker = window.SharedWorker;
    if (OrigSharedWorker) {
      window.SharedWorker = function SharedWorker(scriptURL, nameOrOptions) {
        var opts = typeof nameOrOptions === 'object' ? nameOrOptions : undefined;
        if (opts && opts.type === 'module') return new OrigSharedWorker(scriptURL, nameOrOptions);
        var resolved;
        try { resolved = new URL(scriptURL, location.href).href; } catch(e) { resolved = String(scriptURL); }
        var blob = new Blob(
          [workerCode + 'importScripts(' + JSON.stringify(resolved) + ');\n'],
          { type: 'application/javascript' }
        );
        return new OrigSharedWorker(URL.createObjectURL(blob), nameOrOptions);
      };
      window.SharedWorker.prototype = OrigSharedWorker.prototype;
      Object.defineProperty(window.SharedWorker, 'name', { value: 'SharedWorker', configurable: true });
      Object.defineProperty(window.SharedWorker, 'length', { value: OrigSharedWorker.length, configurable: true });
    }

    // --- Iframe interception ---
    var patchedWindows = new WeakSet();
    patchedWindows.add(window);

    try {
      var cwDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
      var cdDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument');

      if (cwDesc && cwDesc.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            var w = cwDesc.get.call(this);
            try {
              if (w && !patchedWindows.has(w)) { patchedWindows.add(w); applyTzOverrides(tz, w); }
            } catch(e) {}
            return w;
          },
          configurable: true, enumerable: true
        });
      }
      if (cdDesc && cdDesc.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
          get: function() {
            try {
              var w = cwDesc.get.call(this);
              if (w && !patchedWindows.has(w)) { patchedWindows.add(w); applyTzOverrides(tz, w); }
            } catch(e) {}
            return cdDesc.get.call(this);
          },
          configurable: true, enumerable: true
        });
      }
    } catch(e) {}
  }
})();
