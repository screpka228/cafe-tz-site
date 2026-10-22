// Кафе — прототип по ТЗ (Phaser 3). Один экран: очередь за столиками, кухня, магазин, настройки.
const W = 360, H = 640;
const KEY = 'cafe-save-v1';
const MAX_TABLES = 4;
const OFFLINE_CAP = 7200; // секунд, по ТЗ 2 часа

const RECIPES = {
  espresso: { name: 'Эспрессо', steps: ['espresso'], price: 8 },
  latte:    { name: 'Латте', steps: ['espresso', 'milk', 'whip'], price: 14 },
  mocha:    { name: 'Мокка', steps: ['espresso', 'milk', 'syrup', 'whip'], price: 20 },
};
const LABEL = { espresso: 'Кофе', milk: 'Молоко', syrup: 'Сироп', whip: 'Сливки' };
const CHARS = {
  hurry:  { name: 'Торопыга',  time: 25, tip: 0.6, color: 0xe74c3c },
  calm:   { name: 'Спокойный', time: 60, tip: 0.1, color: 0x3498db },
  picky:  { name: 'Привереда', time: 40, tip: 0.3, color: 0x9b59b6 },
};

function defaults() {
  return {
    coins: 0,
    tables: 2,
    menu: ['espresso', 'latte'],
    upgrades: { speed: 0 },
    settings: { shakeToWhip: false, shakeSensitivity: 0.5, sound: true },
    lastSeen: 0,
  };
}

function load() {
  const base = defaults();
  try {
    const d = JSON.parse(localStorage.getItem(KEY)) || {};
    return Object.assign(base, d, {
      settings: Object.assign(base.settings, d.settings),
      upgrades: Object.assign(base.upgrades, d.upgrades),
    });
  } catch (e) {
    return base;
  }
}

let S = load();
function save() {
  S.lastSeen = Date.now();
  localStorage.setItem(KEY, JSON.stringify(S));
}
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

const TXT = (size, color = '#3b2a1e', extra = {}) =>
  Object.assign({ fontFamily: 'system-ui, sans-serif', fontSize: size + 'px', color }, extra);

function button(scene, x, y, w, h, label, onClick) {
  const bg = scene.add.rectangle(x, y, w, h, 0x8b5a2b)
    .setStrokeStyle(2, 0x000000, 0.25)
    .setInteractive({ useHandCursor: true });
  const t = scene.add.text(x, y, label, TXT(15, '#ffffff', { align: 'center', wordWrap: { width: w - 10 } })).setOrigin(0.5);
  bg.on('pointerdown', () => { if (bg.enabled !== false) onClick(); });
  return {
    bg, t,
    setLabel(text) { t.setText(text); },
    enable(on) {
      bg.enabled = on;
      bg.setFillStyle(on ? 0x8b5a2b : 0x7a7a7a);
      t.setAlpha(on ? 1 : 0.5);
    },
    setVisible(v) { bg.setVisible(v); t.setVisible(v); },
  };
}

class Cafe extends Phaser.Scene {
  constructor() { super('cafe'); }

  create() {
    this.g = this.add.graphics();
    this.coinsT = this.add.text(12, 24, '', TXT(18, '#3b2a1e', { fontStyle: 'bold' })).setOrigin(0, 0.5);
    this.msgT = this.add.text(W / 2, 74, '', TXT(14, '#7a3b10', { align: 'center' })).setOrigin(0.5);
    this.ticketT = this.add.text(W / 2, 100, '', TXT(13, '#3b2a1e', { align: 'center', wordWrap: { width: W - 20 } })).setOrigin(0.5);
    this.counterT = this.add.text(W / 2, 318, 'Стойка', TXT(13, '#ffffff')).setOrigin(0.5);

    this.slotT = [];
    for (let i = 0; i < MAX_TABLES; i++) {
      this.slotT.push(this.add.text(0, 262, '', TXT(11, '#3b2a1e', { align: 'center' })).setOrigin(0.5).setVisible(false));
    }

    button(this, 240, 24, 88, 30, 'Магазин', () => this.openModal('shop'));
    button(this, 326, 24, 56, 30, 'Опции', () => this.openModal('settings'));

    this.btn = {
      espresso: button(this, 100, 462, 150, 44, 'Кофе', () => this.ingredient('espresso')),
      milk:     button(this, 260, 462, 150, 44, 'Молоко', () => this.ingredient('milk')),
      syrup:    button(this, 100, 514, 150, 44, 'Сироп', () => this.ingredient('syrup')),
      whip:     button(this, 260, 514, 150, 44, 'Взбить сливки', () => this.startWhip()),
      repair:   button(this, 100, 566, 150, 44, 'Починить', () => this.repairTap()),
      clean:    button(this, 260, 566, 150, 44, 'Убрать грязь', () => this.cleanTap()),
      reset:    button(this, 180, 612, 150, 36, 'Сброс', () => { this.build = []; }),
    };

    this.buildWhipPanel();
    this.modalC = this.add.container(0, 0).setDepth(10).setVisible(false);
    this.modalKind = null;

    this.queue = [];
    this.build = [];
    this.spawnT = 2;
    this.eventT = 40;
    this.bloggerT = 0;
    this.machineBroken = false;
    this.repairLeft = 0;
    this.cleanT = 0;
    this.whipping = false;
    this.whipP = 0;
    this.msg = '';
    this.msgUntil = 0;
    this.saveT = 5;
    this.lastShake = 0;

    // Оффлайн-доход: до 2 часов, 0.02 монеты в секунду на каждый столик
    if (S.lastSeen > 0) {
      const elapsed = Math.min((Date.now() - S.lastSeen) / 1000, OFFLINE_CAP);
      const earned = Math.floor(elapsed * 0.02 * S.tables);
      if (earned > 0) {
        S.coins += earned;
        this.say(`Пока вас не было: +${earned} монет`);
        save();
      }
    }

    this.onMotion = (e) => this.handleMotion(e);
    window.addEventListener('devicemotion', this.onMotion);
    this.events.once('shutdown', () => window.removeEventListener('devicemotion', this.onMotion));
  }

