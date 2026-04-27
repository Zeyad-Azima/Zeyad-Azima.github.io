/* =============================================================
   ARCADE FX
   Cursor, animated background canvas, click bursts, reveal-on-scroll, glitch hover.
   Respects prefers-reduced-motion and disables on touch devices.
   ============================================================= */
(function () {
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------------- Pixel cursor ---------------- */
  function initCursor() {
    if (!hasFinePointer) return;

    var cursor = document.getElementById('arcade-cursor');
    var dot    = document.getElementById('arcade-cursor-dot');
    if (!cursor || !dot) return;

    var mx = window.innerWidth / 2, my = window.innerHeight / 2;
    var cx = mx, cy = my;

    document.addEventListener('mousemove', function (e) {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = 'translate(' + (mx - 2) + 'px,' + (my - 2) + 'px)';
    });

    function tick() {
      cx += (mx - cx) * 0.25;
      cy += (my - cy) * 0.25;
      cursor.style.transform = 'translate(' + (cx - 8) + 'px,' + (cy - 8) + 'px)';
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // Grow on hover over interactive elements
    var hoverables = 'a, button, .btn, input, textarea, select, .post-blog-card, .author__urls a, .pagination li a, .code-copy-btn, .search__toggle, .greedy-nav__toggle';
    document.addEventListener('mouseover', function (e) {
      if (e.target.closest && e.target.closest(hoverables)) {
        cursor.classList.add('hover');
      }
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest && e.target.closest(hoverables)) {
        cursor.classList.remove('hover');
      }
    });

    document.addEventListener('mousedown', function () { cursor.classList.add('down'); });
    document.addEventListener('mouseup',   function () { cursor.classList.remove('down'); });
  }

  /* ---------------- Click burst particles ---------------- */
  function initClickBurst() {
    if (prefersReduced) return;

    var palette = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a855f7', '#3b82f6'];

    document.addEventListener('click', function (e) {
      // skip clicks on form fields where motion would be distracting
      if (e.target.closest('input, textarea, select')) return;

      var n = 8;
      for (var i = 0; i < n; i++) {
        var p = document.createElement('div');
        p.className = 'arcade-particle';
        p.style.left = e.clientX + 'px';
        p.style.top  = e.clientY + 'px';
        p.style.background = palette[i % palette.length];
        document.body.appendChild(p);

        var angle = (Math.PI * 2 * i) / n;
        var dist  = 30 + Math.random() * 20;
        var dx = Math.cos(angle) * dist;
        var dy = Math.sin(angle) * dist;

        var start = performance.now();
        (function animate(t) {
          var elapsed = t - start;
          var pct = elapsed / 600;
          if (pct >= 1) { p.remove(); return; }
          p.style.transform = 'translate(' + (dx * pct) + 'px,' + (dy * pct) + 'px)';
          p.style.opacity = (1 - pct);
          requestAnimationFrame(animate);
        })(start);
      }
    });
  }

  /* ---------------- Background canvas (grid + particles) ---------------- */
  function initBackground() {
    if (prefersReduced) return;

    var canvas = document.getElementById('arcade-bg-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    var particles = [];
    var PARTICLE_COUNT = 40;
    var palette = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a855f7', '#3b82f6'];

    function spawn() {
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: 3 + Math.floor(Math.random() * 3),
        color: palette[Math.floor(Math.random() * palette.length)],
        a: 0.6 + Math.random() * 0.4
      };
    }
    for (var i = 0; i < PARTICLE_COUNT; i++) particles.push(spawn());

    var gridOffset = 0;
    var lastFrame = 0;
    var FRAME_MS = 1000 / 30;  // 30fps cap — enough motion, half the CPU of 60fps

    function frame(t) {
      if (t - lastFrame < FRAME_MS) {
        requestAnimationFrame(frame);
        return;
      }
      lastFrame = t;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // grid
      var gridSize = 40;
      gridOffset = (gridOffset + 0.25) % gridSize;
      ctx.strokeStyle = 'rgba(78, 205, 196, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var x = -gridSize + gridOffset; x < canvas.width + gridSize; x += gridSize) {
        ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
      }
      for (var y = -gridSize + gridOffset; y < canvas.height + gridSize; y += gridSize) {
        ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
      }
      ctx.stroke();

      // particles
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
      }
      ctx.globalAlpha = 1;

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Pause when tab is hidden — saves battery
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) requestAnimationFrame(frame);
    });
  }

  /* ---------------- Reveal on scroll ---------------- */
  function initReveal() {
    if (prefersReduced) return;
    if (!('IntersectionObserver' in window)) return;

    var targets = document.querySelectorAll('.post-blog-card, .archive__item, .toc, .page__content > h2, .page__content > h3, .sidebar');
    if (!targets.length) return;

    targets.forEach(function (el) { el.classList.add('reveal'); });

    /* Only NOW gate reveals via CSS — if JS broke earlier, content stays visible. */
    document.body.classList.add('arcade-fx-ready');

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    targets.forEach(function (el) {
      io.observe(el);
      /* Safety: if still hidden after 3s, force reveal */
      setTimeout(function () { el.classList.add('visible'); }, 3000);
    });
  }

  /* ---------------- Glitch hover on titles ---------------- */
  function initGlitch() {
    if (prefersReduced) return;

    var hovers = document.querySelectorAll('.page__title, .archive__subtitle, .author__name, .post-blog-card h2');
    hovers.forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        el.classList.add('arcade-glitch');
        setTimeout(function () { el.classList.remove('arcade-glitch'); }, 380);
      });
    });
  }

  /* ---------------- Hacker scene ---------------- */
  function initHackerScene() {
    if (prefersReduced) return;
    var scene = document.getElementById('hacker-scene');
    if (!scene) return;

    var timers = [];
    function clearTimers() {
      timers.forEach(function (t) { clearTimeout(t); });
      timers = [];
    }

    function setState(s) {
      scene.setAttribute('data-state', s);
    }

    function play() {
      clearTimers();
      setState('idle');

      timers.push(setTimeout(function () { setState('typing');   }, 200));
      timers.push(setTimeout(function () { setState('warning');  }, 2200));
      timers.push(setTimeout(function () { setState('panic');    }, 4000));
      timers.push(setTimeout(function () { setState('cops');     }, 5800));
      timers.push(setTimeout(function () { setState('arrest');   }, 7600));
      timers.push(setTimeout(function () { setState('cuffed');   }, 9800));
      timers.push(setTimeout(function () { setState('walking');  }, 11400));
      timers.push(setTimeout(function () { setState('jailed');   }, 13400));
      /* Loop: hold the jailed pose briefly, then restart */
      timers.push(setTimeout(function () { play(); }, 17000));
    }

    /* Trigger on first scroll into view (or immediately if already visible) */
    var triggered = false;
    function maybeTrigger() {
      if (triggered) return;
      var rect = scene.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        triggered = true;
        play();
      }
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !triggered) {
            triggered = true;
            play();
            io.disconnect();
          }
        });
      }, { threshold: 0.2 });
      io.observe(scene);
    } else {
      window.addEventListener('scroll', maybeTrigger, { passive: true });
      maybeTrigger();
    }

    var replay = scene.querySelector('.hs-replay');
    if (replay) {
      replay.addEventListener('click', function () { play(); });
    }
  }

  /* ---------------- Boot ---------------- */
  function boot() {
    initCursor();
    initClickBurst();
    initBackground();
    initReveal();
    initGlitch();
    initHackerScene();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
