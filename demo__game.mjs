/**
 * KIVILCIM demo — arena.
 * Runtime API'sinin tamamını kullanır: params (typed, aralık dışı throw), inspect, events,
 * commands, storage (şema denetimli), juice (particle/screenshake), deterministik RNG.
 * Sim kodunda Math.random / Date.now / performance.now YOK.
 */
import { Game } from '../kivilcim.mjs';

export function createDemoGame(canvas, opts = {}) {
  const game = new Game({
    canvas,
    width: 960,
    height: 540,
    seed: opts.seed || 1337,
    background: '#080d18',
    fit: 'fit',
  });

  game.params.define('player', {
    speed: { type: 'number', min: 60, max: 600, default: 240, unit: 'px/s', desc: 'Yatay hareket hızı' },
    fireInterval: { type: 'int', min: 6, max: 90, default: 24, unit: 'tick', desc: 'Otomatik ateş aralığı' },
    autoFire: { type: 'bool', default: true, desc: 'Otomatik ateş' },
    lives: { type: 'int', min: 1, max: 9, default: 3, desc: 'Can sayısı' },
  });

  game.params.define('world', {
    waveSize: { type: 'int', min: 1, max: 12, default: 4, desc: 'Dalga düşman sayısı' },
    enemySpeed: { type: 'number', min: 10, max: 200, default: 36, unit: 'px/s', desc: 'Düşman iniş hızı' },
    difficulty: { type: 'enum', options: ['easy', 'normal', 'hard'], default: 'normal', desc: 'Zorluk' },
  });

  const st = {
    player: { x: 480, y: 470, w: 26, h: 26, hp: 3 },
    bullets: [],
    enemies: [],
    particles: [],
    score: 0,
    wave: 1,
    waveRemaining: 0,
    spawnDelay: 0,
    fireTimer: 0,
    gameOver: false,
    hits: 0,
  };

  const SAVE_SCHEMA = { highScore: 'number', wave: 'number' };
  const saved = game.storage.load('run', SAVE_SCHEMA) || { highScore: 0, wave: 1 };
  let highScore = Number(saved.highScore) || 0;

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = game.random.float(0, Math.PI * 2);
      const sp = game.random.float(40, 180);
      st.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: game.random.float(1.5, 4),
        color,
        life: 0.6,
        maxLife: 0.6,
      });
    }
  }

  // Görünür dünya penceresi (dikey ekranda kapak kırpması dünyanın yalnız ortasını
  // gösterir): oyuncu ve düşmanlar bu şeridin içinde tutulur, aksi halde ekran dışında kalırlar.
  function arenaX() {
    const v = game.visibleWorld();
    const x0 = Math.max(24, v.x + 16);
    const x1 = Math.min(936, v.x + v.w - 16);
    return { x0: Math.min(x0, x1 - 32), x1: Math.max(x1, x0 + 32) };
  }

  function spawnEnemy() {
    const b = arenaX();
    st.enemies.push({
      x: game.random.int(Math.round(b.x0), Math.round(b.x1)),
      y: -24,
      w: 24,
      h: 24,
      hp: 1,
      wob: game.random.float(-0.6, 0.6),
    });
  }

  function spawnWave(n) {
    const count = Math.max(1, Math.floor(Number(n) || game.params.get('world.waveSize') || 4));
    st.waveRemaining += count;
    for (let i = 0; i < count; i++) spawnEnemy();
    game.emit('waveSpawned', { wave: st.wave, count });
    return st.waveRemaining;
  }

  function resetRun() {
    st.player.x = 480;
    st.player.hp = game.params.get('player.lives');
    st.bullets.length = 0;
    st.enemies.length = 0;
    st.particles.length = 0;
    st.score = 0;
    st.wave = 1;
    st.waveRemaining = 0;
    st.spawnDelay = 0;
    st.fireTimer = 0;
    st.gameOver = false;
    st.hits = 0;
    game.random.restore(game.random.save()); // aynı seed akışı korunur
    game.emit('runReset');
    return st;
  }

  const arena = {
    id: 'arena',
    enter() {
      resetRun();
      spawnWave(game.params.get('world.waveSize'));
    },
    update(dt) {
      if (st.gameOver) return;
      const speed = game.params.get('player.speed');
      const ax = game.input.axis('left');
      const pb = arenaX();
      st.player.x = Math.max(pb.x0, Math.min(pb.x1, st.player.x + ax * speed * dt));

      const autoFire = game.params.get('player.autoFire');
      const fireInterval = game.params.get('player.fireInterval');
      st.fireTimer++;
      if ((autoFire || game.input.justPressed('Space')) && st.fireTimer >= fireInterval) {
        st.fireTimer = 0;
        let tx = st.player.x;
        if (st.enemies.length) {
          let best = st.enemies[0];
          for (const e of st.enemies) if (e.y > best.y) best = e;
          tx = best.x;
        }
        st.bullets.push({ x: tx, y: st.player.y - 14, vy: -640, homing: true });
        game.emit('shotFired');
      }

      for (let i = st.bullets.length - 1; i >= 0; i--) {
        const b = st.bullets[i];
        b.y += b.vy * dt;
        if (b.homing && st.enemies.length) {
          let best = st.enemies[0];
          for (const e of st.enemies) if (e.y > best.y) best = e;
          const d = best.x - b.x;
          b.x += Math.max(-6, Math.min(6, d));
        }
        if (b.y < -10) { st.bullets.splice(i, 1); continue; }
        for (let j = st.enemies.length - 1; j >= 0; j--) {
          const e = st.enemies[j];
          if (Math.abs(b.x - e.x) < 16 && Math.abs(b.y - e.y) < 16) {
            st.enemies.splice(j, 1);
            st.bullets.splice(i, 1);
            st.score += 10;
            burst(e.x, e.y, '#ffb457', 8);
            game.emit('enemyDown', { x: e.x, y: e.y });
            break;
          }
        }
      }

      const espeed = game.params.get('world.enemySpeed');
      for (let i = st.enemies.length - 1; i >= 0; i--) {
        const e = st.enemies[i];
        e.y += espeed * dt;
        e.x += Math.sin((game.tick + i * 13) / 40) * e.wob;
        const eb = arenaX();
        e.x = Math.max(eb.x0, Math.min(eb.x1, e.x));
        if (e.y > st.player.y - 8) {
          st.enemies.splice(i, 1);
          st.player.hp -= 1;
          st.hits++;
          burst(e.x, st.player.y, '#ff5470', 12);
          if (!game.reducedMotion) game.draw.screenshake(9, 10);
          game.emit('playerHit', { hp: st.player.hp });
          if (st.player.hp <= 0) {
            st.gameOver = true;
            game.emit('gameOver', { score: st.score });
            if (st.score > highScore) {
              highScore = st.score;
              game.storage.save('run', { highScore, wave: st.wave, __tick: game.tick }, SAVE_SCHEMA);
            }
          }
        }
      }

      for (let i = st.particles.length - 1; i >= 0; i--) {
        const p = st.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 220 * dt;
        p.life -= dt;
        if (p.life <= 0) st.particles.splice(i, 1);
      }

      if (!st.gameOver && st.enemies.length === 0 && st.spawnDelay <= 0) {
        game.emit('waveCleared', { wave: st.wave, score: st.score });
        st.wave += 1;
        st.spawnDelay = 60;
      }
      if (st.spawnDelay > 0) {
        st.spawnDelay--;
        if (st.spawnDelay === 0) spawnWave(game.params.get('world.waveSize'));
      }
    },
    render(draw) {
      const c = draw.ctx;
      if (c) {
        draw.applyShake();
        const g = c.createLinearGradient ? c.createLinearGradient(0, 0, 0, 540) : null;
        if (g) { g.addColorStop(0, '#0b1322'); g.addColorStop(1, '#06090f'); c.fillStyle = g; c.fillRect(0, 0, 960, 540); }
      }
      draw.rect(0, 0, 960, 540, '#080d18');
      for (let x = 0; x <= 960; x += 60) draw.line(x, 0, x, 540, '#101a2b', 1);
      for (let y = 0; y <= 540; y += 60) draw.line(0, y, 960, y, '#101a2b', 1);

      draw.rect(0, 500, 960, 40, '#0e1726');
      draw.rect(st.player.x - st.player.w / 2, st.player.y - st.player.h / 2, st.player.w, st.player.h, '#4fd1c5', { stroke: '#a7f3d0', lineWidth: 2 });
      draw.rect(st.player.x - 4, st.player.y - st.player.h / 2 - 6, 8, 8, '#a7f3d0');

      for (const e of st.enemies) {
        draw.rect(e.x - 12, e.y - 12, 24, 24, '#ff5470', { stroke: '#ffb3c1', lineWidth: 2 });
        draw.circle(e.x, e.y, 4, '#ffe3e8');
      }
      for (const b of st.bullets) draw.rect(b.x - 2, b.y - 8, 4, 12, '#ffe066');
      draw.particles(st.particles);

      // HUD üst bandı: opak — düşmanlar bandın altından çıkar, metinler her zaman net.
      // Ekran sabitli öğeler görünen dünya dikdörtgenine yerleşir: kapak ölçekte kırpılan
      // bölgeye yazı çizilmez (dikey ekranda da skor/can görünür kalır).
      const vis = game.visibleWorld ? game.visibleWorld() : { x: 0, y: 0, w: 960, h: 540 };
      const hx = Math.round(vis.x);
      const hw = Math.round(vis.w);
      const hy = Math.round(vis.y);
      const bandH = Math.min(112, Math.round(vis.h));
      draw.rect(hx, hy, hw, bandH, '#0a111d');
      draw.rect(hx, hy + bandH, hw, 2, '#16233a');

      draw.text(`SKOR ${st.score}`, hx + 18, hy + 40, { color: '#e8eef7', font: 'bold 22px ui-monospace, monospace' });
      draw.text(`DALGA ${st.wave}`, hx + 18, hy + 70, { color: '#9fb3c8', font: '16px ui-monospace, monospace' });
      draw.text(`CAN ${st.player.hp}`, hx + 18, hy + 94, { color: st.player.hp > 1 ? '#7ee787' : '#ff5470', font: '16px ui-monospace, monospace' });
      // Dar görünümde (dikey ekran) sağdaki "EN İYİ" skor metnine binmesin: sağa yasla, küçült.
      if (hw >= 520) draw.text(`EN İYİ ${highScore}`, hx + hw - 200, hy + 40, { color: '#ffd479', font: 'bold 18px ui-monospace, monospace' });
      else draw.text(`EN İYİ ${highScore}`, hx + hw - 12, hy + 40, { color: '#ffd479', font: 'bold 13px ui-monospace, monospace', align: 'right' });

      if (st.gameOver) {
        const cx = Math.round(hx + hw / 2);
        const cy = Math.round(hy + vis.h / 2);
        draw.rect(cx - 220, cy - 60, 440, 120, '#131c2b', { stroke: '#ff5470', lineWidth: 2, alpha: 0.95 });
        draw.text('OYUN BİTTİ', cx, cy - 10, { color: '#ff8fa3', font: 'bold 32px ui-monospace, monospace', align: 'center' });
        draw.text(`skor ${st.score} · dalga ${st.wave}`, cx, cy + 26, { color: '#e8eef7', font: '18px ui-monospace, monospace', align: 'center' });
      }
    },
    inspect() {
      return {
        player: { x: Number(st.player.x.toFixed(3)), y: st.player.y, hp: st.player.hp },
        score: st.score,
        wave: st.wave,
        enemies: st.enemies.length,
        bullets: st.bullets.length,
        particles: st.particles.length,
        hits: st.hits,
        gameOver: st.gameOver,
        highScore,
      };
    },
  };

  game.addScene(arena);
  game.inspect.register('state', () => arena.inspect());
  game.inspect.register('save', () => ({ highScore, schemaWarnings: game.storage.warnings.length }));

  game.command('spawnWave', (n) => spawnWave(n));
  game.command('resetRun', () => resetRun());
  game.command('heal', (n) => { st.player.hp = Math.min(9, st.player.hp + (Number(n) || 1)); return st.player.hp; });
  game.command('killAll', () => { st.enemies.length = 0; return 0; });

  game.go('arena');
  return game;
}