  // ---------- логика ----------
  head() { return this.queue[0]; }

  speedMult() { return 1 + 0.25 * S.upgrades.speed; }

  say(text, ms = 2500) {
    this.msg = text;
    this.msgUntil = this.time.now + ms;
  }

  makeCustomer() {
    const kinds = Object.keys(CHARS);
    const ch = kinds[Math.floor(Math.random() * kinds.length)];
    const drink = S.menu[Math.floor(Math.random() * S.menu.length)];
    const r = RECIPES[drink];
    const steps = [...r.steps];
    if (ch === 'picky' && !steps.includes('syrup')) {
      const i = steps.indexOf('whip');
      steps.splice(i === -1 ? steps.length : i, 0, 'syrup');
    }
    return { drink, steps, char: ch, max: CHARS[ch].time, patience: CHARS[ch].time, price: r.price };
  }

  ingredient(id) {
    const h = this.head();
    if (!h) return this.say('Пока нет гостей');
    if (id === 'espresso' && this.machineBroken) return this.say('Кофемашина сломана!');
    if (id === h.steps[this.build.length]) {
      this.build.push(id);
      if (this.build.length === h.steps.length) this.serve();
    } else {
      this.mistake();
    }
  }

  mistake() {
    const h = this.head();
    if (h) h.patience -= 4;
    this.build = [];
    this.say('Ошибка! Клиент недоволен (-4 с терпения)');
  }

  serve() {
    const c = this.head();
    const ratio = Math.max(0, c.patience / c.max);
    const tip = Math.round(c.price * CHARS[c.char].tip * ratio);
    const total = (c.price + tip) * (this.bloggerT > 0 ? 2 : 1);
    S.coins += total;
    this.queue.shift();
    this.build = [];
    this.say(`Заказ выдан! +${total} монет`);
    save();
  }

  startWhip() {
    const h = this.head();
    if (!h) return this.say('Пока нет гостей');
    if (h.steps[this.build.length] !== 'whip') return this.mistake();
    this.whipping = true;
    this.whipP = 0;
    this.whipC.setVisible(true);
  }

  addWhip(amount) {
    if (!this.whipping) return;
    this.whipP += amount * this.speedMult();
    if (this.whipP >= 100) {
      this.whipping = false;
      this.whipC.setVisible(false);
      const h = this.head();
      this.build.push('whip');
      if (h && this.build.length === h.steps.length) this.serve();
    }
  }

  cancelWhip() {
    this.whipping = false;
    this.whipC.setVisible(false);
  }

  handleMotion(e) {
    if (!this.whipping || !S.settings.shakeToWhip) return;
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const m = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    const threshold = 12 - 8 * S.settings.shakeSensitivity;
    const now = Date.now();
    if (Math.abs(m - 9.81) > threshold && now - this.lastShake > 120) {
      this.lastShake = now;
      this.addWhip(6);
    }
  }

  repairTap() {
    if (!this.machineBroken) return;
    this.repairLeft -= 1;
    if (this.repairLeft <= 0) {
      this.machineBroken = false;
      this.say('Кофемашина починена');
    }
  }

  cleanTap() {
    if (this.cleanT <= 0) return;
    this.cleanT = 0;
    this.say('Чисто! Проверка пройдена');
  }

