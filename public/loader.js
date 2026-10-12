// Loads the game behind a progress bar. The build points data-main at the
// game's script and data-size at its size, so the bar counts the bytes as they
// arrive; then the script starts from the browser's cache. In development
// there is no data-main, and Vite loads the game itself.
(function () {
  var me = document.currentScript;
  var main = me && me.getAttribute('data-main');
  var size = Number(me && me.getAttribute('data-size')) || 0;
  var box = document.getElementById('loading');
  var bar = document.getElementById('load-bar');
  var text = document.getElementById('load-text');

  // Lays the page out as the game will, so nothing jumps when it arrives:
  // touch screens get their own layout at once, and the box takes the size
  // the game's shaft will have. Keep in step with fit() in src/main.ts.
  var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('touch', touch);
  function fit() {
    if (!box.isConnected) return window.removeEventListener('resize', fit);
    var w = window.innerWidth;
    var h = window.innerHeight;
    document.body.classList.toggle('portrait', h >= w);
    document.body.classList.toggle('landscape', h < w);
    var hud = document.getElementById('hud');
    var width = '';
    var height = '';
    if (touch && h < w) {
      // Landscape: the shaft between the d-pad's column and the strip's.
      var zoom = Math.min(h / (12 * 16), (w - 2 * 190 - 48) / 144, 3.5);
      width = Math.floor(144 * zoom) + 'px';
      height = h + 'px';
    } else if (!touch) {
      // Whole pixels, filling the height the panel leaves.
      var side = w > 640;
      var aw = side ? w - 32 - 8 - 16 - hud.offsetWidth : w - 16 - 8;
      var ah = side ? h - 32 - 8 : h - 16 - 8 - 8 - hud.offsetHeight;
      var z = Math.max(1, Math.floor(Math.min(aw / 144, ah / 208)));
      width = 144 * z + 'px';
      height = Math.max(208, Math.floor(ah / z)) * z + 'px';
    }
    box.style.width = width;
    box.style.height = height;
    box.style.maxWidth = box.style.maxHeight = width ? 'none' : '';
    if (!touch && w > 640) hud.style.height = document.getElementById('stage').offsetHeight + 'px';
  }
  fit();
  window.addEventListener('resize', fit);

  // If the game fails before it replaces this screen, say so instead of hanging.
  window.addEventListener('error', function () {
    if (document.getElementById('loading')) fail('COULD NOT START');
  });
  if (!main) return;

  function show(fraction) {
    var pct = Math.min(99, Math.floor(fraction * 100));
    box.classList.add('counting');
    bar.style.width = pct + '%';
    text.textContent = 'LOADING ' + pct + '%';
  }

  function start() {
    var s = document.createElement('script');
    s.type = 'module';
    s.crossOrigin = '';
    s.src = main;
    s.onerror = function () {
      fail('COULD NOT LOAD');
    };
    document.head.appendChild(s);
  }

  function fail(what) {
    box.classList.add('failed');
    text.textContent = what + ' · TAP TO RETRY';
    box.addEventListener('click', function () {
      location.reload();
    });
  }

  if (!size || !window.fetch || !window.ReadableStream) return start();
  fetch(main, { credentials: 'same-origin' })
    .then(function (res) {
      if (!res.ok || !res.body) throw new Error('status ' + res.status);
      var reader = res.body.getReader();
      var got = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            show(1);
            text.textContent = 'STARTING';
            return start();
          }
          got += r.value.length;
          show(got / size);
          return pump();
        });
      }
      return pump();
    })
    // Without a progress bar, the browser can still load it the usual way.
    .catch(start);
})();
