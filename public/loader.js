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