  randomEvent() {
    const r = Math.floor(Math.random() * 3);
    if (r === 0) {
      this.bloggerT = 30;
      this.say('Блогер в кафе! Двойная оплата 30 с', 3000);
    } else if (r === 1) {
      this.machineBroken = true;
      this.repairLeft = 10;
      this.say('Кофемашина сломалась — нажимай «Починить»', 3000);
    } else {
      this.cleanT = 15;
      this.say('Санэпидемстанция! Нажми «Убрать грязь» за 15 с', 3000);
    }
  }

  // ---------- цикл ----------
  update(time, delta) {
    const dt = delta / 1000;

    // гости
    this.spawnT -= dt;
    if (this.queue.length < S.tables && this.spawnT <= 0) {
      this.queue.push(this.makeCustomer());
      this.spawnT = 6 + Math.random() * 6;
    }
    const before = this.queue.length;
    this.queue = this.queue.filter((c) => {
      c.patience -= dt;
      return c.patience > 0;
    });
    if (this.queue.length < before) {
      this.build = [];
      this.say('Гость ушёл, не дождавшись');
    }

    // события
    this.eventT -= dt;
    if (this.eventT <= 0) {
      this.eventT = 40;
      if (Math.random() < 0.4 && !this.machineBroken && this.cleanT <= 0 && this.bloggerT <= 0) {
        this.randomEvent();
      }
    }
    if (this.bloggerT > 0) this.bloggerT -= dt;
    if (this.cleanT > 0) {
      this.cleanT -= dt;
      if (this.cleanT <= 0) {
        S.coins = Math.max(0, S.coins - 20);
        this.say('Не убрали вовремя: штраф -20 монет');
      }
    }

    // автосохранение
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 5;
      save();
    }

    // взбивание через кнопку и тряску обрабатываются в addWhip; здесь только отрисовка
    if (this.whipping) this.drawWhipBar();

    this.refresh();
  }

  // ---------- отрисовка ----------
  refresh() {
    const g = this.g;
    g.clear();

    // фон и кухня
    g.fillStyle(0xf2dcc0, 1).fillRect(0, 50, W, 360);
    g.fillStyle(0x8b5a2b, 1).fillRect(20, 300, W - 40, 36);
    g.fillStyle(0x3b2a1e, 1).fillRect(0, 410, W, H - 410);

    // столики и гости
    for (let i = 0; i < S.tables; i++) {
      const x = W * (i + 0.5) / S.tables;
      const c = this.queue[i];
      const isHead = i === 0 && c;
      g.fillStyle(0xa0522d, 1).fillRect(x - 35, 212, 70, 28);
      if (isHead) g.lineStyle(3, 0xffd34e, 1).strokeRect(x - 37, 210, 74, 32);
      if (c) {
        g.fillStyle(CHARS[c.char].color, 1).fillCircle(x, 180, 18);
        const ratio = Math.max(0, c.patience / c.max);
        g.fillStyle(0x555555, 1).fillRect(x - 35, 246, 70, 6);
        g.fillStyle(ratio > 0.3 ? 0x2ecc71 : 0xe74c3c, 1).fillRect(x - 35, 246, 70 * ratio, 6);
      }
      const t = this.slotT[i];
      t.setPosition(x, 262).setVisible(true);
      t.setText(c ? `${CHARS[c.char].name}\n${RECIPES[c.drink].name}` : 'Свободно');
      t.setColor(c ? '#3b2a1e' : '#9a8373');
    }
    for (let i = S.tables; i < MAX_TABLES; i++) this.slotT[i].setVisible(false);

    // тексты
    this.coinsT.setText(`Монеты: ${Math.floor(S.coins)}`);
    this.msgT.setText(this.time.now < this.msgUntil ? this.msg : '');
    const h = this.head();
    if (h) {
      const steps = h.steps.map((s, i) => (i < this.build.length ? '✓ ' : '') + LABEL[s]).join(' → ');
      this.ticketT.setText(`Заказ: ${RECIPES[h.drink].name}\n${steps}`);
    } else {
      this.ticketT.setText('Ждём гостей…');
    }

    // кнопки
    this.btn.espresso.enable(!this.machineBroken);
    this.btn.repair.setVisible(this.machineBroken);
    this.btn.repair.enable(this.machineBroken);
    this.btn.repair.setLabel(`Починить (${this.repairLeft})`);
    this.btn.clean.setVisible(this.cleanT > 0);
    this.btn.clean.enable(this.cleanT > 0);
    this.btn.clean.setLabel(`Убрать грязь (${Math.ceil(this.cleanT)})`);
  }

  // ---------- взбивание ----------
  buildWhipPanel() {
    this.whipC = this.add.container(0, 0).setDepth(20).setVisible(false);
    const bg = this.add.rectangle(W / 2, H / 2, W - 40, 220, 0xfdf6ec).setStrokeStyle(3, 0x8b5a2b)
      .setInteractive(); // блокирует клики под панелью
    const title = this.add.text(W / 2, H / 2 - 80, 'Взбивание сливок', TXT(18, '#3b2a1e', { fontStyle: 'bold' })).setOrigin(0.5);
    const hint = this.add.text(W / 2, H / 2 - 50, 'Тапай «Взбить» или тряси телефон\n(тряска — в настройках)', TXT(12, '#7a6558', { align: 'center' })).setOrigin(0.5);
    this.whipBarBg = this.add.rectangle(W / 2, H / 2 - 5, 260, 22, 0xd9c4ab);
    this.whipBar = this.add.rectangle(W / 2 - 130, H / 2 - 5, 0, 22, 0xc8702a).setOrigin(0, 0.5);
    const tap = button(this, W / 2, H / 2 + 40, 160, 44, 'Взбить!', () => this.addWhip(8));
    const cancel = button(this, W / 2, H / 2 + 92, 160, 36, 'Отмена', () => this.cancelWhip());
    this.whipC.add([bg, title, hint, this.whipBarBg, this.whipBar, tap.bg, tap.t, cancel.bg, cancel.t]);
  }

  drawWhipBar() {
    this.whipBar.width = 260 * Math.min(1, this.whipP / 100);
  }

  // ---------- модальные окна: магазин и настройки ----------
  openModal(kind) {
    this.modalKind = kind;
    this.buildModal();
    this.modalC.setVisible(true);
  }

  closeModal() {
    this.modalKind = null;
    this.modalC.removeAll(true);
    this.modalC.setVisible(false);
  }

  buildModal() {
    const c = this.modalC;
    c.removeAll(true);
    const add = (...objs) => c.add(objs);

    const bg = this.add.rectangle(W / 2, H / 2, W - 20, 500, 0xfdf6ec).setStrokeStyle(3, 0x8b5a2b).setInteractive();
    add(bg);
    const title = this.modalKind === 'shop' ? 'Магазин' : 'Настройки';
    add(this.add.text(W / 2, 92, title, TXT(20, '#3b2a1e', { fontStyle: 'bold' })).setOrigin(0.5));

    const row = (y, label, enabled, onClick) => {
      const b = button(this, W / 2, y, 300, 44, label, onClick);
      b.enable(enabled);
      add(b.bg, b.t);
    };

    if (this.modalKind === 'shop') {
      const tCost = Math.round(50 * Math.pow(1.6, S.tables - 2));
      row(150, S.tables >= MAX_TABLES ? 'Столики: максимум' : `Новый столик — ${tCost} монет`,
        S.tables < MAX_TABLES && S.coins >= tCost, () => {
          S.coins -= tCost; S.tables += 1; save(); this.buildModal();
        });

      const lvl = S.upgrades.speed;
      const sCost = 30 * (lvl + 1);
      row(214, lvl >= 3 ? 'Ускорение взбивания: максимум' : `Ускорение взбивания (${lvl}/3) — ${sCost} монет`,
        lvl < 3 && S.coins >= sCost, () => {
          S.coins -= sCost; S.upgrades.speed += 1; save(); this.buildModal();
        });

      const mochaOwned = S.menu.includes('mocha');
      row(278, mochaOwned ? 'Мокка уже открыта' : 'Открыть мокку (сироп) — 80 монет',
        !mochaOwned && S.coins >= 80, () => {
          S.coins -= 80; S.menu.push('mocha'); save(); this.buildModal();
        });
    } else {
      const s = S.settings;
      row(150, `Тряска для взбивания: ${s.shakeToWhip ? 'ВКЛ' : 'ВЫКЛ'}`, true, () => {
        s.shakeToWhip = !s.shakeToWhip; save(); this.buildModal();
      });
      const levels = [0.25, 0.5, 0.75];
      const name = s.shakeSensitivity <= 0.25 ? 'низкая' : s.shakeSensitivity <= 0.5 ? 'средняя' : 'высокая';
      row(214, `Чувствительность тряски: ${name}`, true, () => {
        const i = levels.indexOf(s.shakeSensitivity);
        s.shakeSensitivity = levels[(i + 1) % levels.length];
        save(); this.buildModal();
      });
      row(278, `Звук: ${s.sound ? 'ВКЛ' : 'ВЫКЛ'}`, true, () => {
        s.sound = !s.sound; save(); this.buildModal();
      });
    }

    const close = button(this, W / 2, 560, 160, 40, 'Закрыть', () => this.closeModal());
    add(close.bg, close.t);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: '#fdf6ec',
  parent: 'game',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Cafe],
});
